/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 3 / calc-modifier, Tier A (the one constructor closure is bound), PACKAGE for the effect. Read from the source
// (archetypes/curse-attacker-on-form-block.ts), its parent FormBlockDamageAbAttr and grandparent ReceivedMoveDamageMultiplierAbAttr
// (ab-attrs.ts) and from the one live instance (Patchwork, attr 2 of 9). The class adds only `apply`; canApply is the parent's:
//
//   inherited canApply (FormBlockDamageAbAttr), in its order:
//     1. damage.value > 0                                          the hit would really hurt                       (feasibility)
//     2. pokemon.formIndex === formIndex                           I am still in the form that blocks damage        (the formIndex setting)
//     3. this.condition(pokemon, opponent, move)                   the constructor closure, slot ctor:3 (default () => true)
//     4. !move.hitsSubstitute(opponent, pokemon)                   the hit is not on my substitute                  (feasibility)
//     5. canBreakForm(pokemon)                                     a form change on the ability trigger exists      (feasibility)
//   apply (this class): FormBlockDamageAbAttr.apply (damage = 0, recoil of `recoil` of max HP, change form), THEN, unless
//     simulated and with an opponent, the opponent gets the CURSED lasting effect (source: the holder). No random draw.
//
// The class does not edit its parent, so clauses 1, 2, 4 and 5 stay inside the inherited canApply (a request for the owner of
// FormBlockDamageAbAttr, see the notes). Only the condition closure of clause 3 is a swappable block.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { CurseAttackerOnFormBlockDamageAbAttr } from "#data/elite-redux/archetypes/curse-attacker-on-form-block";

export default defineDecl(CurseAttackerOnFormBlockDamageAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Block one hit, then curse the attacker (like Patchwork)",
  summary: params =>
    `While my form number is ${params.formIndex}, a damaging hit is blocked, I take ${Number((Number(params.recoil) * 100).toPrecision(4))}% of my max HP as recoil, I change form and the attacker is cursed.`,
  synonyms: [
    "disguise and curse",
    "patchwork",
    "block first hit",
    "curse the attacker",
    "busted form",
    "mimikyu disguise",
    "break the disguise",
  ],
  examples: ["Block the first damaging hit like Disguise, and curse whoever broke it"],
  fixedCtorArgs: { 1: "abilityTriggers:disguiseAvoidedDamage" },
  params: [
    {
      id: "formIndex",
      ctorIndex: 0,
      path: "formIndex",
      control: "number",
      min: 0,
      max: 9,
      step: 1,
      integer: true,
      label: "Form number that blocks damage (0 = the first form)",
      editable: true,
      default: 0,
    },
    {
      id: "recoil",
      ctorIndex: 2,
      path: "recoil",
      control: "number",
      min: 0,
      max: 0.5,
      step: 0.005,
      label: "Recoil when the block breaks, as a share of max HP (0.125 = 1/8, 0 = none)",
      editable: true,
      default: 0.125,
    },
  ],
  conditions: [
    // The constructor closure (fourth argument, default () => true): an extra rule the hit must pass, with the engine's defend
    // signature (target, attacker, move). Patchwork passes the default, bound to the empty (always true) group.
    { slot: "ctor:3", ctx: "defend", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really deal damage",
    "I must still be in the form that blocks damage",
    "The hit must not land on my substitute",
    "A form to break into must exist for me",
  ],
  effect: { id: "effect.package", params: ["formIndex", "recoil"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "none",
    rngOrder: [],
    state: "none",
    simulated: "respects",
  },
  probes: [{ name: "the foe hits the holder", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier A for the one closure (ctor:3, bound for Patchwork as the always-true group), PACKAGE for the effect. Written reason for the package: the block-the-hit, recoil and form-change halves are FormBlockDamageAbAttr.apply, owned by another class (and another batch), and the curse half runs after it on the same hit; splitting would re-implement the parent. The library has no block that does 'cancel the hit and change form' (effect.negate writes `cancelled`, this WHEN modifies `damage`). The curse half alone is the library effect apply-tag (CURSED on the attacker). The WHEN is separate (calc.damage-taken) and the condition closure is a swappable IF; formIndex and recoil are typed settings; the message key is fixed (abilityTriggers:disguiseAvoidedDamage). Inherited clauses (damage above 0, the form check, not on a substitute, a form to break into) stay in the parent's canApply and are listed as feasibility; once FormBlockDamageAbAttr is split into guards, gate and residual by its own batch, this subclass inherits the split with no change (request R-B08-32). User: Patchwork (attr 2). L1 cannot reach the form check (no grid Pokemon is in a form that blocks), so the B08 test drives the class with a stand-in Pokemon. NOTE: the engine's trace for calc.damage-taken shows this attr being evaluated; the default holder is not a Mimikyu, so canApply is false there and the twin proves the rebuild equal in the not-triggered case.",
});
