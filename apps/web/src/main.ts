import { COURSE_LEVELS, DT, MANOEUVRES, PHYSICS_HZ, STEPS_PER_DECISION, THROTTLE_LEVELS, type LaneState, type Manoeuvre, type Outcome } from "@lowgate/engine";
import { LaneReplay, argmax, usdFor, type BenchResults, type LaneResult, type Recording } from "@lowgate/decisions";
import raw from "../../../bench/results.json?raw";
import { siteFooter, siteHeader, trackHeaderHeight } from "./chrome.ts";
import { icons } from "./icons.ts";
import { KIND_LABEL, colorOf, darkColorOf, inkOn, kindOf, pilotsPhrase, tagOf } from "./lanes.ts";
import { BANNER_IN_S, CourseRenderer, type Banner, type LanderView } from "./render.ts";
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
/** How long a touch on a pilot's eye must be held to show only that pilot. */
const LONG_PRESS_MS = 500;
/** A trail keeps a point every this many physics steps, up to this many points: the last 10 simulated seconds at any speed. */
const TRAIL_EVERY = 4;
const TRAIL_POINTS = 150;
/** Page Up and Page Down on the timeline jump this many decisions. */
const PAGE_DECISIONS = 10;

const results = JSON.parse(raw) as BenchResults;
// Eager: the map of 180 fingerprinted URLs is a few kB in the bundle, where lazy entries were 180 one-line modules,
// each a request the course load had to wait for before it could fetch the recording itself.
const recordingUrls = import.meta.glob<string>("../../../bench/*/*.json", { query: "?url", import: "default", eager: true });
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
/** Physics steps as whole seconds of the level, "0:42". */
const clockText = (steps: number): string => {
  const s = Math.floor(steps / PHYSICS_HZ);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
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
      <div class="screen"><canvas class="lane-canvas" id="canvas" aria-label="All pilots flying the current level"></canvas><div class="screen-empty" id="screen-empty" hidden><p>No pilots shown</p><button type="button" id="show-all">Show all</button></div><button id="screen-toggle" type="button" class="screen-toggle icon-only"></button></div>
      <div class="timeline" title="Drag to any moment of the level. Coloured ticks mark when each pilot's level ended.">
        <span class="timeline-time" id="time-now">0:00</span>
        <div class="timeline-track">
          <div class="timeline-marks" id="marks" aria-hidden="true"></div>
          <input type="range" id="scrub" min="0" max="0" step="1" value="0" aria-label="Time in this level" />
        </div>
        <span class="timeline-time" id="time-end">0:00</span>
      </div>
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
      <p class="keys" aria-label="Keyboard shortcuts"><span><kbd>Space</kbd> play / pause</span><span><kbd>←</kbd> <kbd>→</kbd> level</span><span><kbd>,</kbd> <kbd>.</kbd> decision</span><span><kbd>R</kbd> replay level</span></p>
      <div class="board-wrap">
        <p class="board-note" id="board-note">How each level ended, shown as the replay reaches it. A number is the landing quality (0–100). Engine ${results.engine}.</p>
        <div class="board-scroll"><table class="board" id="board" aria-describedby="board-note"></table></div>
      </div>
    </section>
    <aside class="side lanes" id="lanes" aria-label="Pilots">
      <p class="lanes-hint">Each grid holds all ${MANOEUVRES.length} moves. <b>System One models</b> shade every move by probability; the <b>LLM</b> writes its pick as text, so only that move lights. Select a pilot to follow it; the eye hides it, and a double-click or long press on the eye shows only that pilot.</p>
      <div class="lane-filter" role="group" aria-label="Pilots on the course">
        <span class="lane-filter-count" id="shown-count" aria-live="polite"></span>
        <div class="lane-filter-buttons">
          <button type="button" data-show="all">Show all</button>
          <button type="button" data-show="none">Hide all</button>
          <button type="button" data-show="systemone" title="Only the System One models">System One</button>
          <button type="button" data-show="top3" title="The three pilots with the highest landing rate">Top 3</button>
        </div>
      </div>
    </aside>
  </main>
  ${siteFooter(results)}
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
const scrub = $<HTMLInputElement>("scrub");

/** One lane in the player: its replay for the loaded course and its panel. */
interface PlayerLane {
  readonly result: LaneResult;
  readonly replay: LaneReplay | null;
  /** Why the lane is not shown on this course, if it is not. */
  readonly missing: string | null;
  readonly panel: Panel;
  /** Top probability of each decision played in this level, for the confidence line. */
  confidence: number[];
  /** Where the lander has been in this level, sampled every TRAIL_EVERY steps. */
  trail: { x: number; y: number }[];
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
/** Lanes hidden on the course, kept in the URL so a filtered view can be shared. */
const hidden = new Set((params.get("hide") ?? "").split(",").filter((id) => results.lanes.some((l) => l.lane === id)));
let running = false;
let speed = 1;
let accumulator = 0;
let lastFrame = 0;
/** Simulated seconds left on the end-of-level pause; null while the level is still being flown. */
let pauseLeft: number | null = null;
/** Physics steps flown in this level: the replay clock, the same for every lane, since they fly in lockstep. */
let clock = 0;
/** Step at which the last lane's level is over: the length of the timeline. */
let levelEnd = 0;
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
  // Only a real pointer hovers: a tap would otherwise leave its pilot highlighted.
  p.root.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    hovered = id;
    if (!running) render();
  });
  p.root.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
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
  // A long press on the eye shows only this pilot; the click that ends it is then not a toggle.
  let pressTimer = 0;
  let longPressed = false;
  const cancelPress = () => clearTimeout(pressTimer);
  p.show.addEventListener("pointerdown", (e) => {
    longPressed = false;
    if (e.pointerType === "mouse") return;
    pressTimer = window.setTimeout(() => {
      longPressed = true;
      showOnly([id]);
    }, LONG_PRESS_MS);
  });
  for (const type of ["pointerup", "pointerleave", "pointercancel"] as const) p.show.addEventListener(type, cancelPress);
  // No text selection or system menu under a long press.
  p.show.addEventListener("contextmenu", (e) => e.preventDefault());
  p.show.addEventListener("click", (e) => {
    // The icon is replaced as this runs, so the panel could not tell the click came from here: stop it now.
    e.stopPropagation();
    if (longPressed) {
      longPressed = false;
      return;
    }
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    updateUrl();
    render();
  });
  p.show.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    showOnly([id]);
  });
}

/** Shows these lanes on the course and hides every other. */
function showOnly(ids: readonly string[]): void {
  hidden.clear();
  for (const l of results.lanes) if (!ids.includes(l.lane)) hidden.add(l.lane);
  updateUrl();
  render();
}

/** The quick picks above the cards. Top 3 is by the benchmark ranking (results.lanes is in rank order), not this course. */
const PRESETS: Record<string, () => string[]> = {
  all: () => results.lanes.map((l) => l.lane),
  none: () => [],
  systemone: () => results.lanes.filter((l) => kindOf(l.lane) === "systemone").map((l) => l.lane),
  top3: () => results.lanes.slice(0, 3).map((l) => l.lane),
};
$("lanes").querySelector(".lane-filter")!.addEventListener("click", (e) => {
  const preset = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-show]")?.dataset.show;
  if (preset && PRESETS[preset]) showOnly(PRESETS[preset]());
});
$("show-all").addEventListener("click", () => showOnly(PRESETS.all!()));

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
      const base = { result, panel, confidence: [], trail: [], shownPosition: -1 };
      const url = urlFor(result.lane, seed);
      if (!url) return { ...base, replay: null, missing: "not flown on this course" };
      try {
        const response = await fetch(url);
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
  // A shared link can point at one moment of the level: ?t= is in seconds.
  const t = Number(params.get("t"));
  if (t > 0) seekTime(t * PHYSICS_HZ);
  params.delete("level");
  params.delete("t");
}

function playable(l: PlayerLane): l is PlayerLane & { replay: LaneReplay } {
  return l.replay !== null && l.missing === null;
}

/** Puts every lane back at the start of the current level, with empty trails and confidence lines. */
function resetLevel(): void {
  pauseLeft = null;
  clock = 0;
  for (const l of lanes) {
    l.confidence = [];
    l.trail = [];
    l.shownPosition = -1;
    if (playable(l) && l.replay.seek(level)) {
      const { x, y } = l.replay.lane.lander;
      l.trail.push({ x, y });
    }
  }
  levelEnd = Math.max(0, ...lanes.filter(flyingHere).map((l) => l.replay!.levelSteps(level) ?? 0));
  renderer.reset();
}

function seekLevel(n: number): void {
  level = n;
  resetLevel();
  updateUrl();
  render();
}

/** Lanes that reached this level, so have something to draw. */
function flyingHere(l: PlayerLane): boolean {
  return playable(l) && l.replay.levelStarts.length > level;
}

/** True once every lane here has an outcome (or stopped), so the level is over. */
function levelDone(): boolean {
  return lanes.filter(flyingHere).every((l) => l.replay!.levelOver() || l.replay!.mismatch !== null);
}

/** One physics step for every lane still flying this level, in lockstep, with their trails and confidence lines. */
function advance(): void {
  clock++;
  for (const l of lanes) {
    if (!flyingHere(l)) continue;
    const r = l.replay!;
    const [before, position] = [r.lane, r.position];
    r.step();
    if (r.position !== position && r.current!.probs) l.confidence.push(Math.max(...r.current!.probs));
    // Every TRAIL_EVERY steps, and the step that ends the level, so the trail reaches the touchdown.
    if (r.lane !== before && (clock % TRAIL_EVERY === 0 || r.lane.outcome !== null)) {
      l.trail.push({ x: r.lane.lander.x, y: r.lane.lander.y });
      if (l.trail.length > TRAIL_POINTS) l.trail.shift();
    }
  }
}

/**
 * Moves the level to `target` physics steps from its start, as if it had played there: forward by flying on, back by
 * flying again from the start, which is cheap (a level is at most 3,600 steps per lane) and rebuilds the trails exactly.
 */
function seekTime(target: number): void {
  const to = Math.max(0, Math.min(levelEnd, Math.round(target)));
  if (to < clock) resetLevel();
  while (clock < to) advance();
  // A seek is not playback: crashes jumped over fire no debris or flash, and the camera frames the new moment at once.
  renderer.reset();
  // Arriving at the end shows its banner already in, rather than easing in on the next frame played. Staying at the
  // end keeps the pause's countdown where it was.
  pauseLeft = levelDone() ? (pauseLeft ?? OUTCOME_PAUSE_S - BANNER_IN_S) : null;
  updateUrl();
  render();
}

/** One decision forward or back: to the next or previous decision boundary, and from the end of a level to the next. */
function stepDecision(decisions: number): void {
  pause();
  if (decisions > 0 && pauseLeft !== null) {
    if (level < COURSE_LEVELS - 1) seekLevel(level + 1);
    return;
  }
  const at = decisions > 0 ? Math.floor(clock / STEPS_PER_DECISION) : Math.ceil(clock / STEPS_PER_DECISION);
  seekTime((at + decisions) * STEPS_PER_DECISION);
}

function step(): void {
  if (pauseLeft === null) {
    advance();
    if (levelDone()) pauseLeft = OUTCOME_PAUSE_S;
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
        return { id: l.result.lane, label: l.result.label, tag: tagOf(l.result.lane), color, ink: inkOn(color), state: l.replay!.lane, trail: l.trail };
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
  renderFilter();
  renderTimeline();
  const over = courseOver();
  setHtml(toggleBtn, over ? `${icons.restart}<span>Again</span>` : running ? `${icons.pause}<span>Pause</span>` : `${icons.play}<span>Play</span>`);
  setHtml(screenToggle, over ? icons.restart : running ? icons.pause : icons.play);
  screenToggle.setAttribute("aria-label", over ? "Play again" : running ? "Pause" : "Play");
  $<HTMLButtonElement>("prev").disabled = level === 0;
  $<HTMLButtonElement>("next").disabled = level === COURSE_LEVELS - 1;
}

/**
 * The level's timeline: the clock against the moment the last lane's level is over, and a tick in a lane's colour
 * where its level ended, shown once the replay gets there (the course table also fills in only as it is reached).
 */
function renderTimeline(): void {
  scrub.max = String(levelEnd);
  scrub.value = String(clock);
  scrub.disabled = levelEnd === 0;
  scrub.style.setProperty("--at", levelEnd ? (clock / levelEnd).toFixed(4) : "0");
  scrub.setAttribute("aria-valuetext", `${Math.floor(clock / PHYSICS_HZ)} of ${Math.floor(levelEnd / PHYSICS_HZ)} seconds`);
  $("time-now").textContent = clockText(clock);
  $("time-end").textContent = clockText(levelEnd);
  const marks = lanes
    .filter((l) => flyingHere(l) && !hidden.has(l.result.lane) && l.replay!.levelOver())
    .map((l) => `<span style="--at:${((l.replay!.levelSteps(level) ?? 0) / (levelEnd || 1)).toFixed(4)};--lane:${colorOf(l.result.lane)}"></span>`);
  setHtml($("marks"), marks.join(""));
}

/** The count above the cards, which quick pick (if any) matches what is shown, and the empty-course notice. */
function renderFilter(): void {
  const total = results.lanes.length;
  const shownIds = results.lanes.filter((l) => !hidden.has(l.lane)).map((l) => l.lane);
  $("shown-count").textContent = shownIds.length === total ? `All ${total} pilots shown` : `${shownIds.length} of ${total} pilots shown`;
  for (const b of $("lanes").querySelectorAll<HTMLButtonElement>("button[data-show]")) {
    const ids = PRESETS[b.dataset.show!]!();
    b.setAttribute("aria-pressed", String(ids.length === shownIds.length && ids.every((id) => shownIds.includes(id))));
  }
  $("screen-empty").hidden = shownIds.length > 0;
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

function play(): void {
  if (running) return;
  if (courseOver()) seekLevel(0);
  running = true;
  lastFrame = performance.now();
  accumulator = 0;
  requestAnimationFrame(frame);
  render();
}

function pause(): void {
  if (!running) return;
  running = false;
  // The paused moment goes in the URL, so it can be shared.
  updateUrl();
  render();
}

function toggle(): void {
  if (running) pause();
  else play();
}

let urlTimer = 0;
/**
 * Mirrors the view in the URL, so it can be shared: course, level, pilots, and the moment when paused. Debounced: a
 * scrub writes on every move, and Safari throws after 100 history writes in 30 seconds.
 */
function updateUrl(): void {
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    const q = new URLSearchParams({ course: String(seed), level: String(level + 1) });
    if (!running && clock > 0) q.set("t", String(Math.floor(clock / PHYSICS_HZ)));
    if (selected) q.set("lane", selected);
    if (hidden.size) q.set("hide", results.lanes.filter((l) => hidden.has(l.lane)).map((l) => l.lane).join(","));
    history.replaceState(null, "", `?${q}`);
  }, 150);
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
$("board").addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse") return;
  const lane = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-lane]")?.dataset.lane ?? null;
  if (lane === hovered) return;
  hovered = lane;
  if (!running) render();
});
$("board").addEventListener("pointerleave", () => {
  hovered = null;
  if (!running) render();
});
courseSelect.addEventListener("change", () => void loadCourse(Number(courseSelect.value)));
// Dragging the timeline holds playback, so the clock does not pull the thumb from under the pointer, then resumes it.
let resumeAfterScrub = false;
scrub.addEventListener("pointerdown", () => {
  resumeAfterScrub = running;
  if (running) pause();
});
scrub.addEventListener("input", () => seekTime(Number(scrub.value)));
scrub.addEventListener("change", () => {
  if (resumeAfterScrub) play();
  resumeAfterScrub = false;
});
// On the timeline, arrows step whole decisions (the input's own step is one physics step), and Space still plays.
scrub.addEventListener("keydown", (e) => {
  const by = { ArrowLeft: -1, ArrowDown: -1, ",": -1, ArrowRight: 1, ArrowUp: 1, ".": 1, PageDown: -PAGE_DECISIONS, PageUp: PAGE_DECISIONS }[e.key];
  if (by !== undefined) {
    e.preventDefault();
    stepDecision(by);
  } else if (e.key === " ") {
    e.preventDefault();
    toggle();
  }
});
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
  else if (e.key === ",") stepDecision(-1);
  else if (e.key === ".") stepDecision(1);
  else if (e.key === "ArrowLeft" && level > 0) seekLevel(level - 1);
  else if (e.key === "ArrowRight" && level < COURSE_LEVELS - 1) seekLevel(level + 1);
});
window.addEventListener("resize", () => render());

void loadCourse(seed);
