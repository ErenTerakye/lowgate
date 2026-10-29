import { DECISION_HZ, DEFAULT_RUN_SECONDS, ENGINE_VERSION } from "@arena/engine";
import { Arena } from "./arena.ts";
import { DEFAULT_PROMPT, MODEL_LANES, RandomClient, isPromptId, ScriptedClient, SimulatedModelClient, SystemOneClient, type DecisionClient } from "@arena/decisions";
import { KeyboardController } from "./controllers.ts";
import { LaneView } from "./hud.ts";
import { icons } from "./icons.ts";
import "./style.css";

const params = new URLSearchParams(location.search);
const initialSeed = Number(params.get("seed")) || 42;
const runSeconds = Number(params.get("seconds")) || DEFAULT_RUN_SECONDS;
/**
 * `?lanes=jev,autopilot,you,random,simulated,flaky,broke` picks the lanes and
 * their order. Model lanes call /api/decide/:lane, which holds the keys.
 */
const laneIds = (params.get("lanes") ?? "jev,autopilot").split(",").map((s) => s.trim());
/** `?prompt=p2` flies model lanes with another prompt from PROMPTS. */
const promptParam = params.get("prompt");
const promptId = isPromptId(promptParam) ? promptParam : DEFAULT_PROMPT;

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <h1>Decision Arena</h1>
      <p>Every lane flies the same seeded course and decides ${DECISION_HZ} times a second.</p>
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
          ${[1, 2, 4].map((n) => `<button type="button" data-speed="${n}" aria-pressed="${n === 1}">${n}×</button>`).join("")}
        </div>
      </div>
      <div class="clock">
        <span id="clock">0:00 / 0:00</span>
        <div class="progress" aria-hidden="true"><div id="progress"></div></div>
      </div>
    </div>
  </header>
  <main class="lanes" id="lanes"></main>
  <footer class="help">
    <span><kbd>←</kbd><kbd>→</kbd> rotate</span>
    <span><kbd>↑</kbd><kbd>↓</kbd> or <kbd>0</kbd>–<kbd>4</kbd> throttle</span>
    <span><kbd>Space</kbd> start / pause</span>
    <span><kbd>R</kbd> restart</span>
    <span class="muted">Land upright on the pad: under 3 m/s down, 1.5 m/s sideways, 8° tilt. Engine version ${ENGINE_VERSION}.</span>
  </footer>
`;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const seedInput = $<HTMLInputElement>("seed");
const toggleBtn = $<HTMLButtonElement>("toggle");
const speedGroup = $<HTMLDivElement>("speed");
const clock = $<HTMLSpanElement>("clock");
const progress = $<HTMLDivElement>("progress");
const lanesRoot = $<HTMLElement>("lanes");

const keyboard = new KeyboardController();

/** Built fresh per course so seeded clients restart with it. */
function makeClients(seed: number): DecisionClient[] {
  const make: Record<string, () => DecisionClient> = {
    you: () => keyboard,
    autopilot: () => new ScriptedClient(),
    random: () => new RandomClient(seed),
    simulated: () => new SimulatedModelClient({ seed }),
    // Fails a quarter of its calls, to show the retry state.
    flaky: () => new SimulatedModelClient({ seed: seed + 1, failureRate: 0.25, id: "flaky", label: "Flaky model" }),
    // Out of credit on the first call, to show a lane that stops cleanly.
    broke: () =>
      new SimulatedModelClient({
        seed,
        failureRate: 1,
        failWith: { kind: "quota", status: 402, message: "HTTP 402: simulated, credit used up" },
        id: "broke",
        label: "Out-of-credit model",
      }),
  };
  for (const lane of Object.values(MODEL_LANES)) {
    if (lane.protocol !== "systemone") continue;
    make[lane.id] = () =>
      new SystemOneClient({ id: lane.id, label: lane.label, model: lane.model, endpoint: `/api/decide/${lane.id}`, viaProxy: true, prompt: promptId });
  }
  const clients = laneIds.flatMap((id) => make[id]?.() ?? []);
  return clients.length > 0 ? clients : [keyboard, new SimulatedModelClient({ seed })];
}
let arena: Arena;
let views: LaneView[] = [];
let speed = 1;

function fmt(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function render(a: Arena): void {
  a.lanes.forEach((slot, i) => views[i]?.update(slot, a.elapsed));
  clock.textContent = `${fmt(a.elapsed)} / ${fmt(runSeconds)}`;
  progress.style.width = `${Math.min(100, (a.elapsed / runSeconds) * 100).toFixed(2)}%`;
  if (a.finished) setToggle("Finished", "");
  else if (a.isRunning) setToggle("Pause", icons.pause);
  else setToggle(a.elapsed > 0 ? "Resume" : "Start", icons.play);
  toggleBtn.disabled = a.finished;
}

/** Rewrites the primary button only when its label changes, not every frame. */
function setToggle(label: string, icon: string): void {
  if (toggleBtn.dataset.label === label) return;
  toggleBtn.dataset.label = label;
  toggleBtn.innerHTML = `${icon}<span>${label}</span>`;
  toggleBtn.title = `${label} (Space)`;
}

function setup(seed: number): void {
  arena?.dispose();
  keyboard.reset();
  seedInput.value = String(seed);
  const url = new URL(location.href);
  url.searchParams.set("seed", String(seed));
  history.replaceState(null, "", url);

  arena = new Arena({ seed, runSeconds, clients: makeClients(seed) }, render);
  arena.speed = speed;
  views = arena.lanes.map((slot) => new LaneView(slot, seed));
  lanesRoot.replaceChildren(...views.map((v) => v.root));
  render(arena);
  fitLanes();
}

/**
 * Lanes are as wide as fits the window height (the canvas is 4:3, so width
 * sets height). Measure everything that is not canvas, which shifts as the
 * controls and stats wrap, and hand it to the CSS that sizes the columns.
 */
function fitLanes(): void {
  const lane = lanesRoot.firstElementChild;
  const canvas = lane?.querySelector("canvas");
  if (!lane || !canvas) return;
  const top = lanesRoot.getBoundingClientRect().top + scrollY;
  const bottomPad = parseFloat(getComputedStyle(lanesRoot).paddingBottom);
  const chrome = top + lane.getBoundingClientRect().height - canvas.getBoundingClientRect().height + bottomPad;
  lanesRoot.style.setProperty("--lane-chrome", `${Math.ceil(chrome)}px`);
  lanesRoot.style.setProperty("--lane-count", String(lanesRoot.childElementCount));
}

function toggle(): void {
  if (arena.isRunning) arena.pause();
  else arena.start();
  render(arena);
}

toggleBtn.addEventListener("click", toggle);
$("restart").addEventListener("click", () => setup(Number(seedInput.value) || initialSeed));
$("new-seed").addEventListener("click", () => setup(1 + Math.floor(Math.random() * 99_999)));
seedInput.addEventListener("change", () => setup(Number(seedInput.value) || initialSeed));
speedGroup.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-speed]");
  if (!btn) return;
  speed = Number(btn.dataset.speed);
  arena.speed = speed;
  for (const b of speedGroup.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === btn));
});
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === " ") {
    e.preventDefault();
    toggle();
  } else if (e.key === "r") {
    setup(Number(seedInput.value) || initialSeed);
  }
});
window.addEventListener("resize", () => {
  fitLanes();
  render(arena);
});

setup(initialSeed);
