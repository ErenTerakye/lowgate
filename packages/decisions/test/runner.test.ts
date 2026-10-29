import { IDLE, createLane, type Action } from "@arena/engine";
import { describe, expect, it } from "vitest";
import { LaneRunner, ScriptedClient, percentile, type CallRecord, type DecisionClient, type DecisionRequest, type DecisionResult } from "../src/index.ts";

const lane = createLane(7);
const UP: Action = { rotate: "none", throttle: 4 };
const LEFT: Action = { rotate: "left", throttle: 1 };
const ok = (action: Action, latencyMs = 10): DecisionResult => ({ ok: true, decision: { action, probs: null, latencyMs, usage: { inputTokens: 200, outputTokens: 0 } } });

/** A client whose calls the test settles by hand. */
class ManualClient implements DecisionClient {
  readonly id = "manual";
  readonly label = "Manual";
  readonly kind = "model";
  readonly note = "";
  readonly model = null;
  readonly calls: { request: DecisionRequest; resolve: (r: DecisionResult) => void; reject: (e: unknown) => void }[] = [];

  decide(request: DecisionRequest): Promise<DecisionResult> {
    return new Promise((resolve, reject) => this.calls.push({ request, resolve, reject }));
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("LaneRunner", () => {
  it("applies a synchronous answer on the tick it was asked", () => {
    const runner = new LaneRunner(new ScriptedClient());
    const action = runner.tick(lane, 0);
    expect(action).not.toBe(IDLE);
    expect(runner).toMatchObject({ decisions: 1, missed: 0, status: "ok" });
  });

  it("applies an async answer on the next tick, then asks again", async () => {
    const client = new ManualClient();
    const records: CallRecord[] = [];
    const runner = new LaneRunner(client, { onCall: (r) => records.push(r) });

    expect(runner.tick(lane, 0)).toEqual(IDLE);
    client.calls[0]!.resolve(ok(UP, 42));
    await flush();
    expect(runner.tick(lane, 1)).toEqual(UP);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.request.tick).toBe(1);
    expect(records[0]).toMatchObject({ askedTick: 0, appliedTick: 1, latencyMs: 42 });
    expect(runner.usage).toEqual({ inputTokens: 200, outputTokens: 0, calls: 1 });
  });

  it("counts ticks missed while a call is out and never sends a second one", async () => {
    const client = new ManualClient();
    const runner = new LaneRunner(client);
    runner.tick(lane, 0);
    client.calls[0]!.resolve(ok(UP));
    await flush();
    runner.tick(lane, 1); // applies UP, asks about tick 1
    expect(runner.tick(lane, 2)).toEqual(UP);
    expect(runner.tick(lane, 3)).toEqual(UP);
    expect(client.calls).toHaveLength(2);
    expect(runner.missed).toBe(2);

    client.calls[1]!.resolve(ok(LEFT));
    await flush();
    expect(runner.tick(lane, 4)).toEqual(LEFT);
    expect(runner.decisions).toBe(2);
  });

  it("holds the last action and backs off after a transient error", async () => {
    const client = new ManualClient();
    const runner = new LaneRunner(client);
    runner.tick(lane, 0);
    client.calls[0]!.resolve(ok(UP));
    await flush();
    runner.tick(lane, 1);
    client.calls[1]!.resolve({ ok: false, latencyMs: 5, error: { kind: "http", status: 503, message: "down" } });
    await flush();
    // Error noticed on tick 2: first backoff is one tick, so no call on 2.
    expect(runner.tick(lane, 2)).toEqual(UP);
    expect(runner).toMatchObject({ status: "retrying", errors: 1 });
    expect(client.calls).toHaveLength(2);
    runner.tick(lane, 3);
    expect(client.calls).toHaveLength(3);
  });

  it("stops with the engine off on a fatal error", async () => {
    const client = new ManualClient();
    const runner = new LaneRunner(client);
    runner.tick(lane, 0);
    client.calls[0]!.resolve({ ok: false, latencyMs: 5, error: { kind: "quota", status: 402, message: "out of credit" } });
    await flush();
    expect(runner.tick(lane, 1)).toEqual(IDLE);
    for (let t = 2; t < 50; t++) runner.tick(lane, t);
    expect(runner.status).toBe("stopped");
    expect(runner.lastError?.kind).toBe("quota");
    expect(client.calls).toHaveLength(1);
  });

  it("turns a client that throws or rejects into an error instead of crashing", async () => {
    const throwing: DecisionClient = { id: "t", label: "t", kind: "model", note: "", model: null, decide: () => { throw new Error("boom"); } };
    const r1 = new LaneRunner(throwing);
    expect(() => r1.tick(lane, 0)).not.toThrow();
    expect(r1.lastError).toMatchObject({ kind: "bad_response", message: "boom" });

    const client = new ManualClient();
    const r2 = new LaneRunner(client);
    r2.tick(lane, 0);
    client.calls[0]!.reject(new Error("rejected"));
    await flush();
    r2.tick(lane, 1);
    expect(r2.lastError?.message).toBe("rejected");
  });

  it("aborts the call in flight on dispose", () => {
    const client = new ManualClient();
    const runner = new LaneRunner(client);
    runner.tick(lane, 0);
    runner.dispose();
    expect(client.calls[0]!.request.signal.aborted).toBe(true);
  });
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([30, 10, 20, 40], 50)).toBe(20);
    expect(percentile([30, 10, 20, 40], 95)).toBe(40);
  });
});

describe("LaneRunner across levels", () => {
  it("drops an answer asked about a level that has ended", async () => {
    const client = new ManualClient();
    const records: CallRecord[] = [];
    const runner = new LaneRunner(client, { onCall: (r) => records.push(r) });
    runner.tick(lane, 0);
    runner.newEpisode();
    client.calls[0]!.resolve(ok(UP));
    await flush();
    expect(runner.tick(lane, 10)).toEqual(IDLE);
    expect(records[0]?.stale).toBe(true);
    expect(client.calls).toHaveLength(2);
  });
});
