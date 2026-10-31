/**
 * Synthesises the launch video's soundtrack from code: a pad in D minor, a pulse under the race and the scoreboard,
 * and effects placed on the frames where things happen (each decision, each touchdown, each lander flying off). Cue
 * times come from the same timeline and flight data the video draws, so sound and picture stay in step.
 *
 *   node video/scripts/soundtrack.ts
 *
 * Writes video/public/soundtrack.wav (generated, not committed). Needs video/src/data/flights.json (`pnpm data`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { HOW_SLOW_FRAMES, RACE_LEAD, RACE_HOLD, SCENES, TOTAL_FRAMES, TRACE, howStep } from "../src/timeline.ts";

const RATE = 48000;
const FPS = 60;
const N = Math.ceil(((TOTAL_FRAMES + 30) / FPS) * RATE);
const dry = [new Float32Array(N), new Float32Array(N)];
const wet = [new Float32Array(N), new Float32Array(N)];

const sec = (frame: number) => frame / FPS;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Deterministic noise, so every render of the soundtrack is identical. */
let seed = 12345;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 31 - 1;
};

function add(t: number, i: number, l: number, r: number, send: number) {
  const k = Math.floor(t * RATE) + i;
  if (k < 0 || k >= N) return;
  dry[0]![k]! += l;
  dry[1]![k]! += r;
  wet[0]![k]! += l * send;
  wet[1]![k]! += r * send;
}

/** A soft additive pad: a few harmonics per note, two detuned voices, slow attack and release. */
function pad(notes: number[], t0: number, t1: number, gain: number, attack = 1.2, release = 1.4, bright = 1) {
  const len = Math.floor((t1 - t0 + release) * RATE);
  for (const [v, m] of notes.entries()) {
    const pan = notes.length > 1 ? (v / (notes.length - 1)) * 0.8 - 0.4 : 0;
    for (const detune of [-0.06, 0.06]) {
      const f = hz(m + detune);
      for (let i = 0; i < len; i++) {
        const t = i / RATE;
        const env = Math.min(1, t / attack) * (t > t1 - t0 ? Math.max(0, 1 - (t - (t1 - t0)) / release) : 1);
        if (env <= 0) continue;
        let s = 0;
        for (let h = 1; h <= 5; h++) s += (Math.sin(2 * Math.PI * f * h * t + h) / h ** (2.2 - bright * 0.5)) * (h === 1 ? 1 : 0.8);
        const x = s * env * gain * 0.5;
        add(t0, i, x * (1 - pan), x * (1 + pan), 0.5);
      }
    }
  }
}

/** A struck bell: inharmonic partials with exponential decay. */
function bell(midi: number, t0: number, gain: number, pan = 0, decay = 1.6) {
  const f = hz(midi);
  const partials: [number, number, number][] = [[1, 1, 1], [2.0, 0.5, 0.7], [2.76, 0.35, 0.5], [5.4, 0.15, 0.3]];
  const len = Math.floor(decay * 3 * RATE);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    let s = 0;
    for (const [p, a, d] of partials) s += a * Math.sin(2 * Math.PI * f * p * t) * Math.exp(-t / (decay * d));
    const x = s * gain * Math.min(1, t * 400);
    add(t0, i, x * (1 - pan), x * (1 + pan), 0.6);
  }
}

/** A short sine blip, for decisions and clock ticks. */
function tick(t0: number, freq: number, gain: number, pan = 0, len = 0.04) {
  const n = Math.floor(len * RATE);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const x = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / (len / 4)) * gain;
    add(t0, i, x * (1 - pan), x * (1 + pan), 0.25);
  }
}

/** A low boom: a sine sweeping down, for touchdowns and the reveal. */
function boom(t0: number, gain: number, from = 110, to = 38, decay = 0.5) {
  const n = Math.floor(decay * 4 * RATE);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = to + (from - to) * Math.exp(-t / 0.06);
    phase += (2 * Math.PI * f) / RATE;
    const x = Math.sin(phase) * Math.exp(-t / decay) * gain;
    add(t0, i, x, x, 0.1);
  }
}

/** Filtered noise swept through a band-pass: a whoosh between scenes, or a riser before the reveal. */
function sweep(t0: number, dur: number, gain: number, f0: number, f1: number, shape: "whoosh" | "rise") {
  const n = Math.floor(dur * RATE);
  let low = 0;
  let band = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const fc = f0 * (f1 / f0) ** u;
    const fq = 2 * Math.sin((Math.PI * fc) / RATE);
    const high = noise() - low - 0.6 * band;
    band += fq * high;
    low += fq * band;
    const env = shape === "whoosh" ? Math.sin(Math.PI * u) ** 2 : u ** 2.2;
    const x = band * env * gain;
    const pan = shape === "whoosh" ? (u - 0.5) * 0.8 : 0;
    add(t0, i, x * (1 - pan), x * (1 + pan), 0.5);
  }
}

/** The pulse under the race and the scoreboard: bass eighths and quiet off-beat hats. */
function pulse(t0: number, t1: number, roots: number[], bar: number, gain: number) {
  const eighth = bar / 8;
  for (let t = t0, k = 0; t < t1; t += eighth, k++) {
    const root = roots[Math.floor((t - t0) / bar) % roots.length]!;
    const f = hz(root);
    const n = Math.floor(eighth * 0.9 * RATE);
    const fadeIn = Math.min(1, (t - t0) / 1.2);
    const fadeOut = Math.min(1, (t1 - t) / 0.6);
    for (let i = 0; i < n; i++) {
      const tt = i / RATE;
      const x = (Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(4 * Math.PI * f * tt)) * Math.exp(-tt / 0.12) * gain * (k % 2 ? 0.6 : 1) * fadeIn * fadeOut;
      add(t, i, x, x, 0.05);
    }
    if (k % 2) {
      let prev = 0;
      const m = Math.floor(0.03 * RATE);
      for (let i = 0; i < m; i++) {
        const w = noise();
        const x = (w - prev) * Math.exp(-i / (m / 5)) * gain * 0.18 * fadeIn * fadeOut;
        prev = w;
        add(t, i, x * 0.7, x * 1.3, 0.1);
      }
    }
  }
}

const data = JSON.parse(readFileSync(new URL("../src/data/flights.json", import.meta.url), "utf8")) as {
  race: { flights: { lane: string; outcome: string; steps: unknown[] }[] };
};
const jev = data.race.flights.find((f) => f.lane === "jev")!;

// Chords in D minor.
const Dm9 = [50, 57, 60, 64, 65];
const Bbmaj7 = [46, 53, 57, 62, 65];
const Gm9 = [43, 50, 57, 58, 62];
const Fmaj9 = [41, 48, 55, 57, 64];
const Csus = [48, 55, 60, 62, 67];
const Dadd9 = [50, 57, 62, 64, 66, 69];
const tense = [50, 51, 57, 62];

const S = (k: keyof typeof SCENES) => sec(SCENES[k].from);
const E = (k: keyof typeof SCENES) => sec(SCENES[k].from + SCENES[k].len);

// Bed: a pad through every scene, a sub drone under the opening.
pad([38], 0, E("how"), 0.12, 2.5, 1.5, 0.3);
pad(Dm9, 0, S("how") + 0.4, 0.05, 1.8, 1.4);
pad(Bbmaj7, S("how"), S("how") + 3.8, 0.045, 1.0, 1.2);
pad(Dm9, S("how") + 3.8, E("how") + 0.3, 0.045, 1.0, 1.2);
const bar = (60 / 96) * 4;
pad(Gm9, S("race"), S("race") + bar * 1.6, 0.04, 0.6);
pad(Bbmaj7, S("race") + bar * 1.6, S("race") + bar * 3.2, 0.04, 0.6);
pad(Fmaj9, S("race") + bar * 3.2, E("race"), 0.04, 0.6);
pad(Bbmaj7, S("score"), S("score") + 2.5, 0.04, 0.5);
pad(Csus, S("score") + 2.5, E("score"), 0.04, 0.5);
pulse(S("race") + sec(RACE_LEAD) - bar / 8, E("score") - 0.1, [38, 38, 34, 41], bar, 0.16);

// Scene changes.
for (const k of ["how", "race", "score", "traces", "speed", "end"] as const) sweep(S(k) - 0.35, 0.8, 0.09, 300, 5000, "whoosh");

// How It Works: a blip for every decision, which speeds up as the flight does, and a chime on touchdown.
{
  const total = jev.steps.length - 1;
  let lastDecision = -1;
  let landedAt = -1;
  for (let f = 0; f < SCENES.how.len; f++) {
    const { step } = howStep(f - 20, total);
    const d = Math.floor(step / 60);
    if (d !== lastDecision && step < total) {
      lastDecision = d;
      const slow = f - 20 <= HOW_SLOW_FRAMES + 20;
      tick(S("how") + sec(f), slow ? 1760 : 2350, slow ? 0.12 : 0.05, (d % 2) * 0.4 - 0.2);
    }
    if (landedAt < 0 && step >= total) landedAt = f;
  }
  bell(74, S("how") + sec(landedAt), 0.1);
  bell(81, S("how") + sec(landedAt) + 0.06, 0.07);
  boom(S("how") + sec(landedAt), 0.18, 90, 40, 0.3);
}

// Race: a chime per touchdown, rising through the lanes that land; a falling tone for each that flies off.
{
  const longest = Math.max(...data.race.flights.map((f) => f.steps.length - 1));
  const frames = SCENES.race.len - RACE_LEAD - RACE_HOLD;
  const landNotes = [69, 72, 74, 76, 81];
  const ends = data.race.flights.map((f) => ({ f, at: S("race") + sec(RACE_LEAD + ((f.steps.length - 1) / longest) * frames) })).sort((a, b) => a.at - b.at);
  let landed = 0;
  for (const { f, at } of ends) {
    if (f.outcome === "landed") {
      bell(landNotes[landed++ % landNotes.length]!, at, 0.08, (landed % 2) * 0.4 - 0.2, 1.2);
    } else {
      const n = Math.floor(0.5 * RATE);
      for (let i = 0; i < n; i++) {
        const t = i / RATE;
        const x = Math.sin(2 * Math.PI * (440 - 260 * (t / 0.5)) * t) * Math.exp(-t / 0.18) * 0.05;
        add(at, i, x, x, 0.4);
      }
    }
  }
}

// Scoreboard: a plucked note as each bar starts to grow, climbing as the rows go down.
{
  const notes = [62, 64, 65, 67, 69, 72, 74, 76, 77];
  notes.forEach((m, i) => bell(m, S("score") + sec(26 + i * 5), 0.045, i % 2 ? 0.3 : -0.3, 0.6));
  boom(S("score") + sec(230), 0.12, 70, 36, 0.6);
}

// Traces: a tense drone while the small model scatters, a riser into the large model, and a lift to D major on the line.
{
  const t0 = S("traces");
  pad(tense, t0 + sec(TRACE.smallStart) - 0.4, t0 + sec(TRACE.bigStart), 0.05, 1.5, 0.8, 0.6);
  sweep(t0 + sec(TRACE.smallStart), sec(TRACE.smallDraw), 0.04, 180, 900, "rise");
  pad(Fmaj9, t0 + sec(TRACE.bigStart) - 0.2, t0 + sec(TRACE.bigStart + TRACE.bigDraw), 0.045, 1.2, 0.6);
  sweep(t0 + sec(TRACE.bigStart), sec(TRACE.bigDraw + 10), 0.07, 250, 7000, "rise");
  const punch = t0 + sec(TRACE.bigStart + TRACE.bigDraw + 10);
  boom(punch, 0.32, 120, 36, 0.8);
  pad(Dadd9, punch, E("traces") + 0.3, 0.06, 0.05, 1.6, 1.4);
  bell(78, punch, 0.06, -0.3, 2);
  bell(81, punch + 0.05, 0.05, 0.3, 2);
}

// Speed: a clock that ticks while the answers run, a chime when Jev's stops and a low note when Gemma's does.
{
  const t0 = S("speed");
  pad(Bbmaj7, t0, E("speed"), 0.04, 0.8, 1.0);
  for (let f = 40; f <= 230; f += 9) tick(t0 + sec(f), f % 18 ? 1200 : 1500, 0.07, f % 18 ? 0.3 : -0.3, 0.03);
  bell(76, t0 + sec(66), 0.07, -0.2, 1.0);
  bell(57, t0 + sec(230), 0.09, 0.2, 1.6);
}

// End: the lander touches down, and the opening chord comes back resolved.
{
  const t0 = S("end");
  boom(t0 + sec(70), 0.25, 100, 38, 0.5);
  pad([...Dm9.slice(0, 3), 62, 69], t0 + sec(40), E("end") + 1, 0.055, 0.8, 0.6, 1);
  bell(74, t0 + sec(70), 0.06, -0.2, 2.2);
  bell(81, t0 + sec(74), 0.05, 0.2, 2.2);
}

// Reverb on the send: four combs and two all-passes per channel (Schroeder), slightly different per side.
function reverb(x: Float32Array, spread: number): Float32Array {
  const out = new Float32Array(x.length);
  for (const [d, g] of [[1557, 0.83], [1617, 0.82], [1491, 0.83], [1422, 0.82]] as const) {
    const len = Math.floor((d + spread) * (RATE / 44100));
    const buf = new Float32Array(len);
    let p = 0;
    let lp = 0;
    for (let i = 0; i < x.length; i++) {
      const y = buf[p]!;
      lp = y * 0.75 + lp * 0.25;
      buf[p] = x[i]! + lp * g;
      out[i]! += y * 0.25;
      p = (p + 1) % len;
    }
  }
  for (const d of [556, 441]) {
    const len = Math.floor((d + spread) * (RATE / 44100));
    const buf = new Float32Array(len);
    let p = 0;
    for (let i = 0; i < out.length; i++) {
      const b = buf[p]!;
      const y = -out[i]! + b;
      buf[p] = out[i]! + b * 0.5;
      out[i] = y;
      p = (p + 1) % len;
    }
  }
  return out;
}

const mix = [0, 1].map((c) => {
  const rv = reverb(wet[c]!, c * 23);
  const m = new Float32Array(N);
  for (let i = 0; i < N; i++) m[i] = dry[c]![i]! + rv[i]! * 0.35;
  return m;
});

// Fade out the tail, then soft-limit and bring the peak to -1 dBFS.
const fadeFrom = Math.floor(sec(TOTAL_FRAMES - 40) * RATE);
for (const m of mix) for (let i = fadeFrom; i < N; i++) m[i]! *= Math.max(0, 1 - (i - fadeFrom) / (N - fadeFrom));
let peak = 0;
for (const m of mix) for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(Math.tanh(m[i]! * 1.5)));
const gain = 10 ** (-1 / 20) / peak;

const pcm = Buffer.alloc(44 + N * 4);
pcm.write("RIFF", 0);
pcm.writeUInt32LE(36 + N * 4, 4);
pcm.write("WAVEfmt ", 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(RATE, 24);
pcm.writeUInt32LE(RATE * 4, 28);
pcm.writeUInt16LE(4, 32);
pcm.writeUInt16LE(16, 34);
pcm.write("data", 36);
pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  for (let c = 0; c < 2; c++) pcm.writeInt16LE(Math.round(Math.tanh(mix[c]![i]! * 1.5) * gain * 32767), 44 + i * 4 + c * 2);
}
mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/soundtrack.wav", import.meta.url), pcm);
console.log(`soundtrack.wav: ${(N / RATE).toFixed(1)} s, peak gain ${gain.toFixed(2)}`);
