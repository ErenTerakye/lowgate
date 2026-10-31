import { DEFAULT_TIMEOUT_MS, DecisionFailure, postJson, toFailure, upstreamMs, type Fetch } from "./http.ts";
import { MENU_TILTS, THROTTLE_LEVELS } from "@lowgate/engine";
import { OPTION_KEYS, TILT_KEYS, argmax } from "./menu.ts";
import { DEFAULT_PROMPT, PROMPTS, observePrompt, type PromptId } from "./questions.ts";
import type { DecisionClient, DecisionRequest, DecisionResult, ModelInfo, Usage } from "./types.ts";

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
  /** Observation tier and question wording; see PROMPTS. */
  readonly prompt?: PromptId;
  /** Talking to our proxy, which picks the questions from the prompt id. */
  readonly viaProxy?: boolean;
  readonly timeoutMs?: number;
  readonly fetch?: Fetch;
}

/**
 * One adapter for every System One-compatible model (Jev, Clef, Kev, Laya).
 * They share the request shape, so the lanes differ only in endpoint and model.
 * The lane flies the most likely manoeuvre; the probabilities become its bars.
 */
export class SystemOneClient implements DecisionClient {
  readonly id: string;
  readonly label: string;
  /** Shows the prompt, since results depend on it. */
  readonly kind: string;
  readonly note: string;
  readonly model: ModelInfo;
  private readonly fetchImpl: Fetch;
  private readonly options: SystemOneOptions;

  constructor(options: SystemOneOptions) {
    this.options = options;
    this.id = options.id;
    this.label = options.label;
    this.model = options.model;
    const spec = PROMPTS[options.prompt ?? DEFAULT_PROMPT];
    this.kind = `model · ${spec.id}`;
    this.note = options.note ?? `${options.model.model} via ${options.model.provider}, prompt ${spec.id} (observation tier ${spec.tier}). Bars are the model's probabilities over the menu.`;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async decide({ lane, signal }: DecisionRequest): Promise<DecisionResult> {
    const started = performance.now();
    const spec = PROMPTS[this.options.prompt ?? DEFAULT_PROMPT];
    try {
      const { body, headers } = await postJson(
        this.fetchImpl,
        this.options.endpoint,
        {
          model: this.model.model,
          state: observePrompt(lane, spec),
          questions: spec.questions,
          ...(this.options.viaProxy ? { prompt: spec.id } : {}),
        },
        { ...this.options.headers, ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) },
        signal,
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      const { probs, usage, servedModel } = parseSystemOne(body);
      const up = upstreamMs(headers);
      return {
        ok: true,
        decision: {
          pick: argmax(probs),
          probs,
          usage,
          latencyMs: performance.now() - started,
          ...(up ? { upstreamMs: up } : {}),
          ...(servedModel ? { servedModel } : {}),
        },
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
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : bad(`${what} is not a probability`);
}

/** One probability per key; a key the model left out gets 0, one not asked about is an error. */
function probsFor(answer: Record<string, unknown> | undefined, keys: readonly string[], what: string): number[] {
  const given = answer?.probabilities;
  if (!given || typeof given !== "object") bad(`${what} answer has no probabilities`);
  if (Array.isArray(given)) {
    // Score answers can come back as an array in level order.
    if (given.length !== keys.length) bad(`${what} answer has ${given.length} probabilities, expected ${keys.length}`);
    return given.map((p, i) => num(p, `${what}.${i}`));
  }
  const byKey = given as Record<string, unknown>;
  const unknown = Object.keys(byKey).filter((k) => !keys.includes(k));
  if (unknown.length) bad(`${what} answer has options not on the menu: ${unknown.slice(0, 3).join(", ")}`);
  const probs = keys.map((k) => num(byKey[k] ?? 0, `${what}.${k}`));
  if (probs.every((p) => p === 0)) bad(`${what} probabilities are all zero`);
  return probs;
}

const normalize = (ps: number[]): number[] => {
  const sum = ps.reduce((a, b) => a + b, 0);
  return ps.map((p) => p / sum);
};

const LEVEL_KEYS = Array.from({ length: THROTTLE_LEVELS }, (_, i) => String(i));

/**
 * Reads a System One response into one probability per manoeuvre, in menu
 * order. Accepts Cloudflare's REST envelope (`{ result: {...} }`) as well as
 * the bare object the binding returns. For split prompts (tilt and throttle
 * asked apart) each manoeuvre gets P(tilt) × P(throttle), so the most likely
 * manoeuvre is the most likely tilt with the most likely throttle.
 */
export function parseSystemOne(raw: unknown): { probs: number[]; usage: Usage | null; servedModel?: string } {
  let body = raw as Record<string, unknown> | null;
  if (body && typeof body === "object" && "result" in body && body.result && typeof body.result === "object") {
    body = body.result as Record<string, unknown>;
  }
  const answers = (body?.answers ?? bad("response has no answers")) as Record<string, Record<string, unknown> | undefined>;
  let probs: number[];
  if (answers.manoeuvre || !answers.tilt) {
    probs = probsFor(answers.manoeuvre, OPTION_KEYS, "manoeuvre");
  } else {
    const tilt = normalize(probsFor(answers.tilt, TILT_KEYS, "tilt"));
    const throttle = normalize(probsFor(answers.throttle, LEVEL_KEYS, "throttle"));
    probs = MENU_TILTS.flatMap((_, t) => throttle.map((p) => tilt[t]! * p));
  }

  const u = body?.usage as Record<string, unknown> | undefined;
  const usage = u ? { inputTokens: num(u.input_tokens ?? 0, "usage.input_tokens"), outputTokens: u.output_tokens === undefined ? null : num(u.output_tokens, "usage.output_tokens") } : null;
  const served = typeof body?.model === "string" ? { servedModel: body.model } : {};
  return { probs, usage, ...served };
}
