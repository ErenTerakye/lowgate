// Balance report: how the menu autopilot fares across courses and levels.
// Usage: node packages/engine/scripts/balance.ts [courses] [-v]
import { MANOEUVRES, autopilot, createLane, flyDecision, nextLevel, summarize, type LevelResult } from "../src/index.ts";

const courses = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20);
const verbose = process.argv.includes("-v");
const all: LevelResult[] = [];
const outcomes: Record<string, number> = {};
const byLevel = Array.from({ length: 8 }, () => ({ landed: 0, flown: 0 }));
const picks = new Array<number>(MANOEUVRES.length).fill(0);

for (let seed = 1; seed <= courses; seed++) {
  let lane = createLane(seed);
  while (!lane.finished) {
    if (lane.outcome !== null) lane = nextLevel(lane);
    const i = autopilot(lane.level, lane.lander);
    picks[i]!++;
    lane = flyDecision(lane, MANOEUVRES[i]!);
  }
  for (const r of lane.results) {
    all.push(r);
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    byLevel[r.index]!.flown++;
    if (r.landing) byLevel[r.index]!.landed++;
    if (verbose && !r.landing) console.log(`course ${seed} level ${r.index}: ${r.outcome} after ${r.seconds.toFixed(1)} s`);
  }
}

const s = summarize(all);
console.log(outcomes);
console.log(`landing rate ${(s.landingRate * 100).toFixed(1)}%, mean quality ${s.meanQuality?.toFixed(1)}, decisions per level ${(s.decisions / s.levels).toFixed(1)}`);
console.log("landed by level", byLevel.map((b) => `${b.landed}/${b.flown}`).join(" "));
console.log("picks", MANOEUVRES.map((m, i) => `${m.tilt}/${m.throttle}:${picks[i]}`).filter((x) => !x.endsWith(":0")).join(" "));
