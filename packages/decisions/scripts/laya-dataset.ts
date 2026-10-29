/**
 * Builds Laya's fine-tuning data: decision-tick states labelled with the
 * autopilot's action, in the {state, questions, gold} rows laya.train reads.
 *
 *   pnpm laya-dataset                      -> bridge/laya/data/p8/{train,eval}.jsonl
 *   pnpm laya-dataset --prompt p5 --seeds 120
 *
 * Flights are the autopilot with noise: now and then it holds a random action
 * for a few ticks, so the data also covers states the autopilot alone never
 * reaches (drifting, tilted, too fast) and how to recover from them. The label
 * is always the clean autopilot action for that state. Training and eval use
 * disjoint seeds, and neither includes the arena's showcase course 42.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { IDLE, THROTTLE_LEVELS, autopilot, createLane, createRng, needsDecision, stepLane, type Action, type Rng } from "@arena/engine";
import { PROMPTS, ROTATES, isPromptId, observePrompt } from "../src/index.ts";

const { values } = parseArgs({
  options: {
    prompt: { type: "string", default: "p8" },
    seeds: { type: "string", default: "120" },
    "eval-seeds": { type: "string", default: "12" },
    seconds: { type: "string", default: "150" },
    every: { type: "string", default: "8" },
    out: { type: "string" },
  },
});
if (!isPromptId(values.prompt)) throw new Error(`Unknown prompt "${values.prompt}". Known: ${Object.keys(PROMPTS).join(", ")}`);
const prompt = PROMPTS[values.prompt];
const outDir = values.out ?? `bridge/laya/data/${prompt.id}`;
if (prompt.questions.throttle.type !== "score") throw new Error("Laya's labels assume throttle is a score question");
const SHOWCASE_SEED = 42;
/** Chance per decision of starting a random action, and how long it is held. */
const NOISE = { start: 0.12, minTicks: 1, maxTicks: 6 };
/** Label smoothing: the autopilot's pick gets most weight; throttle spreads the rest to neighbouring levels. */
const ROTATE_PICK = 0.9;
const THROTTLE_PICK = 0.8;

function rotateGold(action: Action): Record<string, number> {
  const rest = (1 - ROTATE_PICK) / (ROTATES.length - 1);
  return Object.fromEntries(ROTATES.map((r) => [r, r === action.rotate ? ROTATE_PICK : rest]));
}

function throttleGold(action: Action): Record<string, number> {
  const levels = Array.from({ length: THROTTLE_LEVELS }, (_, i) => i);
  const neighbours = levels.filter((i) => Math.abs(i - action.throttle) === 1);
  const share = (1 - THROTTLE_PICK) / neighbours.length;
  return Object.fromEntries(levels.map((i) => [String(i), i === action.throttle ? THROTTLE_PICK : neighbours.includes(i) ? share : 0]));
}

function randomAction(rng: Rng): Action {
  return { rotate: ROTATES[rng.int(0, ROTATES.length - 1)]!, throttle: rng.int(0, THROTTLE_LEVELS - 1) as Action["throttle"] };
}

function rowsForSeed(seed: number): string[] {
  const rng = createRng(seed ^ 0x5eed);
  const every = Number(values.every);
  let state = createLane(seed, Number(values.seconds));
  let action: Action = IDLE;
  let noisyTicks = 0;
  let tick = 0;
  const rows: string[] = [];
  while (!state.finished) {
    if (needsDecision(state)) {
      const label = autopilot(state.level, state.lander);
      // Offset by seed so samples do not all fall on the same phase of each flight.
      if ((tick + seed) % every === 0) {
        rows.push(JSON.stringify({ state: observePrompt(state, prompt), questions: prompt.questions, gold: { rotate: { probabilities: rotateGold(label) }, throttle: { probabilities: throttleGold(label) } } }));
      }
      if (noisyTicks === 0 && rng.next() < NOISE.start) noisyTicks = rng.int(NOISE.minTicks, NOISE.maxTicks);
      if (noisyTicks > 0) {
        if (noisyTicks === NOISE.maxTicks || action === label || rng.next() < 0.3) action = randomAction(rng);
        noisyTicks--;
      } else {
        action = label;
      }
      tick++;
    }
    state = stepLane(state, action);
  }
  return rows;
}

function build(seeds: number[]): string[] {
  return seeds.filter((s) => s !== SHOWCASE_SEED).flatMap(rowsForSeed);
}

const trainSeeds = Array.from({ length: Number(values.seeds) }, (_, i) => 1000 + i);
const evalSeeds = Array.from({ length: Number(values["eval-seeds"]) }, (_, i) => 9000 + i);
const train = build(trainSeeds);
const evalRows = build(evalSeeds);
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/train.jsonl`, train.join("\n") + "\n");
writeFileSync(`${outDir}/eval.jsonl`, evalRows.join("\n") + "\n");

const count = (rows: string[], pick: (g: any) => string) => {
  const c: Record<string, number> = {};
  for (const r of rows) {
    const k = pick(JSON.parse(r).gold);
    c[k] = (c[k] ?? 0) + 1;
  }
  return c;
};
const argmaxKey = (p: Record<string, number>) => Object.entries(p).sort((a, b) => b[1] - a[1])[0]![0];
console.log(`prompt ${prompt.id}: ${train.length} train rows (seeds ${trainSeeds[0]}-${trainSeeds.at(-1)}), ${evalRows.length} eval rows (seeds ${evalSeeds[0]}-${evalSeeds.at(-1)})`);
console.log("rotate labels  ", count(train, (g) => argmaxKey(g.rotate.probabilities)));
console.log("throttle labels", count(train, (g) => argmaxKey(g.throttle.probabilities)));
console.log(`wrote ${outDir}/train.jsonl and eval.jsonl`);
