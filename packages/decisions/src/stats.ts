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

/** Two-sided exact sign test: the chance of a split at least this uneven if each non-tied pair were a coin flip. */
export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  let term = 0.5 ** n;
  let tail = term;
  for (let k = 1; k <= Math.min(wins, losses); k++) {
    term *= (n - k + 1) / k;
    tail += term;
  }
  return Math.min(1, 2 * tail);
}

/** Holm's step-down adjustment for testing several hypotheses at once; the result is in the order of `ps`. */
export function holm(ps: readonly number[]): number[] {
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  const adjusted = new Array<number>(ps.length).fill(1);
  let highest = 0;
  order.forEach(({ p, i }, rank) => {
    highest = Math.max(highest, Math.min(1, (ps.length - rank) * p));
    adjusted[i] = highest;
  });
  return adjusted;
}

const BOOTSTRAP_RESAMPLES = 10_000;

/**
 * Percentile bootstrap 95% interval of the sum of `xs`, resampling the items with replacement. The generator is seeded
 * the same way every call (mulberry32), so a results file built from the same recordings stays byte-identical.
 */
export function bootstrapSum95(xs: readonly number[]): Interval | null {
  if (xs.length === 0) return null;
  let state = 0x1f123bb5;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sums: number[] = [];
  for (let r = 0; r < BOOTSTRAP_RESAMPLES; r++) {
    let sum = 0;
    for (let i = 0; i < xs.length; i++) sum += xs[Math.floor(next() * xs.length)]!;
    sums.push(sum);
  }
  sums.sort((a, b) => a - b);
  return { low: sums[Math.floor(BOOTSTRAP_RESAMPLES * 0.025)]!, high: sums[Math.ceil(BOOTSTRAP_RESAMPLES * 0.975) - 1]! };
}
