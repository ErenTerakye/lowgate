import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BODY, C, DISPLAY, HEIGHT, WIDTH } from "./theme";
import type { Pad } from "./data";

export const ease = Easing.bezier(0.22, 1, 0.36, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** The plotting table behind every scene: a deep blue field with a fine and a major grid. */
export function Backdrop() {
  const minor = 30;
  const major = 150;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 35%, ${C.bg} 0%, ${C.bgLow} 100%)` }}>
      <svg width={WIDTH} height={HEIGHT} style={{ position: "absolute" }}>
        <defs>
          <pattern id="minor" width={minor} height={minor} patternUnits="userSpaceOnUse">
            <path d={`M ${minor} 0 L 0 0 0 ${minor}`} fill="none" stroke={C.grid} strokeWidth={1} />
          </pattern>
          <pattern id="major" width={major} height={major} patternUnits="userSpaceOnUse">
            <rect width={major} height={major} fill="url(#minor)" />
            <path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" stroke={C.gridMajor} strokeWidth={1} />
          </pattern>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="url(#major)" />
      </svg>
    </AbsoluteFill>
  );
}

/** Wraps a scene: its content leaves by sliding up and fading over its last frames. */
export function Scene({ len, children, exit = 16 }: { len: number; children: ReactNode; exit?: number }) {
  const f = useCurrentFrame();
  const t = interpolate(f, [len - exit, len - 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  return <AbsoluteFill style={{ opacity: 1 - t, transform: `translateY(${-40 * t}px)` }}>{children}</AbsoluteFill>;
}

/** Rises into place with a spring, `delay` frames after its scene starts. */
export function Rise({ delay = 0, children, style, distance = 36 }: { delay?: number; children: ReactNode; style?: CSSProperties; distance?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - delay, fps, config: { damping: 200, mass: 0.8 } });
  return <div style={{ ...style, opacity: p, transform: `translateY(${(1 - p) * distance}px)` }}>{children}</div>;
}

/** A scene's headline and a supporting line, top left. */
export function Caption({ title, sub, delay = 0, top = 96 }: { title: ReactNode; sub?: ReactNode; delay?: number; top?: number }) {
  return (
    <div style={{ position: "absolute", left: 72, right: 72, top }}>
      <Rise delay={delay}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 74, lineHeight: 1.04, color: C.ink, letterSpacing: -0.5 }}>{title}</div>
      </Rise>
      {sub ? (
        <Rise delay={delay + 7}>
          <div style={{ fontFamily: BODY, fontSize: 32, lineHeight: 1.35, color: C.ink2, marginTop: 20, maxWidth: 900 }}>{sub}</div>
        </Rise>
      ) : null}
    </div>
  );
}

/** Maps world metres (y up) to screen pixels inside a view. */
export interface View {
  left: number;
  top: number;
  scale: number;
  worldHeight: number;
}
export const sx = (v: View, x: number) => v.left + x * v.scale;
export const sy = (v: View, y: number) => v.top + (v.worldHeight - y) * v.scale;

/** The level's ground: a filled regolith shape with a lit rim, and the pad. */
export function Ground({ view, terrain, segment, pad, padLit = 0 }: { view: View; terrain: number[]; segment: number; pad: Pad; padLit?: number }) {
  const pts = terrain.map((h, i) => `${sx(view, i * segment)},${sy(view, h)}`);
  const bottom = HEIGHT + 40;
  const fill = `M ${sx(view, 0)},${bottom} L ${pts.join(" L ")} L ${sx(view, (terrain.length - 1) * segment)},${bottom} Z`;
  const rim = `M ${pts.join(" L ")}`;
  const px0 = sx(view, pad.x0);
  const px1 = sx(view, pad.x1);
  const py = sy(view, pad.y);
  return (
    <g>
      <defs>
        <linearGradient id="regolith" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.regolith} />
          <stop offset="1" stopColor={C.bgLow} />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#regolith)" />
      <path d={rim} fill="none" stroke={C.rim} strokeWidth={2} strokeLinejoin="round" />
      <defs>
        <radialGradient id="groundpadglow">
          <stop offset="0" stopColor={C.gold} stopOpacity={0.4} />
          <stop offset="1" stopColor={C.gold} stopOpacity={0} />
        </radialGradient>
      </defs>
      <ellipse cx={(px0 + px1) / 2} cy={py} rx={(px1 - px0) * 1.1} ry={30} fill="url(#groundpadglow)" opacity={padLit} />
      <rect x={px0} y={py - 2} width={px1 - px0} height={5} fill={C.pad} rx={1.5} />
      <circle cx={px0} cy={py - 2} r={4} fill={C.gold} />
      <circle cx={px1} cy={py - 2} r={4} fill={C.gold} />
    </g>
  );
}

/** The lander in gold foil, feet at (x, y), leaning `angle` degrees (positive to the right). */
export function Lander({ x, y, angle, throttle, scale = 1, color, seed = 0, opacity = 1 }: { x: number; y: number; angle: number; throttle: number; scale?: number; color?: string; seed?: number; opacity?: number }) {
  const f = useCurrentFrame();
  const flicker = 0.85 + 0.3 * random(`${seed}-${f}`);
  const flame = throttle > 0 ? (6 + throttle * 6) * flicker : 0;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${angle} 0 -18)`} opacity={opacity}>
      {flame > 0 ? (
        <g>
          <path d={`M -6 -11 Q 0 ${-11 + flame * 1.25} 6 -11 Z`} fill={C.flame} opacity={0.85} />
          <path d={`M -3 -11 Q 0 ${-11 + flame * 0.8} 3 -11 Z`} fill={C.flameCore} />
        </g>
      ) : null}
      <path d="M -9 -14 L -17 0 M 9 -14 L 17 0" stroke={C.ink2} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M -20 0 L -14 0 M 14 0 L 20 0" stroke={C.ink2} strokeWidth={2.4} strokeLinecap="round" />
      <rect x={-13} y={-21} width={26} height={11} rx={1.5} fill={C.gold} stroke={C.goldShadow} strokeWidth={1.2} />
      <path d="M -13 -15.5 L 13 -15.5" stroke={C.goldShadow} strokeWidth={1} />
      <path d="M -9 -21 L -11 -31 L -5 -38 L 5 -38 L 11 -31 L 9 -21 Z" fill="#e6e8ee" stroke="#9aa2ad" strokeWidth={1.2} />
      <path d="M -4 -33 L 0 -36 L 4 -33 L 3 -29 L -3 -29 Z" fill="#1c2233" />
      {color ? <circle cx={0} cy={-44} r={4.5} fill={color} stroke={C.bg} strokeWidth={1.5} /> : null}
    </g>
  );
}

/** A big number that counts up with an ease, in tabular figures. */
export function Count({ from = 0, to, at, dur, format = (n: number) => Math.round(n).toLocaleString("en-GB"), style }: { from?: number; to: number; at: number; dur: number; format?: (n: number) => string; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const v = interpolate(f, [at, at + dur], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  return <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>{format(v)}</span>;
}
