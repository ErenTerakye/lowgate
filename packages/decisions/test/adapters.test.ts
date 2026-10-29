import { createLane } from "@arena/engine";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT, LlmJsonClient, PROMPTS, SystemOneClient, observe, parseLlmResponse, parseSystemOne, type Fetch, type ModelInfo } from "../src/index.ts";

const lane = createLane(42);
const signal = new AbortController().signal;
const model: ModelInfo = { provider: "test", model: "jev-1.14.0", pinned: true, price: { input: 0.042, output: 0, source: "vendor" } };

const answer = {
  model: "jev-1.14.0",
  answers: {
    rotate: { type: "choice", choice: "right", confidence: 0.6, probabilities: { left: 0.1, none: 0.3, right: 0.6 } },
    throttle: { type: "score", score: 2.1, confidence: 0.5, probabilities: { "0": 0.05, "1": 0.1, "2": 0.5, "3": 0.3, "4": 0.05 } },
  },
  usage: { input_tokens: 231, output_tokens: 4 },
};

interface Sent {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (sent: Sent) => Response | Promise<Response>, log: Sent[] = []): Fetch {
  return (async (url: string, init: RequestInit) => {
    const sent = { url, init };
    log.push(sent);
    return respond(sent);
  }) as Fetch;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("observe", () => {
  it("is deterministic and keeps a fixed line order", () => {
    expect(observe(lane)).toBe(observe(createLane(42)));
    expect(observe(lane).split("\n")[1]).toMatch(/^position: x /);
  });

  it("adds derived hints only at tier 2", () => {
    expect(observe(lane, 1)).not.toContain("pad direction");
    expect(observe(lane, 2)).toContain("pad direction");
  });

  it("stays well under Laya's 512-token context", () => {
    // ~4 characters per token for English; a generous upper bound.
    expect(observe(lane, 2).length / 3).toBeLessThan(400);
  });
});

describe("parseSystemOne", () => {
  it("reads the bare response", () => {
    const { probs, usage } = parseSystemOne(answer);
    expect(probs.rotate.right).toBe(0.6);
    expect(probs.throttle).toEqual([0.05, 0.1, 0.5, 0.3, 0.05]);
    expect(usage).toEqual({ inputTokens: 231, outputTokens: 4 });
  });

  it("reads Cloudflare's REST envelope and array probabilities", () => {
    const wrapped = { success: true, result: { ...answer, answers: { ...answer.answers, throttle: { probabilities: [0, 0, 0, 1, 0] } } } };
    expect(parseSystemOne(wrapped).probs.throttle).toEqual([0, 0, 0, 1, 0]);
  });

  it("rejects responses without answers", () => {
    expect(() => parseSystemOne({ usage: {} })).toThrow(/no answers/);
  });
});

describe("SystemOneClient", () => {
  const client = (fetch: Fetch, timeoutMs = 2000) =>
    new SystemOneClient({ id: "jev", label: "Jev", model, endpoint: "https://api.example/v1/systemone", apiKey: "k", fetch, timeoutMs });

  it("sends the pinned model, the observation and both questions", async () => {
    const log: Sent[] = [];
    const r = await client(fakeFetch(() => json(answer, 200, { "x-upstream-ms": "37" }), log)).decide({ lane, tick: 0, signal });
    const body = JSON.parse(log[0]!.init.body as string);
    expect(body.model).toBe("jev-1.14.0");
    expect(body.state).toBe(observe(lane, PROMPTS[DEFAULT_PROMPT].tier));
    expect(Object.keys(body.questions)).toEqual(["rotate", "throttle"]);
    expect((log[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(r.ok && r.decision.action).toEqual({ rotate: "right", throttle: 2 });
    expect(r.ok && r.decision.upstreamMs).toBe(37);
    expect(r.ok && r.decision.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it.each([
    [429, { detail: "Too many requests" }, "rate_limited"],
    [402, { detail: "Payment required" }, "quota"],
    [429, { errors: [{ message: "you have used up your daily free allocation of 10,000 neurons" }] }, "quota"],
    [401, { detail: "Invalid API key" }, "auth"],
    [422, { detail: [{ loc: ["body", "state"], msg: "field required" }] }, "http"],
    [500, "upstream exploded", "http"],
  ])("maps HTTP %i to %s", async (status, body, kind) => {
    const r = await client(fakeFetch(() => json(body, status))).decide({ lane, tick: 0, signal });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe(kind);
    expect(!r.ok && r.error.status).toBe(status);
  });

  it("times out a hung provider instead of waiting forever", async () => {
    const hang = fakeFetch(
      ({ init }) =>
        new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const r = await client(hang, 30).decide({ lane, tick: 0, signal });
    expect(!r.ok && r.error.kind).toBe("timeout");
  });

  it("reports a network failure", async () => {
    const r = await client(fakeFetch(() => Promise.reject(new TypeError("fetch failed")))).decide({ lane, tick: 0, signal });
    expect(!r.ok && r.error).toMatchObject({ kind: "network", message: "fetch failed" });
  });

  it("reports a malformed body as bad_response", async () => {
    const r = await client(fakeFetch(() => json({ answers: { rotate: {} } }))).decide({ lane, tick: 0, signal });
    expect(!r.ok && r.error.kind).toBe("bad_response");
  });
});

describe("LlmJsonClient", () => {
  const completion = (content: string) => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 310, completion_tokens: 12 } });

  it("parses an OpenAI-style completion with measured usage", async () => {
    const llm = new LlmJsonClient({ id: "llama", label: "Llama", model, prompt: "l1", endpoint: "https://x/chat", fetch: fakeFetch(() => json(completion('{"rotate":"left","throttle":3}'))) });
    const r = await llm.decide({ lane, tick: 0, signal });
    expect(r.ok && r.decision).toMatchObject({ action: { rotate: "left", throttle: 3 }, probs: null, usage: { inputTokens: 310, outputTokens: 12 } });
  });

  it("tolerates prose around the JSON and string throttles", () => {
    expect(parseLlmResponse(completion('Sure! {"rotate": "none", "throttle": "2"} Good luck.')).action).toEqual({ rotate: "none", throttle: 2 });
  });

  it("reads Workers AI's native shape", () => {
    expect(parseLlmResponse({ result: { response: { rotate: "right", throttle: 0 } } }).action).toEqual({ rotate: "right", throttle: 0 });
  });

  it("reads the reply from reasoning_content when content is empty (Qwen3 with thinking off)", () => {
    const body = { choices: [{ message: { content: null, reasoning_content: '{"tilt":"about right","vertical":"about right","rotate":"none","throttle":2}' } }] };
    expect(parseLlmResponse(body).action).toEqual({ rotate: "none", throttle: 2 });
  });

  it.each([
    ['{"rotate":"up","throttle":1}', /rotate/],
    ['{"rotate":"left","throttle":7}', /throttle/],
    ["I would rotate left", /no JSON/],
  ])("rejects %s", (content, message) => {
    expect(() => parseLlmResponse(completion(content))).toThrow(message);
  });
});

describe("pin check", () => {
  it("reports the model the provider served", () => {
    expect(parseSystemOne(answer).servedModel).toBe("jev-1.14.0");
  });
});
