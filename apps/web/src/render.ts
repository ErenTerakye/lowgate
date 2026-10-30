import {
  DT,
  SAFE_VX,
  SAFE_VY,
  TERRAIN_SEGMENT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  clamp,
  createRng,
  terrainHeightAt,
  type LaneState,
  type Outcome,
  type Rng,
} from "@lowgate/engine";

export const OUTCOME_TEXT: Record<Outcome, string> = {
  landed: "Landed",
  crashed_speed: "Crashed: came down too fast",
  crashed_tilt: "Crashed: touched down tilted",
  crashed_terrain: "Crashed: missed the pad",
  out_of_bounds: "Lost: flew out of the area",
  timeout: "Out of time",
};

const TRAIL_STEPS = 150;
/** Closest the camera gets: the world is shown at most this many times larger. */
const MAX_ZOOM = 3.6;
/** Metres of space the camera keeps around the lander and the pad. */
const FRAME_MARGIN = 28;
/** The lander is never drawn smaller than this many CSS pixels per lander unit (about 38 px tall). */
const MIN_UNIT_PX = 6;
/** The velocity arrow shows where the lander will be this many seconds from now. */
const LOOKAHEAD_S = 2;
const FONT = '"IBM Plex Sans", system-ui, sans-serif';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  readonly maxLife: number;
  readonly size: number;
  readonly kind: "dust" | "debris" | "spark";
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Draws one lane's world onto its canvas: a descent camera that zooms in near
 * the ground, plus dust and debris effects. Purely visual: it reads game
 * state and never changes it, and its randomness is separate from the engine's.
 */
export class LaneRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fx: Rng;
  private readonly stars: { x: number; y: number; r: number }[];
  /** Recent positions, each marked with whether the speed was then inside the landing limits. */
  private trail: { x: number; y: number; ok: boolean }[] = [];
  private particles: Particle[] = [];
  private levelIndex = -1;
  private lastStep = 0;
  private lastOutcome: Outcome | null = null;
  private lastFrame = performance.now();
  private flash = 0;
  private cam = { zoom: 1, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, seed: number) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.fx = createRng(seed ^ 0x5eed);
    this.stars = Array.from({ length: 60 }, () => ({
      x: this.fx.range(0, WORLD_WIDTH),
      y: this.fx.range(40, WORLD_HEIGHT),
      r: this.fx.range(0.2, 0.7),
    }));
  }

  draw(lane: LaneState): void {
    const now = performance.now();
    const frameDt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    // Effects advance with simulation time, so they freeze on pause and follow the speed setting.
    const simDt = Math.max(0, lane.step - this.lastStep) * DT;
    this.lastStep = lane.step;

    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round((w * WORLD_HEIGHT) / WORLD_WIDTH);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const css = getComputedStyle(canvas);
    const color = (name: string): string => css.getPropertyValue(name).trim();

    this.trackEvents(lane, simDt);
    this.updateCamera(lane, frameDt);

    const s = (w / WORLD_WIDTH) * this.cam.zoom;
    const X = (x: number): number => (x - this.cam.x) * s + w / 2;
    const Y = (y: number): number => h / 2 - (y - this.cam.y) * s;

    this.drawSky(w, h, color);
    this.drawStars(w, h, s, color);
    this.drawTerrain(lane, h, s, X, Y, color);
    this.drawPad(lane, now, s, X, Y, color);
    this.drawTrail(s, X, Y, color);
    this.drawGuides(lane, dpr, s, X, Y, color);
    this.drawParticles(s, X, Y, color);
    this.drawLander(lane, X(lane.lander.x), Y(lane.lander.y), s, dpr, color);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 236, 200, ${this.flash * 0.35})`;
      ctx.fillRect(0, 0, w, h);
      this.flash = Math.max(0, this.flash - frameDt * 3);
    }
    this.drawBanner(lane, w, h, dpr, color);
  }

  private trackEvents(lane: LaneState, simDt: number): void {
    const { lander, level, outcome } = lane;
    if (level.index !== this.levelIndex) {
      this.levelIndex = level.index;
      this.trail = [];
      this.particles = [];
      this.lastOutcome = null;
      this.cam = { zoom: 1, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    }
    if (outcome === null) {
      this.trail.push({ x: lander.x, y: lander.y, ok: -lander.vy <= SAFE_VY && Math.abs(lander.vx) <= SAFE_VX });
      if (this.trail.length > TRAIL_STEPS) this.trail.shift();
    }

    const intensity = reducedMotion.matches ? 0.3 : 1;
    if (outcome !== this.lastOutcome && outcome !== null) {
      const ground = terrainHeightAt(level, lander.x);
      if (outcome === "landed") this.burst(lander.x, ground, 26 * intensity, "dust", 9);
      else if (outcome !== "timeout") {
        this.burst(lander.x, Math.max(ground, lander.y), 40 * intensity, "debris", 22);
        this.burst(lander.x, Math.max(ground, lander.y), 24 * intensity, "spark", 30);
        this.burst(lander.x, ground, 20 * intensity, "dust", 12);
        if (!reducedMotion.matches) this.flash = 1;
      }
    }
    this.lastOutcome = outcome;

    // Engine exhaust lifts dust off the surface below.
    const altitude = lander.y - terrainHeightAt(level, lander.x);
    if (outcome === null && lander.throttle > 0 && altitude < 22 && simDt > 0) {
      const n = Math.round(lander.throttle * (1 - altitude / 22) * 2 * intensity);
      for (let i = 0; i < n; i++) {
        const dir = this.fx.next() < 0.5 ? -1 : 1;
        this.spawn(lander.x + this.fx.range(-2, 2), terrainHeightAt(level, lander.x) + 0.3, dir * this.fx.range(6, 16), this.fx.range(0.5, 3), "dust");
      }
    }

    for (const p of this.particles) {
      p.life -= simDt;
      p.vy -= (p.kind === "dust" ? 0.6 : 3.2) * simDt;
      p.vx *= p.kind === "dust" ? 1 - 1.8 * simDt : 1;
      p.x += p.vx * simDt;
      p.y += p.vy * simDt;
      const floor = terrainHeightAt(level, p.x);
      if (p.y < floor) {
        p.y = floor;
        p.vy = p.kind === "debris" ? -p.vy * 0.3 : 0;
        p.vx *= 0.6;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private burst(x: number, y: number, count: number, kind: Particle["kind"], speed: number): void {
    for (let i = 0; i < count; i++) {
      const a = this.fx.range(0.1, Math.PI - 0.1);
      const v = this.fx.range(0.3, 1) * speed;
      this.spawn(x, y + 0.5, Math.cos(a) * v, Math.sin(a) * v * (kind === "dust" ? 0.35 : 1), kind);
    }
  }

  private spawn(x: number, y: number, vx: number, vy: number, kind: Particle["kind"]): void {
    const maxLife = kind === "spark" ? this.fx.range(0.3, 0.8) : kind === "dust" ? this.fx.range(0.8, 1.8) : this.fx.range(1.5, 3);
    const size = kind === "debris" ? this.fx.range(0.6, 1.6) : kind === "dust" ? this.fx.range(0.8, 2.2) : 0.4;
    this.particles.push({ x, y, vx, vy, life: maxLife, maxLife, size, kind });
  }

  /**
   * Frame the lander and the pad together: the camera holds both in view and
   * zooms in as they converge, so the target never leaves the screen.
   */
  private updateCamera(lane: LaneState, frameDt: number): void {
    const { lander, level } = lane;
    const { pad } = level;
    const ground = terrainHeightAt(level, lander.x);
    const x0 = Math.min(lander.x, pad.x0) - FRAME_MARGIN;
    const x1 = Math.max(lander.x, pad.x1) + FRAME_MARGIN;
    const y0 = Math.min(ground, pad.y) - FRAME_MARGIN * 0.6;
    const y1 = Math.max(lander.y, pad.y) + FRAME_MARGIN;
    const target = clamp(Math.min(WORLD_WIDTH / (x1 - x0), WORLD_HEIGHT / (y1 - y0)), 1, MAX_ZOOM);
    const k = reducedMotion.matches ? 1 : 1 - Math.exp(-frameDt * 2.5);
    const zoom = this.cam.zoom + (target - this.cam.zoom) * k;
    const halfW = WORLD_WIDTH / zoom / 2;
    const halfH = WORLD_HEIGHT / zoom / 2;
    const tx = clamp((x0 + x1) / 2, halfW, WORLD_WIDTH - halfW);
    const ty = clamp((y0 + y1) / 2, halfH, WORLD_HEIGHT - halfH);
    this.cam = {
      zoom,
      x: clamp(this.cam.x + (tx - this.cam.x) * k, halfW, WORLD_WIDTH - halfW),
      y: clamp(this.cam.y + (ty - this.cam.y) * k, halfH, WORLD_HEIGHT - halfH),
    };
  }

  private drawSky(w: number, h: number, color: (n: string) => string): void {
    const g = this.ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, color("--sky-top"));
    g.addColorStop(1, color("--sky-low"));
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, w, h);
  }

  private drawStars(w: number, h: number, s: number, color: (n: string) => string): void {
    const { ctx } = this;
    ctx.fillStyle = color("--star");
    const base = w / WORLD_WIDTH;
    // Stars are far away: they drift only slightly with the camera.
    const ox = (this.cam.x - WORLD_WIDTH / 2) * base * 0.15;
    const oy = (this.cam.y - WORLD_HEIGHT / 2) * base * 0.15;
    for (const st of this.stars) {
      ctx.beginPath();
      ctx.arc(st.x * base - ox, h - st.y * base + oy, Math.max(0.6, st.r * base * Math.min(1.6, s / base)), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTerrain(
    lane: LaneState,
    h: number,
    s: number,
    X: (x: number) => number,
    Y: (y: number) => number,
    color: (n: string) => string,
  ): void {
    const { ctx } = this;
    const { terrain } = lane.level;
    const top = Math.min(...terrain.map(Y));
    ctx.beginPath();
    ctx.moveTo(X(0), h + 2);
    terrain.forEach((ty, i) => ctx.lineTo(X(i * TERRAIN_SEGMENT), Y(ty)));
    ctx.lineTo(X(WORLD_WIDTH), h + 2);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, top, 0, h);
    g.addColorStop(0, color("--regolith"));
    g.addColorStop(1, color("--regolith-shadow"));
    ctx.fillStyle = g;
    ctx.fill();

    // Sunlit rim: slopes facing the light (left) read brighter.
    ctx.lineWidth = Math.max(1.5, s * 0.9);
    for (let i = 0; i < terrain.length - 1; i++) {
      const rising = terrain[i + 1]! > terrain[i]!;
      ctx.strokeStyle = color(rising ? "--rim-lit" : "--rim");
      ctx.beginPath();
      ctx.moveTo(X(i * TERRAIN_SEGMENT), Y(terrain[i]!));
      ctx.lineTo(X((i + 1) * TERRAIN_SEGMENT), Y(terrain[i + 1]!));
      ctx.stroke();
    }
  }

  private drawPad(lane: LaneState, now: number, s: number, X: (x: number) => number, Y: (y: number) => number, color: (n: string) => string): void {
    const { ctx } = this;
    const { pad } = lane.level;
    const dpr = window.devicePixelRatio || 1;
    const thick = Math.max(4 * dpr, s * 1.4);
    // A faint column of light marks the landing zone from any distance.
    const glowH = Math.max(60 * dpr, s * 30);
    const glow = ctx.createLinearGradient(0, Y(pad.y) - glowH, 0, Y(pad.y));
    glow.addColorStop(0, "rgba(0, 0, 0, 0)");
    glow.addColorStop(1, color("--pad-glow"));
    ctx.fillStyle = glow;
    ctx.fillRect(X(pad.x0), Y(pad.y) - glowH, X(pad.x1) - X(pad.x0), glowH);
    ctx.fillStyle = color("--pad");
    ctx.fillRect(X(pad.x0), Y(pad.y) - thick / 2, X(pad.x1) - X(pad.x0), thick);
    // Beacons blink until the lane lands, then hold steady.
    const landed = lane.outcome === "landed";
    const on = landed || reducedMotion.matches || Math.floor(now / 450) % 2 === 0;
    ctx.fillStyle = color(landed ? "--trail-ok" : "--beacon");
    for (const x of [pad.x0, pad.x1]) {
      ctx.globalAlpha = on ? 1 : 0.25;
      ctx.beginPath();
      ctx.arc(X(x), Y(pad.y) - thick / 2 - Math.max(3 * dpr, s), Math.max(3 * dpr, s * 0.9), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** The path flown, green while the speed was inside the landing limits and amber while it was not. */
  private drawTrail(s: number, X: (x: number) => number, Y: (y: number) => number, color: (n: string) => string): void {
    const { ctx } = this;
    if (this.trail.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const ok = color("--trail-ok");
    const over = color("--trail-over");
    ctx.lineWidth = Math.max(2 * dpr, s * 0.45);
    ctx.lineCap = "round";
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1]!;
      const b = this.trail[i]!;
      // Older segments fade so the latest path reads first.
      ctx.globalAlpha = 0.25 + 0.65 * (i / this.trail.length);
      ctx.strokeStyle = b.ok ? ok : over;
      ctx.beginPath();
      ctx.moveTo(X(a.x), Y(a.y));
      ctx.lineTo(X(b.x), Y(b.y));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }

  /** Where the lander is heading (its position LOOKAHEAD_S from now, ignoring thrust) and how high it is. */
  private drawGuides(
    lane: LaneState,
    dpr: number,
    s: number,
    X: (x: number) => number,
    Y: (y: number) => number,
    color: (n: string) => string,
  ): void {
    const { ctx } = this;
    const { lander, level } = lane;
    if (lane.outcome !== null) return;
    const ground = terrainHeightAt(level, lander.x);
    ctx.strokeStyle = color("--guide");
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([3 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(X(lander.x), Y(lander.y));
    ctx.lineTo(X(lander.x), Y(ground));
    ctx.stroke();
    ctx.setLineDash([]);

    const ok = -lander.vy <= SAFE_VY && Math.abs(lander.vx) <= SAFE_VX;
    const x0 = X(lander.x);
    const y0 = Y(lander.y + 3);
    const x1 = X(lander.x + lander.vx * LOOKAHEAD_S);
    const y1 = Y(lander.y + 3 + lander.vy * LOOKAHEAD_S);
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 6 * dpr) return;
    const head = Math.min(8 * dpr, len * 0.4);
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.strokeStyle = color(ok ? "--trail-ok" : "--trail-over");
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = Math.max(2 * dpr, s * 0.35);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - Math.cos(a) * head * 0.6, y1 - Math.sin(a) * head * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - Math.cos(a - 0.5) * head, y1 - Math.sin(a - 0.5) * head);
    ctx.lineTo(x1 - Math.cos(a + 0.5) * head, y1 - Math.sin(a + 0.5) * head);
    ctx.closePath();
    ctx.fill();
  }

  private drawParticles(s: number, X: (x: number) => number, Y: (y: number) => number, color: (n: string) => string): void {
    const { ctx } = this;
    const colors = { dust: color("--dust"), debris: color("--foil"), spark: color("--flame") };
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1) * (p.kind === "dust" ? 0.5 : 1);
      ctx.fillStyle = colors[p.kind];
      const r = Math.max(1, p.size * s * (p.kind === "dust" ? 1 + (1 - p.life / p.maxLife) : 1));
      if (p.kind === "debris") ctx.fillRect(X(p.x) - r / 2, Y(p.y) - r / 2, r, r * 0.6);
      else {
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawLander(lane: LaneState, cx: number, cy: number, s: number, dpr: number, color: (n: string) => string): void {
    const { ctx } = this;
    const { lander, outcome } = lane;
    const crashed = outcome !== null && outcome !== "landed" && outcome !== "timeout";
    if (crashed) return; // Debris particles take over.
    // One lander unit in pixels. Drawn larger than true scale (~8 m) when zoomed out
    // so it stays readable; the foot line (origin) is always at the true position.
    const u = Math.max(1.1 * s, MIN_UNIT_PX * dpr);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((lander.angle * Math.PI) / 180);

    if (outcome === null && lander.throttle > 0) {
      const len = u * (2 + lander.throttle * 1.6) * (0.9 + this.fx.next() * 0.2);
      const g = ctx.createLinearGradient(0, -u, 0, len);
      g.addColorStop(0, color("--flame-core"));
      g.addColorStop(1, "rgba(255, 180, 84, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-u * 1.1, -u * 1.2);
      ctx.quadraticCurveTo(0, len * 1.1, u * 1.1, -u * 1.2);
      ctx.closePath();
      ctx.fill();
    }

    // Legs with foot pads; origin is the foot line.
    ctx.strokeStyle = color("--metal");
    ctx.lineWidth = Math.max(1, u * 0.35);
    ctx.beginPath();
    ctx.moveTo(-u * 1.6, -u * 2.2);
    ctx.lineTo(-u * 3, 0);
    ctx.moveTo(u * 1.6, -u * 2.2);
    ctx.lineTo(u * 3, 0);
    ctx.stroke();
    ctx.fillStyle = color("--metal");
    ctx.fillRect(-u * 3.6, -u * 0.25, u * 1.2, u * 0.4);
    ctx.fillRect(u * 2.4, -u * 0.25, u * 1.2, u * 0.4);

    // Gold-foil descent stage, outlined so it stays separate from the terrain behind it.
    ctx.strokeStyle = color("--outline");
    ctx.lineWidth = Math.max(1.5 * dpr, u * 0.3);
    ctx.lineJoin = "round";
    ctx.fillStyle = color("--foil");
    ctx.beginPath();
    ctx.moveTo(-u * 2.4, -u * 1.4);
    ctx.lineTo(-u * 2, -u * 3.2);
    ctx.lineTo(u * 2, -u * 3.2);
    ctx.lineTo(u * 2.4, -u * 1.4);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = color("--foil-shadow");
    ctx.fillRect(-u * 2.3, -u * 1.9, u * 4.6, u * 0.5);
    ctx.fillRect(-u * 0.6, -u * 1.4, u * 1.2, u * 0.4);

    // Ascent stage cabin with a window.
    ctx.fillStyle = color("--metal");
    ctx.beginPath();
    ctx.moveTo(-u * 1.7, -u * 3.2);
    ctx.lineTo(-u * 1.3, -u * 5);
    ctx.lineTo(u * 0.6, -u * 5.4);
    ctx.lineTo(u * 1.7, -u * 4.4);
    ctx.lineTo(u * 1.7, -u * 3.2);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = color("--window");
    ctx.beginPath();
    ctx.moveTo(-u * 0.9, -u * 4.6);
    ctx.lineTo(-u * 0.1, -u * 4.9);
    ctx.lineTo(-u * 0.1, -u * 4.1);
    ctx.lineTo(-u * 0.9, -u * 4.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** The level's outcome, centred over the scene. Flight readouts live in the instrument panel beside the canvas. */
  private drawBanner(lane: LaneState, w: number, h: number, dpr: number, color: (n: string) => string): void {
    const { ctx } = this;
    if (lane.outcome !== null) {
      const ok = lane.outcome === "landed";
      const quality = lane.results.at(-1)?.landing?.quality;
      const text = ok && quality !== undefined ? `${OUTCOME_TEXT.landed}, quality ${quality.toFixed(0)}` : OUTCOME_TEXT[lane.outcome];
      ctx.font = `600 ${Math.round(22 * dpr)}px ${FONT}`;
      const tw = ctx.measureText(text).width;
      const bx = (w - tw) / 2 - 14 * dpr;
      const by = h * 0.24;
      ctx.fillStyle = color("--banner-bg");
      ctx.fillRect(bx, by, tw + 28 * dpr, 36 * dpr);
      ctx.fillStyle = color(ok ? "--banner-good" : "--banner-bad");
      ctx.fillRect(bx, by, 4 * dpr, 36 * dpr);
      ctx.fillStyle = color("--overlay");
      ctx.textBaseline = "middle";
      ctx.fillText(text, bx + 16 * dpr, by + 18 * dpr);
    }
  }
}
