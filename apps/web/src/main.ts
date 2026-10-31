import { COURSE_LEVELS, DT, MANOEUVRES, THROTTLE_LEVELS, type LaneState, type Manoeuvre, type Outcome } from "@lowgate/engine";
import { LaneReplay, argmax, usdFor, type BenchResults, type LaneResult, type Recording } from "@lowgate/decisions";
import raw from "../../../bench/results.json?raw";
import { siteHeader, trackHeaderHeight } from "./chrome.ts";
import { icons } from "./icons.ts";
import { KIND_LABEL, colorOf, darkColorOf, inkOn, kindOf, pilotsPhrase, tagOf } from "./lanes.ts";
import { CourseRenderer, type Banner, type LanderView } from "./render.ts";
import "./style.css";
import "./replay.css";

/**
 * Replay player (R6): every lane flies one benchmark course on the same
 * terrain, played back from its recording. Each recording is re-flown from
 * its seed and checked against its saved state hashes before it is shown, and
 * again decision by decision as it plays. Levels are in lockstep: every lane
 * flies level n together, and the next level starts once all have finished.
 */

/** Seconds every lane's outcome stays on screen before the next level starts. Display only. */
const OUTCOME_PAUSE_S = 2;
/** Never simulate more than this many steps per frame (e.g. after a background tab). */
const MAX_STEPS_PER_FRAME = 20;
/** The confidence line spans a level's longest possible run: 60 one-second decisions. */
const TIMELINE_DECISIONS = 60;
const SPEEDS = [1, 2, 4, 8, 16] as const;

const results = JSON.parse(raw) as BenchResults;
const recordingUrls = import.meta.glob<string>("../../../bench/*/*.json", { query: "?url", import: "default" });
const urlFor = (lane: string, seed: number) => recordingUrls[`../../../bench/${lane}/${seed}.json`];

const SHORT_OUTCOME: Record<Outcome, string> = {
  landed: "Landed",
  crashed_speed: "Too fast",
  crashed_tilt: "Too tilted",
  crashed_terrain: "Hit terrain",
  out_of_bounds: "Off course",
  timeout: "Out of time",
};

/** "Tilt 30° right · throttle 3 of 4", "Upright · engine off". */
const describe = (m: Manoeuvre): string => {
  const tilt = m.tilt === 0 ? "Upright" : `Tilt ${Math.abs(m.tilt)}° ${m.tilt > 0 ? "right" : "left"}`;
  const top = THROTTLE_LEVELS - 1;
  const throttle = m.throttle === 0 ? "engine off" : m.throttle === top ? "full throttle" : `throttle ${m.throttle} of ${top}`;
  return `${tilt} · ${throttle}`;
};
const ms = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const usd = (v: number): string => (v === 0 ? "$0" : v < 0.001 ? "<$0.001" : `$${v.toFixed(3)}`);

const params = new URLSearchParams(location.search);
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  ${siteHeader("replays")}
  <div class="page-intro wrap">
    <h1>Course replays</h1>
    <p class="lede">${pilotsPhrase(results.lanes.map((l) => l.lane))} fly the same terrain and wind. The game waits for every answer, so only the choices differ.</p>
  </div>
  <main class="viewer replay wrap">
    <section class="flight" aria-label="Flight">
      <div class="flight-head">
        <div class="flight-title"><h2 id="course-name">Course</h2><span class="badge" id="level-name"></span></div>
        <p class="verify" id="verify" role="status"></p>
      </div>
      <div class="screen"><canvas class="lane-canvas" id="canvas" aria-label="All pilots flying the current level"></canvas><button id="screen-toggle" type="button" class="screen-toggle icon-only"></button></div>
      <div class="deck">
        <div class="deck-play">
          <button id="toggle" type="button" class="primary"></button>
          <button id="prev" type="button" class="icon-only" title="Previous level (←)" aria-label="Previous level">${icons.prev}</button>
          <button id="restart" type="button" class="icon-only" title="Replay this level (R)" aria-label="Replay this level">${icons.restart}</button>
          <button id="next" type="button" class="icon-only" title="Next level (→)" aria-label="Next level">${icons.next}</button>
        </div>
        <div class="segmented" id="speed" role="group" aria-label="Playback speed">
          ${SPEEDS.map((n) => `<button type="button" data-speed="${n}" aria-pressed="${n === 1}">${n}×</button>`).join("")}
        </div>
        <div class="deck-course">
          <label for="course">Course</label>
          <select id="course">${results.courses.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>
        </div>
      </div>
      <p class="keys" aria-label="Keyboard shortcuts"><span><kbd>Space</kbd> play / pause</span><span><kbd>←</kbd> <kbd>→</kbd> level</span><span><kbd>R</kbd> replay level</span></p>
      <div class="board-wrap">
        <p class="board-note" id="board-note">How each level ended, shown as the replay reaches it. A number is the landing quality (0–100). Engine ${results.engine}.</p>
        <div class="board-scroll"><table class="board" id="board" aria-describedby="board-note"></table></div>
      </div>
    </section>
    <aside class="side lanes" id="lanes" aria-label="Pilots"><p class="lanes-hint">Each grid holds all ${MANOEUVRES.length} moves. <b>System One models</b> shade every move by probability; the <b>LLM</b> writes its pick as text, so only that move lights. Select a pilot to follow it; the eye hides it.</p></aside>
  </main>
`;
trackHeaderHeight();

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/**
 * Writes markup only when it changes. Rewriting a button's contents on every frame replaces the element under the
 * pointer between mousedown and mouseup, and the browser then drops the click.
 */
const shown = new WeakMap<Element, string>();
function setHtml(el: Element, html: string): void {
  if (shown.get(el) === html) return;
  shown.set(el, html);
  el.innerHTML = html;
}
const canvas = $<HTMLCanvasElement>("canvas");
const toggleBtn = $<HTMLButtonElement>("toggle");
/** The same toggle on the canvas, for phones, where the canvas stays on screen above the pilot cards and the deck does not. */
const screenToggle = $<HTMLButtonElement>("screen-toggle");
const courseSelect = $<HTMLSelectElement>("course");
const speedGroup = $<HTMLDivElement>("speed");

/** One lane in the player: its replay for the loaded course and its panel. */
interface PlayerLane {
  readonly result: LaneResult;
  readonly replay: LaneReplay | null;
  /** Why the lane is not shown on this course, if it is not. */
  readonly missing: string | null;
  readonly panel: Panel;
  /** Top probability of each decision played in this level, for the confidence line. */
  confidence: number[];
  shownPosition: number;
}

interface Panel {
  readonly root: HTMLElement;
  readonly status: HTMLSpanElement;
  readonly cells: HTMLSpanElement[];
  readonly pick: HTMLElement;
  readonly detail: HTMLSpanElement;
  readonly line: SVGPolylineElement;
  readonly area: SVGPolygonElement;
  readonly show: HTMLButtonElement;
}

let seed = results.courses.includes(Number(params.get("course"))) ? Number(params.get("course")) : results.courses[0]!;
let level = 0;
let lanes: PlayerLane[] = [];
let selected: string | null = params.get("lane");
/** The lane under the pointer in the panel list: highlighted on the course while hovered. */
let hovered: string | null = null;
const hidden = new Set<string>();
let running = false;
let speed = 1;
let accumulator = 0;
let lastFrame = 0;
/** Simulated seconds left on the end-of-level pause; null while the level is still being flown. */
let pauseLeft: number | null = null;
let loadToken = 0;
let renderer = new CourseRenderer(canvas, seed);

function makePanel(result: LaneResult): Panel {
  const root = document.createElement("section");
  root.className = "lane-panel";
  root.style.setProperty("--lane", colorOf(result.lane));
  root.tabIndex = 0;
  root.setAttribute("role", "button");
  root.setAttribute("aria-pressed", "false");
  root.innerHTML = `
    <div class="lane-head">
      <span class="lane-tag" aria-hidden="true"></span>
      <div class="lane-name-block"><h3></h3><span class="lane-kind"></span></div>
      <span class="lane-status"></span>
      <button type="button" class="lane-show" aria-pressed="true"></button>
    </div>
    <div class="lane-body">
      <div class="menu-grid" aria-hidden="true" title="Every option: tilt from left to right, throttle from off (bottom) to full (top). Darker means more likely.">${Array.from({ length: MANOEUVRES.length }, () => "<span></span>").join("")}</div>
      <div class="lane-pick"><b>–</b><span></span></div>
    </div>
    <svg class="confidence" viewBox="0 0 ${TIMELINE_DECISIONS} 20" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="${TIMELINE_DECISIONS}" y1="10" y2="10" class="confidence-mid"/>
      <polygon class="confidence-area"/><polyline class="confidence-line"/>
    </svg>`;
  root.querySelector("h3")!.textContent = result.label;
  root.querySelector(".lane-kind")!.textContent = KIND_LABEL[kindOf(result.lane)];
  const tag = root.querySelector<HTMLSpanElement>(".lane-tag")!;
  tag.textContent = tagOf(result.lane);
  tag.style.background = colorOf(result.lane);
  tag.style.color = inkOn(colorOf(result.lane));
  const show = root.querySelector<HTMLButtonElement>(".lane-show")!;
  show.setAttribute("aria-label", `Show ${result.label} on the course`);
  const grid = [...root.querySelectorAll<HTMLSpanElement>(".menu-grid span")];
  // Columns are tilts left to right; rows are throttle, full at the top. MANOEUVRES is tilt-major.
  const cells = MANOEUVRES.map((_, i) => grid[(4 - (i % 5)) * 7 + Math.floor(i / 5)]!);
  return {
    root,
    status: root.querySelector(".lane-status")!,
    cells,
    pick: root.querySelector(".lane-pick b")!,
    detail: root.querySelector(".lane-pick span")!,
    line: root.querySelector(".confidence-line")!,
    area: root.querySelector(".confidence-area")!,
    show,
  };
}

const panels = new Map(results.lanes.map((r) => [r.lane, makePanel(r)]));
$("lanes").append(...[...panels.values()].map((p) => p.root));
for (const [id, p] of panels) {
  const choose = () => {
    selected = selected === id ? null : id;
    updateUrl();
    render();
  };
  p.root.addEventListener("mouseenter", () => {
    hovered = id;
    if (!running) render();
  });
  p.root.addEventListener("mouseleave", () => {
    if (hovered === id) hovered = null;
    if (!running) render();
  });
  p.root.addEventListener("click", choose);
  p.root.addEventListener("keydown", (e) => {
    if (e.target !== p.root || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    e.stopPropagation();
    choose();
  });
  p.show.addEventListener("click", (e) => {
    // The icon is replaced as this runs, so the panel could not tell the click came from here: stop it now.
    e.stopPropagation();
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    render();
  });
}

async function loadCourse(next: number): Promise<void> {
  const token = ++loadToken;
  running = false;
  seed = next;
  courseSelect.value = String(seed);
  $("course-name").textContent = `Course ${seed}`;
  $("verify").textContent = "Loading and checking the recordings…";
  const loaded = await Promise.all(
    results.lanes.map(async (result): Promise<PlayerLane> => {
      const panel = panels.get(result.lane)!;
      const base = { result, panel, confidence: [], shownPosition: -1 };
      const url = urlFor(result.lane, seed);
      if (!url) return { ...base, replay: null, missing: "not flown on this course" };
      try {
        const response = await fetch(await url());
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const replay = new LaneReplay((await response.json()) as Recording);
        return { ...base, replay, missing: replay.check.ok ? null : `does not replay: ${replay.check.reason}` };
      } catch (err) {
        return { ...base, replay: null, missing: `could not load (${err instanceof Error ? err.message : String(err)})` };
      }
    }),
  );
  if (token !== loadToken) return;
  lanes = loaded;
  renderer = new CourseRenderer(canvas, seed);
  const ok = lanes.filter((l) => !l.missing);
  const decisions = ok.reduce((n, l) => n + l.replay!.rec.decisions.length, 0);
  $("verify").textContent =
    ok.length === lanes.length
      ? `✓ ${lanes.length} recordings verified, ${decisions.toLocaleString("en-GB")} decisions checked`
      : `${ok.length} of ${lanes.length} recordings replay to their saved states; the others are listed in their panels.`;
  $("verify").classList.toggle("is-bad", ok.length !== lanes.length);
  buildBoard();
  seekLevel(Math.min(COURSE_LEVELS - 1, Math.max(0, Number(params.get("level") ?? 1) - 1)));
  params.delete("level");
}

function playable(l: PlayerLane): l is PlayerLane & { replay: LaneReplay } {
  return l.replay !== null && l.missing === null;
}

function seekLevel(n: number): void {
  level = n;
  pauseLeft = null;
  for (const l of lanes) {
    l.confidence = [];
    l.shownPosition = -1;
    if (playable(l) && !l.replay.seek(level)) l.confidence = [];
  }
  renderer.reset();
  updateUrl();
  render();
}

/** Lanes that reached this level, so have something to draw. */
function flyingHere(l: PlayerLane): boolean {
  return playable(l) && l.replay.levelStarts.length > level;
}

function step(): void {
  const here = lanes.filter(flyingHere);
  if (pauseLeft === null) {
    for (const l of here) {
      const before = l.replay!.position;
      l.replay!.step();
      if (l.replay!.position !== before) {
        const d = l.replay!.current!;
        if (d.probs) l.confidence.push(Math.max(...d.probs));
      }
    }
    if (here.every((l) => l.replay!.levelOver() || l.replay!.mismatch)) pauseLeft = OUTCOME_PAUSE_S;
    return;
  }
  pauseLeft -= DT;
  if (pauseLeft > 0) return;
  if (level < COURSE_LEVELS - 1) seekLevel(level + 1);
  else {
    pauseLeft = 0;
    running = false;
  }
}

function courseOver(): boolean {
  return level === COURSE_LEVELS - 1 && pauseLeft !== null && pauseLeft <= 0;
}

function statusOf(l: PlayerLane): { text: string; tone: "good" | "bad" | "" } {
  if (l.missing) return { text: l.missing, tone: "bad" };
  const r = l.replay!;
  if (r.mismatch) return { text: `stopped: ${r.mismatch}`, tone: "bad" };
  if (r.levelStarts.length <= level) return { text: "Not flown", tone: "bad" };
  if (r.stopped()) return { text: `Stopped: ${r.rec.stoppedBy?.kind ?? "error"}`, tone: "bad" };
  const outcome = r.lane.outcome;
  if (outcome === "landed") return { text: `Landed, quality ${r.lane.results.at(-1)!.landing!.quality.toFixed(0)}`, tone: "good" };
  if (outcome) return { text: SHORT_OUTCOME[outcome], tone: "bad" };
  return { text: r.current ? `Decision ${r.current.n + 1}` : "Ready", tone: "" };
}

function renderPanel(l: PlayerLane): void {
  const p = l.panel;
  const visible = !hidden.has(l.result.lane);
  p.root.setAttribute("aria-pressed", String(selected === l.result.lane));
  p.root.classList.toggle("is-hidden", !visible);
  p.root.classList.toggle("is-hovered", hovered === l.result.lane);
  setHtml(p.show, visible ? icons.eye : icons.eyeOff);
  p.show.setAttribute("aria-pressed", String(visible));
  p.show.title = visible ? "Hide on the course" : "Show on the course";
  const status = statusOf(l);
  p.status.textContent = status.text;
  p.status.className = `lane-status${status.tone ? ` is-${status.tone}` : ""}`;

  const r = l.replay;
  const position = r && !l.missing ? r.position : -1;
  if (position === l.shownPosition) return;
  l.shownPosition = position;
  const d = r && !l.missing && r.lane.level.index === level ? r.current : null;
  const probs = d?.probs ?? null;
  p.cells.forEach((cell, i) => {
    // Absolute probability, square-root scaled so a few percent still shows: a 20% pick reads paler than a 90% one.
    const v = probs ? Math.sqrt(probs[i]!) : d && d.pick === i ? 1 : 0;
    cell.style.setProperty("--p", v.toFixed(3));
    cell.classList.toggle("is-pick", d !== null && d.pick === i);
  });
  if (!d) {
    p.pick.textContent = "–";
    p.detail.textContent = l.result.model ? "Waiting for the first decision" : "Scripted, no model";
  } else {
    const m = MANOEUVRES[d.pick]!;
    p.pick.textContent = describe(m);
    const parts = [
      !d.answered ? "unanswered, last manoeuvre repeated" : probs ? `${Math.round(probs[d.pick]! * 100)}% likely` : l.result.model ? "picked, no probabilities" : "scripted",
    ];
    if (l.result.model) parts.push(`answered in ${ms(d.latencyMs)}`);
    if (probs && argmax(probs) !== d.pick) parts.push("not its top option");
    p.detail.textContent = parts.join(" · ");
  }
  const hasProbs = r !== null && r.rec.decisions.some((x) => x.probs !== null);
  p.root.querySelector<SVGElement>(".confidence")!.style.display = hasProbs ? "" : "none";
  const points = l.confidence.map((c, i) => `${i + 0.5},${(20 - c * 20).toFixed(2)}`);
  p.line.setAttribute("points", points.join(" "));
  p.area.setAttribute("points", points.length ? `0.5,20 ${points.join(" ")} ${l.confidence.length - 0.5},20` : "");
}

/** The course table: one row per lane, one column per level, filled in as the replay reaches each result. */
function buildBoard(): void {
  const board = $<HTMLTableElement>("board");
  board.querySelector("thead")?.remove();
  board.querySelector("tbody")?.remove();
  const head = board.createTHead().insertRow();
  head.innerHTML = `<th scope="col">Pilot</th>${Array.from({ length: COURSE_LEVELS }, (_, i) => `<th scope="col"><button type="button" data-level="${i}" aria-label="Go to level ${i + 1}">${i + 1}</button></th>`).join("")}<th scope="col" class="num">Landed</th>`;
  const body = board.createTBody();
  for (const l of lanes) {
    const row = body.insertRow();
    row.dataset.lane = l.result.lane;
    const c = colorOf(l.result.lane);
    row.innerHTML = `<th scope="row"><span class="lane-tag" aria-hidden="true" style="background:${c};color:${inkOn(c)}">${tagOf(l.result.lane)}</span></th>${"<td></td>".repeat(COURSE_LEVELS)}<td class="num total"></td>`;
    const name = document.createElement("span");
    name.className = "lane-name";
    name.textContent = l.result.label;
    row.querySelector("th")!.append(name);
  }
}

function costOf(l: PlayerLane): string | null {
  if (!l.result.model || !l.replay) return null;
  let input = 0;
  let output = 0;
  for (const d of l.replay.rec.decisions) {
    input += d.usage?.inputTokens ?? 0;
    output += d.usage?.outputTokens ?? 0;
  }
  const price = l.result.model.price;
  return price.source === "none" ? null : usd(usdFor(input, output, price));
}

function renderBoard(): void {
  const board = $<HTMLTableElement>("board");
  for (const button of board.querySelectorAll<HTMLButtonElement>("thead button")) {
    const current = Number(button.dataset.level) === level;
    button.classList.toggle("is-current", current);
    if (current) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  for (const l of lanes) {
    const row = board.querySelector<HTMLTableRowElement>(`tr[data-lane="${l.result.lane}"]`);
    if (!row) continue;
    const results: readonly LaneState["results"][number][] = l.replay && !l.missing ? l.replay.lane.results : [];
    const cells = row.querySelectorAll("td");
    for (let i = 0; i < COURSE_LEVELS; i++) {
      const r = results[i];
      const td = cells[i]!;
      const notFlown = l.replay && !l.missing && l.replay.levelStarts.length <= i && i <= level;
      td.className = r ? (r.outcome === "landed" ? "is-good" : "is-bad") : i === level ? "is-current" : "";
      td.textContent = r ? (r.landing ? r.landing.quality.toFixed(0) : "✕") : notFlown ? "–" : "";
      td.title = r ? (r.landing ? `Level ${i + 1}: landed, quality ${r.landing.quality.toFixed(1)}` : `Level ${i + 1}: ${SHORT_OUTCOME[r.outcome].toLowerCase()}`) : "";
    }
    const landed = results.filter((r) => r.outcome === "landed").length;
    const cost = costOf(l);
    cells[COURSE_LEVELS]!.textContent = `${landed}/${results.length}`;
    cells[COURSE_LEVELS]!.title = cost ? `This course cost ${cost} at the model's listed price` : "";
  }
}

function render(): void {
  const here = lanes.filter(flyingHere);
  const first = here[0]?.replay;
  $("level-name").textContent = `Level ${level + 1} of ${COURSE_LEVELS}`;
  if (first) {
    const views: LanderView[] = here
      .filter((l) => !hidden.has(l.result.lane))
      .map((l) => {
        const color = darkColorOf(l.result.lane);
        return { id: l.result.lane, label: l.result.label, tag: tagOf(l.result.lane), color, ink: inkOn(color), state: l.replay!.lane };
      });
    let banner: Banner | null = null;
    if (pauseLeft !== null) {
      const landed = here.filter((l) => l.replay!.lane.outcome === "landed").length;
      banner = { text: `Level ${level + 1}: ${landed} of ${here.length} landed`, good: landed * 2 >= here.length, age: OUTCOME_PAUSE_S - pauseLeft };
    }
    const focus = hovered ?? selected;
    renderer.draw(first.lane.level, views, focus && !hidden.has(focus) ? focus : null, banner);
  }
  for (const l of lanes) renderPanel(l);
  renderBoard();
  const over = courseOver();
  setHtml(toggleBtn, over ? `${icons.restart}<span>Again</span>` : running ? `${icons.pause}<span>Pause</span>` : `${icons.play}<span>Play</span>`);
  setHtml(screenToggle, over ? icons.restart : running ? icons.pause : icons.play);
  screenToggle.setAttribute("aria-label", over ? "Play again" : running ? "Pause" : "Play");
  $<HTMLButtonElement>("prev").disabled = level === 0;
  $<HTMLButtonElement>("next").disabled = level === COURSE_LEVELS - 1;
}

function frame(now: number): void {
  if (!running) return;
  accumulator += ((now - lastFrame) / 1000) * speed;
  lastFrame = now;
  let steps = 0;
  while (accumulator >= DT && steps < MAX_STEPS_PER_FRAME * speed && running) {
    step();
    accumulator -= DT;
    steps++;
  }
  if (steps >= MAX_STEPS_PER_FRAME * speed) accumulator = 0;
  render();
  if (running) requestAnimationFrame(frame);
}

function toggle(): void {
  if (courseOver()) {
    seekLevel(0);
  }
  running = !running;
  if (running) {
    lastFrame = performance.now();
    accumulator = 0;
    requestAnimationFrame(frame);
  }
  render();
}

function updateUrl(): void {
  const q = new URLSearchParams({ course: String(seed), level: String(level + 1) });
  if (selected) q.set("lane", selected);
  history.replaceState(null, "", `?${q}`);
}

toggleBtn.addEventListener("click", toggle);
screenToggle.addEventListener("click", toggle);
$("restart").addEventListener("click", () => seekLevel(level));
$("prev").addEventListener("click", () => level > 0 && seekLevel(level - 1));
$("next").addEventListener("click", () => level < COURSE_LEVELS - 1 && seekLevel(level + 1));
$("board").addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-level]");
  if (button) seekLevel(Number(button.dataset.level));
});
// A row under the pointer highlights its lane on the course, as its panel does.
$("board").addEventListener("mouseover", (e) => {
  const lane = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-lane]")?.dataset.lane ?? null;
  if (lane === hovered) return;
  hovered = lane;
  if (!running) render();
});
$("board").addEventListener("mouseleave", () => {
  hovered = null;
  if (!running) render();
});
courseSelect.addEventListener("change", () => void loadCourse(Number(courseSelect.value)));
speedGroup.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-speed]");
  if (!btn) return;
  speed = Number(btn.dataset.speed);
  for (const b of speedGroup.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === btn));
  setTick();
});
/** Panel shading eases over part of one decision's time on screen, so it keeps up at every speed. */
function setTick(): void {
  $("lanes").style.setProperty("--tick", `${Math.round(Math.min(300, 400 / speed))}ms`);
}
setTick();
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if ((e.target as HTMLElement).closest?.(".lane-panel") && (e.key === " " || e.key === "Enter")) return;
  if (e.key === " ") {
    e.preventDefault();
    toggle();
  } else if (e.key === "r" || e.key === "R") seekLevel(level);
  else if (e.key === "ArrowLeft" && level > 0) seekLevel(level - 1);
  else if (e.key === "ArrowRight" && level < COURSE_LEVELS - 1) seekLevel(level + 1);
});
window.addEventListener("resize", () => render());

void loadCourse(seed);
