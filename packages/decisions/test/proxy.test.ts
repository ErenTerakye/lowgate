import { describe, expect, it } from "vitest";
import { MODEL_LANES, PROMPTS, SYSTEM_ONE_QUESTIONS, chatRequest, handleDecide, type LlmPromptId } from "../src/index.ts";

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

describe("handleDecide on Workers AI and local lanes", () => {
  const cf = { CLOUDFLARE_API_TOKEN: "cf-token", CLOUDFLARE_ACCOUNT_ID: "acct123" };
  const postTo = (lane: string, body: unknown) => new Request(`http://x/api/decide/${lane}`, { method: "POST", body: JSON.stringify(body) });

  it("sends Clef-flash the System One body at the account's URL", async () => {
    const { calls, fetchImpl } = upstream(() => new Response('{"result":{"answers":{}}}'));
    await handleDecide(postTo("clef", { state: "s", prompt: "p5" }), "clef", cf, fetchImpl);
    expect(calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/@cf/cloudflare/clef-flash");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer cf-token");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ model: "clef-flash", state: "s", questions: PROMPTS.p5.questions });
  });

  it("builds the fixed chat request for the LLM lane", async () => {
    const { calls, fetchImpl } = upstream(() => new Response("{}"));
    await handleDecide(postTo("llama", { state: "altitude: 40 m", messages: [{ role: "system", content: "evil" }] }), "llama", cf, fetchImpl);
    expect(calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1/chat/completions");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(chatRequest("@cf/meta/llama-3.1-8b-instruct-fp8-fast", "altitude: 40 m", MODEL_LANES.llama!.prompt as LlmPromptId));
  });

  it("adds the lane's request extras, such as switching thinking off", async () => {
    const { calls, fetchImpl } = upstream(() => new Response("{}"));
    await handleDecide(postTo("qwen", { state: "s" }), "qwen", cf, fetchImpl);
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ model: "@cf/qwen/qwen3-30b-a3b-fp8", chat_template_kwargs: { enable_thinking: false } });
  });

  it("defaults each lane to its own prompt and checks ids against the lane's prompt set", async () => {
    const { calls, fetchImpl } = upstream(() => new Response("{}"));
    await handleDecide(postTo("clef", { state: "s" }), "clef", cf, fetchImpl);
    expect(JSON.parse(calls[0]!.init.body as string).questions).toEqual(PROMPTS[MODEL_LANES.clef!.prompt as keyof typeof PROMPTS].questions);
    expect((await handleDecide(postTo("llama", { state: "s", prompt: "p5" }), "llama", cf, fetchImpl)).status).toBe(400);
    expect((await handleDecide(postTo("clef", { state: "s", prompt: "l1" }), "clef", cf, fetchImpl)).status).toBe(400);
  });

  it("answers 501 naming the missing account id", async () => {
    const res = await handleDecide(postTo("clef", { state: "s" }), "clef", { CLOUDFLARE_API_TOKEN: "t" }, upstream(() => new Response()).fetchImpl);
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ detail: "CLOUDFLARE_ACCOUNT_ID is not set on the server" });
  });

  it("calls the local Laya bridge without a key and says when it is not running", async () => {
    const ok = upstream(() => new Response("{}"));
    await handleDecide(postTo("laya", { state: "s" }), "laya", {}, ok.fetchImpl);
    expect(ok.calls[0]!.url).toBe("http://127.0.0.1:8765/v1/systemone");
    expect((ok.calls[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
    const down = await handleDecide(postTo("laya", { state: "s" }), "laya", {}, upstream(() => Promise.reject(new TypeError("fetch failed"))).fetchImpl);
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ detail: "Laya is not running at 127.0.0.1:8765" });
  });
});
