import { describe, expect, it } from "vitest";
import {
  COURSE_LEVELS,
  ENGINE_VERSION,
  MANOEUVRES,
  STEPS_PER_DECISION,
  autopilot,
  createLane,
  decisionInLevel,
  flyDecision,
  needsDecision,
  nextLevel,
  stateHash,
  stepLane,
  summarize,
  type LaneState,
  type Manoeuvre,
} from "../src/index.ts";

const FREE_FALL: Manoeuvre = { tilt: 0, throttle: 0 };

/** Fly a whole course with the autopilot, one manoeuvre per decision, as the arena will. */
function runAutopilot(seed: number): { lane: LaneState; hashes: string[]; picks: number[] } {
  let lane = createLane(seed);
  const hashes: string[] = [];
  const picks: number[] = [];
  while (!lane.finished) {
    if (lane.outcome !== null) lane = nextLevel(lane);
    expect(needsDecision(lane)).toBe(true);
    hashes.push(stateHash(lane));
    const i = autopilot(lane.level, lane.lander);
    picks.push(i);
    lane = flyDecision(lane, MANOEUVRES[i]!);
  }
  return { lane, hashes, picks };
}

describe("lane", () => {
  it("is deterministic: identical runs give identical hash streams", () => {
    const a = runAutopilot(42);
    const b = runAutopilot(42);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.lane.results).toEqual(b.lane.results);
  });

  it("matches the golden run for this engine version", () => {
    // If this fails you changed the simulation: bump ENGINE_VERSION and update.
    const { lane, hashes } = runAutopilot(42);
    expect(ENGINE_VERSION).toBe("descent-3");
    const s = summarize(lane.results);
    expect({ landed: s.landed, quality: s.meanQuality?.toFixed(3), last: hashes.at(-1), count: hashes.length }).toMatchInlineSnapshot(`
      {
        "count": 275,
        "landed": 8,
        "last": "7d34dc75",
        "quality": "41.675",
      }
    `);
  });

  it("flies a decision for exactly one second", () => {
    const lane = flyDecision(createLane(3), { tilt: 15, throttle: 2 });
    expect(lane.lander.t).toBe(STEPS_PER_DECISION);
    expect(lane.step).toBe(STEPS_PER_DECISION);
    expect(decisionInLevel(lane)).toBe(1);
    expect(needsDecision(lane)).toBe(true);
  });

  it("steers toward the manoeuvre's tilt at the rotation limit and holds it there", () => {
    let lane = createLane(3);
    lane = stepLane(lane, { tilt: 15, throttle: 2 });
    expect(lane.lander.angle).toBe(0.5);
    lane = flyDecision(lane, { tilt: 15, throttle: 2 });
    expect(lane.lander.angle).toBe(15);
    lane = flyDecision(lane, { tilt: -5, throttle: 2 });
    expect(lane.lander.angle).toBe(-5);
  });

  it("stops on an outcome until nextLevel, then starts the next level", () => {
    let lane = createLane(5);
    while (lane.outcome === null) lane = flyDecision(lane, FREE_FALL);
    expect(lane.results).toHaveLength(1);
    expect(lane.results[0]!.outcome).not.toBe("landed");
    expect(lane.results[0]!.landing).toBeNull();
    expect(needsDecision(lane)).toBe(false);
    expect(stepLane(lane, FREE_FALL)).toBe(lane);
    const next = nextLevel(lane);
    expect(next.level.index).toBe(1);
    expect(next.lander).toEqual(next.level.start);
    expect(next.step).toBe(lane.step);
    expect(needsDecision(next)).toBe(true);
    expect(nextLevel(next)).toBe(next);
  });

  it("finishes after every level of the course, crashed or not", () => {
    let lane = createLane(9);
    while (!lane.finished) {
      lane = nextLevel(lane);
      lane = flyDecision(lane, FREE_FALL);
    }
    expect(lane.results.map((r) => r.index)).toEqual([...Array(COURSE_LEVELS).keys()]);
    expect(nextLevel(lane)).toBe(lane);
    expect(needsDecision(lane)).toBe(false);
  });
});

describe("autopilot (game balance guard)", () => {
  it("lands at least 90% of levels across courses", () => {
    const results = Array.from({ length: 8 }, (_, i) => runAutopilot(i + 1).lane.results).flat();
    expect(summarize(results).landingRate).toBeGreaterThanOrEqual(0.9);
  });

  it("returns a menu index", () => {
    const lane = createLane(1);
    const i = autopilot(lane.level, lane.lander);
    expect(Number.isInteger(i) && i >= 0 && i < MANOEUVRES.length).toBe(true);
  });
});
