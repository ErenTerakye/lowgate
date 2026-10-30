/**
 * Flies a lane with real calls on the manoeuvre menu and measures it:
 * outcomes, answered decisions, retries, latency, tokens, cost, the model
 * actually served, and how often it picks what the autopilot would.
 *
 *   pnpm probe --lane jev                     one level of course 42, the lane's own prompt
 *   pnpm probe --lane qwen --prompt c1 --levels 2 --seed 7
 *   pnpm probe --lane autopilot               no model, no key
 *
 * Calls go one at a time, straight to the provider, with the key from the
 * repo's .env, through the same runner as the benchmark: the game waits for
 * each answer, and failures follow the retry and stop rules. Results go to
 * measurements/<lane>-<prompt>-menu-<timestamp>.jsonl.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { COURSE_LEVELS, MANOEUVRES, autopilot, createLane, summarize } from "@arena/engine";
import {
  LLM_PROMPTS,
  LlmJsonClient,
  MODEL_LANES,
  OPTION_KEYS,
  PROMPTS,
  SystemOneClient,
  autopilotClient,
  flyCourse,
  isLlmPromptId,
  isPromptId,
  observe,
  observePrompt,
  usdFor,
  type DecisionClient,
  type DecisionRecord,
} from "../src/index.ts";

const { values } = parseArgs({
  options: {
    lane: { type: "string", default: "jev" },
    prompt: { type: "string" },
    levels: { type: "string", default: "1" },
    seed: { type: "string", default: "42" },
  },
});
const seed = Number(values.seed);
const levels = Math.min(COURSE_LEVELS, Math.max(1, Number(values.levels)));
/** Decisions per lane for the 20-course benchmark, at the autopilot's pace (docs/redesign.md). */
const BENCH_DECISIONS = 5600;

function makeClient(): { client: DecisionClient; promptId: string; promptChars: number | null } {
  if (values.lane === "autopilot") return { client: autopilotClient, promptId: "none", promptChars: null };
  const lane = MODEL_LANES[values.lane];
  if (!lane) throw new Error(`Unknown lane "${values.lane}". Known: autopilot, ${Object.keys(MODEL_LANES).join(", ")}`);
  const promptId = values.prompt ?? lane.prompt;
  const key = lane.keyEnv ? process.env[lane.keyEnv] : undefined;
  if (lane.keyEnv && !key) fail(`${lane.keyEnv} is not set. Add it to .env at the repo root (see .env.example).`);
  const account = lane.accountEnv ? process.env[lane.accountEnv] : undefined;
  if (lane.accountEnv && !account) fail(`${lane.accountEnv} is not set. Add it to .env at the repo root (see .env.example).`);
  const endpoint = account ? lane.upstream.replace("{account}", encodeURIComponent(account)) : lane.upstream;
  const common = { id: lane.id, label: lane.label, model: lane.model, endpoint, ...(key ? { apiKey: key } : {}) };
  const start = createLane(seed);
  if (lane.protocol === "systemone") {
    if (!isPromptId(promptId)) fail(`Unknown prompt "${promptId}" for ${lane.label}. Known: ${Object.keys(PROMPTS).join(", ")}`);
    const spec = PROMPTS[promptId as keyof typeof PROMPTS];
    const q = spec.questions.manoeuvre;
    const chars = observePrompt(start, spec).length + q.instructions.length + Object.entries(q.criteria).flat().join(" ").length;
    return { client: new SystemOneClient({ ...common, prompt: spec.id }), promptId, promptChars: chars };
  }
  if (!isLlmPromptId(promptId)) fail(`Unknown prompt "${promptId}" for ${lane.label}. Known: ${Object.keys(LLM_PROMPTS).join(", ")}`);
  const spec = LLM_PROMPTS[promptId as keyof typeof LLM_PROMPTS];
  const client = new LlmJsonClient({ ...common, prompt: spec.id, ...(lane.requestExtras ? { requestExtras: lane.requestExtras } : {}) });
  return { client, promptId, promptChars: spec.system.length + observe(start, spec.tier).length };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { client, promptId, promptChars } = makeClient();
const model = client.model;
console.log(`Probing ${client.label}${model ? ` (${model.model})` : ""}, prompt ${promptId}: ${levels} level(s) of course ${seed}`);

const records: (DecisionRecord & { autopilot: number })[] = [];
const run = await flyCourse(client, seed, {
  levels,
  onDecision: (record, lane) => {
    records.push({ ...record, autopilot: autopilot(lane.level, lane.lander) });
    process.stdout.write(record.answered ? (record.retries ? "r" : ".") : "x");
  },
});
console.log(run.stoppedBy ? `\nStopped: ${run.stoppedBy.kind}: ${run.stoppedBy.message}` : "");

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
const answered = records.filter((r) => r.answered);
const share = (pred: (r: (typeof records)[number]) => boolean): number | null => (answered.length ? answered.filter(pred).length / answered.length : null);
const latencies = answered.map((r) => r.latencyMs);
const inTokens = mean(answered.flatMap((r) => (r.usage ? [r.usage.inputTokens] : [])));
const outTokens = mean(answered.flatMap((r) => (r.usage ? [r.usage.outputTokens] : [])));
const perDecisionUsd = model && inTokens !== null ? usdFor(inTokens, outTokens ?? 0, model.price) : null;
const served = [...new Set(answered.map((r) => r.servedModel ?? "(not reported)"))];
const errors = records.flatMap((r) => (r.error ? [r.error.kind] : []));
const withProbs = answered.filter((r) => r.probs);
const course = summarize(run.results);

const summary = {
  lane: client.id,
  model: model?.model ?? null,
  prompt: promptId,
  seed,
  levels,
  results: run.results,
  notFlown: run.notFlown,
  stoppedBy: run.stoppedBy,
  landed: course.landed,
  meanQuality: course.meanQuality,
  decisions: records.length,
  answered: answered.length,
  retried: records.filter((r) => r.retries > 0).length,
  errors: Object.fromEntries([...new Set(errors)].map((k) => [k, errors.filter((e) => e === k).length])),
  servedModels: served,
  pinHeld: model ? served.every((m) => m === model.model) : null,
  latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: latencies.length ? Math.max(...latencies) : null, source: "measured" },
  tokensPerDecision: { input: inTokens, output: outTokens, source: "measured (provider-reported)" },
  costUsd: perDecisionUsd === null ? null : { perDecision: perDecisionUsd, perBenchmark: perDecisionUsd * BENCH_DECISIONS, priceSource: model!.price.source },
  agreesWithAutopilot: {
    exact: share((r) => r.pick === r.autopilot),
    tilt: share((r) => MANOEUVRES[r.pick]!.tilt === MANOEUVRES[r.autopilot]!.tilt),
    throttle: share((r) => MANOEUVRES[r.pick]!.throttle === MANOEUVRES[r.autopilot]!.throttle),
  },
  meanTopProbability: withProbs.length ? mean(withProbs.map((r) => Math.max(...r.probs!))) : null,
  distinctPicks: new Set(answered.map((r) => r.pick)).size,
  promptChars,
  at: new Date().toISOString(),
};

mkdirSync("measurements", { recursive: true });
const file = `measurements/${client.id}-${promptId}-menu-${summary.at.replace(/[:.]/g, "-")}.jsonl`;
writeFileSync(file, [JSON.stringify({ summary }), ...records.map((r) => JSON.stringify(r))].join("\n") + "\n");

const ms = (n: number | null) => (n === null ? "–" : `${Math.round(n)} ms`);
const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 100)}%`);
const a = summary.agreesWithAutopilot;
console.log(`${client.label}${model ? ` ${model.model}` : ""}, prompt ${promptId}${model ? `   served: ${served.join(", ")}${summary.pinHeld ? "" : "   (differs from the pin)"}` : ""}
decisions   ${answered.length}/${records.length} answered, ${summary.retried} retried${errors.length ? `, errors: ${JSON.stringify(summary.errors)}` : ""}
latency     p50 ${ms(summary.latencyMs.p50)}   p95 ${ms(summary.latencyMs.p95)}   max ${ms(summary.latencyMs.max)}   (measured, from this machine)
tokens      ${inTokens === null ? "not reported" : `${Math.round(inTokens)} in, ${Math.round(outTokens ?? 0)} out per decision (provider-reported)`}; prompt ${promptChars ?? "–"} chars
cost        ${perDecisionUsd === null ? "–" : `$${(perDecisionUsd * 1000).toFixed(4)} per 1k decisions, about $${(perDecisionUsd * BENCH_DECISIONS).toFixed(2)} for the benchmark (price: ${model!.price.source})`}
picks       ${summary.distinctPicks} distinct of ${OPTION_KEYS.length}; same as the autopilot ${pct(a.exact)} (tilt ${pct(a.tilt)}, throttle ${pct(a.throttle)}); top probability ${withProbs.length ? pct(summary.meanTopProbability) : "– (picks only)"}`);
for (const r of run.results) {
  const detail = r.landing ? `landed, quality ${r.landing.quality.toFixed(1)}, ${r.landing.offset.toFixed(1)} m off centre` : r.outcome;
  console.log(`level ${r.index + 1}     ${detail} after ${r.seconds.toFixed(0)} s, ${r.decisions} decisions`);
}
for (const i of run.notFlown) console.log(`level ${i + 1}     not flown`);
console.log(`saved       ${file}`);
