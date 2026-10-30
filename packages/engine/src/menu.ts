import { MENU_TILTS, THROTTLE_LEVELS } from "./config.ts";
import type { Action, Lander, Manoeuvre, Throttle } from "./types.ts";

/**
 * The fixed menu every lane picks from, ordered tilt-major: index
 * `tilt * THROTTLE_LEVELS + throttle`. Lanes and recordings refer to a
 * manoeuvre by its index.
 */
export const MANOEUVRES: readonly Manoeuvre[] = MENU_TILTS.flatMap((tilt) =>
  Array.from({ length: THROTTLE_LEVELS }, (_, throttle) => ({ tilt, throttle: throttle as Throttle })),
);

export function manoeuvreIndex(m: Manoeuvre): number {
  const i = MANOEUVRES.findIndex((x) => x.tilt === m.tilt && x.throttle === m.throttle);
  if (i < 0) throw new RangeError(`not on the menu: tilt ${m.tilt}, throttle ${m.throttle}`);
  return i;
}

/** The physics step that flies a manoeuvre: turn toward its tilt, burn at its throttle. */
export function controlFor(l: Lander, m: Manoeuvre): Action {
  const rotate = m.tilt > l.angle ? "right" : m.tilt < l.angle ? "left" : "none";
  return { rotate, throttle: m.throttle };
}
