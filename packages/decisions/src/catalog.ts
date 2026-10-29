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
  /** Prompt this lane flies unless overridden; each was picked by a sweep (docs/). */
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

/** These models think before answering unless told not to; thinking costs 1 s or more, far past a 200 ms tick. */
const NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };

const WORKERS_AI = "https://api.cloudflare.com/client/v4/accounts/{account}/ai";

export const MODEL_LANES: Readonly<Record<string, ModelLane>> = {
  jev: {
    id: "jev",
    prompt: "p5",
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
    prompt: "p7",
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
    prompt: "l3",
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
    prompt: "l3",
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
    prompt: "l3",
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
    prompt: "l3",
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
  laya: {
    id: "laya",
    prompt: "p5",
    label: "Laya",
    protocol: "systemone",
    model: {
      provider: "local (MLX)",
      // Fine-tuned on autopilot labels (docs/lanes.md). The bridge reports the checkpoint it
      // loaded, so the pin check flags a run on any other one, such as the base model.
      model: "laya-descent-v1-mlx",
      pinned: true,
      price: { input: 0, output: 0, source: "none" },
    },
    upstream: "http://127.0.0.1:8765/v1/systemone",
    priceNote: "Runs on this Mac through bridge/laya: no per-token price. Fine-tuned once on a Colab A100 (21.6 min).",
  },
};

/** The upstream URL with its account filled in, or the name of the missing variable. */
export function resolveUpstream(lane: ModelLane, env: Readonly<Record<string, string | undefined>>): { url: string } | { missing: string } {
  if (!lane.accountEnv) return { url: lane.upstream };
  const account = env[lane.accountEnv];
  if (!account) return { missing: lane.accountEnv };
  return { url: lane.upstream.replace("{account}", encodeURIComponent(account)) };
}
