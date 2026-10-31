/**
 * Reproducibility check: asks another build of a lane's model the exact questions its benchmark recordings hold, at the
 * same states, and reports how often it picks the same manoeuvre and how far its probabilities move. Built for Laya: the
 * benchmark flew the MLX build on a Mac, and this asks the PyTorch checkpoint on a Colab GPU (bridge/laya/repro_colab.ipynb).
 *
 * Open loop: every state comes from the recording, so one different pick does not send the rest of the course elsewhere,
 * and every decision counts once.
 *
 *   pnpm agree --lane laya --endpoint http://127.0.0.1:8765/v1/systemone --courses 5001-5005 --label torch-l4
 *
 * Writes repro/<lane>-<label>.json (outside bench/, whose folders are all lanes).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { LaneState } from "@lowgate/engine";
import { SystemOneClient, agreementReport, isPromptId, replayRecording, type DecisionRecord, type Recording, type ReplayedAnswer } from "../src/index.ts";

const { values } = parseArgs({
  options: {
    lane: { type: "string", default: "laya" },
    endpoint: { type: "string", default: "http://127.0.0.1:8765/v1/systemone" },
    courses: { type: "string", default: "5001-5005" },
    label: { type: "string", default: "torch" },
    dir: { type: "string", default: "bench" },
  },
});

const range = /^(\d+)-(\d+)$/.exec(values.courses);
if (!range) throw new Error(`--courses takes a range such as 5001-5005, got "${values.courses}"`);
const seeds = Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i);

const answers: ReplayedAnswer[] = [];
let served: string | undefined;
for (const seed of seeds) {
  const rec = JSON.parse(readFileSync(`${values.dir}/${values.lane}/${seed}.json`, "utf8")) as Recording;
  if (!isPromptId(rec.prompt)) throw new Error(`${values.lane} course ${seed} used prompt "${rec.prompt}", which is not a System One prompt`);
  const asked: [LaneState, DecisionRecord][] = [];
  const check = replayRecording(rec, (lane, d) => {
    if (d.answered && d.probs) asked.push([lane, d]);
  });
  if (!check.ok) throw new Error(`${values.lane} course ${seed} does not replay: ${check.reason}`);

  const client = new SystemOneClient({
    id: `${values.lane}-${values.label}`,
    label: `${rec.label} (${values.label})`,
    model: { provider: values.label, model: rec.model?.model ?? values.lane, pinned: false, price: { input: 0, output: 0, source: "none" } },
    endpoint: values.endpoint,
    prompt: rec.prompt,
    timeoutMs: 60_000,
  });
  const before = answers.length;
  for (const [lane, d] of asked) {
    const result = await client.decide({ lane, signal: new AbortController().signal });
    if (!result.ok) throw new Error(`course ${seed}, level ${d.level}, decision ${d.n}: ${result.error.kind}: ${result.error.message}`);
    const { probs, latencyMs, servedModel } = result.decision;
    served ??= servedModel;
    answers.push({ recordedPick: d.pick, recordedProbs: d.probs!, probs: probs!, latencyMs });
  }
  const part = agreementReport(answers.slice(before));
  console.log(`course ${seed}: ${part.decisions} decisions, same pick ${(part.samePick.rate * 100).toFixed(1)}%, mean distance ${part.distance.mean.toFixed(4)}`);
}

const report = agreementReport(answers);
const out = {
  lane: values.lane,
  label: values.label,
  servedModel: served ?? null,
  courses: seeds,
  checkedAt: new Date().toISOString(),
  ...report,
};
mkdirSync("repro", { recursive: true });
writeFileSync(`repro/${values.lane}-${values.label}.json`, JSON.stringify(out, null, 2) + "\n");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = report.samePick.interval;
console.log(
  `\n${report.decisions} decisions: same pick ${report.samePick.count} (${pct(report.samePick.rate)}${ci ? `, ${pct(ci.low)}-${pct(ci.high)}` : ""}); ` +
    `distance mean ${report.distance.mean.toFixed(4)}, p95 ${report.distance.p95.toFixed(4)}, max ${report.distance.max.toFixed(4)}; ` +
    `median recorded margin where picks differ ${report.recordedMarginWhenDifferent.median?.toFixed(4) ?? "n/a"}; ` +
    `answer p50 ${report.latencyMs.p50?.toFixed(0)} ms\nwrote repro/${values.lane}-${values.label}.json`,
);
