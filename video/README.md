# Launch video

A 43-second, 4:5 (1080×1350) video of Low Gate for social posts, written in code with [Remotion](https://www.remotion.dev). Every lander, flight path and number in it comes from the recordings in `bench/`: `scripts/extract.ts` replays them through `LaneReplay`, which checks every state against its recorded hash, so the video cannot show a flight that did not happen.

The soundtrack is synthesised too. `scripts/soundtrack.ts` builds the music and effects from sine partials and filtered noise, and places each effect from the same timeline (`src/timeline.ts`) and flight data the picture uses, so a touchdown chime lands on the touchdown frame.

```bash
pnpm install
cd video
pnpm render    # extract flights, synthesise the soundtrack, render out/lowgate-launch.mp4
pnpm studio    # preview and scrub in the browser
```

`pnpm data` and `pnpm audio` run the two steps alone. Their outputs (`src/data/`, `public/soundtrack.wav`) and `out/` are generated, so they are not committed.

| Scene | What it shows |
|---|---|
| Hook | The question, over Jev's first seconds on level 8 of course 5002 |
| How it works | Jev's whole flight of that level, with its probability for each of the 35 moves every second |
| Race | All nine lanes on that level at once |
| Scoreboard | Landings out of 160 per lane |
| Traces | Every flight of Kev 0.8B and Kev 27B, moved so each level's pad sits at one spot |
| Speed | Total answer time over 160 levels: Jev against Gemma 4 12B |
| End | The name |
