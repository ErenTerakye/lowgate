import { MODEL_LANES } from "./catalog.ts";
import { DEFAULT_PROMPT, PROMPTS, isPromptId } from "./questions.ts";

/** Secrets the proxy may read. Values never leave the server. */
export type ProxyEnv = Readonly<Record<string, string | undefined>>;

/** Longest observation we forward; observe() is ~900 characters. */
const MAX_STATE_CHARS = 2000;
const UPSTREAM_TIMEOUT_MS = 5000;

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

/**
 * POST /api/decide/:lane. The browser sends `{ state, prompt? }`, where
 * prompt is an id from PROMPTS; the proxy adds
 * the key, the pinned model and the fixed questions, so the endpoint cannot
 * be used as a general-purpose relay for someone's key. Runs unchanged in
 * the Vite dev server and in the Cloudflare Worker (standard Request and
 * Response). Adds `x-upstream-ms`: time spent waiting on the provider.
 */
export async function handleDecide(request: Request, laneId: string, env: ProxyEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const lane = MODEL_LANES[laneId];
  if (!lane) return reply(404, { detail: `Unknown lane "${laneId}"` });
  if (request.method !== "POST") return reply(405, { detail: "Use POST" }, { allow: "POST" });
  if (lane.protocol !== "systemone") return reply(501, { detail: `Lane "${laneId}" is not served by this proxy yet` });

  const key = env[lane.keyEnv];
  if (!key) return reply(501, { detail: `${lane.keyEnv} is not set on the server` });

  let state: unknown;
  let prompt: unknown;
  try {
    ({ state, prompt = DEFAULT_PROMPT } = (await request.json()) as { state?: unknown; prompt?: unknown });
  } catch {
    return reply(400, { detail: "Body must be JSON" });
  }
  if (typeof state !== "string" || state.length === 0 || state.length > MAX_STATE_CHARS) {
    return reply(400, { detail: `state must be a string of 1 to ${MAX_STATE_CHARS} characters` });
  }
  if (!isPromptId(prompt)) return reply(400, { detail: `Unknown prompt. Known: ${Object.keys(PROMPTS).join(", ")}` });

  const started = Date.now();
  let upstream: Response;
  try {
    upstream = await fetchImpl(lane.upstream, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: lane.model.model, state, questions: PROMPTS[prompt].questions }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return reply(timedOut ? 504 : 502, { detail: timedOut ? `${lane.model.provider} did not answer in ${UPSTREAM_TIMEOUT_MS} ms` : `Could not reach ${lane.model.provider}` });
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
