import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Caption, Rise, Scene, ease } from "../components";
import { laneOf } from "../data";
import { SCENES } from "../timeline";
import { BODY, C, DISPLAY, LANE_COLOR } from "../theme";

const BAR_MAX = 936;

function clock(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** Total answer time over all 160 levels: Jev's run fills at once, Gemma's keeps going. */
export function Speed() {
  const f = useCurrentFrame();
  const jev = laneOf("jev");
  const gemma = laneOf("gemma-local");
  const max = gemma.answerSeconds;
  // Both clocks run at the same rate until Jev's stops; Gemma's then speeds up to finish in the scene.
  const jevAt = 40;
  const jevDur = 26;
  const gemmaDur = 190;
  const tJev = interpolate(f, [jevAt, jevAt + jevDur], [0, jev.answerSeconds], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tGemma = interpolate(f, [jevAt, jevAt + jevDur, jevAt + gemmaDur], [0, jev.answerSeconds, max], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (t) => t * t * 0.4 + t * 0.6 });
  const rows = [
    { l: jev, t: tJev, kind: "System One model", per: `${(jev.p50Ms / 1000).toFixed(1)} s per answer` },
    { l: gemma, t: tGemma, kind: "LLM", per: `${(gemma.p50Ms / 1000).toFixed(1)} s per answer` },
  ];
  const outro = interpolate(f, [jevAt + gemmaDur + 6, jevAt + gemmaDur + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  return (
    <Scene len={SCENES.speed.len}>
      <AbsoluteFill>
        <Caption title="Nearly as good. Far slower." sub="Jev is a System One model; Gemma 4 12B is an LLM. This is the total time each spent answering, over 160 levels." />
        {rows.map(({ l, t, kind, per }, i) => (
          <Rise key={l.lane} delay={18 + i * 8} style={{ position: "absolute", left: 72, right: 72, top: 430 + i * 260 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <span style={{ fontFamily: BODY, fontSize: 34, color: C.ink }}>{l.label}</span>
                <span style={{ fontFamily: BODY, fontSize: 24, color: C.muted, marginLeft: 16 }}>{kind}</span>
              </div>
            </div>
            <div style={{ position: "relative", height: 46, marginTop: 18 }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: 5, background: "rgba(150, 180, 215, 0.08)" }} />
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: Math.max(4, (t / max) * BAR_MAX), borderRadius: 5, background: LANE_COLOR[l.lane] }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 16 }}>
              <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 60, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{clock(t)}</span>
              <span style={{ fontFamily: BODY, fontSize: 24, color: C.ink2 }}>
                {per}, {l.landed} of 160 landed
              </span>
            </div>
          </Rise>
        ))}
        <div style={{ position: "absolute", left: 72, right: 72, top: 1010, opacity: outro, transform: `translateY(${(1 - outro) * 24}px)` }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 52, color: C.gold, lineHeight: 1.1 }}>
            {Math.round(gemma.answerSeconds / jev.answerSeconds)} times as long, for {jev.landed - gemma.landed} fewer landings.
          </div>
        </div>
      </AbsoluteFill>
    </Scene>
  );
}
