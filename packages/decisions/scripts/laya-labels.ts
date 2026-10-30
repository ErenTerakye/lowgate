/** Laya's training labels, shared by laya-dataset.ts and laya-dagger.ts so both label a state the same way. */
import { MANOEUVRES, MENU_TILTS, THROTTLE_LEVELS, autopilot, terrainHeightAt, type LaneState } from "@lowgate/engine";
import { PROMPTS, TILT_KEYS, observePrompt, type PromptId, type PromptSpec } from "../src/index.ts";

/** Label smoothing: the autopilot's pick gets most weight, the rest goes to the neighbouring tilts or throttle levels. */
const PICK_WEIGHT = 0.8;
/** Below this height above the ground a state counts as the final descent, where v3's misses happen. */
export const FINAL_DESCENT_M = 20;

/** Probabilities over `n` ordered options: PICK_WEIGHT on `pick`, the rest split between its neighbours. */
function smoothed(n: number, pick: number): number[] {
  const neighbours = [pick - 1, pick + 1].filter((i) => i >= 0 && i < n);
  return Array.from({ length: n }, (_, i) => (i === pick ? PICK_WEIGHT : neighbours.includes(i) ? (1 - PICK_WEIGHT) / neighbours.length : 0));
}

function gold(pick: number) {
  const m = MANOEUVRES[pick]!;
  const tilt = smoothed(MENU_TILTS.length, MENU_TILTS.indexOf(m.tilt));
  const throttle = smoothed(THROTTLE_LEVELS, m.throttle);
  return {
    tilt: { probabilities: Object.fromEntries(TILT_KEYS.map((key, i) => [key, tilt[i]])) },
    throttle: { probabilities: Object.fromEntries(throttle.map((p, i) => [String(i), p])) },
  };
}

/** A prompt Laya can learn: a tilt choice and a throttle score. Throws otherwise. */
export function layaPrompt(id: string): (typeof PROMPTS)[PromptId] {
  const prompt = PROMPTS[id as keyof typeof PROMPTS];
  if (!prompt) throw new Error(`Unknown prompt "${id}". Known: ${Object.keys(PROMPTS).join(", ")}`);
  const q = prompt.questions;
  if (!("tilt" in q) || q.throttle.type !== "score") throw new Error(`Prompt ${id} must ask a tilt choice and a throttle score`);
  return prompt;
}

/** One {state, questions, gold} row for laya.train, labelled with the clean autopilot pick, plus that pick. */
export function labelledRow(lane: LaneState, prompt: PromptSpec): { row: string; pick: number } {
  const pick = autopilot(lane.level, lane.lander);
  return { row: JSON.stringify({ state: observePrompt(lane, prompt), questions: prompt.questions, gold: gold(pick) }), pick };
}

export function heightAboveGround(lane: LaneState): number {
  return lane.lander.y - terrainHeightAt(lane.level, lane.lander.x);
}

export function tally(picks: readonly number[]): { tilt: Record<string, number>; throttle: Record<string, number> } {
  const tilt: Record<string, number> = {};
  const throttle: Record<string, number> = {};
  for (const p of picks) {
    const m = MANOEUVRES[p]!;
    const t = TILT_KEYS[MENU_TILTS.indexOf(m.tilt)]!;
    tilt[t] = (tilt[t] ?? 0) + 1;
    throttle[m.throttle] = (throttle[m.throttle] ?? 0) + 1;
  }
  return { tilt, throttle };
}
