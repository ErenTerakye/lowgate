import { Composition } from "remotion";
import { Launch } from "./Launch";
import { Hook } from "./scenes/Hook";
import { Backdrop } from "./components";
import { FPS, HEIGHT, WIDTH } from "./theme";
import { TOTAL_FRAMES } from "./timeline";

/** The thumbnail LinkedIn shows before the video plays: the opening question, fully on screen. */
function Thumbnail() {
  return (
    <>
      <Backdrop />
      <Hook />
    </>
  );
}

export function Root() {
  return (
    <>
      <Composition id="Launch" component={Launch} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ withAudio: true }} />
      <Composition id="Thumbnail" component={Thumbnail} durationInFrames={200} fps={FPS} width={WIDTH} height={HEIGHT} />
    </>
  );
}
