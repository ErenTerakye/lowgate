import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Backdrop } from "./components";
import { SCENES } from "./timeline";
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

export function Launch({ withAudio = true }: { withAudio?: boolean }) {
  return (
    <AbsoluteFill>
      <Backdrop />
      {PARTS.map(([s, Part], i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.len}>
          <Part />
        </Sequence>
      ))}
      {withAudio ? <Audio src={staticFile("soundtrack.wav")} /> : null}
    </AbsoluteFill>
  );
}
