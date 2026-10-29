import { ENGINE_VERSION, autopilot, createRng } from "@arena/engine";
import { ReplayClient, ScriptedClient, firstDivergence, parseRecording, type DecisionClient, type DecisionRequest, type DecisionResult, type Recording } from "@arena/decisions";
import { describe, expect, it } from "vitest";
import { Arena, type LaneSlot } from "../src/arena.ts";

/**
 * An async model whose answers arrive a few physics steps after they were
 * asked, sometimes failing, so a recording covers missed ticks, backoff,
 * stale answers across a level change and token usage. Delivery is driven by
 * the test clock, not timers, so every run of the test is the same.
 */
class SlowModel implements DecisionClient {
  readonly kind = "model";
  readonly note = "Test model.";
  readonly model = { provider: "test", model: "slow-1", pinned: true, price: { input: 1, output: 2, source: "vendor" as const } };
  private readonly rng;
  private readonly due: { step: number; resolve: () => void }[] = [];
  private calls = 0;

  constructor(
    readonly id: string,
    readonly label: string,
    seed: number,
    private readonly maxDelaySteps: number,
    /** Call number that runs out of quota and stops the lane, if any. */
    private readonly quotaAt?: number,
  ) {
    this.rng = createRng(seed);
  }

  decide({ lane }: DecisionRequest): Promise<DecisionResult> {
    const n = ++this.calls;
    const delay = this.rng.int(1, this.maxDelaySteps);
    const action = autopilot(lane.level, lane.lander);
    const result: DecisionResult =
      n === this.quotaAt
        ? { ok: false, latencyMs: delay * 16.7, error: { kind: "quota", status: 402, message: "credit used up" } }
        : n % 23 === 0
          ? { ok: false, latencyMs: delay * 16.7, error: { kind: "timeout", message: "timed out" } }
          : { ok: true, decision: { action, probs: null, latencyMs: delay * 16.7 + this.rng.next(), usage: { inputTokens: 300 + n, outputTokens: 2 } } };
    return new Promise((resolve) => this.due.push({ step: lane.step + delay, resolve: () => resolve(result) }));
  }

  deliver(step: number): void {
    for (let i = this.due.length - 1; i >= 0; i--) {
      if (this.due[i]!.step <= step) this.due.splice(i, 1)[0]!.resolve();
    }
  }
}

const SEED = 7;
const SECONDS = 90;

async function recordRun(): Promise<{ arena: Arena; recording: Recording }> {
  const models = [new SlowModel("fast", "Fast model", 1, 16), new SlowModel("slow", "Slow model", 2, 30), new SlowModel("broke", "Broke model", 3, 8, 40)];
  const arena = new Arena({ seed: SEED, runSeconds: SECONDS, clients: [new ScriptedClient(), ...models] }, () => {});
  while (!arena.finished) {
    arena.step();
    for (const m of models) m.deliver(arena.lanes[0]!.state.step);
    // Let the delivered promises settle before the next step, as frames do in the browser.
    await Promise.resolve();
    await Promise.resolve();
  }
  return { arena, recording: JSON.parse(JSON.stringify(arena.toRecording(new Date("2026-10-29T12:00:00Z")))) as Recording };
}

function replay(recording: Recording): Arena {
  const arena = new Arena({ seed: recording.seed, runSeconds: recording.runSeconds, clients: recording.lanes.map((l) => new ReplayClient(l)) }, () => {});
  while (!arena.finished) arena.step();
  return arena;
}

/** What the HUD shows for a lane. */
const shown = (s: LaneSlot) => ({
  stats: s.state.stats,
  decisions: s.runner.decisions,
  missed: s.runner.missed,
  errors: s.runner.errors,
  status: s.runner.status,
  latencies: s.runner.latencies.map((v) => Math.round(v * 10) / 10),
  usage: s.runner.usage,
});

describe("recording and replay", () => {
  it("records a run that exercises missed ticks, errors, a stopped lane and level changes", async () => {
    const { arena } = await recordRun();
    const [auto, fast, slow, broke] = arena.lanes.map(shown);
    expect(auto!.stats.landings).toBeGreaterThan(1);
    expect(fast!.missed).toBeGreaterThan(0);
    expect(slow!.missed).toBeGreaterThan(fast!.missed);
    expect(fast!.errors).toBeGreaterThan(0);
    expect(broke!.status).toBe("stopped");
    expect(arena.lanes.some((l) => l.calls.some((c) => c.stale))).toBe(true);
  });

  it("replays every lane exactly, without calling anything", async () => {
    const { arena, recording } = await recordRun();
    const again = replay(recording);
    again.lanes.forEach((slot, i) => {
      expect(firstDivergence(recording.lanes[i]!.hashes, slot.hashes, true)).toBeNull();
      expect(shown(slot)).toEqual(shown(arena.lanes[i]!));
      expect(slot.state.stats).toEqual(recording.lanes[i]!.final);
    });
  });

  it("keeps the lane's name, model and price from the recording", async () => {
    const { recording } = await recordRun();
    const client = new ReplayClient(recording.lanes[1]!);
    expect(client.label).toBe("Fast model");
    expect(client.model?.price.input).toBe(1);
  });

  it("notices a recording that was tampered with", async () => {
    const { recording } = await recordRun();
    const lane = recording.lanes[1]!;
    const i = lane.calls.findIndex((c) => !c.error && !c.stale && c.askedTick > 20);
    const call = lane.calls[i]!;
    const tampered = { ...call, action: { rotate: call.action.rotate === "left" ? "right" : "left", throttle: call.action.throttle === 4 ? 0 : 4 } } as const;
    const edited: Recording = { ...recording, lanes: recording.lanes.map((l) => (l === lane ? { ...l, calls: l.calls.map((c, j) => (j === i ? tampered : c)) } : l)) };
    expect(firstDivergence(lane.hashes, replay(edited).lanes[1]!.hashes, true)).not.toBeNull();
  });

  it("refuses files it cannot replay faithfully", async () => {
    const { recording } = await recordRun();
    expect(parseRecording(recording)).toBe(recording);
    expect(() => parseRecording({ ...recording, engineVersion: "descent-0" })).toThrow(/engine/);
    expect(() => parseRecording({ ...recording, version: 2 })).toThrow(/format/);
    expect(() => parseRecording({ hello: "world" })).toThrow(/Not a Decision Arena recording/);
    expect(recording.engineVersion).toBe(ENGINE_VERSION);
  });
});

describe("firstDivergence", () => {
  it("agrees on a prefix while running and needs the full length once finished", () => {
    expect(firstDivergence(["a", "b", "c"], ["a", "b"], false)).toBeNull();
    expect(firstDivergence(["a", "b", "c"], ["a", "b"], true)).toBe(2);
    expect(firstDivergence(["a", "b", "c"], ["a", "x"], false)).toBe(1);
    expect(firstDivergence(["a"], ["a", "b"], false)).toBe(1);
  });
});
