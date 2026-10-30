import { ENGINE_VERSION, MANOEUVRES, createLane, flyDecision, nextLevel, stateHash, type LaneState, type LevelResult } from "@lowgate/engine";
import type { CourseRun, DecisionRecord } from "./runner.ts";
import type { DecisionClient, DecisionError, ModelInfo } from "./types.ts";

/** Keeps the project's first name (renamed Low Gate on 2026-10-30) so recordings already on disk stay valid. */
export const RECORDING_FORMAT = "decision-arena/recording-2";

/**
 * One lane's flight over one course, as the benchmark stores it and the
 * replay player reads it. The picks and the seed are enough to rebuild every
 * state; the hashes prove a rebuild matches what the lane actually saw.
 */
export interface Recording {
  readonly format: typeof RECORDING_FORMAT;
  readonly engine: string;
  readonly lane: string;
  readonly label: string;
  readonly model: ModelInfo | null;
  readonly prompt: string;
  readonly seed: number;
  readonly results: readonly LevelResult[];
  readonly notFlown: readonly number[];
  readonly stoppedBy: DecisionError | null;
  readonly decisions: readonly DecisionRecord[];
  readonly flownAt: string;
}

export function makeRecording(client: DecisionClient, prompt: string, run: CourseRun, flownAt = new Date()): Recording {
  return {
    format: RECORDING_FORMAT,
    engine: ENGINE_VERSION,
    lane: client.id,
    label: client.label,
    model: client.model,
    prompt,
    seed: run.seed,
    results: run.results,
    notFlown: run.notFlown,
    stoppedBy: run.stoppedBy,
    decisions: run.decisions,
    flownAt: flownAt.toISOString(),
  };
}

export type ReplayCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Re-flies a recording's picks from its seed and checks each decision's state
 * hash and the level results. `onState` sees the state every decision was
 * asked at, in order, for statistics that need it (agreement with the autopilot).
 */
export function replayRecording(rec: Recording, onState?: (lane: LaneState, record: DecisionRecord) => void): ReplayCheck {
  if (rec.format !== RECORDING_FORMAT) return { ok: false, reason: `format ${rec.format}, expected ${RECORDING_FORMAT}` };
  if (rec.engine !== ENGINE_VERSION) return { ok: false, reason: `engine ${rec.engine}, this build is ${ENGINE_VERSION}` };
  let lane = createLane(rec.seed);
  for (const [i, d] of rec.decisions.entries()) {
    while (lane.outcome !== null && !lane.finished) lane = nextLevel(lane);
    if (lane.finished) return { ok: false, reason: `decision ${i} comes after the course ended` };
    if (stateHash(lane) !== d.hash) return { ok: false, reason: `decision ${i} (level ${d.level}, n ${d.n}): state hash ${stateHash(lane)}, recorded ${d.hash}` };
    onState?.(lane, d);
    // A decision that stopped the lane was never flown.
    if (rec.stoppedBy && i === rec.decisions.length - 1) break;
    lane = flyDecision(lane, MANOEUVRES[d.pick]!);
  }
  if (JSON.stringify(lane.results) !== JSON.stringify(rec.results)) return { ok: false, reason: "level results differ from the recording" };
  return { ok: true };
}
