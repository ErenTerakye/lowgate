import { describe, expect, it } from "vitest";
import { MODEL_LANES, costSummary, formatUsd, usdFor } from "../src/index.ts";

describe("cost", () => {
  it("prices input and output tokens per million", () => {
    expect(usdFor(1_000_000, 0, { input: 0.042, output: 0, source: "vendor" })).toBeCloseTo(0.042);
    expect(usdFor(1_000_000, 1_000_000, MODEL_LANES.llama!.model.price)).toBeCloseTo(0.045 + 0.384);
  });

  it("reports spend, the hourly rate at the measured pace, and cost per 1k answered calls", () => {
    // 100 Jev calls of 836 tokens in 40 s: 2.5 answers a second.
    const c = costSummary(MODEL_LANES.jev!.model, { inputTokens: 83_600, outputTokens: 0, calls: 100 }, 40)!;
    expect(c.spentUsd).toBeCloseTo(0.0035112);
    expect(c.per1kUsd).toBeCloseTo(0.035112);
    expect(c.perHourUsd).toBeCloseTo(0.0035112 * 90);
    expect(c.source).toBe("third_party");
  });

  it("gives the Kev lanes a pinned local model, Jev's prompt, and a hosted price only where one is listed", () => {
    for (const id of ["kev-0.8b", "kev-4b", "kev-9b", "kev-27b"]) {
      const lane = MODEL_LANES[id]!;
      expect(lane.protocol).toBe("systemone");
      expect(lane.prompt).toBe(MODEL_LANES.jev!.prompt);
      expect(lane.model.pinned).toBe(true);
      expect(usdFor(1_000_000, 0, lane.model.price)).toBe(0);
      expect(lane.upstream).toBe("http://127.0.0.1:8009/v1/systemone");
    }
    expect(MODEL_LANES["kev-4b"]!.hostedEquivalent?.input).toBe(0.042);
    expect(MODEL_LANES["kev-9b"]!.hostedEquivalent).toBeUndefined();
  });

  it("has no cost for lanes without a model and no per-1k figure before usage arrives", () => {
    expect(costSummary(null, { inputTokens: 0, outputTokens: 0, calls: 0 }, 10)).toBeNull();
    const c = costSummary(MODEL_LANES.jev!.model, { inputTokens: 0, outputTokens: 0, calls: 0 }, 0)!;
    expect(c.per1kUsd).toBeNull();
    expect(c.perHourUsd).toBe(0);
  });

  it.each([
    [0, "$0"],
    [0.0035112, "$0.0035"],
    [0.035112, "$0.035"],
    [0.316, "$0.32"],
    [1.239, "$1.24"],
  ])("formats %d as %s", (usd, text) => expect(formatUsd(usd)).toBe(text));
});
