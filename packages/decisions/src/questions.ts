import { THROTTLE_LEVELS, type Action, type Rotate, type Throttle } from "@arena/engine";
import type { Probabilities } from "./types.ts";

export const ROTATES: readonly Rotate[] = ["left", "none", "right"];

/** The two System One questions asked every tick, in one request. */
export const SYSTEM_ONE_QUESTIONS = {
  rotate: {
    type: "choice",
    instructions: "Which way should the lander rotate during the next 0.2 seconds to reach a safe landing on the pad?",
    criteria: {
      left: "Rotate left: the angle decreases, tilting the thrust toward the left.",
      none: "Hold the current angle.",
      right: "Rotate right: the angle increases, tilting the thrust toward the right.",
    },
  },
  throttle: {
    type: "score",
    instructions: "How much engine throttle should the lander use during the next 0.2 seconds to reach a safe landing on the pad?",
    criteria: [
      "Off: no thrust, fall freely.",
      "Low: a quarter of full thrust.",
      "Medium: half of full thrust.",
      "High: three quarters of full thrust.",
      "Full thrust.",
    ],
  },
} as const;

export function argmax(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if ((values[i] ?? -Infinity) > (values[best] ?? -Infinity)) best = i;
  return best;
}

/**
 * Turns probabilities into the action the lane flies: the most likely
 * rotation and the most likely throttle level. Every probabilistic lane uses
 * this same rule, so differences come from the models, not the decoding.
 */
export function actionFromProbs(probs: Probabilities): Action {
  const rotate = ROTATES[argmax(ROTATES.map((r) => probs.rotate[r]))] ?? "none";
  return { rotate, throttle: argmax(probs.throttle) as Throttle };
}

/** Probabilities that put all weight on one action, for controllers that only pick. */
export function oneHot(action: Action): Probabilities {
  return {
    rotate: { left: action.rotate === "left" ? 1 : 0, none: action.rotate === "none" ? 1 : 0, right: action.rotate === "right" ? 1 : 0 },
    throttle: Array.from({ length: THROTTLE_LEVELS }, (_, i) => (i === action.throttle ? 1 : 0)),
  };
}

export function isThrottle(n: unknown): n is Throttle {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) < THROTTLE_LEVELS;
}

export function isRotate(s: unknown): s is Rotate {
  return s === "left" || s === "none" || s === "right";
}
