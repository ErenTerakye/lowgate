import { createLane } from "@lowgate/engine";
import { describe, expect, it } from "vitest";
import { LlmJsonClient, OPTION_KEYS, PROMPTS, SystemOneClient, observe, optionIndex, parseLlmResponse, parseSystemOne, type Fetch, type ModelInfo } from "../src/index.ts";

const lane = createLane(42);
const signal = new AbortController().signal;
const model: ModelInfo = { provider: "test", model: "jev-1.14.0", pinned: true, price: { input: 0.042, output: 0, source: "vendor" } };

const answer = {
  model: "jev-1.14.0",
  answers: {
    manoeuvre: { type: "choice", choice: "R15-T3", confidence: 0.6, probabilities: { "UP-T2": 0.1, "R5-T3": 0.3, "R15-T3": 0.6 } },
  },
  usage: { input_tokens: 1231, output_tokens: 4 },
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
  it("reads the bare response into one probability per manoeuvre, in menu order", () => {
    const { probs, usage } = parseSystemOne(answer);
    expect(probs).toHaveLength(OPTION_KEYS.length);
    expect(probs[optionIndex("R15-T3")]).toBe(0.6);
    expect(probs[optionIndex("UP-T2")]).toBe(0.1);
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(usage).toEqual({ inputTokens: 1231, outputTokens: 4 });
  });

  it("multiplies split tilt and throttle answers back into the menu", () => {
    const split = {
      answers: {
        tilt: { probabilities: { R15: 0.75, UP: 0.25 } },
        throttle: { probabilities: [0, 0, 0.5, 0.5, 0] },
      },
    };
    const { probs } = parseSystemOne(split);
    expect(probs[optionIndex("R15-T3")]).toBeCloseTo(0.375);
    expect(probs[optionIndex("UP-T2")]).toBeCloseTo(0.125);
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(() => parseSystemOne({ answers: { tilt: split.answers.tilt, throttle: { probabilities: [1, 0] } } })).toThrow(/expected 5/);
  });

  it("reads Kev's answer shape: a score keyed by level, with extra fields beside the probabilities", () => {
    // Shape from github.com/jaredpalmer/kev's README (checked 2026-10-31), on f1's questions.
    const kev = {
      model: "jaredpalmer/kev-4b@v1.0",
      answers: {
        tilt: { type: "choice", choice: "R15", confidence: 0.4, probabilities: { R15: 0.8, UP: 0.2 } },
        throttle: { type: "score", score: 2.5, confidence: 0.3, legend: { "0": "Off" }, probabilities: { "0": 0, "1": 0, "2": 0.5, "3": 0.5, "4": 0 } },
      },
      usage: { input_tokens: 412, output_tokens: 0 },
      latency_ms: 95,
    };
    const { probs, usage, servedModel } = parseSystemOne(kev);
    expect(probs[optionIndex("R15-T3")]).toBeCloseTo(0.4);
    expect(probs[optionIndex("UP-T2")]).toBeCloseTo(0.1);
    expect(usage).toEqual({ inputTokens: 412, outputTokens: 0 });
    expect(servedModel).toBe("jaredpalmer/kev-4b@v1.0");
  });

  it("reads Cloudflare's REST envelope", () => {
    expect(parseSystemOne({ success: true, result: answer }).probs[optionIndex("R5-T3")]).toBe(0.3);
  });

  it.each([
    [{ usage: {} }, /no answers/],
    [{ answers: { rotate: { probabilities: { left: 1 } } } }, /no probabilities/],
    [{ answers: { manoeuvre: { probabilities: { "UP-T9": 1 } } } }, /not on the menu: UP-T9/],
    [{ answers: { manoeuvre: { probabilities: { "UP-T2": 0 } } } }, /all zero/],
    [{ answers: { manoeuvre: { probabilities: { "UP-T2": -1 } } } }, /not a probability/],
  ])("rejects %j", (body, message) => {
    expect(() => parseSystemOne(body)).toThrow(message);
  });
});

describe("SystemOneClient", () => {
  const client = (fetch: Fetch, timeoutMs = 2000) =>
    new SystemOneClient({ id: "jev", label: "Jev", model, endpoint: "https://api.example/v1/systemone", apiKey: "k", prompt: "m2", fetch, timeoutMs });

  it("sends the pinned model, the observation and the menu question, and flies the most likely option", async () => {
    const log: Sent[] = [];
    const r = await client(fakeFetch(() => json(answer, 200, { "x-upstream-ms": "37" }), log)).decide({ lane, signal });
    const body = JSON.parse(log[0]!.init.body as string);
    expect(body.model).toBe("jev-1.14.0");
    expect(body.state).toBe(observe(lane, PROMPTS.m2.tier));
    expect(Object.keys(body.questions)).toEqual(["manoeuvre"]);
    expect(Object.keys(body.questions.manoeuvre.criteria)).toEqual(OPTION_KEYS);
    expect((log[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(r.ok && r.decision.pick).toBe(optionIndex("R15-T3"));
    expect(r.ok && r.decision.probs).toHaveLength(OPTION_KEYS.length);
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
    const r = await client(fakeFetch(() => json(body, status))).decide({ lane, signal });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe(kind);
    expect(!r.ok && r.error.status).toBe(status);
  });

  it("times out a hung provider instead of waiting forever", async () => {
    const hang = fakeFetch(
      ({ init }) =>
        new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const r = await client(hang, 30).decide({ lane, signal });
    expect(!r.ok && r.error.kind).toBe("timeout");
  });

  it("reports a network failure", async () => {
    const r = await client(fakeFetch(() => Promise.reject(new TypeError("fetch failed")))).decide({ lane, signal });
    expect(!r.ok && r.error).toMatchObject({ kind: "network", message: "fetch failed" });
  });

  it("reports a malformed body as bad_response", async () => {
    const r = await client(fakeFetch(() => json({ answers: { manoeuvre: {} } }))).decide({ lane, signal });
    expect(!r.ok && r.error.kind).toBe("bad_response");
  });
});

describe("LlmJsonClient", () => {
  const completion = (content: string) => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 310, completion_tokens: 12 } });

  it("parses an OpenAI-style completion with measured usage", async () => {
    const log: Sent[] = [];
    const llm = new LlmJsonClient({ id: "qwen", label: "Qwen", model, prompt: "c1", endpoint: "https://x/chat", fetch: fakeFetch(() => json(completion('{"manoeuvre":"L5-T3"}')), log) });
    const r = await llm.decide({ lane, signal });
    expect(r.ok && r.decision).toMatchObject({ pick: optionIndex("L5-T3"), probs: null, usage: { inputTokens: 310, outputTokens: 12 } });
    const body = JSON.parse(log[0]!.init.body as string);
    expect(body.response_format.json_schema.schema.properties.manoeuvre.enum).toEqual(OPTION_KEYS);
  });

  it("tolerates prose around the JSON and a key in the wrong case", () => {
    expect(parseLlmResponse(completion('Sure! {"manoeuvre": " up-t2 "} Good luck.')).pick).toBe(optionIndex("UP-T2"));
  });

  it("reads Workers AI's native shape", () => {
    expect(parseLlmResponse({ result: { response: { manoeuvre: "R30-T4" } } }).pick).toBe(OPTION_KEYS.length - 1);
  });

  it("reads the reply from reasoning_content when content is empty (Qwen3 with thinking off)", () => {
    const body = { choices: [{ message: { content: null, reasoning_content: '{"tilt":"-3.2","vertical":"about right","manoeuvre":"UP-T2"}' } }] };
    expect(parseLlmResponse(body).pick).toBe(optionIndex("UP-T2"));
  });

  it.each([
    ['{"manoeuvre":"UP-T7"}', /menu key/],
    ['{"rotate":"left","throttle":3}', /menu key/],
    ["I would go upright", /no JSON/],
  ])("rejects %s", (content, message) => {
    expect(() => parseLlmResponse(completion(content))).toThrow(message);
  });
});

describe("pin check", () => {
  it("reports the model the provider served", () => {
    expect(parseSystemOne(answer).servedModel).toBe("jev-1.14.0");
  });
});
