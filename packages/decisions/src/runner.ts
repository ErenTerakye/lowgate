import { IDLE, type Action, type LaneState } from "@arena/engine";
import { FATAL_ERRORS, type DecisionClient, type DecisionError, type DecisionResult, type Probabilities, type Usage } from "./types.ts";

/**
 * idle: not asked yet · ok: last answer arrived · retrying: last call failed,
 * holding the last action · stopped: a fatal error (quota, auth), engine off.
 */
export type LaneStatus = "idle" | "ok" | "retrying" | "stopped";

/** One finished call, as it will be logged and replayed. */
export interface CallRecord {
  /** Tick whose state the call was asked about. */
  readonly askedTick: number;
  /** Tick the answer took effect (or the error was noticed). */
  readonly appliedTick: number;
  readonly latencyMs: number;
  readonly upstreamMs?: number;
  readonly action: Action;
  readonly probs: Probabilities | null;
  readonly usage: Usage | null;
  readonly error?: DecisionError;
  /** The level ended before the answer arrived, so it was not flown. */
  readonly stale?: true;
}

export interface RunnerOptions {
  /** Called once per finished call, for logs and replays. */
  readonly onCall?: (record: CallRecord) => void;
  /** Most ticks to wait before retrying after repeated errors. */
  readonly maxBackoffTicks?: number;
}

interface Pending {
  readonly tick: number;
  result: DecisionResult | null;
  /** Asked about a level that has since ended: logged, never flown. */
  stale: boolean;
}

const thenable = (v: unknown): v is PromiseLike<DecisionResult> => typeof (v as PromiseLike<unknown> | null)?.then === "function";

/**
 * Runs one lane's client against the decision clock. The rules, the same for
 * every lane:
 * - A synchronous answer applies on the tick it was asked.
 * - An asynchronous answer applies on the first tick after it arrives.
 * - At most one call is in flight. A tick that comes while one is still
 *   out is *missed*: the lane repeats its last action and asks nothing new.
 * - Errors never throw out of here. Transient ones back off and retry while
 *   holding the last action; fatal ones (quota, auth) stop the lane with
 *   the engine off.
 */
export class LaneRunner {
  action: Action = IDLE;
  probs: Probabilities | null = null;
  status: LaneStatus = "idle";
  lastError: DecisionError | null = null;
  /** Answers received. */
  decisions = 0;
  missed = 0;
  errors = 0;
  readonly latencies: number[] = [];
  readonly usage = { inputTokens: 0, outputTokens: 0, calls: 0 };

  private pending: Pending | null = null;
  private retryAt = 0;
  private consecutiveErrors = 0;
  private readonly abort = new AbortController();
  readonly client: DecisionClient;
  private readonly options: RunnerOptions;

  constructor(client: DecisionClient, options: RunnerOptions = {}) {
    this.client = client;
    this.options = options;
  }

  /** Call on every decision tick; returns the action to fly until the next one. */
  tick(lane: LaneState, tick: number): Action {
    if (this.pending) {
      const { result, tick: asked } = this.pending;
      if (!result) {
        this.missed++;
        return this.action;
      }
      const stale = this.pending.stale;
      this.pending = null;
      this.apply(result, asked, tick, stale);
    }
    if (this.status === "stopped" || tick < this.retryAt) return this.action;

    let out: DecisionResult | PromiseLike<DecisionResult>;
    try {
      out = this.client.decide({ lane, tick, signal: this.abort.signal });
    } catch (err) {
      out = { ok: false, latencyMs: 0, error: { kind: "bad_response", message: err instanceof Error ? err.message : String(err) } };
    }
    if (!thenable(out)) {
      this.apply(out, tick, tick);
      return this.action;
    }
    const pending: Pending = { tick, result: null, stale: false };
    this.pending = pending;
    out.then(
      (r) => (pending.result = r),
      (err: unknown) =>
        (pending.result = { ok: false, latencyMs: 0, error: { kind: "bad_response", message: err instanceof Error ? err.message : String(err) } }),
    );
    return this.action;
  }

  /**
   * A new level starts: fly it from rest. An answer still in flight keeps the
   * one in-flight slot, so the lane cannot burst, but is never flown.
   */
  newEpisode(): void {
    if (this.pending) this.pending.stale = true;
    if (this.status !== "stopped") {
      this.action = IDLE;
      this.probs = null;
    }
  }

  /** Cancels any call in flight. The client belongs to whoever made it and is left alone. */
  dispose(): void {
    this.abort.abort();
  }

  private apply(result: DecisionResult, askedTick: number, appliedTick: number, stale = false): void {
    if (result.ok) {
      const d = result.decision;
      if (!stale) {
        this.action = d.action;
        this.probs = d.probs;
      }
      this.status = "ok";
      this.lastError = null;
      this.consecutiveErrors = 0;
      this.decisions++;
      this.latencies.push(d.latencyMs);
      if (d.usage) {
        this.usage.inputTokens += d.usage.inputTokens;
        this.usage.outputTokens += d.usage.outputTokens;
        this.usage.calls++;
      }
      this.options.onCall?.({
        askedTick,
        appliedTick,
        latencyMs: d.latencyMs,
        action: d.action,
        probs: d.probs,
        usage: d.usage,
        ...(stale ? { stale: true as const } : {}),
        ...(d.upstreamMs !== undefined ? { upstreamMs: d.upstreamMs } : {}),
      });
      return;
    }
    if (result.error.kind === "aborted") return;
    this.errors++;
    this.consecutiveErrors++;
    this.lastError = result.error;
    if (FATAL_ERRORS.has(result.error.kind)) {
      this.status = "stopped";
      this.action = IDLE;
      this.probs = null;
    } else {
      this.status = "retrying";
      const backoff = Math.min(this.options.maxBackoffTicks ?? 25, 2 ** (this.consecutiveErrors - 1));
      this.retryAt = appliedTick + backoff;
    }
    this.options.onCall?.({ askedTick, appliedTick, latencyMs: result.latencyMs, action: this.action, probs: null, usage: null, error: result.error });
  }
}

/** Nearest-rank percentile of measured latencies; null before any were measured. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? null;
}
