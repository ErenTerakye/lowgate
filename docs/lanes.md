# Lanes and per-lane prompts

Every lane picks one of the 35 manoeuvres on the menu each second (docs/redesign.md). Each model lane flies the prompt that worked best for it in the R3 sweep below. The lane's prompt is `prompt` in `packages/decisions/src/catalog.ts`.

All numbers are **measured** with `pnpm probe` from a MacBook on home broadband. Raw decisions are in `measurements/*-menu-*.jsonl`. Tokens are **provider-reported**. Prices are the **vendor's** for Cloudflare and **third-party** for Jev.

## Lanes

| Lane | Model | Pinned | Price per 1M tokens (in / out) | Prompt |
|---|---|---|---|---|
| Jev | `jev-1.14.0` (TypeSafe) | Yes | $0.042 / free, third-party | f1 |
| Clef-flash | `clef-flash` (Workers AI) | **No**: Cloudflare has no version selector | $0.038 / free, vendor | f1 |
| Gemma 4 12B (chat lane) | `google/gemma-4-12b-qat`, GGUF Q4_0 QAT (7.15 GB), via LM Studio on this Mac, thinking off | Yes: LM Studio key plus this build | none (local) | c3 |
| Laya | `laya-descent-v2-mlx` via `bridge/laya` on this Mac | Yes: the bridge reports the checkpoint | none (local) | m3, until R4 retrains it |
| Autopilot | none: rehearses one second of a simple controller | – | none | – |

## Menu prompts

System One prompts (`PROMPTS` in `questions.ts`). Sizes are characters of observation plus question text on course 42, level 1.

| Prompt | Shape | What it says | Size |
|---|---|---|---|
| m1 | One choice, 35 options | Each option describes its manoeuvre | 2,545 |
| m2 | One choice, 35 options | m1 plus, per option, the coaching readings it fits | 6,248 |
| m3 | One choice, 35 options | Brief observation, a few words per option (Laya's 512-token context) | 926 |
| m4 | One choice, 35 options | m2's coaching in fewer words, compact observation | 3,786 |
| f1 | Tilt choice (7) and throttle score (5) | Each tilt names its 'good tilt now' range; each throttle level quotes the vertical-speed phrase. Probabilities are multiplied back into the 35 | 1,649 |
| f2 | Tilt choice and throttle choice | f1 with throttle as a choice | 1,655 |

Split prompts still fly one manoeuvre from the same menu: P(manoeuvre) = P(tilt) × P(throttle), so the pick is the most likely tilt with the most likely throttle, and the bars still cover all 35.

Chat prompts (`LLM_PROMPTS` in `llm.ts`), all with a 64-token output cap and thinking off:

| Prompt | What it says | Size |
|---|---|---|
| c1 | The menu and the JSON format | 2,783 |
| c2 | m2's rules as two lookups (tilt part, throttle), the menu, and a reply that copies the good tilt and the vertical phrase before the key | 3,437 |
| c3 | c2 without the menu listing and without the observation's fixed rules; the quoted tilt must be a number | 1,583 |

## R3 sweep: course 1001, all 8 levels (2026-10-30)

Course 1001 is held out: the benchmark will use other courses, so prompts are not tuned on the courses that score them. One course is 8 levels, so a difference of one or two landings is within noise.

| Lane | Prompt | Landed | Mean quality | Same pick as autopilot (tilt / throttle) | Mean top probability | Tokens in per decision | p50 latency | Benchmark cost |
|---|---|---|---|---|---|---|---|---|
| Autopilot | – | 8/8 | 39.6 | 100% | – | – | 0 ms | $0 |
| Jev | m2 | 4/8 | 44.4 | 41% (66% / 60%) | 65% | 2,805 | 213 ms | ~$0.66 |
| Jev | m4 | 5/8 | 44.2 | 38% (67% / 55%) | 62% | 2,075 | 210 ms | ~$0.49 |
| Jev | **f1** | **6/8** | 46.3 | 41% (67% / 56%) | 79% | 939 | 203 ms | **~$0.22** |
| Clef-flash | m4 | 0/5, then stopped by quota | – | 24% (34% / 62%) | 11% | 2,022 | 693 ms | ~$0.43 |
| Clef-flash | **f1** | **1/8** | 57.9 | 23% (32% / 72%) | **29%** | 833 | 699 ms | **~$0.18** |
| Clef-flash | f2, m2 | not flown: daily quota | | | | | | |
| Qwen3 30B | c2 | 1/8 | 54.2 | 28% (53% / 47%) | – (picks only) | 1,411 | 449 ms | ~$0.48 |
| Qwen3 30B | **c3** | **1/8** | 56.5 | 36% (63% / 53%) | – | 591 | 431 ms | **~$0.24** |

Benchmark cost is the measured cost per decision times ~5,600 decisions, at the catalog price. The autopilot row is the same course with no model.

What it shows:

- **Splitting the question is cheaper and no worse.** f1 is a third of m2's input for Jev and Clef-flash. Jev landed 6/8 on f1 against 4/8 on m2; Clef-flash's top option rose from 9–11% to 29%. Jev's benchmark cost is back at the ~$0.20 the budget assumed.
- **Qwen does as well without the menu listing.** c3 lands the same 1/8 as c2 at 42% of the input, and its reply never broke (c2 needed 3 retries on 310 decisions).
- **Most failures are timeouts, and many are nearly landings.** Replaying the picks: Jev's two f1 timeouts ended 3–4 m above the pad, 2–4 m off centre, descending; Clef-flash's ended within 25 m of the pad, three of them within 5 m of its height. The 45 s level limit comes from the real-time game, where the autopilot took ~35 s. Slower but sound flying is scored as a failure.
- **Qwen flies away from the pad.** Four of its eight c3 levels ended out of bounds at 7–12 m/s, heading away; its tilt matches the autopilot's 63% of the time. That is a judgment result, not a prompt bug, but the next tuning step for it.
- **The Workers AI free allowance ran out mid-sweep.** The 10,000 free neurons a day (reset 00:00 UTC) are shared by Clef-flash and Qwen. They ran out after about 1,140 sweep decisions, most of them on the long m4 and c2 prompts. At the vendor's rates (Clef-flash 3,455 neurons per million input tokens; Qwen3 4,625 in, 30,475 out) the sweep and the R2 probes come to about 6,700 neurons, so some of the day's allowance had gone earlier or the rates are not the whole story; the stop itself is the measured fact.
- **Budget with f1, from the vendor's rates (estimated, not measured):** about 2.9 neurons per Clef-flash decision, so the free allowance covers about 3,400 of its decisions a day and its ~5,600-decision benchmark takes about 2 days, if Clef-flash has the allowance to itself. Qwen moves to a local model for that reason (below).

Every number in this section was measured on engine descent-2. Engine descent-3 (60 s level limit, decided after this sweep) changes the courses, so the prompt choices carry over but these figures are not comparable with later runs.

## Local chat lane (2026-10-30, engine descent-3)

The R3 sweep ran the Workers AI allowance out with two lanes on it, so the chat lane moved to this Mac, leaving the allowance to Clef-flash. Candidates were the chat models already installed in LM Studio that fit in 16 GB: Qwen3.5 9B (MLX 4-bit, 5.98 GB) and Gemma 4 12B (QAT Q4_0, 7.15 GB). Both fly c3 through LM Studio's OpenAI-compatible server (`lms server start`).

**Thinking off.** LM Studio ignores `chat_template_kwargs.enable_thinking` for both models. Gemma then reasoned until the 64-token cap and never answered (0 of 54 decisions). Of the four switches tried, only `reasoning_effort: "none"` worked for both; it is the local lanes' `requestExtras`.

Held-out courses 1001 and 1002, all 8 levels each, engine descent-3, thinking off:

| Lane | Course | Landed | Mean quality | Same pick as autopilot (tilt / throttle) | Answered | p50 latency | Tokens in / out |
|---|---|---|---|---|---|---|---|
| Autopilot | 1001 | 8/8 | 41.4 | 100% | – | 0 ms | – |
| Autopilot | 1002 | 8/8 | 43.3 | 100% | – | 0 ms | – |
| **Gemma 4 12B** | 1001 | **8/8** | 54.5 | 36% (62% / 53%) | 318/318, no retries | 6,153 ms | 603 / 38 |
| **Gemma 4 12B** | 1002 | **8/8** | 38.6 | 39% (62% / 58%) | 299/299, no retries | 6,171 ms | 602 / 38 |
| Qwen3.5 9B | 1001 | 0/8, all out of bounds | – | 17% (35% / 25%) | 116/116 | 4,957 ms | 608 / 28 |

Gemma landed all 16 levels while agreeing with the autopilot's picks only 36–39% of the time: it flies its own way, not a copy. Its landing quality swings more than the autopilot's (54.5 then 38.6, against 41.4 and 43.3; 46.6 against 42.4 over both), so on quality the two courses do not separate them. Qwen3.5 picks a narrow set (13 of 35 manoeuvres) and flies off the course within 6–24 s. Gemma is the chat lane. At ~6 s a decision its ~5,600 benchmark decisions take about 10 hours on this Mac, which suits an offline overnight run. Qwen3 30B on Workers AI stays in the catalog but leaves the roster.

## Archive: real-time arena prompts (2026-10-29, tag v0-realtime)

These prompts asked rotate and throttle five times a second. They were removed in R2; the code is under the `v0-realtime` tag.

Every model lane reads the same observation (tier 4, `observe()` in `packages/decisions/src/observe.ts`). Each lane then flies the prompt that worked best for it in a sweep of the same kind: about 30 autopilot states per prompt, then two levels closed loop for the best one. The lane's prompt is `prompt` in `packages/decisions/src/catalog.ts`, and every result below names it.

All numbers are **measured** with `pnpm probe` from a MacBook on home broadband. Raw calls are in `measurements/`. Prices are the **vendor's** for Cloudflare and **third-party** for Jev.

## Lanes

| Lane | Model | Pinned | Price per 1M tokens (in / out) | Prompt |
|---|---|---|---|---|
| Jev | `jev-1.14.0` (TypeSafe) | Yes | $0.042 / free, third-party | p5 |
| Clef-flash | `clef-flash` (Workers AI) | **No**: Cloudflare has no version selector; responses report `clef-flash` | $0.038 / free, vendor | p7 |
| Llama 3.1 8B | `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (Workers AI) | Yes, by id | $0.045 / $0.384, vendor | l3 |
| Laya | `laya-descent-v2-mlx`, fine-tuned from `aac6fef/laya-mlx`, via `bridge/laya` on this Mac | Yes: the bridge reports the checkpoint it loaded | none (local) | p8 (trained on it) |

## Prompts

System One prompts (`PROMPTS` in `questions.ts`) pair an observation tier with question wording; p1–p5 are described in docs/prompt-tuning.md. New in this round:

| Prompt | What changes |
|---|---|
| p6 | p5 with throttle asked as a `choice` instead of a `score` |
| p7 | p5 with each throttle level quoting the observation's own phrase ("up to 3 m/s too much downward") instead of rephrasing it ("descending too fast") |
| p8 | Brief observation (velocity, angle, height above ground, the three coaching lines) with p7's levels cut to a few words. For Laya, whose time per answer grows with input length: 348 tokens instead of 814 |

Chat prompts (`LLM_PROMPTS` in `llm.ts`) pair the tier-4 observation with a system message:

| Prompt | What changes |
|---|---|
| l1 | Goal and JSON format only |
| l2 | l1 plus the reading rules System One lanes get in their answer options (p5 rotate, p7 throttle) |
| l3 | l2's rules, and the reply first copies the two coaching phrases, then gives the action: `{"tilt", "vertical", "rotate", "throttle"}` |

## Sweep: answers on 30 autopilot states (seed 42)

| Lane | Prompt | Tokens in / out | Latency p50 / p95 | Rotate agrees | Throttle agrees | Throttle follows (r) |
|---|---|---|---|---|---|---|
| Jev | p5 | 836 / 0 | 212 / 361 ms | 77 % | 63 % | **0.71** |
| Jev | p6 | 870 / 89 | 209 / 303 ms | 77 % | 63 % | 0.74 |
| Jev | p7 | 829 / 54 | 201 / 273 ms | 77 % | 67 % | 0.64 |
| Clef-flash | p1 | 594 / 0 | 819 / 3390 ms | 30 % | 13 % | −0.10 |
| Clef-flash | p2 | 768 / 0 | 903 / 4285 ms | 20 % | 53 % | −0.04 |
| Clef-flash | p3 | 676 / 0 | 1086 / 3089 ms | 17 % | 55 % | 0.18 |
| Clef-flash | p4 | 812 / 0 | 880 / 3237 ms | 19 % | 59 % | 0.35 |
| Clef-flash | p5 | 715 / 0 | 640 / 2551 ms | 73 % | 47 % | 0.36 |
| Clef-flash | p6 | 715 / 0 | 1210 / 3256 ms | 76 % | 48 % | 0.40 |
| Clef-flash | **p7** | 708 / 0 | 926 / 2210 ms | 73 % | 57 % | **0.51** |
| Llama | l1 | 425 / 14 | 295 / 679 ms | 37 % | 43 % | −0.39 |
| Llama | l2 | 545 / 14 | 325 / 1112 ms | **77 %** | 57 % | 0.21 |
| Llama | **l3** | 561 / 31 | 394 / 551 ms | 63 % | 60 % | **0.77** |

Jev's output tokens on p6 and p7 are reported but free. "Follows (r)" for Llama uses its pick; it gives no probabilities. Jev stays on p5: p6 is within noise and p7 is lower on r.

What moved each lane:

- **Clef-flash** kept rotation at about 73 % from p5 on, but its throttle stayed near Medium whatever the state (expected level 1.6–2.2). Asking throttle as a choice (p6) barely helped. Quoting the observation's own words in each level (p7) did: r rose from 0.36 to 0.51.
- **Llama** needed the rules spelled out to steer (l2: rotation 37 % → 77 %), but still picked Medium for throttle. Making it copy the vertical-speed phrase before answering (l3) took throttle r from 0.21 to 0.77, the best of any lane, at the cost of some rotation and ~17 more output tokens.

## Closed-loop flights, two levels, no deadline

| Lane | Prompt | Level 1 | Level 2 |
|---|---|---|---|
| Jev | p5 | **Landed**, 34.6 s, vy −1.6 m/s | **Landed**, 38.1 s, vy −1.0 |
| Jev | p2 | Timed out, hovering | — |
| Clef-flash | p5 | Timed out, hovering | Timed out, hovering |
| Clef-flash | **p7** | **Landed**, 35.2 s, vy −1.1, angle 5° | **Landed**, 40.1 s, vy −1.2, angle −4° |
| Llama | l1 | Out of bounds, 17.6 s | Out of bounds, 13.9 s |
| Llama | **l3** | **Landed**, 33.8 s, vy −1.0 | **Landed**, 34.2 s, vy −0.7 |

With time to think, all three models land both levels on their own prompt. Clef-flash returned 7 HTTP 429 "Capacity temporarily exceeded" (code 3040) and 1 timeout in 378 calls on p7; the lane retries those.

## Live in the arena (5 Hz, 200 ms deadline, 90 s of course 42)

| Lane | Answers per second | Latency p50 / p95 | Missed ticks | Levels landed / failed | Points | $ per hour at that pace | $ per 1k decisions |
|---|---|---|---|---|---|---|---|
| Jev (p5) | 2.7 | 208 / 250 ms | 44 % | **2 / 0** | 283 | ≈$0.34 | ≈$0.035 |
| Clef-flash (p7) | 1.4 | 444 / 802 ms | 71 % | 0 / 2 | 0 | $0.14 | $0.027 |
| Llama (l3) | 1.8 | 394 / 530 ms | 60 % | 0 / 2 | 0 | $0.27 | $0.039 |
| Autopilot | 4.8 | instant | 0 | 2 / 0 | 289 | free | free |

Live, latency decides. Clef-flash and Llama land when the world waits for them, but at 2–4 ticks per answer they act on stale states and crash. Jev answers in about one tick and nearly matches the autopilot. One earlier live run of Jev on p5 crashed level 1, so a single run is not a ranking; replays (milestone 5) will let us fly many seeds.

## Is the Workers AI free tier enough?

Workers AI bills $0.011 per 1,000 neurons, with 10,000 free a day. From the measured tokens: Clef-flash on p7 ≈ 2.5 neurons per call; Llama on l3 ≈ 3.4 (its quoted reply costs more output).

- **Public 60-second live run**, both Cloudflare lanes at their live pace (≈ 85 + 110 calls): ≈ 580 neurons, so **about 17 runs a day**. The Phase 1 estimate was 25.
- **Recording a 5-minute run** of both: ≈ 2,900 neurons, so about 3 a day.

Today's experiments used roughly 5,800 neurons, within one day's free allowance, and about $0.06 of Jev credit in total.

## Laya

`bridge/laya/server.py` serves a Laya MLX checkpoint at `127.0.0.1:8765/v1/systemone`, and the arena reaches it through the same proxy route (`?lanes=laya,...`). Setup, in a venv the repo ignores (laya-mlx needs Python 3.11+ on Apple silicon; the base checkpoint is about 843 MB):

```bash
python3.14 -m venv bridge/laya/.venv
bridge/laya/.venv/bin/pip install -r bridge/laya/requirements.txt
bridge/laya/.venv/bin/python bridge/laya/server.py
```

**Base Laya (`aac6fef/laya-mlx`, laya-mlx 0.6.0), p5, 30 autopilot states, measured on an M3 with 16 GB:** rotation agrees 40 %, throttle 53 % with r = 0.04, top probability 37 % (rotate) and 28 % (throttle): close to guessing, as the model card says. p50 259 ms, p95 314 ms. Laya scores each question in its own encoder pass (state plus question, ~800 tokens in all), and the package caches only the tokenized questions, so this M3 cannot answer inside a 200 ms tick; the card's 13 ms was an M3 Max. Inputs are not truncated: the state is ~300 tokens and each question is encoded beside it.

### Fine-tuning

The MLX port runs Laya but cannot train it; training is the upstream PyTorch package (`laya` 0.4.17, `laya.train.finetune`).

1. `pnpm laya-dataset --prompt <id>` writes `bridge/laya/data/<id>/train.jsonl` (10,852 states from courses 1000–1119) and `eval.jsonl` (1,087 from courses 9000–9011); the default is p8. Each state comes from an autopilot flight with noise, so recoveries are covered, and is labelled with the clean autopilot action (rotation 0.9 on the pick, throttle 0.8 with the rest on the neighbouring levels). Course 42 is in neither.
2. `bridge/laya/finetune_colab.ipynb` (set `VERSION` in its first cell) fine-tunes the full model on a Colab GPU (3 epochs, effective batch 32, `max_len` 512) and reports held-out before/after accuracy.
3. Back on the Mac: unzip into `bridge/laya/models/<VERSION>`, then `bridge/laya/.venv/bin/laya-mlx convert --model bridge/laya/models/<VERSION> --output bridge/laya/models/<VERSION>-mlx`. `server.py` serves `laya-descent-v2-mlx` by default when it exists.

### Results: `laya-descent-v1` (2026-10-29)

Trained on a Colab A100 (40 GB) in **21.6 min**: laya 0.4.17, torch 2.11, 3 epochs, 1,998 optimizer updates, effective batch 32, full model. Each row gives two items (rotate and throttle), hence 21,304 training items; 400 held back for calibration (fitted temperatures: choice 1.05, score 1.15).

Held-out courses (`eval.jsonl`, 2,174 items), from laya.train's report:

| | Accuracy | Loss | ECE | Brier |
|---|---|---|---|---|
| Base | 0.354 | 1.287 | 0.075 | 0.451 |
| **Fine-tuned** | **0.953** | 0.575 | 0.142 | 0.045 |

ECE rose because the labels are smoothed (the pick is 0.8–0.9, never 1.0), so a model that has learnt them looks under-confident when it is right.

Measured in the arena's own tests, course 42 (which it never saw), same as every other lane:

| Test | Base Laya | Fine-tuned Laya |
|---|---|---|
| Sweep, 30 states: rotate agrees | 40 % | **100 %** |
| Sweep: throttle agrees / follows (r) | 53 % / 0.04 | **97 % / 0.97** |
| Sweep: top probability, rotate / throttle | 37 % / 28 % | 89 % / 74 % |
| Sweep: latency p50 / p95 | 259 / 314 ms | 281 / 296 ms |
| Closed loop, no deadline | — | **Landed both**: 30.7 s (vy −1.5, angle 0°) and 36.4 s (vy −1.8, angle 0°), fastest of any lane |
| Live, 90 s with Jev and Autopilot | — | 1 landed / 1 failed, 141 points, 51 % missed, p50 289 ms |

In the same live run Jev landed 2 / 0 (283 points) and Autopilot 289. Laya now makes the best decisions of any model lane, but at ~280 ms per answer on this M3 it misses half its ticks and acts on stale states, as the Cloudflare lanes do. Ways to close the gap, not yet tried: a shorter state (it is ~300 tokens and both questions re-encode it), the `parallel` option layout that scores both questions in one pass (needs retraining with `TrainConfig(option_layout="parallel")`), or recording on a faster Mac. A second round on states from Laya's own flights (DAgger) would harden it further.


## Replacing Llama 3.1 8B? Candidates tested 2026-10-29

`@cf/meta/llama-3.1-8b-instruct-fp8-fast` is no longer listed in Cloudflare's model catalog (its model page returns 404), though it is still priced and still answers. Three newer, fast, free-tier models were given the same tests on Llama's prompts. They are lanes in `catalog.ts` (`gemma`, `glm`, `qwen`).

All three think before answering by default and spent the whole 64-token budget on it. `chat_template_kwargs: {enable_thinking: false}` (the lane's `requestExtras`) turns that off; `reasoning_effort` and `thinking: {type: "disabled"}` did not. With thinking off, Workers AI still returns Qwen3's reply in `reasoning_content`, so the parser reads that when `content` is empty.

| Lane | Model | Released | Prompt | Tokens in / out | Latency p50 / p95 | Rotate agrees | Throttle agrees | Throttle follows (r) | Errors in 30 |
|---|---|---|---|---|---|---|---|---|---|
| Llama (now) | `llama-3.1-8b-instruct-fp8-fast` | 2024-07 | l3 | 561 / 31 | 394 / 551 ms | 63 % | 60 % | 0.77 | 0 |
| Gemma 4 26B | `gemma-4-26b-a4b-it` | 2026-04 | l3 | 586 / 33 | 1125 / 2291 ms | 37 % | 52 % | 0.77 | 3 |
| | | | l2 | 570 / 13 | 656 / 2455 ms | 58 % | 62 % | 0.40 | 4 |
| GLM 4.7 Flash | `glm-4.7-flash` | 2026-02 | l3 | 533 / 32 | 793 / 1872 ms | 29 % | 71 % | 0.48 | 2 |
| | | | l2 | 516 / 14 | 565 / 1448 ms | 75 % | 68 % | 0.24 | 2 |
| Qwen3 30B | `qwen3-30b-a3b-fp8` | 2025-04 | **l3** | 562 / 32 | 444 / 1997 ms | **77 %** | 70 % | **0.80** | 0 |
| | | | l2 | 546 / 14 | 381 / 578 ms | 77 % | 60 % | −0.15 | 0 |

Gemma and GLM were slower than Llama on every prompt and weaker on at least one control, so only Qwen3 was flown.

- **Closed loop, no deadline (Qwen3, l3):** level 1 **landed**, 34.5 s, vy −1.1, angle 0°; level 2 timed out hovering, picking Low where the autopilot wanted Off. 398/398 calls answered. Llama on l3 landed both.
- **Live, 90 s of course 42, one run:**

| Lane | Answers per second | Latency p50 / p95 | Missed ticks | Landed / failed | Points | $ per hour | $ per 1k decisions |
|---|---|---|---|---|---|---|---|
| Llama (l3) | 1.9 | 395 / 598 ms | 61 % | 1 / 2 | 146 | $0.26 | $0.038 |
| Qwen3 (l3) | 1.6 | 456 / 687 ms | 67 % | 0 / 1 | 0 | $0.24 | $0.041 |
| Jev (p5) | 2.6 | 207 / 286 ms | 46 % | 1 / 1 | 145 | ≈$0.34 | ≈$0.035 |
| Autopilot | 4.8 | instant | 0 | 2 / 0 | 289 | free | free |

Llama landed a level live this time (0 / 2 in the earlier run) and Jev crashed one, so single live runs swing by a level either way; replays over many seeds will settle rankings.

Free allowance per call, from the measured tokens: Qwen3 ≈ 3.6 neurons, Llama ≈ 3.4, GLM ≈ 4.1, Gemma ≈ 7 (Cloudflare reported 7.2).

**Verdict.** None of the candidates is faster than Llama, and no LLM tested on Workers AI answers inside a 200 ms tick. Qwen3 30B is the best replacement: in the catalog, the best answers of any chat lane (rotation 77 %, throttle r 0.80), and about the same cost, though it landed one fewer level closed loop than Llama in one flight. Gemma 4, the newest, needs about three times Llama's time per answer.

The arena's default lanes are now `jev,clef,qwen,autopilot`. Llama, Gemma and GLM stay in the catalog and can be added with `?lanes=`.

### Speed: why v2 trains on p8

Time per answer on this M3, fine-tuned model, 40 states each (the model's own time, without the bridge):

| Input | Tokens | p50 |
|---|---|---|
| p5, full observation (v1) | 814 | 284 ms |
| Full questions, state cut to 5 lines | 396 | 138 ms |
| Short questions, full state | 702 | 239 ms |
| **p8** (6 state lines, short questions) | **348** | **137 ms** |
| p8 without the velocity line and the "Read ..." pointers | 297 | 111 ms |

Time grows by about 0.4 ms per token; float16 and bfloat16 are the same. laya-mlx already scores both questions in one batched pass, and the `parallel` option layout only makes answers independent of option order, so input length is the lever. p8 keeps the velocity line and the pointers for ~25 ms because it stays ~60 ms inside the 200 ms tick. `laya-descent-v2` is trained on p8 with the same states and labels as v1, so the two compare directly.

### Results: `laya-descent-v2` on p8 (2026-10-29)

Trained exactly as v1 (same states, labels, settings) but on p8, on a Colab A100 in **14.9 min** (v1: 21.6). Fitted temperatures: choice 1.09, score 1.16.

| | Held-out accuracy | Loss | ECE | Brier |
|---|---|---|---|---|
| v1 (p5) | 0.953 | 0.575 | 0.142 | 0.045 |
| **v2 (p8)** | 0.941 | 0.604 | 0.140 | 0.060 |

The base model scores 0.223 on p8 (0.354 on p5): the short text gives an untrained Laya less to go on, but after training the gap is about one point.

On course 42, same tests as every lane:

| Test | v1 on p5 | **v2 on p8** |
|---|---|---|
| Sweep: rotate agrees | 100 % | 100 % |
| Sweep: throttle agrees / follows (r) | 97 % / 0.97 | 93 % / 0.95 |
| Sweep: latency p50 / p95 (through the bridge) | 281 / 296 ms | **126 / 176 ms** |
| Closed loop, no deadline | Landed both, 30.7 s and 36.4 s | Landed both, 30.8 s (vy −1.8) and 36.3 s (vy −1.6) |
| Live, 90 s with Jev and Autopilot | 1 / 1, 141 points, 51 % missed | **2 / 0, 291 points, 1 % missed** (4 ticks), p50 136 ms |

In v2's live run Jev landed 1 / 1 (139 points, 47 % missed, p50 214 ms) and Autopilot scored 289. Laya v2 is the first model lane to keep up with the 5 Hz tick: it decides 4.8 times a second, as often as the autopilot, and it scored two points more than the autopilot's rule it was trained to copy. One live run, so this is a result, not yet a ranking; replays over many seeds come next. v2 is the Laya lane from now on; v1 stays on disk for comparison.

