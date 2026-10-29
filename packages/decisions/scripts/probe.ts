/**
 * Measures a model lane with real calls: latency, tokens, cost, the model
 * actually served, and how well it flies.
 *
 *   pnpm probe --lane jev --prompt p2 --calls 30     answers on autopilot states
 *   pnpm probe --lane jev --prompt p2 --fly 2        flies 2 levels, closed loop
 *   pnpm probe --lane llama --calls 30               LLM lanes use the prompt's observation tier
 *
 * Calls go one at a time, straight to the provider, using the key from the
 * repo's .env. In --fly mode the world waits for each answer (no deadline),
 * which isolates decision quality from latency. Results go to
 * measurements/<lane>-<prompt>-<mode>-<timestamp>.jsonl.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DECISION_HZ, IDLE, PHYSICS_HZ, autopilot, createLane, needsDecision, stepLane, type Action, type LaneState } from "@arena/engine";
import {
  FATAL_ERRORS,
  LLM_PROMPTS,
  LlmJsonClient,
  MODEL_LANES,
  PROMPTS,
  SystemOneClient,
  isLlmPromptId,
  isPromptId,
  observe,
  percentile,
  resolveUpstream,
  usdFor,
  type Decision,
  type DecisionClient,
  type DecisionResult,
} from "../src/index.ts";

const { values } = parseArgs({
  options: {
    lane: { type: "string", default: "jev" },
    prompt: { type: "string" },
    calls: { type: "string", default: "30" },
    fly: { type: "string" },
    seed: { type: "string", default: "42" },
  },
});
const lane = MODEL_LANES[values.lane];
if (!lane) throw new Error(`Unknown lane "${values.lane}". Known: ${Object.keys(MODEL_LANES).join(", ")}`);
// Defaults to the lane's own tuned prompt; System One and chat lanes have separate prompt sets.
const promptId = values.prompt ?? lane.prompt;
const known = lane.protocol === "systemone" ? PROMPTS : LLM_PROMPTS;
if (!(lane.protocol === "systemone" ? isPromptId(promptId) : isLlmPromptId(promptId))) {
  throw new Error(`Unknown prompt "${promptId}" for ${lane.label}. Known: ${Object.keys(known).join(", ")}`);
}
const prompt = (known as Record<string, { id: string; tier: 1 | 2 | 3 | 4; summary: string; compact?: boolean }>)[promptId]!;
const seed = Number(values.seed);
const key = lane.keyEnv ? process.env[lane.keyEnv] : undefined;
const upstream = resolveUpstream(lane, process.env);
const missing = lane.keyEnv && !key ? lane.keyEnv : "missing" in upstream ? upstream.missing : null;
if (missing || "missing" in upstream) {
  console.error(`${missing} is not set. Add it to .env at the repo root (see .env.example).`);
  process.exit(1);
}

const common = { id: lane.id, label: lane.label, model: lane.model, endpoint: upstream.url, timeoutMs: 5000, ...(key ? { apiKey: key } : {}) };
const client: DecisionClient = lane.protocol === "systemone" ? new SystemOneClient({ ...common, prompt: promptId as keyof typeof PROMPTS }) : new LlmJsonClient({ ...common, prompt: promptId as keyof typeof LLM_PROMPTS, ...(lane.requestExtras ? { requestExtras: lane.requestExtras } : {}) });
const signal = new AbortController().signal;
const records: Record<string, unknown>[] = [];
const decisions: { d: Decision; expected: Action }[] = [];
const errors: string[] = [];
let stoppedBy: string | null = null;

async function ask(state: LaneState, i: number): Promise<DecisionResult> {
  const result = await client.decide({ lane: state, tick: i, signal });
  const expected = autopilot(state.level, state.lander);
  if (result.ok) {
    const d = result.decision;
    decisions.push({ d, expected });
    records.push({ i, latencyMs: Math.round(d.latencyMs), servedModel: d.servedModel, usage: d.usage, probs: d.probs, action: d.action, autopilot: expected });
  } else {
    errors.push(result.error.kind);
    records.push({ i, latencyMs: Math.round(result.latencyMs), error: result.error, autopilot: expected });
    if (FATAL_ERRORS.has(result.error.kind)) stoppedBy = result.error.message;
  }
  process.stdout.write(result.ok ? "." : "x");
  return result;
}

/** Decision-tick states from an autopilot flight, so the model sees realistic situations. */
function sampleStates(count: number): LaneState[] {
  let state = createLane(seed, 120);
  const all: LaneState[] = [];
  let action: Action = IDLE;
  while (!state.finished) {
    if (needsDecision(state)) {
      all.push(state);
      action = autopilot(state.level, state.lander);
    }
    state = stepLane(state, action);
  }
  const stride = Math.max(1, Math.floor(all.length / count));
  return all.filter((_, i) => i % stride === 0).slice(0, count);
}

interface Flight {
  level: number;
  outcome: string;
  seconds: number;
  calls: number;
  touchdown: { vx: number; vy: number; angle: number } | null;
}

/** Flies `levels` levels; the model's answer is used on the tick it was asked about. */
async function fly(levels: number): Promise<Flight[]> {
  let state = createLane(seed, 60 * 10);
  const flights: Flight[] = [];
  let action: Action = IDLE;
  let calls = 0;
  let i = 0;
  while (!state.finished && flights.length < levels && !stoppedBy) {
    if (needsDecision(state)) {
      const r = await ask(state, i++);
      calls++;
      if (r.ok) action = r.decision.action;
    }
    const before = state;
    state = stepLane(state, action);
    if (state.outcome !== null && before.outcome === null) {
      const l = state.lander;
      flights.push({
        level: state.level.index + 1,
        outcome: state.outcome,
        seconds: l.t / PHYSICS_HZ,
        calls,
        touchdown: state.outcome === "out_of_bounds" || state.outcome === "timeout" ? null : { vx: l.vx, vy: l.vy, angle: l.angle },
      });
      calls = 0;
      action = IDLE;
    }
  }
  return flights;
}

const mode = values.fly ? "fly" : "answers";
console.log(`Probing ${lane.label} (${lane.model.model}), prompt ${prompt.id}: ${prompt.summary}`);
let flights: Flight[] = [];
if (values.fly) {
  flights = await fly(Math.min(5, Math.max(1, Number(values.fly))));
} else {
  const states = sampleStates(Math.min(200, Math.max(1, Number(values.calls))));
  for (const [i, state] of states.entries()) {
    await ask(state, i);
    if (stoppedBy) break;
  }
}
console.log(stoppedBy ? `\nStopped: ${stoppedBy}` : "");

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function correlation(xs: number[], ys: number[]): number | null {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    const y = ys[i]!;
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  });
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

const latencies = decisions.map((r) => r.d.latencyMs);
const meanIn = mean(decisions.flatMap((r) => (r.d.usage ? [r.d.usage.inputTokens] : [])));
const meanOut = mean(decisions.flatMap((r) => (r.d.usage ? [r.d.usage.outputTokens] : [])));
const costPerCall = usdFor(meanIn, meanOut, lane.model.price);
const served = [...new Set(decisions.map((r) => r.d.servedModel ?? "(not reported)"))];
const p95 = percentile(latencies, 95);
const withProbs = decisions.filter((r) => r.d.probs);
/** Expected throttle from probabilities; for lanes that only pick (LLMs), the pick itself. */
const throttleOf = (d: Decision): number => (d.probs ? d.probs.throttle.reduce((sum, p, i) => sum + p * i, 0) : d.action.throttle);
const topOrNull = (xs: number[]): number | null => (withProbs.length ? mean(xs) : null);
const share = (pred: (r: (typeof decisions)[number]) => boolean): number => decisions.filter(pred).length / (decisions.length || 1);

const summary = {
  lane: lane.id,
  model: lane.model.model,
  prompt: prompt.id,
  promptSummary: prompt.summary,
  mode,
  seed,
  servedModels: served,
  pinHeld: served.every((m) => m === lane.model.model),
  calls: records.length,
  ok: decisions.length,
  errors: Object.fromEntries([...new Set(errors)].map((k) => [k, errors.filter((e) => e === k).length])),
  latencyMs: { p50: percentile(latencies, 50), p95, max: latencies.length ? Math.max(...latencies) : null, source: "measured" },
  inputTokensPerCall: Math.round(meanIn),
  outputTokensPerCall: Math.round(meanOut),
  costUsd: { perCall: costPerCall, per1kDecisions: costPerCall * 1000, perHourAt5Hz: costPerCall * DECISION_HZ * 3600, priceSource: lane.model.price.source },
  fitsTick: p95 !== null ? p95 < 1000 / DECISION_HZ : null,
  agreesWithAutopilot: { rotate: share((r) => r.d.action.rotate === r.expected.rotate), throttle: share((r) => r.d.action.throttle === r.expected.throttle) },
  throttle: {
    /** Does the model's expected throttle rise and fall with what the situation needs? */
    correlationWithAutopilot: correlation(decisions.map((r) => throttleOf(r.d)), decisions.map((r) => r.expected.throttle)),
    meanTopProbability: topOrNull(withProbs.map((r) => Math.max(...r.d.probs!.throttle))),
    picks: [0, 1, 2, 3, 4].map((t) => decisions.filter((r) => r.d.action.throttle === t).length),
  },
  rotateMeanTopProbability: topOrNull(withProbs.map((r) => Math.max(...Object.values(r.d.probs!.rotate)))),
  flights,
  observationChars: observe(createLane(seed), prompt.tier, { compact: prompt.compact ?? false }).length,
  at: new Date().toISOString(),
};

mkdirSync("measurements", { recursive: true });
const file = `measurements/${lane.id}-${prompt.id}-${mode}-${summary.at.replace(/[:.]/g, "-")}.jsonl`;
writeFileSync(file, [JSON.stringify({ summary }), ...records.map((r) => JSON.stringify(r))].join("\n") + "\n");

const ms = (n: number | null) => (n === null ? "—" : `${Math.round(n)} ms`);
const pct = (n: number | null) => (n === null ? "— (picks only)" : `${Math.round(n * 100)}%`);
const corr = summary.throttle.correlationWithAutopilot;
console.log(`${lane.label} ${lane.model.model}, prompt ${prompt.id}   served: ${served.join(", ")}${summary.pinHeld ? "" : "   ⚠ differs from the pin"}
calls       ${decisions.length}/${records.length} ok${errors.length ? `, errors: ${JSON.stringify(summary.errors)}` : ""}
latency     p50 ${ms(summary.latencyMs.p50)}   p95 ${ms(p95)}   max ${ms(summary.latencyMs.max)}   (measured, from this machine)
tokens      ${summary.inputTokensPerCall} in, ${summary.outputTokensPerCall} out per call (measured); observation ${summary.observationChars} chars
cost        $${summary.costUsd.per1kDecisions.toFixed(4)} per 1k decisions (price: ${lane.model.price.source})
rotate      agrees ${pct(summary.agreesWithAutopilot.rotate)} with autopilot, top probability ${pct(summary.rotateMeanTopProbability)} on average
throttle    agrees ${pct(summary.agreesWithAutopilot.throttle)}, follows the situation r = ${corr === null ? "—" : corr.toFixed(2)}, top probability ${pct(summary.throttle.meanTopProbability)}, picks Off..Full ${summary.throttle.picks.join("/")}`);
for (const f of flights) {
  const td = f.touchdown ? `  touchdown vx ${f.touchdown.vx.toFixed(1)}, vy ${f.touchdown.vy.toFixed(1)}, angle ${f.touchdown.angle.toFixed(1)}` : "";
  console.log(`flight      level ${f.level}: ${f.outcome} after ${f.seconds.toFixed(1)} s, ${f.calls} calls${td}`);
}
console.log(`saved       ${file}`);
