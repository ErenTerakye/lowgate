import { THROTTLE_LEVELS, type Action, type Rotate, type Throttle } from "@arena/engine";
import type { ObservationTier } from "./observe.ts";
import type { Probabilities } from "./types.ts";

export const ROTATES: readonly Rotate[] = ["left", "none", "right"];

/**
 * The two System One questions asked every tick, in one request. Throttle is
 * an ordered score, or a choice keyed "0".."4" (both come back per level).
 */
export interface SystemOneQuestions {
  readonly rotate: { readonly type: "choice"; readonly instructions: string; readonly criteria: Readonly<Record<Rotate, string>> };
  readonly throttle:
    | { readonly type: "score"; readonly instructions: string; readonly criteria: readonly string[] }
    | { readonly type: "choice"; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> };
}

/** First wording: describes each control, not when to use it. */
const GENERIC: SystemOneQuestions = {
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
};

/** Second wording: each option says what situation calls for it, with the physics in numbers. */
const SITUATIONAL: SystemOneQuestions = {
  rotate: {
    type: "choice",
    instructions: "The lander should move toward the pad and arrive slow and upright. Which way should it rotate for the next 0.2 seconds?",
    criteria: {
      left: "Rotate left (angle decreases). Right when the lander needs to accelerate toward the left: the pad is to the left, or it drifts right too fast, or it leans too far right.",
      none: "Hold the angle. Right when the current tilt already pushes the lander the way it needs to go.",
      right: "Rotate right (angle increases). Right when the lander needs to accelerate toward the right: the pad is to the right, or it drifts left too fast, or it leans too far left.",
    },
  },
  throttle: {
    type: "score",
    instructions: "Gravity pulls down at 3.2 m/s2. Which throttle for the next 0.2 seconds keeps the lander on course for a gentle, upright touchdown on the pad?",
    criteria: [
      "Off (0 m/s2 up). Right when the lander is rising, or descending slowly with plenty of height left.",
      "Low (2.1 m/s2 up, less than gravity). Right when it should keep sinking, a little slower.",
      "Medium (4.2 m/s2 up, a bit more than gravity). Right when a descent should slow gently, or to roughly hold height.",
      "High (6.3 m/s2 up). Right when it is descending too fast for its height.",
      "Full (8.4 m/s2 up). Right when it is descending fast close to the ground and must brake hard.",
    ],
  },
};

const COACHED_THROTTLE = [
  "Off. The lander is rising, or descending much more slowly than the safe vertical speed.",
  "Low. It is descending a little more slowly than the safe vertical speed.",
  "Medium. Its vertical speed is about right.",
  "High. It is descending too fast, by 1 to 3 m/s.",
  "Full. It is descending far too fast, by more than 3 m/s.",
];

/** Third wording: for coached observations; each option names the coaching line that calls for it. */
const COACHED: SystemOneQuestions = {
  rotate: {
    type: "choice",
    instructions: "Read the 'good tilt now' line. Which way should the lander rotate for the next 0.2 seconds?",
    criteria: {
      left: "Rotate left. Choose when the current tilt is too far right of the good tilt.",
      none: "Hold the angle. Choose when the current tilt is about right.",
      right: "Rotate right. Choose when the current tilt is too far left of the good tilt.",
    },
  },
  throttle: {
    type: "score",
    instructions: "Read the 'safe vertical speed now' line. Medium thrust roughly balances gravity. Which throttle for the next 0.2 seconds?",
    criteria: COACHED_THROTTLE,
  },
};

/**
 * Fourth wording: COACHED, with throttle asked as a choice. Clef-flash's
 * score answers stayed near the middle level whatever the state.
 */
const COACHED_CHOICE: SystemOneQuestions = {
  rotate: COACHED.rotate,
  throttle: {
    type: "choice",
    instructions: COACHED.throttle.instructions,
    criteria: Object.fromEntries(COACHED_THROTTLE.map((text, i) => [String(i), text])),
  },
};

/**
 * Fifth wording: COACHED, with each throttle level quoting the words the
 * 'safe vertical speed now' line uses ("too much downward"), so no
 * rephrasing is needed to match them.
 */
const COACHED_MATCHED: SystemOneQuestions = {
  rotate: COACHED.rotate,
  throttle: {
    type: "score",
    instructions: "Read the 'safe vertical speed now' line, which says how the current vertical speed compares. Which throttle for the next 0.2 seconds?",
    criteria: [
      "Off. Current is more than 1.5 m/s too much upward.",
      "Low. Current is up to 1.5 m/s too much upward.",
      "Medium. Current is about right.",
      "High. Current is up to 3 m/s too much downward.",
      "Full. Current is more than 3 m/s too much downward.",
    ],
  },
};

/**
 * A complete prompt: observation tier plus question wording. Results and
 * replays record the prompt id, so numbers from different prompts are never
 * mixed. Add a new id rather than editing one that has results.
 */
export interface PromptSpec {
  readonly id: string;
  readonly tier: ObservationTier;
  readonly compact: boolean;
  readonly questions: SystemOneQuestions;
  readonly summary: string;
}

export const PROMPTS = {
  p1: { id: "p1", tier: 2, compact: false, questions: GENERIC, summary: "Tier 2 observation, generic question wording" },
  p2: { id: "p2", tier: 2, compact: false, questions: SITUATIONAL, summary: "Tier 2 observation, situational wording" },
  p3: { id: "p3", tier: 2, compact: true, questions: SITUATIONAL, summary: "Tier 2 observation without fixed rules, situational wording" },
  p4: { id: "p4", tier: 3, compact: false, questions: SITUATIONAL, summary: "Tier 3 observation (safe-speed coaching), situational wording" },
  p5: { id: "p5", tier: 4, compact: false, questions: COACHED, summary: "Tier 4 observation (speed and tilt coaching), coached wording" },
  p7: { id: "p7", tier: 4, compact: false, questions: COACHED_MATCHED, summary: "Tier 4 observation, coached wording quoting the observation's own phrases" },
  p6: { id: "p6", tier: 4, compact: false, questions: COACHED_CHOICE, summary: "Tier 4 observation, coached wording, throttle as a choice" },
} as const satisfies Record<string, PromptSpec>;

export type PromptId = keyof typeof PROMPTS;
/** Jev's prompt since the 2026-10-29 sweep (docs/prompt-tuning.md); each lane's own is in MODEL_LANES. */
export const DEFAULT_PROMPT: PromptId = "p5";

export function isPromptId(id: unknown): id is PromptId {
  return typeof id === "string" && Object.hasOwn(PROMPTS, id);
}

/** Kept for callers that predate prompt versions. */
export const SYSTEM_ONE_QUESTIONS = PROMPTS[DEFAULT_PROMPT].questions;

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
