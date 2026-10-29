import { describe, expect, it } from "vitest";
import { MAX_TILT_DEG, cosDeg, createRng, deriveSeed, sinDeg } from "../src/index.ts";

describe("createRng", () => {
  it("is reproducible for a seed", () => {
    const a = createRng(123);
    const b = createRng(123);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds and stays in range", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
    for (let i = 0; i < 1000; i++) {
      const v = a.int(3, 5);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
      const r = a.range(-2, 2);
      expect(r).toBeGreaterThanOrEqual(-2);
      expect(r).toBeLessThan(2);
    }
  });

  it("derives distinct sub-seeds", () => {
    const seeds = new Set(Array.from({ length: 100 }, (_, i) => deriveSeed(7, i)));
    expect(seeds.size).toBe(100);
  });
});

describe("deterministic trig", () => {
  it("matches Math.sin/cos to ~1e-12 across the tilt range", () => {
    for (let d = -MAX_TILT_DEG; d <= MAX_TILT_DEG; d += 0.5) {
      const rad = (d * Math.PI) / 180;
      expect(sinDeg(d)).toBeCloseTo(Math.sin(rad), 12);
      expect(cosDeg(d)).toBeCloseTo(Math.cos(rad), 12);
    }
  });

  it("rejects angles outside the table", () => {
    expect(() => sinDeg(MAX_TILT_DEG + 1)).toThrow(RangeError);
  });
});
