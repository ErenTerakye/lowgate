import { describe, expect, it } from "vitest";
import { agreementReport, topMargin, totalVariation } from "../src/index.ts";

describe("agreement between two builds", () => {
  it("measures total variation and the top-two margin", () => {
    expect(totalVariation([0.5, 0.5, 0], [0.5, 0.5, 0])).toBe(0);
    expect(totalVariation([1, 0], [0, 1])).toBe(1);
    expect(totalVariation([0.6, 0.4], [0.5, 0.5])).toBeCloseTo(0.1, 12);
    expect(topMargin([0.2, 0.5, 0.3])).toBeCloseTo(0.2, 12);
    expect(() => totalVariation([1], [0.5, 0.5])).toThrow(/length/);
  });

  it("counts same picks against the recorded one and reports the margins where they differ", () => {
    const r = agreementReport([
      { recordedPick: 0, recordedProbs: [0.7, 0.3], probs: [0.68, 0.32], latencyMs: 10 },
      { recordedPick: 0, recordedProbs: [0.51, 0.49], probs: [0.49, 0.51], latencyMs: 30 },
    ]);
    expect(r.decisions).toBe(2);
    expect(r.samePick.count).toBe(1);
    expect(r.samePick.rate).toBe(0.5);
    expect(r.distance.max).toBeCloseTo(0.02, 12);
    expect(r.recordedMarginWhenDifferent.median).toBeCloseTo(0.02, 12);
    expect(r.latencyMs.p50).toBe(10);
  });
});
