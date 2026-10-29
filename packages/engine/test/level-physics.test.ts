import { describe, expect, it } from "vitest";
import {
  DT,
  FUEL_CAPACITY,
  GRAVITY,
  IDLE,
  MAX_TILT_DEG,
  SAFE_VY,
  TERRAIN_POINTS,
  WORLD_WIDTH,
  generateLevel,
  stepLander,
  terrainHeightAt,
  type Lander,
  type Level,
} from "../src/index.ts";

function flatLevel(): Level {
  return {
    ...generateLevel(1, 0),
    terrain: Array.from({ length: TERRAIN_POINTS }, () => 50),
    pad: { x0: 100, x1: 140, y: 50 },
    wind: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

const hovering: Lander = { x: 120, y: 50.01, vx: 0, vy: -1, angle: 0, fuel: FUEL_CAPACITY, t: 0, throttle: 0 };

describe("generateLevel", () => {
  it("is a pure function of (seed, index)", () => {
    expect(generateLevel(42, 3)).toEqual(generateLevel(42, 3));
    expect(generateLevel(42, 3)).not.toEqual(generateLevel(42, 4));
    expect(generateLevel(42, 3)).not.toEqual(generateLevel(43, 3));
  });

  it("produces a flat pad inside the world, away from the start", () => {
    for (let seed = 1; seed <= 50; seed++) {
      for (let index = 0; index < 10; index++) {
        const level = generateLevel(seed, index);
        const { pad, start } = level;
        expect(pad.x0).toBeGreaterThan(0);
        expect(pad.x1).toBeLessThan(WORLD_WIDTH);
        expect(terrainHeightAt(level, pad.x0)).toBeCloseTo(pad.y, 9);
        expect(terrainHeightAt(level, (pad.x0 + pad.x1) / 2)).toBeCloseTo(pad.y, 9);
        expect(Math.abs(start.x - (pad.x0 + pad.x1) / 2)).toBeGreaterThanOrEqual(70);
        expect(start.y).toBeGreaterThan(Math.max(...level.terrain));
      }
    }
  });
});

describe("stepLander", () => {
  it("falls under gravity with the engine off", () => {
    const level = flatLevel();
    let l: Lander = { ...hovering, y: 200, vy: 0 };
    for (let i = 0; i < 60; i++) l = stepLander(level, l, IDLE).lander;
    expect(l.vy).toBeCloseTo(-GRAVITY, 9);
    expect(l.fuel).toBe(FUEL_CAPACITY);
  });

  it("burns fuel and cuts thrust when empty", () => {
    const level = flatLevel();
    const full = stepLander(level, { ...hovering, y: 200 }, { rotate: "none", throttle: 4 }).lander;
    expect(full.fuel).toBeLessThan(FUEL_CAPACITY);
    const empty = stepLander(level, { ...hovering, y: 200, fuel: 0 }, { rotate: "none", throttle: 4 }).lander;
    expect(empty.throttle).toBe(0);
    expect(empty.vy).toBeCloseTo(-1 - GRAVITY * DT, 12);
  });

  it("clamps tilt", () => {
    const level = flatLevel();
    const l = stepLander(level, { ...hovering, y: 200, angle: MAX_TILT_DEG }, { rotate: "right", throttle: 0 }).lander;
    expect(l.angle).toBe(MAX_TILT_DEG);
  });

  it.each([
    ["landed", hovering],
    ["crashed_speed", { ...hovering, vy: -(SAFE_VY + 1) }],
    ["crashed_speed", { ...hovering, vx: 3 }],
    ["crashed_tilt", { ...hovering, angle: 12 }],
    ["crashed_terrain", { ...hovering, x: 200 }],
    ["out_of_bounds", { ...hovering, x: -0.001, y: 200, vx: -1 }],
  ] as const)("classifies touchdown as %s", (expected, start) => {
    expect(stepLander(flatLevel(), start, IDLE).outcome).toBe(expected);
  });

  it("times out after the level limit", () => {
    const l = { ...hovering, y: 200, t: 45 * 60 - 1 };
    expect(stepLander(flatLevel(), l, { rotate: "none", throttle: 2 }).outcome).toBe("timeout");
  });
});
