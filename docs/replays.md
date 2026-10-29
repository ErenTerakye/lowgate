# Replays

A replay plays a recorded live run back in the browser with no API key and no
model calls. Public visitors watch replays. Live runs need the key-holding
proxy.

## What a recording holds

`apps/web/public/replays/<name>.json` (format `decision-arena-replay`, v1):

- the course seed, the run length and the engine version;
- for each lane, its label, kind, note, and the model and price that were
  pinned at recording time;
- every finished call the lane's runner applied: the tick it was asked on, the
  tick it took effect, measured latency, the action, the probabilities
  (rounded to 4 decimals), token usage and any error;
- the state hash at every decision tick, plus the final score.

Physics is not stored. The seed and the recorded answers re-simulate it.

## How playback stays faithful

Each lane gets a `ReplayClient` driven by a real `LaneRunner` (`ReplayRunner`).
Every answer is handed over on the tick it took effect live, never earlier. So
missed ticks, retries with backoff, a lane stopped by a quota error, and
answers that arrived after a level ended all come out as they did live. The
latency, decision-rate and cost figures are therefore the measured live ones.

While it plays, the page compares each lane's state hash with the recording at
every decision tick. If they stop matching, the page says on which lane and
from which decision, rather than passing the run off as the recorded one. This
happens if the engine changed, and `parseRecording` already refuses a file
recorded on a different `ENGINE_VERSION`.

## Recording a run

1. `pnpm dev` and pick the lanes, for example
   `?lanes=jev,clef,qwen,laya,autopilot&seed=42`.
2. Fly the whole run at 1×. Faster speeds give models less wall time per
   decision, so the save button is disabled for them.
3. Click **Save replay** when the run finishes. In dev this writes
   `apps/web/public/replays/seed-<seed>-<time>.json`. The public build
   downloads the file instead.
4. Watch it at `?replay=<name>`. The public build opens on `?replay=showcase`
   unless the URL has `?live`. Rename the run you want shown to
   `showcase.json`.

Tests: `apps/web/test/replay.test.ts` records a run with slow, failing and
out-of-quota models, replays it, and checks that every lane's hashes, counters,
latencies and usage match. It also checks that a tampered answer is caught.
