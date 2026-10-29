import { DecisionFailure, postJson, toFailure, upstreamMs, type Fetch } from "./http.ts";
import { observe, type ObservationTier } from "./observe.ts";
import { isRotate, isThrottle } from "./questions.ts";
import type { DecisionClient, DecisionRequest, DecisionResult, ModelInfo, Usage } from "./types.ts";
import type { Action } from "@arena/engine";

const ACTION_PROPERTIES = { rotate: { type: "string", enum: ["left", "none", "right"] }, throttle: { type: "integer", minimum: 0, maximum: 4 } };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: ACTION_PROPERTIES,
  required: ["rotate", "throttle"],
  additionalProperties: false,
};

/** Quote first, then decide: the copied phrases come before the action in the reply. */
const QUOTE_SCHEMA = {
  type: "object",
  properties: { tilt: { type: "string" }, vertical: { type: "string" }, ...ACTION_PROPERTIES },
  required: ["tilt", "vertical", "rotate", "throttle"],
  additionalProperties: false,
};

export const LLM_SYSTEM_PROMPT = [
  "You fly a lunar lander. Every 0.2 seconds you choose one action for the next 0.2 seconds.",
  'Reply with JSON only, exactly {"rotate": "left" | "none" | "right", "throttle": 0 | 1 | 2 | 3 | 4}.',
  "rotate left decreases the angle, right increases it. throttle 0 is off and 4 is full thrust.",
  "Goal: touch down gently and upright on the pad.",
].join("\n");

/**
 * l1 plus the reading rules System One lanes get in their answer options
 * (the rotate criteria of p5 and the throttle criteria of p7), so both kinds
 * of model are given the same information.
 */
const LLM_RULES_PROMPT = [
  LLM_SYSTEM_PROMPT,
  "",
  "How to choose:",
  "- rotate: read the 'good tilt now' line. Current tilt too far right: left. Too far left: right. About right: none.",
  "- throttle: read the 'safe vertical speed now' line. Medium (2) roughly balances gravity.",
  "  More than 1.5 m/s too much upward: 0. Up to 1.5 m/s too much upward: 1. About right: 2.",
  "  Up to 3 m/s too much downward: 3. More than 3 m/s too much downward: 4.",
].join("\n");

/**
 * l2's rules, but the reply first copies the two phrases the rules depend
 * on. Small models follow rules better with the evidence written out.
 */
const LLM_QUOTE_PROMPT = [
  "You fly a lunar lander. Every 0.2 seconds you choose one action for the next 0.2 seconds.",
  "rotate left decreases the angle, right increases it. throttle 0 is off and 4 is full thrust.",
  "Goal: touch down gently and upright on the pad.",
  "",
  'Reply with JSON only: {"tilt": ..., "vertical": ..., "rotate": ..., "throttle": ...}, in that order.',
  "- tilt: copy the words after 'current tilt is' from the 'good tilt now' line.",
  "- vertical: copy the words after 'current is' from the 'safe vertical speed now' line.",
  "- rotate, from tilt: too far right: \"left\". Too far left: \"right\". About right: \"none\".",
  "- throttle, from vertical (Medium, 2, roughly balances gravity):",
  "  more than 1.5 m/s too much upward: 0. Up to 1.5 m/s too much upward: 1. About right: 2.",
  "  Up to 3 m/s too much downward: 3. More than 3 m/s too much downward: 4.",
].join("\n");

/** A chat prompt: observation tier plus system message. Add ids; never edit one with results. */
export interface LlmPromptSpec {
  readonly id: string;
  readonly tier: ObservationTier;
  readonly system: string;
  readonly summary: string;
  /** JSON schema for the reply; defaults to the bare action. */
  readonly schema?: Record<string, unknown>;
  /** Output budget; defaults to 24 tokens, enough for the bare action. */
  readonly maxTokens?: number;
}

export const LLM_PROMPTS = {
  l1: { id: "l1", tier: 4, system: LLM_SYSTEM_PROMPT, summary: "Tier 4 observation, goal and JSON format only" },
  l2: { id: "l2", tier: 4, system: LLM_RULES_PROMPT, summary: "Tier 4 observation, plus the reading rules System One lanes get" },
  l3: { id: "l3", tier: 4, system: LLM_QUOTE_PROMPT, schema: QUOTE_SCHEMA, maxTokens: 64, summary: "l2's rules, reply quotes the coaching phrases before the action" },
} as const satisfies Record<string, LlmPromptSpec>;

export type LlmPromptId = keyof typeof LLM_PROMPTS;

export function isLlmPromptId(id: unknown): id is LlmPromptId {
  return typeof id === "string" && Object.hasOwn(LLM_PROMPTS, id);
}


/**
 * The chat request for one decision. Shared by the client and the proxy, so
 * the browser only sends the observation and cannot change the prompt.
 */
export function chatRequest(model: string, state: string, prompt: LlmPromptId, extras?: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const spec: LlmPromptSpec = LLM_PROMPTS[prompt];
  return {
    ...extras,
    model,
    messages: [
      { role: "system", content: spec.system },
      { role: "user", content: state },
    ],
    temperature: 0,
    max_tokens: spec.maxTokens ?? 24,
    response_format: { type: "json_schema", json_schema: { name: "action", schema: spec.schema ?? RESPONSE_SCHEMA } },
  };
}

export interface LlmJsonOptions {
  readonly id: string;
  readonly label: string;
  readonly note?: string;
  readonly model: ModelInfo;
  /** An OpenAI-compatible chat completions URL (Workers AI, OpenRouter, a local server, or our Worker). */
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  /** Observation tier and system message; see LLM_PROMPTS. */
  readonly prompt: LlmPromptId;
  /** Extra request fields the model needs, from the lane's `requestExtras`. Ignored via the proxy, which adds them itself. */
  readonly requestExtras?: Readonly<Record<string, unknown>>;
  /** Talking to our proxy, which builds the chat request from the observation and prompt id. */
  readonly viaProxy?: boolean;
  readonly timeoutMs?: number;
  readonly fetch?: Fetch;
}

/**
 * The LLM baseline: same observation text, asked for a JSON action. LLMs
 * return a pick, not probabilities, so its bars show the pick at 100%.
 */
export class LlmJsonClient implements DecisionClient {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly note: string;
  readonly model: ModelInfo;
  private readonly fetchImpl: Fetch;
  private readonly options: LlmJsonOptions;

  constructor(options: LlmJsonOptions) {
    this.options = options;
    this.id = options.id;
    this.label = options.label;
    this.model = options.model;
    const spec = LLM_PROMPTS[options.prompt];
    this.kind = `LLM · tier ${spec.tier}`;
    this.note = options.note ?? `${options.model.model} via ${options.model.provider}, prompt ${spec.id} (observation tier ${spec.tier}), asked for a JSON action. LLMs give a pick, not probabilities, so bars show it at 100%.`;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async decide({ lane, signal }: DecisionRequest): Promise<DecisionResult> {
    const started = performance.now();
    try {
      const { prompt } = this.options;
      const state = observe(lane, LLM_PROMPTS[prompt].tier);
      const { body, headers } = await postJson(
        this.fetchImpl,
        this.options.endpoint,
        this.options.viaProxy ? { state, prompt } : chatRequest(this.model.model, state, prompt, this.options.requestExtras),
        { ...this.options.headers, ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) },
        signal,
        this.options.timeoutMs ?? 4000,
      );
      const { action, usage, servedModel } = parseLlmResponse(body);
      const up = upstreamMs(headers);
      return {
        ok: true,
        decision: { action, probs: null, usage, latencyMs: performance.now() - started, ...(up ? { upstreamMs: up } : {}), ...(servedModel ? { servedModel } : {}) },
      };
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
export function parseLlmResponse(raw: unknown): { action: Action; usage: Usage | null; servedModel?: string } {
  let body = (raw ?? {}) as Record<string, any>;
  if (body.result && typeof body.result === "object") body = body.result;
  const message = body.choices?.[0]?.message;
  // With thinking off, Workers AI's Qwen3 still files the whole reply under reasoning_content.
  const content: unknown = message?.content || message?.reasoning_content || body.response;

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
  const served = typeof body.model === "string" ? { servedModel: body.model } : {};
  return { action: { rotate: p.rotate as Action["rotate"], throttle: throttle as Action["throttle"] }, usage, ...served };
}
