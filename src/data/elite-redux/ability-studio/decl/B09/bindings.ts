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
