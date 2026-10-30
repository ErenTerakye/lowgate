import {
  COURSE_LEVELS,
  DT,
  ENGINE_VERSION,
  FUEL_CAPACITY,
  LEVEL_TIME_LIMIT_S,
  MANOEUVRES,
  SAFE_TILT_DEG,
  SAFE_VX,
  SAFE_VY,
  autopilot,
  clamp,
  createLane,
  decisionInLevel,
  needsDecision,
  nextLevel,
  stepLane,
  summarize,
  terrainHeightAt,
  windAt,
  type LaneState,
  type Manoeuvre,
} from "@lowgate/engine";
import { icons } from "./icons.ts";
import { LaneRenderer, OUTCOME_TEXT } from "./render.ts";
import "./style.css";

/**
 * Course viewer for engine descent-3: the menu
 * autopilot flies one course of 8 levels, one manoeuvre per second. The
 * view with model lanes, the shared course and replays replace this in R6.
 */

/** Seconds a level's outcome stays on screen before the next level starts. Display only. */
const OUTCOME_PAUSE_S = 1.5;
/** Never simulate more than this many steps per frame (e.g. after a background tab). */
const MAX_STEPS_PER_FRAME = 20;
/** Picks shown in the decision strip. */
const RECENT = 10;

const params = new URLSearchParams(location.search);

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <h1>Low Gate</h1>
      <p>Course viewer: the autopilot picks one of ${MANOEUVRES.length} manoeuvres every second, across ${COURSE_LEVELS} levels.</p>
    </div>
    <nav><a href="./results.html">Benchmark results</a></nav>
  </header>
  <main class="viewer">
    <section class="flight" aria-label="Flight">
      <div class="flight-head">
        <div class="flight-title"><h2>Autopilot</h2><span class="badge">no model</span></div>
        <div class="flight-score"><b id="landed">0/0</b> landed</div>
      </div>
      <div class="screen"><canvas class="lane-canvas" id="canvas"></canvas></div>
      <div class="deck">
        <div class="deck-play">
          <button id="toggle" type="button" class="primary"></button>
          <button id="restart" type="button" class="icon-only" title="Restart this course (R)" aria-label="Restart this course">${icons.restart}</button>
        </div>
        <div class="segmented" id="speed" role="group" aria-label="Playback speed">
          ${[1, 2, 4, 8].map((n) => `<button type="button" data-speed="${n}" aria-pressed="${n === 1}">${n}×</button>`).join("")}
        </div>
        <div class="deck-course">
          <label for="seed">Course</label>
          <input id="seed" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" enterkeyhint="go" />
          <button id="new-seed" type="button" title="Fly a random course">${icons.dice}<span>Random</span></button>
        </div>
      </div>
      <ol class="levels" id="levels" aria-label="Levels of this course"></ol>
    </section>
    <aside class="side">
      <section class="panel-box" aria-labelledby="inst-title">
        <h3 id="inst-title">Instruments</h3>
        <div id="gauges"></div>
        <p class="gauge-note" id="wind"></p>
      </section>
      <section class="panel-box" aria-labelledby="pick-title">
        <h3 id="pick-title">Decision</h3>
        <div class="pick">
          <div class="pick-glyph" id="pick-glyph"></div>
          <div class="pick-text"><b id="manoeuvre">Waiting to start</b><span id="decision">–</span></div>
        </div>
        <p class="recent-label">Last ${RECENT} picks, newest on the right</p>
        <ol class="recent" id="recent"></ol>
      </section>
      <section class="panel-box" aria-labelledby="course-title">
        <h3 id="course-title">Course</h3>
        <dl class="summary">
          <div><dt>Mean quality</dt><dd id="quality">–</dd></div>
          <div><dt>Decisions</dt><dd id="decisions">0</dd></div>
        </dl>
        <ol class="level-results" id="results"></ol>
      </section>
    </aside>
  </main>
  <footer class="help">
    <span><kbd>Space</kbd> start / pause</span>
    <span><kbd>R</kbd> restart</span>
    <span>Engine version ${ENGINE_VERSION}.</span>
  </footer>
`;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const seedInput = $<HTMLInputElement>("seed");
const toggleBtn = $<HTMLButtonElement>("toggle");
const speedGroup = $<HTMLDivElement>("speed");
const canvas = $<HTMLCanvasElement>("canvas");

/** Altitude (m) under which a reading outside the landing limits would crash on touchdown. */
const DANGER_ALTITUDE = 25;

interface Gauge {
  readonly root: HTMLDivElement;
  readonly value: HTMLSpanElement;
  readonly flag: HTMLSpanElement;
  readonly marker: HTMLDivElement;
}

/** A gauge row: a track over [lo, hi] with the landing limits shaded, or a plain fill bar. */
function gauge(name: string, lo: number, hi: number, safe: readonly [number, number] | null, centred = false): Gauge {
  const root = document.createElement("div");
  root.className = "gauge";
  const at = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  root.innerHTML = `
    <div class="gauge-line"><span class="gauge-name"></span><span><span class="gauge-value"></span><span class="gauge-flag"></span></span></div>
    <div class="track" aria-hidden="true">
      ${safe ? `<div class="track-safe" style="left:${at(safe[0])};width:calc(${at(safe[1])} - ${at(safe[0])})"></div>` : ""}
      ${centred ? `<div class="track-centre"></div>` : ""}
      <div class="${safe ? "track-marker" : "track-fill"}"></div>
    </div>`;
  root.querySelector(".gauge-name")!.textContent = name;
  $("gauges").append(root);
  return {
    root,
    value: root.querySelector(".gauge-value")!,
    flag: root.querySelector(".gauge-flag")!,
    marker: root.querySelector(".track-marker, .track-fill")!,
  };
}

const placeAt = (v: number, lo: number, hi: number) => `${(clamp((v - lo) / (hi - lo), 0, 1) * 100).toFixed(2)}%`;

const gauges = {
  descent: gauge("Descent rate", 0, 10, [0, SAFE_VY]),
  sideways: gauge("Sideways speed", -6, 6, [-SAFE_VX, SAFE_VX], true),
  tilt: gauge("Tilt", -40, 40, [-SAFE_TILT_DEG, SAFE_TILT_DEG], true),
  altitude: gauge("Altitude", 0, 250, null),
  fuel: gauge("Fuel", 0, 1, null),
  time: gauge("Time left", 0, LEVEL_TIME_LIMIT_S, null),
};

/** Within the limits, outside them, or outside them close enough to the ground to crash. */
function setLimit(g: Gauge, over: boolean, altitude: number): void {
  const danger = over && altitude < DANGER_ALTITUDE;
  g.root.classList.toggle("is-over", over && !danger);
  g.root.classList.toggle("is-danger", danger);
  g.flag.textContent = danger ? "would crash" : over ? "over limit" : "";
}

function side(v: number, pos: string, neg: string, eps: number): string {
  return v > eps ? pos : v < -eps ? neg : "";
}

function updateInstruments(): void {
  const { lander, level } = lane;
  const altitude = Math.max(0, lander.y - terrainHeightAt(level, lander.x));
  const down = -lander.vy;
  gauges.descent.marker.style.left = placeAt(down, 0, 10);
  gauges.descent.value.textContent = `${Math.abs(lander.vy).toFixed(1)} m/s ${side(lander.vy, "up", "down", 0.05)}`.trim();
  setLimit(gauges.descent, down > SAFE_VY, altitude);

  gauges.sideways.marker.style.left = placeAt(lander.vx, -6, 6);
  gauges.sideways.value.textContent = `${Math.abs(lander.vx).toFixed(1)} m/s ${side(lander.vx, "right", "left", 0.05)}`.trim();
  setLimit(gauges.sideways, Math.abs(lander.vx) > SAFE_VX, altitude);

  gauges.tilt.marker.style.left = placeAt(lander.angle, -40, 40);
  gauges.tilt.value.textContent = lander.angle === 0 ? "upright" : `${Math.abs(lander.angle).toFixed(1)}° ${side(lander.angle, "right", "left", 0)}`;
  setLimit(gauges.tilt, Math.abs(lander.angle) > SAFE_TILT_DEG, altitude);

  gauges.altitude.marker.style.width = placeAt(altitude, 0, 250);
  gauges.altitude.value.textContent = `${altitude.toFixed(0)} m`;

  const fuel = lander.fuel / FUEL_CAPACITY;
  gauges.fuel.marker.style.width = placeAt(fuel, 0, 1);
  gauges.fuel.value.textContent = `${Math.round(fuel * 100)}%`;
  gauges.fuel.root.classList.toggle("is-low", fuel < 0.2);

  const left = Math.max(0, LEVEL_TIME_LIMIT_S - lander.t * DT);
  gauges.time.marker.style.width = placeAt(left, 0, LEVEL_TIME_LIMIT_S);
  gauges.time.value.textContent = `${left.toFixed(0)} s`;
  gauges.time.root.classList.toggle("is-low", left < 10);

  const wind = windAt(level, lander.t * DT);
  $("wind").textContent = `Shaded: landing limits. Wind ${Math.abs(wind).toFixed(2)} m/s² ${side(wind, "to the right", "to the left", 0.02)}`.trim() + ".";
}

/** A manoeuvre drawn: the target tilt as a line from upright, and throttle as pips. One string per menu entry. */
const GLYPHS = MANOEUVRES.map((m) => {
  const a = (m.tilt * Math.PI) / 180;
  const x2 = 20 + Math.sin(a) * 16;
  const y2 = 26 - Math.cos(a) * 16;
  const pips = Array.from({ length: 4 }, (_, i) => `<rect class="glyph-pip${i < m.throttle ? " is-on" : ""}" x="${8 + i * 6.5}" y="32" width="5" height="4" rx="1"/>`).join("");
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><line class="glyph-axis" x1="20" y1="8" x2="20" y2="27"/><line class="glyph-tilt" x1="20" y1="26" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>${pips}</svg>`;
});

const RECENT_LIST = $("recent");
RECENT_LIST.innerHTML = Array.from({ length: RECENT }, () => "<li></li>").join("");

let seed = Number(params.get("seed")) || 42;
let lane: LaneState;
let manoeuvre: Manoeuvre | null = null;
/** Menu indices of this level's picks, newest last. */
let recent: number[] = [];
let shownPicks = -1;
let shownResults = -1;
let renderer: LaneRenderer;
/** Simulated seconds left on the current outcome banner. */
let pauseLeft = 0;
let running = false;
let speed = 1;
let accumulator = 0;
let lastFrame = 0;

function describe(m: Manoeuvre): string {
  const side = m.tilt === 0 ? "Upright" : `${Math.abs(m.tilt)}° ${m.tilt > 0 ? "right" : "left"}`;
  return `${side}, throttle ${m.throttle} of 4`;
}

function setup(): void {
  lane = createLane(seed);
  manoeuvre = null;
  recent = [];
  shownPicks = -1;
  shownResults = -1;
  pauseLeft = 0;
  renderer = new LaneRenderer(canvas, seed);
  seedInput.value = String(seed);
  history.replaceState(null, "", `?seed=${seed}`);
  render();
}

function step(): void {
  if (lane.finished) return;
  if (lane.outcome !== null) {
    pauseLeft -= DT;
    if (pauseLeft <= 0) {
      lane = nextLevel(lane);
      recent = [];
    }
    return;
  }
  if (needsDecision(lane)) {
    const pick = autopilot(lane.level, lane.lander);
    manoeuvre = MANOEUVRES[pick]!;
    recent = [...recent.slice(-(RECENT - 1)), pick];
  }
  lane = stepLane(lane, manoeuvre!);
  if (lane.outcome !== null) pauseLeft = OUTCOME_PAUSE_S;
}

/** Redraws the pick glyphs only when a new decision arrives. */
function renderPicks(): void {
  const key = lane.level.index * 1e4 + decisionInLevel(lane) * 10 + recent.length;
  if (key === shownPicks) return;
  shownPicks = key;
  const items = RECENT_LIST.children;
  for (let i = 0; i < RECENT; i++) {
    const pick = recent[i - (RECENT - recent.length)];
    const li = items[i] as HTMLLIElement;
    li.innerHTML = pick === undefined ? "" : GLYPHS[pick]!;
    li.title = pick === undefined ? "" : describe(MANOEUVRES[pick]!);
  }
  const last = recent.at(-1);
  $("pick-glyph").innerHTML = last === undefined ? "" : GLYPHS[last]!;
}

function renderLevels(): void {
  $("levels").innerHTML = Array.from({ length: COURSE_LEVELS }, (_, i) => {
    const r = lane.results[i];
    if (r) {
      const ok = r.outcome === "landed";
      const text = ok ? `Level ${i + 1}: landed, quality ${r.landing!.quality.toFixed(0)}` : `Level ${i + 1}: ${OUTCOME_TEXT[r.outcome]}`;
      return `<li class="${ok ? "is-good" : "is-bad"}" title="${text}" aria-label="${text}"><span aria-hidden="true">${ok ? "✓" : "✕"} ${i + 1}</span></li>`;
    }
    const current = i === lane.level.index && !lane.finished;
    return `<li class="${current ? "is-current" : ""}"${current ? ' aria-current="step"' : ""}>${i + 1}</li>`;
  }).join("");
}

function render(): void {
  renderer.draw(lane);
  updateInstruments();
  renderPicks();
  const s = summarize(lane.results);
  $("landed").textContent = `${s.landed}/${s.levels}`;
  $("quality").textContent = s.meanQuality === null ? "–" : s.meanQuality.toFixed(1);
  $("decisions").textContent = String(s.decisions + (lane.outcome === null ? decisionInLevel(lane) : 0));
  $("manoeuvre").textContent = manoeuvre ? describe(manoeuvre) : "Waiting to start";
  $("decision").textContent = lane.outcome === null ? `Decision ${decisionInLevel(lane)} of level ${lane.level.index + 1}` : OUTCOME_TEXT[lane.outcome];
  const resultsKey = lane.results.length * 10 + lane.level.index;
  if (resultsKey !== shownResults) {
    shownResults = resultsKey;
    renderLevels();
    $("results").innerHTML = lane.results
      .map((r) => {
        const detail = r.landing ? `quality ${r.landing.quality.toFixed(0)}, ${r.landing.offset.toFixed(1)} m off centre` : OUTCOME_TEXT[r.outcome];
        return `<li class="${r.landing ? "is-good" : "is-bad"}">Level ${r.index + 1}: ${detail}, ${r.decisions} decisions</li>`;
      })
      .join("");
  }
  toggleBtn.innerHTML = lane.finished ? `${icons.play}<span>Finished</span>` : running ? `${icons.pause}<span>Pause</span>` : `${icons.play}<span>Start</span>`;
  toggleBtn.disabled = lane.finished;
}

function frame(now: number): void {
  if (!running) return;
  accumulator += ((now - lastFrame) / 1000) * speed;
  lastFrame = now;
  let steps = 0;
  while (accumulator >= DT && steps < MAX_STEPS_PER_FRAME * speed) {
    step();
    accumulator -= DT;
    steps++;
  }
  if (steps >= MAX_STEPS_PER_FRAME * speed) accumulator = 0;
  if (lane.finished) running = false;
  render();
  if (running) requestAnimationFrame(frame);
}

function toggle(): void {
  if (lane.finished) return;
  running = !running;
  if (running) {
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }
  render();
}

function restart(): void {
  running = false;
  setup();
}

toggleBtn.addEventListener("click", toggle);
$("restart").addEventListener("click", restart);
$("new-seed").addEventListener("click", () => {
  seed = Math.floor(Math.random() * 100_000) + 1;
  restart();
});
seedInput.addEventListener("change", () => {
  const n = Number(seedInput.value);
  if (Number.isInteger(n) && n > 0) seed = n;
  restart();
});
speedGroup.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-speed]");
  if (!btn) return;
  speed = Number(btn.dataset.speed);
  for (const b of speedGroup.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === btn));
});
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === " ") {
    e.preventDefault();
    toggle();
  } else if (e.key === "r" || e.key === "R") restart();
});
window.addEventListener("resize", () => renderer.draw(lane));

setup();
