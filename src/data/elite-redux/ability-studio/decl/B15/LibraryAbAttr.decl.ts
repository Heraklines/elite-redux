/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 3. Tier C, engine-query (a presence marker). "Record the first move each foe uses (last 3 kept), take 15% less damage from a repeated recorded move, and cast recorded moves with 2 shared PP."
//
// Source: src/data/elite-redux/abilities/library.ts, class LibraryAbAttr (extends PostSummonAbAttr; constructor passes showAbility false, activateOnGain stays true; apply is empty, there is no canApply of its own).
// It is a pure marker. Three engine seams find the holder's active LibraryAbAttr by constructor name (libraryOf / hasLibrary); state is per holder and per wave (WeakMap LIBRARY_STATE, reset when the wave index changes):
//   RECORD  erLibraryRecordFoeMove(user, move), from MovePhase.start for a genuine (non-virtual) use: for each opposing holder, recordInto: skip a foe already recorded this battle (recordedFoeIds),
//           push {moveId, recordedTurnKey}, drop the oldest beyond maxRecordedMoves. Status moves are recorded.
//   DAMPEN  erLibraryDamageMultiplier(defender, move), from Pokemon.calcDamage: for the defender and each of its allies that carries Library, a recorded entry for this move id with
//           recordedTurnKey !== the current turn key returns damageMultiplier (the first holder found); else 1. The recording turn itself, and its multi-hits, are exempt.
//   CAST    canCastLibrary / commitLibraryCast (library-panel UI, fight menu): needs entries and castPp left; spends one shared PP and arms pendingCast; erLibraryCastIsSpecial makes a damaging cast
//           use Sp. Atk against Sp. Def (Pokemon.calcDamage). A fresh state starts with castPpRemaining = castPp.
// Constructor change (behaviour-neutral): the three numbers (defaults are the old literals) are constructor arguments; the seams read them from the holder's live attr (state creation, record, dampener).
// No random draw. State: per holder and wave in a module WeakMap (read by the AI snapshot through erLibraryState).
import { LibraryAbAttr } from "#data/elite-redux/abilities/library";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(LibraryAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Record foes' first moves, resist them later, cast them",
  summary: params =>
    `Records the first move each foe uses (the last ${params.maxRecordedMoves} are kept). A recorded move used again on a later turn does x${params.damageMultiplier} damage to my side. I can cast recorded moves, ${params.castPp} PP per battle shared.`,
  synonyms: [
    "library",
    "learn foe moves",
    "copy moves",
    "move memory",
    "scout the foe",
    "mimic",
    "resist repeated moves",
  ],
  examples: [
    "Remember what the foe used first, take 15% less damage from it afterwards and cast it myself",
  ],
  params: [
    {
      id: "maxRecordedMoves",
      ctorIndex: 0,
      path: "maxRecordedMoves",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Moves kept in the memory (the most recent win)",
      editable: true,
      default: 3,
    },
    {
      id: "castPp",
      ctorIndex: 1,
      path: "castPp",
      control: "number",
      min: 0,
      max: 10,
      step: 1,
      integer: true,
      label: "Cast PP per battle, shared by every recorded move",
      editable: true,
      default: 2,
    },
    {
      id: "damageMultiplier",
      ctorIndex: 2,
      path: "damageMultiplier",
      control: "slider",
      min: 0.1,
      max: 2,
      step: 0.05,
      label: "Damage multiplier against a repeated recorded move (0.85 = 15% less)",
      editable: true,
      default: 0.85,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "It records only while I am on the field, and each foe is recorded once per battle (its first move); status moves count",
    "The recording turn itself, and any extra hits in it, are not weakened",
    "The weaker damage applies to me and my ally alike",
    "A damaging cast is always a special attack (my Sp. Atk against the target's Sp. Def); a status cast works as printed",
    "Recording, the damage change and casting are built into the game's move handling and fight menu and are not part of this block",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  l2StaticReason:
    "The marker is consulted by the move handling (recording), the damage calculation and the fight menu, none of which is a dispatched moment; the twin compares whole battles of the one user instead.",
  probes: [{ name: "a foe uses a move, then uses it again", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "Engine-query (presence marker read by three seams by constructor name), counted apart from the decomposed classes; the foundation owns any abilityQuery routing. 1 attr in 1 ability: Library (5928 attr 0). The class has no condition of its own. The mechanic is three separate rules that a future library could express: record (moment 'after a foe uses a move' exists as event.after-any-move, plus a memory effect that the library lacks), dampen (a calc.damage-taken multiplier whose condition is 'this move was recorded earlier') and cast (a fight menu action); requested as R-B15-21 (memory effect and the atom 'the move was recorded by me on an earlier turn') and R-B15-22 (a 'cast a remembered move' action). The three numbers are typed params. Suspected oddities, NOT fixed: (1) the cast PP of a fresh state is read when the state is created (first record, cast or dampener check of the wave), so changing the setting mid-battle has no effect until the next wave; (2) pendingCast is only cleared by a wave change, so a recorded move used later in the SAME turn by the holder is treated as the cast (special); (3) erLibraryDamageMultiplier returns on the first holder with a matching recorded entry, so two Library holders on one side do not stack; (4) the memory is per holder INSTANCE and per wave index, so a re-fought wave resets it.",
});
