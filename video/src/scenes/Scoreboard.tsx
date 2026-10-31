import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption, Count, Scene, ease } from "../components";
import { DATA } from "../data";
import { KEV_LIGHTS, SCENES, SCORE_FOCUS } from "../timeline";
import { BODY, C, DISPLAY, KIND, LANE_COLOR } from "../theme";

const TOP = 330;
const ROW = 94;
const BAR_LEFT = 400;
const BAR_MAX = 500;

/** Landings out of 160 for every lane; then the other lanes dim and the four Kev sizes light up, smallest first. */
export function Scoreboard() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lanes = [...DATA.lanes].sort((a, b) => b.landed - a.landed);
  const focus = interpolate(f, [SCORE_FOCUS, SCORE_FOCUS + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const lightAt = new Map(KEV_LIGHTS);
  return (
    <Scene len={SCENES.score.len}>
      <AbsoluteFill>
        {f < SCORE_FOCUS + 10 ? (
          <div style={{ opacity: interpolate(f, [SCORE_FOCUS - 4, SCORE_FOCUS + 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            <Caption title="Then 160 levels each." sub="Landings out of 160. The scripted autopilot is the reference." />
          </div>
        ) : (
          <Caption title="One model family, four sizes." sub="Kev in four sizes, from 0.8 to 27 billion parameters. The same prompt for all of them." delay={SCORE_FOCUS + 10} />
        )}
        {lanes.map((l, i) => {
          const at = 26 + i * 5;
          const grow = interpolate(f, [at, at + 60], [0, l.landed / l.levels], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
          const rowIn = interpolate(f, [at - 10, at + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const lit = lightAt.get(l.lane);
          const dim = lit !== undefined ? 1 : 1 - 0.78 * focus;
          // A Kev row's band sweeps in from the left, and its count pops, when its turn comes.
          const sweep = lit === undefined ? 0 : interpolate(f, [lit, lit + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
          const pop = lit === undefined ? 0 : spring({ frame: f - lit, fps, config: { damping: 9, stiffness: 180 } });
          const scale = 1 + 0.22 * pop * Math.max(0, 1 - (f - lit! - 4) / 30);
          const color = LANE_COLOR[l.lane];
          return (
            <div key={l.lane} style={{ position: "absolute", left: 72, right: 72, top: TOP + i * ROW, height: ROW - 18, opacity: rowIn * dim, display: "flex", alignItems: "center" }}>
              {lit !== undefined ? (
                <div style={{ position: "absolute", left: -28, right: -28, top: -9, bottom: -9, borderRadius: 12, overflow: "hidden", clipPath: `inset(0 ${(1 - sweep) * 100}% 0 0)` }}>
                  <div style={{ position: "absolute", inset: 0, background: color, opacity: 0.16 }} />
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: color }} />
                </div>
              ) : null}
              <div style={{ position: "relative", width: BAR_LEFT - 72 - 20, fontFamily: BODY }}>
                <div style={{ fontSize: 30, color: C.ink, lineHeight: 1.1 }}>{l.label}</div>
                <div style={{ fontSize: 21, color: C.muted, marginTop: 4 }}>{KIND[l.lane]}</div>
              </div>
              <div style={{ position: "relative", width: BAR_MAX, height: 34, marginLeft: 20 }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 4, background: "rgba(150, 180, 215, 0.08)" }} />
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: Math.max(4, grow * BAR_MAX), borderRadius: 4, background: color, boxShadow: lit !== undefined ? `0 0 ${24 * sweep}px ${color}` : undefined }} />
              </div>
              <div style={{ position: "relative", marginLeft: 22, fontFamily: DISPLAY, fontWeight: 600, fontSize: 44, color: C.ink, width: 80, textAlign: "right", transform: `scale(${lit === undefined ? 1 : scale})`, transformOrigin: "right center" }}>
                <Count to={l.landed} at={at} dur={60} />
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </Scene>
  );
}
