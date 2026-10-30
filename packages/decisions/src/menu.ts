import { MANOEUVRES, MENU_TILTS, PHYSICS_HZ, ROTATE_DEG_PER_STEP, THROTTLE_LEVELS, type Manoeuvre } from "@arena/engine";

/** How fast the lander turns toward a manoeuvre's tilt, deg/s. */
export const TURN_RATE_DEG_S = ROTATE_DEG_PER_STEP * PHYSICS_HZ;

/**
 * Option key for a manoeuvre, the same for every lane and protocol: the
 * tilt side and size, then the throttle level. "UP-T2", "L15-T3", "R5-T0".
 */
export function optionKey(m: Manoeuvre): string {
  const tilt = m.tilt === 0 ? "UP" : `${m.tilt < 0 ? "L" : "R"}${Math.abs(m.tilt)}`;
  return `${tilt}-T${m.throttle}`;
}

/** Keys in menu order: OPTION_KEYS[i] names MANOEUVRES[i]. */
export const OPTION_KEYS: readonly string[] = MANOEUVRES.map(optionKey);

/** Menu index of an option key, or -1. Tolerates case and surrounding spaces, as small models vary them. */
export function optionIndex(key: string): number {
  return OPTION_KEYS.indexOf(key.trim().toUpperCase());
}

const tiltWords = (tilt: number): string => (tilt === 0 ? "Upright" : `Tilt ${Math.abs(tilt)} deg ${tilt < 0 ? "left" : "right"}`);
const throttleWords = (throttle: number): string => `throttle ${throttle} of ${THROTTLE_LEVELS - 1}${throttle === 0 ? " (engine off)" : throttle === THROTTLE_LEVELS - 1 ? " (full)" : ""}`;

/** "Tilt 15 deg right, throttle 3 of 4". Degrees spelled "deg", as in the observation. */
export function describeManoeuvre(m: Manoeuvre): string {
  return `${tiltWords(m.tilt)}, ${throttleWords(m.throttle)}`;
}

/** Few words, for prompts that must fit a small context (Laya): "15 right, T3". */
export function shortManoeuvre(m: Manoeuvre): string {
  return `${m.tilt === 0 ? "Upright" : `${Math.abs(m.tilt)} ${m.tilt < 0 ? "left" : "right"}`}, T${m.throttle}`;
}

/**
 * The span of "good tilt now" values each menu tilt is nearest to, split
 * halfway between neighbours: [-30, -22.5), [-22.5, -10), ... for -30, -15, ...
 */
export function tiltBand(tilt: number): { readonly low: number | null; readonly high: number | null } {
  const i = MENU_TILTS.indexOf(tilt);
  if (i < 0) throw new RangeError(`${tilt} is not a menu tilt`);
  return {
    low: i > 0 ? (MENU_TILTS[i - 1]! + tilt) / 2 : null,
    high: i < MENU_TILTS.length - 1 ? (tilt + MENU_TILTS[i + 1]!) / 2 : null,
  };
}

export function tiltBandText(tilt: number): string {
  const { low, high } = tiltBand(tilt);
  if (low === null) return `below ${high} deg`;
  if (high === null) return `above ${low} deg`;
  return `between ${low} and ${high} deg`;
}

/**
 * Which throttle level each wording of the 'safe vertical speed now' line
 * calls for, in that line's own words. Throttle 2 (4.2 m/s2) roughly
 * balances gravity (3.2 m/s2); the thresholds match the old controller's
 * gain, which lands 99% of levels.
 */
export const VERTICAL_FITS: readonly string[] = [
  "more than 1.5 m/s too much upward",
  "up to 1.5 m/s too much upward",
  "about right",
  "up to 3 m/s too much downward",
  "more than 3 m/s too much downward",
];

/** When a manoeuvre fits, in the words of the tier 4 coaching lines. */
export function fitsText(m: Manoeuvre): string {
  return `Fits when 'good tilt now' is ${tiltBandText(m.tilt)} and the vertical speed is ${VERTICAL_FITS[m.throttle]}.`;
}

export function argmax(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i]! > values[best]!) best = i;
  return best;
}
