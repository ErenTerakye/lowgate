import {
  COURSE_LEVELS,
  FUEL_CAPACITY,
  LEVEL_TIME_LIMIT_S,
  TERRAIN_POINTS,
  TERRAIN_SEGMENT,
  WIND_KNOT_S,
  WORLD_WIDTH,
} from "./config.ts";
import { clamp } from "./math.ts";
import { createRng, deriveSeed } from "./rng.ts";
import type { Level } from "./types.ts";

/**
 * Level `index` of a run is a pure function of (runSeed, index), so every
 * lane meets exactly the same sequence of courses. Difficulty (terrain
 * roughness, wind, distance to the pad) ramps up with the index.
 */
export function generateLevel(runSeed: number, index: number): Level {
  const seed = deriveSeed(runSeed, index);
  const rng = createRng(seed);
  const difficulty = Math.min(index, COURSE_LEVELS - 1) / (COURSE_LEVELS - 1);

  const roughness = 10 + 14 * difficulty;
  const terrain: number[] = [];
  let h = rng.range(30, 80);
  for (let i = 0; i < TERRAIN_POINTS; i++) {
    terrain.push(h);
    h = clamp(h + rng.range(-roughness, roughness), 10, 150);
  }
  // One smoothing pass so ridges look like terrain rather than noise.
  const smooth = terrain.map((v, i) => (terrain[i - 1] ?? v) * 0.25 + v * 0.5 + (terrain[i + 1] ?? v) * 0.25);

  const padSegments = rng.int(3, 5) - Math.round(difficulty);
  const padStart = rng.int(2, TERRAIN_POINTS - 3 - padSegments);
  let padY = 0;
  for (let i = padStart; i <= padStart + padSegments; i++) padY += smooth[i]!;
  padY /= padSegments + 1;
  for (let i = padStart; i <= padStart + padSegments; i++) smooth[i] = padY;
  const pad = { x0: padStart * TERRAIN_SEGMENT, x1: (padStart + padSegments) * TERRAIN_SEGMENT, y: padY };

  // Start far enough from the pad that every level needs a lateral transfer.
  const padCx = (pad.x0 + pad.x1) / 2;
  const minGap = 70 + 50 * difficulty;
  let startX = rng.range(30, WORLD_WIDTH - 30);
  for (let tries = 0; Math.abs(startX - padCx) < minGap && tries < 32; tries++) {
    startX = rng.range(30, WORLD_WIDTH - 30);
  }
  if (Math.abs(startX - padCx) < minGap) startX = padCx < WORLD_WIDTH / 2 ? WORLD_WIDTH - 30 : 30;

  const maxWind = 0.1 + 0.3 * difficulty;
  const wind: number[] = [];
  for (let k = 0; k <= LEVEL_TIME_LIMIT_S / WIND_KNOT_S + 1; k++) wind.push(rng.range(-maxWind, maxWind));

  return {
    index,
    seed,
    terrain: smooth,
    pad,
    wind,
    start: {
      x: startX,
      y: 220,
      vx: rng.range(-6, 6),
      vy: rng.range(-2, 0),
      angle: 0,
      fuel: FUEL_CAPACITY,
      t: 0,
      throttle: 0,
    },
  };
}

export function terrainHeightAt(level: Level, x: number): number {
  const fx = clamp(x, 0, WORLD_WIDTH) / TERRAIN_SEGMENT;
  const i = Math.min(Math.floor(fx), TERRAIN_POINTS - 2);
  const f = fx - i;
  return level.terrain[i]! * (1 - f) + level.terrain[i + 1]! * f;
}

/** Highest terrain point between two x positions (inclusive), for clearance checks. */
export function maxTerrainBetween(level: Level, xa: number, xb: number): number {
  const lo = clamp(Math.min(xa, xb), 0, WORLD_WIDTH);
  const hi = clamp(Math.max(xa, xb), 0, WORLD_WIDTH);
  let max = Math.max(terrainHeightAt(level, lo), terrainHeightAt(level, hi));
  for (let i = Math.ceil(lo / TERRAIN_SEGMENT); i * TERRAIN_SEGMENT <= hi; i++) {
    max = Math.max(max, level.terrain[i]!);
  }
  return max;
}

export function windAt(level: Level, seconds: number): number {
  const k = seconds / WIND_KNOT_S;
  const i = Math.min(Math.floor(k), level.wind.length - 2);
  const f = k - i;
  return level.wind[i]! * (1 - f) + level.wind[i + 1]! * f;
}
