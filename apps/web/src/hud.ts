import { THROTTLE_LEVELS, type Rotate } from "@arena/engine";
import { oneHot, percentile, type DecisionError, type LaneRunner } from "@arena/decisions";

const ALERT_HOLD_MS = 2000;
import type { LaneSlot } from "./arena.ts";
import { LaneRenderer } from "./render.ts";

const ROTATES: readonly Rotate[] = ["left", "none", "right"];
const ROTATE_LABEL: Record<Rotate, string> = { left: "↺ Left", none: "Hold", right: "↻ Right" };
const throttleLabel = (i: number): string => (i === 0 ? "Off" : i === THROTTLE_LEVELS - 1 ? "Full" : String(i));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One option: probability on top, its bar, the option below. CSS fills the bar from `--p`. */
function barCol(label: string): { col: HTMLElement; fill: HTMLElement; value: HTMLElement } {
  const col = el("div", "bar-col");
  const fill = el("div", "bar-fill");
  const track = el("div", "bar-track");
  track.append(fill);
  const value = el("span", "bar-value", "—");
  col.append(value, track, el("span", "bar-label", label));
  return { col, fill, value };
}

/** `axis` sets how the group reads: rotate is a left-right steering axis, throttle a stack of power levels. */
function barGroup(title: string, axis: "rotate" | "throttle"): { root: HTMLElement; cols: HTMLElement } {
  const root = el("div", `bars bars-${axis}`);
  const cols = el("div", "bar-cols");
  root.append(el("h3", undefined, title), cols);
  return { root, cols };
}

/** One lane column: canvas, stats and the action/probability panel. */
export class LaneView {
  readonly root: HTMLElement;
  private readonly renderer: LaneRenderer;
  private readonly score: HTMLElement;
  private readonly stat: Record<"record" | "dps" | "latency" | "missed", HTMLElement>;
  private readonly alert: HTMLElement;
  private shownError: DecisionError | null = null;
  private alertUntil = 0;
  private readonly rotateBars = new Map<Rotate, ReturnType<typeof barCol>>();
  private readonly throttleBars: ReturnType<typeof barCol>[] = [];

  constructor(slot: LaneSlot, seed: number) {
    const { client } = slot;
    this.root = el("section", "lane");
    // Score sits in the header: it is the one number people compare across lanes.
    const head = el("header", "lane-head");
    const title = el("div", "lane-title");
    // The note explains how to read this lane's bars; it lives in the badge's
    // tooltip so the lane stays short enough to fit on one screen.
    const badge = el("span", "badge", client.kind);
    badge.title = client.note;
    badge.tabIndex = 0;
    title.append(el("h2", "lane-name", client.label), badge);
    const score = el("div", "lane-score");
    this.score = el("span", "lane-score-value", "0");
    score.append(this.score, el("span", "lane-score-label", "points"));
    head.append(title, score);
    const screen = el("div", "lane-screen");
    const canvas = el("canvas", "lane-canvas");
    this.renderer = new LaneRenderer(canvas, seed);
    // Over the canvas rather than above it, so an error never shifts the layout.
    this.alert = el("p", "lane-alert");
    this.alert.setAttribute("role", "status");
    this.alert.hidden = true;
    screen.append(canvas, this.alert);

    const stats = el("dl", "stats");
    const addStat = (name: string): HTMLElement => {
      const dd = el("dd", undefined, "—");
      const wrap = el("div");
      wrap.append(el("dt", undefined, name), dd);
      stats.append(wrap);
      return dd;
    };
    this.stat = {
      record: addStat("Landed / failed"),
      dps: addStat("Decisions"),
      latency: addStat("Latency"),
      missed: addStat("Missed"),
    };
    // Measured by us on every call, not vendor figures.
    this.stat.latency.parentElement!.title = "Median / 95th percentile round trip, measured in this browser on every call.";
    this.stat.missed.parentElement!.title = "Ticks where the answer was not back in time, so the lane repeated its last action.";

    const decision = el("div", "decision");
    const rot = barGroup("Rotate", "rotate");
    for (const r of ROTATES) {
      const bar = barCol(ROTATE_LABEL[r]);
      this.rotateBars.set(r, bar);
      rot.cols.append(bar.col);
    }
    const thr = barGroup("Throttle", "throttle");
    for (let i = 0; i < THROTTLE_LEVELS; i++) {
      const bar = barCol(throttleLabel(i));
      this.throttleBars[i] = bar;
      thr.cols.append(bar.col);
    }
    decision.append(rot.root, thr.root);

    this.root.append(head, screen, stats, decision);
  }

  update(slot: LaneSlot, elapsedSeconds: number): void {
    const { state, action, runner } = slot;
    this.renderer.draw(state, slot.lastScoreDelta);
    this.score.textContent = String(state.stats.score);
    this.stat.record.textContent = `${state.stats.landings} / ${state.stats.failures}`;
    const rate = elapsedSeconds > 0 ? (runner.decisions / elapsedSeconds).toFixed(1) : "0.0";
    this.stat.dps.innerHTML = `${runner.decisions}<span class="unit">at ${rate}/s</span>`;
    this.updateModelStats(runner);

    const probs = runner.probs ?? oneHot(action);
    for (const [r, bar] of this.rotateBars) setBar(bar, probs.rotate[r], r === action.rotate);
    this.throttleBars.forEach((bar, i) => setBar(bar, probs.throttle[i] ?? 0, i === action.throttle));
  }

  private updateModelStats(runner: LaneRunner): void {
    const p50 = percentile(runner.latencies, 50);
    const p95 = percentile(runner.latencies, 95);
    if (p50 === null || p95 === null) this.stat.latency.textContent = "—";
    else if (p95 < 1) this.stat.latency.textContent = "instant";
    else this.stat.latency.innerHTML = `${Math.round(p50)} / ${Math.round(p95)}<span class="unit">ms</span>`;

    const asked = runner.decisions + runner.missed;
    const share = asked > 0 ? Math.round((runner.missed / asked) * 100) : 0;
    this.stat.missed.innerHTML = runner.missed > 0 ? `${runner.missed}<span class="unit">${share}%</span>` : "0";
    const tokens = runner.usage.calls > 0 ? ` · ${runner.usage.inputTokens.toLocaleString("en-US")} tokens in` : "";
    this.stat.dps.parentElement!.title = `Answers received${tokens}`;

    // An error stays up for a moment after the next success, so a flaky lane
    // reads as flaky instead of flickering.
    const err = runner.lastError;
    const now = performance.now();
    if (err) {
      this.shownError = err;
      this.alertUntil = now + ALERT_HOLD_MS;
    }
    const stopped = runner.status === "stopped";
    const show = stopped || now < this.alertUntil;
    this.root.classList.toggle("is-retrying", show && !stopped);
    this.root.classList.toggle("is-stopped", stopped);
    this.alert.hidden = !show;
    const shown = this.shownError;
    if (show && shown) {
      const what = shown.kind === "http" && shown.status ? `HTTP ${shown.status}` : (ERROR_TEXT[shown.kind] ?? shown.kind);
      const errors = `${runner.errors} ${runner.errors === 1 ? "error" : "errors"}`;
      const text = stopped ? `${what}. Lane stopped, engine off.` : `${what}, retrying. Holding last action · ${errors}`;
      if (this.alert.textContent !== text) {
        this.alert.textContent = text;
        this.alert.title = shown.message;
      }
    }
  }
}

/** Plain words for the lane alert; the raw provider message is in its tooltip. */
const ERROR_TEXT: Partial<Record<string, string>> = {
  timeout: "Timed out",
  quota: "Out of quota",
  rate_limited: "Rate limited",
  auth: "API key rejected",
  not_configured: "No API key on the server",
  bad_response: "Unreadable answer",
  network: "Network error",
};

function setBar(bar: ReturnType<typeof barCol>, p: number, chosen: boolean): void {
  bar.fill.style.setProperty("--p", `${(p * 100).toFixed(1)}%`);
  bar.value.textContent = `${Math.round(p * 100)}%`;
  bar.col.classList.toggle("chosen", chosen);
}
