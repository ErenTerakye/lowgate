import { ENGINE_VERSION, MANOEUVRES, autopilot, type Outcome } from "@lowgate/engine";
import { usdFor } from "./cost.ts";
import { replayRecording, type Recording } from "./recording.ts";
import { meanSpread, percentile, wilson, type Interval, type MeanSpread } from "./stats.ts";
import type { HostedPrice, ModelInfo, PriceSource } from "./types.ts";

/** One lane's benchmark figures, as bench/results.json stores them and the results page reads them. */
export interface LaneResult {
  readonly lane: string;
  readonly label: string;
  readonly model: ModelInfo | null;
  readonly prompts: readonly string[];
  readonly servedModels: readonly string[];
  readonly courses: number;
  readonly levels: number;
  readonly landed: number;
  readonly landingRate: number;
  readonly landingRate95: Interval | null;
  /** Landings on each course flown, in course order. */
  readonly perCourse: readonly { readonly seed: number; readonly landed: number }[];
  readonly quality: MeanSpread | null;
  readonly outcomes: Readonly<Partial<Record<Outcome, number>>>;
  readonly decisions: number;
  readonly unanswered: number;
  readonly retried: number;
  readonly agreesWithAutopilot: { readonly exact: number; readonly tilt: number; readonly throttle: number };
  readonly meanTopProbability: number | null;
  readonly latencyMs: { readonly p50: number | null; readonly p95: number | null; readonly source: "measured, from this machine" };
  readonly tokensPerDecision: { readonly input: number; readonly output: number; readonly source: "provider-reported" } | null;
  readonly costUsd: { readonly total: number; readonly priceSource: PriceSource } | null;
  /** For a local lane: the measured tokens at a hosted API's price for the same model. The benchmark paid nothing. */
  readonly hostedEquivalentUsd: { readonly total: number; readonly price: HostedPrice } | null;
  /** Mean seconds per course spent waiting for answers, measured. The game waits, so this is wall time, not score. */
  readonly answerSecondsPerCourse: number;
}

export interface BenchResults {
  readonly engine: string;
  readonly courses: readonly number[];
  readonly ranking: string;
  readonly lanes: readonly LaneResult[];
  readonly at: string;
}

/** Ranking: landing rate, ties broken by mean landing quality. */
export function rankLanes(lanes: readonly LaneResult[]): LaneResult[] {
  return [...lanes].sort((a, b) => b.landingRate - a.landingRate || (b.quality?.mean ?? 0) - (a.quality?.mean ?? 0));
}

/**
 * Summarises one lane's recordings. Each is replayed first, which both proves
 * it matches its state hashes and gives the state each decision was asked at,
 * for agreement with the autopilot. Throws on a recording that does not replay.
 */
export function summarizeLane(recordings: readonly Recording[], options: { readonly hostedEquivalent?: HostedPrice } = {}): LaneResult {
  const recs = [...recordings].sort((a, b) => a.seed - b.seed);
  const first = recs[0];
  if (!first) throw new Error("summarizeLane needs at least one recording");
  let exact = 0;
  let tilt = 0;
  let throttle = 0;
  for (const rec of recs) {
    if (rec.lane !== first.lane) throw new Error(`recordings mix lanes ${first.lane} and ${rec.lane}`);
    const check = replayRecording(rec, (lane, d) => {
      if (!d.answered) return;
      const a = MANOEUVRES[autopilot(lane.level, lane.lander)]!;
      const m = MANOEUVRES[d.pick]!;
      if (m.tilt === a.tilt) tilt++;
      if (m.throttle === a.throttle) throttle++;
      if (m.tilt === a.tilt && m.throttle === a.throttle) exact++;
    });
    if (!check.ok) throw new Error(`${rec.lane} course ${rec.seed} does not replay: ${check.reason}`);
  }
  const results = recs.flatMap((r) => r.results);
  const decisions = recs.flatMap((r) => r.decisions);
  const answered = decisions.filter((d) => d.answered);
  const perCourse = recs.map((r) => ({ seed: r.seed, landed: r.results.filter((x) => x.landing).length }));
  const landed = perCourse.reduce((n, c) => n + c.landed, 0);
  const outcomes: Partial<Record<Outcome, number>> = {};
  for (const r of results) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  const withUsage = answered.flatMap((d) => (d.usage ? [d.usage] : []));
  const withProbs = answered.flatMap((d) => (d.probs ? [d.probs] : []));
  const share = (n: number) => (answered.length ? n / answered.length : 0);
  const model = first.model;
  const tokenCost = (price: ModelInfo["price"] | HostedPrice) =>
    withUsage.reduce((a, u) => a + usdFor(u.inputTokens, u.outputTokens, price), 0);
  const hosted = options.hostedEquivalent;
  return {
    lane: first.lane,
    label: first.label,
    model,
    prompts: [...new Set(recs.map((r) => r.prompt))],
    servedModels: [...new Set(answered.flatMap((d) => (d.servedModel ? [d.servedModel] : [])))],
    courses: recs.length,
    levels: results.length,
    landed,
    landingRate: results.length ? landed / results.length : 0,
    landingRate95: wilson(landed, results.length),
    perCourse,
    quality: meanSpread(results.flatMap((r) => (r.landing ? [r.landing.quality] : []))),
    outcomes,
    decisions: decisions.length,
    unanswered: decisions.length - answered.length,
    retried: decisions.filter((d) => d.retries > 0).length,
    agreesWithAutopilot: { exact: share(exact), tilt: share(tilt), throttle: share(throttle) },
    meanTopProbability: withProbs.length ? withProbs.reduce((a, p) => a + Math.max(...p), 0) / withProbs.length : null,
    latencyMs: { p50: percentile(answered.map((d) => d.latencyMs), 50), p95: percentile(answered.map((d) => d.latencyMs), 95), source: "measured, from this machine" },
    tokensPerDecision: withUsage.length
      ? {
          input: withUsage.reduce((a, u) => a + u.inputTokens, 0) / withUsage.length,
          output: withUsage.reduce((a, u) => a + u.outputTokens, 0) / withUsage.length,
          source: "provider-reported",
        }
      : null,
    costUsd: model ? { total: tokenCost(model.price), priceSource: model.price.source } : null,
    hostedEquivalentUsd: hosted && withUsage.length ? { total: tokenCost(hosted), price: hosted } : null,
    answerSecondsPerCourse: decisions.reduce((a, d) => a + d.latencyMs, 0) / 1000 / recs.length,
  };
}

export function benchResults(courses: readonly number[], lanes: readonly LaneResult[], at = new Date()): BenchResults {
  return { engine: ENGINE_VERSION, courses, ranking: "landing rate, then mean landing quality", lanes: rankLanes(lanes), at: at.toISOString() };
}
