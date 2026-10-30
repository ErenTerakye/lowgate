/**
 * One DAgger round for Laya: Laya flies training courses through the bridge,
 * every state it reaches is labelled with the clean autopilot pick, and the
 * new rows are added to the original training set. The first dataset only
 * covers states the (noisy) autopilot reaches; this one adds the states
 * Laya's own mistakes lead to, such as the fast final descents v3 crashed on.
 *
 *   bridge/laya/.venv/bin/python bridge/laya/server.py      (serves the lane's checkpoint)
 *   pnpm laya-dagger                                         -> bridge/laya/data/f3-dagger1/
 *   pnpm laya-dagger --courses 3030-3059 --base bridge/laya/data/f3-dagger1 --out bridge/laya/data/f3-dagger2
 *
 * Courses come from the training range (3000-3119), so eval.jsonl, copied
 * unchanged, stays held out and the before/after numbers compare with v3's.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { MODEL_LANES, SystemOneClient, flyCourse } from "../src/index.ts";
import { FINAL_DESCENT_M, heightAboveGround, labelledRow, layaPrompt, tally } from "./laya-labels.ts";

const { values } = parseArgs({
  options: {
    courses: { type: "string", default: "3000-3029" },
    base: { type: "string", default: "bridge/laya/data/f3" },
    out: { type: "string", default: "bridge/laya/data/f3-dagger1" },
  },
});
const range = /^(\d+)-(\d+)$/.exec(values.courses);
if (!range) throw new Error(`--courses takes a range such as 3000-3029, got "${values.courses}"`);
const [first, last] = [Number(range[1]), Number(range[2])];
if (first < 3000 || last > 3119 || first > last) throw new Error("DAgger courses must lie in the training range 3000-3119");
const seeds = Array.from({ length: last - first + 1 }, (_, i) => first + i);

const lane = MODEL_LANES.laya!;
const prompt = layaPrompt(lane.prompt);
const client = new SystemOneClient({ id: lane.id, label: lane.label, model: lane.model, endpoint: lane.upstream, prompt: prompt.id });

const rows: string[] = [];
const labels: number[] = [];
let agreed = 0;
let finalDescent = 0;
let landed = 0;
const started = Date.now();
for (const seed of seeds) {
  const run = await flyCourse(client, seed, {
    onDecision: (record, state) => {
      if (record.servedModel && record.servedModel !== lane.model.model) throw new Error(`The bridge serves ${record.servedModel}, not ${lane.model.model}; DAgger must fly the lane's own checkpoint`);
      const { row, pick } = labelledRow(state, prompt);
      rows.push(row);
      labels.push(pick);
      if (pick === record.pick) agreed++;
      if (heightAboveGround(state) < FINAL_DESCENT_M) finalDescent++;
    },
  });
  if (run.stoppedBy) throw new Error(`Course ${seed} stopped: ${run.stoppedBy.kind}: ${run.stoppedBy.message}. Is the bridge running?`);
  const n = run.results.filter((r) => r.landing).length;
  landed += n;
  console.log(`course ${seed}: landed ${n}/8, ${run.decisions.length} decisions, ${((Date.now() - started) / 60000).toFixed(1)} min so far`);
}

const base = readFileSync(`${values.base}/train.jsonl`, "utf8").trimEnd().split("\n");
mkdirSync(values.out, { recursive: true });
writeFileSync(`${values.out}/dagger.jsonl`, rows.join("\n") + "\n");
writeFileSync(`${values.out}/train.jsonl`, [...base, ...rows].join("\n") + "\n");
copyFileSync(`${values.base}/eval.jsonl`, `${values.out}/eval.jsonl`);

const pct = (n: number) => `${((100 * n) / rows.length).toFixed(1)}%`;
console.log(`${lane.model.model} on ${prompt.id}: landed ${landed} of ${seeds.length * 8} levels on courses ${first}-${last}`);
console.log(`${rows.length} new rows; Laya picked the autopilot's manoeuvre at ${pct(agreed)}; final descent (under ${FINAL_DESCENT_M} m) ${pct(finalDescent)}`);
console.log("labels", tally(labels));
console.log(`wrote ${values.out}/train.jsonl (${base.length} base + ${rows.length} new), dagger.jsonl and eval.jsonl (unchanged)`);
