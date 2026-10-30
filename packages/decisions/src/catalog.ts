import type { LlmPromptId } from "./llm.ts";
import type { PromptId } from "./questions.ts";
import type { ModelInfo } from "./types.ts";

/**
 * Model lanes the arena knows how to call, keyed by lane id. The proxy (Vite
 * in dev, the Worker in production) uses this table to pick the upstream and
 * to force the pinned model, so a browser cannot ask for a different one.
 */
export interface ModelLane {
  readonly id: string;
  readonly label: string;
  /** System One (probabilities per option) or an OpenAI-style chat model asked for JSON. */
  readonly protocol: "systemone" | "chat";
  readonly model: ModelInfo;
  /** Prompt this lane flies unless overridden; picked by the R3 sweep (docs/lanes.md). Laya keeps m3 until R4 retrains it. */
  readonly prompt: PromptId | LlmPromptId;
  /** May contain `{account}`, filled from `accountEnv`. */
  readonly upstream: string;
  /** Environment variable holding the upstream key. Never sent to the browser. Unset for local models. */
  readonly keyEnv?: string;
  /** Environment variable holding the account id that goes into `upstream`. */
  readonly accountEnv?: string;
  /** Extra fields for chat requests, such as switching a reasoning model's thinking off. */
  readonly requestExtras?: Readonly<Record<string, unknown>>;
  /** Where the price was checked, so the README can cite it. */
  readonly priceNote: string;
}

/** These models think before answering unless told not to. The arena rules out extended thinking for every lane. */
const NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };

/** LM Studio's local server; it listens on this machine only. */
const LM_STUDIO = "http://127.0.0.1:1234";

/**
 * LM Studio ignores chat_template_kwargs for Qwen3.5 and Gemma 4 and lets them think until the output cap;
 * this request field is the one switch that turned thinking off for both (tested 2026-10-30).
 */
const LM_STUDIO_NO_THINKING = { reasoning_effort: "none" };

const WORKERS_AI = "https://api.cloudflare.com/client/v4/accounts/{account}/ai";

export const MODEL_LANES: Readonly<Record<string, ModelLane>> = {
  jev: {
    id: "jev",
    prompt: "f1",
    label: "Jev",
    protocol: "systemone",
    model: {
      provider: "TypeSafe",
      model: "jev-1.14.0",
      pinned: true,
      price: { input: 0.042, output: 0, source: "third_party" },
    },
    upstream: "https://api.typesafe.ai/v1/systemone",
    keyEnv: "TYPESAFE_API_KEY",
    priceNote:
      "TypeSafe's docs publish no price (checked 2026-10-29). $0.042/M input is from third-party reports; output tokens are free per the API docs.",
  },
  clef: {
    id: "clef",
    prompt: "f1",
    label: "Clef-flash",
    protocol: "systemone",
    model: {
      provider: "Cloudflare Workers AI",
      model: "clef-flash",
      // Cloudflare offers no version selector: "clef-flash" is whatever they serve today.
      pinned: false,
      price: { input: 0.038, output: 0, source: "vendor" },
    },
    upstream: `${WORKERS_AI}/run/@cf/cloudflare/clef-flash`,
    keyEnv: "CLOUDFLARE_API_TOKEN",
    accountEnv: "CLOUDFLARE_ACCOUNT_ID",
    priceNote:
      "Cloudflare model page (checked 2026-10-29): $0.038/M input, output free, since the 9 Oct 2026 change. First 10,000 neurons a day are free across Workers AI.",
  },
  llama: {
    id: "llama",
    prompt: "c3",
    label: "Llama 3.1 8B",
    protocol: "chat",
    model: {
      provider: "Cloudflare Workers AI",
      model: "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
      pinned: true,
      price: { input: 0.045, output: 0.384, source: "vendor" },
    },
    upstream: `${WORKERS_AI}/v1/chat/completions`,
    keyEnv: "CLOUDFLARE_API_TOKEN",
    accountEnv: "CLOUDFLARE_ACCOUNT_ID",
    priceNote: "Cloudflare Workers AI pricing page (checked 2026-10-29): $0.045/M input, $0.384/M output.",
  },
  // Tested as replacements for Llama 3.1 8B, which left Cloudflare's model catalog. Qwen3 won and is a default lane (docs/lanes.md).
  gemma: {
    id: "gemma",
    prompt: "c3",
    label: "Gemma 4 26B",
    requestExtras: NO_THINKING,
    protocol: "chat",
    model: {
      provider: "Cloudflare Workers AI",
      model: "@cf/google/gemma-4-26b-a4b-it",
      pinned: true,
      price: { input: 0.1, output: 0.3, source: "vendor" },
    },
    upstream: `${WORKERS_AI}/v1/chat/completions`,
    keyEnv: "CLOUDFLARE_API_TOKEN",
    accountEnv: "CLOUDFLARE_ACCOUNT_ID",
    priceNote: "Cloudflare Workers AI pricing page (checked 2026-10-29): $0.10/M input, $0.30/M output.",
  },
  glm: {
    id: "glm",
    prompt: "c3",
    label: "GLM 4.7 Flash",
    requestExtras: NO_THINKING,
    protocol: "chat",
    model: {
      provider: "Cloudflare Workers AI",
      model: "@cf/zai-org/glm-4.7-flash",
      pinned: true,
      price: { input: 0.06, output: 0.4, source: "vendor" },
    },
    upstream: `${WORKERS_AI}/v1/chat/completions`,
    keyEnv: "CLOUDFLARE_API_TOKEN",
    accountEnv: "CLOUDFLARE_ACCOUNT_ID",
    priceNote: "Cloudflare Workers AI pricing page (checked 2026-10-29): $0.06/M input, $0.40/M output.",
  },
  qwen: {
    id: "qwen",
    prompt: "c3",
    label: "Qwen3 30B",
    requestExtras: NO_THINKING,
    protocol: "chat",
    model: {
      provider: "Cloudflare Workers AI",
      model: "@cf/qwen/qwen3-30b-a3b-fp8",
      pinned: true,
      price: { input: 0.051, output: 0.335, source: "vendor" },
    },
    upstream: `${WORKERS_AI}/v1/chat/completions`,
    keyEnv: "CLOUDFLARE_API_TOKEN",
    accountEnv: "CLOUDFLARE_ACCOUNT_ID",
    priceNote: "Cloudflare Workers AI pricing page (checked 2026-10-29): $0.051/M input, $0.335/M output.",
  },
  // Local chat lanes through LM Studio's OpenAI-compatible server (`lms server start`), so the
  // Workers AI allowance is left for Clef-flash. LM Studio reports the model key, not a hash,
  // so the pin is the key plus the build noted here (checked with `lms ls --json`).
  "qwen-local": {
    id: "qwen-local",
    prompt: "c3",
    label: "Qwen3.5 9B",
    requestExtras: LM_STUDIO_NO_THINKING,
    protocol: "chat",
    model: {
      provider: "local (LM Studio)",
      model: "qwen/qwen3.5-9b",
      pinned: true,
      price: { input: 0, output: 0, source: "none" },
    },
    upstream: `${LM_STUDIO}/v1/chat/completions`,
    priceNote: "Runs on this Mac through LM Studio, MLX 4-bit build (5.98 GB): no per-token price.",
  },
  "gemma-local": {
    id: "gemma-local",
    prompt: "c3",
    label: "Gemma 4 12B",
    requestExtras: LM_STUDIO_NO_THINKING,
    protocol: "chat",
    model: {
      provider: "local (LM Studio)",
      model: "google/gemma-4-12b-qat",
      pinned: true,
      price: { input: 0, output: 0, source: "none" },
    },
    upstream: `${LM_STUDIO}/v1/chat/completions`,
    priceNote: "Runs on this Mac through LM Studio, GGUF Q4_0 QAT build (7.15 GB): no per-token price.",
  },
  laya: {
    id: "laya",
    prompt: "f3",
    label: "Laya",
    protocol: "systemone",
    model: {
      provider: "local (MLX)",
      // Fine-tuned on the autopilot's menu picks plus one DAgger round (R4, docs/lanes.md). The bridge reports the
      // checkpoint it loaded, so the pin check flags a run on any other one, such as v3.
      model: "laya-descent-v4-mlx",
      pinned: true,
      price: { input: 0, output: 0, source: "none" },
    },
    upstream: "http://127.0.0.1:8765/v1/systemone",
    priceNote: "Runs on this Mac through bridge/laya: no per-token price. Fine-tuned on a Colab A100: v2 on p8 in 14.9 min.",
  },
};

/** The upstream URL with its account filled in, or the name of the missing variable. */
export function resolveUpstream(lane: ModelLane, env: Readonly<Record<string, string | undefined>>): { url: string } | { missing: string } {
  if (!lane.accountEnv) return { url: lane.upstream };
  const account = env[lane.accountEnv];
  if (!account) return { missing: lane.accountEnv };
  return { url: lane.upstream.replace("{account}", encodeURIComponent(account)) };
}
