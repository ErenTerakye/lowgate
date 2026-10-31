/**
 * Small hand-built SVG charts for the results page. Every mark is keyboard
 * focusable and shows the same tooltip on hover and focus; every value in a
 * tooltip is also on the page as text or in a table, so nothing is hover-only.
 * Lane names reach the DOM through textContent only.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | number>;

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

export function svgText(parent: Element, x: number, y: number, content: string, attrs: Attrs = {}): SVGTextElement {
  const t = el("text", { x, y, ...attrs }, parent);
  t.textContent = content;
  return t;
}

export interface TooltipRow {
  readonly value: string;
  readonly label: string;
}

/** One tooltip for the page: value first, label second, keyed by a short line of the lane colour. */
export class Tooltip {
  private readonly node = document.createElement("div");

  constructor() {
    this.node.className = "tooltip";
    this.node.setAttribute("role", "status");
    this.node.hidden = true;
    document.body.appendChild(this.node);
  }

  /** Wires a mark: hover and focus show the rows, leaving hides them. */
  attach(target: Element, title: string, color: string, rows: readonly TooltipRow[]): void {
    target.setAttribute("tabindex", "0");
    target.setAttribute("aria-label", `${title}: ${rows.map((r) => `${r.label} ${r.value}`).join(", ")}`);
    const show = (x: number, y: number) => this.show(title, color, rows, x, y);
    target.addEventListener("pointermove", (e) => show((e as PointerEvent).clientX, (e as PointerEvent).clientY));
    target.addEventListener("pointerleave", () => this.hide());
    target.addEventListener("focus", () => {
      const r = target.getBoundingClientRect();
      show(r.left + r.width / 2, r.top);
    });
    target.addEventListener("blur", () => this.hide());
  }

  private show(title: string, color: string, rows: readonly TooltipRow[], x: number, y: number): void {
    this.node.replaceChildren();
    const head = document.createElement("div");
    head.className = "tooltip-head";
    const key = document.createElement("span");
    key.className = "tooltip-key";
    key.style.background = color;
    const name = document.createElement("span");
    name.textContent = title;
    head.append(key, name);
    this.node.append(head);
    for (const row of rows) {
      const line = document.createElement("div");
      line.className = "tooltip-row";
      const v = document.createElement("b");
      v.textContent = row.value;
      const l = document.createElement("span");
      l.textContent = row.label;
      line.append(v, l);
      this.node.append(line);
    }
    this.node.hidden = false;
    const box = this.node.getBoundingClientRect();
    const left = Math.min(window.innerWidth - box.width - 8, Math.max(8, x + 14));
    const top = y - box.height - 12 < 8 ? y + 16 : y - box.height - 12;
    this.node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  hide(): void {
    this.node.hidden = true;
  }
}

export interface Scale {
  (v: number): number;
  readonly ticks: readonly number[];
  readonly format: (v: number) => string;
}

export function linear(domain: readonly [number, number], range: readonly [number, number], ticks: readonly number[], format: (v: number) => string): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  return Object.assign((v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0), { ticks, format });
}

export function log(domain: readonly [number, number], range: readonly [number, number], ticks: readonly number[], format: (v: number) => string): Scale {
  const [d0, d1] = domain.map(Math.log10) as [number, number];
  const [r0, r1] = range;
  return Object.assign((v: number) => r0 + ((Math.log10(v) - d0) / (d1 - d0)) * (r1 - r0), { ticks, format });
}

export interface ScatterPoint {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  /** Drawn as a ring, for a lane whose colour alone is too close to another's. */
  readonly hollow?: boolean;
  readonly x: number;
  readonly y: number;
  /** 95% interval on y, drawn as a thin whisker. */
  readonly yLow?: number;
  readonly yHigh?: number;
  readonly tooltip: readonly TooltipRow[];
}

export interface ScatterSpec {
  readonly points: readonly ScatterPoint[];
  readonly x: (range: readonly [number, number]) => Scale;
  readonly y: (range: readonly [number, number]) => Scale;
  readonly xTitle: string;
  readonly yTitle: string;
  /** A horizontal reference line, e.g. the autopilot's landing rate. */
  readonly reference?: { readonly y: number; readonly label: string };
  readonly description: string;
}

const MARGIN = { top: 34, right: 20, bottom: 44, left: 48 };

/** The direct and reference label fonts, as results.css sets them, for measuring labels before they are drawn. */
const LABEL_FONT = '500 14px "IBM Plex Sans", system-ui, sans-serif';
const LABEL_FONT_SMALL = '400 13px "IBM Plex Sans", system-ui, sans-serif';
const measure = document.createElement("canvas").getContext("2d");

function textWidth(text: string, font: string): number {
  if (!measure) return text.length * 7;
  measure.font = font;
  return measure.measureText(text).width;
}

/** A scatter with y whiskers and a direct label beside every dot (there are only a handful). */
export function scatter(host: HTMLElement, spec: ScatterSpec, tooltip: Tooltip): void {
  const width = Math.max(300, host.clientWidth);
  // Wide charts get extra height: the leading lanes sit within a few points of each other near the top.
  const height = Math.round(Math.min(460, Math.max(260, width * 0.56)));
  const x = spec.x([MARGIN.left, width - MARGIN.right]);
  const y = spec.y([height - MARGIN.bottom, MARGIN.top]);
  const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": spec.description, class: "chart" });

  const grid = el("g", { class: "grid" }, svg);
  for (const t of y.ticks) {
    el("line", { x1: MARGIN.left, x2: width - MARGIN.right, y1: y(t), y2: y(t) }, grid);
    svgText(grid, MARGIN.left - 8, y(t) + 4, y.format(t), { "text-anchor": "end", class: "tick" });
  }
  for (const t of x.ticks) {
    el("line", { x1: x(t), x2: x(t), y1: MARGIN.top, y2: height - MARGIN.bottom }, grid);
    svgText(grid, x(t), height - MARGIN.bottom + 18, x.format(t), { "text-anchor": "middle", class: "tick" });
  }
  svgText(svg, (MARGIN.left + width - MARGIN.right) / 2, height - 6, spec.xTitle, { "text-anchor": "middle", class: "axis-title" });
  svgText(svg, MARGIN.left - 36, 14, spec.yTitle, { class: "axis-title" });

  if (spec.reference) {
    const ry = y(spec.reference.y);
    el("line", { x1: MARGIN.left, x2: width - MARGIN.right, y1: ry, y2: ry, class: "reference" }, svg);
    svgText(svg, width - MARGIN.right, ry - 6, spec.reference.label, { "text-anchor": "end", class: "reference-label" });
  }

  // Direct labels sit beside their dot, right first (left near the right edge). A label may not cover another label,
  // another dot or the reference label; when its own row is taken it moves a row down or up, nearest first, and a
  // leader line joins it to its dot. Labels are measured in the label font.
  const placed: { x0: number; x1: number; y: number }[] = [];
  if (spec.reference) {
    const w = textWidth(spec.reference.label, LABEL_FONT_SMALL);
    placed.push({ x0: width - MARGIN.right - w, x1: width - MARGIN.right, y: y(spec.reference.y) - 6 });
  }
  const order = [...spec.points].sort((a, b) => y(a.y) - y(b.y));
  const labels = new Map<string, { y: number; right: boolean }>();
  const span = (p: ScatterPoint, right: boolean): [number, number] => {
    const px = x(p.x);
    const w = 14 + textWidth(p.label, LABEL_FONT);
    return right ? [px, px + w] : [px - w, px];
  };
  const lowest = height - MARGIN.bottom + 4;
  // A label's box runs from 12 px above its baseline to 4 px below.
  const free = (p: ScatterPoint, [x0, x1]: [number, number], ly: number) =>
    x0 >= 2 &&
    x1 <= width - 2 &&
    ly - 12 >= 0 &&
    ly <= lowest &&
    !placed.some((q) => x0 < q.x1 && q.x0 < x1 && Math.abs(q.y - ly) < 17) &&
    !spec.points.some((q) => q !== p && x(q.x) + 7 > x0 && x(q.x) - 7 < x1 && y(q.y) + 7 > ly - 12 && y(q.y) - 7 < ly + 4);
  for (const p of order) {
    const sides = span(p, true)[1] > width - MARGIN.right ? [false, true] : [true, false];
    let spot: { y: number; right: boolean } | null = null;
    for (const dy of [0, 18, -18, 36, -36, 54, -54, 72, -72]) {
      const right = sides.find((r) => free(p, span(p, r), y(p.y) + 4 + dy));
      if (right !== undefined) {
        spot = { y: y(p.y) + 4 + dy, right };
        break;
      }
    }
    spot ??= { y: Math.min(y(p.y) + 4, lowest), right: sides[0]! };
    const [x0, x1] = span(p, spot.right);
    placed.push({ x0, x1, y: spot.y });
    labels.set(p.id, spot);
  }

  for (const p of spec.points) {
    const g = el("g", { class: "point" }, svg);
    const px = x(p.x);
    const py = y(p.y);
    if (p.yLow !== undefined && p.yHigh !== undefined) {
      el("line", { x1: px, x2: px, y1: y(p.yLow), y2: y(p.yHigh), stroke: p.color, class: "whisker" }, g);
      for (const v of [p.yLow, p.yHigh]) el("line", { x1: px - 4, x2: px + 4, y1: y(v), y2: y(v), stroke: p.color, class: "whisker" }, g);
    }
    const dot = el("circle", { cx: px, cy: py, r: 6, fill: p.color, class: p.hollow ? "dot is-hollow" : "dot" }, g);
    if (p.hollow) dot.style.stroke = p.color;
    const spot = labels.get(p.id)!;
    // A label pushed well away from its dot gets a leader line back to it.
    if (Math.abs(spot.y - 4 - py) > 12) {
      const lx = spot.right ? px + 10 : px - 10;
      el("line", { x1: px, x2: lx, y1: py + (spot.y < py ? -7 : 7), y2: spot.y + (spot.y < py ? 2 : -12), class: "leader" }, g);
    }
    svgText(g, spot.right ? px + 12 : px - 12, spot.y, p.label, { "text-anchor": spot.right ? "start" : "end", class: "direct-label" });
    el("circle", { cx: px, cy: py, r: 16, class: "hit" }, g);
    tooltip.attach(g, p.label, p.color, p.tooltip);
  }
  host.replaceChildren(svg);
}
