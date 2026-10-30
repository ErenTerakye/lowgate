import { describe, expect, it } from "vitest";
import {
  FUEL_CAPACITY,
  MANOEUVRES,
  MENU_TILTS,
  SAFE_VX,
  SAFE_VY,
  THROTTLE_LEVELS,
  controlFor,
  generateLevel,
  landingQuality,
  levelResult,
  manoeuvreIndex,
  summarize,
  type Lander,
  type LevelResult,
} from "../src/index.ts";

const level = { ...generateLevel(1, 0), pad: { x0: 100, x1: 140, y: 50 } };
const centre: Lander = { x: 120, y: 50, vx: 0, vy: 0, angle: 0, fuel: FUEL_CAPACITY, t: 600, throttle: 0 };

describe("manoeuvre menu", () => {
  it("crosses every tilt with every throttle level, indexed tilt-major", () => {
    expect(MANOEUVRES).toHaveLength(MENU_TILTS.length * THROTTLE_LEVELS);
    expect(MANOEUVRES[0]).toEqual({ tilt: MENU_TILTS[0], throttle: 0 });
    expect(MANOEUVRES[THROTTLE_LEVELS]).toEqual({ tilt: MENU_TILTS[1], throttle: 0 });
    MANOEUVRES.forEach((m, i) => expect(manoeuvreIndex(m)).toBe(i));
    expect(() => manoeuvreIndex({ tilt: 7, throttle: 1 })).toThrow(/menu/);
  });

  it("only uses tilts the sine table can represent", () => {
    for (const t of MENU_TILTS) expect(Number.isInteger(t * 2)).toBe(true);
  });

  it("turns toward the target tilt and holds it", () => {
    expect(controlFor({ ...centre, angle: 0 }, { tilt: 15, throttle: 3 })).toEqual({ rotate: "right", throttle: 3 });
    expect(controlFor({ ...centre, angle: 20 }, { tilt: 15, throttle: 3 })).toEqual({ rotate: "left", throttle: 3 });
    expect(controlFor({ ...centre, angle: 15 }, { tilt: 15, throttle: 0 })).toEqual({ rotate: "none", throttle: 0 });
  });
});

describe("landing quality", () => {
  it("is 100 for a dead-centre, motionless, full-tank touchdown", () => {
    expect(landingQuality(level, centre)).toBe(100);
  });

  it("gives a third each for centring, gentleness and fuel", () => {
    expect(landingQuality(level, { ...centre, x: 100 })).toBeCloseTo(66.7, 9);
    expect(landingQuality(level, { ...centre, vy: -SAFE_VY })).toBeCloseTo(66.7, 9);
    expect(landingQuality(level, { ...centre, vx: SAFE_VX / 2 })).toBeCloseTo(83.3, 9);
    expect(landingQuality(level, { ...centre, fuel: 0 })).toBeCloseTo(66.7, 9);
    expect(landingQuality(level, { ...centre, x: 100, vy: -SAFE_VY, fuel: 0 })).toBe(0);
  });

  it("records landing details only for a landing", () => {
    const landed = levelResult(level, { ...centre, x: 110, vy: -1 }, "landed");
    expect(landed).toMatchObject({ index: 0, outcome: "landed", decisions: 10, seconds: 10 });
    expect(landed.landing?.offset).toBe(10);
    expect(levelResult(level, centre, "crashed_speed").landing).toBeNull();
  });
});

describe("summarize", () => {
  const r = (quality: number | null, decisions = 30): LevelResult => ({
    index: 0,
    outcome: quality === null ? "timeout" : "landed",
    decisions,
    seconds: decisions,
    fuel: 50,
    landing: quality === null ? null : { offset: 0, vx: 0, vy: -1, quality },
  });

  it("rates landings over levels flown and averages quality over landings", () => {
    expect(summarize([r(80), r(60), r(null), r(null)])).toEqual({ levels: 4, landed: 2, landingRate: 0.5, meanQuality: 70, decisions: 120 });
  });

  it("handles no levels and no landings", () => {
    expect(summarize([])).toEqual({ levels: 0, landed: 0, landingRate: 0, meanQuality: null, decisions: 0 });
    expect(summarize([r(null)]).meanQuality).toBeNull();
  });
});
