# Phase B Blockers — Required Before Installing 3-Passive Species Overrides

These issues are present after Task A14 but DO NOT affect Phase A (no species
has `setPassives()` called with non-NONE slots 1/2 in Phase A).

Phase B's `init-elite-redux-species.ts` will be the first code to install real
3-passive sets via `species.setPassives([A, B, C])`. **Before that landing,
ALL FOUR issues below must be fixed.**

## I1 — `canApplyAbility(passive)` resolves only to slot 0

`src/field/pokemon.ts:2251` reads `passive ? this.getPassiveAbility() : this.getAbility()`.
For slots 1 and 2, this returns the WRONG ability (slot 0), so suppression/
ignorability/conditions checks fire against slot 0 instead of the slot being
dispatched.

**Fix:** extend `canApplyAbility(passive: boolean, slot?: 0 | 1 | 2)` and have
`applySingleAbAttrs` (`src/data/abilities/apply-ab-attrs.ts:29`) pass
`params.passiveSlot` through.

## I2 — `ShowAbilityPhase` displays slot-0's name for all passive firings

`src/phase-manager.ts:465` (`queueAbilityDisplay`) and
`src/phases/show-ability-phase.ts:22` both resolve the displayed ability via
the singular `getPassiveAbility()`. For slots 1/2, the player sees slot 0's
name on the ability-bar reveal.

**Fix:** extend `queueAbilityDisplay(pokemon, passive, ..., slot?)` and update
`ShowAbilityPhase` to resolve via `pokemon.getPassiveAbilities()[slot]`.

## I3 — Trigger messages in `ab-attrs.ts` use `getPassiveAbility()` singularly

`src/data/abilities/ab-attrs.ts:455, 3950, 3981, 4063, 4319, 4679` all build
trigger messages with `(passive ? pokemon.getPassiveAbility() : pokemon.getAbility()).name`.
For slots 1/2, the message attributes the trigger to slot 0's ability name.

**Fix:** plumb `params.passiveSlot` through to these `apply()` overrides and
resolve via `pokemon.getPassiveAbilities()[slot]?.name`.

## I4 — `applyOnGainAbAttrs` is slot-0-only

`src/data/abilities/apply-ab-attrs.ts:134` documents the existing limitation
("Ignores passives as they don't change"). Mid-turn ability swaps to a slot-1
or slot-2 ability won't fire OnGain attrs.

**Fix:** when an ability *change* targets a specific slot, dispatch OnGain to
that slot. Or document this as an intentional limitation if no callsite
actually swaps slots 1/2 at runtime.

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
