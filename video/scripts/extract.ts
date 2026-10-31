/**
 * Pulls the flights the launch video draws out of the benchmark recordings, so every lander, trace and number on
 * screen is one a lane really flew. Each recording is replayed through LaneReplay, which checks every state against
 * its recorded hash, so a stale recording stops the script instead of drawing something that never happened.
 *
 *   node video/scripts/extract.ts
 *
 * Writes video/src/data/flights.json (generated, not committed).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { WORLD_HEIGHT, WORLD_WIDTH, TERRAIN_SEGMENT, type Outcome } from "@lowgate/engine";
import { LaneReplay, type BenchResults, type Recording } from "@lowgate/decisions";

const BENCH = new URL("../../bench/", import.meta.url);
const OUT = new URL("../src/data/", import.meta.url);

/** The level both the single flight and the race are drawn on: the top five lanes land, the four below fly off. */
const RACE_SEED = 5002;
const RACE_LEVEL = 7;
const RACE_LANES = ["autopilot", "jev", "kev-27b", "gemma-local", "laya", "kev-9b", "clef", "kev-4b", "kev-0.8b"];
/** The lanes whose 160 flights are drawn as traces relative to the pad. */
const TRACE_LANES = ["kev-0.8b", "kev-27b"];
/** Physics steps between trace points (60 per second). */
const TRACE_EVERY = 10;

const r2 = (v: number) => Math.round(v * 100) / 100;

function load(lane: string, seed: number): LaneReplay {
  const rec = JSON.parse(readFileSync(new URL(`${lane}/${seed}.json`, BENCH), "utf8")) as Recording;
  const replay = new LaneReplay(rec);
  if (!replay.check.ok) throw new Error(`${lane} ${seed}: ${replay.check.reason}`);
  return replay;
}

interface Flight {
  outcome: Outcome | "stopped";
  /** One entry per physics step: x, y, angle, throttle. */
  steps: [number, number, number, number][];
  /** The decision index of each step, for matching steps to picks. */
  picks: { pick: number; probs: number[] | null; latencyMs: number | null }[];
}

function fly(replay: LaneReplay, level: number): Flight {
  if (!replay.seek(level)) throw new Error(`${replay.rec.lane} never reached level ${level + 1} of ${replay.rec.seed}`);
  const steps: Flight["steps"] = [];
  const picks: Flight["picks"] = [];
  let seen: unknown = null;
  const push = () => {
    const l = replay.lane.lander;
    steps.push([r2(l.x), r2(l.y), l.angle, l.throttle]);
  };
  push();
  while (!replay.levelOver()) {
    replay.step();
    if (replay.mismatch) throw new Error(replay.mismatch);
    const d = replay.current;
    if (d && d !== seen) {
      seen = d;
      picks.push({ pick: d.pick, probs: d.probs ? d.probs.map((p) => Math.round(p * 1000) / 1000) : null, latencyMs: d.latencyMs ?? null });
    }
    push();
  }
  return { outcome: replay.lane.outcome ?? "stopped", steps, picks };
}

// The race: every lane on one level.
const raceLevel = load("autopilot", RACE_SEED);
raceLevel.seek(RACE_LEVEL);
const level = raceLevel.lane.level;
const race = RACE_LANES.map((lane) => ({ lane, label: load(lane, RACE_SEED).rec.label, ...fly(load(lane, RACE_SEED), RACE_LEVEL) }));

// The traces: every level of every course, relative to the pad's centre.
const results = JSON.parse(readFileSync(new URL("results.json", BENCH), "utf8")) as BenchResults;
const seeds = results.courses;
const traces = Object.fromEntries(
  TRACE_LANES.map((lane) => {
    const flights: { outcome: string; pts: [number, number][] }[] = [];
    for (const seed of seeds) {
      const replay = load(lane, seed);
      for (let lv = 0; lv < replay.levelStarts.length; lv++) {
        const f = fly(replay, lv);
        const pad = replay.lane.level.pad;
        const cx = (pad.x0 + pad.x1) / 2;
        const pts = f.steps.filter((_, i) => i % TRACE_EVERY === 0 || i === f.steps.length - 1).map(([x, y]) => [r2(x - cx), r2(y - pad.y)] as [number, number]);
        flights.push({ outcome: f.outcome, pts });
      }
    }
    return [lane, flights];
  }),
);

const lanes = results.lanes.map((l) => ({
  lane: l.lane,
  label: l.label,
  landed: l.landed,
  levels: l.levels,
  quality: l.quality?.mean ?? null,
  p50Ms: l.latencyMs.p50,
  answerSeconds: l.answerSecondsPerCourse * l.courses,
}));

mkdirSync(OUT, { recursive: true });
writeFileSync(
  new URL("flights.json", OUT),
  JSON.stringify({
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT, segment: TERRAIN_SEGMENT },
    race: { seed: RACE_SEED, level: RACE_LEVEL, terrain: level.terrain.map(r2), pad: level.pad, flights: race },
    traces,
    lanes,
  }),
);
for (const f of race) console.log(`${f.label.padEnd(12)} ${f.outcome.padEnd(14)} ${(f.steps.length / 60).toFixed(1)} s, ${f.picks.length} picks`);
for (const [lane, fs] of Object.entries(traces)) console.log(`${lane}: ${fs.length} flights, ${fs.filter((f) => f.outcome === "landed").length} landed`);
