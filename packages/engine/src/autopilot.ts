import { DT, GRAVITY, MAX_THRUST, STEPS_PER_DECISION, THROTTLE_LEVELS } from "./config.ts";
import { maxTerrainBetween, terrainHeightAt, windAt } from "./level.ts";
import { controlFor, MANOEUVRES } from "./menu.ts";
import { clamp, cosDeg } from "./math.ts";
import { stepLander } from "./physics.ts";
import type { Action, Lander, Level, Manoeuvre, Outcome, Rotate, Throttle } from "./types.ts";

export interface AutopilotTargets {
  /** Horizontal and vertical velocity the pilot wants now, m/s. */
  readonly vx: number;
  readonly vy: number;
  /** Largest tilt it accepts at this height, degrees. */
  readonly tiltLimit: number;
}

/**
 * The velocities a careful pilot aims for: cruise toward the pad at a speed
 * it can still brake from, hold clearance over the terrain on the way, then
 * descend over the pad, slower the lower it gets.
 */
export function autopilotTargets(level: Level, l: Lander): AutopilotTargets {
  const padCx = (level.pad.x0 + level.pad.x1) / 2;
  const dx = padCx - l.x;
  const padHalf = (level.pad.x1 - level.pad.x0) / 2;
  const overPad = Math.abs(dx) < padHalf - 2;

  // v = sqrt(2·a·d) with ~1 m/s² of braking, so it can still stop over the pad.
  const cruise = Math.min(20, Math.sqrt(2 * Math.abs(dx)));
  const vx = overPad ? clamp(dx * 0.3, -1, 1) : Math.sign(dx) * cruise;
  const nearGround = l.y - terrainHeightAt(level, l.x) < 15;

  let vy: number;
  if (overPad && Math.abs(l.vx) < 3) {
    vy = -clamp(1.6 + (l.y - level.pad.y) * 0.15, 1.6, 9);
  } else {
    const clearance = l.y - maxTerrainBetween(level, l.x, padCx);
    vy = clearance > 25 ? -clamp((clearance - 25) * 0.1, 0.5, 8) : clearance > 15 ? 0 : 2;
  }
  return { vx, vy, tiltLimit: nearGround ? 6 : 36 };
}

/** The continuous controller the menu pilot imitates: it re-decides this often, steering 0.5° per step. */
const INNER_STEPS = 12;

/** One step of a cascaded P-controller toward the targets (the real-time arena's autopilot). */
function innerControl(level: Level, l: Lander): Action {
  const t = autopilotTargets(level, l);
  const targetAngle = clamp((t.vx - l.vx) * 5, -t.tiltLimit, t.tiltLimit);
  const err = targetAngle - l.angle;
  const rotate: Rotate = err > 3 ? "right" : err < -3 ? "left" : "none";
  const needed = (GRAVITY + (t.vy - l.vy) * 1.5) / cosDeg(l.angle);
  const throttle = clamp(Math.round((needed / MAX_THRUST) * (THROTTLE_LEVELS - 1)), 0, THROTTLE_LEVELS - 1) as Throttle;
  return { rotate, throttle };
}

const CRASH = 1e9;

/** One second of the continuous controller: where a pilot free of the menu would be. */
function reference(level: Level, start: Lander): Lander {
  let l = start;
  let control = innerControl(level, l);
  for (let i = 0; i < STEPS_PER_DECISION; i++) {
    if (i % INNER_STEPS === 0) control = innerControl(level, l);
    const { lander, outcome } = stepLander(level, l, control);
    l = lander;
    if (outcome !== null) break;
  }
  return l;
}

/** How far one second of a manoeuvre ends from the reference. Lower is better. */
function rollout(level: Level, start: Lander, m: Manoeuvre, ref: Lander): number {
  let l = start;
  let outcome: Outcome | null = null;
  for (let i = 0; i < STEPS_PER_DECISION && outcome === null; i++) ({ lander: l, outcome } = stepLander(level, l, controlFor(l, m)));
  if (outcome === "landed") return -CRASH;
  if (outcome !== null) return CRASH - l.t;
  return (l.vx - ref.vx) ** 2 + (l.vy - ref.vy) ** 2 + ((l.angle - ref.angle) / 10) ** 2 + ((l.x - ref.x) ** 2 + (l.y - ref.y) ** 2) / 4;
}

/**
 * Hand-written reference pilot with no model, choosing from the same menu as
 * every lane. It rehearses one second of a continuous controller (the
 * real-time arena's autopilot) and picks the manoeuvre that ends nearest to
 * it. It sees the full state and the wind now, but not the wind ahead: its
 * rehearsal holds the current wind steady. Deliberately simple, not optimal.
 * Returns a menu index.
 */
export function autopilot(level: Level, l: Lander): number {
  const windNow = windAt(level, l.t * DT);
  const steady: Level = { ...level, wind: level.wind.map(() => windNow) };
  const ref = reference(steady, l);
  let best = 0;
  let bestCost = Infinity;
  MANOEUVRES.forEach((m, i) => {
    const cost = rollout(steady, l, m, ref);
    if (cost < bestCost) [best, bestCost] = [i, cost];
  });
  return best;
}
