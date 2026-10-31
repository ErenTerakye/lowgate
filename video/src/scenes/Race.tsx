import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Caption, Ground, Lander, Rise, Scene, sx, sy } from "../components";
import { DATA, stateAt } from "../data";
import { SCENES, raceStep } from "../timeline";
import { BODY, C, LANE_COLOR, WIDTH } from "../theme";
import { FLIGHT_VIEW } from "./HowItWorks";

const VIEW_H = FLIGHT_VIEW.worldHeight * FLIGHT_VIEW.scale;

/** All nine lanes on the same level at once, as they really flew it. */
export function Race() {
  const f = useCurrentFrame();
  const flights = DATA.race.flights;
  const longest = Math.max(...flights.map((x) => x.steps.length - 1));
  const step = raceStep(f, longest);
  const anyLanded = flights.some((x) => x.outcome === "landed" && step >= x.steps.length - 1);
  const legendIn = interpolate(f, [20, 46], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // Flown order: drawn back to front so the lanes that land sit on top at the pad.
  const order = [...flights].reverse();
  return (
    <Scene len={SCENES.race.len}>
      <AbsoluteFill>
        <Caption title="Nine pilots, one level." sub="Same start, same terrain, same wind. Seven System One models, one LLM and a scripted autopilot." />
        <svg width={WIDTH} height={1350} style={{ position: "absolute" }}>
          <defs>
            <clipPath id="raceview">
              <rect x={0} y={FLIGHT_VIEW.top} width={WIDTH} height={VIEW_H} />
            </clipPath>
          </defs>
          <g clipPath="url(#raceview)">
            <Ground view={FLIGHT_VIEW} terrain={DATA.race.terrain} segment={DATA.world.segment} pad={DATA.race.pad} padLit={anyLanded ? 1 : 0} />
            {order.map((fl) => {
              const trail = fl.steps.slice(0, Math.floor(step) + 1).filter((_, i) => i % 6 === 0);
              return (
                <polyline key={fl.lane} points={trail.map(([x, y]) => `${sx(FLIGHT_VIEW, x)},${sy(FLIGHT_VIEW, y)}`).join(" ")} fill="none" stroke={LANE_COLOR[fl.lane]} strokeWidth={2.5} strokeOpacity={0.75} strokeLinecap="round" strokeLinejoin="round" />
              );
            })}
            {order.map((fl, i) => {
              const last = fl.steps.length - 1;
              const done = step >= last;
              const s = stateAt(fl, step);
              // A lander that left the world drifts on along its last velocity and fades, rather than stopping at the edge.
              const over = fl.outcome === "out_of_bounds" && done ? step - last : 0;
              const [ax, ay] = fl.steps[last - 1]!;
              const [bx, by] = fl.steps[last]!;
              const x = s.x + (bx - ax) * over;
              const y = s.y + (by - ay) * over;
              const fade = fl.outcome === "out_of_bounds" ? Math.max(0, 1 - over / 120) : 1;
              return <Lander key={fl.lane} x={sx(FLIGHT_VIEW, x)} y={sy(FLIGHT_VIEW, y)} angle={s.angle} throttle={done ? 0 : s.throttle} scale={1} color={LANE_COLOR[fl.lane] ?? C.ink} seed={i} opacity={fade} />;
            })}
          </g>
        </svg>
        <div style={{ position: "absolute", left: 72, right: 72, top: 1062, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", rowGap: 22, columnGap: 24, opacity: legendIn }}>
          {flights.map((fl) => {
            const done = step >= fl.steps.length - 1;
            const landed = fl.outcome === "landed";
            return (
              <div key={fl.lane} style={{ fontFamily: BODY }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 27, color: C.ink }}>
                  <span style={{ width: 14, height: 14, borderRadius: 7, background: LANE_COLOR[fl.lane], flex: "none" }} />
                  {fl.label}
                </div>
                <div style={{ height: 32, marginTop: 4, marginLeft: 24 }}>
                  {done ? (
                    <Rise distance={12}>
                      <span style={{ fontSize: 23, fontWeight: 500, color: landed ? C.good : C.bad }}>{landed ? "Landed" : "Flew off course"}</span>
                    </Rise>
                  ) : (
                    <span style={{ fontSize: 23, color: C.muted }}>Flying</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Scene>
  );
}
