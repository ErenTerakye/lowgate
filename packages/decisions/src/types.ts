import type { LaneState } from "@lowgate/engine";

/** Tokens as reported by the provider for one call. */
export interface Usage {
  readonly inputTokens: number;
  /** Null when the provider left the output count out, so a missing count is never read as 0. */
  readonly outputTokens: number | null;
}

export type DecisionErrorKind =
  /** Our own deadline for the HTTP call ran out. */
  | "timeout"
  /** Provider says credit or a daily allowance is used up. */
  | "quota"
  | "rate_limited"
  | "auth"
  /** The proxy has no key for this lane (e.g. TYPESAFE_API_KEY unset). */
  | "not_configured"
  /** Provider answered, but not with something we can turn into a manoeuvre. */
  | "bad_response"
  | "http"
  | "network"
  | "aborted";

export interface DecisionError {
  readonly kind: DecisionErrorKind;
  readonly message: string;
  readonly status?: number;
}

/** Errors after which retrying cannot help: the lane stops, and its remaining levels are not flown. */
export const FATAL_ERRORS: ReadonlySet<DecisionErrorKind> = new Set(["quota", "auth", "not_configured"]);

export interface Decision {
  /** Index into MANOEUVRES. */
  readonly pick: number;
  /**
   * The model's probability for every manoeuvre, in menu order. Null for
   * lanes that only pick (chat models, the autopilot): their bar is the pick.
   */
  readonly probs: readonly number[] | null;
  /** Wall time from sending the request to having a parsed answer, measured by us. */
  readonly latencyMs: number;
  /** Provider-side time when the transport reports it (e.g. the Worker's x-upstream-ms). */
  readonly upstreamMs?: number;
  readonly usage: Usage | null;
  /** Model id the provider says it served; compared against the pin. */
  readonly servedModel?: string;
}

export type DecisionResult = { readonly ok: true; readonly decision: Decision } | { readonly ok: false; readonly error: DecisionError; readonly latencyMs: number };

/**
 * Where a lane's price comes from. Every number on screen carries one of
 * these: the vendor's own pages, someone else's report we could not confirm,
 * our own billing, or free.
 */
export type PriceSource = "vendor" | "third_party" | "measured" | "none";

/**
 * What the same model costs on a hosted API, for a lane that runs locally.
 * Shown beside the lane's own cost, never in place of it: the benchmark did
 * not pay it, and the hosted build may differ (precision, quantization).
 */
export interface HostedPrice {
  readonly provider: string;
  /** The hosted model id the price is for. */
  readonly model: string;
  /** USD per million tokens. */
  readonly input: number;
  readonly output: number;
  readonly source: PriceSource;
  /** Date the price page was read, YYYY-MM-DD. */
  readonly checked: string;
  readonly url: string;
}

export interface ModelInfo {
  /** e.g. "TypeSafe", "Cloudflare Workers AI", "local". */
  readonly provider: string;
  /** Exact model id sent to the provider. */
  readonly model: string;
  /** False when the id is an alias such as "jev-latest" that can move under us. */
  readonly pinned: boolean;
  /** USD per million tokens. */
  readonly price: { readonly input: number; readonly output: number; readonly source: PriceSource };
}

export interface DecisionRequest {
  /** The state at a decision boundary; the answer is held for the next second. */
  readonly lane: LaneState;
  readonly signal: AbortSignal;
}

/**
 * Anything that can fly a lane: the autopilot or a model behind HTTP. The
 * game waits for every answer (see runner.ts), so a slow client flies the
 * same course as a fast one.
 */
export interface DecisionClient {
  readonly id: string;
  readonly label: string;
  /** Short tag shown on the lane, e.g. "no model", "model · m2". */
  readonly kind: string;
  /** One line explaining how to read this lane. */
  readonly note: string;
  readonly model: ModelInfo | null;
  decide(request: DecisionRequest): DecisionResult | PromiseLike<DecisionResult>;
  dispose?(): void;
}
