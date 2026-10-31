import { argmax } from "./menu.ts";
import { percentile, wilson, type Interval } from "./stats.ts";

/** One recorded decision asked again of another build of the same model, at the same state. */
export interface ReplayedAnswer {
  readonly recordedPick: number;
  readonly recordedProbs: readonly number[];
  readonly probs: readonly number[];
  readonly latencyMs: number;
}

export interface AgreementReport {
  readonly decisions: number;
  /** Share of decisions where both builds pick the same manoeuvre, with a Wilson 95% interval. */
  readonly samePick: { readonly count: number; readonly rate: number; readonly interval: Interval | null };
  /** Total variation distance between the two probability vectors: 0 is identical, 1 is disjoint. */
  readonly distance: { readonly mean: number; readonly p95: number; readonly max: number };
  /** On the decisions where the picks differ: how close the recorded build's top two options were. */
  readonly recordedMarginWhenDifferent: { readonly median: number | null };
  readonly latencyMs: { readonly p50: number | null; readonly p95: number | null };
}

export function totalVariation(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error(`probability vectors differ in length: ${a.length} and ${b.length}`);
  return a.reduce((sum, p, i) => sum + Math.abs(p - b[i]!), 0) / 2;
}

/** Gap between the largest and second-largest probability: small means a near tie, which rounding alone can flip. */
export function topMargin(probs: readonly number[]): number {
  const [first = 0, second = 0] = [...probs].sort((x, y) => y - x);
  return first - second;
}

export function agreementReport(answers: readonly ReplayedAnswer[]): AgreementReport {
  const same = answers.filter((a) => argmax(a.probs) === a.recordedPick).length;
  const distances = answers.map((a) => totalVariation(a.recordedProbs, a.probs));
  const margins = answers.filter((a) => argmax(a.probs) !== a.recordedPick).map((a) => topMargin(a.recordedProbs));
  return {
    decisions: answers.length,
    samePick: { count: same, rate: answers.length ? same / answers.length : 0, interval: wilson(same, answers.length) },
    distance: {
      mean: distances.length ? distances.reduce((s, d) => s + d, 0) / distances.length : 0,
      p95: percentile(distances, 95) ?? 0,
      max: distances.length ? Math.max(...distances) : 0,
    },
    recordedMarginWhenDifferent: { median: percentile(margins, 50) },
    latencyMs: { p50: percentile(answers.map((a) => a.latencyMs), 50), p95: percentile(answers.map((a) => a.latencyMs), 95) },
  };
}
