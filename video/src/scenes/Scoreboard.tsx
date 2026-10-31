import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Caption, Count, Scene, ease } from "../components";
import { DATA } from "../data";
import { SCENES } from "../timeline";
import { BODY, C, DISPLAY, KIND, LANE_COLOR } from "../theme";

const TOP = 330;
const ROW = 94;
const BAR_LEFT = 400;
const BAR_MAX = 500;

/** Landings out of 160 for every lane, then the two Kev sizes picked out for the next scene. */
export function Scoreboard() {
  const f = useCurrentFrame();
  const lanes = [...DATA.lanes].sort((a, b) => b.landed - a.landed);
  const focus = interpolate(f, [230, 262], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const kev = (lane: string) => lane === "kev-0.8b" || lane === "kev-27b";
  return (
    <Scene len={SCENES.score.len}>
      <AbsoluteFill>
        <Caption title="Then 160 levels each." sub="Landings out of 160. The scripted autopilot is the reference." />
        {lanes.map((l, i) => {
          const at = 26 + i * 5;
          const grow = interpolate(f, [at, at + 60], [0, l.landed / l.levels], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
          const rowIn = interpolate(f, [at - 10, at + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const dim = kev(l.lane) ? 1 : 1 - 0.75 * focus;
          return (
            <div key={l.lane} style={{ position: "absolute", left: 72, right: 72, top: TOP + i * ROW, height: ROW - 18, opacity: rowIn * dim, display: "flex", alignItems: "center" }}>
              <div style={{ width: BAR_LEFT - 72 - 20, fontFamily: BODY }}>
                <div style={{ fontSize: 30, color: C.ink, lineHeight: 1.1 }}>{l.label}</div>
                <div style={{ fontSize: 21, color: C.muted, marginTop: 4 }}>{KIND[l.lane]}</div>
              </div>
              <div style={{ position: "relative", width: BAR_MAX, height: 34, marginLeft: 20 }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 4, background: "rgba(150, 180, 215, 0.08)" }} />
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: Math.max(4, grow * BAR_MAX), borderRadius: 4, background: LANE_COLOR[l.lane] }} />
              </div>
              <div style={{ marginLeft: 22, fontFamily: DISPLAY, fontWeight: 600, fontSize: 44, color: C.ink, width: 80, textAlign: "right" }}>
                <Count to={l.landed} at={at} dur={60} />
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </Scene>
  );
}
