# Jev prompt tuning (2026-10-29)

Model `jev-1.14.0` (TypeSafe, pinned; every response confirmed it served that version). All numbers are **measured** from a MacBook on home broadband with `pnpm probe`. Raw calls are in `measurements/`. The price is $0.042 per million input tokens, from **third-party reports**: TypeSafe's docs publish no price.

## What was wrong

The first prompt (p1) gave near-uniform throttle probabilities that leaned slightly toward Full (for example 15 / 13 / 18 / 21 / 33 %). Taking the most likely level therefore always chose Full, and the lander flew out of the area.

## Variants

A prompt is an observation tier plus a question wording (`PROMPTS` in `packages/decisions/src/questions.ts`). Ids are never edited once they have results.

| Prompt | Observation | Wording |
|---|---|---|
| p1 | Tier 2: state plus pad geometry | Generic: describes each control |
| p2 | Tier 2 | Situational: each option says when it is right, with the physics in numbers |
| p3 | Tier 2 without the fixed rules | Situational |
| p4 | Tier 3: adds safe horizontal and vertical speeds for right now | Situational |
| p5 | Tier 4: tier 3 plus the tilt that would correct horizontal speed | Coached: each option points at a coaching line |

## Answers on 30 autopilot states (seed 42)

"Follows" is the correlation between the model's expected throttle and the autopilot's throttle: does the answer rise and fall with what the situation needs? The autopilot is a reference, not ground truth.

| Prompt | Input tokens / call | Latency p50 / p95 | Rotate agrees | Throttle agrees | Throttle follows (r) | Top throttle probability |
|---|---|---|---|---|---|---|
| p1 | 715 | 213 / 307 ms | 23 % | 0 % | −0.10 | 30 % |
| p2 | 891 | 211 / 291 ms | 20 % | 13 % | 0.30 | 48 % |
| p3 | 799 | 209 / 296 ms | 13 % | 30 % | 0.01 | 41 % |
| p4 | 935 | 223 / 309 ms | 10 % | 53 % | 0.17 | 41 % |
| **p5** | 836 | 212 / 361 ms | **77 %** | **63 %** | **0.71** | **79 %** |

In tiers 1–3, rotation fails because rotation is a rate control. The right choice depends on the gap between the current tilt and a tilt the text never states, and Jev almost never chose Hold, which the autopilot picks in about 70 % of states.

## Closed-loop flights (no deadline: the world waits for each answer)

| Prompt | Level 1 | Level 2 |
|---|---|---|
| p2 | Timed out after 45 s, hovering | — |
| **p5** | **Landed** after 34.6 s: vy −1.6 m/s, vx −0.6, angle 0 | **Landed** after 38.1 s: vy −1.0, vx 0.3, angle 0 |

## Live, in the arena (5 decisions a second, 200 ms deadline)

With p5, Jev landed level 1 for 147 points, against the autopilot's 149. Median latency is about 215 ms, just over the 200 ms tick, so it misses about 48 % of ticks and gets about 2.5 decisions a second.

## Decision

The Jev lane flies **p5**, and its badge shows "model · tier 4". This is coached input: the observation states target speeds and tilt, and the model's job is to read them and choose a control. The results table will report the tier next to every score, and other System One lanes will be asked the same p5 prompt, so the comparison stays like for like. A tier-2 result (p2) is kept as the uncoached reference.

## Cost of this experiment

772 probe calls and 652,926 input tokens: **$0.027**, plus about $0.01 for three short live runs in the browser.

## Later: p6 and p7 (tuning the other lanes)

Two prompts added while tuning Clef-flash were also run on Jev (30 states each): p6 (throttle as a choice) gave r 0.74 and p7 (throttle levels quoting the observation's phrases) gave r 0.64, with rotation unchanged at 77 %. Jev stays on p5. See docs/lanes.md.
