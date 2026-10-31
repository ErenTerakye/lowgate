import type { Outcome } from "@lowgate/engine";
import type { BenchResults, LaneResult } from "@lowgate/decisions";
import raw from "../../../bench/results.json?raw";
import { Tooltip, linear, log, scatter, type TooltipRow } from "./charts.ts";
import { siteHeader } from "./chrome.ts";
import { HOLLOW, colorOf } from "./lanes.ts";
import "./style.css";
import "./results.css";

/**
 * Benchmark results (R5): every figure comes from bench/results.json, which
 * `pnpm bench` rebuilds from the recordings. Lanes still flying show how many
 * courses they have so far; the page rebuilds with the file.
 */

const results = JSON.parse(raw) as BenchResults;
const COURSES = results.courses.length;
const LEVELS_PER_COURSE = 8;

/** A lane's key: a filled dot, or a ring for the lanes drawn hollow. */
function swatch(lane: string): HTMLSpanElement {
  const key = el("span", HOLLOW.has(lane) ? "swatch is-hollow" : "swatch");
  key.style.background = colorOf(lane);
  key.style.setProperty("--hollow", colorOf(lane));
  return key;
}

const OUTCOMES: readonly { key: Outcome; label: string }[] = [
  { key: "landed", label: "Landed" },
  { key: "crashed_speed", label: "Too fast" },
  { key: "crashed_tilt", label: "Too tilted" },
  { key: "crashed_terrain", label: "Hit terrain" },
  { key: "out_of_bounds", label: "Off course" },
  { key: "timeout", label: "Out of time" },
];

const PRICE_TEXT: Record<string, string> = { vendor: "vendor price", third_party: "third-party price", measured: "measured price", none: "runs locally" };

const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const ms = (v: number | null) => (v === null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const usd = (v: number) => (v === 0 ? "$0" : v < 0.01 ? "<$0.01" : `$${v.toFixed(2)}`);
const lanes = results.lanes;
const models = lanes.filter((l) => l.model !== null);
const autopilot = lanes.find((l) => l.lane === "autopilot");
const incomplete = lanes.filter((l) => l.courses < COURSES);

function landedRows(l: LaneResult): TooltipRow[] {
  const rows: TooltipRow[] = [{ value: `${l.landed}/${l.levels} (${pct(l.landingRate)})`, label: "levels landed" }];
  if (l.landingRate95) rows.push({ value: `${pct(l.landingRate95.low)}–${pct(l.landingRate95.high)}`, label: "95% interval" });
  return rows;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function laneCell(l: LaneResult): HTMLTableCellElement {
  const td = el("th", "lane-cell");
  td.scope = "row";
  td.append(swatch(l.lane), el("span", "lane-label", l.label));
  if (l.model) td.append(el("span", "model-id", l.model.model));
  if (l.courses < COURSES) td.append(el("span", "partial", `${l.courses} of ${COURSES} courses so far`));
  return td;
}

function headRow(table: HTMLTableElement, cols: readonly string[]): void {
  const tr = el("tr");
  for (const c of cols) {
    const th = el("th", undefined, c);
    th.scope = "col";
    tr.append(th);
  }
  table.createTHead().append(tr);
}

/** An inline interval: a track, the 95% range and the point, on a fixed scale. */
function intervalBar(value: number, low: number, high: number, [d0, d1]: readonly [number, number], lane: string): HTMLSpanElement {
  const color = colorOf(lane);
  const at = (v: number) => `${(Math.max(0, Math.min(1, (v - d0) / (d1 - d0))) * 100).toFixed(2)}%`;
  const track = el("span", "interval");
  const range = el("span", "interval-range");
  range.style.left = at(low);
  range.style.width = `calc(${at(high)} - ${at(low)})`;
  range.style.background = color;
  const dot = el("span", HOLLOW.has(lane) ? "interval-dot is-hollow" : "interval-dot");
  dot.style.left = at(value);
  dot.style.background = color;
  dot.style.setProperty("--hollow", color);
  track.append(range, dot);
  track.setAttribute("aria-hidden", "true");
  return track;
}

const tooltip = new Tooltip();
const app = document.querySelector<HTMLDivElement>("#app")!;

app.insertAdjacentHTML("beforeend", siteHeader("results"));
const header = el("div", "page-intro wrap");
header.append(el("h1", undefined, "Benchmark results"));
header.append(
  el(
    "p",
    "lede",
    `${lanes.length} lanes fly the same ${COURSES} courses, ${LEVELS_PER_COURSE} levels each, none of them seen in tuning or training. The game waits for every answer, so only judgment is scored: answer time and cost are measured and shown, never counted.`,
  ),
);
if (incomplete.length) {
  header.append(el("p", "status", `Still flying: ${incomplete.map((l) => `${l.label} ${l.courses} of ${COURSES} courses`).join(", ")}. Figures for those lanes cover the courses flown so far.`));
}
app.append(header);

function section(title: string, note: string): HTMLElement {
  const s = el("section", "panel wrap");
  s.append(el("h2", undefined, title), el("p", "note", note));
  app.append(s);
  return s;
}

// 1. Landing rate against answer time.
const hero = section(
  "Landing rate against answer time",
  "Each dot is a model lane: the share of levels it landed, with the 95% interval, against its median answer time on a log scale. The dashed line is the autopilot, a hand-written controller with no model.",
);
const heroChart = el("div", "chart-host");
hero.append(heroChart);

// 2. Ranking.
const rank = section("Ranking", "Ranked by landing rate, ties broken by mean landing quality (0–100: thirds for landing on the centre, touching down gently and fuel left). Bars show the 95% interval.");
{
  const wrap = el("div", "table-wrap");
  const table = el("table", "data");
  headRow(table, ["#", "Lane", "Landed", "Landing rate", "Quality", "Same pick as autopilot", "Unanswered"]);
  const body = table.createTBody();
  lanes.forEach((l, i) => {
    const tr = body.insertRow();
    tr.append(el("td", "num", String(i + 1)), laneCell(l));
    tr.append(el("td", "num", `${l.landed}/${l.levels}`));
    const rate = el("td", "with-bar");
    rate.append(el("span", "num", pct(l.landingRate)));
    if (l.landingRate95) {
      rate.append(intervalBar(l.landingRate, l.landingRate95.low, l.landingRate95.high, [0, 1], l.lane));
      rate.append(el("span", "range-text", `${pct(l.landingRate95.low)}–${pct(l.landingRate95.high)}`));
    }
    tr.append(rate);
    const q = el("td", "with-bar");
    if (l.quality) {
      q.append(el("span", "num", l.quality.mean.toFixed(1)));
      q.append(intervalBar(l.quality.mean, l.quality.ci.low, l.quality.ci.high, [30, 60], l.lane));
      q.append(el("span", "range-text", `± ${(l.quality.ci.high - l.quality.mean).toFixed(1)}`));
    } else q.textContent = "–";
    tr.append(q);
    tr.append(el("td", "num", l.lane === "autopilot" ? "–" : pct(l.agreesWithAutopilot.exact)));
    tr.append(el("td", "num", String(l.unanswered)));
  });
  wrap.append(table);
  rank.append(wrap);
}

// 3. How levels ended.
const ends = section("How each level ended", "Counts out of the levels each lane flew. The bar is the share of that lane's levels.");
{
  const wrap = el("div", "table-wrap");
  const table = el("table", "data outcomes");
  headRow(table, ["Lane", ...OUTCOMES.map((o) => o.label)]);
  const body = table.createTBody();
  for (const l of lanes) {
    const tr = body.insertRow();
    tr.append(laneCell(l));
    for (const o of OUTCOMES) {
      const n = l.outcomes[o.key] ?? 0;
      const td = el("td", "count-cell");
      const bar = el("span", "share");
      bar.style.width = `${((n / l.levels) * 100).toFixed(1)}%`;
      bar.style.background = colorOf(l.lane);
      td.append(el("span", n ? "num" : "num is-zero", String(n)), bar);
      tr.append(td);
    }
  }
  wrap.append(table);
  ends.append(wrap);
}

// 4. Landings per course.
const grid = section("Landings per course", `Levels landed out of ${LEVELS_PER_COURSE} on each course. Darker is more; numbers mark every course short of all ${LEVELS_PER_COURSE}.`);
{
  const wrap = el("div", "table-wrap");
  const table = el("table", "heat");
  const tr0 = el("tr");
  tr0.append(el("th"));
  for (const seed of results.courses) {
    const th = el("th", "seed", String(seed).slice(-2));
    th.scope = "col";
    th.title = `Course ${seed}`;
    tr0.append(th);
  }
  table.createTHead().append(tr0);
  const body = table.createTBody();
  for (const l of lanes) {
    const tr = body.insertRow();
    const th = el("th", "lane-cell compact");
    th.scope = "row";
    th.append(swatch(l.lane), el("span", "lane-label", l.label));
    tr.append(th);
    // Files from before perCourse existed lack it; `pnpm bench --summary` adds it.
    const bySeed = new Map((l.perCourse ?? []).map((c) => [c.seed, c.landed]));
    for (const seed of results.courses) {
      const n = bySeed.get(seed);
      const td = el("td", n === undefined ? "cell is-missing" : "cell");
      if (n !== undefined) {
        td.style.setProperty("--level", String(n / LEVELS_PER_COURSE));
        if (n < LEVELS_PER_COURSE) td.textContent = String(n);
        if (n > LEVELS_PER_COURSE / 2) td.classList.add("is-deep");
        tooltip.attach(td, l.label, colorOf(l.lane), [{ value: `${n}/${LEVELS_PER_COURSE}`, label: `landed on course ${seed}` }]);
      } else {
        td.title = `Course ${seed}: not flown yet`;
      }
      tr.append(td);
    }
  }
  wrap.append(table);
  const legend = el("p", "heat-legend");
  legend.append(el("span", undefined, "0"));
  const ramp = el("span", "ramp");
  ramp.setAttribute("aria-hidden", "true");
  legend.append(ramp, el("span", undefined, `${LEVELS_PER_COURSE} landed`), el("span", "missing-key"), el("span", undefined, "not flown yet"));
  grid.append(wrap, legend);
}

// 5. Copying the autopilot against landing.
const copy = section(
  "Copying the autopilot against landing",
  "How often a lane picked the autopilot's manoeuvre, against its landing rate. Laya was trained to copy the autopilot; the other models only read a prompt. Landing well while disagreeing means a lane found its own way down.",
);
const copyChart = el("div", "chart-host");
copy.append(copyChart);

// 6. Speed and cost.
const cost = section(
  "Answer time and cost",
  `Answer times are measured where each lane was flown: this Mac, or for the Kev lanes a Colab G4 GPU with the model on the same machine, so no network time. Tokens are as the provider reports them. Cost is for the courses flown at each lane's listed price, and scaled to all ${COURSES} courses. Local and self-hosted lanes cost nothing per token here; where the same model is sold on a hosted API, its price for the same tokens is shown underneath.`,
);
{
  const wrap = el("div", "table-wrap");
  const table = el("table", "data");
  headRow(table, ["Lane", "Median answer", "95th percentile", "Waiting per course", "Tokens in / out per decision", "Cost so far", `Cost for ${COURSES} courses`]);
  const body = table.createTBody();
  const minutes = (s: number) => (s >= 60 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(0)} s`);
  /** The lane's own cost, then, for a local lane with a hosted equivalent, that price as a second labelled line. */
  const costCell = (l: LaneResult, scale: number): HTMLTableCellElement => {
    const c = l.costUsd;
    const td = el("td", "num", c ? usd(c.total * scale) : "–");
    const selfHosted = l.model?.provider.startsWith("self-hosted") ?? false;
    if (c) td.append(el("span", "source", selfHosted ? "self-hosted GPU" : (PRICE_TEXT[c.priceSource] ?? c.priceSource)));
    const h = l.hostedEquivalentUsd ?? null;
    if (h) {
      const alt = el("span", "hosted");
      alt.append(el("b", undefined, `${usd(h.total * scale)}`), document.createTextNode(" if hosted, at "));
      const link = el("a", undefined, `${h.price.provider}'s price`);
      link.href = h.price.url;
      link.rel = "noopener";
      link.title = `$${h.price.input}/M input, $${h.price.output}/M output for ${h.price.model}, checked ${h.price.checked}`;
      alt.append(link);
      td.append(alt);
    }
    return td;
  };
  for (const l of models) {
    const tr = body.insertRow();
    tr.append(laneCell(l), el("td", "num", ms(l.latencyMs.p50)), el("td", "num", ms(l.latencyMs.p95)));
    tr.append(el("td", "num", l.answerSecondsPerCourse === undefined ? "–" : minutes(l.answerSecondsPerCourse)));
    const t = l.tokensPerDecision;
    tr.append(el("td", "num", t ? `${Math.round(t.input)} / ${t.output === null ? "not reported" : Math.round(t.output)}` : "–"));
    tr.append(costCell(l, 1), costCell(l, COURSES / l.courses));
  }
  wrap.append(table);
  cost.append(wrap);
}

const foot = el("footer", "results-foot wrap");
foot.append(
  el(
    "p",
    undefined,
    `Engine ${results.engine}. Courses ${results.courses[0]}–${results.courses.at(-1)}. Results rebuilt ${new Date(results.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. Every course is recorded and replays to its saved state hashes.`,
  ),
);
app.append(foot);

/** Landing rates run the full 0–100%: the Kev lanes land 0–3%, far below the rest. */
const Y_DOMAIN = [0, 1] as const;
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];

function drawCharts(): void {
  scatter(
    heroChart,
    {
      description: `Landing rate against median answer time for ${models.length} model lanes`,
      points: models.map((l) => ({
        id: l.lane,
        label: l.label,
        color: colorOf(l.lane),
        hollow: HOLLOW.has(l.lane),
        x: Math.max(20, l.latencyMs.p50 ?? 20),
        y: l.landingRate,
        ...(l.landingRate95 ? { yLow: l.landingRate95.low, yHigh: l.landingRate95.high } : {}),
        tooltip: [...landedRows(l), { value: ms(l.latencyMs.p50), label: "median answer time" }],
      })),
      x: (r) => log([20, 20_000], r, [30, 100, 300, 1000, 3000, 10_000], (v) => ms(v)),
      y: (r) => linear(Y_DOMAIN, r, Y_TICKS, (v) => pct(v)),
      xTitle: "Median answer time (log scale)",
      yTitle: "Levels landed",
      ...(autopilot ? { reference: { y: autopilot.landingRate, label: `Autopilot ${pct(autopilot.landingRate)}` } } : {}),
    },
    tooltip,
  );
  scatter(
    copyChart,
    {
      description: "Share of picks matching the autopilot against landing rate, per lane",
      points: lanes.map((l) => ({
        id: l.lane,
        label: l.label,
        color: colorOf(l.lane),
        hollow: HOLLOW.has(l.lane),
        x: l.agreesWithAutopilot.exact,
        y: l.landingRate,
        ...(l.landingRate95 ? { yLow: l.landingRate95.low, yHigh: l.landingRate95.high } : {}),
        tooltip: [{ value: pct(l.agreesWithAutopilot.exact), label: "same pick as the autopilot" }, ...landedRows(l)],
      })),
      x: (r) => linear([0, 1], r, [0, 0.25, 0.5, 0.75, 1], (v) => pct(v)),
      y: (r) => linear(Y_DOMAIN, r, Y_TICKS, (v) => pct(v)),
      xTitle: "Same pick as the autopilot",
      yTitle: "Levels landed",
    },
    tooltip,
  );
}

drawCharts();
let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(drawCharts, 100);
}).observe(heroChart);
