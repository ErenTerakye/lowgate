import { MANOEUVRES, MENU_TILTS, THROTTLE_LEVELS } from "@lowgate/engine";
import { DEFAULT_TIMEOUT_MS, DecisionFailure, postJson, toFailure, upstreamMs, type Fetch } from "./http.ts";
import { OPTION_KEYS, TILT_KEYS, TURN_RATE_DEG_S, VERTICAL_FITS, describeManoeuvre, optionIndex, tiltBandText } from "./menu.ts";
import { observe, type ObservationTier } from "./observe.ts";
import type { DecisionClient, DecisionRequest, DecisionResult, ModelInfo, Usage } from "./types.ts";

/** Same cap for every chat prompt and lane, enough for the quoting reply. Thinking is off by rule. */
export const LLM_MAX_TOKENS = 64;

const MANOEUVRE_PROPERTY = { manoeuvre: { type: "string", enum: OPTION_KEYS } };

const PICK_SCHEMA = { type: "object", properties: MANOEUVRE_PROPERTY, required: ["manoeuvre"], additionalProperties: false };

/** Quote first, then decide: the copied phrases come before the pick in the reply. */
const quoteSchema = (tilt: "string" | "number") => ({
  type: "object",
  properties: { tilt: { type: tilt }, vertical: { type: "string" }, ...MANOEUVRE_PROPERTY },
  required: ["tilt", "vertical", "manoeuvre"],
  additionalProperties: false,
});

const INTRO = [
  "You fly a lunar lander. Every second you choose one manoeuvre from the menu, and it is held for that whole second.",
  `A manoeuvre is a target tilt and a throttle. The lander turns toward the tilt at up to ${TURN_RATE_DEG_S} deg/s and holds it; throttle 0 is off and 4 is full thrust along the craft.`,
  "Goal: touch down gently and upright on the pad.",
];

const MENU_LINES = ["Menu (key: manoeuvre):", ...MANOEUVRES.map((m, i) => `${OPTION_KEYS[i]}: ${describeManoeuvre(m)}`)];

/** The menu and the reply format, as System One lanes get it in their options (prompt m1). */
const PICK_PROMPT = [...INTRO, "", ...MENU_LINES, "", 'Reply with JSON only: {"manoeuvre": "<key>"}.'].join("\n");


const QUOTE_RULES = [
  'Reply with JSON only: {"tilt": ..., "vertical": ..., "manoeuvre": ...}, in that order.',
  "- tilt: copy the number from the 'good tilt now' line.",
  "- vertical: copy the words after 'current is' from the 'safe vertical speed now' line.",
  "- manoeuvre: the key <tilt part>-T<throttle>.",
  "  Tilt part, from the good tilt:",
  ...MENU_TILTS.map((t, i) => `  ${tiltBandText(t)}: ${TILT_KEYS[i]}`),
  "  Throttle, from vertical:",
  ...Array.from({ length: THROTTLE_LEVELS }, (_, i) => `  ${VERTICAL_FITS[i]}: ${i}`),
];

/**
 * The coaching rules System One lanes get in prompt m2's options, written as
 * two lookups, and a reply that first copies the two phrases they depend on.
 * Small models follow rules better with the evidence written out (l3 in the
 * real-time arena).
 */
const QUOTE_PROMPT = [...INTRO, "", ...QUOTE_RULES, "", ...MENU_LINES].join("\n");

/** QUOTE_PROMPT without the menu listing, which the rules already spell out: half the input. */
const QUOTE_SHORT_PROMPT = [...INTRO, "", ...QUOTE_RULES].join("\n");

/** A chat prompt: observation tier plus system message. Add ids; never edit one with results. */
export interface LlmPromptSpec {
  readonly id: string;
  readonly tier: ObservationTier;
  /** Drop the observation's fixed rules; see ObserveOptions.compact. */
  readonly compact?: boolean;
  readonly system: string;
  readonly summary: string;
  readonly schema: Record<string, unknown>;
}

/** The l1–l3 prompts of the real-time arena are kept under the v0-realtime tag. */
export const LLM_PROMPTS = {
  c1: { id: "c1", tier: 4, system: PICK_PROMPT, schema: PICK_SCHEMA, summary: "Tier 4 observation, the menu and the JSON format" },
  c2: { id: "c2", tier: 4, system: QUOTE_PROMPT, schema: quoteSchema("string"), summary: "Tier 4 observation, m2's coaching rules as lookups, reply quotes the coaching first" },
  c3: {
    id: "c3",
    tier: 4,
    compact: true,
    system: QUOTE_SHORT_PROMPT,
    schema: quoteSchema("number"),
    summary: "c2 without the menu listing or the observation's fixed rules; the quoted tilt must be a number",
  },
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
    max_tokens: LLM_MAX_TOKENS,
    response_format: { type: "json_schema", json_schema: { name: "manoeuvre", schema: spec.schema } },
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
 * A chat model on the same menu, asked for a JSON object naming the option.
 * Chat models return a pick, not probabilities, so the lane shows one bar.
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
    this.kind = `LLM · ${spec.id}`;
    this.note = options.note ?? `${options.model.model} via ${options.model.provider}, prompt ${spec.id} (observation tier ${spec.tier}), asked to name a manoeuvre in JSON. Chat models give a pick, not probabilities, so the lane shows one bar.`;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async decide({ lane, signal }: DecisionRequest): Promise<DecisionResult> {
    const started = performance.now();
    try {
      const { prompt } = this.options;
      const spec: LlmPromptSpec = LLM_PROMPTS[prompt];
      const state = observe(lane, spec.tier, { compact: spec.compact ?? false });
      const { body, headers } = await postJson(
        this.fetchImpl,
        this.options.endpoint,
        this.options.viaProxy ? { state, prompt } : chatRequest(this.model.model, state, prompt, this.options.requestExtras),
        { ...this.options.headers, ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) },
        signal,
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      const { pick, usage, servedModel } = parseLlmResponse(body);
      const up = upstreamMs(headers);
      return {
        ok: true,
        decision: { pick, probs: null, usage, latencyMs: performance.now() - started, ...(up ? { upstreamMs: up } : {}), ...(servedModel ? { servedModel } : {}) },
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
 * Reads the picked manoeuvre from an OpenAI-style completion, or from
 * Workers AI's native `{ response }` shape (bare or in the REST `{ result }`
 * envelope). Tolerates prose around the JSON, since small models add it anyway.
 */
export function parseLlmResponse(raw: unknown): { pick: number; usage: Usage | null; servedModel?: string } {
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
  const key = ((parsed ?? {}) as Record<string, unknown>).manoeuvre;
  const pick = typeof key === "string" ? optionIndex(key) : -1;
  if (pick < 0) bad(`manoeuvre must be a menu key such as UP-T2, got ${JSON.stringify(key)}`);

  const u = body.usage as Record<string, unknown> | undefined;
  const usage =
    u && typeof u.prompt_tokens === "number"
      ? { inputTokens: u.prompt_tokens, outputTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : null }
      : null;
  const served = typeof body.model === "string" ? { servedModel: body.model } : {};
  return { pick, usage, ...served };
}
