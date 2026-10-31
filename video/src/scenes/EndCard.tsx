import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Lander, Rise, Scene, ease } from "../components";
import { LOOP_FADE, SCENES } from "../timeline";
import { BODY, C, DISPLAY, WIDTH } from "../theme";

const PAD_Y = 560;

/** The name, with a lander settling onto a pad above it. */
export function EndCard() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const descent = interpolate(f, [0, 70], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const y = PAD_Y - 260 * (1 - descent);
  const touched = descent > 0.995;
  const glow = spring({ frame: f - 70, fps, config: { damping: 30 } });
  return (
    <Scene len={SCENES.end.len} exit={LOOP_FADE}>
      <svg width={WIDTH} height={1350} style={{ position: "absolute" }}>
        <defs>
          <radialGradient id="padglow">
            <stop offset="0" stopColor={C.gold} stopOpacity={0.45} />
            <stop offset="1" stopColor={C.gold} stopOpacity={0} />
          </radialGradient>
        </defs>
        <ellipse cx={WIDTH / 2} cy={PAD_Y} rx={170} ry={44} fill="url(#padglow)" opacity={glow} />
        <rect x={WIDTH / 2 - 80} y={PAD_Y - 2} width={160} height={6} rx={2} fill={C.pad} />
        <Lander x={WIDTH / 2} y={y} angle={0} throttle={touched ? 0 : 2 + Math.round(2 * descent)} scale={2.4} />
      </svg>
      <div style={{ position: "absolute", left: 0, right: 0, top: PAD_Y + 70, textAlign: "center" }}>
        <Rise delay={44} distance={40}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 150, color: C.ink, letterSpacing: -2, lineHeight: 1 }}>Low Gate</div>
        </Rise>
        <Rise delay={56}>
          <div style={{ fontFamily: BODY, fontSize: 34, color: C.ink2, marginTop: 26 }}>AI models, flying a lunar lander.</div>
        </Rise>
        <Rise delay={84}>
          <div style={{ fontFamily: BODY, fontSize: 28, color: C.muted, marginTop: 80 }}>Replays, results and code: link in the post.</div>
        </Rise>
      </div>
    </Scene>
  );
}
