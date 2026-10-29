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
 * How much of the state is pre-digested for the model. Tier 1 is the raw
 * physics; tier 2 adds the geometry a pilot would read off the screen.
 * Results depend heavily on this, so replays record the tier used.
 */
export type ObservationTier = 1 | 2;

const f1 = (n: number): string => n.toFixed(1);

/**
 * The one text every model sees for a state: `key: value unit` lines in a
 * fixed order. Sign conventions are spelled out because models cannot see
 * the screen.
 */
export function observe(lane: LaneState, tier: ObservationTier = 2): string {
  const { lander: l, level } = lane;
  const padCx = (level.pad.x0 + level.pad.x1) / 2;
  const seconds = l.t / PHYSICS_HZ;
  const lines = [
    "Lunar lander. x grows to the right, y grows up. Angle 0 is upright; positive leans right, and thrust then pushes right.",
    `position: x ${f1(l.x)} m, y ${f1(l.y)} m`,
    `velocity: vx ${f1(l.vx)} m/s, vy ${f1(l.vy)} m/s`,
    `angle: ${f1(l.angle)} deg`,
    `fuel: ${Math.round((l.fuel / FUEL_CAPACITY) * 100)} %`,
    `pad: x ${f1(level.pad.x0)} to ${f1(level.pad.x1)} m, y ${f1(level.pad.y)} m`,
    `wind: ${windAt(level, seconds).toFixed(2)} m/s2 (positive pushes right)`,
    `gravity: ${f1(GRAVITY)} m/s2 down; full throttle gives ${f1(MAX_THRUST)} m/s2 along the craft`,
    `safe touchdown: |vy| under ${SAFE_VY} m/s, |vx| under ${SAFE_VX} m/s, |angle| under ${SAFE_TILT_DEG} deg, on the pad`,
    `time left: ${f1(LEVEL_TIME_LIMIT_S - seconds)} s`,
  ];
  if (tier === 2) {
    const dx = padCx - l.x;
    lines.push(
      `pad direction: ${Math.abs(dx) < 1 ? "directly below" : `${f1(Math.abs(dx))} m to the ${dx > 0 ? "right" : "left"}`}`,
      `height above pad: ${f1(l.y - level.pad.y)} m`,
      `height above ground below: ${f1(l.y - terrainHeightAt(level, l.x))} m`,
      `clearance over highest ground between here and pad: ${f1(l.y - maxTerrainBetween(level, l.x, padCx))} m`,
    );
  }
  return lines.join("\n");
}
