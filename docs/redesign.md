# Redesign: judgment, not reflexes (agreed 2026-10-30)

## Why

The real-time arena asked for a decision five times a second. A lane that
answered in under 200 ms could keep up; the rest flew blind between answers.
In the showcase, Clef-flash missed 69% of ticks and Qwen3 62%, so the run
mostly measured network latency. The redesign keeps Descent and the decision
models but takes the clock out of the score. Each decision matters more, and
there are far fewer of them.

## Rules

| Topic | Decision |
|---|---|
| What the score measures | Judgment only. The game waits for every answer. Latency and cost are measured and shown next to the score but never change it. |
| How a model flies | One choice per decision from a fixed menu of manoeuvres. Each manoeuvre is a target tilt and a throttle level, held for 1 second. Every lane, the chat model included, answers the same choice question. |
| Decisions | About 35 per level (measured with the autopilot), against about 225 in the real-time version. |
| Rehearsal | None. One answer per decision, with no way to test it first. |
| Thinking | No extended thinking. Every model answers directly, with the same output cap. |
| Run shape | A course is 8 fixed levels. Every lane flies all 8, even after a crash. |
| Evidence | 20 courses (160 levels per lane), flown offline. The page replays one course and shows the results of all 20. |
| Ranking | Landing rate across all levels, ties broken by an average landing-quality score made of distance from the pad centre, touchdown speed and fuel left. Both are shown with their spread. |
| Explaining a decision | The probability bars across the menu, and a timeline of how confident the lane was. The chat model (Gemma) returns no probabilities, so it gets a single bar for the manoeuvre it picked. |
| View | One shared course: every lander on the same terrain in its own colour, with a trail. A panel per lane shows its bars, score, latency and cost. |
| Roster | Jev, Clef-flash, Gemma 4 12B on this Mac (the chat lane; replaced Qwen3 30B on 2026-10-30 to leave the Workers AI allowance to Clef-flash, docs/lanes.md), Laya (retrained for the menu) and the autopilot (adapted to the menu). Kev joins next, self-hosted on Colab GPUs (0.8B, 4B and probably 9B), chosen over OpenRouter on 2026-10-30. |
| Name | Low Gate (repo `lowgate`), renamed from Decision Arena on 2026-10-30 because that name is taken by a similar System One project. The Apollo low gate is where the crew took over and chose the touchdown spot. Recordings keep the format tag `decision-arena/recording-2`. |
| Old version | Tagged `v0-realtime`, then removed from the working tree, including `showcase.json`. Nothing is lost. |

Replaced during the discussion: free-form plans with six segments, a
one-sentence rationale, and altitude gates as the only times a model is asked.
System One models (Jev, Clef, Laya, Kev) cannot write text. They can only pick
an option or rate on a scale, so the plan became a menu choice and the
rationale became the probability bars.

## Design details

**Engine (`descent-3`).**
- Physics stays at 60 Hz. A decision holds for 60 steps (1 s).
- The action is a target tilt and a throttle level. The lander turns toward
  the target at the existing rate limit (30°/s).
- The menu has 35 manoeuvres: 7 tilts (−30°, −15°, −5°, 0°, 5°, 15°, 30°) by 5
  throttle levels (0–4), indexed tilt-major. Tuned in R1: without the ±5°
  tilts the autopilot landed 77% of 100 courses' levels, with them 97%.
- A course is levels 0–7 of one seed, with difficulty ramping to full on
  level 7. Each level ends in an outcome. Each landing records its offset from
  the pad centre, its touchdown speed, the fuel left, and a 0–100 quality
  score: equal thirds for centring, gentleness and fuel.
- No run timer. A level times out at 60 s (45 s in descent-2; raised after the R3 sweep showed sound flights timing out a second from touchdown).

**Lockstep.**
- Each lane's simulation advances only once its answer arrives. Live, the
  shared view moves on when every lane has answered and shows which lane it
  is waiting for. A replay plays all lanes in sync, at the same simulated
  time.

**Failures.**
- A timeout or transient error is retried with backoff, up to 3 times. If all
  3 fail, the lane repeats its last manoeuvre, and that decision counts as
  unanswered.
- A fatal error (quota, auth, not configured) stops the lane. Its remaining
  levels count as not flown, which is reported apart from crashes, and the
  arena carries on.

**Prompts.**
- System One models get one `choice` question with 35 options, each described
  in words: "tilt 15° right, throttle 3 of 4".
- The chat lane gets the same menu in a chat prompt and answers with a JSON object
  naming the option.
- Every lane receives the same observation, tuned per lane in a small sweep,
  as now.

**Autopilot.**
- Rehearses one second of the real-time arena's continuous controller, which
  landed 99% at 5 Hz, and picks the manoeuvre that ends nearest to it. The
  rehearsal holds the current wind steady, so it doesn't see the wind ahead.
- Measured over 100 courses: 97% landed, mean quality 42, 35 decisions per
  level.
- It is the no-model reference and the source of labels for Laya.

**Recording v2.**
- Per decision: the state hash, the option picked, the probabilities over the
  menu (4 decimals), the latency, the token usage, any error, and the retry
  count.
- About 200 decisions per lane per course, so a recording is small.

**Benchmark.**
- `pnpm bench` flies the 20 courses for every lane from Node, with no
  browser, and writes one recording per course plus a results file.
- Lanes run side by side; each lane flies its courses one at a time (parallel requests to a local model were measured and do not pay, docs/lanes.md). A course is saved only when complete and replays to its recorded state hashes; an interrupted run resumes.
- Measured figures are labelled as measured, and prices as vendor or
  third-party, as now.

**Budget estimate.**
- About 5,600 decisions per lane for the 20 courses, at the autopilot's 35 per
  level. Models that fly slower or longer use more, up to the 60 s limit.
- Jev costs about $0.22 on f1, from the third-party price (measured tokens).
- Clef-flash on f1 uses about 2.9 neurons per decision at the vendor's
  rates, about 2 days of the free 10,000-neuron daily allowance, which it
  has to itself: the chat lane runs locally (decided 2026-10-30, after the
  R3 sweep ran the allowance out with two Workers AI lanes).
- Laya, Gemma (local) and the autopilot cost nothing. Gemma answers in ~6 s,
  so its benchmark runs about 10 hours.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| R0 | Tag `v0-realtime`; remove the real-time loop and the showcase | Done 2026-10-30. Tag is local; pushed only when you say. |
| R1 | Engine `descent-2`: manoeuvre menu, 1 s decisions, 8-level courses, landing-quality metrics | Done 2026-10-30: 98% landed on 20 courses, 97% on 100. `node packages/engine/scripts/balance.ts 100` |
| R2 | Decision layer: menu prompts for System One and chat models, lockstep runner, failure rules | Done 2026-10-30: 106 tests pass, and each lane flew level 1 of course 42 in a probe (below). `pnpm probe --lane <id>` |
| R3 | Small prompt sweep per lane on the menu | Done 2026-10-30 on held-out course 1001: Jev and Clef-flash fly f1, the chat lane c3 (now Gemma 4 12B, local). Clef-flash f2 and m2 not flown (daily quota). Results in `docs/lanes.md`. |
| R4 | Laya retrained on menu labels (Colab) | Done 2026-10-30: the bridge serves `laya-descent-v4-mlx` on f3 (v3 plus one DAgger round), frozen for the benchmark. Held-out accuracy 0.187 → 0.891; probe on courses 1001 and 1002 landed 14/16 (v3: 12/16, v2: 0/16). `pnpm laya-dataset`, `pnpm laya-dagger`, results in docs/lanes.md. |
| R5 | `pnpm bench`: 20 courses, recording v2, results with spread | Results table in the docs, with every figure labelled. Courses 5001–5020 (unseen by every lane). Built 2026-10-30; resumable, one recording per lane and course in `bench/`, each checked by replay. |
| R6 | New UI: shared course, trails, lane panels, confidence timeline, results table, replay player | A replay matches its recording on every lane. Works on desktop and mobile. |
| R7 | Cloudflare Pages and a rate-limited Worker (was M6) | Public page serves replays without a key. |
| R8 | README with results, a GIF and setup (was M7) | |

## R2 probe: level 1 of course 42 (measured 2026-10-30)

One level per lane, with each lane's starting prompt, through the same
runner the benchmark will use. One level is a smoke test, not a result.
Latency is measured from this Mac; tokens are provider-reported; costs use
each lane's catalog price, scaled to the benchmark's ~5,600 decisions.

| Lane | Prompt | Outcome | Decisions | Same pick as autopilot | Mean top probability | p50 latency | Tokens in per decision | Benchmark cost |
|---|---|---|---|---|---|---|---|---|
| Autopilot | – | Landed, quality 42.5 | 32 | 100% | – | 0 ms | – | $0 |
| Jev | m2 | Landed, quality 40.7 | 33 | 18% | 59% | 209 ms | 2,805 | ~$0.66 (third-party price) |
| Clef-flash | m2 | Timed out at 45 s | 45 | 16% | 9% | 1,110 ms | 2,754 | ~$0.59 (vendor price) |
| Qwen3 30B | c2 | Landed, quality 63.4 | 43 | 33% | – (picks only) | 473 ms | 1,405 | ~$0.47 (vendor price) |
| Laya v2 | m3 | Crashed into terrain at 10 s | 11 | 0% | 11% | 121 ms | 337 | $0 |

What it shows, for R3 and R4:
- Every lane answered every decision. Qwen once wrote a broken quote and
  needed all three retries; the other lanes never retried.
- The prompts are longer than the budget assumed: m2 lists 35 options with
  their coaching ranges. Jev's benchmark estimate rises from ~$0.20 to
  ~$0.66, and Workers AI lanes use more of the daily allowance than the
  2 days estimated. R3 should try shorter wordings.
- Clef-flash spreads its probability almost evenly over the menu (top
  option 9% on average, against 1/35 = 3% for uniform).
- Laya v2 was trained on the old rotate and throttle questions. On the menu
  it always picked L15-T0. R4 retrains it.

