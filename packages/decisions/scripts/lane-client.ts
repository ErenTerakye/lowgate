/** Builds a lane's client from the catalog and the repo's .env, for probe.ts and bench.ts. */
import { createLane } from "@lowgate/engine";
import {
  LLM_PROMPTS,
  LlmJsonClient,
  MODEL_LANES,
  PROMPTS,
  SystemOneClient,
  autopilotClient,
  isLlmPromptId,
  isPromptId,
  observe,
  observePrompt,
  resolveUpstream,
  type DecisionClient,
} from "../src/index.ts";

export interface LaneClient {
  readonly client: DecisionClient;
  readonly promptId: string;
  /** Characters of prompt the model reads at the start of `seed`, or null for the autopilot. */
  readonly promptChars: (seed: number) => number | null;
}

export const LANE_IDS = ["autopilot", ...Object.keys(MODEL_LANES)];

/** True for lanes served from this machine (LM Studio, the Laya bridge). */
export function isLocalLane(id: string): boolean {
  const upstream = MODEL_LANES[id]?.upstream ?? "";
  return upstream.startsWith("http://127.0.0.1") || upstream.startsWith("http://localhost");
}

/** Throws with a message naming the missing setting rather than flying a lane that cannot answer. */
export function laneClient(id: string, options: { prompt?: string; timeoutMs?: number } = {}): LaneClient {
  if (id === "autopilot") return { client: autopilotClient, promptId: "none", promptChars: () => null };
  const lane = MODEL_LANES[id];
  if (!lane) throw new Error(`Unknown lane "${id}". Known: ${LANE_IDS.join(", ")}`);
  const promptId = options.prompt ?? lane.prompt;
  const unset = (name: string) => new Error(`${name} is not set. Add it to .env at the repo root (see .env.example).`);
  const key = lane.keyEnv ? process.env[lane.keyEnv] : undefined;
  if (lane.keyEnv && !key) throw unset(lane.keyEnv);
  // The same resolution as the proxy, so a lane flown from Node and through the dev server reaches the same URL.
  const upstream = resolveUpstream(lane, process.env);
  if ("missing" in upstream) throw unset(upstream.missing);
  const common = {
    id: lane.id,
    label: lane.label,
    model: lane.model,
    endpoint: upstream.url,
    ...(key ? { apiKey: key } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  };
  if (lane.protocol === "systemone") {
    if (!isPromptId(promptId)) throw new Error(`Unknown prompt "${promptId}" for ${lane.label}. Known: ${Object.keys(PROMPTS).join(", ")}`);
    const spec = PROMPTS[promptId];
    // The question text the model reads, without JSON punctuation.
    const chars = (seed: number) => observePrompt(createLane(seed), spec).length + JSON.stringify(spec.questions).replace(/[{}"[\],:]/g, "").length;
    return { client: new SystemOneClient({ ...common, prompt: spec.id }), promptId, promptChars: chars };
  }
  if (!isLlmPromptId(promptId)) throw new Error(`Unknown prompt "${promptId}" for ${lane.label}. Known: ${Object.keys(LLM_PROMPTS).join(", ")}`);
  const spec = LLM_PROMPTS[promptId];
  const client = new LlmJsonClient({ ...common, prompt: spec.id, ...(lane.requestExtras ? { requestExtras: lane.requestExtras } : {}) });
  return { client, promptId, promptChars: (seed) => spec.system.length + observe(createLane(seed), spec.tier).length };
}
