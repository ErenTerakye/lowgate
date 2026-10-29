import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  IDLE,
  STEPS_PER_DECISION,
  autopilot,
  createLane,
  needsDecision,
  stateHash,
  stepLane,
  stepTick,
  type Action,
  type LaneState,
} from "../src/index.ts";

/** Run a lane to completion with the autopilot, deciding only on decision ticks. */
function runAutopilot(seed: number, seconds: number): { lane: LaneState; hashes: string[] } {
  let lane = createLane(seed, seconds);
  let action: Action = IDLE;
  const hashes: string[] = [];
  while (!lane.finished) {
    if (needsDecision(lane)) {
      hashes.push(stateHash(lane));
      action = autopilot(lane.level, lane.lander);
    }
    lane = stepLane(lane, action);
  }
  return { lane, hashes };
}

describe("lane", () => {
  it("is deterministic: identical runs give identical hash streams", () => {
    const a = runAutopilot(42, 120);
    const b = runAutopilot(42, 120);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.lane.stats).toEqual(b.lane.stats);
  });

  it("matches the golden run for this engine version", () => {
    // If this fails you changed the simulation: bump ENGINE_VERSION and update.
    const { lane, hashes } = runAutopilot(42, 120);
    expect(ENGINE_VERSION).toBe("descent-1");
    expect({ stats: lane.stats, last: hashes.at(-1), count: hashes.length }).toMatchInlineSnapshot(`
      {
        "count": 577,
        "last": "ee2344ea",
        "stats": {
          "failures": 0,
          "landings": 3,
          "score": 436,
        },
      }
    `);
  });

  it("finishes exactly at the run length", () => {
    let lane = createLane(1, 2);
    while (!lane.finished) lane = stepLane(lane, IDLE);
    expect(lane.step).toBe(120);
    expect(stepLane(lane, IDLE)).toBe(lane);
  });

  it("freezes on an outcome and resumes the next level on a decision boundary", () => {
    let lane = createLane(5, 120);
    // Engine off: the lander falls and crashes.
    while (lane.outcome === null) lane = stepLane(lane, IDLE);
    expect(lane.stats.failures).toBe(1);
    expect(lane.resumeAt % STEPS_PER_DECISION).toBe(0);
    const frozen = lane.lander;
    while (lane.outcome !== null) {
      expect(needsDecision(lane)).toBe(false);
      lane = stepLane(lane, { rotate: "right", throttle: 4 });
      if (lane.outcome !== null) expect(lane.lander).toBe(frozen);
    }
    expect(lane.level.index).toBe(1);
    expect(lane.step).toBe(lane.resumeAt);
    expect(needsDecision(lane)).toBe(true);
  });

  it("stepTick advances to the next decision boundary", () => {
    const lane = stepTick(createLane(3, 60), IDLE);
    expect(lane.step).toBe(STEPS_PER_DECISION);
  });
});

describe("autopilot (game balance guard)", () => {
  it("lands at least 90% of levels across seeds", () => {
    let landings = 0;
    let failures = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { lane } = runAutopilot(seed, 300);
      landings += lane.stats.landings;
      failures += lane.stats.failures;
    }
    expect(landings / (landings + failures)).toBeGreaterThanOrEqual(0.9);
  });
});
