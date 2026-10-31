/**
 * Where each scene sits, in frames at 60 fps. The soundtrack script reads the same table, so a cue moves with the
 * scene it belongs to.
 */
export const SCENES = {
  hook: { from: 0, len: 210 },
  how: { from: 210, len: 450 },
  race: { from: 660, len: 420 },
  score: { from: 1080, len: 400 },
  traces: { from: 1480, len: 560 },
  speed: { from: 2040, len: 330 },
  end: { from: 2370, len: 270 },
} as const;

export const TOTAL_FRAMES = SCENES.end.from + SCENES.end.len;

/** LinkedIn loops its autoplay, so the last frames fade into the first: the end card leaves as the opening returns. */
export const LOOP_FADE = 40;

/** How It Works: real time for the first decisions, then up to speed so the landing fits the scene. */
export const HOW_SLOW_FRAMES = 110;
export const HOW_RAMP_FRAMES = 60;
/** Frames left at the end of a flight scene to see the result. */
export const HOW_HOLD = 60;

/** Physics steps flown by frame f of How It Works, for a flight of `total` steps. */
export function howStep(f: number, total: number): { step: number; speed: number } {
  const flying = SCENES.how.len - HOW_HOLD;
  const rampEnd = HOW_SLOW_FRAMES + HOW_RAMP_FRAMES;
  // Steps covered before the top speed: the slow part and the linear ramp from 1x to vmax.
  // total = slow + ramp * (1 + vmax) / 2 + (flying - rampEnd) * vmax
  const vmax = (total - HOW_SLOW_FRAMES - HOW_RAMP_FRAMES / 2) / (HOW_RAMP_FRAMES / 2 + (flying - rampEnd));
  if (f <= HOW_SLOW_FRAMES) return { step: Math.max(0, f), speed: 1 };
  if (f <= rampEnd) {
    const u = f - HOW_SLOW_FRAMES;
    const v = 1 + ((vmax - 1) * u) / HOW_RAMP_FRAMES;
    return { step: HOW_SLOW_FRAMES + (u * (1 + v)) / 2, speed: v };
  }
  const step = HOW_SLOW_FRAMES + (HOW_RAMP_FRAMES * (1 + vmax)) / 2 + (f - rampEnd) * vmax;
  return { step: Math.min(total, step), speed: vmax };
}

/** Race: every lane starts together and the longest flight ends RACE_HOLD frames before the scene does. */
export const RACE_LEAD = 50;
export const RACE_HOLD = 70;
export function raceStep(f: number, longest: number): number {
  const frames = SCENES.race.len - RACE_LEAD - RACE_HOLD;
  return Math.max(0, Math.min(longest, ((f - RACE_LEAD) / frames) * longest));
}

/** Scoreboard: when the other lanes dim and the caption turns to the Kev family. */
export const SCORE_FOCUS = 196;
/** The Kev rows light one by one, smallest first, at these frames of the scoreboard. */
export const KEV_LIGHTS: readonly [string, number][] = [
  ["kev-0.8b", 222],
  ["kev-4b", 240],
  ["kev-9b", 258],
  ["kev-27b", 276],
];

/** Traces: the small model's flights draw, hold, then the large model's. */
export const TRACE = {
  smallStart: 40,
  smallDraw: 170,
  bigStart: 270,
  bigDraw: 170,
} as const;
/** Longest flight is a 60 s timeout; trace points are every 10 physics steps. */
export const TRACE_POINTS_MAX = 361;
