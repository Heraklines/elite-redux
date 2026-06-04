# Elite Redux v2.65 Port — Phase B (Data Wire-Up) Roadmap

> **Status:** Outline only. Detailed task breakdown deferred until Phase A's emitted modules exist — the exact file paths, type signatures, and integration points depend on what Phase A produces.

**Goal:** Wire all 1907 species, 1034 abilities, 1032 moves, 895 trainers, 288 megas, 113 forms, and ER sprites into the running game. Customs render names + descriptions and ship with stub behavior (active ability still uses pokerogue's existing implementations where available; customs fall through to a generic no-op `AbAttr` that the Phase C work will replace).

**Pre-requisite:** All Phase A exit gates green.

---

## Task groups

### B1. Species wire-up
- Extend `AbilityId` / `MoveId` / `SpeciesId` enums with the ER customs (IDs from `er-id-map.ts`)
- Replace / augment `src/data/balance/pokemon-species.ts` initialization: iterate `ER_SPECIES`, construct `PokemonSpecies` instances, attach `passives[]` via the Task 13 setter
- Verify dex browsability — start the dev server (`pnpm run start`), open the starter-select, scroll through to ER-custom mons, confirm names + sprites render

### B2. Abilities + moves wire-up
- Generate `Ability` instances for all 1034 ER abilities (existing vanilla `attr()` chains stay; customs ship as bare `Ability(name, desc).attr(NoOpAbAttr)`)
- Generate `Move` instances for all 1032 ER moves (vanilla retains existing implementations; customs ship with stats + flags + a default `AttackMove` damage attr)
- Both wired into `init-abilities.ts` and `init-moves.ts` respectively (or whatever the current init points are post-refactor — check at execution time)

### B3. Vanilla rebalance pass
- ER rebalances many vanilla move stats (power/PP/accuracy). After B2 completes, run a diff script: for each vanilla move name, compare emitted `er-moves.ts` stats vs current pokerogue stats. Patch all deltas
- Same for vanilla abilities — most descriptions are unchanged, but a small set has rebalanced numbers. Patch the data, leave the existing attribute implementations

### B4. Trainer wire-up
- Map ER trainers into pokerogue's `TrainerConfig` system. ER tiers (party / insane / hell) map to pokerogue's existing `TrainerPoolTier` (COMMON / UNCOMMON / RARE) within each trainer config
- Smoke-test by setting `gameMode = "Endless"` and battling a few trainers — verify parties match ER's expected rosters

### B5. Mega + form change wire-up
- Encode 288 megas via `pokemonFormChanges` with `SpeciesFormChangeItemTrigger` (mega stone item)
- Encode 113 alt forms with their appropriate triggers (level/gender/item/move/etc., decoded from ER's `evoKindT` table)
- Visual verification: trigger a mega in-game, confirm sprite swap + stat update

### B6. Sprite + icon atlas — full coverage audit

**Non-negotiable: every species, every form, every mega ships with sprites.** No ER mon enters the dex without front/back/shiny/icon variants.

- Verify `assets/images/pokemon/elite-redux/` is loaded by `loadAtlas()` calls in the appropriate scene-init flow.
- Regenerate the icon atlas (`pokemon_icons_*.png` sheets) to include ER customs — there's an existing script in `public/images/pokemon/`; extend it.
- **Audit step (mandatory before B exit):** run `scripts/elite-redux/audit-sprites.mjs` that walks the 1907 species + 113 alt forms + 288 megas and verifies each has:
  - `front/<name>.png` (default forward sprite)
  - `back/<name>.png` (player-side sprite)
  - `shiny/front/<name>.png` + `shiny/back/<name>.png`
  - icon atlas entry
  Outputs a missing-sprite report. Gaps are resolved by either: (a) sourcing from upstream ER repo (some are present under different naming conventions), (b) hand-creating placeholders for genuinely-absent assets, or (c) explicitly flagging as known-missing in `docs/plans/elite-redux-known-missing-sprites.md` with a remediation plan. Phase B does not exit with unresolved missing sprites.

---

## Phase B exit gate

- Dev server starts cleanly
- Starter-select shows ALL 1907 mons (browsable, with sprites)
- **`pnpm run er:audit-sprites` returns zero unresolved missing sprites** (any known-missing must have an entry in `docs/plans/elite-redux-known-missing-sprites.md` with remediation owner)
- Combat works: vanilla mons use real pokerogue battle logic; ER customs animate + take damage but their ability/move effects are no-ops (Phase C work)
- Trainer encounters spawn ER-shaped parties across all 3 difficulty tiers
- Mega + form changes trigger correctly with the right sprite swap

Phase B complete → Phase C (behavior port) begins.
