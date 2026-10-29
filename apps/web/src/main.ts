import { DECISION_HZ, DEFAULT_RUN_SECONDS, ENGINE_VERSION } from "@arena/engine";
import { Arena } from "./arena.ts";
import {
  LlmJsonClient,
  MODEL_LANES,
  RandomClient,
  ReplayClient,
  ScriptedClient,
  SimulatedModelClient,
  SystemOneClient,
  firstDivergence,
  isLlmPromptId,
  isPromptId,
  parseRecording,
  type DecisionClient,
  type Recording,
} from "@arena/decisions";
import { KeyboardController } from "./controllers.ts";
import { LaneView } from "./hud.ts";
import { icons } from "./icons.ts";
import "./style.css";

const params = new URLSearchParams(location.search);
const initialSeed = Number(params.get("seed")) || 42;
const runSeconds = Number(params.get("seconds")) || DEFAULT_RUN_SECONDS;
/**
 * `?lanes=jev,clef,qwen,llama,gemma,glm,laya,autopilot,you,random,simulated,flaky,broke`
 * picks the lanes and their order. Model lanes call /api/decide/:lane, which
 * holds the keys. Laya needs the local bridge (bridge/laya).
 */
const laneIds = (params.get("lanes") ?? "jev,clef,qwen,autopilot").split(",").map((s) => s.trim());
/**
 * Each model lane flies its own tuned prompt. `?prompt=p2` overrides it for
 * System One lanes, `?prompt=l1` for LLM lanes.
 */
const promptParam = params.get("prompt");
/**
 * `?replay=showcase` plays apps/web/public/replays/showcase.json: no keys, no
 * calls. The public build opens on the showcase replay; `?live` flies live.
 */
const replayName = params.get("replay") ?? (import.meta.env.PROD && !params.has("live") ? "showcase" : null);

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <h1>Decision Arena</h1>
      <p>Every lane flies the same seeded course and decides ${DECISION_HZ} times a second.</p>
      <p class="mode" id="mode"></p>
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
        <button id="save" type="button" title="Save this finished run as a replay" hidden>${icons.save}<span>Save replay</span></button>
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
    <span class="live-only"><kbd>←</kbd><kbd>→</kbd> rotate</span>
    <span class="live-only"><kbd>↑</kbd><kbd>↓</kbd> or <kbd>0</kbd>–<kbd>4</kbd> throttle</span>
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
const modeLine = $<HTMLParagraphElement>("mode");
const saveBtn = $<HTMLButtonElement>("save");

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
    const common = { id: lane.id, label: lane.label, model: lane.model, endpoint: `/api/decide/${lane.id}`, viaProxy: true };
    if (lane.protocol === "systemone") {
      const prompt = isPromptId(promptParam) ? promptParam : isPromptId(lane.prompt) ? lane.prompt : undefined;
      make[lane.id] = () => new SystemOneClient({ ...common, ...(prompt ? { prompt } : {}) });
    } else {
      const prompt = isLlmPromptId(promptParam) ? promptParam : isLlmPromptId(lane.prompt) ? lane.prompt : "l1";
      make[lane.id] = () => new LlmJsonClient({ ...common, prompt });
    }
  }
  const clients = laneIds.flatMap((id) => make[id]?.() ?? []);
  return clients.length > 0 ? clients : [keyboard, new SimulatedModelClient({ seed })];
}
let arena: Arena;
let views: LaneView[] = [];
let speed = 1;
/** Set while playing a recording; the run is then fixed and nothing is called. */
let recording: Recording | null = null;
/**
 * Set once a live run steps faster than real time. Models then get less wall
 * time per decision than live, so the run is not saved as a replay.
 */
let spedUp = false;

function fmt(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function render(a: Arena): void {
  a.lanes.forEach((slot, i) => views[i]?.update(slot, a.elapsed));
  const total = a.options.runSeconds;
  clock.textContent = `${fmt(a.elapsed)} / ${fmt(total)}`;
  progress.style.width = `${Math.min(100, (a.elapsed / total) * 100).toFixed(2)}%`;
  if (recording) showVerification(a, recording);
  if (a.isRunning && a.speed !== 1) spedUp = true;
  saveBtn.hidden = recording !== null || !a.finished;
  saveBtn.disabled = spedUp;
  saveBtn.title = spedUp ? "Only runs flown at 1× can be saved: faster speeds give models less time per decision." : "Save this finished run as a replay";
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
  spedUp = false;
  seedInput.value = String(seed);
  if (recording) {
    arena = new Arena({ seed: recording.seed, runSeconds: recording.runSeconds, clients: recording.lanes.map((l) => new ReplayClient(l)) }, render);
  } else {
    const url = new URL(location.href);
    url.searchParams.set("seed", String(seed));
    history.replaceState(null, "", url);
    arena = new Arena({ seed, runSeconds, clients: makeClients(seed) }, render);
  }
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

/**
 * A replay re-simulates physics from the recorded answers. Every decision
 * tick's state hash must match the recording's, or the page says where it
 * stopped matching instead of passing the run off as the recorded one.
 */
function showVerification(a: Arena, rec: Recording): void {
  let text = "Replay matches the recording so far.";
  let bad = false;
  for (const [i, slot] of a.lanes.entries()) {
    const at = firstDivergence(rec.lanes[i]!.hashes, slot.hashes, slot.state.finished);
    if (at !== null) {
      text = `${slot.client.label} differs from the recording from decision ${at + 1}. This build no longer reproduces it.`;
      bad = true;
      break;
    }
  }
  if (!bad && a.finished) text = `Replay matched the recording on all ${a.lanes.length} lanes, decision for decision.`;
  setMode(`Replay of a live run on ${new Date(rec.recordedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, played back without calling any model. ${text}`, bad);
}

function setMode(text: string, bad = false): void {
  if (modeLine.textContent !== text) modeLine.textContent = text;
  modeLine.classList.toggle("is-bad", bad);
}

/** In dev the run is written to public/replays; the public build downloads it. */
async function saveReplay(): Promise<void> {
  const rec = arena.toRecording();
  const name = `seed-${rec.seed}-${rec.recordedAt.slice(0, 19).replace(/[:T]/g, "-")}`;
  const json = JSON.stringify(rec);
  if (import.meta.env.DEV) {
    const res = await fetch(`/api/replays/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: json });
    setMode(res.ok ? `Saved as apps/web/public/replays/${name}.json. Watch it at ?replay=${name}.` : `Could not save the replay: HTTP ${res.status}.`, !res.ok);
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  link.download = `${name}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function toggle(): void {
  if (arena.isRunning) arena.pause();
  else arena.start();
  render(arena);
}

toggleBtn.addEventListener("click", toggle);
saveBtn.addEventListener("click", () => void saveReplay());
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

async function loadReplay(name: string): Promise<void> {
  if (!/^[\w-]+$/.test(name)) throw new Error(`"${name}" is not a replay name`);
  const res = await fetch(`${import.meta.env.BASE_URL}replays/${name}.json`);
  // The dev server and static hosts answer unknown paths with the page itself.
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) throw new Error(`no replay called "${name}"`);
  recording = parseRecording(await res.json());
  document.body.classList.add("is-replay");
  seedInput.readOnly = true;
  seedInput.title = "A replay always flies the course it was recorded on.";
}

if (replayName) {
  try {
    await loadReplay(replayName);
    setup(recording!.seed);
  } catch (err) {
    recording = null;
    setup(initialSeed);
    setMode(`Could not load the replay: ${err instanceof Error ? err.message : String(err)}. Flying live instead.`, true);
  }
} else {
  setup(initialSeed);
}
