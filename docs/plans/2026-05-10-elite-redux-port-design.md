# Elite Redux v2.65 Port — Design Document

> **For Claude:** Implementation work happens in this worktree on branch `feat/elite-redux-port`. The companion implementation plans live at `docs/plans/2026-05-10-elite-redux-phase-{a,b,c}-plan.md`.

**Goal:** Ship a full, behavior-faithful port of Pokémon Elite Redux v2.65beta into PokeRogue. Every species, ability, move, mega, form, trainer team, and rebalance from ER becomes the canonical content of this PokeRogue build. No incremental ship gates — nothing released until the port is complete and the gameplay matches the reference ROM hack experience.

**Architecture:** Three super-phases (Foundation → Data wire-up → Behavior port). Worktree-isolated from the existing `feat/llm-director` work on the main repo. The LLM Director feature is orthogonal and can be merged in later — Elite Redux is a data + battle-engine port that doesn't conflict with story narration.

**Tech Stack:** Existing PokeRogue stack (TypeScript + Phaser 3 + Vite + pnpm + AJV). New scripts in `scripts/elite-redux/` (Node.js) for the data extraction + transform pipeline. Reference data: `gameDataV2.65beta.json` (3.8 MB) from `ForwardFeed/ER-nextdex` GitHub repo, vendored under `vendor/elite-redux/`.

---

## Scope inventory (v2.65beta JSON, verified)

| Thing | Count | Notes |
|---|---|---|
| Species | 1907 | ~898 vanilla gen 1-8, ~120 gen 9, ~889 custom forms/megas/ER originals |
| Alt forms (regional/Origin/etc.) | 113 entries across 41 species | |
| Mega evolutions | 288 | many mons have 2-3 megas |
| Evolution paths | 1035 (6 kinds: LEVEL, MEGA, PRIMAL, LEVEL_M, LEVEL_F, MOVE_MEGA) | |
| Abilities | 1034 | ~319 vanilla + ~715 custom |
| Moves | 1032 | ~919 vanilla + 112 custom |
| Move effect handlers | 413 distinct in the catalog | |
| Move flags | 18 (Contact, Hammer-Based, Sound-Based, Bullet, Dance, Arrow, etc.) | drives ability ↔ move interactions |
| Trainers | 895 | base party (895) + Insane tier (429) + Hell tier (399) |

---

## Super-phase A — Foundation (~1 week)

Goal: data extraction works end-to-end, pokerogue schema extended to support 3-passives-per-mon, archetype taxonomy enumerated.

- **A1. Data extraction pipeline.**
  - `scripts/elite-redux/fetch-source.mjs`: pulls `gameDataV2.65beta.json` (pinned SHA), caches under `vendor/elite-redux/` (gitignored — no redistribution).
  - `scripts/elite-redux/build-pokerogue-data.mjs`: transforms ER JSON into draft TS modules under `src/data/elite-redux/`. Drafts emitted but NOT yet wired in. Outputs:
    - `er-species.ts` — 1907 species in pokerogue's `PokemonSpecies` shape with extended `passives[]`
    - `er-abilities.ts` — 1034 abilities with name/description metadata + an `archetype` tag pointing to the behavior implementation
    - `er-moves.ts` — 1032 moves with stats + flags + effect-id pointing to the behavior implementation
    - `er-trainers.ts` — 895 trainers with parties across 3 tiers
    - `er-id-map.ts` — bidirectional ID maps (ER ID ↔ pokerogue ID). Vanilla mons keep existing pokerogue IDs; ER customs assigned IDs ≥ 10000 to avoid collision.
    - `er-sprite-manifest.ts` — mapping from ER species name → sprite path

- **A2. Schema extension in pokerogue runtime.**
  - `PokemonSpeciesForm` gains `passives: [AbilityId, AbilityId, AbilityId]` (filled with `AbilityId.NONE` when ER has fewer than 3 innates). `getPassiveCount()` returns non-NONE count.
  - `AbilityAttr` bitmask widens. Currently: `ABILITY_1=1`, `ABILITY_2=2`, `ABILITY_HIDDEN=4`. Adds: `PASSIVE_1=8`, `PASSIVE_2=16`, `PASSIVE_3=32`. Save-data migration sets all three new bits to 0 for legacy saves; players unlock per the same candy-cost mechanic as the existing single passive.
  - `apply-ab-attrs.ts` extended so every hook iterates the selected ability's attrs AND each unlocked passive's attrs. Order matches ER reference: passives in array order then active ability.
  - Starter-select UI gains a 3-checkbox row for passive unlocks (currently shows one). Cost scaling: P1 cheapest, P3 most expensive.

- **A3. Archetype taxonomy.**
  - Read all 715 custom abilities + 112 custom moves once. Cluster by mechanic shape into ~20-30 archetypes:
    - `type-damage-boost` ("+25% to fire moves")
    - `flag-damage-boost` ("+25% to Hammer-Based moves")
    - `stat-trigger-on-event` ("Speed +1 on KO")
    - `immunity-with-absorb` ("Heals when hit by Fire")
    - `conditional-damage` ("x1.5 vs statused")
    - `on-hit-effect` (10% chance status on contact)
    - `weather-terrain-interaction`
    - `entry-effect`
    - …and ~12 more archetype names enumerated by the clustering analysis
  - Each archetype is a TypeScript primitive (extends existing `AbAttr` / `MoveAttr`). Abilities are DATA: `{ archetype: "flag-damage-boost", flag: "HAMMER_BASED", multiplier: 1.25 }`.
  - Genuinely novel mechanics that don't fit any archetype get bespoke implementations — expected ~50-100 of the 715 (long tail).

**A complete when:** data extraction emits draft TS modules; schema changes typecheck + the LLM director test suite still passes (no regression); archetype list documented in `docs/plans/elite-redux-archetype-taxonomy.md`.

---

## Super-phase B — Data wire-up (~1 week)

Goal: all ER content visible in-game. Customs render names + descriptions; their behavior is stub but the game otherwise works.

- **B1.** Replace `src/data/balance/pokemon-species.ts` entries (or wire ER species through the existing initialization) with the 1907 ER species. Vanilla species keep their pokerogue IDs; customs get IDs ≥ 10000. Stats, types, abilities, passives, evolution chains all from ER JSON.

- **B2.** Replace ability data: 319 vanilla abilities get ER-rebalanced effects (existing pokerogue `AbAttr` implementations stay; the descriptions update). 715 custom abilities ship as `Ability` instances with display name + description but no `attr()` calls (stub — behavior comes in Phase C).

- **B3.** Replace move data: 919 vanilla moves get ER stats (power/PP/accuracy). 112 custom moves ship as stub `Move` instances with stats + flags + descriptions but a generic damage attr only (Phase C adds the real effect).

- **B4.** Trainer pools: import 895 trainer parties. Map ER's three tiers (`party`/`insane`/`hell`) to pokerogue's existing difficulty scaling — pokerogue already has `TrainerPoolTier` (COMMON/UNCOMMON/RARE) and per-slot `setPartyMemberFunc`. ER Easy → COMMON, Insane → UNCOMMON, Hell → RARE within each trainer config.

- **B5.** Sprite pipeline. Sparse-checkout `graphics/pokemon/` from the public `Elite-Redux/eliteredux` repo (v1.7 sprites are mostly v2.65-compatible; deltas patched manually). Custom mons' sprites copied to `assets/images/pokemon/elite-redux/`. Icon atlas regenerated to include the new mons (extends `pokemon_icons_*.png` sheets).

- **B6.** Mega + form evolution data. 288 megas + 113 alt forms encoded via pokerogue's existing `pokemonFormChanges` mechanism with appropriate triggers (item-held → mega-stone IDs, primal reversion, level/gender/move triggers per ER's evoKindT decoder).

**B complete when:** loading the game shows the ER dex (browseable, full sprites, names, descriptions). Combat works (vanilla abilities/moves use real behavior; customs stub-fall to default damage attrs).

---

## Super-phase C — Behavior port (~4-6 weeks)

Goal: every custom ability + custom move behaves faithfully to the ER reference.

- **C1.** Implement the ~20-30 archetype primitives as parameterized `AbAttr` / `MoveAttr` subclasses. Once these exist, each ability/move's "implementation" is one line of declarative config in the data module — not a class.

- **C2.** Custom abilities. Per ER's `src/battle_util.c` (sourced from the public v1.7 repo as a starting reference; v2.65 deltas patched via reading the ER Discord changelogs + JSON descriptions):
  - Cluster pass: ~80% of 715 customs map to archetypes → ~570 abilities completed in data alone (a few hours of clustering + verification work).
  - Long tail: ~150 abilities need bespoke `AbAttr` subclasses. Average 30 min per ability with the LLM-assisted "C → TS port" workflow. ~75-100 hours raw.
  - Frequency-prioritized order: starter / route 1-3 trainer abilities first; legendary / postgame last. Means a runnable build is usable mid-way through Phase C even though we don't ship until done.

- **C3.** Custom moves. Same archetype-first approach for the 112 customs. ~80% data, ~20-30 bespoke `MoveAttr` subclasses. ~30-40 hours raw.

- **C4.** Validation. Golden-test suite: take 50 representative ER trainer battles, run them in pokerogue's headless simulator, compare turn-by-turn outcomes (damage rolls within RNG variance, status applications, KO sequence) against either a Showdown-ER reference or hand-curated expected outputs. Discrepancies surface remaining behavior gaps.

**C complete when:** all 715 custom abilities + 112 custom moves have implementations (archetype-config or bespoke), all golden tests pass, smoke-play of an Insane-tier trainer fight feels mechanically identical to running it in the ER ROM.

---

## Cross-cutting concerns

- **Legality.** Elite Redux repo has NO license. We're not redistributing their assets in our repo — sprites + JSON are fetched at build time from their public GitHub, with attribution. PokeRogue itself is AGPL-3.0; this fork inherits.
- **LLM Director compatibility.** The Director's beat-writer envelope already accepts the existing `gameBalanceCard` (catalog of species/abilities/moves/trainers). After Phase B, that catalog auto-includes ER content — the Director can author beats with ER mons + abilities without any narrator-side changes.
- **Save migration.** Existing players' saves use vanilla pokerogue IDs. ID map keeps vanilla IDs stable; passive bitmasks default to 0 on load (players unlock fresh). No save corruption.
- **Performance.** 1907 species + 1034 abilities + 1032 moves stays in the same order of magnitude as vanilla (~1080 species, ~310 abilities, ~950 moves). No new perf concerns.
- **Testing.** Existing test suite continues to run. We add: data-extraction snapshot tests, archetype-config validity tests, golden-output battle tests.

---

## Files touched (high level)

**New under worktree:**
- `vendor/elite-redux/` (gitignored cache)
- `scripts/elite-redux/{fetch-source,build-pokerogue-data,fetch-sprites,validate-output}.mjs`
- `src/data/elite-redux/{er-species,er-abilities,er-moves,er-trainers,er-id-map,er-sprite-manifest}.ts`
- `src/data/elite-redux/archetypes/*.ts` (~20-30 archetype primitive files)
- `docs/plans/2026-05-10-elite-redux-phase-{a,b,c}-plan.md` (per-phase implementation plans)

**Modified:**
- `src/data/pokemon-species.ts` (3-passive support)
- `src/enums/ability-attr.ts` (widened bitmask)
- `src/data/abilities/apply-ab-attrs.ts` (iterate passives)
- `src/system/game-data.ts` (passive bitmask save/load)
- `src/ui/handlers/starter-select-ui-handler.ts` (3-passive unlock UI)
- `src/data/balance/pokemon-species.ts`, `src/data/abilities/init-abilities.ts`, `src/data/moves/move.ts`, `src/data/trainers/trainer-config.ts` (point at ER-data modules)
- `src/data/pokemon-forms.ts` (288 megas + 113 forms registered)
- `assets/images/pokemon/` (extended with ER sprites + icon atlas regen)
