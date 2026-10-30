/**
 * The benchmark: every lane flies the same 20 courses, all 8 levels each, in
 * lockstep with its own answers. One recording per lane and course goes to
 * bench/<lane>/<seed>.json, then bench/results.json summarises every
 * recording on disk, with a 95% interval on each rate and mean.
 *
 *   pnpm bench                               the fast lanes: autopilot, laya, jev, clef
 *   caffeinate -i pnpm bench --lanes gemma-local    the chat lane, ~10 h on this Mac
 *   pnpm bench --summary                     rebuild results.json from the recordings only
 *
 * Resumable: a course with a recording is skipped, so an interrupted run (a
 * crash, a closed lid, Workers AI's daily quota) picks up where it stopped.
 * A course is written only when it is complete; a fatal error stops that lane
 * and its course is flown again next time.
 *
 * Lanes run side by side; each lane flies its courses one at a time, so a
 * local model never answers two requests at once (measured: four streams of
 * Gemma at once gave 1.2x the throughput and pushed answers past the timeout,
 * docs/lanes.md). Local lanes get a 60 s timeout: answer time is measured but
 * never scored, so a busy Mac must not turn into unanswered decisions.
 *
 * Courses 5001-5020 are unseen by every lane: prompts were tuned on 1001,
 * Laya trained on 3000-3119 and was evaluated on 9000-9011.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { COURSE_LEVELS, ENGINE_VERSION } from "@lowgate/engine";
import { MODEL_LANES, benchResults, flyCourse, makeRecording, percentile, replayRecording, summarizeLane, type LaneResult, type Recording } from "../src/index.ts";
import { isLocalLane, laneClient } from "./lane-client.ts";

const { values } = parseArgs({
  options: {
    lanes: { type: "string", default: "autopilot,laya,jev,clef" },
    courses: { type: "string", default: "5001-5020" },
    dir: { type: "string", default: "bench" },
    summary: { type: "boolean", default: false },
  },
});
const LOCAL_TIMEOUT_MS = 60_000;
/** Courses no lane has trained or been tuned on (see the header). */
const SEEN = (seed: number) => seed === 42 || (seed >= 1000 && seed <= 1999) || (seed >= 3000 && seed <= 3119) || (seed >= 9000 && seed <= 9011);

const range = /^(\d+)-(\d+)$/.exec(values.courses);
if (!range) throw new Error(`--courses takes a range such as 5001-5020, got "${values.courses}"`);
const seeds = Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i);
const seen = seeds.filter(SEEN);
if (seen.length) throw new Error(`Courses ${seen.join(", ")} were used for tuning or training; the benchmark must use unseen ones`);
const dir = values.dir;

const recordingPath = (lane: string, seed: number) => `${dir}/${lane}/${seed}.json`;

async function flyLane(id: string): Promise<void> {
  const { client, promptId } = laneClient(id, isLocalLane(id) ? { timeoutMs: LOCAL_TIMEOUT_MS } : {});
  const todo = seeds.filter((s) => !existsSync(recordingPath(id, s)));
  const tag = `[${id}]`.padEnd(14);
  console.log(`${tag}${seeds.length - todo.length} of ${seeds.length} courses on disk, ${todo.length} to fly${todo.length ? `, prompt ${promptId}` : ""}`);
  mkdirSync(`${dir}/${id}`, { recursive: true });
  for (const seed of todo) {
    const started = Date.now();
    const run = await flyCourse(client, seed);
    if (run.stoppedBy) {
      console.log(`${tag}course ${seed}: stopped by ${run.stoppedBy.kind} (${run.stoppedBy.message}); not saved, run again to resume`);
      return;
    }
    const pinned = client.model?.pinned ? client.model.model : null;
    const wrong = pinned ? run.decisions.find((d) => d.servedModel && d.servedModel !== pinned) : undefined;
    if (wrong) {
      console.log(`${tag}course ${seed}: served ${wrong.servedModel}, but the lane pins ${pinned}; not saved`);
      return;
    }
    const rec = makeRecording(client, promptId, run);
    const check = replayRecording(rec);
    if (!check.ok) throw new Error(`${id} course ${seed} does not replay: ${check.reason}`);
    writeFileSync(recordingPath(id, seed), JSON.stringify(rec) + "\n");
    const landed = run.results.filter((r) => r.landing).length;
    const unanswered = run.decisions.filter((d) => !d.answered).length;
    const p50 = percentile(run.decisions.filter((d) => d.answered).map((d) => d.latencyMs), 50);
    console.log(
      `${tag}course ${seed}: landed ${landed}/${COURSE_LEVELS}, ${run.decisions.length} decisions${unanswered ? `, ${unanswered} unanswered` : ""}, p50 ${p50 ?? "–"} ms, ${((Date.now() - started) / 60000).toFixed(1)} min`,
    );
  }
}

function summarize(id: string): LaneResult | null {
  const files = existsSync(`${dir}/${id}`) ? readdirSync(`${dir}/${id}`).filter((f) => f.endsWith(".json")) : [];
  const recs = files.map((f) => JSON.parse(readFileSync(`${dir}/${id}/${f}`, "utf8")) as Recording).filter((r) => seeds.includes(r.seed));
  const hostedEquivalent = MODEL_LANES[id]?.hostedEquivalent;
  return recs.length ? summarizeLane(recs, hostedEquivalent ? { hostedEquivalent } : {}) : null;
}

if (!values.summary) {
  const lanes = values.lanes.split(",").map((s) => s.trim()).filter(Boolean);
  // Build every client first, so a missing key fails before anything flies.
  for (const id of lanes) laneClient(id);
  console.log(`Benchmark, engine ${ENGINE_VERSION}: courses ${seeds[0]}-${seeds.at(-1)}, lanes ${lanes.join(", ")} -> ${dir}/`);
  await Promise.all(lanes.map(flyLane));
}

const laneDirs = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
const results = benchResults(seeds, laneDirs.flatMap((id) => summarize(id) ?? []));
const table = results.lanes;
writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2) + "\n");

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log(`\n${"lane".padEnd(14)}${"courses".padEnd(9)}${"landed".padEnd(22)}${"quality".padEnd(16)}${"autopilot pick".padEnd(16)}${"unanswered".padEnd(12)}${"p50".padEnd(10)}cost`);
for (const r of table) {
  const ci = r.landingRate95 ? ` (${pct(r.landingRate95.low)}-${pct(r.landingRate95.high)})` : "";
  const q = r.quality ? `${r.quality.mean.toFixed(1)} ± ${(r.quality.ci.high - r.quality.mean).toFixed(1)}` : "–";
  const cost = r.costUsd ? `$${r.costUsd.total.toFixed(2)} (${r.costUsd.priceSource})` : "–";
  console.log(
    `${r.lane.padEnd(14)}${`${r.courses}/${seeds.length}`.padEnd(9)}${`${r.landed}/${r.levels} ${pct(r.landingRate)}${ci}`.padEnd(22)}${q.padEnd(16)}${pct(r.agreesWithAutopilot.exact).padEnd(16)}${String(r.unanswered).padEnd(12)}${`${r.latencyMs.p50 ?? "–"} ms`.padEnd(10)}${cost}`,
  );
}
console.log(`\nwrote ${dir}/results.json`);
