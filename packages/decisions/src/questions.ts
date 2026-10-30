import { MANOEUVRES, type LaneState } from "@arena/engine";
import { OPTION_KEYS, TURN_RATE_DEG_S, describeManoeuvre, fitsText, shortManoeuvre } from "./menu.ts";
import { observe, type ObservationTier } from "./observe.ts";

/** The one System One question asked at every decision: a choice over the whole menu. */
export interface SystemOneQuestions {
  readonly manoeuvre: { readonly type: "choice"; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> };
}

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
} as const satisfies Record<string, PromptSpec>;

export type PromptId = keyof typeof PROMPTS;
/** Until the R3 sweep picks one per lane (docs/lanes.md). */
export const DEFAULT_PROMPT: PromptId = "m2";

/** The state text a prompt sends for this lane state. */
export function observePrompt(lane: LaneState, spec: PromptSpec): string {
  return observe(lane, spec.tier, { compact: spec.compact, brief: spec.brief ?? false });
}

export function isPromptId(id: unknown): id is PromptId {
  return typeof id === "string" && Object.hasOwn(PROMPTS, id);
}
