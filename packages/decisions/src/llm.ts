import { DecisionFailure, postJson, toFailure, upstreamMs, type Fetch } from "./http.ts";
import { observe, type ObservationTier } from "./observe.ts";
import { isRotate, isThrottle } from "./questions.ts";
import type { DecisionClient, DecisionRequest, DecisionResult, ModelInfo, Usage } from "./types.ts";
import type { Action } from "@arena/engine";

export const LLM_SYSTEM_PROMPT = [
  "You fly a lunar lander. Every 0.2 seconds you choose one action for the next 0.2 seconds.",
  'Reply with JSON only, exactly {"rotate": "left" | "none" | "right", "throttle": 0 | 1 | 2 | 3 | 4}.',
  "rotate left decreases the angle, right increases it. throttle 0 is off and 4 is full thrust.",
  "Goal: touch down gently and upright on the pad.",
].join("\n");

const RESPONSE_SCHEMA = {
  type: "object",
  properties: { rotate: { type: "string", enum: ["left", "none", "right"] }, throttle: { type: "integer", minimum: 0, maximum: 4 } },
  required: ["rotate", "throttle"],
  additionalProperties: false,
};

export interface LlmJsonOptions {
  readonly id: string;
  readonly label: string;
  readonly note?: string;
  readonly model: ModelInfo;
  /** An OpenAI-compatible chat completions URL (Workers AI, OpenRouter, a local server, or our Worker). */
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  readonly tier?: ObservationTier;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
  readonly fetch?: Fetch;
}

/**
 * The LLM baseline: same observation text, asked for a JSON action. LLMs
 * return a pick, not probabilities, so its bars show the pick at 100%.
 */
export class LlmJsonClient implements DecisionClient {
  readonly id: string;
  readonly label: string;
  readonly kind = "LLM";
  readonly note: string;
  readonly model: ModelInfo;
  private readonly fetchImpl: Fetch;

  constructor(private readonly options: LlmJsonOptions) {
    this.id = options.id;
    this.label = options.label;
    this.model = options.model;
    this.note = options.note ?? `${options.model.model} asked for a JSON action. LLMs give a pick, not probabilities, so bars show it at 100%.`;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async decide({ lane, signal }: DecisionRequest): Promise<DecisionResult> {
    const started = performance.now();
    try {
      const { body, headers } = await postJson(
        this.fetchImpl,
        this.options.endpoint,
        {
          model: this.model.model,
          messages: [
            { role: "system", content: LLM_SYSTEM_PROMPT },
            { role: "user", content: observe(lane, this.options.tier ?? 2) },
          ],
          temperature: 0,
          max_tokens: this.options.maxTokens ?? 24,
          response_format: { type: "json_schema", json_schema: { name: "action", schema: RESPONSE_SCHEMA } },
        },
        { ...this.options.headers, ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) },
        signal,
        this.options.timeoutMs ?? 4000,
      );
      const { action, usage } = parseLlmResponse(body);
      const up = upstreamMs(headers);
      return { ok: true, decision: { action, probs: null, usage, latencyMs: performance.now() - started, ...(up ? { upstreamMs: up } : {}) } };
    } catch (err) {
      return { ok: false, error: toFailure(err), latencyMs: performance.now() - started };
    }
  }
}

const bad = (message: string): never => {
  throw new DecisionFailure({ kind: "bad_response", message });
};

/**
 * Reads an action from an OpenAI-style completion, or from Workers AI's
 * native `{ response }` shape (bare or in the REST `{ result }` envelope).
 * Tolerates prose around the JSON, since small models add it anyway.
 */
export function parseLlmResponse(raw: unknown): { action: Action; usage: Usage | null } {
  let body = (raw ?? {}) as Record<string, any>;
  if (body.result && typeof body.result === "object") body = body.result;
  const content: unknown = body.choices?.[0]?.message?.content ?? body.response;

  let parsed: unknown = content;
  if (typeof content === "string") {
    const match = content.match(/\{[\s\S]*?\}/);
    if (!match) bad(`no JSON object in reply: ${content.slice(0, 80)}`);
    try {
      parsed = JSON.parse(match![0]);
    } catch {
      bad(`reply is not valid JSON: ${match![0].slice(0, 80)}`);
    }
  }
  const p = (parsed ?? {}) as Record<string, unknown>;
  const throttle = typeof p.throttle === "string" ? Number(p.throttle) : p.throttle;
  if (!isRotate(p.rotate)) bad(`rotate must be left, none or right, got ${JSON.stringify(p.rotate)}`);
  if (!isThrottle(throttle)) bad(`throttle must be 0 to 4, got ${JSON.stringify(p.throttle)}`);

  const u = body.usage as Record<string, unknown> | undefined;
  const usage =
    u && typeof u.prompt_tokens === "number"
      ? { inputTokens: u.prompt_tokens, outputTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : 0 }
      : null;
  return { action: { rotate: p.rotate as Action["rotate"], throttle: throttle as Action["throttle"] }, usage };
}
