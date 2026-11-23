/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Porous, part 2 of 4 (Tier B, calc-modifier). "Sound-based moves do half damage to me."
//
// Source: abilities/newcomer-signature-mechanics.ts, PorousSoundReductionAbAttr (ReceivedMoveDamageMultiplierAbAttr,
// constructor takes NO arguments and hands the base class a hidden closure plus the multiplier 0.5):
//   closure   (holder, attacker, move) => move.doesFlagEffectApply({ flag: SOUND_BASED, user: attacker })
//             -> library atom move.flag {SOUND_BASED} (the precedent Heavy Metal binding uses the same atom)
//   apply     the base class's: damage = toDmgValue(damage * 0.5)
// A "ctor:0" slot is impossible (arity 0), so this is Tier B: the closure is one shared module function used by BOTH
// the constructor and the new `gate`. One clause, no residual, no RNG.
import { PorousSoundReductionAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PorousSoundReductionAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Halve damage from sound-based moves",
  summary: () => "Sound-based moves do half damage to me. Example: a sound move that would deal 100 damage deals 50.",
  synonyms: [
    "soundproof",
    "sound resist",
    "resist sound moves",
    "half damage from sound",
    "bulletproof style",
    "porous",
  ],
  examples: ["Take half damage from sound-based moves"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the 0.5 multiplier and the sound-move test are passed to the base class by the constructor itself. Staff reach the same behaviour with a composed rule (a damage-taken trigger, a move-property condition and the multiply-damage-taken block set to 0.5).",
  conditions: [{ slot: "gate", ctx: "params", lib: "move.flag", removable: true, editable: true }],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-damage-taken", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // A sound move (Hyper Voice is not in the grid; Bite/Ember/Water Gun are not sound), against the holder at different HP.
      name: "attacks of different kinds",
      axes: { hp: ["max", "max-1"], foeMove: ["WATER_GUN", "BITE", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users: Porous (5974, attr 1). Fully decomposed: one condition (move.flag SOUND_BASED) bound to a library atom plus one calc effect; nothing stays inside the class. The 0.5 multiplier is a literal in the constructor call, not an argument, so it is not a param (staff use the multiply-damage-taken block for another number). The base class's `affectsFixedDamage` is false (default), so fixed-damage moves are not halved. The rebuilt `move.flag` atom passes the holder as target while the original passes none; the two only differ for contact checks against Substitute, which a sound flag never reaches, and the L1 grid shows them equal.",
});
