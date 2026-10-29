import { ENGINE_VERSION, type LaneState } from "@arena/engine";
import { LaneRunner, type CallRecord, type RunnerOptions } from "./runner.ts";
import type { DecisionClient, DecisionResult, ModelInfo, Probabilities } from "./types.ts";

export const REPLAY_FORMAT = "decision-arena-replay";
export const REPLAY_VERSION = 1;

/** Who flew a lane, as shown on screen when the recording was made. */
export interface RecordedLane {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly note: string;
  /** Model and price as they were at recording time, so a replay's cost meter shows what the run cost then. */
  readonly model: ModelInfo | null;
  /** Every finished call, in the order the runner applied them. */
  readonly calls: readonly CallRecord[];
  /** stateHash at every decision tick the lane was asked about, in order. */
  readonly hashes: readonly string[];
  readonly final: { readonly score: number; readonly landings: number; readonly failures: number };
}

/**
 * A whole arena run. Physics is not stored: the seed and the recorded answers
 * re-simulate it exactly, and the hashes prove they did.
 */
export interface Recording {
  readonly format: typeof REPLAY_FORMAT;
  readonly version: typeof REPLAY_VERSION;
  readonly engineVersion: string;
  /** ISO time the run finished. */
  readonly recordedAt: string;
  readonly seed: number;
  readonly runSeconds: number;
  readonly lanes: readonly RecordedLane[];
}

/** Checks the shape of a parsed recording; throws with the reason it cannot be replayed. */
export function parseRecording(data: unknown): Recording {
  const r = data as Partial<Recording> | null;
  if (!r || r.format !== REPLAY_FORMAT) throw new Error("Not a Decision Arena recording");
  if (r.version !== REPLAY_VERSION) throw new Error(`Recording format v${String(r.version)}; this build reads v${REPLAY_VERSION}`);
  if (r.engineVersion !== ENGINE_VERSION) throw new Error(`Recorded on engine ${String(r.engineVersion)}; this build runs ${ENGINE_VERSION}, so it would not replay the same`);
  if (typeof r.seed !== "number" || typeof r.runSeconds !== "number" || !Array.isArray(r.lanes)) throw new Error("Recording is missing its seed, length or lanes");
  for (const lane of r.lanes) {
    if (typeof lane?.id !== "string" || !Array.isArray(lane.calls) || !Array.isArray(lane.hashes)) throw new Error("Recording has a malformed lane");
  }
  return r as Recording;
}

/** Four decimals is finer than any bar shows, and keeps the file small. */
function roundProbs(p: Probabilities | null): Probabilities | null {
  if (!p) return null;
  const r = (v: number): number => Math.round(v * 1e4) / 1e4;
  return { rotate: { left: r(p.rotate.left), none: r(p.rotate.none), right: r(p.rotate.right) }, throttle: p.throttle.map(r) };
}

/** Rounds what is only for display. Latency stays to 0.1 ms. */
export function compactCall(c: CallRecord): CallRecord {
  return { ...c, latencyMs: Math.round(c.latencyMs * 10) / 10, probs: roundProbs(c.probs) };
}

/** Never resolves: a call that was still in flight when the run ended. */
const NEVER: PromiseLike<DecisionResult> = { then: () => NEVER as never };

/**
 * Plays one recorded lane back through a real LaneRunner, so missed ticks,
 * backoff, stale answers and the cost meter come out exactly as they did
 * live. Each call is answered on the tick it was applied, never earlier.
 * Use it with ReplayRunner, which releases answers on the right tick.
 */
export class ReplayClient implements DecisionClient {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly note: string;
  readonly model: ModelInfo | null;
  private readonly byAskedTick = new Map<number, CallRecord>();
  private waiting: { readonly record: CallRecord; readonly resolve: (r: DecisionResult) => void } | null = null;

  constructor(lane: RecordedLane) {
    this.id = lane.id;
    this.label = lane.label;
    this.kind = lane.kind;
    this.note = `${lane.note} Replayed: answers, latency and cost are as recorded live.`;
    this.model = lane.model;
    for (const c of lane.calls) this.byAskedTick.set(c.askedTick, c);
  }

  decide({ tick }: { tick: number }): DecisionResult | PromiseLike<DecisionResult> {
    const record = this.byAskedTick.get(tick);
    if (!record) return NEVER;
    const result = toResult(record);
    if (record.appliedTick === tick) return result;
    // The runner calls then() straight away; the answer is handed over by release().
    return { then: (resolve) => ((this.waiting = { record, resolve: resolve as (r: DecisionResult) => void }), NEVER as never) };
  }

  /** Hands over the call in flight if it was applied on this tick. Call before the runner's tick. */
  release(tick: number): void {
    if (this.waiting && this.waiting.record.appliedTick <= tick) {
      const { record, resolve } = this.waiting;
      this.waiting = null;
      resolve(toResult(record));
    }
  }
}

function toResult(c: CallRecord): DecisionResult {
  if (c.error) return { ok: false, error: c.error, latencyMs: c.latencyMs };
  return {
    ok: true,
    decision: { action: c.action, probs: c.probs, latencyMs: c.latencyMs, usage: c.usage, ...(c.upstreamMs !== undefined ? { upstreamMs: c.upstreamMs } : {}) },
  };
}

/** A LaneRunner whose answers come from a recording, released on the tick they were applied live. */
export class ReplayRunner extends LaneRunner {
  private readonly replay: ReplayClient;

  constructor(client: ReplayClient, options: RunnerOptions = {}) {
    super(client, options);
    this.replay = client;
  }

  override tick(lane: LaneState, tick: number) {
    this.replay.release(tick);
    return super.tick(lane, tick);
  }
}

/**
 * Index of the first decision tick where a replay's state differs from the
 * recording's, or null while they agree. A finished replay must also have
 * reached exactly as many ticks.
 */
export function firstDivergence(recorded: readonly string[], replayed: readonly string[], finished: boolean): number | null {
  for (let i = 0; i < replayed.length; i++) if (replayed[i] !== recorded[i]) return i;
  if (replayed.length > recorded.length) return recorded.length;
  if (finished && replayed.length !== recorded.length) return replayed.length;
  return null;
}
