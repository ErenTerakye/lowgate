/**
 * Every tunable of the simulation lives here. Changing any value changes
 * replays, so bump ENGINE_VERSION whenever one of them changes.
 */
export const ENGINE_VERSION = "descent-3";

export const PHYSICS_HZ = 60;
/** Every decision picks one manoeuvre and holds it this long. The game waits for the answer. */
export const DECISION_SECONDS = 1;
export const STEPS_PER_DECISION = PHYSICS_HZ * DECISION_SECONDS;
export const DT = 1 / PHYSICS_HZ;

/** World size in metres; y points up, x runs left to right. */
export const WORLD_WIDTH = 400;
export const WORLD_HEIGHT = 300;
export const TERRAIN_SEGMENT = 10;
export const TERRAIN_POINTS = WORLD_WIDTH / TERRAIN_SEGMENT + 1;

export const GRAVITY = 3.2;
/** Acceleration at the top throttle level, m/s². */
export const MAX_THRUST = 8.4;
export const THROTTLE_LEVELS = 5;
/** Half-degree steps keep every reachable angle exactly representable. */
export const ROTATE_DEG_PER_STEP = 0.5;
export const MAX_TILT_DEG = 60;

export const FUEL_CAPACITY = 100;
/** Fuel units per second at full throttle (25 s of full burn per level). */
export const FUEL_BURN_FULL = 4;

/** Touchdown limits for a safe landing. */
export const SAFE_VY = 3;
export const SAFE_VX = 1.5;
export const SAFE_TILT_DEG = 8;

/** Raised from 45 s in descent-3: the menu sweep showed sound flights timing out a second from touchdown. */
export const LEVEL_TIME_LIMIT_S = 60;
export const WIND_KNOT_S = 4;

/** A course is this many levels of one seed, flown in order. Every lane flies all of them. */
export const COURSE_LEVELS = 8;

/** Target tilts of the manoeuvre menu, in degrees; every one is crossed with every throttle level. */
export const MENU_TILTS: readonly number[] = [-30, -15, -5, 0, 5, 15, 30];
