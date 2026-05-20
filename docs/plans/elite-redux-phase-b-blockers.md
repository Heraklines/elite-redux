# Phase B Blockers — Required Before Installing 3-Passive Species Overrides

These issues are present after Task A14 but DO NOT affect Phase A (no species
has `setPassives()` called with non-NONE slots 1/2 in Phase A).

Phase B's `init-elite-redux-species.ts` will be the first code to install real
3-passive sets via `species.setPassives([A, B, C])`. **Before that landing,
all four issues below must be fixed.**

Task B0 closes I1, I2, I3. I4 remains documented and is deferred to Phase C
(after a real callsite that mid-turn-swaps a slot-1/2 ability is identified).

## ✅ Resolved in B0

The following three issues were closed by task B0 (see commit listed at the
bottom of this section). Each is regression-tested in
`test/data/abilities/apply-ab-attrs-passives.test.ts` ("B0 I1: canApplyAbility
slot routing") and the broader A12-A16 suite still passes.

### I1 — `canApplyAbility(passive)` resolves only to slot 0 ✅

**Was:** `src/field/pokemon.ts:2251` read
`passive ? this.getPassiveAbility() : this.getAbility()`. For slots 1 and 2 this
returned the WRONG ability (slot 0), so suppression / ignorability / conditions
checks fired against slot 0 instead of the slot being dispatched.

**Resolution:** `canApplyAbility(passive: boolean = false, passiveSlot: 0 | 1 | 2 = 0)`
in `src/field/pokemon.ts` now resolves via the slot-indexed array
(`this.getPassiveAbilities()[passiveSlot]`) and returns `false` for an empty
slot (no fallback to slot 0). `applySingleAbAttrs`
(`src/data/abilities/apply-ab-attrs.ts:30`) passes `params.passiveSlot ?? 0`
through.

### I2 — `ShowAbilityPhase` displays slot-0's name for all passive firings ✅

**Was:** `queueAbilityDisplay` and `ShowAbilityPhase` resolved the displayed
ability via singular `getPassiveAbility()`. For slots 1/2 the player saw
slot 0's name on the ability-bar reveal.

**Resolution:** `queueAbilityDisplay(pokemon, passive, show, passiveSlot = 0)`
in `src/phase-manager.ts` and the `ShowAbilityPhase` constructor in
`src/phases/show-ability-phase.ts` both accept and propagate `passiveSlot`.
The phase resolves the ability via `getPassiveAbilities()[passiveSlot]` and
short-circuits to `end()` for an empty slot (the bar isn't shown). The two
`queueAbilityDisplay` callsites inside `applySingleAbAttrs` pass the current
dispatch slot.

### I3 — Trigger messages in `ab-attrs.ts` use `getPassiveAbility()` singularly ✅

**Was:** 6 trigger-message callsites in `src/data/abilities/ab-attrs.ts`
(formerly lines 455, 3950, 3981, 4063, 4319, 4679) built the message text
with `(passive ? pokemon.getPassiveAbility() : pokemon.getAbility()).name`,
which attributed the trigger to slot 0's name for slots 1/2.

**Resolution:** added a `resolveTriggerAbility(params)` helper at the top of
`ab-attrs.ts`. The 6 callsites now read
`const abilityName = resolveTriggerAbility(params)?.name ?? "";`. The helper
honors `params.passiveSlot` (defaulting to slot 0). After the edits the 6
attrs in question are: `TypeImmunityHealAbAttr`, `PostWeatherLapseHealAbAttr`,
`PostWeatherLapseDamageAbAttr`, `PostTurnStatusHealAbAttr`, `PostTurnHealAbAttr`,
`HealFromBerryUseAbAttr`.

## I4 — `applyOnGainAbAttrs` is slot-0-only

`src/data/abilities/apply-ab-attrs.ts:182` documents the existing limitation
("Ignores passives as they don't change"). Mid-turn ability swaps to a slot-1
or slot-2 ability won't fire OnGain attrs.

**Fix:** when an ability *change* targets a specific slot, dispatch OnGain to
that slot. Or document this as an intentional limitation if no callsite
actually swaps slots 1/2 at runtime.

Deferred to Phase C — no current callsite swaps a non-slot-0 passive at runtime,
so this is latent. Will revisit once a Phase B/C species (e.g. a form-change
species that uses a slot-1 or slot-2 passive) requires it.

## Verification before Phase B species init lands

Run all 4 issues against the integration-test suite once `init-elite-redux-species.ts`
is in place. Each issue can be regression-tested by setting up a test
species with slots 0/1/2 all distinct and verifying the right ability fires,
displays its own name, and produces its own trigger message.

## Save migration note (Phase A — A15)

The `Passive` bitmask widening (A12) preserves numeric values for slot 1
(`UNLOCKED = UNLOCKED_1 = 1`, `ENABLED = ENABLED_1 = 2`). Existing saves
stored `passiveAttr` as `(UNLOCKED | ENABLED) == 3`, which under the new
enum still means "slot 1 unlocked AND enabled". No data migration was
needed for Phase A.

**Phase B note:** Once `init-elite-redux-species.ts` installs real 3-passive
sets, players' first interaction with a 3-passive species will populate
slots 2 and 3 (bits 4-32) for the first time. The save format gains those
bits automatically (it's a number, not a struct), so no format change.
But the `starterData[speciesId].passiveAttr` field in storage is the same
slot used for both legacy single-passive AND new 3-passive — Phase B must
ensure:

1. UI lets players unlock each of the 3 slots independently (A16 covered).
2. The unlock-confirmation candy cost is charged per slot.
3. Loading a save with `passiveAttr = 63` (all 6 bits) doesn't trigger
   any "unknown bit" warnings or migrations.

Verified by A15's test: a synthetic `passiveAttr = 3` still reads as
slot-1 unlocked+enabled. A `passiveAttr = 63` would mean all 3 slots
unlocked+enabled — verify in Phase B testing.
