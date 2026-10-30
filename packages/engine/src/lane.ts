import { COURSE_LEVELS, DT, STEPS_PER_DECISION } from "./config.ts";
import { generateLevel } from "./level.ts";
import { controlFor } from "./menu.ts";
import { stepLander } from "./physics.ts";
import { levelResult } from "./score.ts";
import type { LaneState, Manoeuvre } from "./types.ts";

export function createLane(seed: number): LaneState {
  const level = generateLevel(seed, 0);
  return { seed, level, lander: level.start, outcome: null, step: 0, results: [], finished: false };
}

/** True when the lane is waiting for its next manoeuvre. */
export function needsDecision(lane: LaneState): boolean {
  return !lane.finished && lane.outcome === null && lane.lander.t % STEPS_PER_DECISION === 0;
}

/** Decisions already taken in the current level. */
export function decisionInLevel(lane: LaneState): number {
  return Math.ceil(lane.lander.t / STEPS_PER_DECISION);
}

/** Advance one physics step flying `m`. Does nothing once the level has an outcome. */
export function stepLane(lane: LaneState, m: Manoeuvre): LaneState {
  if (lane.outcome !== null) return lane;
  const { lander, outcome } = stepLander(lane.level, lane.lander, controlFor(lane.lander, m));
  const step = lane.step + 1;
  if (outcome === null) return { ...lane, lander, step };
  const results = [...lane.results, levelResult(lane.level, lander, outcome)];
  return { ...lane, lander, step, outcome, results, finished: results.length === COURSE_LEVELS };
}

/** Fly one decision: hold `m` until the next decision boundary or the end of the level. */
export function flyDecision(lane: LaneState, m: Manoeuvre): LaneState {
  let next = stepLane(lane, m);
  while (next.outcome === null && next.lander.t % STEPS_PER_DECISION !== 0) next = stepLane(next, m);
  return next;
}

/** Start the next level after an outcome. Does nothing while a level is in progress or once the course is done. */
export function nextLevel(lane: LaneState): LaneState {
  if (lane.outcome === null || lane.finished) return lane;
  const level = generateLevel(lane.seed, lane.level.index + 1);
  return { ...lane, level, lander: level.start, outcome: null };
}

/** Seconds flown in the current level. */
export function levelSeconds(lane: LaneState): number {
  return lane.lander.t * DT;
}
