import { MODEL_LANES, resolveUpstream } from "./catalog.ts";
import { LLM_PROMPTS, chatRequest, isLlmPromptId } from "./llm.ts";
import { PROMPTS, isPromptId } from "./questions.ts";

/** Secrets the proxy may read. Values never leave the server. */
export type ProxyEnv = Readonly<Record<string, string | undefined>>;

/** Longest observation we forward; observe() is ~1,100 characters. */
const MAX_STATE_CHARS = 2000;
/** The game waits for every answer; this only catches a hung provider. */
const UPSTREAM_TIMEOUT_MS = 15_000;

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

/**
 * POST /api/decide/:lane. The browser sends `{ state, prompt? }`, where
 * prompt is an id from PROMPTS; the proxy adds the key, the pinned model and
 * the fixed questions (System One) or the fixed chat prompt (LLM lanes), so
 * the endpoint cannot be used as a general-purpose relay for someone's key. Runs unchanged in
 * the Vite dev server and in the Cloudflare Worker (standard Request and
 * Response). Adds `x-upstream-ms`: time spent waiting on the provider.
 */
export async function handleDecide(request: Request, laneId: string, env: ProxyEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const lane = MODEL_LANES[laneId];
  if (!lane) return reply(404, { detail: `Unknown lane "${laneId}"` });
  if (request.method !== "POST") return reply(405, { detail: "Use POST" }, { allow: "POST" });

  const key = lane.keyEnv ? env[lane.keyEnv] : undefined;
  if (lane.keyEnv && !key) return reply(501, { detail: `${lane.keyEnv} is not set on the server` });
  const upstreamUrl = resolveUpstream(lane, env);
  if ("missing" in upstreamUrl) return reply(501, { detail: `${upstreamUrl.missing} is not set on the server` });

  let state: unknown;
  let prompt: unknown;
  try {
    ({ state, prompt = lane.prompt } = (await request.json()) as { state?: unknown; prompt?: unknown });
  } catch {
    return reply(400, { detail: "Body must be JSON" });
  }
  if (typeof state !== "string" || state.length === 0 || state.length > MAX_STATE_CHARS) {
    return reply(400, { detail: `state must be a string of 1 to ${MAX_STATE_CHARS} characters` });
  }
  let payload: unknown;
  if (lane.protocol === "systemone") {
    if (!isPromptId(prompt)) return reply(400, { detail: `Unknown prompt. Known: ${Object.keys(PROMPTS).join(", ")}` });
    payload = { model: lane.model.model, state, questions: PROMPTS[prompt].questions };
  } else {
    if (!isLlmPromptId(prompt)) return reply(400, { detail: `Unknown prompt. Known: ${Object.keys(LLM_PROMPTS).join(", ")}` });
    payload = chatRequest(lane.model.model, state, prompt, lane.requestExtras);
  }
  const started = Date.now();
  let upstream: Response;
  try {
    upstream = await fetchImpl(upstreamUrl.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    if (timedOut) return reply(504, { detail: `${lane.model.provider} did not answer in ${UPSTREAM_TIMEOUT_MS} ms` });
    // A local model that is not running is a setup step, not an outage.
    const detail = lane.keyEnv ? `Could not reach ${lane.model.provider}` : `${lane.label} is not running at ${new URL(upstreamUrl.url).host}`;
    return reply(502, { detail });
  }
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
      "x-upstream-ms": String(Date.now() - started),
    },
  });
}
