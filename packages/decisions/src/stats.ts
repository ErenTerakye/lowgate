/** Spread for the benchmark's results table: every rate and mean is shown with a 95% interval. */

const Z95 = 1.959964;

export interface Interval {
  readonly low: number;
  readonly high: number;
}

/** Wilson score interval for `successes` of `n`, which stays inside 0–1 near the ends. */
export function wilson(successes: number, n: number): Interval | null {
  if (n === 0) return null;
  const p = successes / n;
  const denom = 1 + (Z95 * Z95) / n;
  const centre = (p + (Z95 * Z95) / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + (Z95 * Z95) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface MeanSpread {
  readonly mean: number;
  /** Sample standard deviation; 0 for a single value. */
  readonly sd: number;
  /** Normal-approximation 95% interval of the mean. */
  readonly ci: Interval;
  readonly n: number;
}

export function meanSpread(xs: readonly number[]): MeanSpread | null {
  if (xs.length === 0) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1)) : 0;
  const half = (Z95 * sd) / Math.sqrt(xs.length);
  return { mean, sd, ci: { low: mean - half, high: mean + half }, n: xs.length };
}

/** Nearest-rank percentile, `p` in 0–100. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
