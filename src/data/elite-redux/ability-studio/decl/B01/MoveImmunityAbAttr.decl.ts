/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 2, Tier A calc-modifier (an immunity whose whole rule is a REQUIRED constructor closure).
//
// "While the game checks whether a move can hit me, IF <rule about the move and its user>, the move has no effect."
// The constructor takes one argument, `immuneCondition`, a PreDefendAbAttrCondition `(pokemon, attacker, move)`, which
// is exactly the `defend` closure shape of the library. `canApply` has two clauses, in this order:
//   1. `!cancelled.value`                         = feasibility (another ability already blocked the move)
//   2. `this.immuneCondition(pokemon, attacker, move)` = the CONDITION slot (ctor:0), different for every ability
// `apply` sets `cancelled.value = true`; the class shows its own trigger message ("moveImmunity"). Neither reads
// `simulated`. The class is not Tier B: the swappable rule is already a constructor closure, so `buildAttr` just hands
// the compiled library tree to the real constructor.
//
// Every live closure, read from the running game (see bindings.ts for the per-ability lines):
//   (a) `pokemon !== attacker && move.hasFlag(POWDER_MOVE)`       Shield Dust, Overcoat, Powder Burst, Guardian Coat
//   (b) `pokemon !== attacker && move.hasFlag(BALLBOMB_MOVE)`     Bulletproof, Chestnut Shield
//   (c) `pokemon !== attacker && move.doesFlagEffectApply({flag: SOUND_BASED, user: attacker})`   Soundproof, Parroting
//   (d) `pokemon.getAlly() === attacker && move.is("AttackMove")` Telepathy
//   (e) `pokemon !== attacker && move.category === STATUS && ![BOTH_SIDES, ENEMY_SIDE, USER_SIDE].includes(moveTarget)`
//                                                                 Good as Gold
// (c) maps onto library atoms exactly (not side.is self, move.flag SOUND_BASED). (a), (b), (d) and (e) do not: the library
// flag atom calls `doesFlagEffectApply` (which also honours flags injected by abilities) where the original reads the
// plain `hasFlag`; there is no atom for "targets a whole side", for `instanceof AttackMove`, or for `getAlly()` (the FIRST
// ally). They stay legacy-closures with the exact function written in the reason (requests R-B01-10, 11, 12).
import { MoveImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MoveImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Make moves that meet a rule have no effect",
  summary: () =>
    "A move has no effect on this Pokemon when it meets the rule you choose. Example: the rule 'the move is a sound move' blocks every sound move, like Soundproof.",
  synonyms: [
    "soundproof",
    "bulletproof",
    "overcoat",
    "shield dust",
    "good as gold",
    "telepathy",
    "immune to a kind of move",
    "block a move group",
    "block powder moves",
  ],
  examples: ["Immune to sound moves, like Soundproof", "Immune to ball and bomb moves, like Bulletproof"],
  params: [],
  noParamsReason:
    "The class has no setting of its own: the whole rule is the yes/no condition in the first constructor slot, which staff build as an IF block.",
  conditions: [
    // Required closure `(pokemon, attacker, move) => boolean`, the same shape as the library's `defend` condition.
    { slot: "ctor:0", ctx: "defend", path: "immuneCondition", removable: false, editable: true },
  ],
  guards: [],
  feasibility: ["Does nothing when another ability already blocked the move"],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "a sound move, a ball move, a powder move and a plain move",
      axes: { foeMove: ["HYPER_VOICE", "SHADOW_BALL", "SLEEP_POWDER", "TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (10 attrs): Shield Dust (19 attr 1), Overcoat (142 attr 1), Powder Burst (5243 attr 1), Guardian Coat (5539 attr 2): powder moves; Bulletproof (171) and Chestnut Shield (5657 attr 1): ball and bomb moves; Soundproof (43) and Parroting (5272 attr 1): sound moves; Telepathy (140): attack moves of my ally; Good as Gold (283): status moves except whole-side ones. Only Soundproof and Parroting are bound to library atoms, the other 8 are legacy-closures pending R-B01-10, R-B01-11 and R-B01-12. The condition is declared not removable: without it the class would make every move harmless, which is no sensible design. Subclasses MoveImmunityStatStageChangeAbAttr and WeatherBasedMoveBlockAbAttr call into this class from other batches. Oddity (not fixed): Telepathy only protects from the first ally (`getAlly()` is the first entry of `getAllies()`), so with a larger team on the field a second ally is not covered.",
});
