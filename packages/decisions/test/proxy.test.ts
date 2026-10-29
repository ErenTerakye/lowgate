import { describe, expect, it } from "vitest";
import { PROMPTS, SYSTEM_ONE_QUESTIONS, handleDecide } from "../src/index.ts";

const env = { TYPESAFE_API_KEY: "secret-key" };
const post = (body: unknown) => new Request("http://x/api/decide/jev", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

function upstream(response: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("handleDecide", () => {
  it("adds the key, the pinned model and the fixed questions", async () => {
    const { calls, fetchImpl } = upstream(() => new Response('{"answers":{}}', { status: 200 }));
    // The browser's own model and questions are ignored.
    const res = await handleDecide(post({ state: "Lunar lander.", model: "jev-preview", questions: { evil: {} } }), "jev", env, fetchImpl);
    expect(res.status).toBe(200);
    expect(Number(res.headers.get("x-upstream-ms"))).toBeGreaterThanOrEqual(0);
    expect(calls[0]!.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
    const sent = JSON.parse(calls[0]!.init.body as string);
    expect(sent).toEqual({ model: "jev-1.14.0", state: "Lunar lander.", questions: SYSTEM_ONE_QUESTIONS });
  });

  it("never echoes the key back", async () => {
    const { fetchImpl } = upstream(() => new Response('{"detail":"Invalid API key"}', { status: 401 }));
    const res = await handleDecide(post({ state: "s" }), "jev", env, fetchImpl);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("secret-key");
  });

  it("answers 501 when the key is missing, so the lane stops cleanly", async () => {
    const res = await handleDecide(post({ state: "s" }), "jev", {}, upstream(() => new Response()).fetchImpl);
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ detail: "TYPESAFE_API_KEY is not set on the server" });
  });

  it.each([
    ["not json", 400],
    [{ state: 5 }, 400],
    [{ state: "x".repeat(2001) }, 400],
  ])("rejects body %j with %i", async (body, status) => {
    const { calls, fetchImpl } = upstream(() => new Response());
    expect((await handleDecide(post(body), "jev", env, fetchImpl)).status).toBe(status);
    expect(calls).toHaveLength(0);
  });

  it("rejects unknown lanes and other methods", async () => {
    const { fetchImpl } = upstream(() => new Response());
    expect((await handleDecide(post({ state: "s" }), "gpt", env, fetchImpl)).status).toBe(404);
    expect((await handleDecide(new Request("http://x", { method: "GET" }), "jev", env, fetchImpl)).status).toBe(405);
  });

  it("maps an unreachable provider to 502", async () => {
    const { fetchImpl } = upstream(() => Promise.reject(new TypeError("fetch failed")));
    expect((await handleDecide(post({ state: "s" }), "jev", env, fetchImpl)).status).toBe(502);
  });
});

describe("handleDecide prompts", () => {
  it("uses the questions of the requested prompt and rejects unknown ids", async () => {
    const { calls, fetchImpl } = upstream(() => new Response("{}"));
    await handleDecide(post({ state: "s", prompt: "p2" }), "jev", env, fetchImpl);
    expect(JSON.parse(calls[0]!.init.body as string).questions).toEqual(PROMPTS.p2.questions);
    expect((await handleDecide(post({ state: "s", prompt: "evil" }), "jev", env, fetchImpl)).status).toBe(400);
  });
});
