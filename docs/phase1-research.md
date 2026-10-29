# Decision Arena — Phase 1 research

_Researched 2026-10-29. "Docs" = vendor's official documentation; "3rd-party" = news/aggregator, unverified. Every number here gets re-measured in Phase 2._

## 1. Lane verification

| Lane | Endpoint / runtime | Model ID to pin | Price (input; output free) | Free quota | Limits | Source quality |
|---|---|---|---|---|---|---|
| **Jev** (TypeSafe) | `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer` | `jev-1.14.0` (stable since 14 Oct). `jev-1.13.0` still pinnable. `jev-latest`/`jev-preview` are aliases | $0.042 / 1M | **None confirmed.** The $5 credit is disputed, and Oct reports say no credit | Choice 1–255 options, score 1–10 levels. Published defaults (3rd-party): 1,200 RPM, 64K tokens per request | Endpoint and schema from docs. Limits and price from 3rd-party |
| **Clef-flash** (Cloudflare) | Workers AI binding `env.AI.run("@cf/cloudflare/clef-flash", …)` or REST. Body `model: "clef-flash"` | `@cf/cloudflare/clef-flash` | $0.038 / 1M = **3,455 neurons / 1M** | 10,000 neurons/day (shared by all Workers AI models) | 1–64 questions, **24,576-token** hosted context | Docs |
| **Laya** (local, MLX) | `pip install laya-mlx` → `laya_mlx.load(...).predict(state, questions)`. No HTTP server in the MLX port | `aac6fef/laya-mlx` (EN, 421M, 512 ctx, ~843 MB) or `aac6fef/laya-multilingual-mlx` (322M, 1,024 ctx, 644 MB) | $0 | n/a | Small context | HF model card (docs); latency is 3rd-party |
| **Kev** (optional 5th) | Self-host (System One-compatible server) or OpenRouter | `jaredpalmer/kev-4b` (also 0.8B / 9B) | $0.042 / 1M on OpenRouter | None | 8K context on OpenRouter | OpenRouter page; rest 3rd-party |
| **LLM baseline** | Workers AI `@cf/meta/llama-3.1-8b-instruct-fp8-fast`, JSON output | same | $0.045 in / $0.384 out per 1M (4,119 / 34,868 neurons) | Same 10k neurons/day | 300 RPM | Docs |
| OpenAI Decisions | `POST /v1/decisions`, `gpt-6-luna` | — | Reported $0.10 / 1M; not confirmed on OpenAI pages | **No API free tier** | — | 3rd-party only → **skip** |

### Where your notes differ

| Your note | Finding |
|---|---|
| Jev 1.13 | Current stable is **1.14.0** (14 Oct). Pricing and limits are unchanged. 1.14 adds opt-in images and 262K-context headers. |
| Up to 64 questions | Docs for **Clef** say 1–64. TypeSafe's schema states only a minimum of 1. |
| choice 2–255 / score 2–10 | The schema says **1**–255 and **1**–10. In practice we use ≥2. |
| New accounts get $5 | **Disputed.** Several Oct 2026 reports say there is no credit. Assume Jev costs real (tiny) money. |
| Free Jev on OpenCode Zen | **Not found.** The official Zen free list has Big Pickle, DeepSeek V4 Flash Free and others, no Jev. Treat as false. The only other free route reported is Vercel AI Gateway's monthly credit (one source). |
| Jev on OpenRouter | Not verified. Clef-flash and Kev-4B are on OpenRouter. AIML API serves `typesafe/jev` at $0.0578/M. |
| Flash changed 9 Oct | **Confirmed.** $0.09 → $0.038 / 1M, hosted context 64K → 24,576. Clef-omni launched the same day ($0.15/M, multimodal). |
| REST wrapped under `result` | This is the standard Cloudflare REST envelope. The Worker **binding** returns the bare object. Confirm in milestone 2. |
| Laya: tens of ms | P50 13.4 ms (EN) / 7.4 ms (multilingual), measured on an **M3 Max**. Expect slower on a base M3; we'll measure. |
| — (new) | **Laya base is near-random zero-shot** (~0.36 vs 0.318 random, 3rd-party). The model card calls it "a fast base to specialise". Raw probabilities are poorly calibrated. This drives question 3 below. |
| — (new) | **Groq / Gemini free tiers are too slow for real time** (Groq ~30 RPM, Gemini Flash-Lite ~15 RPM). That's 0.25–0.5 decisions/s at best. Workers AI (300 RPM) is the only free LLM that keeps up. |

## 2. Prior art (what to avoid duplicating)

| Project | Game | Lanes | Cost meter | Replays | Public link |
|---|---|---|---|---|---|
| laya-vs-jev (virajbhartiya, 111★) | T-Rex | Laya MLX vs Jev | No | JSONL → MP4 | No (local) |
| dwmkerr/spaceinvaders#37 | Space Invaders, Connect Four | Jev vs Claude Sonnet | **Yes** (spend ledger) | No | No |
| UFA bake-off (13rac1) | Space Invaders | Jev, Haiku 4.5, Qwen 27B, scripted autopilot, FIRE/random floors | Per decision | Seeds + results.json | Static page |
| laya-mlx demo | Snake | Laya only | No | Video | No |
| madewithjev "games" (83 builds) | Tetris, chess, Pong (Jev vs LLMs), Doom, Mario, Pokémon, Contra (Jev vs MS Decision-1), Subway Surfers, driving sims… | Mostly Jev alone | Some | Rare | Some |

**Takeaways**
- "Jev vs an LLM with a cost meter" **has been done**. So have T-Rex, Space Invaders, Snake, Tetris and Pong. On their own, the LLM lane and the cost meter are not differentiators.
- What nobody has combined: **four or more heterogeneous providers** (closed hosted, open on Cloudflare, local MLX, and an LLM) on **one seeded course**. Add **measured-vs-vendor labels**, **$ per 1,000 decisions**, and a **public, keyless replay player**.
- UFA's honest finding: a scripted autopilot beat every model, and "hold FIRE" tied Jev. Steal that framing. Ship a **scripted autopilot lane and a random lane** ($0) as reference floor and ceiling, so the results table means something.
- UFA showed that the score depends heavily on how much the state is pre-digested. We'll make the serialization tier a config knob and report it.

## 3. Candidate games (none appear in the directories above)

| | **A. "Descent": lunar-lander-style genre** ★ recommended | B. "Cavern": side-scrolling gap flyer | C. "Vault": grid stealth on a clock |
|---|---|---|---|
| Actions | `choice` rotate {left, none, right} **+** `score` throttle 0–4, in one request | `noul` thrust yes/no | `choice` {up, down, left, right, wait} |
| State | ~10 numbers plus derived hints (alt, vx, vy, angle, fuel, pad dx, ground below) | 6–8 numbers | 11×11 ASCII window plus guard vectors (~150 tokens) |
| Decision rate | 5 Hz | 10 Hz minimum | 4 Hz |
| Fit with typed decisions | **Best.** Uses two question types per call; score's ordered levels map naturally to throttle | OK but trivial (one bit) | Good |
| Cost (rate × tokens) | Low–medium | Highest | Medium (bigger state) |
| Watchability | High: lanes descend in parallel; crashes, fuel gauges, near-misses | High but over in seconds; the LLM dies immediately | Medium |
| Effort | Medium (simple 2D rigid-body physics, seeded terrain and wind) | Low | Medium–high (pathing, guards) |
| Risk | Zero-shot control may be poor → mitigated with Tier-2 hints and the autopilot reference | Too binary to show probability bars well | Close to Pac-Man territory |

A 5-minute run of Descent is a sequence of seeded landing levels. Score = safe landings, plus a bonus for fuel left.

## 4. Proposed architecture

```
decision-arena/            pnpm monorepo, TypeScript strict
├─ packages/engine         pure TS, no DOM: seeded PRNG (mulberry32), fixed 60 Hz physics,
│                          5 Hz decision clock, step(state, action) → state, stateHash()
├─ packages/decisions      DecisionClient interface + adapters:
│                          SystemOneClient(baseUrl, model, auth) → Jev | Clef | Kev | Laya-bridge
│                          LlmJsonClient → Workers AI llama, prompts for {"rotate","throttle"}
│                          ScriptedClient (autopilot), RandomClient
│                          Each returns {action, probs|null, latencyMs, usage, error?}
├─ apps/web                Vite + plain TS + Canvas (lanes) + small DOM stats panel
├─ apps/worker             Cloudflare Worker: /decide/:lane proxy, secrets, budgets
├─ bridge/laya             ~60-line FastAPI on laya_mlx exposing POST /v1/systemone on 127.0.0.1
└─ replays/                recorded *.jsonl.gz served statically
```

- **Fairness and timing.** All lanes share the seed. At decision tick *t*, each lane gets its own state *sₜ*. The answer is applied at *t+1*. A late answer means the lane **repeats its last action** and the tick is logged `missed`. A lane never has more than one request in flight. So latency costs score visibly, and slow LLMs are shown honestly instead of being given a paused world.
- **Serialization.** One canonical `observe(state, tier)` produces compact `key: value` lines, with units, in fixed order. Tier 1 = raw, Tier 2 = with derived hints. The same text goes to every model. The LLM additionally gets a fixed JSON-schema instruction. We assert the token count stays under 512 (Laya EN limit).
- **Secrets.** The browser never holds keys. The Worker uses `wrangler secret put TYPESAFE_API_KEY`, and Clef and Llama go through the `AI` binding (no key). Local dev uses `.dev.vars` / `.env`, gitignored, with a committed `.env.example`.
- **Live-mode protection.** A Workers Rate Limiting binding (per IP) plus a daily budget counter in one Durable Object (neurons and Jev $). Turnstile gates "start live run". When the budget is spent or a 429 comes back, the UI auto-switches to replays. The Worker returns `x-upstream-ms`, so we can separate network time from model time.
- **Laya bridge.** Only used while recording on your Mac; the public site plays Laya from replays. It's a localhost server, so the same `SystemOneClient` adapter talks to it.
- **Replay format.** JSONL. Line 1 is a header: `{v, seed, engineVersion, tier, lanes:[{id, provider, model, pinned, pricePerMTok, priceSource}]}`. Then one line per lane decision: `{t, lane, stateHash, probs, action, latencyMs, missed, usage:{in,out}, costUsd, error?}`. Replays **re-simulate** from seed + actions and check `stateHash`, so the files stay small and are tamper-evident.
- **Hosting.** Cloudflare Pages (static site + replays) and one Worker. Both are on the free plan: Workers allows 100k requests/day.

## 5. Estimated cost for a 5-minute run (estimates; to be measured)

Assumptions: ~200 input tokens per decision for System One models (state ~120 + two questions ~80). The LLM uses ~320 in / ~20 out and manages ~1.5 decisions/s (latency-bound). Decision models run at 5 Hz = **1,500 decisions** per run.

| Lane | Decisions | Tokens | Cost / run | $ / 1k decisions | Free-tier impact |
|---|---|---|---|---|---|
| Jev 1.14 | 1,500 | 300K in | **$0.013** | $0.0084 | Paid (no confirmed credit). $1 ≈ 80 runs |
| Clef-flash | 1,500 | 300K in | $0.011 → **~1,040 neurons** | $0.0076 | ~10% of the daily free allowance |
| Laya (local) | 1,500 | 300K (local) | $0 | $0 | — |
| Kev-4B (OpenRouter) | 1,500 | 300K in | $0.013 | $0.0084 | Paid |
| Llama 3.1 8B (Workers AI) | ~450 | 144K in / 9K out | $0.010 → **~910 neurons** | $0.022 | ~9% daily |
| Autopilot / random | 1,500 | — | $0 | $0 | — |

- **Recording:** both Cloudflare lanes together use ~1,950 neurons per run, so ~5 free runs/day. That's plenty.
- **Public live mode:** that same budget is what gates visitors. With 60-second live runs it's ~25 visitors/day. Jev live costs ~$0.003 per visitor run.

## Sources
- TypeSafe quickstart — https://docs.typesafe.ai/introduction/quickstart · API ref — https://docs.typesafe.ai/api
- Jev 1.14, rate limits — https://omniakey.com/blog/jev-model-explained
- Jev pricing / credit dispute — https://madewithjev.com/jev-pricing · https://vandatateam.com/blog/jev-api-getting-started · https://lmspedia.org/jev-pricing-access-guide/
- Jev on AIML API — https://aimlapi.com/models/typesafe-jev-latest
- Clef-flash model page — https://developers.cloudflare.com/workers-ai/models/clef-flash/
- Workers AI pricing — https://developers.cloudflare.com/workers-ai/platform/pricing/ · limits — https://developers.cloudflare.com/workers-ai/platform/limits/
- 9 Oct Clef change — https://fourweekmba.com/ai-cloudflare-cuts-clef-flash-to-0-038-by-shrinking-context/ · https://aiweekly.co/alerts/cloudflare-ships-multimodal-clef-omni-cuts-flash-to-0038m
- Laya — https://pypi.org/project/laya/ · https://huggingface.co/aac6fef/laya-multilingual-mlx · https://huggingface.co/aac6fef/laya-mlx · https://aiweekly.co/alerts/convai-ships-laya-a-421m-modernbert-decision-model-apache-20 · https://pasqualepillitteri.it/en/news/17538/laya-mlx-jev-apple-silicon
- Kev — https://openrouter.ai/jaredpalmer/kev-4b/providers · https://themenonlab.blog/blog/kev-open-source-decision-model
- OpenAI Decisions (3rd-party only) — https://unite.ai/openai-releases-decisions-api-in-public-beta-powered-by-gpt-6-luna · https://www.eesel.ai/blog/gpt-6-luna-pricing
- OpenCode Zen — https://opencode.ai/docs/zen
- Groq limits — https://console.groq.com/docs/rate-limits · https://eesel.ai/blog/groq-pricing · Gemini — https://ai.google.dev/gemini-api/docs/rate-limits
- Prior art — https://github.com/virajbhartiya/laya-vs-jev · https://github.com/dwmkerr/spaceinvaders/pull/37 · https://13rac1.github.io/ufa-2026-09-spaceinvaders/ · https://madewithjev.com/categories/games-and-real-time

## Decisions after Phase 1 (2026-10-29)

| Question | Decision |
|---|---|
| Game | **A. Descent** (lander-style genre; `choice` rotate + `score` throttle per decision) |
| Access | TypeSafe account **with $5 credit** (credit confirmed on the account, despite the reports above). Cloudflare account and a domain on Cloudflare (a Pages custom domain is free). OpenRouter key with **no credit** |
| Laya | **Fine-tune on Colab Pro**, on game states labelled by the scripted autopilot |
| Live mode | Public, **only if the free budget can carry it** (see below) |

**Is the free budget enough for public live mode?** With 60-second live runs at 5 Hz: Clef-flash ≈ 300 decisions × ~200 tokens ≈ 210 neurons. Llama ≈ 90 decisions × ~340 tokens ≈ 180 neurons. Together that's **~390 of 10,000 neurons/day ≈ 25 visitor runs/day**. Jev costs ≈ $0.0025 per run, so $1 of credit ≈ 400 runs. Replays are the default view; "Go live" is opt-in, capped per day, and falls back to replays. That's enough to show the project to recruiters. Re-check against measured token counts in milestone 4.

**Kev:** Kev-4B on OpenRouter is paid ($0.042/M) and the key has no credit. Kev-0.8B could run locally instead. Parked until milestone 4.
