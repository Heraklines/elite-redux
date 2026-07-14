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

## Per-build data dictionary (the ML join contract)

- Telemetry events carry numeric **IDs + the build id**, never baked balance values. The ML side joins
  each event against the **data dictionary OF THAT BUILD**, so a balance change (a move's power, an
  ability's effect) can never corrupt historical data - old data is read with the old build's dictionary.
- **Generator:** `scripts/export-data-dictionary.mjs` (a build-time script, NOT runtime). It reads the ER
  2.65 authoritative dex tables already in the repo (`er-moves.ts` / `er-abilities.ts` /
  `er-move-tables.ts` - pure static data, no engine boot; Node strips the TS types on import) and writes a
  JSON artifact keyed by build id: `moves` (type / power / accuracy / pp / priority / category / target /
  effect / flags + the authoritative description text), `abilities` (name + description text). Held-item
  attributes are an engine-boot extension point (telemetry stores held-item id strings today).
  - Run: `node scripts/export-data-dictionary.mjs [--out <path>]` ->
    `dev-logs/data-dictionary/er-data-dictionary-<build>.json`.
- **Contract now, upload later:** the generator + JSON shape is the deliverable. Wire the per-deployed-build
  upload to R2 (alongside telemetry, e.g. `dictionaries/<build>.json`) as a follow-up so the offline
  pipeline has the exact table for every build it sees in the dataset.
- This is WHY the featurization principle works end to end: events reference ids; the per-build dictionary
  turns them into the attribute/effect-flag vectors + description text the model consumes.

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

## Simulation-Driven Balance Pipeline

The maintainer's design-tool vision: **the battle AI doubles as a pre-release balance simulator.** New
content (abilities / moves / items / relics / field-effects / whole formats) is defined in data as
effect-flags, injected into the headless engine, and evaluated by **millions of CPU self-play games
BEFORE any player sees it.** Design decisions get an evidence base instead of guesswork + a live meta.

### First-contact bias + the fix (the core methodology)

A naive evaluation is BIASED: the policy neither wields the new content well nor knows to counter it, so a
one-shot self-play result says more about unfamiliarity than about balance. **Measure at ADAPTATION
EQUILIBRIUM, not first contact:**

- Run a brief self-play **fine-tune WITH the candidate content** until its win-rate contribution
  **plateaus**.
- If it stays dominant **even after opponents learn to counter it**, it is genuinely overpowered.
- If it converges to fair, it was only a **surprise mechanic** (strong on first contact, fine once known) -
  not a balance problem.

Two bias reducers make the equilibrium cheaper to reach and the first-contact read less wrong:
1. **Effect-vector featurization** (the load-bearing principle above) gives non-trivial **zero-shot** play
   with content similar to what already exists - the model isn't starting from zero on a recombination.
2. **Evaluate with model + search (the boss config)** - real-engine search compensates for policy
   unfamiliarity because it scores **actual engine outcomes**, not just the policy's prior.

### Metrics beyond win-rate

A single win-rate number hides design failures. Report a profile:

- **Win-rate contribution** via **swap / ablation tests** (field the content vs an identical build without
  it).
- **Usage-at-equilibrium**: always-picked = over-centralizing; never-picked = dead content.
- **Counterplay breadth**: the number of DISTINCT strategies that beat it. A one-counter mechanic is a
  design failure **even at 50% win-rate**.
- **Variance / swinginess**: a coin-flip detector (does it decide games by luck?).
- **Decision-entropy as a fun proxy**: does it create real decisions, or auto-pilot?
- **Game-length impact**: does it drag games out or end them too fast?

### Auto-tuning

The designer specifies the **concept**; the simulator finds the **numbers**. Binary-search / regress a
move's BP, a proc %, stack counts, etc. against a **target win-rate-contribution band** - the tool returns
the value that lands the content in range.

### Per-skill-tier balance

Evaluate with the **Elo-laddered policy checkpoints** (the same difficulty-knob checkpoints). Content
balanced at top play can be broken at low skill and vice versa, so report a **per-tier balance profile**,
not one aggregate number.

### Design-space exploration (balance-constrained PCG)

A generative loop: an **LLM proposes** candidate abilities in the effect-flag data format -> the
**simulator evaluates** each at equilibrium -> **survivors are ranked** by balance + decision-entropy ->
the **designer curates**. Balance-constrained procedural content generation - the machine drafts and
vets, the human chooses.

### Balance CI + meta forecast

Every patch runs a **standard benchmark suite** (a fixed team pool + an archetype matchup matrix) as a
**regression gate**. The diff vs the previous patch is the **predicted meta shift** - publishable as
patch-note **meta forecasts** ("expect X to rise, Y to fall").

### Run-level extension

Battles are only half of a roguelike's balance - **items / relics / economy need RUN-level simulation.**
The existing headless scenario runner + BST-curve reports already simulate full runs, so the AI simply
**slots in as the decision-maker**: e.g. a relic's win-rate contribution measured over full **200-wave
runs**, not just single battles.

### Honest limits

The simulator measures **balance, not fun.** Human telemetry (this pipeline) **calibrates where the AI
meta diverges from the human meta**, and the **final call stays with the designer** - the tool informs,
it does not decide.

### Compute

All of this is **CPU self-play + CPU inference of small checkpoints** = the free **GitHub runner fleet**.
**GPU is only needed for the fine-tune steps**, not for the generation or the evaluation games.

### Player sentiment as a fun signal (later phase)

**Cart-behind-horse, explicitly.** The core pipeline above (simulate -> balance metrics -> auto-tune ->
CI) ships FIRST and stands on its own. This is a **future enrichment** that adds a "fun to play against"
axis once the balance machinery is proven - do not block the core work on it.

The simulator measures balance, not fun (see Honest limits). To close that gap, learn what players actually
ENJOY facing and feed it back into design:

1. **Explicit signal - sampled micro-ratings.** A lightweight in-game prompt ("how did that feel to play
   against?") on a **sampled** basis - post-boss, post-ME, or on **first encounter with new content**. One
   tap, skippable, **never nagging**. Sampling + skippability keep it unobtrusive and keep response bias low.
2. **Implicit signals (already in telemetry, free + often more honest than ratings).** Quit-rate
   immediately after facing content X, retry rate, session-end proximity to specific encounters, forfeit
   patterns. These fall out of the existing event stream (surface/decision/outcome events + session
   envelopes) with no new UI, and behaviour is frequently a truer fun signal than a self-report.
3. **Fun model.** Learn a mapping from **content feature-vectors (the same effect-flags)** to sentiment.
   This becomes an **additional ranking signal in the generative design loop**, sitting next to balance +
   decision-entropy - so generation is steered toward content that is **fun to play against**, not merely
   fair.
4. **Schema note (additive-only).** A sentiment event is a **purely ADDITIVE** schema evolution - a new
   OPTIONAL event type, fully consistent with the additive-only policy
   (`docs/plans/player-telemetry-schema-v1.md` section 9). **Reserve the event name now
   (`content_sentiment`)**; implement the capture later. No `schemaVersion` bump is required to add it.

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
