/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Center of Attention, part 1 of 2 (Tier B, calc-modifier). "Spread moves deal 0.75x damage to me."
//
// Source: abilities/newcomer-signature-mechanics.ts, CenterSpreadReductionAbAttr (ReceivedMoveDamageMultiplierAbAttr).
// The constructor used to be `super((_holder, _attacker, move) => move.isMultiTarget(), 0.75)`; it is now
// `constructor(damageMultiplier = 0.75) { super(() => true, damageMultiplier) }` and the rule moved into the gate.
//   base canApply = condition(holder, attacker, move); apply: damage.value = toDmgValue(damage.value * multiplier)
//   canApply now (ONE clause, pure, no RNG): the gate `move.isMultiTarget()`, i.e. the move's target kind is one of
//   ALL_OTHERS, ALL_NEAR_OTHERS, ALL_NEAR_ENEMIES, ALL_ENEMIES, USER_AND_ALLIES, ALL, USER_SIDE, ENEMY_SIDE, BOTH_SIDES
//   (a property of the move, so it stays true when only one target is left).
// Dispatched with ReceivedMoveDamageMultiplierAbAttr (the game calculates damage I take).
import { CenterSpreadReductionAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CenterSpreadReductionAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take less damage from spread moves",
  summary: params =>
    `While the game calculates the damage I take, spread moves are multiplied by ${params.multiplier}. Example: 0.75 = takes a quarter less, even when only one target is left.`,
  synonyms: [
    "spread move resist",
    "resist earthquake",
    "less damage from multi target moves",
    "group move reduction",
    "center of attention",
    "doubles tank",
  ],
  examples: ["Take 25% less damage from moves that hit several Pokemon"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "damageMultiplier",
      control: "number",
      label: "Damage multiplier (0.75 = a quarter less)",
      editable: true,
      gateIndependent: true,
      default: 0.75,
      min: 0,
      max: 4,
      step: 0.05,
    },
  ],
  conditions: [
    // The whole original closure: `move.isMultiTarget()`. No library atom equals it (see bindings.ts and R-B13-39).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-damage-taken", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Water Gun is single-target, so the gate stays closed; the twin shows the rebuilt attr is evaluated.
      name: "single-target moves against the holder",
      axes: { hp: ["max", "max-1"], foeMove: ["WATER_GUN", "BITE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Fully decomposed: trigger 'while the game calculates damage I take', effect 'multiply damage I take' (library effect, the multiplier is a param), condition = the move is a spread move. The condition is a legacy-closure binding because no library atom equals Move.isMultiTarget: move.target-kind covers ALL_NEAR_ENEMIES / ALL_ENEMIES / ENEMY_SIDE (all-foes), ALL_OTHERS / ALL_NEAR_OTHERS (all-others) and BOTH_SIDES / USER_SIDE (field), but its field kind also holds ALL and PARTY, and USER_AND_ALLIES sits in 'user-or-ally' with USER, NEAR_ALLY, ALLY and USER_OR_NEAR_ALLY; an any() of kinds would also match PARTY, USER, NEAR_ALLY, ALLY and USER_OR_NEAR_ALLY (requested as R-B13-39 `move.hits-several-targets`). The multiplier was a literal (0.75), now the constructor argument 0. Users: Center of Attention (5993, attr 0; attr 1 is the marker). ODDITIES (not fixed): (1) the rule is a property of the move's target kind, so it also applies to a spread move that ended up with a single target (as the ability text says); (2) field-wide moves such as Rain Dance count as spread moves but deal no damage, so the multiplier never matters for them; (3) the constructor no longer passes the old closure to the base class, so `condition` on a live instance is always-true and the gate is the only place of the rule (same pattern as Ring General).",
});
