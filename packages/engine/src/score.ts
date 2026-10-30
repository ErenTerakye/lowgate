import { DT, FUEL_CAPACITY, SAFE_VX, SAFE_VY, STEPS_PER_DECISION } from "./config.ts";
import { clamp } from "./math.ts";
import type { Lander, LevelResult, Level, Outcome } from "./types.ts";

/**
 * 0–100 for a safe landing, in equal thirds: how close to the pad centre,
 * how far under the touchdown speed limits, and how much fuel is left.
 * Rounded to 0.1 so it stays exact in recordings.
 */
export function landingQuality(level: Level, l: Lander): number {
  const half = (level.pad.x1 - level.pad.x0) / 2;
  const centre = 1 - clamp(Math.abs(l.x - (level.pad.x0 + level.pad.x1) / 2) / half, 0, 1);
  const gentle = 1 - clamp(Math.max(-l.vy / SAFE_VY, Math.abs(l.vx) / SAFE_VX), 0, 1);
  const fuel = clamp(l.fuel / FUEL_CAPACITY, 0, 1);
  return Math.round(((centre + gentle + fuel) / 3) * 1000) / 10;
}

export function levelResult(level: Level, l: Lander, outcome: Outcome): LevelResult {
  const landed = outcome === "landed";
  return {
    index: level.index,
    outcome,
    decisions: Math.ceil(l.t / STEPS_PER_DECISION),
    seconds: l.t * DT,
    fuel: l.fuel,
    landing: landed
      ? { offset: Math.abs(l.x - (level.pad.x0 + level.pad.x1) / 2), vx: l.vx, vy: l.vy, quality: landingQuality(level, l) }
      : null,
  };
}

export interface CourseSummary {
  readonly levels: number;
  readonly landed: number;
  /** Landed levels over levels flown. */
  readonly landingRate: number;
  /** Mean quality over landed levels; null with no landing. */
  readonly meanQuality: number | null;
  readonly decisions: number;
}

/** Totals for any set of level results: one course, or every course a lane flew. */
export function summarize(results: readonly LevelResult[]): CourseSummary {
  const landings = results.flatMap((r) => (r.landing ? [r.landing.quality] : []));
  return {
    levels: results.length,
    landed: landings.length,
    landingRate: results.length ? landings.length / results.length : 0,
    meanQuality: landings.length ? landings.reduce((a, b) => a + b, 0) / landings.length : null,
    decisions: results.reduce((a, r) => a + r.decisions, 0),
  };
}
