import { MANOEUVRES, MENU_TILTS, THROTTLE_LEVELS, type LaneState } from "@lowgate/engine";
import { OPTION_KEYS, TILT_KEYS, TURN_RATE_DEG_S, VERTICAL_FITS, describeManoeuvre, fitsText, shortManoeuvre, tiltBandText } from "./menu.ts";
import { observe, type ObservationTier } from "./observe.ts";

export interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

export interface ScoreQuestion {
  readonly type: "score";
  readonly instructions: string;
  /** One per throttle level, lowest first. */
  readonly criteria: readonly string[];
}

/**
 * The System One questions asked at every decision, in one request: one
 * choice over the whole menu, or the menu split into a tilt choice and a
 * throttle question whose probabilities are multiplied back into the 35
 * (parseSystemOne). Either way the lane flies one manoeuvre from the menu.
 */
export type SystemOneQuestions =
  | { readonly manoeuvre: ChoiceQuestion }
  | { readonly tilt: ChoiceQuestion; readonly throttle: ScoreQuestion | ChoiceQuestion };

const criteria = (text: (i: number) => string): Record<string, string> => Object.fromEntries(OPTION_KEYS.map((key, i) => [key, text(i)]));

const HOW_IT_FLIES = `The lander turns toward the manoeuvre's tilt at up to ${TURN_RATE_DEG_S} deg/s and holds it, burning at its throttle, for the whole second.`;

/** Each option says what it does, not when to use it. */
const PLAIN: SystemOneQuestions = {
  manoeuvre: {
    type: "choice",
    instructions: `Which manoeuvre should the lander fly for the next second to reach a gentle, upright touchdown on the pad? ${HOW_IT_FLIES}`,
    criteria: criteria((i) => `${describeManoeuvre(MANOEUVRES[i]!)}.`),
  },
};

/** Each option also says which coaching readings call for it, quoting the observation's own phrases. */
const COACHED: SystemOneQuestions = {
  manoeuvre: {
    type: "choice",
    instructions: `Read the 'good tilt now' and 'safe vertical speed now' lines. Which manoeuvre for the next second? ${HOW_IT_FLIES}`,
    criteria: criteria((i) => `${describeManoeuvre(MANOEUVRES[i]!)}. ${fitsText(MANOEUVRES[i]!)}`),
  },
};

/** A few words per option, for the brief observation: Laya's context is 512 tokens. */
const BRIEF: SystemOneQuestions = {
  manoeuvre: {
    type: "choice",
    instructions: "Tilt and throttle for the next second?",
    criteria: criteria((i) => shortManoeuvre(MANOEUVRES[i]!)),
  },
};

/** m2's coaching in fewer words per option, with the fixed rules dropped from the observation: about 60% of m2's input. */
const COACHED_SHORT: SystemOneQuestions = {
  manoeuvre: {
    type: "choice",
    instructions: "Read 'good tilt now' and 'safe vertical speed now'. Which manoeuvre for the next second? Each is held for the whole second.",
    criteria: criteria((i) => {
      const m = MANOEUVRES[i]!;
      return `${shortManoeuvre(m)}. Good tilt ${tiltBandText(m.tilt)}; vertical ${VERTICAL_FITS[m.throttle]}.`;
    }),
  },
};

const TILT_QUESTION: ChoiceQuestion = {
  type: "choice",
  instructions: `Read the 'good tilt now' line. Which tilt should the lander turn to and hold for the next second? It turns at up to ${TURN_RATE_DEG_S} deg/s.`,
  criteria: Object.fromEntries(
    MENU_TILTS.map((t, i) => [TILT_KEYS[i]!, `${t === 0 ? "Upright" : `Tilt ${Math.abs(t)} deg ${t < 0 ? "left" : "right"}`}. Choose when 'good tilt now' is ${tiltBandText(t)}.`]),
  ),
};

const THROTTLE_INSTRUCTIONS = "Read the 'safe vertical speed now' line, which says how the current vertical speed compares. Medium thrust roughly balances gravity. Which throttle for the next second?";
const THROTTLE_LEVEL_TEXT = ["Off", "Low", "Medium", "High", "Full"].map((name, i) => `${name}. Current is ${VERTICAL_FITS[i]}.`);

/** Tilt and throttle as two small questions, the shape the real-time lanes flew best (p7's throttle wording). */
const SPLIT_SCORE: SystemOneQuestions = {
  tilt: TILT_QUESTION,
  throttle: { type: "score", instructions: THROTTLE_INSTRUCTIONS, criteria: THROTTLE_LEVEL_TEXT },
};

/** SPLIT_SCORE with throttle as a choice keyed "0".."4". */
const SPLIT_CHOICE: SystemOneQuestions = {
  tilt: TILT_QUESTION,
  throttle: { type: "choice", instructions: THROTTLE_INSTRUCTIONS, criteria: Object.fromEntries(Array.from({ length: THROTTLE_LEVELS }, (_, i) => [String(i), THROTTLE_LEVEL_TEXT[i]!])) },
};

/**
 * A complete prompt: observation tier plus question wording. Results and
 * replays record the prompt id, so numbers from different prompts are never
 * mixed. Add a new id rather than editing one that has results. The p1–p8
 * prompts of the real-time arena are kept under the v0-realtime tag.
 */
export interface PromptSpec {
  readonly id: string;
  readonly tier: ObservationTier;
  readonly compact: boolean;
  /** Only the lines a pilot acts on; see ObserveOptions.brief. */
  readonly brief?: boolean;
  readonly questions: SystemOneQuestions;
  readonly summary: string;
}

export const PROMPTS = {
  m1: { id: "m1", tier: 4, compact: false, questions: PLAIN, summary: "Tier 4 observation, each option describes its manoeuvre" },
  m2: { id: "m2", tier: 4, compact: false, questions: COACHED, summary: "Tier 4 observation, each option also names the coaching readings it fits" },
  m3: { id: "m3", tier: 4, compact: true, brief: true, questions: BRIEF, summary: "Brief tier 4 observation (coaching lines only), a few words per option" },
  m4: { id: "m4", tier: 4, compact: true, questions: COACHED_SHORT, summary: "Compact tier 4 observation, m2's coaching in a few words per option" },
  f1: { id: "f1", tier: 4, compact: true, questions: SPLIT_SCORE, summary: "Compact tier 4 observation, tilt choice and throttle score, multiplied into the menu" },
  f2: { id: "f2", tier: 4, compact: true, questions: SPLIT_CHOICE, summary: "f1 with throttle asked as a choice" },
  f3: { id: "f3", tier: 4, compact: true, brief: true, questions: SPLIT_SCORE, summary: "Brief tier 4 observation with f1's questions: Laya v3's training prompt (512-token context)" },
} as const satisfies Record<string, PromptSpec>;

export type PromptId = keyof typeof PROMPTS;
/** Jev's and Clef-flash's prompt since the R3 sweep (docs/lanes.md); each lane's own is in MODEL_LANES. */
export const DEFAULT_PROMPT: PromptId = "f1";

/** The state text a prompt sends for this lane state. */
export function observePrompt(lane: LaneState, spec: PromptSpec): string {
  return observe(lane, spec.tier, { compact: spec.compact, brief: spec.brief ?? false });
}

export function isPromptId(id: unknown): id is PromptId {
  return typeof id === "string" && Object.hasOwn(PROMPTS, id);
}
