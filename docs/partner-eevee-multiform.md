# Partner Eevee multi-form movesets (Omniform per-evolution movesets)

Phase-1 CORE backend for the Partner Eevee multi-form system. This document is the
contract phase 2 (the UI: an extension of the existing ER batch level-up screen)
builds against. Partner Eevee is the only user today; the model is generic for any
future **Omniform** mon (3-4 more partner evolutions are coming, eventually one per
type).

## Concept

An **Omniform mon** mid-battle form-changes ("adapts") between evolution forms driven
by the move type it uses (`src/data/elite-redux/abilities/omniform.ts`, the #944
ability). The whole point of Partner Eevee is that **each evolution form carries its
OWN independent moveset**. This phase adds:

- a per-evolution moveset **store** that persists in the save;
- a seeded **roll** for an evolution's base moveset on first unlock;
- the transform **live-moveset swap** (the active moveset is the current form's);
- the **Normal-type status-move revert** to the base form;
- the **teach-path backend** the level-up batch panel / TM case / Learner's Shroom call.

## Files

| File | Role |
| --- | --- |
| `src/data/elite-redux/omniform-movesets.ts` | **The model.** Predicate, store type, seeded roll, learnability, teach API, in-battle swap. |
| `src/data/elite-redux/abilities/omniform.ts` | Transform hook. Now consults the store for the live moveset + adds the Normal-status revert + registry-inspection helpers (`erOmniformFamilyForms`, `erOmniformIsHolderIdentity`, `erOmniformOriginalIdentity`, `erOmniformRevertToBase`). |
| `src/data/pokemon/pokemon-data.ts` | `CustomPokemonData.erOmniformMovesets` — the persisted store field (optional; `undefined` for every non-Omniform mon). |
| `test/tests/elite-redux/er-omniform-movesets.test.ts` | vitest suite (roll determinism, learn-once, persistence, transform swap, revert). |
| `test/tests/elite-redux/run/er-omniform-moveset-swap.scenario.json` | headless run-scenario (transform + swap in a real battle). |
| `src/dev-tools/test-suite/scenarios.ts` | in-game dev scenario (`partner-eevee-omniform-movesets`). |

## The model (`omniform-movesets.ts`)

### Identity + predicate

- A form is identified by its `(speciesId, formIndex)` pair; `omniformFormKey(id, idx)`
  returns the string key `"speciesId:formIndex"` (same shape as the Omniform registry).
- `omniformBaseIdentity(mon)` — the mon's PERSISTENT base identity (its pre-transform
  snapshot while transformed mid-battle, else its current species/form). This is the
  stable anchor (Partner Eevee), independent of the transient form on the field.
- **`isErOmniformMon(mon): boolean`** — the multi-form predicate. `true` when the base
  identity is a registered Omniform holder with transform targets (family size > 1).
  **Every new behavior gates on this, so a vanilla single-form mon serializes and
  behaves byte-identically.**
- `omniformFamilyForms(mon)` — the ordered evolution forms (base first). Empty for a
  non-Omniform mon.

### Store + serialization

```ts
type SerializedOmniformMove = [moveId: number, ppUsed: number];
type ErOmniformMovesetStore = Record<string /* formKey */, SerializedOmniformMove[]>;
```

- Persisted at `pokemon.customPokemonData.erOmniformMovesets` (round-trips through the
  normal `PokemonData` / session save; `CustomPokemonData` serializes its own fields).
- **Compact on purpose** (save-size sensitive): move id + ppUsed only, one small array
  per non-base form. `undefined` for every non-Omniform mon, so `JSON.stringify` drops
  the key entirely and a vanilla mon's serialized shape is unchanged.
- **The BASE form is NOT stored.** Its moveset is the mon's normal persistent
  `moveset`. Only transform-target evolutions get store entries. So a Partner Eevee
  stores 8 arrays (one per eeveelution), not 9.
- Serialization-clean plain data, so the co-op checksum / save-digest can hash it later
  without extra work (this task does not wire co-op).

### Seeded roll

- `rollOmniformMoveset(speciesForm, level, maxSlots, randInt)` — draws up to `maxSlots`
  distinct move ids from the form's OWN level-up learnset, level-appropriate first,
  topping up from the rest of the learnset if under-qualified. Deterministic for a
  given `randInt`.
- `makeSeededRandInt(seed)` — a self-contained mulberry32 PRNG. The production roll
  seed is derived per mon + per form (`hash(mon.id + ":" + formKey)`), so a mon always
  rolls the same base kit and **rolling never touches the live battle RNG stream** (no
  combat-roll perturbation, no co-op desync).
- `getOrRollFormMoveset(mon, form)` — a form's stored moveset, rolling + persisting a
  seeded base set on first access. Base form returns the mon's live `moveset`.
- `ensureOmniformFormMovesets(mon)` — roll every family evolution's base moveset
  (idempotent). Called on acquisition/unlock and before the first transform. No-op for
  non-Omniform mons.

> **First-unlock note:** the CORE currently rolls all evolution base movesets together
> on first store init (all 8 eeveelutions unlock together for Partner Eevee). A future
> refinement can roll per-evolution exactly when each is individually unlocked; the
> `getOrRollFormMoveset` primitive already rolls lazily per form.

### In-battle live swap (PP preserved per form)

The transform (`erOmniformOnMoveStart`) swaps the ACTIVE moveset to the target
evolution's own moveset:

- `snapshotOmniformBattleMoveset(mon, form, moveset)` — save the outgoing form's live
  PP into a battle-scoped cache before switching away.
- `loadOmniformBattleMoveset(mon, form)` — the incoming form's live `PokemonMove[]`:
  the cached copy if that form was already active this battle (PP preserved), else a
  fresh copy of its stored/base template.
- `clearOmniformBattleMovesets(mon)` — cleared on `leaveField` (the cache is
  battle-scoped; the persisted store keeps resting PP).

## Teach-path backend (what phase 2 calls)

Phase 2 EXTENDS the existing ER batch level-up panel
(`learn-move-batch-phase.ts` / `LearnMoveBatchUiHandler`); it does not build a new
screen. Per the maintainer, **level-up move offers are expanded PER evolution, not in
total**: if a level-up offers Flamethrower + Ice Beam, the base form can learn both AND
each evolution can independently learn both — but a given evolution can't learn the same
move twice.

```ts
// For one offered move, which evolutions can take it? (base first)
listOmniformEvolutionsForMove(mon, moveId): OmniformEvolutionOffer[]
//   OmniformEvolutionOffer = { form, canLearn, alreadyKnown, learnable }

// Teach one move into one slot of one specific evolution. THE single entry point the
// batch panel, TM case, and Learner's Shroom all call (per offered move + selected
// evolution).
learnMoveForEvolution(mon, form, moveId, slot): OmniformLearnResult
//   OmniformLearnResult = { ok, reason? }
//   reason: "not-omniform" | "not-in-family" | "not-learnable" | "already-known" | "bad-slot"

// Every move an evolution can legally learn (its OWN level-up + TM/tutor + egg set).
omniformFormLearnableMoves(form): Set<MoveId>
canFormLearnMove(form, moveId): boolean
```

Enforcement in `learnMoveForEvolution`:
1. `mon` is an Omniform mon and `form` is in its family;
2. **legality** — `moveId` is in THAT evolution species' own learnable set;
3. **once-per-evolution** — the form does not already know `moveId`;
4. a valid `slot` within `mon.getMaxMoveCount()` (5th-move-slot item aware — the store
   tolerates 5 slots).

On success the store (or, for the base form, the live `moveset`) is updated, and if the
form is the one currently on the field its live moveset is mirrored immediately.

### TM-compat resolution note

Because legality is **each evolution species' OWN learnable set** (`speciesTmMoves` /
`speciesEggMoves` / its level-up table), per-evolution TM compatibility just IS each
partner evolution species' own TM table. This **structurally resolves the open "Partner
Eevee TM list" data question**: there is no single Partner-Eevee TM list to author — a
TM is teachable to Partner Flareon iff Partner Flareon's species TM table lists it, to
Partner Vaporeon iff Vaporeon's does, etc. (ER merges tutor moves into `speciesTmMoves`,
so tutors are covered by the same path.) The partner eeveelution species already clone
their base eeveelution's kit (see `er-newcomer-species.ts`), so their TM tables come for
free.

## Transform + revert integration (`omniform.ts`)

- On a mapped-type move, a real per-evolution Omniform mon (`isErOmniformMon`) fills the
  live moveset from the TARGET evolution's OWN stored moveset (PP preserved per form),
  instead of the legacy random-derive. Both paths keep the move currently being used in
  its ORIGINAL slot (the documented mid-cast contract) and source the OTHER slots from the
  target form's moves (stored set for partners, seeded derive for harness-forced mappings).
- **Normal-type STATUS move => revert to the BASE evolution form**
  (`erOmniformRevertToBase`), via the same transform pathway so the transform VFX hook
  fires. A no-op when already on base.
- `erOmniformRevertOnLeaveField` additionally clears the per-battle form-PP cache.
- The innate-unlock preservation (#f6bb7ea32 /
  `er-omniform-innate-preservation.test.ts`) is untouched and stays green — the base
  identity anchor reuses the same `OMNIFORM_ORIGINAL` snapshot.

## What phase 2 (UI) consumes

- `isErOmniformMon(mon)` to decide whether to show the per-evolution UI at all.
- `omniformFamilyForms(mon)` for the evolution list (base first) + `omniformFormSpeciesForm(form)` for display data.
- `listOmniformEvolutionsForMove(mon, moveId)` to expand each offered level-up/TM move
  into its per-evolution offers (which evolutions can take it, which already know it).
- `learnMoveForEvolution(mon, form, moveId, slot)` to commit a teach.
- `getOrRollFormMoveset(mon, form)` to render an evolution's current moveset.

The model is UI-agnostic and side-effect-scoped to the mon's own `customPokemonData` /
live summon data, so the panel can call it per offered move + selected evolution with no
extra plumbing.
