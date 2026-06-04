# LLM Director Game Mode — Design

**Date:** 2026-05-05
**Status:** Validated, awaiting implementation plan
**Scope:** A new game mode in which an LLM "Director" generates per-run story arcs, beats, NPC dialogue, trainer encounters, biome transitions, and consequences — every 3 waves over a 200-wave run. The mode pre-generates upcoming beats during play so the player never sees a loading delay between beats.

## Goal

Make every run a unique narrative arc. The LLM picks a theme, writes a story bible, and emits a beat every 3 waves: dialogue choices, trainer battles with thematic teams, biome transitions with story flavor, item events, narrative-only scenes. Player choices feed back into subsequent beats — alignment, faction reputation, NPC memory, world flags — so a 200-wave run feels like one coherent (if AI-driven) story rather than 67 disconnected vignettes.

## Non-goals

- No daily-seed support — Director runs are inherently non-deterministic.
- No new sprites or assets — text-only generation; reuse existing Pokémon, trainers, items, biomes.
- No new battle mechanics — all battles use the existing engine.
- No multiplayer / online sync.
- No in-game settings panel for LLM config in v1 (env-var only).
- No moderation layer beyond the LLM provider's own — assumes user wants mature/dark content as opt-in.

## High-level architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                  Run start (player picks Director mode)              │
│  ─────────────────────────────────────────────────────────────────   │
│  1. Player picks starters (vanilla classic flow)                     │
│  2. Theme picker UI: roll from seed table OR re-roll                 │
│  3. DeepSeek-V4-Pro:thinking generates StoryBible (~3-10s overlay)   │
│  4. Beat #1 generation kicks off for wave 3 (background)             │
│  5. Player enters wave 1                                             │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│              Steady state (one beat every 3 waves)                   │
│  ─────────────────────────────────────────────────────────────────   │
│  Wave X (beat fires from queue)                                      │
│    ├─ Render beat (dialogue, choice, battle, biome pick…)            │
│    ├─ Apply consequence to story state                               │
│    ├─ KICK OFF generation of beat for wave X+3 (Kimi K2.6)           │
│    └─ Apply interBeatOverrides for waves X+1, X+2                    │
│  Wave X+1 (vanilla / overridden trainer)        ┐                    │
│  Wave X+2 (vanilla / overridden trainer)        │ generation runs    │
│  Wave X+3 (next beat fires from queue)         ←┘ in parallel        │
└──────────────────────────────────────────────────────────────────────┘
```

Two LLMs, division of labor:
- **DeepSeek-V4-Pro:thinking** — structured outputs (story bible at run start; per-beat JSON skeleton when the beat is structurally complex, e.g., trainer team composition with balance constraints). Reasoning/JSON-schema strength.
- **Kimi K2.6** — beat prose (intro text, dialogue, options, epilogues). Narrative voice strength, 256k context, 65k output max.

Both via NanoGPT (`https://nano-gpt.com/api/v1`, OpenAI-compatible). API key from `NANOGPT_API_KEY` env var. Models:
- `TEE/deepseek-v4-pro:thinking`
- `TEE/kimi-k2.6`

Cost is paid via the user's NanoGPT account; not a design constraint.

## Game mode integration

New entry in `GameModes` (see `src/game-mode.ts`):

```ts
GameModes.LLM_DIRECTOR
```

Properties:
- Inherits Classic's starter selection (same dex, same point budget, same starter UI).
- Inherits Classic's level curve via `getPartyLevels(waveIndex)` — this is the **floor of fairness** for trainer balance.
- Wave count: 200 (same as Classic).
- Unlock: available from start (no progression gate in v1).
- `nonDeterministic: true` flag on the mode → leaderboard / daily-seed code excludes Director runs.

Mode select screen (`src/ui/handlers/game-mode-select-ui-handler.ts`) gets a new entry with title and blurb i18n keys.

After starter selection, before the first wave, flow diverts to a new **theme picker** UI handler (`UiMode.LLM_DIRECTOR_THEME_PICKER`).

## Theme system

### Seed table

`src/data/llm-director/theme-seeds.ts` — a static array of ~100 1-line theme seeds, each tagged with tonal hints. Examples:

```ts
{ id: "underground-fixed-tournament", text: "Underground Pokémon tournament where every match is fixed except yours.", tones: ["mafia","tense"] }
{ id: "saint-with-a-price", text: "A forgotten saint walks among the towers, healing the ill — for a price.", tones: ["religious","ambiguous"] }
{ id: "league-collapse-mafias", text: "The League collapsed; rival mafias now run the gym circuit.", tones: ["dystopian","political"] }
{ id: "forest-cult", text: "The forests have a new religion. The Pokémon are its prophets.", tones: ["mystery","occult"] }
// … ~100 total, varied tones (light, dark, comedic, tragic, mature, surreal)
```

### Theme picker UI

`src/ui/handlers/llm-director-theme-picker-ui-handler.ts` — new handler in the gacha-style window box.
- Shows current rolled seed (the 1-line text).
- "Re-roll" button → picks a different seed from the table.
- "Accept" → triggers story bible generation.

(Custom seed text input deferred to v2.)

### Story bible generation

One DeepSeek-V4-Pro:thinking call. System prompt: "You are the Director for a 200-wave Pokémon roguelike run. Given this seed, generate a structured story bible matching this JSON schema..."

Schema (validated by AJV, already in deps):

```ts
interface StoryBible {
  themeName: string;            // 2-6 words
  blurb: string;                // 2-3 sentences
  tonalKeywords: string[];      // 3-7 keywords
  acts: Array<{
    name: string;
    waveStart: number;
    waveEnd: number;
    summary: string;            // 1-2 sentences of intent
  }>;
  factions: Array<{
    name: string;
    description: string;
    initialRep: number;         // -100..100
  }>;
  recurringNPCs: Array<{
    memoryKey: string;          // stable id LLM uses to refer back
    name: string;
    role: string;
    initialDisposition: string;
  }>;
  moralSpectrum: { goodLabel: string; evilLabel: string };
}
```

User waits ~3-10s under a "Preparing your story..." Phaser overlay with the seed text visible. One-time per run.

## Beat system

### Cadence

Every 3 waves (waves 3, 6, 9, …, 198). 200-wave run → **66 beats**.

### Beat types (discriminated union)

```ts
type Beat =
  | NarrativeOnlyBeat
  | DialogueChoiceBeat
  | TrainerBattleBeat
  | BiomeTransitionBeat
  | ItemEventBeat;

interface BeatBase {
  beatId: string;               // uuid for telemetry + beat history reference
  type: Beat["type"];
  introText: string;            // displayed first, full Phaser dialogue style
  interBeatOverrides?: Array<{  // shape the next 1-2 vanilla waves
    atWaveOffset: 1 | 2;
    trainerOverride?: { speciesSwaps?: SpeciesId[]; levelDelta?: number };
    biomeFlavorText?: string;
  }>;
}

interface DialogueChoiceBeat extends BeatBase {
  type: "dialogue_choice";
  speaker?: { name: string; memoryKey?: string };
  options: Array<{
    label: string;
    consequence: Consequence;
  }>;
}

interface TrainerBattleBeat extends BeatBase {
  type: "trainer_battle";
  trainerName: string;
  trainerType: TrainerType;     // pick from existing pool
  speciesSwaps?: SpeciesId[];   // up to 2; subject to balance check
  levelDelta?: number;          // default 0; clamped to ±3 unless difficultyTag = "brutal"
  difficultyTag?: "easy" | "normal" | "hard" | "brutal";
  preBattleText: string;
  postWinText: string;
  postLossText?: string;        // for narrative continuity if player loses
  rewardOverride?: ItemReward;  // from tier menu only
}

interface BiomeTransitionBeat extends BeatBase {
  type: "biome_transition";
  options: Array<{
    biomeId: BiomeId;
    flavorText: string;         // why this biome makes sense narratively
    consequence?: Consequence;  // e.g., aligned with a faction
  }>;
}

interface ItemEventBeat extends BeatBase {
  type: "item_event";
  consequence: Consequence;     // typically items[] with epilogueText
}

interface NarrativeOnlyBeat extends BeatBase {
  type: "narrative_only";
  bodyText: string;
}

interface Consequence {
  alignment?: number;           // delta, -10..+10
  factionRep?: Record<string, number>;  // delta per faction
  items?: Array<{ modifierType: string; qty: number }>;
  money?: number;               // delta
  flags?: Record<string, boolean>;
  npcMemoryUpdate?: Record<string, Partial<NpcMemory>>;
  queuedBeats?: Array<{ atWaveOffset: number; tag: string }>;
  epilogueText?: string;
  runEnd?: { reason: string; epilogueText: string };  // ends the run
}
```

### Schema validation

Every beat response is validated by AJV against the corresponding schema. On failure:
1. Retry ×3 with the validation error appended to the prompt: "Your previous output failed validation: <error>. Re-emit valid JSON."
2. If still failing, fallback to `narrative_only` beat with a generic line ("The road continues.") logged + telemetered.

### Trainer balance rails

Hard rails (enforced post-LLM, not advisory):

| Rail | Default | Override |
|---|---|---|
| Trainer level | `getPartyLevels(waveIndex)` ± 3 | `difficultyTag: "brutal"` allows up to +10, **but** the beat must include a `dialogue_choice` escape option earlier in the act (game pre-checks last 6 beats; if no escape was offered, rail trims back to +3) |
| Species swaps | Up to 2 from existing pool | Must pass a type-coverage check: player must have ≥1 pokemon with neutral-or-better matchup against ≥1 of the trainer's types |
| Reward tier | Wave-bracketed (`common` / `uncommon` / `rare` / `epic`) | LLM picks within tier |
| Back-to-back trainers | Max 3 consecutive (via `interBeatOverrides`) before forced breather wave | Hard cap |

### Difficulty system prompt directive

The LLM is told (in system prompt):
> The player should be able to lose this run. Failure is part of the experience. But every brutal encounter must include a *preparable signal* in earlier beats AND an escape path achievable from the player's current state. The player's recent battle pressure is in the envelope — read it. Aim for a 10-15% loss-risk-budget across the run. Default trainer levels match the floor curve provided; deviate intentionally, not by accident.

## Context envelope (sent every beat call)

10k–40k tokens typical. No artificial cap — Kimi handles 256k input, DeepSeek 1M.

| Field | Purpose |
|---|---|
| `storyBible` (full) | Always-pinned context |
| `beatHistory` (full verbatim until 50k tokens; older summarized to 2-line digests) | Continuity |
| `playerParty: [{species, level, types, ability, moves[4], hpPct}]` | What we're writing for |
| `inventory: { items, money, vouchers }` | Reward context |
| `factionRep` | Recent state |
| `alignment` | Recent state |
| `flags`, `npcMemory` | Long-term state |
| `recentPressure: { last10Waves: [{ wave, faints, endHpPct, itemsBurned }] }` | Difficulty signal |
| `lossRiskBudget: { used, target: 0.15 }` | Self-regulation signal |
| `currentWaveIndex`, `currentAct`, `actRange` | Position in arc |
| `gameBalanceCard` (static, prompt-cached) | Level curve formula, reward tiers, available trainer pool, available biomes |
| `currentBeatType: "auto" | <forced>` | Optional forcing — game may request a specific beat type |

## Pre-generation pipeline

Beat queue with one slot ahead:

```
class DirectorQueue {
  pending: Map<waveIndex, { promise: Promise<Beat>; startedAt: number }>;
  ready:   Map<waveIndex, Beat>;
}
```

When beat at wave X fires:
1. Take from `ready[X]` (or trigger sync generation + spinner if missing — fallback path).
2. Render beat, get player choice, apply consequence.
3. Kick off `generate(X+3)` → goes into `pending`.
4. Apply `interBeatOverrides` to upcoming waves' battle setup.
5. When pending promise resolves, move into `ready[X+3]`.

Buffer underrun (next beat not ready when needed):
- Wave fires with vanilla content (vanilla classic mode wave).
- Generation continues; result goes to wave X+6's slot.
- Telemetry flags the underrun.

The first beat (wave 3) is generated during starter selection + waves 1-2 — typically ready well in time.

### Save/load

Beat queue is **transient** — not persisted. On save mid-stream, only `llmDirectorState` (story bible, history, alignment, faction rep, flags, npc memory, latency telemetry) is written. On load: queue is empty; first beat regen kicks off immediately.

## Save format

Additive optional field on `SystemSaveData`:

```ts
llmDirectorState?: {
  version: 1;
  storyBible: StoryBible;
  beatHistory: BeatRecord[];     // chronological; capped at 200; older condensed
  factionRep: Record<string, number>;
  alignment: number;
  flags: Record<string, boolean>;
  npcMemory: Record<string, NpcMemory>;
  lossRiskBudget: { used: number; target: number };
  latencyTelemetry?: Array<{
    model: string; inputTokens: number; outputTokens: number;
    latencyMs: number; status: "ok" | "retry" | "fallback" | "underrun";
    timestampMs: number;
  }>;  // rolling 50, optional, off by default
}

interface BeatRecord {
  beatId: string;
  wave: number;
  beatType: Beat["type"];
  // Verbatim for last ~30 beats; older entries get rewritten by a
  // single Kimi summarization call to a 2-line digest each.
  verbatim?: Beat;
  digest?: string;
  playerChoice?: { optionLabel: string; consequenceApplied: Consequence };
}
```

Old saves missing `llmDirectorState` load fine and play Classic. New saves with the field that get loaded by an older build degrade gracefully (extra fields ignored). Migration: no-op.

## Failure modes

| Failure | Detection | Handling |
|---|---|---|
| LLM API down / network error | fetch reject or 5xx | Skip beat → vanilla content; pre-load 5 generic prefab "filler" beats for tone |
| Timeout (>20s for beat, >30s for bible) | AbortController | Same as above |
| Malformed JSON / schema violation | AJV validator | 3 retries with error message in prompt; then fallback narrative beat |
| Content refusal | Provider returns refusal text or empty | One re-roll with sanitized seed; then fallback |
| Rate limit (429) | HTTP status | Exponential backoff (1s, 2s, 4s) before fallback |
| Beat queue underrun | `ready[X]` missing at fire time | Vanilla wave fires; queue advances |

All failures logged to `latencyTelemetry` with status field.

## Latency metering

Every LLM call wrapped in a `metered()` helper:
```ts
async function metered(model: string, fn: () => Promise<Response>) {
  const t0 = performance.now();
  const r = await fn();
  const latencyMs = performance.now() - t0;
  // … capture token counts from response, push to ring buffer …
}
```

Debug overlay (toggleable, default off) shows last 10 calls. Off-by-default keeps the UI clean.

If the rolling P95 latency creeps above ~45s (rough budget for 3 waves of average play), warn in console. Player can manually swap models in v2.

## MVP cut

| In v1 | Deferred to v2 |
|---|---|
| `GameModes.LLM_DIRECTOR` registration | Custom seed text input on theme picker |
| Theme picker UI (roll from table only) | In-game LLM settings panel (model picker, key entry, beat cadence) |
| Story bible gen (DeepSeek-thinking) | LLM-driven `runEnd` consequences (ship as a flag on schema, but disabled in v1 via runtime check) |
| Beat types: `narrative_only`, `dialogue_choice`, `trainer_battle`, `biome_transition`, `item_event` | Brutal (+5/+10) trainer overrides — v1 caps at ±3 |
| Schema validation + retry + fallback chain | Director "personality" / system-prompt picker |
| Pre-generation pipeline | Detailed in-game telemetry view |
| Trainer team mods (±3 levels, ±2 species swaps, type-coverage check) | Faction-rep visualization in HUD |
| Reward picks from existing tier menu | Beat-history viewer ("story so far" recap) |
| Save state persist + migration | i18n for non-English players (English-only system prompts in v1) |
| API key via env var `NANOGPT_API_KEY` | |
| Vanilla fallback for offline/errors/refusals | |
| Latency telemetry (in-memory rolling buffer) | |
| Debug overlay (off by default) | |

## Files touched (summary)

**New:**
- `src/data/llm-director/theme-seeds.ts` — seed table
- `src/data/llm-director/system-prompts.ts` — Director / Kimi / DeepSeek prompts
- `src/data/llm-director/beat-schema.ts` — TS interfaces + AJV schemas
- `src/data/llm-director/balance-rails.ts` — clamping logic for trainer/reward output
- `src/data/llm-director/predicate-dsl.ts` — escape condition evaluator (safe parser)
- `src/system/llm-director/director-client.ts` — NanoGPT HTTP client wrapper
- `src/system/llm-director/director-queue.ts` — pre-generation queue
- `src/system/llm-director/director-state.ts` — save state shape + serialization
- `src/system/llm-director/context-envelope.ts` — envelope builder
- `src/system/llm-director/beat-applier.ts` — apply Consequence to game state
- `src/phases/llm-director-beat-phase.ts` — render beat + handle player choice
- `src/phases/llm-director-bible-phase.ts` — story-bible generation phase (with overlay)
- `src/ui/handlers/llm-director-theme-picker-ui-handler.ts` — theme picker
- `src/ui/handlers/llm-director-beat-ui-handler.ts` — render dialogue/choice beats
- `src/ui/handlers/llm-director-debug-overlay.ts` — telemetry view

**Modified:**
- `src/game-mode.ts` — register `LLM_DIRECTOR`
- `src/enums/game-modes.ts` — new mode entry
- `src/enums/ui-mode.ts` — `LLM_DIRECTOR_THEME_PICKER`, `LLM_DIRECTOR_BEAT`
- `src/system/game-data.ts` — `llmDirectorState` field on `SystemSaveData`
- `src/battle-scene.ts` — beat-firing hook into wave advance (when in Director mode)
- `src/phases/new-battle-phase.ts` — check for queued interBeatOverrides
- `src/ui/handlers/game-mode-select-ui-handler.ts` — new mode entry
- `locales/en/game-mode.json` — name + description i18n
- `locales/en/llm-director.json` — new i18n file for theme picker + beat UI

## Test plan

- **Unit:** schema validators (valid + invalid samples per beat type); balance-rails clamping; predicate DSL parsing; consequence-applier state mutation; envelope size limits.
- **Integration:** end-to-end mock LLM (returns canned beats) → run 30 waves → verify state mutations, queue underrun handling, save/load round-trip.
- **Manual:** real LLM run → 50 waves → verify continuity, latency under budget, fallback paths fire when API down (simulate by killing network).

## Open questions to revisit (not blockers)

- Reward tier mapping: needs a curated item-tier menu. Pull from existing modifier-pool definitions (`src/modifier/modifier-pools.ts`).
- Available trainer pool for LLM picks: subset of `trainerConfigs` that has dialog-friendly identities.
- i18n: English-only system prompts in v1; player-facing text rendered via i18n keys where the LLM emits structured text (titles, labels), free text rendered as-is in the run's primary language.
- Beat history compaction: when does Kimi summarize older beats into digests? Suggest: when total `beatHistory` token count > 50k, summarize entries older than 20 beats ago. One Kimi call per compaction batch.
