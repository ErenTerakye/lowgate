import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Ground, Lander, Rise, Scene, sx, sy, type View } from "../components";
import { DATA, flightOf, stateAt } from "../data";
import { SCENES } from "../timeline";
import { BODY, C, DISPLAY, HEIGHT, WIDTH } from "../theme";

/** The question, over Jev's real first seconds on the race level. */
export function Hook() {
  const f = useCurrentFrame();
  const jev = flightOf("jev");
  const view: View = { left: 0, top: HEIGHT - 300 * 2.7, scale: 2.7, worldHeight: 300 };
  const s = stateAt(jev, f);
  const drift = interpolate(f, [0, SCENES.hook.len], [0, -30]);
  return (
    <Scene len={SCENES.hook.len}>
      <AbsoluteFill>
        <svg width={WIDTH} height={HEIGHT} style={{ position: "absolute", transform: `translateY(${drift * 0.3}px)` }}>
          <Ground view={view} terrain={DATA.race.terrain} segment={DATA.world.segment} pad={DATA.race.pad} />
          <Lander x={sx(view, s.x)} y={sy(view, s.y)} angle={s.angle} throttle={s.throttle} scale={2} />
        </svg>
        <div style={{ position: "absolute", left: 72, right: 72, top: 150 }}>
          <Rise delay={0} distance={60}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 132, lineHeight: 0.98, color: C.ink, letterSpacing: -1.5 }}>Can an AI model</div>
          </Rise>
          <Rise delay={8} distance={60}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 132, lineHeight: 0.98, color: C.ink, letterSpacing: -1.5 }}>land on the Moon?</div>
          </Rise>
          <Rise delay={50}>
            <div style={{ fontFamily: BODY, fontSize: 36, lineHeight: 1.35, color: C.ink2, marginTop: 36, maxWidth: 820 }}>
              I gave AI models the same 160 landings to fly, and recorded every decision.
            </div>
          </Rise>
        </div>
      </AbsoluteFill>
    </Scene>
  );
}
