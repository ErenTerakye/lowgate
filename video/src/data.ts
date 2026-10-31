import raw from "./data/flights.json";

export interface Pad {
  x0: number;
  x1: number;
  y: number;
}

export interface Flight {
  lane: string;
  label: string;
  outcome: string;
  /** Per physics step: x, y, angle, throttle. */
  steps: [number, number, number, number][];
  picks: { pick: number; probs: number[] | null; latencyMs: number | null }[];
}

export interface LaneSummary {
  lane: string;
  label: string;
  landed: number;
  levels: number;
  quality: number | null;
  p50Ms: number;
  answerSeconds: number;
}

export interface Data {
  world: { width: number; height: number; segment: number };
  race: { seed: number; level: number; terrain: number[]; pad: Pad; flights: Flight[] };
  traces: Record<string, { outcome: string; pts: [number, number][] }[]>;
  lanes: LaneSummary[];
}

export const DATA = raw as unknown as Data;

export const flightOf = (lane: string): Flight => {
  const f = DATA.race.flights.find((x) => x.lane === lane);
  if (!f) throw new Error(`no race flight for ${lane}`);
  return f;
};

export const laneOf = (lane: string): LaneSummary => {
  const l = DATA.lanes.find((x) => x.lane === lane);
  if (!l) throw new Error(`no results for ${lane}`);
  return l;
};

/** Menu order is tilt-major: index = tilt column * 5 + throttle. */
export const MENU_TILTS = [-30, -15, -5, 0, 5, 15, 30];
export const THROTTLES = 5;

/** A lander's state at a fractional step, interpolated so slow playback stays smooth. */
export function stateAt(f: Flight, step: number): { x: number; y: number; angle: number; throttle: number } {
  const n = f.steps.length - 1;
  const s = Math.max(0, Math.min(n, step));
  const i = Math.floor(s);
  const a = f.steps[i]!;
  const b = f.steps[Math.min(n, i + 1)]!;
  const u = s - i;
  return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, angle: a[2] + (b[2] - a[2]) * u, throttle: a[3] };
}
