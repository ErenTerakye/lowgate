export type Rotate = "left" | "none" | "right";
/** Throttle level 0 (off) to 4 (full). */
export type Throttle = 0 | 1 | 2 | 3 | 4;

/**
 * What the engine does on one physics step. Lanes never pick this directly:
 * they pick a Manoeuvre, which steers toward its tilt step by step.
 */
export interface Action {
  readonly rotate: Rotate;
  readonly throttle: Throttle;
}

export const IDLE: Action = { rotate: "none", throttle: 0 };

/** One entry of the menu every lane chooses from: a target tilt and a throttle, held for a decision. */
export interface Manoeuvre {
  /** Target tilt in degrees; the lander turns toward it at the usual rotation rate. */
  readonly tilt: number;
  readonly throttle: Throttle;
}

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

/** How one level of a course went. Landing details are null unless it landed. */
export interface LevelResult {
  readonly index: number;
  readonly outcome: Outcome;
  /** Decisions taken in the level, including the one it ended on. */
  readonly decisions: number;
  readonly seconds: number;
  readonly fuel: number;
  readonly landing: {
    /** Distance from the centre of the pad, metres. */
    readonly offset: number;
    readonly vx: number;
    readonly vy: number;
    /** 0–100: thirds for centring, gentleness and fuel left (see landingQuality). */
    readonly quality: number;
  } | null;
}

/** One lane flying one course. */
export interface LaneState {
  readonly seed: number;
  readonly level: Level;
  readonly lander: Lander;
  /** Set once the current level has ended; nextLevel() moves on. */
  readonly outcome: Outcome | null;
  /** Physics steps since the course started, across levels. */
  readonly step: number;
  readonly results: readonly LevelResult[];
  /** True once every level of the course has an outcome. */
  readonly finished: boolean;
}
