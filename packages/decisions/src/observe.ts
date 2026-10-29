import {
  FUEL_CAPACITY,
  GRAVITY,
  LEVEL_TIME_LIMIT_S,
  MAX_THRUST,
  PHYSICS_HZ,
  SAFE_TILT_DEG,
  SAFE_VX,
  SAFE_VY,
  maxTerrainBetween,
  terrainHeightAt,
  windAt,
  type LaneState,
} from "@arena/engine";

/**
 * How much of the state is pre-digested for the model:
 * 1. raw physics;
 * 2. plus the geometry a pilot would read off the screen;
 * 3. plus the safe speeds for right now (coaching, not just observation);
 * 4. plus the tilt that would correct the horizontal speed.
 * Results depend heavily on this, so replays and the results table record
 * the tier used.
 */
export type ObservationTier = 1 | 2 | 3 | 4;

export interface ObserveOptions {
  /** Drop the fixed rules (conventions, gravity, touchdown limits) that never change between calls. */
  readonly compact?: boolean;
  /**
   * Tier 4 only: just the lines a pilot acts on (velocity, angle, height
   * above the ground, coaching). For models whose time grows with input
   * length, such as Laya, which takes ~3x as long on the full text.
   */
  readonly brief?: boolean;
}

const f1 = (n: number): string => n.toFixed(1);

/**
 * The one text every model sees for a state: `key: value unit` lines in a
 * fixed order. Sign conventions are spelled out because models cannot see
 * the screen.
 */
export function observe(lane: LaneState, tier: ObservationTier = 2, options: ObserveOptions = {}): string {
  const { lander: l, level } = lane;
  const padCx = (level.pad.x0 + level.pad.x1) / 2;
  const seconds = l.t / PHYSICS_HZ;
  if (options.brief) {
    if (tier !== 4) throw new Error("brief observations need tier 4: they are the coaching lines");
    return [
      `velocity: vx ${f1(l.vx)} m/s, vy ${f1(l.vy)} m/s`,
      `angle: ${f1(l.angle)} deg`,
      `height above ground below: ${f1(l.y - terrainHeightAt(level, l.x))} m`,
      ...coaching(lane, true),
    ].join("\n");
  }
  const rules = options.compact
    ? []
    : [
        "Lunar lander. x grows to the right, y grows up. Angle 0 is upright; positive leans right, and thrust then pushes right.",
        `gravity: ${f1(GRAVITY)} m/s2 down; full throttle gives ${f1(MAX_THRUST)} m/s2 along the craft`,
        `safe touchdown: |vy| under ${SAFE_VY} m/s, |vx| under ${SAFE_VX} m/s, |angle| under ${SAFE_TILT_DEG} deg, on the pad`,
      ];
  const lines = [
    ...rules.slice(0, 1),
    `position: x ${f1(l.x)} m, y ${f1(l.y)} m`,
    `velocity: vx ${f1(l.vx)} m/s, vy ${f1(l.vy)} m/s`,
    `angle: ${f1(l.angle)} deg`,
    `fuel: ${Math.round((l.fuel / FUEL_CAPACITY) * 100)} %`,
    `pad: x ${f1(level.pad.x0)} to ${f1(level.pad.x1)} m, y ${f1(level.pad.y)} m`,
    `wind: ${windAt(level, seconds).toFixed(2)} m/s2 (positive pushes right)`,
    ...rules.slice(1),
    `time left: ${f1(LEVEL_TIME_LIMIT_S - seconds)} s`,
  ];
  if (tier >= 2) {
    const dx = padCx - l.x;
    lines.push(
      `pad direction: ${Math.abs(dx) < 1 ? "directly below" : `${f1(Math.abs(dx))} m to the ${dx > 0 ? "right" : "left"}`}`,
      `height above pad: ${f1(l.y - level.pad.y)} m`,
      `height above ground below: ${f1(l.y - terrainHeightAt(level, l.x))} m`,
      `clearance over highest ground between here and pad: ${f1(l.y - maxTerrainBetween(level, l.x, padCx))} m`,
    );
  }
  if (tier >= 3) lines.push(...coaching(lane, tier === 4));
  return lines.join("\n");
}

/**
 * Tier 3: safe target speeds for right now and how far off the lander is,
 * from simple kinematics (brake at about 1 m/s2 sideways; descend faster
 * when high, at 1.6 m/s just above the pad). It tells the model which way
 * to correct but not which control to use.
 */
function coaching(lane: LaneState, tilt: boolean): string[] {
  const { lander: l, level } = lane;
  const padCx = (level.pad.x0 + level.pad.x1) / 2;
  const dx = padCx - l.x;
  const overPad = Math.abs(dx) < (level.pad.x1 - level.pad.x0) / 2 - 2;
  const targetVx = overPad ? 0 : Math.sign(dx) * Math.min(20, Math.sqrt(2 * Math.abs(dx)));
  const clearance = l.y - maxTerrainBetween(level, l.x, padCx);
  const targetVy = overPad && Math.abs(l.vx) < 3 ? -Math.min(9, 1.6 + (l.y - level.pad.y) * 0.15) : clearance > 25 ? -Math.min(8, (clearance - 25) * 0.1) : 0;
  const compare = (v: number, target: number, more: string, less: string): string => {
    const d = v - target;
    return Math.abs(d) < 0.5 ? "about right" : `${f1(Math.abs(d))} m/s too much ${d > 0 ? more : less}`;
  };
  const lines = [
    `safe horizontal speed now: ${f1(targetVx)} m/s; current is ${compare(l.vx, targetVx, "to the right", "to the left")}`,
    `safe vertical speed now: ${f1(targetVy)} m/s; current is ${compare(l.vy, targetVy, "upward", "downward")}`,
  ];
  if (tilt) {
    // Tilt into the speed error, at most 36 deg (6 deg near the ground).
    const limit = l.y - terrainHeightAt(level, l.x) < 15 ? 6 : 36;
    const good = Math.max(-limit, Math.min(limit, (targetVx - l.vx) * 5));
    const d = l.angle - good;
    lines.push(`good tilt now: ${f1(good)} deg; current tilt is ${Math.abs(d) <= 3 ? "about right" : `${f1(Math.abs(d))} deg too far ${d > 0 ? "right" : "left"}`}`);
  }
  return lines;
}
