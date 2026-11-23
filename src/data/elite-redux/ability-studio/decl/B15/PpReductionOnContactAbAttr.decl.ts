/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 3. Tier B. "When a contact move hits me, the attacker's move loses 4 PP, and one of my used-up moves gets that PP back."
//
// Source: src/data/elite-redux/abilities/pp-reduction-on-contact.ts, class PpReductionOnContactAbAttr (extends PostDefendAbAttr; constructor takes ONE options object, showAbility stays true).
// canApply, now guards && gate && residual in the ORIGINAL clause order (no random draw in canApply):
//   1. guards    hitResult < HitResult.NO_EFFECT                                                        -> GUARD (the hit connected: not a miss, a block or an immunity)
//   2. gate      !contactRequired || move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: attacker, target: holder })  -> CONDITION (the contact clause)
//   3. residual  attacker.moveset.some(m => m.moveId === move.id)                                      -> feasibility (the used move is in the attacker's list)
// apply (effect), not when simulated: movesetMove = the attacker's entry for the move id; usePp(reduction); stolenPp = how much ppUsed really grew (capped by the move's PP);
//   when refundHolder and stolenPp > 0: depleted = my moves with ppUsed > 0; if any, ONE seeded draw pokemon.randBattleSeedInt(depleted.length) (always one draw, even with one candidate)
//   picks the move whose ppUsed drops by stolenPp (not below 0). No message.
// Refactor (pure move of code, spec 3.1): canApply = gatedCanApply(this, params); guards, gate and residual are the three clauses above verbatim. `gateOverride` is declared for the compiler.
// contactRequired changes the SHAPE of the gate (an always-true gate when false), so it is not an editable setting: staff add or remove the contact condition block instead.
import { PpReductionOnContactAbAttr } from "#data/elite-redux/abilities/pp-reduction-on-contact";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PpReductionOnContactAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Take PP from the attacker's move when it touches me",
  summary: params =>
    `When a move that makes contact hits me, the attacker's move loses ${params.reduction} PP${params.refundHolder === true ? ", and one of my used-up moves gets that PP back" : ""}.`,
  synonyms: [
    "spiteful",
    "spite",
    "drain pp",
    "reduce pp",
    "steal pp",
    "pp loss on contact",
    "punish the attacker's move",
  ],
  examples: ["Contact moves that hit me lose 4 PP and I get it back, like Spiteful"],
  params: [
    {
      id: "reduction",
      ctorIndex: 0,
      ctorOption: "reduction",
      path: "reduction",
      control: "number",
      min: 1,
      max: 20,
      step: 1,
      integer: true,
      label: "PP the attacker's move loses",
      editable: true,
      gateIndependent: true,
      default: 4,
    },
    {
      id: "contactRequired",
      ctorIndex: 0,
      ctorOption: "contactRequired",
      path: "contactRequired",
      control: "boolean",
      label: "Only when the move makes contact",
      // Changes the shape of the gate; staff add or remove the contact condition block instead.
      editable: false,
      default: true,
    },
    {
      id: "refundHolder",
      ctorIndex: 0,
      ctorOption: "refundHolder",
      path: "refundHolder",
      control: "boolean",
      label: "Give the taken PP back to one of my used-up moves",
      editable: true,
      gateIndependent: true,
      default: false,
    },
  ],
  conditions: [
    // The gate is the contact clause (move.flag MAKES_CONTACT), always true when contact is not required.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must have connected: a miss, a block or an immunity does nothing",
    "The attacker's move list must still contain the move that was used; a move that was called or locked in is left alone",
    "The PP taken is limited to what the move still has",
    "When the PP is given back, one of my moves that has used PP is picked at random",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: ["reduction", "refundHolder"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: only when the PP is given back and at least one of my moves has used PP, one seeded draw picks which move (always one draw, even with a single candidate)",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      // A contact move and a non-contact move: the contact clause decides.
      name: "contact and non-contact hit",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, justified; the trigger and the contact condition are separate blocks. 1 attr in 1 ability: Spiteful (5247 attr 0; reduction 4, contact required, PP given back). The effect cannot be split because the library has no PP effect: a block 'Reduce {target}'s move PP by N' and a block 'Give PP back to one of my used-up moves' (the random pick is part of it); requested as R-B15-25. The 'the hit connected' clause is kept in the class as a safety rule (guards): the guard registry has no id for it, so it is listed as feasibility and requested as R-B15-26 (guard 'hit-connected', hitResult < NO_EFFECT). The contact clause is bound to the library atom move.flag MAKES_CONTACT, which calls the same Move.doesFlagEffectApply with the attacker as user and me as target. Suspected oddities, NOT fixed: (1) the class defaults refundHolder to false while the only user passes true, so a rebuilt rule with the default would not give PP back; (2) the effect shows no message; (3) a move the attacker does not have in its list (Mimic, Sleep Talk, called moves) is silently ignored by the residual.",
});
