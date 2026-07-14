# Combat AI - Roadmap (maintainer direction)

A durable note-down of where the combat-AI work is headed. Roadmap register (bullets), not a spec.
The player-telemetry pipeline (`docs/plans/player-telemetry-schema-v1.md`) is step 1 - it produces the
dataset the rest of this stands on.

## The arc

1. **Telemetry** (this pipeline) - capture real (state, action) play in every mode -> R2 dataset.
2. **Behavior stats / GBDT baseline** - per-surface descriptive stats + a gradient-boosted-trees baseline
   (e.g. "given this state, P(switch) / P(move x)") to sanity-check features and ship a cheap first policy.
3. **Imitation-learned policy** - a neural policy trained to predict the human action from the state
   (behavior cloning), then improved.
4. **Battle AI** - the policy (optionally + search) serves as trainer/ghost/opponent brains.

## Featurization principle (the load-bearing decision)

- **Represent moves / mons / abilities by ATTRIBUTES + EFFECT FLAGS, not by IDs.** A move is its
  type/power/accuracy/priority/category + effect primitives (heal, stat-stage, hazard, status, ...); an
  ability/innate is its trigger + effect primitives. This is why the telemetry `MoveState`/`MonState`
  capture attributes (type, power, pp, stat stages, the ER four-ability innate set), not just ids.
- **Why:** Showdown-pretrained priors then TRANSFER to ER's custom content (new species/forms/abilities/
  the ER custom weathers/terrains/statuses), because a novel ability composed of known effect primitives
  is understood zero-shot. New content that is just a recombination needs no retraining.
- **Optional text feature:** embed the ability/move DESCRIPTION TEXT with a small FROZEN text encoder as an
  extra feature, so semantically similar abilities map close in feature space (the ER 2.65 dex text is the
  authoritative source and is already in-repo).

## Reference points (external)

- **Metamon** (arXiv 2504.04395): ~80M-param decoder-only transformer, offline RL / CQL on ~9.2M Showdown
  human decision points; reaches human-level (~83rd percentile) WITHOUT search. Evidence that offline RL on
  human replays alone gets far.
- **PokeChamp / PokeLLMon**: the LLM + search line (strong, but heavy at inference).
- **NeurIPS 2025 PokeAgent Challenge** dataset: ~10M replays - a pretraining corpus for Showdown priors.
- **Target model band:** 5-60M params; browser / Worker inference via **ONNX int8**. Big enough to be
  strong, small enough to run on a player device.

## "Stockfish mode" - net + real-engine search at inference

- The game engine runs in the browser and is **deterministic**, so boss-tier AI = **policy/value net +
  REAL-ENGINE SEARCH**: simulate candidate move sequences with the ACTUAL battle engine, let the net
  evaluate the leaves. (The deterministic headless duo/scenario harness is exactly this simulator.)
- **AlphaZero lesson:** at a fixed inference budget, a **midsize net + search beats a big net with no
  search**. Prefer a smaller policy/value net driven by search over a giant net alone.
- **Inference-time budget = the difficulty knob:**
  - Regular trainers -> distilled **~5-20M** policy net, no/low search, **<100 ms**.
  - Bosses -> net **+ search at 2-7 s** think time.
- One model, three roles: human-like test driver (browser tier), ghost-trainer brains, and a real
  battle-AI opponent.

## Continuous-training flywheel (weekly Kaggle quota cycles, checkpoint-resume)

- Cycle: **pretrain Showdown priors -> telemetry imitation -> self-play RL -> distill**, resuming from the
  last checkpoint each weekly quota window.
- **Self-play GENERATION is CPU-only** via the headless engine (~1 s/wave) and can run at scale on **free
  GitHub Actions public-repo runners**, shipping game batches to R2. **GPUs are only needed for the
  TRAINING step**, not for generating games.
- Keep a **replay buffer of old games** so RL / fine-tunes don't catastrophically forget.

## New-content adaptation

- Attribute / effect-flag featurization -> zero-shot understanding of new abilities composed from existing
  effect primitives.
- Optional frozen text-encoder embedding of the description text -> semantically-close mapping for new
  abilities.
- Truly novel mechanics -> cheap **self-play fine-tunes** (the deterministic engine teaches the model);
  keep the old-games replay buffer to prevent forgetting.

## Counter-team designer

- Train a **win-rate predictor** `P(teamA beats teamB)` on self-play + telemetry outcomes.
- **Search over team space** to synthesize counter-teams -> a difficulty knob where high-tier trainers are
  built to counter the PLAYER's specific team.

## Free-compute inventory

- **Training (GPU/TPU):** Kaggle (~30 h/wk GPU + TPU), Colab free, AWS SageMaker Studio Lab, Modal /
  Lightning free credits.
- **Self-play generation (CPU):** free GitHub Actions public-repo runners at scale (engine is CPU-only).
- **Inference:** browser **WebGPU** on the player's device (ONNX int8).
- **Caveats:** GitHub has **no free GPU** runners; Cloudflare **Workers AI is catalog-inference only** (not
  custom-model training or hosting) - use it only if a listed model fits, not for our own weights.

## Immediate next steps (post-telemetry)

- Land telemetry on staging, accumulate a first dataset, validate feature coverage against the schema.
- Stand up the offline reader (R2 -> deduped (state, action) parquet/webdataset).
- Ship the GBDT baseline per surface as the first sanity policy; measure against held-out human actions.
