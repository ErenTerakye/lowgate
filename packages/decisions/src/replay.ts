import { MANOEUVRES, createLane, flyDecision, needsDecision, nextLevel, stateHash, stepLane, type LaneState, type Manoeuvre } from "@lowgate/engine";
import { replayRecording, type Recording, type ReplayCheck } from "./recording.ts";
import type { DecisionRecord } from "./runner.ts";

/** Where a level starts in a recording: the state before its first decision, and that decision's index. */
export interface LevelStart {
  readonly lane: LaneState;
  readonly decision: number;
}

/**
 * Plays one recording back step by step, for the replay player. The whole
 * recording is checked against its state hashes when the player is built
 * (`check`), and every decision is checked again as it is played, so what
 * is drawn is what the lane flew.
 */
export class LaneReplay {
  readonly rec: Recording;
  readonly check: ReplayCheck;
  /** One entry per level the lane reached, in order. */
  readonly levelStarts: readonly LevelStart[];
  private state: LaneState;
  private next = 0;
  private flying: Manoeuvre | null = null;
  private latest: DecisionRecord | null = null;
  private problem: string | null = null;

  constructor(rec: Recording) {
    this.rec = rec;
    this.check = replayRecording(rec);
    this.levelStarts = this.check.ok ? findLevelStarts(rec) : [];
    this.state = createLane(rec.seed);
  }

  get lane(): LaneState {
    return this.state;
  }

  /** The decision being flown, or null before the level's first one. */
  get current(): DecisionRecord | null {
    return this.latest;
  }

  /** Index of the next decision to play. */
  get position(): number {
    return this.next;
  }

  /** Set when a played state does not match its recorded hash. Playback stops there. */
  get mismatch(): string | null {
    return this.problem;
  }

  /** True when the lane cannot fly this level further: it ended, or the recording stopped (a fatal error). */
  levelOver(): boolean {
    return this.state.outcome !== null || this.state.finished || this.stopped();
  }

  /** The recording ran out of decisions while the level was still in progress. */
  stopped(): boolean {
    return this.state.outcome === null && !this.state.finished && needsDecision(this.state) && this.next >= this.flownDecisions();
  }

  /** Jump to the start of a level. Returns false if the lane never reached it. */
  seek(level: number): boolean {
    const start = this.levelStarts[level];
    if (!start) return false;
    this.state = start.lane;
    this.next = start.decision;
    this.flying = null;
    this.latest = null;
    return true;
  }

  /** One physics step. At a decision boundary the next recorded pick is checked against the state and taken. */
  step(): void {
    if (this.problem || this.levelOver()) return;
    if (needsDecision(this.state)) {
      const d = this.rec.decisions[this.next]!;
      const hash = stateHash(this.state);
      if (hash !== d.hash) {
        this.problem = `decision ${this.next} (level ${d.level + 1}): state hash ${hash}, recorded ${d.hash}`;
        return;
      }
      this.flying = MANOEUVRES[d.pick]!;
      this.latest = d;
      this.next++;
    }
    this.state = stepLane(this.state, this.flying!);
  }

  /** Decisions that were flown: a recording stopped by a fatal error keeps its last decision unflown. */
  private flownDecisions(): number {
    return this.rec.decisions.length - (this.rec.stoppedBy ? 1 : 0);
  }
}

function findLevelStarts(rec: Recording): LevelStart[] {
  const starts: LevelStart[] = [];
  let lane = createLane(rec.seed);
  const flown = rec.decisions.length - (rec.stoppedBy ? 1 : 0);
  for (let i = 0; i < flown; i++) {
    while (lane.outcome !== null && !lane.finished) lane = nextLevel(lane);
    if (lane.lander.t === 0) starts.push({ lane, decision: i });
    lane = flyDecision(lane, MANOEUVRES[rec.decisions[i]!.pick]!);
  }
  // A level the lane reached but was stopped at, on its first decision, still has a start.
  if (rec.stoppedBy) {
    while (lane.outcome !== null && !lane.finished) lane = nextLevel(lane);
    if (!lane.finished && lane.lander.t === 0 && starts.at(-1)?.lane.level.index !== lane.level.index) starts.push({ lane, decision: flown });
  }
  return starts;
}
