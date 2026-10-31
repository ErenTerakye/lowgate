import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Caption, Rise, Scene, ease } from "../components";
import { DATA } from "../data";
import { SCENES, TRACE, TRACE_POINTS_MAX } from "../timeline";
import { BODY, C, DISPLAY, LANE_COLOR, WIDTH } from "../theme";

const SCALE = 2.45;
const PAD_Y = 1190;
const CX = WIDTH / 2;
const X = (dx: number) => CX + dx * SCALE;
const Y = (dy: number) => PAD_Y - dy * SCALE;
const TOP = 600;

type Trace = { outcome: string; pts: [number, number][] };

/** Every one of a lane's 160 flights, moved so each level's pad sits at the same spot. */
function Bundle({ traces, progress, color, opacity, width }: { traces: Trace[]; progress: number; color: string; opacity: number; width: number }) {
  const shown = Math.floor(progress * TRACE_POINTS_MAX);
  return (
    <g opacity={opacity}>
      {traces.map((t, i) => {
        const pts = t.pts.slice(0, Math.max(1, shown));
        return <polyline key={i} points={pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth={width} strokeOpacity={0.42} strokeLinecap="round" strokeLinejoin="round" />;
      })}
      {traces.map((t, i) => {
        if (shown < t.pts.length) return null;
        const [x, y] = t.pts[t.pts.length - 1]!;
        if (t.outcome === "landed") return <circle key={`e${i}`} cx={X(x)} cy={Y(y) - 3} r={4} fill={color} />;
        if (t.outcome === "out_of_bounds") return null;
        const px = X(x);
        const py = Y(y);
        return <path key={`e${i}`} d={`M ${px - 5} ${py - 5} L ${px + 5} ${py + 5} M ${px + 5} ${py - 5} L ${px - 5} ${py + 5}`} stroke={C.bad} strokeWidth={2} />;
      })}
    </g>
  );
}

function landedBy(traces: Trace[], progress: number): number {
  const shown = Math.floor(progress * TRACE_POINTS_MAX);
  return traces.filter((t) => t.outcome === "landed" && shown >= t.pts.length).length;
}

/** The video's centrepiece: Kev 0.8B's 160 flights scatter, then Kev 27B's converge on the pad. */
export function Traces() {
  const f = useCurrentFrame();
  const small = DATA.traces["kev-0.8b"]!;
  const big = DATA.traces["kev-27b"]!;
  const pSmall = interpolate(f, [TRACE.smallStart, TRACE.smallStart + TRACE.smallDraw], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (t) => t });
  const pBig = interpolate(f, [TRACE.bigStart, TRACE.bigStart + TRACE.bigDraw], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (t) => t });
  const swap = interpolate(f, [TRACE.bigStart - 30, TRACE.bigStart], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const punch = TRACE.bigStart + TRACE.bigDraw + 10;
  const lane = swap < 0.5 ? "kev-0.8b" : "kev-27b";
  const label = lane === "kev-0.8b" ? "Kev 0.8B" : "Kev 27B";
  const size = lane === "kev-0.8b" ? "0.8 billion parameters" : "27 billion parameters";
  const landed = lane === "kev-0.8b" ? landedBy(small, pSmall) : landedBy(big, pBig);
  // The label fades out and back in as it switches lanes.
  const labelFade = Math.abs(swap - 0.5) * 2;
  return (
    <Scene len={SCENES.traces.len}>
      <AbsoluteFill>
        {f < punch ? (
          <div style={{ opacity: interpolate(f, [punch - 14, punch], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            <Caption title="All 160 flights, on one pad." sub="Every level has its own pad, so here they are lined up on one. Lines that end on the pad landed." />
          </div>
        ) : (
          <Caption title="Same family, same prompt. Only the size changed." delay={punch} />
        )}
        <svg width={WIDTH} height={1350} style={{ position: "absolute" }}>
          <defs>
            <clipPath id="tracesview">
              <rect x={0} y={TOP} width={WIDTH} height={PAD_Y - TOP + 40} />
            </clipPath>
          </defs>
          <g clipPath="url(#tracesview)">
            <line x1={0} x2={WIDTH} y1={PAD_Y + 2} y2={PAD_Y + 2} stroke={C.rule} strokeWidth={1.5} strokeDasharray="2 8" />
            <Bundle traces={small} progress={pSmall} color={swap > 0 ? C.muted : LANE_COLOR["kev-0.8b"]!} opacity={1 - 0.8 * swap} width={2} />
            <Bundle traces={big} progress={pBig} color={LANE_COLOR["kev-27b"]!} opacity={1} width={2} />
          </g>
          <rect x={X(-15)} y={PAD_Y - 2} width={30 * SCALE} height={6} rx={2} fill={C.pad} />
          <text x={CX} y={PAD_Y + 44} textAnchor="middle" fill={C.ink2} fontFamily={BODY} fontSize={24}>
            Landing pad
          </text>
        </svg>
        <div style={{ position: "absolute", left: 72, right: 72, top: 440, display: "flex", justifyContent: "space-between", alignItems: "flex-end", opacity: labelFade }}>
          <Rise delay={14}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 64, color: LANE_COLOR[lane], lineHeight: 1 }}>{label}</div>
            <div style={{ fontFamily: BODY, fontSize: 26, color: C.ink2, marginTop: 8 }}>{size}</div>
          </Rise>
          <Rise delay={20}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 64, color: C.ink, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {landed}
                <span style={{ color: C.muted, fontSize: 40 }}> / 160</span>
              </div>
              <div style={{ fontFamily: BODY, fontSize: 26, color: C.ink2, marginTop: 8 }}>landed</div>
            </div>
          </Rise>
        </div>
      </AbsoluteFill>
    </Scene>
  );
}
