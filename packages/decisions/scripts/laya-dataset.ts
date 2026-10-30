/**
 * Builds Laya's fine-tuning data for the menu: decision states labelled with
 * the autopilot's manoeuvre, in the {state, questions, gold} rows laya.train
 * reads. The prompt must split the menu into a tilt choice and a throttle
 * score (f3 by default), the shape Laya v1 and v2 learned.
 *
 *   pnpm laya-dataset                       -> bridge/laya/data/f3/{train,eval}.jsonl
 *   pnpm laya-dataset --prompt f1 --seeds 60
 *
 * Flights are the autopilot with noise: now and then it flies a random
 * manoeuvre for a second or two, so the data also covers states the autopilot
 * alone never reaches (drifting, tilted, too fast) and how to recover from
 * them. The label is always the clean autopilot pick for that state.
 *
 * Training (3000-3119) and eval (9000-9011) use disjoint courses, and neither
 * includes course 42 or the held-out probe courses 1001 and 1002, so probes
 * and the benchmark score Laya on courses it never saw.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { MANOEUVRES, createLane, createRng, decisionInLevel, flyDecision, needsDecision, nextLevel, type Rng } from "@arena/engine";
import { FINAL_DESCENT_M, heightAboveGround, labelledRow, layaPrompt, tally } from "./laya-labels.ts";

const { values } = parseArgs({
  options: {
    prompt: { type: "string", default: "f3" },
    seeds: { type: "string", default: "120" },
    "eval-seeds": { type: "string", default: "12" },
    every: { type: "string", default: "3" },
    out: { type: "string" },
  },
});
const prompt = layaPrompt(values.prompt);
const outDir = values.out ?? `bridge/laya/data/${prompt.id}`;
const EXCLUDED = new Set([42, 1001, 1002]);
/** Chance per decision of starting a random manoeuvre, and for how many decisions it is held. */
const NOISE = { start: 0.1, minDecisions: 1, maxDecisions: 2 };
interface SeedRows {
  rows: string[];
  picks: number[];
  finalDescent: number;
  landed: number;
}

function rowsForSeed(seed: number): SeedRows {
  const rng: Rng = createRng(seed ^ 0x5eed);
  const every = Number(values.every);
  let lane = createLane(seed);
  let noisy = 0;
  let noisePick = 0;
  const out: SeedRows = { rows: [], picks: [], finalDescent: 0, landed: 0 };
  while (!lane.finished) {
    if (!needsDecision(lane)) {
      lane = nextLevel(lane);
      continue;
    }
    const { row, pick: label } = labelledRow(lane, prompt);
    // Offset by seed and level so samples do not all fall on the same phase of each flight.
    if ((decisionInLevel(lane) + seed + lane.level.index) % every === 0) {
      out.rows.push(row);
      out.picks.push(label);
      if (heightAboveGround(lane) < FINAL_DESCENT_M) out.finalDescent++;
    }
    if (noisy === 0 && rng.next() < NOISE.start) {
      noisy = rng.int(NOISE.minDecisions, NOISE.maxDecisions);
      noisePick = rng.int(0, MANOEUVRES.length - 1);
    }
    const pick = noisy > 0 ? noisePick : label;
    if (noisy > 0) noisy--;
    lane = flyDecision(lane, MANOEUVRES[pick]!);
  }
  out.landed = lane.results.filter((r) => r.landing).length;
  return out;
}

function build(seeds: number[]) {
  const runs = seeds.filter((s) => !EXCLUDED.has(s)).map(rowsForSeed);
  return { rows: runs.flatMap((r) => r.rows), picks: runs.flatMap((r) => r.picks), finalDescent: runs.reduce((n, r) => n + r.finalDescent, 0), landed: runs.reduce((n, r) => n + r.landed, 0), levels: runs.length * 8 };
}

const trainSeeds = Array.from({ length: Number(values.seeds) }, (_, i) => 3000 + i);
const evalSeeds = Array.from({ length: Number(values["eval-seeds"]) }, (_, i) => 9000 + i);
const train = build(trainSeeds);
const evalSet = build(evalSeeds);
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/train.jsonl`, train.rows.join("\n") + "\n");
writeFileSync(`${outDir}/eval.jsonl`, evalSet.rows.join("\n") + "\n");

const longest = Math.max(...train.rows.map((r) => (JSON.parse(r) as { state: string }).state.length));
console.log(`prompt ${prompt.id}: ${train.rows.length} train rows (courses ${trainSeeds[0]}-${trainSeeds.at(-1)}), ${evalSet.rows.length} eval rows (courses ${evalSeeds[0]}-${evalSeeds.at(-1)})`);
console.log(`noisy flights landed ${train.landed} of ${train.levels} training levels; longest state ${longest} chars`);
console.log(`final descent (under ${FINAL_DESCENT_M} m above the ground): ${train.finalDescent} train rows (${((100 * train.finalDescent) / train.rows.length).toFixed(1)}%)`);
console.log("labels", tally(train.picks));
console.log(`wrote ${outDir}/train.jsonl and eval.jsonl`);
