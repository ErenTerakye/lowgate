/**
 * Deterministic math helpers. The simulation must produce bit-identical
 * results in every JS engine so replays re-simulate exactly. Math.sin/cos
 * are implementation-defined, so trigonometry comes from a table built
 * with plain IEEE-754 arithmetic (+, *, /), which every engine rounds the same way.
 */
import { MAX_TILT_DEG } from "./config.ts";

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function taylorSin(rad: number): number {
  const r2 = rad * rad;
  let term = rad;
  let sum = rad;
  for (let n = 1; n < 12; n++) {
    term *= -r2 / (2 * n * (2 * n + 1));
    sum += term;
  }
  return sum;
}

const PI = 3.141592653589793;
/** sin at half-degree resolution for angles in [-MAX_TILT_DEG, MAX_TILT_DEG]. */
const SIN_TABLE: readonly number[] = Array.from({ length: MAX_TILT_DEG * 4 + 1 }, (_, i) =>
  taylorSin(((i - MAX_TILT_DEG * 2) / 2) * (PI / 180)),
);

function tableIndex(deg: number): number {
  const i = Math.round(deg * 2) + MAX_TILT_DEG * 2;
  if (i < 0 || i >= SIN_TABLE.length) throw new RangeError(`angle out of range: ${deg}`);
  return i;
}

export function sinDeg(deg: number): number {
  return SIN_TABLE[tableIndex(deg)]!;
}

export function cosDeg(deg: number): number {
  // cos(a) = sin(90° - a) would leave the table; use the identity on |a| instead.
  const s = sinDeg(deg);
  return Math.sqrt(1 - s * s);
}
