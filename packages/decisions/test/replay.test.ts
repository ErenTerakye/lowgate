import { readFileSync, readdirSync } from "node:fs";
import { MANOEUVRES } from "@lowgate/engine";
import { describe, expect, it } from "vitest";
import { LaneReplay, autopilotClient, flyCourse, makeRecording, type DecisionClient, type Recording } from "../src/index.ts";

const noSleep = async (): Promise<void> => {};
const BENCH = new URL("../../../bench/", import.meta.url);

/** Plays every level from its start, as the player does, and returns each level's outcome. */
function playAll(replay: LaneReplay): string[] {
  const outcomes: string[] = [];
  for (let level = 0; replay.seek(level); level++) {
    while (!replay.levelOver()) replay.step();
    expect(replay.mismatch).toBeNull();
    outcomes.push(replay.stopped() ? "stopped" : replay.lane.outcome!);
  }
  return outcomes;
}

describe("LaneReplay", () => {
  it("plays a recording level by level to the recorded results", async () => {
    const rec = makeRecording(autopilotClient, "none", await flyCourse(autopilotClient, 42, { levels: 3 }));
    const replay = new LaneReplay(rec);
    expect(replay.check).toEqual({ ok: true });
    expect(replay.levelStarts).toHaveLength(3);
    expect(playAll(replay)).toEqual(rec.results.map((r) => r.outcome));
    expect(replay.position).toBe(rec.decisions.length);
  });

  it("stops at a changed pick instead of drawing a flight that never happened", async () => {
    const rec = makeRecording(autopilotClient, "none", await flyCourse(autopilotClient, 42, { levels: 1 }));
    const decisions = rec.decisions.map((d, i) => (i === 3 ? { ...d, pick: (d.pick + 7) % MANOEUVRES.length } : d));
    const replay = new LaneReplay({ ...rec, decisions });
    expect(replay.check.ok).toBe(false);
    // Played anyway, it flags the first decision whose state no longer matches.
    for (let i = 0; i < 10_000 && !replay.levelOver() && !replay.mismatch; i++) replay.step();
    expect(replay.mismatch).toContain("decision 4");
  });

  it("shows a lane stopped by a fatal error as stopped, with the level it never finished", async () => {
    let calls = 0;
    const quota: DecisionClient = {
      ...autopilotClient,
      decide: (req) => (++calls > 5 ? { ok: false, error: { kind: "quota", message: "out" }, latencyMs: 1 } : autopilotClient.decide(req)),
    };
    const replay = new LaneReplay(makeRecording(quota, "none", await flyCourse(quota, 42, { sleep: noSleep })));
    expect(replay.check).toEqual({ ok: true });
    expect(playAll(replay)).toEqual(["stopped"]);
  });

  it("plays every benchmark recording on its first course to the recorded outcomes", () => {
    const lanes = readdirSync(BENCH, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    expect(lanes.length).toBeGreaterThan(0);
    for (const lane of lanes) {
      const rec = JSON.parse(readFileSync(new URL(`${lane}/5001.json`, BENCH), "utf8")) as Recording;
      const replay = new LaneReplay(rec);
      expect(replay.check, lane).toEqual({ ok: true });
      expect(playAll(replay), lane).toEqual(rec.results.map((r) => r.outcome));
    }
  });
});
