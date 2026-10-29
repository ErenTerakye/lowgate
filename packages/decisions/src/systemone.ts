import { THROTTLE_LEVELS } from "@arena/engine";
import { DecisionFailure, postJson, toFailure, upstreamMs, type Fetch } from "./http.ts";
import { observe, type ObservationTier } from "./observe.ts";
import { ROTATES, SYSTEM_ONE_QUESTIONS, actionFromProbs } from "./questions.ts";
import type { DecisionClient, DecisionRequest, DecisionResult, ModelInfo, Probabilities, Usage } from "./types.ts";

export interface SystemOneOptions {
  readonly id: string;
  readonly label: string;
  readonly note?: string;
  readonly model: ModelInfo;
  /**
   * Full URL of a System One endpoint: TypeSafe's API, Cloudflare's, the Laya
   * bridge on localhost, or our Worker's proxy route in the browser.
   */
  readonly endpoint: string;
  /** Only set server-side (Worker, Node scripts). The browser talks to the Worker without one. */
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  readonly tier?: ObservationTier;
  readonly timeoutMs?: number;
  readonly fetch?: Fetch;
}

/**
 * One adapter for every System One-compatible model (Jev, Clef, Kev, Laya).
 * They share the request shape, so the lanes differ only in endpoint and model.
 */
export class SystemOneClient implements DecisionClient {
  readonly id: string;
  readonly label: string;
  readonly kind = "model";
  readonly note: string;
  readonly model: ModelInfo;
  private readonly fetchImpl: Fetch;

  constructor(private readonly options: SystemOneOptions) {
    this.id = options.id;
    this.label = options.label;
    this.model = options.model;
    this.note = options.note ?? `${options.model.model} via ${options.model.provider}. Bars are the model's probabilities.`;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async decide({ lane, signal }: DecisionRequest): Promise<DecisionResult> {
    const started = performance.now();
    try {
      const { body, headers } = await postJson(
        this.fetchImpl,
        this.options.endpoint,
        { model: this.model.model, state: observe(lane, this.options.tier ?? 2), questions: SYSTEM_ONE_QUESTIONS },
        { ...this.options.headers, ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) },
        signal,
        this.options.timeoutMs ?? 2000,
      );
      const { probs, usage } = parseSystemOne(body);
      const up = upstreamMs(headers);
      return {
        ok: true,
        decision: { action: actionFromProbs(probs), probs, usage, latencyMs: performance.now() - started, ...(up ? { upstreamMs: up } : {}) },
      };
    } catch (err) {
      return { ok: false, error: toFailure(err), latencyMs: performance.now() - started };
    }
  }
}

const bad = (message: string): never => {
  throw new DecisionFailure({ kind: "bad_response", message });
};

function num(v: unknown, what: string): number {
  return typeof v === "number" && Number.isFinite(v) ? v : bad(`${what} is not a number`);
}

/**
 * Reads a System One response. Accepts Cloudflare's REST envelope
 * (`{ result: {...} }`) as well as the bare object the binding returns.
 */
export function parseSystemOne(raw: unknown): { probs: Probabilities; usage: Usage | null } {
  let body = raw as Record<string, unknown> | null;
  if (body && typeof body === "object" && "result" in body && body.result && typeof body.result === "object") {
    body = body.result as Record<string, unknown>;
  }
  const answers = (body?.answers ?? bad("response has no answers")) as Record<string, Record<string, unknown> | undefined>;

  const rot = answers.rotate?.probabilities as Record<string, unknown> | undefined;
  if (!rot) bad("rotate answer has no probabilities");
  const rotate = { left: 0, none: 0, right: 0 };
  for (const r of ROTATES) rotate[r] = num(rot?.[r] ?? 0, `rotate.${r}`);

  // Score probabilities come keyed by level index ("0".."4") or as an array.
  const thr = answers.throttle?.probabilities as Record<string, unknown> | unknown[] | undefined;
  if (!thr) bad("throttle answer has no probabilities");
  const throttle = Array.from({ length: THROTTLE_LEVELS }, (_, i) => num((thr as Record<string, unknown>)[i] ?? 0, `throttle.${i}`));
  if (throttle.every((p) => p === 0) || Object.values(rotate).every((p) => p === 0)) bad("probabilities are all zero");

  const u = body?.usage as Record<string, unknown> | undefined;
  const usage = u ? { inputTokens: num(u.input_tokens ?? 0, "usage.input_tokens"), outputTokens: num(u.output_tokens ?? 0, "usage.output_tokens") } : null;
  return { probs: { rotate, throttle }, usage };
}
