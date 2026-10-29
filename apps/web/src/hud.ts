import { FUEL_CAPACITY, THROTTLE_LEVELS, type Rotate } from "@arena/engine";
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
  private readonly stat: Record<"record" | "fuel" | "speed" | "dps", HTMLElement>;
  private readonly rotateBars = new Map<Rotate, ReturnType<typeof barCol>>();
  private readonly throttleBars: ReturnType<typeof barCol>[] = [];

  constructor(slot: LaneSlot, seed: number) {
    const { controller } = slot;
    this.root = el("section", "lane");
    // Score sits in the header: it is the one number people compare across lanes.
    const head = el("header", "lane-head");
    const title = el("div", "lane-title");
    // The note explains how to read this lane's bars; it lives in the badge's
    // tooltip so the lane stays short enough to fit on one screen.
    const badge = el("span", "badge", controller.kind);
    badge.title = controller.note;
    badge.tabIndex = 0;
    title.append(el("h2", "lane-name", controller.label), badge);
    const score = el("div", "lane-score");
    this.score = el("span", "lane-score-value", "0");
    score.append(this.score, el("span", "lane-score-label", "points"));
    head.append(title, score);
    const canvas = el("canvas", "lane-canvas");
    this.renderer = new LaneRenderer(canvas, seed);

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
      fuel: addStat("Fuel"),
      speed: addStat("Speed h, v (m/s)"),
      dps: addStat("Decisions"),
    };

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

    this.root.append(head, canvas, stats, decision);
  }

  update(slot: LaneSlot, elapsedSeconds: number): void {
    const { state, action } = slot;
    this.renderer.draw(state, slot.lastScoreDelta);
    const l = state.lander;
    this.score.textContent = String(state.stats.score);
    this.stat.record.textContent = `${state.stats.landings} / ${state.stats.failures}`;
    this.stat.fuel.textContent = `${Math.round((l.fuel / FUEL_CAPACITY) * 100)}%`;
    this.stat.speed.textContent = `${l.vx.toFixed(1)}, ${l.vy.toFixed(1)}`;
    const rate = elapsedSeconds > 0 ? (slot.decisions / elapsedSeconds).toFixed(1) : "0.0";
    this.stat.dps.innerHTML = `${slot.decisions}<span class="unit">at ${rate}/s</span>`;

    for (const [r, bar] of this.rotateBars) setBar(bar, r === action.rotate ? 1 : 0);
    this.throttleBars.forEach((bar, i) => setBar(bar, i === action.throttle ? 1 : 0));
  }
}

function setBar(bar: ReturnType<typeof barCol>, p: number): void {
  bar.fill.style.setProperty("--p", `${(p * 100).toFixed(1)}%`);
  bar.value.textContent = `${Math.round(p * 100)}%`;
  bar.col.classList.toggle("chosen", p >= 0.5);
}
