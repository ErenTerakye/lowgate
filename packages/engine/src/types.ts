export type Rotate = "left" | "none" | "right";
/** Throttle level 0 (off) to 4 (full). */
export type Throttle = 0 | 1 | 2 | 3 | 4;

/** One decision, held for a full decision tick. */
export interface Action {
  readonly rotate: Rotate;
  readonly throttle: Throttle;
}

export const IDLE: Action = { rotate: "none", throttle: 0 };

export interface Pad {
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
}

export interface Level {
  readonly index: number;
  readonly seed: number;
  /** Terrain heights at x = i * TERRAIN_SEGMENT. */
  readonly terrain: readonly number[];
  readonly pad: Pad;
  readonly start: Lander;
  /** Horizontal wind acceleration (m/s²) at every WIND_KNOT_S seconds; linear in between. */
  readonly wind: readonly number[];
}

export interface Lander {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Tilt in degrees, positive leans right (thrust pushes +x). Multiple of 0.5. */
  readonly angle: number;
  readonly fuel: number;
  /** Physics steps since the level started. */
  readonly t: number;
  /** Throttle applied on the last step, for rendering the flame. */
  readonly throttle: Throttle;
}

export type Outcome =
  | "landed"
  | "crashed_speed"
  | "crashed_tilt"
  | "crashed_terrain"
  | "out_of_bounds"
  | "timeout";

export interface LaneStats {
  readonly score: number;
  readonly landings: number;
  readonly failures: number;
}

export interface LaneState {
  readonly seed: number;
  readonly runSteps: number;
  readonly level: Level;
  readonly lander: Lander;
  /** Set while the lane is frozen on a level's result. */
  readonly outcome: Outcome | null;
  /** Step at which the next level starts (always a decision boundary). */
  readonly resumeAt: number;
  readonly step: number;
  readonly stats: LaneStats;
  readonly finished: boolean;
}
