import { COURSE_LEVELS, MANOEUVRES, autopilot, createLane, flyDecision, nextLevel, stateHash, summarize, type LaneState } from "@lowgate/engine";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_PICK,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  autopilotClient,
  decideWithRetry,
  flyCourse,
  type DecisionClient,
  type DecisionError,
  type DecisionResult,
} from "../src/index.ts";

const noSleep = async (): Promise<void> => {};

/** A client that answers from a script of results, then flies like the autopilot. */
function scripted(script: (DecisionResult | DecisionError)[], log: number[] = []): DecisionClient {
  let calls = 0;
  return {
    ...autopilotClient,
    id: "scripted",
    decide: (req) => {
      log.push(calls);
      const next = script[calls++];
      if (next === undefined) return autopilotClient.decide(req);
      return "kind" in next ? { ok: false, error: next, latencyMs: 12 } : next;
    },
  };
}

const err = (kind: DecisionError["kind"]): DecisionError => ({ kind, message: kind });

describe("flyCourse", () => {
  it("flies the autopilot through the whole course, the same as the engine's own loop", async () => {
    const run = await flyCourse(autopilotClient, 42);
    let lane = createLane(42);
    const hashes: string[] = [];
    while (!lane.finished) {
      if (lane.outcome !== null) lane = nextLevel(lane);
      hashes.push(stateHash(lane));
      lane = flyDecision(lane, MANOEUVRES[autopilot(lane.level, lane.lander)]!);
    }
    expect(run.results).toEqual(lane.results);
    expect(run.decisions.map((d) => d.hash)).toEqual(hashes);
    expect(run.notFlown).toEqual([]);
    expect(run.stoppedBy).toBeNull();
    expect(summarize(run.results).landed).toBe(COURSE_LEVELS);
  });

  it("numbers decisions within each level", async () => {
    const run = await flyCourse(autopilotClient, 42, { levels: 2 });
    expect(run.results).toHaveLength(2);
    const first = run.decisions.filter((d) => d.level === 0);
    expect(first.map((d) => d.n)).toEqual([...first.keys()]);
    expect(run.decisions.find((d) => d.level === 1)?.n).toBe(0);
  });

  it("waits for a slow answer: latency never changes the flight", async () => {
    const slow: DecisionClient = { ...autopilotClient, decide: async (req) => (await new Promise((r) => setTimeout(r, 2)), autopilotClient.decide(req)) };
    const [a, b] = await Promise.all([flyCourse(slow, 7, { levels: 1 }), flyCourse(autopilotClient, 7, { levels: 1 })]);
    expect(a.results).toEqual(b.results);
  });

  it("stops on a fatal error and reports the rest of the course as not flown", async () => {
    const run = await flyCourse(scripted([err("quota")]), 3);
    expect(run.stoppedBy?.kind).toBe("quota");
    expect(run.results).toEqual([]);
    expect(run.notFlown).toEqual([...Array(COURSE_LEVELS).keys()]);
    expect(run.decisions).toHaveLength(1);
    expect(run.decisions[0]).toMatchObject({ answered: false, retries: 0, error: { kind: "quota" } });
  });

  it("keeps the levels flown before a fatal error", async () => {
    const before = await flyCourse(autopilotClient, 3, { levels: 1 });
    const n = before.decisions.length;
    let i = 0;
    const client: DecisionClient = { ...autopilotClient, decide: (req) => (i++ === n + 1 ? { ok: false, error: err("auth"), latencyMs: 1 } : autopilotClient.decide(req)) };
    const run = await flyCourse(client, 3);
    expect(run.results).toEqual(before.results);
    expect(run.notFlown).toEqual([...Array(COURSE_LEVELS).keys()].slice(1));
  });

  it("only counts not-flown levels within a probe's level limit", async () => {
    const run = await flyCourse(scripted([err("not_configured")]), 3, { levels: 1 });
    expect(run.notFlown).toEqual([0]);
  });
});

describe("decideWithRetry", () => {
  const lane: LaneState = createLane(11);

  it("retries transient failures with backoff, then uses the answer", async () => {
    const waits: number[] = [];
    const { record, stop } = await decideWithRetry(scripted([err("timeout"), err("rate_limited")]), lane, FALLBACK_PICK, {
      sleep: async (ms) => void waits.push(ms),
    });
    expect(stop).toBeNull();
    expect(record).toMatchObject({ answered: true, retries: 2, pick: autopilot(lane.level, lane.lander), error: { kind: "rate_limited" } });
    expect(waits).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]! * 5]);
  });

  it("repeats the last manoeuvre when every retry fails", async () => {
    const log: number[] = [];
    const failing = Array.from({ length: MAX_RETRIES + 1 }, () => err("network"));
    const { record, stop } = await decideWithRetry(scripted(failing, log), lane, 17, { sleep: noSleep });
    expect(stop).toBeNull();
    expect(log).toHaveLength(MAX_RETRIES + 1);
    expect(record).toMatchObject({ answered: false, pick: 17, retries: MAX_RETRIES, probs: null, error: { kind: "network" } });
  });

  it("does not retry a fatal error", async () => {
    const log: number[] = [];
    const { stop } = await decideWithRetry(scripted([err("auth")], log), lane, 0, { sleep: noSleep });
    expect(stop?.kind).toBe("auth");
    expect(log).toHaveLength(1);
  });

  it("stops when the caller cancels", async () => {
    const ac = new AbortController();
    const client = scripted([err("timeout")]);
    const { stop, record } = await decideWithRetry(client, lane, 0, { signal: ac.signal, sleep: async () => ac.abort() });
    expect(stop?.kind).toBe("aborted");
    expect(record.answered).toBe(false);
  });

  it("turns a client that throws into a retried bad response", async () => {
    let calls = 0;
    const throwing: DecisionClient = {
      ...autopilotClient,
      decide: (req) => {
        if (calls++ === 0) throw new Error("boom");
        return autopilotClient.decide(req);
      },
    };
    const { record } = await decideWithRetry(throwing, lane, 0, { sleep: noSleep });
    expect(record).toMatchObject({ answered: true, retries: 1, error: { kind: "bad_response", message: "boom" } });
  });

  it("rounds probabilities to 4 decimals and records usage and the served model", async () => {
    const probs = MANOEUVRES.map((_, i) => (i === 3 ? 0.123456 : (1 - 0.123456) / (MANOEUVRES.length - 1)));
    const client = scripted([{ ok: true, decision: { pick: 3, probs, latencyMs: 41.6, usage: { inputTokens: 900, outputTokens: 1 }, servedModel: "jev-1.14.0" } }]);
    const { record } = await decideWithRetry(client, lane, 0);
    expect(record.probs?.[3]).toBe(0.1235);
    expect(record).toMatchObject({ pick: 3, latencyMs: 42, usage: { inputTokens: 900, outputTokens: 1 }, servedModel: "jev-1.14.0", error: null, retries: 0 });
  });
});
