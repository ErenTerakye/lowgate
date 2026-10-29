import { GRAVITY, MAX_THRUST, THROTTLE_LEVELS } from "./config.ts";
import { maxTerrainBetween, terrainHeightAt } from "./level.ts";
import { clamp, cosDeg } from "./math.ts";
import type { Action, Lander, Level, Rotate, Throttle } from "./types.ts";

/**
 * Hand-written reference pilot: a cascaded P-controller that sees the full
 * state. It is the "ceiling" lane in the arena and labels training data for
 * fine-tuning; it is deliberately simple, not optimal.
 */
export function autopilot(level: Level, l: Lander): Action {
  const padCx = (level.pad.x0 + level.pad.x1) / 2;
  const dx = padCx - l.x;
  const padHalf = (level.pad.x1 - level.pad.x0) / 2;
  const overPad = Math.abs(dx) < padHalf - 2;

  // Horizontal: v = sqrt(2·a·d) with ~1 m/s² of braking, so it can still stop
  // over the pad after the few ticks it takes to tilt into the burn.
  const cruise = Math.min(20, Math.sqrt(2 * Math.abs(dx)));
  const targetVx = overPad ? clamp(dx * 0.3, -1, 1) : Math.sign(dx) * cruise;
  const groundHere = terrainHeightAt(level, l.x);
  const nearGround = l.y - groundHere < 15;
  const tiltLimit = nearGround ? 6 : 36;
  const targetAngle = clamp((targetVx - l.vx) * 5, -tiltLimit, tiltLimit);
  const err = targetAngle - l.angle;
  const rotate: Rotate = err > 3 ? "right" : err < -3 ? "left" : "none";

  // Vertical: hold clearance over the highest terrain ahead until over the pad.
  let targetVy: number;
  if (overPad && Math.abs(l.vx) < 3) {
    const h = l.y - level.pad.y;
    targetVy = -clamp(1.6 + h * 0.15, 1.6, 9);
  } else {
    const clearance = l.y - maxTerrainBetween(level, l.x, padCx);
    targetVy = clearance > 25 ? -clamp((clearance - 25) * 0.1, 0.5, 8) : clearance > 15 ? 0 : 2;
  }

  const needed = (GRAVITY + (targetVy - l.vy) * 1.5) / cosDeg(l.angle);
  const throttle = clamp(Math.round((needed / MAX_THRUST) * (THROTTLE_LEVELS - 1)), 0, THROTTLE_LEVELS - 1) as Throttle;
  return { rotate, throttle };
}
