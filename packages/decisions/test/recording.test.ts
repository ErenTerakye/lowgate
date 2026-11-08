import { ENGINE_VERSION, MANOEUVRES } from "@lowgate/engine";
import { describe, expect, it } from "vitest";
import {
  autopilotClient,
  benchResults,
  bootstrapSum95,
  flyCourse,
  holm,
  lastFlown,
  makeRecording,
  meanSpread,
  pairedComparisons,
  percentile,
  rankLanes,
  replayRecording,
  resultsDiff,
  signTest,
  summarizeLane,
  wilson,
  type DecisionClient,
  type HostedPrice,
  type LaneResult,
  type Recording,
} from "../src/index.ts";

const noSleep = async (): Promise<void> => {};

describe("recordings", () => {
  it("replay to the same states and results, and pass a JSON round trip", async () => {
    const run = await flyCourse(autopilotClient, 42, { levels: 2 });
    const rec: Recording = JSON.parse(JSON.stringify(makeRecording(autopilotClient, "none", run)));
    const seen: number[] = [];
    expect(replayRecording(rec, (_, d) => seen.push(d.pick))).toEqual({ ok: true });
    expect(seen).toEqual(run.decisions.map((d) => d.pick));
    expect(rec.engine).toBe(ENGINE_VERSION);
  });

  it("catch a changed pick at the decision after it", async () => {
    const run = await flyCourse(autopilotClient, 42, { levels: 1 });
    const rec = makeRecording(autopilotClient, "none", run);
    const decisions = rec.decisions.map((d, i) => (i === 3 ? { ...d, pick: (d.pick + 7) % MANOEUVRES.length } : d));
    const check = replayRecording({ ...rec, decisions });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("decision 4");
  });

  it("refuse a recording from another engine version", async () => {
    const rec = makeRecording(autopilotClient, "none", await flyCourse(autopilotClient, 42, { levels: 1 }));
    expect(replayRecording({ ...rec, engine: "descent-2" }).ok).toBe(false);
  });

  it("replay a lane stopped by a fatal error, without flying the decision that stopped it", async () => {
    let calls = 0;
    const quota: DecisionClient = {
      ...autopilotClient,
      decide: (req) => (++calls > 5 ? { ok: false, error: { kind: "quota", message: "out" }, latencyMs: 1 } : autopilotClient.decide(req)),
    };
    const run = await flyCourse(quota, 42, { sleep: noSleep });
    expect(run.stoppedBy?.kind).toBe("quota");
    expect(replayRecording(makeRecording(quota, "none", run))).toEqual({ ok: true });
  });
});

describe("stats", () => {
  it("gives Wilson intervals inside 0-1, including at the ends", () => {
    expect(wilson(0, 0)).toBeNull();
    const all = wilson(160, 160)!;
    expect(all.high).toBe(1);
    expect(all.low).toBeGreaterThan(0.97);
    const half = wilson(80, 160)!;
    expect(half.low).toBeCloseTo(0.423, 3);
    expect(half.high).toBeCloseTo(0.577, 3);
  });

  it("gives the mean, sample sd and a 95% interval", () => {
    const s = meanSpread([40, 42, 44])!;
    expect(s.mean).toBe(42);
    expect(s.sd).toBe(2);
    expect(s.ci.high - s.mean).toBeCloseTo((1.959964 * 2) / Math.sqrt(3), 6);
    expect(meanSpread([])).toBeNull();
  });

  it("takes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("summarizeLane", () => {
  it("counts landings per course and ranks by landing rate, then quality", async () => {
    const recs = await Promise.all([42, 7].map(async (seed) => makeRecording(autopilotClient, "none", await flyCourse(autopilotClient, seed))));
    const r = summarizeLane(recs);
    expect(r.perCourse.map((c) => c.seed)).toEqual([7, 42]);
    expect(r.landed).toBe(r.perCourse.reduce((n, c) => n + c.landed, 0));
    expect(r.levels).toBe(16);
    expect(r.agreesWithAutopilot.exact).toBe(1);
    const worse = { ...r, lane: "worse", landingRate: r.landingRate - 0.1 };
    const sameRateBetterQuality = { ...r, lane: "better", quality: { ...r.quality!, mean: r.quality!.mean + 1 } };
    expect(rankLanes([worse, r, sameRateBetterQuality]).map((l) => l.lane)).toEqual(["better", "autopilot", "worse"]);
  });

  it("prices measured tokens at a hosted equivalent, only when given one and only for decisions with usage", async () => {
    const rec = makeRecording(autopilotClient, "none", await flyCourse(autopilotClient, 42, { levels: 1 }));
    const latencyMs = 500;
    const decisions = rec.decisions.map((d) => ({ ...d, latencyMs, usage: { inputTokens: 1_000, outputTokens: 100 } }));
    const hosted: HostedPrice = { provider: "Host", model: "m", input: 0.1, output: 0.3, source: "vendor", checked: "2026-10-30", url: "https://example.com" };
    const r = summarizeLane([{ ...rec, decisions }], { hostedEquivalent: hosted });
    expect(r.hostedEquivalentUsd?.total).toBeCloseTo((decisions.length * (1_000 * 0.1 + 100 * 0.3)) / 1e6, 12);
    expect(r.hostedEquivalentUsd?.price.provider).toBe("Host");
    expect(r.answerSecondsPerCourse).toBeCloseTo((decisions.length * latencyMs) / 1000, 9);
    expect(summarizeLane([{ ...rec, decisions }]).hostedEquivalentUsd).toBeNull();
    expect(summarizeLane([rec], { hostedEquivalent: hosted }).hostedEquivalentUsd).toBeNull();
  });
});

describe("results file", () => {
  const lane = async (seed: number, flownAt: string) => makeRecording(autopilotClient, "none", await flyCourse(autopilotClient, seed, { levels: 1 }), new Date(flownAt));

  it("is stamped with the newest recording, so a rebuild from the same recordings is identical", async () => {
    const recs = [await lane(42, "2026-10-31T08:00:00Z"), await lane(7, "2026-10-31T09:30:00Z")];
    expect(lastFlown(recs)).toBe("2026-10-31T09:30:00.000Z");
    const build = () => JSON.stringify(benchResults([7, 42], [summarizeLane(recs)], lastFlown(recs)));
    expect(build()).toBe(build());
    expect(() => lastFlown([])).toThrow();
  });

  it("names every figure that differs from a rebuild, and nothing when they match", async () => {
    const recs = [await lane(42, "2026-10-31T08:00:00Z")];
    const rebuilt = benchResults([42], [summarizeLane(recs)], lastFlown(recs));
    expect(resultsDiff(rebuilt, rebuilt)).toEqual([]);
    const [only] = rebuilt.lanes;
    const edited = { ...rebuilt, at: "2026-11-01T00:00:00.000Z", lanes: [{ ...only!, landed: only!.landed + 1 }, { ...only!, lane: "ghost" }] };
    expect(resultsDiff(edited, rebuilt)).toEqual([
      `at: file has "2026-11-01T00:00:00.000Z", recordings give "2026-10-31T08:00:00.000Z"`,
      `autopilot.landed: file has ${only!.landed + 1}, recordings give ${only!.landed}`,
      "ghost: in the file, but no recordings",
    ]);
  });
});

describe("paired comparisons", () => {
  const lane = (id: string, landed: readonly number[]): LaneResult =>
    ({ lane: id, courses: landed.length, levels: landed.length * 8, perCourse: landed.map((n, i) => ({ seed: 100 + i, landed: n })) }) as unknown as LaneResult;

  it("computes the exact two-sided sign test", () => {
    expect(signTest(0, 0)).toBe(1);
    expect(signTest(3, 0)).toBeCloseTo(0.25, 12);
    expect(signTest(14, 2)).toBeCloseTo((2 * (1 + 16 + 120)) / 2 ** 16, 12);
    expect(signTest(5, 5)).toBe(1);
  });

  it("applies Holm's adjustment and keeps it monotone", () => {
    expect(holm([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06]);
    expect(holm([])).toEqual([]);
    expect(holm([0.9, 0.9])).toEqual([1, 1]);
  });

  it("bootstraps the same interval every time, inside the possible sums", () => {
    const xs = [2, -1, 0, 3, 1];
    const a = bootstrapSum95(xs)!;
    expect(bootstrapSum95(xs)).toEqual(a);
    expect(a.low).toBeGreaterThanOrEqual(-5);
    expect(a.high).toBeLessThanOrEqual(15);
    expect(a.low).toBeLessThanOrEqual(a.high);
    expect(bootstrapSum95([])).toBeNull();
  });

  it("pairs lanes on the courses both flew", () => {
    const partial = { ...lane("c", [8]), courses: 1, levels: 8 };
    const [ab, ac, bc] = pairedComparisons([lane("a", [8, 8, 8]), lane("b", [4, 8, 6]), partial]);
    expect(ab).toMatchObject({ higher: "a", lower: "b", courses: 3, won: 2, lost: 0, tied: 1 });
    expect(ab!.difference).toBeCloseTo(6 / 24, 12);
    expect(ac).toMatchObject({ courses: 1, won: 0, lost: 0, tied: 1, p: 1 });
    expect(bc).toMatchObject({ courses: 1, won: 0, lost: 1, tied: 0, separated: false });
  });
});
