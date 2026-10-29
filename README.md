# Decision Arena

AI decision models fly the same seeded lander course side by side. Each lane shows live per-option probabilities, latency, decisions per second and cost.

> Work in progress: milestone 1 of 7 (deterministic game, keyboard lane, scripted autopilot lane).
> Research and design notes: [docs/phase1-research.md](docs/phase1-research.md).

## Run locally

```bash
pnpm install
pnpm dev        # http://localhost:5173  (?seed=42&seconds=300)
pnpm test       # engine unit + determinism tests
pnpm typecheck
node packages/engine/scripts/balance.ts   # autopilot landing rate across seeds
```

## How the game works

- **Deterministic engine** (`packages/engine`): pure TypeScript with no DOM. It uses a seeded PRNG (mulberry32), fixed 60 Hz physics and a 5 Hz decision clock. Trigonometry comes from a table built with plain IEEE-754 arithmetic, so every JS engine re-simulates replays bit-for-bit. `stateHash()` fingerprints each decision tick.
- **Same course for every lane:** level *n* of a run is a pure function of `(seed, n)`. Difficulty (terrain, wind, distance) ramps with *n*.
- **Actions:** `rotate ∈ {left, none, right}` and `throttle ∈ 0–4`, held for one 200 ms decision tick. The keyboard is sampled at the same 5 Hz every model gets.
- **Scoring:** 100 points per safe landing plus the fuel left; crashes and timeouts score 0.
