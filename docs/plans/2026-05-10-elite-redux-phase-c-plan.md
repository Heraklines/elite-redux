# Elite Redux v2.65 Port — Phase C (Behavior Port) Roadmap

> **Status:** Outline only. Detailed task breakdown deferred until the Phase A archetype taxonomy doc lands — that doc dictates how many archetypes exist and which abilities cluster vs. need bespoke implementations.

**Goal:** Every custom ER ability + custom ER move behaves faithfully to the reference ROM hack. By the end of Phase C, an Insane-tier trainer fight in this build should be mechanically indistinguishable from the same fight in the v2.65beta ROM (modulo unavoidable RNG differences).

**Pre-requisite:** All Phase B exit gates green.

---

## Task groups

### C1. Archetype primitives (1-2 weeks)
- For each archetype enumerated in `docs/plans/elite-redux-archetype-taxonomy.md` (~20-30), implement a parameterized `AbAttr` or `MoveAttr` subclass
- Place under `src/data/elite-redux/archetypes/`, one file per archetype
- Each archetype takes its parameters via the constructor — abilities/moves CONFIGURE rather than IMPLEMENT
- Examples:
  - `TypeDamageBoostAbAttr(type: PokemonType, multiplier: number)` for "+25% Fire damage" patterns
  - `FlagDamageBoostAbAttr(flag: MoveFlag, multiplier: number)` for "+25% Hammer-Based" patterns
  - `StatTriggerOnEventAbAttr(event: AbAttrTrigger, stat: BattleStat, delta: number)` for "+1 Speed on KO" patterns
  - `ImmunityWithAbsorbAbAttr(type: PokemonType, absorbHp: number | "full")` for "Heals when hit by Fire" patterns
- TDD per archetype: synthetic battle test that exercises the archetype with mock data, asserts the right outcome
- Re-classify all ER abilities/moves in `er-abilities.ts` and `er-moves.ts`: change `archetype: "unknown"` → `archetype: "type-damage-boost"` (etc.) + the archetype's parameters in a sibling field

### C2. Custom ability behavior (4-6 weeks)
- Frequency-prioritized: starter-tier and route 1-3 trainer abilities first (~200 abilities — playable game by mid-Phase-C even though we don't ship yet); legendary/postgame last
- Iteration loop per ability:
  1. Read ER's `desc` + cross-reference v1.7 C source at `Elite-Redux/eliteredux/src/battle_util.c`
  2. Cross-check v2.65 deltas against Discord changelogs
  3. Map to an archetype OR write a bespoke `AbAttr` subclass under `src/data/elite-redux/abilities/<ability-snake-case>.ts`
  4. Update `er-abilities.ts` archetype/parameters
  5. Write a focused unit test (battle simulator with synthetic mons exercising the ability)
- Long-tail bespoke implementations: expected ~150 abilities

### C3. Custom move behavior (1-2 weeks)
- Same loop as C2, for the 112 customs
- Bespoke `MoveAttr` subclasses under `src/data/elite-redux/moves/<move-snake-case>.ts`

### C4. Move↔ability interaction flags
- ER introduces new move flags: `FLAG_HAMMER_BASED`, `FLAG_SOUND_BASED` (rebalanced), `FLAG_BULLET`, `FLAG_DANCE`, `FLAG_ARROW`, etc.
- Wire each new flag into `MoveFlag` enum in `src/enums/move-flag.ts`
- For each ability that REACTS to a flag (e.g., "ignores Sound-based moves"), ensure the `archetype` config references the right flag enum value

### C5. Validation — exhaustive programmatic test harness

Two-layer testing strategy — synthetic coverage (everything) + golden replays (representative).

**C5a. Per-ability synthetic harness (every ability, every trigger).**
- Build `test/elite-redux/battle-harness.ts` — headless fight simulator that takes `{playerMon, foeMon, scenario}` and runs N turns, recording every state change (HP, status, stat stages, weather, ability triggers).
- For each of the 1034 ER abilities + 715 customs, generate test cases covering every trigger this ability listens to:
  - `on-entry` (Intimidate, Drought, Sand Stream, etc.) — assert effect fires on switch-in
  - `on-take-damage` (Rough Skin, Iron Barbs, Static, etc.) — assert reactive effect fires on contact-hit
  - `on-ko-opponent` (Moxie, Beast Boost, Soul-Heart, etc.) — assert stat change after KO
  - `on-status-applied` (Synchronize, etc.)
  - `during-damage-calc` (Overgrow, Blaze, Tinted Lens, etc.) — assert multiplier applies
  - `during-type-check` (Levitate, Flash Fire, etc.) — assert immunity / type override
  - `on-weather-set` (Cloud Nine, etc.)
  - `between-turn` (Speed Boost, Bad Dreams, etc.)
- Generated, not hand-written — a metadata-driven test runner reads each ability's archetype + parameters from `er-abilities.ts` and synthesizes the test scenario.

**C5b. Per-move synthetic harness (every move, every interaction).**
- For each of the 1032 ER moves + 112 customs, exercise:
  - Base damage (power × stats × type chart × STAB)
  - Every secondary effect (status, stat changes, drain, recoil, multi-hit, recharge, charge-up, two-turn)
  - Every move-flag interaction (Hammer-Based, Sound-Based, Bullet, Dance, Arrow, Pulse, Bite, etc.) against the abilities that consume those flags. E.g.: Soundproof ignoring a Sound-flag move; Punk Rock boosting a Sound-flag move's damage; Aerilate converting a non-Flying move to Flying.
- Move↔ability interaction matrix: for every (move, ability) pair where the ability cares about the move's properties, assert the interaction works. This catches the "Hammer-Based flag silently dropped" class of bug.

**C5c. Multi-ability stacking tests (the 3-passive feature).**
- Every (active, innate-1, innate-2, innate-3) tuple in the 1907 species roster:
  - Verify all 4 abilities fire in the correct order at the right triggers.
  - Verify no double-fire on duplicate ability slots (e.g., active = innate-1).
  - Verify passive disable (via `Passive.ENABLED_N` bit clear) actually suppresses that slot.

**C5d. Vanilla rebalance regression tests.**
- ER rebalances ~50 vanilla moves and ~30 vanilla abilities.
- For each rebalanced entity, snapshot the OLD pokerogue behavior + assert the NEW ER behavior. This ensures we don't accidentally revert to the vanilla numbers during refactors.

**C5e. Golden replays (representative).**
- 50 hand-curated trainer battles across difficulty tiers (party / insane / hell).
- Compare turn-by-turn outcomes against expected outputs sourced from running the ER ROM in mGBA + scripted player input.
- These are the integration-level safety net; C5a-C5d are the unit-level guarantees.

**Output:** `pnpm run er:test` runs all 4 layers and produces a single report:
```
[er:test] abilities: 1034 / 1034 pass (715 custom + 319 vanilla)
[er:test] moves: 1032 / 1032 pass (112 custom + 920 vanilla)
[er:test] multi-ability stacking: 1907 / 1907 species pass
[er:test] vanilla rebalances: 80 / 80 pass
[er:test] golden replays: 50 / 50 pass
[er:test] ALL GREEN
```

A single failing case = blocks ship. No abilities/moves untested. The harness is the source of truth that the port is correct.

### C6. Edge cases + polish
- Mega + form behavior tied to ability changes (e.g., "transforms when at low HP" mechanics that involve both `pokemonFormChanges` + an `AbAttr`)
- Item-conditional abilities
- Multi-turn moves with custom charge/release behavior
- 2-turn-attack interactions with the new ER move-flag taxonomy

---

## Phase C exit gate

- All 715 custom abilities have non-`unknown` archetypes (or bespoke implementations)
- All 112 custom moves have non-`unknown` archetypes (or bespoke implementations)
- **`pnpm run er:test` green across ALL 5 layers (C5a-C5e):** per-ability synthetic, per-move synthetic, multi-ability stacking, vanilla rebalance regression, 50 golden replays
- Smoke-play of a full Insane-tier Gym-Leader-equivalent fight feels mechanically identical to running it in the reference ROM
- Full test suite green
- Zero abilities, moves, or interactions marked "untested" or "skipped" — every behavior must be exercised at least once

**Phase C complete → port is shipped-quality. Time to merge `feat/elite-redux-port` to main.**
