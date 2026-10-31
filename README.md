# Low Gate

AI decision models fly the same seeded lunar-lander courses, and the benchmark measures their judgment. Each decision picks one manoeuvre from a fixed menu of 35 (a target tilt and a throttle level, held for one second). The game waits for every answer, so latency and cost are measured and shown, but never change the score.

The name comes from Apollo: low gate is the point in the descent where the crew took over and chose where to touch down.

> Work in progress. The plan, rules and milestones are in [docs/redesign.md](docs/redesign.md). Lane setup and measurements are in [docs/lanes.md](docs/lanes.md).

## Lanes

| Lane | Kind | Runs on |
|---|---|---|
| Jev | System One decision model | TypeSafe API |
| Clef-flash | System One decision model | Cloudflare Workers AI |
| Kev 0.8B, 4B, 9B, 27B | Open-weight System One decision models | Colab G4 GPU, via `bridge/kev/kev_colab.ipynb` |
| Laya | Decision model, fine-tuned for the menu | M3 MacBook Pro, 16 GB (MLX), via `bridge/laya/server.py` |
| Gemma 4 12B | Chat model, answers in JSON | M3 MacBook Pro, 16 GB (LM Studio) |
| Autopilot | Scripted baseline | In process |

## Run locally

```bash
pnpm install
cp .env.example .env   # add your own keys; .env is never committed
pnpm dev               # replays at http://localhost:5173, results at /results.html
pnpm test
pnpm typecheck
pnpm bench             # 20 courses per lane, resumable, recordings in bench/
pnpm bench --summary   # rebuild bench/results.json from the recordings
```

## Deploy

The site is static: replays and results are built from `bench/` and need no server or key. It runs as a Cloudflare Worker with static assets only (`apps/web/wrangler.jsonc`), on the free plan, at `lowgate.erenterakye.com`.

```bash
pnpm exec wrangler login
pnpm deploy:web        # build, then upload apps/web/dist
```

## How it works

- **Deterministic engine** (`packages/engine`, version `descent-3`): pure TypeScript, seeded PRNG, fixed 60 Hz physics, one decision per second. Level *n* of a course is a pure function of `(seed, n)`, so every lane flies the same terrain and wind, and every recording replays bit-for-bit.
- **Decision layer** (`packages/decisions`): one adapter for System One models and one for chat models, a lockstep runner, failure rules, recordings checked by replay, and summary statistics with intervals.
- **Ranking:** landing rate over 160 levels (20 courses of 8), ties broken by a landing-quality score built from distance to the pad, touchdown speed and fuel left.
