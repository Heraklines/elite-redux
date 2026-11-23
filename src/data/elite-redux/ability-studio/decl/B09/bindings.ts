/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B09 chunk 2 bindings: the library form of the Tier B gate of every user of the first-move-priority family and of
// FirstTurnStatMultiplierAbAttr, keyed by (abilityId, attrIndex). "attr N" is the position in `ability.attrs`.
//
// Every line was written by hand after reading the class (archetypes/first-move-priority.ts,
// archetypes/first-turn-stat-multiplier.ts) and the live attrs of all users (a throwaway dump of allAttrSites(): flags,
// regainOnKo, moveId, stat and multiplier of every attr). FlagDamageBoostAbAttr and FlareBoostSelfBurnOnSummonAbAttr have no
// condition slot, so they have nothing to bind.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// =============================================================================================
// RearmFirstFlaggedMoveOnMoveAbAttr. Slot gate: `lastMove != null && lastMove.move === moveId`.
// =============================================================================================
// Cutthroat (5444 attr 2): Sharpen. time.last-move is `pokemon.getLastXMoves()[0]?.move === MoveId[moveId]`, the same entry.
bindCondition(5444, 2, { id: "time.last-move", who: "holder", moveId: "SHARPEN" }, "gate");

// =============================================================================================
// FirstTurnPriorityClampAbAttr. Slot gate: `pokemon.tempSummonData.waveTurnCount === 1`.
// =============================================================================================
// time.first-turn evaluates `frame.holder.tempSummonData.waveTurnCount === 1` (evaluate/conditions.ts), the same test.
bindCondition(5352, 0, { id: "time.first-turn" }, "gate"); // On the Prowl
bindCondition(5429, 1, { id: "time.first-turn" }, "gate"); // Overwatch

// =============================================================================================
// FirstFlaggedMovePriorityAbAttr. Slot gate: `flags.some(flag => move.hasFlag(flag))`.
// =============================================================================================
// The library atom move.flag calls doesFlagEffectApply, which also counts flags that other abilities inject (Rapier: horn <->
// slicing; Taekkyeon and Festivities: dance, sound). The class reads the PRINTED flag with hasFlag, so the atom would change
// behaviour while such an ability is in play. Request R-B09-01 (an atom on move.hasFlag).
const PRINTED_FLAG =
  "no library atom reads the move's own printed property (move.hasFlag): move.flag also counts properties that other abilities inject (Rapier turns slicing into horn, Taekkyeon makes attacks dances), which would change behaviour; request R-B09-01";
bindLegacyClosure(5040, 0, `${PRINTED_FLAG} (Coil Up, biting)`, "gate");
bindLegacyClosure(5380, 0, `${PRINTED_FLAG} (Sidewinder, biting)`, "gate");
bindLegacyClosure(5444, 0, `${PRINTED_FLAG} (Cutthroat, slicing)`, "gate");
bindLegacyClosure(5583, 0, `${PRINTED_FLAG} (Edgelord, slicing)`, "gate");
bindLegacyClosure(5687, 1, `${PRINTED_FLAG} (Curlipede, biting)`, "gate");
bindLegacyClosure(5933, 0, `${PRINTED_FLAG} (First Serpent, biting)`, "gate");
bindLegacyClosure(6033, 0, `${PRINTED_FLAG} (Head First, reckless)`, "gate");
bindLegacyClosure(6092, 0, `${PRINTED_FLAG} (Quick Charge, arrow or reckless)`, "gate");
bindLegacyClosure(6093, 0, `${PRINTED_FLAG} (Flicker Jab, horn or punching)`, "gate");

// =============================================================================================
// ConsumeFirstFlaggedMovePriorityAbAttr. Slot gate: `flags.some(hasFlag) || (regainOnKo && opponent.isFainted())`.
// The "landed" test is the guards() stage of the class (the WHEN "After my attack lands"), not part of the gate.
// =============================================================================================
const REGAIN =
  "no library atom reads the move's own printed property (move.hasFlag; request R-B09-01) and none says the target has fainted (opponent.isFainted(); request R-B09-02)";
bindLegacyClosure(5444 /* Cutthroat */, 1, `${PRINTED_FLAG} (slicing, no regain on a knock-out)`, "gate");
bindLegacyClosure(6092 /* Quick Charge */, 1, `${PRINTED_FLAG} (arrow or reckless, no regain)`, "gate");
bindLegacyClosure(6093 /* Flicker Jab */, 1, `${PRINTED_FLAG} (horn or punching, no regain)`, "gate");
bindLegacyClosure(5380 /* Sidewinder */, 1, `${REGAIN} (biting, regain on a knock-out)`, "gate");
bindLegacyClosure(5583 /* Edgelord */, 1, `${REGAIN} (slicing, regain on a knock-out)`, "gate");
bindLegacyClosure(5933 /* First Serpent */, 1, `${REGAIN} (biting, regain on a knock-out)`, "gate");
bindLegacyClosure(6033 /* Head First */, 1, `${REGAIN} (reckless, regain on a knock-out)`, "gate");

// =============================================================================================
// ConsumeFirstFlaggedMoveOnUseAbAttr. Slot gate: the move I just used (last history entry) has the printed flag.
// =============================================================================================
const LAST_MOVE_FLAG =
  "no library atom looks at the move I just used (this trigger provides no move slot) and reads its printed property (allMoves[lastMove.move].hasFlag); request R-B09-04";
bindLegacyClosure(5040, 1, `${LAST_MOVE_FLAG} (Coil Up, biting)`, "gate");
bindLegacyClosure(5687, 2, `${LAST_MOVE_FLAG} (Curlipede, biting)`, "gate");

// =============================================================================================
// FirstTurnStatMultiplierAbAttr. Slot gate: `!summonData?.moveHistory || moveHistory.length === 0`.
// =============================================================================================
// time.first-turn is waveTurnCount === 1, a different test (a sleeping holder keeps this boost into turn 2, a holder that has
// moved on turn 1 loses it that turn). Request R-B09-06 (an atom on "I have not used a move since I came in").
const NO_MOVE_YET =
  "no library atom says the holder has used no move since it came in (summonData.moveHistory is empty); time.first-turn is waveTurnCount === 1, a different test; request R-B09-06";
bindLegacyClosure(5088, 0, `${NO_MOVE_YET} (Violent Rush, Speed 1.5)`, "gate");
bindLegacyClosure(5088, 1, `${NO_MOVE_YET} (Violent Rush, Attack 1.2)`, "gate");
bindLegacyClosure(5270, 1, `${NO_MOVE_YET} (Showdown Mode, Speed 1.5)`, "gate");
bindLegacyClosure(5270, 2, `${NO_MOVE_YET} (Showdown Mode, Attack 1.2)`, "gate");
bindLegacyClosure(5288, 0, `${NO_MOVE_YET} (Rapid Response, Speed 1.5)`, "gate");
bindLegacyClosure(5288, 1, `${NO_MOVE_YET} (Rapid Response, Sp. Atk 1.2)`, "gate");
bindLegacyClosure(5467, 1, `${NO_MOVE_YET} (Champion's Entrance, Speed 1.5)`, "gate");
bindLegacyClosure(5467, 2, `${NO_MOVE_YET} (Champion's Entrance, Attack 1.2)`, "gate");

// =============================================================================================
// B09 chunk 3. The Tier B gates of HealStatusOnMoveTypeAbAttr, HitMultiplierAbAttr and HitMultiplierPowerAbAttr.
// Every line was written by hand after reading archetypes/heal-status-on-move-type.ts and archetypes/hit-multiplier.ts and the live
// attrs of all users (a throwaway dump of allAttrSites(): filter, extraStrikes, multiplier, extraStrikesOnly, extraCondition).
// The other five classes of the chunk have no condition slot, so they have nothing to bind.
// =============================================================================================

// ---------------------------------------------------------------------------------------------
// HealStatusOnMoveTypeAbAttr. Slot gate: `super.canApply` (the move is not a status move) AND `getMoveType(move) === moveType`.
// ---------------------------------------------------------------------------------------------
// move.damaging is matchesAbilityStudioMoveFilter(user, move, { damaging: true }): `move.category !== STATUS`, the parent's default test.
// move.type with effective on is `moveUser.getMoveType(move) === PokemonType[type]`, the same call. The residual (a curable status) stays in the class.
bindCondition(
  72,
  3,
  { all: [{ id: "move.damaging" }, { id: "move.type", type: "FIGHTING", effective: true }] },
  "gate",
); // Vital Spirit

// ---------------------------------------------------------------------------------------------
// HitMultiplierAbAttr (calc.hit-count) and HitMultiplierPowerAbAttr (calc.damage-dealt). Slot gate: `matchesFilter(filter, pokemon, move)`.
//   - type set:    `pokemon.getMoveType(move) === type`                          -> move.type with effective on (same call)
//   - flag set:    `move.doesFlagEffectApply({ flag, user: pokemon })`           -> move.flag (same call; the atom also passes the foe as
//                  the target, which doesFlagEffectApply reads only for contact and ignore-abilities, never filtered on here)
//   - flagsAny:    some of the flags, each through doesFlagEffectApply           -> any of move.flag
//   - empty:       always true                                                   -> { all: [] }
// The strike test of HitMultiplierPowerAbAttr (extraStrikesOnly) is the class's residual, not part of any binding.
// ---------------------------------------------------------------------------------------------
const MASK_FILTER =
  "the filter is ONE combined flag mask (Pulse | Slicing) tested with a single doesFlagEffectApply call, and flag injectors compare the flag by equality (Rapier turns horn into slicing), so two move.flag atoms in an any would differ when such an injector is on the holder; no library atom tests a combined mask; request R-B09-12";

// --- HitMultiplierAbAttr gates
bindCondition(5057, 0, { id: "move.flag", flag: "PUNCHING_MOVE" }, "gate"); // Raging Boxer
bindCondition(5096, 0, { all: [] }, "gate"); // Hyper Aggressive, every move
bindCondition(5096, 2, { all: [] }, "gate"); // Hyper Aggressive, second instance (carries the 'enraged' attr condition)
bindCondition(5156, 0, { id: "move.flag", flag: "BITING_MOVE" }, "gate"); // Primal Maw
bindLegacyClosure(5169, 0, `${MASK_FILTER} (Dual Wield, Pulse or Slicing)`, "gate");
bindCondition(5184, 0, { id: "move.type", type: "FIRE", effective: true }, "gate"); // Raging Moth
bindCondition(5249, 1, { id: "move.flag", flag: "BITING_MOVE" }, "gate"); // Devourer
bindCondition(5346, 0, { id: "move.flag", flag: "HAMMER_BASED" }, "gate"); // Jackhammer
bindCondition(5348, 0, { id: "move.type", type: "ICE", effective: true }, "gate"); // Ice Cold Hunter (weather condition is the attr's own)
bindCondition(5404, 0, { id: "move.flag", flag: "PUNCHING_MOVE" }, "gate"); // Steel Beetle
bindCondition(5424, 1, { all: [] }, "gate"); // Raging Goddess
bindCondition(5424, 3, { all: [] }, "gate"); // Raging Goddess, enraged instance
bindCondition(5456, 1, { all: [] }, "gate"); // Balloon Blitz
bindCondition(5456, 3, { all: [] }, "gate"); // Balloon Blitz, enraged instance
bindCondition(5491, 0, { all: [] }, "gate"); // Frenzied Phantom
bindCondition(5491, 3, { all: [] }, "gate"); // Frenzied Phantom, enraged instance
bindCondition(5493, 1, { id: "move.flag", flag: "BITING_MOVE" }, "gate"); // Metallic Jaws
bindCondition(5547, 2, { id: "move.flag", flag: "SLICING_MOVE" }, "gate"); // Magus Blades
bindCondition(5661, 0, { all: [] }, "gate"); // Witch Broom
bindCondition(5661, 5, { all: [] }, "gate"); // Witch Broom, enraged instance
bindCondition(5700, 0, { all: [] }, "gate"); // Ghost Frenzy
bindCondition(5700, 3, { all: [] }, "gate"); // Ghost Frenzy, enraged instance
bindCondition(5959, 2, { id: "move.flag", flag: "HORN_BASED" }, "gate"); // Grievous Spear
bindCondition(5963, 0, { id: "move.flag", flag: "HORN_BASED" }, "gate"); // Savage Spear
bindCondition(5966, 0, { id: "move.flag", flag: "PUNCHING_MOVE" }, "gate"); // Formless Fist
bindLegacyClosure(5996, 2, `${MASK_FILTER} (Minigun, Pulse or Slicing)`, "gate");
bindCondition(6039, 0, { id: "move.flag", flag: "BITING_MOVE" }, "gate"); // Dogged Jaw
bindLegacyClosure(6086, 0, `${MASK_FILTER} (Two-Chambered, Pulse or Slicing)`, "gate");
bindCondition(
  6091,
  0,
  {
    any: [
      { id: "move.flag", flag: "KICKING_MOVE" },
      { id: "move.flag", flag: "ARROW_BASED" },
    ],
  },
  "gate",
); // Flurry
bindCondition(6094, 0, { id: "move.flag", flag: "PUNCHING_MOVE" }, "gate"); // Twin Lion Fists
bindCondition(6103, 1, { id: "move.flag", flag: "BITING_MOVE" }, "gate"); // World-Eater

// --- HitMultiplierPowerAbAttr gates (same filters as the partner attr of the same ability)
bindCondition(5057, 1, { id: "move.flag", flag: "PUNCHING_MOVE" }, "gate"); // Raging Boxer
bindCondition(5096, 1, { all: [] }, "gate"); // Hyper Aggressive
bindCondition(5156, 1, { id: "move.flag", flag: "BITING_MOVE" }, "gate"); // Primal Maw
bindLegacyClosure(5169, 1, `${MASK_FILTER} (Dual Wield, Pulse or Slicing)`, "gate");
bindCondition(5184, 1, { id: "move.type", type: "FIRE", effective: true }, "gate"); // Raging Moth
bindCondition(5249, 2, { id: "move.flag", flag: "BITING_MOVE" }, "gate"); // Devourer
bindCondition(5346, 1, { id: "move.flag", flag: "HAMMER_BASED" }, "gate"); // Jackhammer
bindCondition(5404, 1, { id: "move.flag", flag: "PUNCHING_MOVE" }, "gate"); // Steel Beetle
bindCondition(5424, 2, { all: [] }, "gate"); // Raging Goddess
bindCondition(5456, 2, { all: [] }, "gate"); // Balloon Blitz
bindCondition(5491, 1, { all: [] }, "gate"); // Frenzied Phantom
bindCondition(5493, 2, { id: "move.flag", flag: "BITING_MOVE" }, "gate"); // Metallic Jaws
bindCondition(5547, 3, { id: "move.flag", flag: "SLICING_MOVE" }, "gate"); // Magus Blades
bindCondition(5661, 1, { all: [] }, "gate"); // Witch Broom
bindCondition(5700, 1, { all: [] }, "gate"); // Ghost Frenzy
bindCondition(5959, 3, { id: "move.flag", flag: "HORN_BASED" }, "gate"); // Grievous Spear
bindCondition(5963, 1, { id: "move.flag", flag: "HORN_BASED" }, "gate"); // Savage Spear
bindCondition(5966, 1, { id: "move.flag", flag: "PUNCHING_MOVE" }, "gate"); // Formless Fist
bindLegacyClosure(5996, 3, `${MASK_FILTER} (Minigun, Pulse or Slicing)`, "gate");
bindCondition(6039, 1, { id: "move.flag", flag: "BITING_MOVE" }, "gate"); // Dogged Jaw
bindCondition(6050, 1, { all: [] }, "gate"); // Contaminated (its partner ContaminatedHitMultiplierAbAttr is B16)
bindLegacyClosure(6086, 1, `${MASK_FILTER} (Two-Chambered, Pulse or Slicing)`, "gate");
bindCondition(
  6091,
  1,
  {
    any: [
      { id: "move.flag", flag: "KICKING_MOVE" },
      { id: "move.flag", flag: "ARROW_BASED" },
    ],
  },
  "gate",
); // Flurry
bindCondition(6094, 1, { id: "move.flag", flag: "PUNCHING_MOVE" }, "gate"); // Twin Lion Fists
bindCondition(6103, 2, { id: "move.flag", flag: "BITING_MOVE" }, "gate"); // World-Eater

// =============================================================================================
// B09 chunk 1. The Tier B gates of FieldStatShareAbAttr, FireUseFormChangeAbAttr and FireHitFormChangeAbAttr.
// Every line was written by hand after reading archetypes/field-stat-share.ts and archetypes/fire-interaction-form-change.ts and the
// live attrs of all users. The other five classes of the chunk (the two hazard markers, EntryTailwindClearWeatherAbAttr,
// EntryTrapOnFoeSideAbAttr and FieldCritBoostAbAttr) have no condition slot, so they have nothing to bind.
// =============================================================================================

// ---------------------------------------------------------------------------------------------
// FieldStatShareAbAttr. Slot gate: `params.stages !== 0` (the reentrancy memory is the class's guards() stage, not part of the gate).
// ---------------------------------------------------------------------------------------------
// stage.just-changed with direction "any" is `frame.stages !== 0` (evaluate/conditions.ts), the same test.
bindCondition(5290, 0, { id: "stage.just-changed", direction: "any" }, "gate"); // Sharing Is Caring

// ---------------------------------------------------------------------------------------------
// FireUseFormChangeAbAttr and FireHitFormChangeAbAttr. Slot gate: `!isInForm(pokemon, targetFormKey)` AND the move type is Fire.
//   - mon.in-form is `pokemon.getFormKey() === key`; the class reads `species.forms[formIndex]?.formKey === key`. Same for any
//     non-empty key (the key of the one user is "engulfed").
//   - move.type with effective on is `moveUser.getMoveType(move) === FIRE`. The frame's moveUser is the holder for my own attack
//     (event.after-my-hit) and the attacker for a hit on me (event.after-hit), exactly the pokemon whose getMoveType the class calls.
// The fainted test and the last-strike test are the guards() stage of the class, not part of the gate.
// ---------------------------------------------------------------------------------------------
const notEngulfedAndFire = () => ({
  all: [
    { not: { id: "mon.in-form", who: "holder", key: "engulfed" } },
    { id: "move.type", type: "FIRE", effective: true },
  ],
});
bindCondition(5373, 0, notEngulfedAndFire(), "gate"); // Flammable Coat, using a Fire move
bindCondition(5373, 1, notEngulfedAndFire(), "gate"); // Flammable Coat, hit by a Fire move
