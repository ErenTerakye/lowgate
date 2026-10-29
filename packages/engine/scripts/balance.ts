// Balance report: how the reference autopilot fares across seeds and levels.
// Usage: node packages/engine/scripts/balance.ts [-v]
import { autopilot, createLane, needsDecision, stepLane, IDLE, type Action, type Outcome } from "../src/index.ts";
const counts: Record<string, number> = {};
const durations: number[] = [];
for (let seed = 1; seed <= 40; seed++) {
  let lane = createLane(seed, 300);
  let action: Action = IDLE;
  let last: Outcome | null = null;
  while (!lane.finished) {
    if (needsDecision(lane)) action = autopilot(lane.level, lane.lander);
    lane = stepLane(lane, action);
    if (lane.outcome && lane.outcome !== last) {
      counts[lane.outcome] = (counts[lane.outcome] ?? 0) + 1;
      if (lane.outcome === "landed") durations.push(lane.lander.t / 60);
      if (process.argv[2] === "-v" && lane.outcome !== "landed") console.log("seed", seed, "level", lane.level.index, lane.outcome);
    }
    last = lane.outcome;
  }
}
durations.sort((a, b) => a - b);
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(counts, "landing rate", ((counts.landed ?? 0) / total).toFixed(2), "median landed s", durations[durations.length >> 1]?.toFixed(1));
