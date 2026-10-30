import {
  COURSE_LEVELS,
  MANOEUVRES,
  autopilot,
  createLane,
  decisionInLevel,
  flyDecision,
  manoeuvreIndex,
  nextLevel,
  stateHash,
  type LaneState,
  type LevelResult,
} from "@arena/engine";
import { FATAL_ERRORS, type DecisionClient, type DecisionError, type DecisionResult, type Usage } from "./types.ts";

/** A transient failure is retried this many times before the decision counts as unanswered. */
export const MAX_RETRIES = 3;
/** Wait before retry 1, 2 and 3. Longer after a rate limit, which needs time to clear. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];
const RATE_LIMIT_FACTOR = 5;

/** What a lane flies when its very first decision goes unanswered: upright, engine off. */
export const FALLBACK_PICK = manoeuvreIndex({ tilt: 0, throttle: 0 });

/** One decision as recording v2 stores it. */
export interface DecisionRecord {
  /** Level index within the course, and decision number within that level (0-based). */
  readonly level: number;
  readonly n: number;
  /** Engine state hash the decision was asked at, so a replay can check it is in sync. */
  readonly hash: string;
  /** Menu index flown: the answer, or the last manoeuvre repeated when unanswered. */
  readonly pick: number;
  /** False when every attempt failed (the pick is the repeated manoeuvre) or a fatal error stopped the lane. */
  readonly answered: boolean;
  /** The model's probabilities over the menu, rounded to 4 decimals. Null for lanes that only pick. */
  readonly probs: readonly number[] | null;
  /** Wall time of the attempt that answered, or of the last failed one. */
  readonly latencyMs: number;
  readonly usage: Usage | null;
  /** The last error, even when a retry then succeeded. */
  readonly error: DecisionError | null;
  readonly retries: number;
  readonly servedModel?: string;
}

export interface CourseRun {
  readonly seed: number;
  readonly results: readonly LevelResult[];
  /** Levels a fatal error kept this lane from flying; reported apart from crashes. */
  readonly notFlown: readonly number[];
  /** The fatal error (or cancellation) that stopped the lane, if any. */
  readonly stoppedBy: DecisionError | null;
  readonly decisions: readonly DecisionRecord[];
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  /** Fly only the first this-many levels (a probe). Defaults to the whole course. */
  readonly levels?: number;
  /** Called after each decision with the state it was asked at. */
  readonly onDecision?: (record: DecisionRecord, lane: LaneState) => void;
  /** Injected so tests do not wait on backoff. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const round4 = (p: number): number => Math.round(p * 1e4) / 1e4;

function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

async function attempt(client: DecisionClient, lane: LaneState, signal: AbortSignal): Promise<DecisionResult> {
  const started = performance.now();
  try {
    return await client.decide({ lane, signal });
  } catch (err) {
    // Clients report failures as results; a throw is a bug in one, not a reason to stop the arena.
    return { ok: false, error: { kind: "bad_response", message: err instanceof Error ? err.message : String(err) }, latencyMs: performance.now() - started };
  }
}

/**
 * Asks one decision, retrying transient failures with backoff. Returns the
 * record, and the error that must stop the lane when there is one: a fatal
 * error, or the caller cancelling.
 */
export async function decideWithRetry(
  client: DecisionClient,
  lane: LaneState,
  lastPick: number,
  options: Pick<RunOptions, "signal" | "sleep"> = {},
): Promise<{ record: DecisionRecord; stop: DecisionError | null }> {
  const signal = options.signal ?? new AbortController().signal;
  const sleep = options.sleep ?? sleepFor;
  const base = { level: lane.level.index, n: decisionInLevel(lane), hash: stateHash(lane) };
  let error: DecisionError | null = null;
  for (let retries = 0; ; retries++) {
    const result: DecisionResult = signal.aborted
      ? { ok: false, error: { kind: "aborted", message: "Run cancelled" }, latencyMs: 0 }
      : await attempt(client, lane, signal);
    if (result.ok) {
      const d = result.decision;
      return {
        record: {
          ...base,
          pick: d.pick,
          answered: true,
          probs: d.probs ? d.probs.map(round4) : null,
          latencyMs: Math.round(d.latencyMs),
          usage: d.usage,
          error,
          retries,
          ...(d.servedModel ? { servedModel: d.servedModel } : {}),
        },
        stop: null,
      };
    }
    error = signal.aborted ? { kind: "aborted", message: "Run cancelled" } : result.error;
    const stop = error.kind === "aborted" || FATAL_ERRORS.has(error.kind);
    if (stop || retries === MAX_RETRIES) {
      return {
        record: { ...base, pick: lastPick, answered: false, probs: null, latencyMs: Math.round(result.latencyMs), usage: null, error, retries },
        stop: stop ? error : null,
      };
    }
    await sleep(RETRY_DELAYS_MS[retries]! * (error.kind === "rate_limited" ? RATE_LIMIT_FACTOR : 1), signal);
  }
}

/**
 * Flies one course with one client, in lockstep with its answers: the
 * simulation advances a second only once that second's manoeuvre is known,
 * so latency never changes the flight. An unanswered decision repeats the
 * lane's last manoeuvre. A fatal error stops the lane, and the level it was
 * on and every later one count as not flown.
 */
export async function flyCourse(client: DecisionClient, seed: number, options: RunOptions = {}): Promise<CourseRun> {
  const levels = Math.min(options.levels ?? COURSE_LEVELS, COURSE_LEVELS);
  let lane = createLane(seed);
  let lastPick = FALLBACK_PICK;
  let stoppedBy: DecisionError | null = null;
  const decisions: DecisionRecord[] = [];
  while (!lane.finished && lane.results.length < levels) {
    if (lane.outcome !== null) {
      lane = nextLevel(lane);
      continue;
    }
    const { record, stop } = await decideWithRetry(client, lane, lastPick, options);
    decisions.push(record);
    options.onDecision?.(record, lane);
    if (stop) {
      stoppedBy = stop;
      break;
    }
    lastPick = record.pick;
    lane = flyDecision(lane, MANOEUVRES[record.pick]!);
  }
  const notFlown = stoppedBy ? Array.from({ length: levels - lane.results.length }, (_, i) => lane.results.length + i) : [];
  return { seed, results: lane.results, notFlown, stoppedBy, decisions };
}

/** The menu autopilot as a lane: no model, no network, one bar for its pick. */
export const autopilotClient: DecisionClient = {
  id: "autopilot",
  label: "Autopilot",
  kind: "no model",
  note: "Hand-written reference pilot on the same menu. It rehearses one second of a simple controller and picks the nearest manoeuvre.",
  model: null,
  decide: ({ lane }) => ({ ok: true, decision: { pick: autopilot(lane.level, lane.lander), probs: null, latencyMs: 0, usage: null } }),
};
