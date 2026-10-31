import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Caption, Ground, Lander, Rise, Scene, sx, sy, type View } from "../components";
import { DATA, MENU_TILTS, THROTTLES, flightOf, stateAt } from "../data";
import { SCENES, howStep } from "../timeline";
import { BODY, C, DISPLAY, LANE_COLOR, WIDTH } from "../theme";

export const FLIGHT_VIEW: View = { left: 20, top: 400, scale: 2.6, worldHeight: 240 };
const VIEW_H = 240 * 2.6;

const CELL_W = 100;
const CELL_H = 34;
const GAP = 6;
const GRID_LEFT = 230;
const GRID_TOP = 1072;

/** One real flight by Jev, with its probability for each of the 35 moves lighting the grid every second. */
export function HowItWorks() {
  const f = useCurrentFrame();
  const jev = flightOf("jev");
  const { step, speed } = howStep(f - 20, jev.steps.length - 1);
  const s = stateAt(jev, step);
  const k = Math.min(jev.picks.length - 1, Math.floor(step / 60));
  const pick = jev.picks[k]!;
  const prev = jev.picks[Math.max(0, k - 1)]!;
  // Cross-fade into each new set of probabilities over the first part of its second.
  const into = Math.min(1, (step - k * 60) / 10);
  const trail = jev.steps.slice(0, Math.floor(step) + 1).filter((_, i) => i % 4 === 0);
  const landed = step >= jev.steps.length - 1;
  const gridIn = interpolate(f, [24, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const secs = Math.floor(step / 60);
  return (
    <Scene len={SCENES.how.len}>
      <AbsoluteFill>
        <Caption title="Every second, the model picks one move." sub="Each move is a tilt and a throttle. Brighter cells are the moves Jev thought best." />
        <svg width={WIDTH} height={1350} style={{ position: "absolute" }}>
          <defs>
            <clipPath id="howview">
              <rect x={0} y={FLIGHT_VIEW.top} width={WIDTH} height={VIEW_H} />
            </clipPath>
          </defs>
          <g clipPath="url(#howview)">
            <Ground view={FLIGHT_VIEW} terrain={DATA.race.terrain} segment={DATA.world.segment} pad={DATA.race.pad} padLit={landed ? 1 : 0} />
            <polyline points={trail.map(([x, y]) => `${sx(FLIGHT_VIEW, x)},${sy(FLIGHT_VIEW, y)}`).join(" ")} fill="none" stroke={LANE_COLOR.jev} strokeWidth={3} strokeOpacity={0.7} strokeLinecap="round" strokeLinejoin="round" />
            <Lander x={sx(FLIGHT_VIEW, s.x)} y={sy(FLIGHT_VIEW, s.y)} angle={s.angle} throttle={landed ? 0 : s.throttle} scale={1.25} />
          </g>
        </svg>
        <div style={{ position: "absolute", left: 72, top: FLIGHT_VIEW.top + 20, display: "flex", gap: 28, alignItems: "baseline", fontFamily: BODY, fontSize: 26, color: C.ink2 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, color: C.ink }}>
            <span style={{ width: 14, height: 14, borderRadius: 7, background: LANE_COLOR.jev }} />
            Jev
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} flight time
          </span>
        </div>
        <div style={{ position: "absolute", right: 72, top: FLIGHT_VIEW.top + 10, fontFamily: DISPLAY, fontWeight: 600, fontSize: 44, color: speed > 1.05 ? C.gold : C.ink2, fontVariantNumeric: "tabular-nums" }}>
          ×{speed < 1.05 ? "1" : speed.toFixed(0)}
        </div>
        {landed ? (
          <Rise delay={0} style={{ position: "absolute", left: 0, right: 0, top: FLIGHT_VIEW.top + 120, textAlign: "center" }}>
            <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 64, color: C.good }}>Landed</span>
          </Rise>
        ) : null}
        <svg width={WIDTH} height={1350} style={{ position: "absolute", opacity: gridIn }}>
          <text x={GRID_LEFT - 24} y={GRID_TOP + 14} textAnchor="end" fill={C.ink2} fontFamily={BODY} fontSize={22}>
            Full burn
          </text>
          <text x={GRID_LEFT - 24} y={GRID_TOP + 4 * (CELL_H + GAP) + 24} textAnchor="end" fill={C.ink2} fontFamily={BODY} fontSize={22}>
            Engine off
          </text>
          {MENU_TILTS.map((tilt, c) => (
            <text key={tilt} x={GRID_LEFT + c * (CELL_W + GAP) + CELL_W / 2} y={GRID_TOP + 5 * (CELL_H + GAP) + 26} textAnchor="middle" fill={C.ink2} fontFamily={BODY} fontSize={22}>
              {tilt === 0 ? "Upright" : `${Math.abs(tilt)}° ${tilt < 0 ? "L" : "R"}`}
            </text>
          ))}
          {MENU_TILTS.flatMap((_, c) =>
            Array.from({ length: THROTTLES }, (_, t) => {
              const i = c * THROTTLES + t;
              const p = (prev.probs?.[i] ?? 0) * (1 - into) + (pick.probs?.[i] ?? 0) * into;
              const chosen = i === pick.pick;
              const x = GRID_LEFT + c * (CELL_W + GAP);
              const y = GRID_TOP + (THROTTLES - 1 - t) * (CELL_H + GAP);
              return (
                <g key={i}>
                  <rect x={x} y={y} width={CELL_W} height={CELL_H} rx={5} fill="rgba(150, 180, 215, 0.08)" />
                  <rect x={x} y={y} width={CELL_W} height={CELL_H} rx={5} fill={C.gold} opacity={Math.min(1, Math.sqrt(p) * 1.25)} />
                  {chosen ? <rect x={x - 3} y={y - 3} width={CELL_W + 6} height={CELL_H + 6} rx={7} fill="none" stroke={C.ink} strokeWidth={3} /> : null}
                </g>
              );
            }),
          )}
        </svg>
      </AbsoluteFill>
    </Scene>
  );
}
