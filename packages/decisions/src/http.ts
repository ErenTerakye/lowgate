import type { DecisionError } from "./types.ts";

export type Fetch = typeof fetch;

export interface PostResult {
  readonly body: unknown;
  readonly headers: Headers;
}

/** Thrown inside adapters and turned into a failed DecisionResult at the edge. */
export class DecisionFailure extends Error {
  constructor(readonly error: DecisionError) {
    super(error.message);
  }
}

const QUOTA_HINT = /quota|credit|insufficient|balance|billing|daily (free )?(limit|allocation)|neurons/i;

/** Maps an HTTP failure to the error kinds the arena knows how to show. */
export function classifyHttp(status: number, message: string): DecisionError {
  const base = { status, message: `HTTP ${status}: ${message}`.slice(0, 300) };
  if (status === 401 || status === 403) return { kind: "auth", ...base };
  if (status === 402 || QUOTA_HINT.test(message)) return { kind: "quota", ...base };
  if (status === 429) return { kind: "rate_limited", ...base };
  return { kind: "http", ...base };
}

function errorText(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const detail = b.detail ?? b.error ?? b.errors ?? b.message;
    if (typeof detail === "string") return detail;
    if (detail !== undefined) return JSON.stringify(detail);
  }
  return typeof body === "string" && body ? body : fallback;
}

/**
 * POST JSON with our own deadline on top of the caller's signal, so a hung
 * provider can never hold a lane's single in-flight slot forever.
 */
export async function postJson(
  fetchImpl: Fetch,
  url: string,
  payload: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<PostResult> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([signal, timeout]),
    });
  } catch (err) {
    if (signal.aborted) throw new DecisionFailure({ kind: "aborted", message: "Request cancelled" });
    if (timeout.aborted) throw new DecisionFailure({ kind: "timeout", message: `No answer within ${timeoutMs} ms` });
    throw new DecisionFailure({ kind: "network", message: err instanceof Error ? err.message : String(err) });
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Leave non-JSON bodies as text; they only matter for error messages.
  }
  if (!res.ok) throw new DecisionFailure(classifyHttp(res.status, errorText(body, res.statusText)));
  return { body, headers: res.headers };
}

export function toFailure(err: unknown): DecisionError {
  if (err instanceof DecisionFailure) return err.error;
  return { kind: "bad_response", message: err instanceof Error ? err.message : String(err) };
}

export function upstreamMs(headers: Headers): number | undefined {
  const v = Number(headers.get("x-upstream-ms"));
  return Number.isFinite(v) && v > 0 ? v : undefined;
}
