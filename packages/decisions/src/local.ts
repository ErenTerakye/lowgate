import { THROTTLE_LEVELS, autopilot, createRng, type Action, type Rng } from "@arena/engine";
import { ROTATES, actionFromProbs, oneHot } from "./questions.ts";
import type { DecisionClient, DecisionError, DecisionRequest, DecisionResult, Probabilities } from "./types.ts";

const instant = (action: Action, probs: Probabilities | null = null): DecisionResult => ({
  ok: true,
  decision: { action, probs, latencyMs: 0, usage: null },
});

/** The hand-written autopilot: the reference ceiling, free and instant. */
export class ScriptedClient implements DecisionClient {
  readonly id = "autopilot";
  readonly label = "Autopilot";
  readonly kind = "scripted";
  readonly note = "Hand-written controller with no model: shows the chosen action at 100%, with no probabilities.";
  readonly model = null;

  decide({ lane }: DecisionRequest): DecisionResult {
    return instant(autopilot(lane.level, lane.lander));
  }
}

/** Uniformly random actions: the floor every model has to beat. Seeded, so replays match. */
export class RandomClient implements DecisionClient {
  readonly id = "random";
  readonly label = "Random";
  readonly kind = "scripted";
  readonly note = "Picks every action at random. Any model should beat this.";
  readonly model = null;
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = createRng(seed ^ 0x5eed);
  }

  decide(): DecisionResult {
    const rotate = ROTATES[Math.floor(this.rng.next() * ROTATES.length)] ?? "none";
    const throttle = Math.floor(this.rng.next() * THROTTLE_LEVELS) as Action["throttle"];
    return instant({ rotate, throttle });
  }
}

export interface SimulatedOptions {
  readonly seed: number;
  readonly id?: string;
  readonly label?: string;
  /** Median simulated round trip. */
  readonly latencyMs?: number;
  /** Probability per call of a simulated failure, to exercise the error states. */
  readonly failureRate?: number;
  readonly failWith?: DecisionError;
}

/**
 * A stand-in model with no network: the autopilot's pick blurred into
 * probabilities, answered after a random delay. It exists to show how a
 * model lane behaves (bars, latency, missed ticks, errors) before any API
 * key is involved, and is labelled as simulated everywhere it appears.
 */
export class SimulatedModelClient implements DecisionClient {
  readonly id: string;
  readonly label: string;
  readonly kind = "simulated";
  readonly note = "No API: the autopilot's pick blurred into probabilities, with a made-up 40–400 ms delay. Shows how a model lane behaves.";
  readonly model = null;
  private readonly rng: Rng;
  private readonly options: SimulatedOptions;

  constructor(options: SimulatedOptions) {
    this.options = options;
    this.id = options.id ?? "simulated";
    this.label = options.label ?? "Simulated model";
    this.rng = createRng(options.seed ^ 0x51a7);
  }

  decide({ lane, signal }: DecisionRequest): Promise<DecisionResult> {
    const started = performance.now();
    // Log-normal-ish delay: mostly near the median, with a long tail.
    const median = this.options.latencyMs ?? 120;
    const delay = Math.min(400, Math.max(40, median * Math.exp((this.rng.next() - 0.5) * 1.6)));
    const fails = this.rng.next() < (this.options.failureRate ?? 0);
    const probs = blur(oneHot(autopilot(lane.level, lane.lander)), this.rng);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const latencyMs = performance.now() - started;
        if (fails) resolve({ ok: false, latencyMs, error: this.options.failWith ?? { kind: "http", status: 503, message: "HTTP 503: simulated outage" } });
        else resolve({ ok: true, decision: { action: actionFromProbs(probs), probs, latencyMs, usage: null } });
      }, delay);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve({ ok: false, latencyMs: performance.now() - started, error: { kind: "aborted", message: "Request cancelled" } });
      });
    });
  }
}

/** Spreads weight from the picked option to its neighbours, as a model's softer answer would. */
function blur(p: Probabilities, rng: Rng): Probabilities {
  const soften = (values: readonly number[]): number[] => {
    const raw = values.map((v, i) => v * 3 + ((values[i - 1] ?? 0) + (values[i + 1] ?? 0)) * 0.8 + rng.next() * 0.35);
    const sum = raw.reduce((a, b) => a + b, 0);
    return raw.map((v) => v / sum);
  };
  const [left = 0, none = 0, right = 0] = soften(ROTATES.map((r) => p.rotate[r]));
  return { rotate: { left, none, right }, throttle: soften(p.throttle) };
}
