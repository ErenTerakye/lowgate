import type { LaneState } from "./types.ts";

/**
 * FNV-1a over quantised lane state. Replays store this per decision so a
 * re-simulation can prove it reproduces the recorded run exactly.
 */
export function stateHash(lane: LaneState): string {
  const l = lane.lander;
  const values = [
    lane.step,
    lane.level.index,
    lane.stats.score,
    Math.round(l.x * 1000),
    Math.round(l.y * 1000),
    Math.round(l.vx * 1000),
    Math.round(l.vy * 1000),
    Math.round(l.angle * 2),
    Math.round(l.fuel * 1000),
  ];
  let h = 0x811c9dc5;
  for (const v of values) {
    let x = v | 0;
    for (let b = 0; b < 4; b++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
