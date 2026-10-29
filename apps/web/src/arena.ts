import { DT, IDLE, createLane, decisionTick, needsDecision, stepLane, type Action, type LaneState } from "@arena/engine";
import { LaneRunner, type CallRecord, type DecisionClient } from "@arena/decisions";

/** Never simulate more than this many steps per frame (e.g. after a background tab). */
const MAX_STEPS_PER_FRAME = 20;

export interface LaneSlot {
  readonly client: DecisionClient;
  /** Owns the client's timing: deadlines, missed ticks, errors. */
  readonly runner: LaneRunner;
  state: LaneState;
  action: Action;
  /** Points gained on the most recent landing, for the outcome banner. */
  lastScoreDelta: number;
}

export interface ArenaOptions {
  seed: number;
  runSeconds: number;
  clients: readonly DecisionClient[];
  /** Every finished call, per lane, for logging and (later) replays. */
  onCall?: (laneId: string, record: CallRecord) => void;
}

/**
 * Fixed-timestep loop shared by every lane. All lanes advance in lockstep on
 * the same seed, so they meet identical levels at identical run times.
 */
export class Arena {
  readonly lanes: LaneSlot[];
  speed = 1;
  private running = false;
  private accumulator = 0;
  private lastFrame = 0;
  private rafId = 0;

  constructor(
    readonly options: ArenaOptions,
    private readonly onFrame: (arena: Arena) => void,
  ) {
    this.lanes = options.clients.map((client) => ({
      client,
      runner: new LaneRunner(client, { onCall: (r) => options.onCall?.(client.id, r) }),
      state: createLane(options.seed, options.runSeconds),
      action: IDLE,
      lastScoreDelta: 0,
    }));
  }

  get isRunning(): boolean {
    return this.running;
  }

  get finished(): boolean {
    return this.lanes.every((l) => l.state.finished);
  }

  /** Run clock in seconds, from the first lane (all lanes share it). */
  get elapsed(): number {
    return (this.lanes[0]?.state.step ?? 0) * DT;
  }

  start(): void {
    if (this.running || this.finished) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Stops the loop and cancels every call in flight. */
  dispose(): void {
    this.pause();
    for (const slot of this.lanes) slot.runner.dispose();
  }

  /** Advance exactly one physics step for every lane. */
  step(): void {
    for (const slot of this.lanes) {
      if (needsDecision(slot.state)) slot.action = slot.runner.tick(slot.state, decisionTick(slot.state));
      const before = slot.state.stats.score;
      const level = slot.state.level.index;
      slot.state = stepLane(slot.state, slot.action);
      if (slot.state.level.index !== level) {
        slot.runner.newEpisode();
        slot.action = slot.runner.action;
      }
      if (slot.state.stats.score !== before) slot.lastScoreDelta = slot.state.stats.score - before;
    }
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.accumulator += ((now - this.lastFrame) / 1000) * this.speed;
    this.lastFrame = now;
    let steps = 0;
    while (this.accumulator >= DT && steps < MAX_STEPS_PER_FRAME * this.speed) {
      this.step();
      this.accumulator -= DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME * this.speed) this.accumulator = 0;
    this.onFrame(this);
    if (this.finished) {
      this.dispose();
      return;
    }
    this.rafId = requestAnimationFrame(this.frame);
  };
}
