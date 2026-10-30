import {
  COURSE_LEVELS,
  DT,
  ENGINE_VERSION,
  MANOEUVRES,
  autopilot,
  createLane,
  decisionInLevel,
  needsDecision,
  nextLevel,
  stepLane,
  summarize,
  type LaneState,
  type Manoeuvre,
} from "@arena/engine";
import { icons } from "./icons.ts";
import { LaneRenderer, OUTCOME_TEXT } from "./render.ts";
import "./style.css";

/**
 * Course viewer for engine descent-3: the menu
 * autopilot flies one course of 8 levels, one manoeuvre per second. The
 * arena with model lanes, the shared view and replays replace this in R6.
 */

/** Seconds a level's outcome stays on screen before the next level starts. Display only. */
const OUTCOME_PAUSE_S = 1.5;
/** Never simulate more than this many steps per frame (e.g. after a background tab). */
const MAX_STEPS_PER_FRAME = 20;

const params = new URLSearchParams(location.search);

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <h1>Decision Arena</h1>
      <p>Course viewer: the autopilot picks one of ${MANOEUVRES.length} manoeuvres every second, across ${COURSE_LEVELS} levels.</p>
    </div>
    <div class="controls">
      <div class="group">
        <label for="seed">Course</label>
        <input id="seed" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" />
        <button id="new-seed" type="button" title="Fly a random course">${icons.dice}<span>Random</span></button>
      </div>
      <div class="group">
        <button id="toggle" type="button" class="primary"></button>
        <button id="restart" type="button" title="Restart this course (R)">${icons.restart}<span>Restart</span></button>
        <div class="segmented" id="speed" role="group" aria-label="Simulation speed">
          ${[1, 2, 4, 8].map((n) => `<button type="button" data-speed="${n}" aria-pressed="${n === 1}">${n}×</button>`).join("")}
        </div>
      </div>
    </div>
  </header>
  <main class="lanes" style="--lane-count: 1">
    <section class="lane">
      <div class="lane-head">
        <div class="lane-title"><h2 class="lane-name">Autopilot</h2><span class="badge">no model</span></div>
        <div class="lane-score"><span class="lane-score-value" id="landed">0/0</span><span class="lane-score-label">landed</span></div>
      </div>
      <div class="lane-screen"><canvas class="lane-canvas" id="canvas"></canvas></div>
      <dl class="stats">
        <div><dt>Manoeuvre</dt><dd id="manoeuvre">–</dd></div>
        <div><dt>Decision</dt><dd id="decision">–</dd></div>
        <div><dt>Mean quality</dt><dd id="quality">–</dd></div>
        <div><dt>Decisions</dt><dd id="decisions">0</dd></div>
      </dl>
      <ol class="level-results" id="results"></ol>
    </section>
  </main>
  <footer class="help">
    <span><kbd>Space</kbd> start / pause</span>
    <span><kbd>R</kbd> restart</span>
    <span class="muted">Land upright on the pad: under 3 m/s down, 1.5 m/s sideways, 8° tilt. Engine version ${ENGINE_VERSION}.</span>
  </footer>
`;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const seedInput = $<HTMLInputElement>("seed");
const toggleBtn = $<HTMLButtonElement>("toggle");
const speedGroup = $<HTMLDivElement>("speed");
const canvas = $<HTMLCanvasElement>("canvas");

let seed = Number(params.get("seed")) || 42;
let lane: LaneState;
let manoeuvre: Manoeuvre | null = null;
let renderer: LaneRenderer;
/** Simulated seconds left on the current outcome banner. */
let pauseLeft = 0;
let running = false;
let speed = 1;
let accumulator = 0;
let lastFrame = 0;

function describe(m: Manoeuvre): string {
  const side = m.tilt === 0 ? "upright" : `${Math.abs(m.tilt)}° ${m.tilt > 0 ? "right" : "left"}`;
  return `${side}, throttle ${m.throttle}`;
}

function setup(): void {
  lane = createLane(seed);
  manoeuvre = null;
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
    if (pauseLeft <= 0) lane = nextLevel(lane);
    return;
  }
  if (needsDecision(lane)) manoeuvre = MANOEUVRES[autopilot(lane.level, lane.lander)]!;
  lane = stepLane(lane, manoeuvre!);
  if (lane.outcome !== null) pauseLeft = OUTCOME_PAUSE_S;
}

function render(): void {
  renderer.draw(lane);
  const s = summarize(lane.results);
  $("landed").textContent = `${s.landed}/${s.levels}`;
  $("quality").textContent = s.meanQuality === null ? "–" : s.meanQuality.toFixed(1);
  $("decisions").textContent = String(s.decisions + (lane.outcome === null ? decisionInLevel(lane) : 0));
  $("manoeuvre").textContent = manoeuvre ? describe(manoeuvre) : "–";
  $("decision").textContent = lane.outcome === null ? `${decisionInLevel(lane)} of level ${lane.level.index + 1}` : "–";
  $("results").innerHTML = lane.results
    .map((r) => {
      const detail = r.landing ? `quality ${r.landing.quality.toFixed(0)}, ${r.landing.offset.toFixed(1)} m off centre` : OUTCOME_TEXT[r.outcome];
      return `<li class="${r.landing ? "is-good" : "is-bad"}">Level ${r.index + 1}: ${detail}, ${r.decisions} decisions</li>`;
    })
    .join("");
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
