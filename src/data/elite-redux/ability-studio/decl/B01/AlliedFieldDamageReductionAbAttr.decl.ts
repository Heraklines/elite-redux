/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01, Tier C calc-modifier. See ../PRECEDENTS.md.
//
// "While the game calculates the damage an ALLY of mine takes, multiply it." The dispatch site (pokemon.ts:6367) runs
// after the target's own ReceivedMoveDamageMultiplierAbAttr and loops over every active ally of the Pokemon that is
// being hit, handing each one's ability the same parameters with `pokemon` replaced by that ally. So in this hook the
// frame's `holder` is the Friend Guard owner (the ally), NOT the Pokemon taking the hit, and `other` is the attacker.
// A library condition such as hp.full{holder} would therefore read the owner's HP, not the victim's; the class has no
// condition, so nothing is bound.
//   - `canApply`: not overridden (always true); the only gates are at the dispatch site: more than one Pokemon per
//     side, the ally is active, the attacker does not ignore abilities, no Overrule crit.
//   - `apply`: `damage.value = toDmgValue(damage.value * damageMultiplier)`, the same rounding as Multiscale.
// The multiplier is a live field: init-elite-redux-vanilla-rebalance.ts rewrites Friend Guard's 0.75 to 0.5 after
// construction, so the declaration reads the field and every user reads back 0.5.
import { AlliedFieldDamageReductionAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(AlliedFieldDamageReductionAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Reduce the damage my allies take",
  summary: params =>
    `Damage my allies take is multiplied by ${params.multiplier}. Example: 0.5 means they take half. Only works in battles with allies on the field.`,
  synonyms: ["friend guard", "protect allies", "ally damage reduction", "shield my partner", "team guard", "caretaker"],
  examples: ["My ally takes half damage while I am on the field, like Friend Guard"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "damageMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Damage multiplier for my allies (0.5 = half)",
      editable: true,
      default: 0.5,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only works when more than one Pokemon is on each side (doubles or bigger)",
    "Every ally with this ability reduces the damage, so two of them stack",
    "Ignored when the attacker's move ignores abilities (Mold Breaker style)",
  ],
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "an attack on the holder's ally in a double battle", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  l2StaticReason:
    "The shared damage-taken template is a single battle, where the dispatch loop over allies is empty, so the original never evaluates this attr there; test/tests/elite-redux/decomp/B01/allied-field.test.ts runs a real double battle for the original and the rebuilt ability and compares the traces.",
  status: "decomposed",
  notes:
    "Users (3 attrs): Friend Guard (attr 0, 0.75 raised to 0.5 at init), Food Lovers (attr 1) and Caretaker (attr 2), both 0.5. The ability-level `.ignorable()` of Friend Guard is an ability flag and not part of this class. Request in requests/B01.md: a precise effect 'multiply the damage my allies take' (the existing one says 'I take'), and a harness template for doubles. In this hook the holder is the ally, see the header.",
});
