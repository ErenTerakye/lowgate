import { DEFAULT_RUN_SECONDS, LANDING_POINTS, OUTCOME_PAUSE_S, PHYSICS_HZ, STEPS_PER_DECISION } from "./config.ts";
import { generateLevel } from "./level.ts";
import { stepLander } from "./physics.ts";
import type { Action, LaneState } from "./types.ts";

const PAUSE_STEPS = OUTCOME_PAUSE_S * PHYSICS_HZ;

export function createLane(seed: number, runSeconds = DEFAULT_RUN_SECONDS): LaneState {
  const level = generateLevel(seed, 0);
  return {
    seed,
    runSteps: runSeconds * PHYSICS_HZ,
    level,
    lander: level.start,
    outcome: null,
    resumeAt: 0,
    step: 0,
    stats: { score: 0, landings: 0, failures: 0 },
    finished: false,
  };
}

/** True when the lane wants a fresh decision before its next step. */
export function needsDecision(lane: LaneState): boolean {
  return !lane.finished && lane.outcome === null && lane.step % STEPS_PER_DECISION === 0;
}

export function decisionTick(lane: LaneState): number {
  return Math.floor(lane.step / STEPS_PER_DECISION);
}

/**
 * Advance one physics step. While frozen on a level outcome the action is
 * ignored; the next level always begins on a decision boundary so every
 * lane's decision ticks line up with the run clock.
 */
export function stepLane(lane: LaneState, action: Action): LaneState {
  if (lane.finished) return lane;
  const step = lane.step + 1;
  const finished = step >= lane.runSteps;

  if (lane.outcome !== null) {
    if (step < lane.resumeAt) return { ...lane, step, finished };
    const level = generateLevel(lane.seed, lane.level.index + 1);
    return { ...lane, step, finished, level, lander: level.start, outcome: null };
  }

  const { lander, outcome } = stepLander(lane.level, lane.lander, action);
  if (outcome === null) return { ...lane, step, finished, lander };

  const landed = outcome === "landed";
  const stats = {
    score: lane.stats.score + (landed ? LANDING_POINTS + Math.floor(lander.fuel) : 0),
    landings: lane.stats.landings + (landed ? 1 : 0),
    failures: lane.stats.failures + (landed ? 0 : 1),
  };
  const resumeAt = Math.ceil((step + PAUSE_STEPS) / STEPS_PER_DECISION) * STEPS_PER_DECISION;
  return { ...lane, step, finished, lander, outcome, resumeAt, stats };
}

/** Advance a whole decision tick (or until the run ends) holding one action. */
export function stepTick(lane: LaneState, action: Action): LaneState {
  let next = stepLane(lane, action);
  while (!next.finished && next.step % STEPS_PER_DECISION !== 0) next = stepLane(next, action);
  return next;
}
