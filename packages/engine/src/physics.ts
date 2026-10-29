import {
  DT,
  FUEL_BURN_FULL,
  GRAVITY,
  LEVEL_TIME_LIMIT_S,
  MAX_THRUST,
  MAX_TILT_DEG,
  PHYSICS_HZ,
  ROTATE_DEG_PER_STEP,
  SAFE_TILT_DEG,
  SAFE_VX,
  SAFE_VY,
  THROTTLE_LEVELS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./config.ts";
import { terrainHeightAt, windAt } from "./level.ts";
import { clamp, cosDeg, sinDeg } from "./math.ts";
import type { Action, Lander, Level, Outcome, Throttle } from "./types.ts";

const ROTATION: Record<Action["rotate"], number> = { left: -ROTATE_DEG_PER_STEP, none: 0, right: ROTATE_DEG_PER_STEP };
const TIME_LIMIT_STEPS = LEVEL_TIME_LIMIT_S * PHYSICS_HZ;

export interface StepResult {
  readonly lander: Lander;
  readonly outcome: Outcome | null;
}

/** Advance one physics step with semi-implicit Euler integration. */
export function stepLander(level: Level, s: Lander, action: Action): StepResult {
  const angle = clamp(s.angle + ROTATION[action.rotate], -MAX_TILT_DEG, MAX_TILT_DEG);
  const throttle: Throttle = s.fuel > 0 ? action.throttle : 0;
  const thrust = (MAX_THRUST * throttle) / (THROTTLE_LEVELS - 1);

  const ax = thrust * sinDeg(angle) + windAt(level, s.t * DT);
  const ay = thrust * cosDeg(angle) - GRAVITY;
  const vx = s.vx + ax * DT;
  const vy = s.vy + ay * DT;
  const lander: Lander = {
    x: s.x + vx * DT,
    y: s.y + vy * DT,
    vx,
    vy,
    angle,
    fuel: Math.max(0, s.fuel - ((FUEL_BURN_FULL * throttle) / (THROTTLE_LEVELS - 1)) * DT),
    t: s.t + 1,
    throttle,
  };
  return { lander, outcome: judge(level, lander) };
}

function judge(level: Level, l: Lander): Outcome | null {
  if (l.x < 0 || l.x > WORLD_WIDTH || l.y > WORLD_HEIGHT + 40) return "out_of_bounds";
  if (l.y <= terrainHeightAt(level, l.x)) {
    const onPad = l.x >= level.pad.x0 && l.x <= level.pad.x1;
    if (!onPad) return "crashed_terrain";
    if (Math.abs(l.angle) > SAFE_TILT_DEG) return "crashed_tilt";
    if (-l.vy > SAFE_VY || Math.abs(l.vx) > SAFE_VX) return "crashed_speed";
    return "landed";
  }
  if (l.t >= TIME_LIMIT_STEPS) return "timeout";
  return null;
}
