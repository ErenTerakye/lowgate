import { AbsoluteFill, Audio, Freeze, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Backdrop } from "./components";
import { LOOP_FADE, SCENES, TOTAL_FRAMES } from "./timeline";
import { Hook } from "./scenes/Hook";
import { HowItWorks } from "./scenes/HowItWorks";
import { Race } from "./scenes/Race";
import { Scoreboard } from "./scenes/Scoreboard";
import { Traces } from "./scenes/Traces";
import { Speed } from "./scenes/Speed";
import { EndCard } from "./scenes/EndCard";

const PARTS = [
  [SCENES.hook, Hook],
  [SCENES.how, HowItWorks],
  [SCENES.race, Race],
  [SCENES.score, Scoreboard],
  [SCENES.traces, Traces],
  [SCENES.speed, Speed],
  [SCENES.end, EndCard],
] as const;

/** The opening's first frame, fading in over the end so the loop back to frame 0 has no cut. */
function LoopIn() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: interpolate(f, [0, LOOP_FADE - 1], [0, 1], { extrapolateRight: "clamp" }) }}>
      <Freeze frame={0}>
        <Hook />
      </Freeze>
    </AbsoluteFill>
  );
}

export function Launch({ withAudio = true }: { withAudio?: boolean }) {
  return (
    <AbsoluteFill>
      <Backdrop />
      {PARTS.map(([s, Part], i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.len}>
          <Part />
        </Sequence>
      ))}
      <Sequence from={TOTAL_FRAMES - LOOP_FADE} durationInFrames={LOOP_FADE}>
        <LoopIn />
      </Sequence>
      {withAudio ? <Audio src={staticFile("soundtrack.wav")} /> : null}
    </AbsoluteFill>
  );
}
