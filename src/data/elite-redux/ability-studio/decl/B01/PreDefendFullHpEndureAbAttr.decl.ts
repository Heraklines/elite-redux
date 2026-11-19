/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01, Tier C calc-modifier ("Works as one piece" in spirit, but a real calc hook). See ../PRECEDENTS.md.
//
// "While the game calculates the damage I take, if the hit would knock me out from full HP, I survive with 1 HP."
// Clauses of `canApply`, in the ORIGINAL order (all pure, no random draw, no side effect):
//   1. `pokemon.isFullHp()`                       = condition in spirit ("at full HP"), the design of Sturdy
//   2. `pokemon.getMaxHp() > 1`                   = feasibility (a 1 HP Pokemon cannot be left at 1 HP)
//   3. `damage.value >= pokemon.hp`               = feasibility ("the hit would knock me out")
//   4. `!pokemon.getTag(BattlerTagType.STURDY)`   = feasibility ("not already enduring this turn")
// `apply` only adds the STURDY tag for 1 turn (skipped when `simulated`); the damage pipeline reads the tag later and
// clamps the damage so 1 HP stays. The engine asks this attr at pokemon.ts:6386, after Friend Guard and before the
// "ModifiedDamageAttr" step, and not at all when the attacker ignores abilities.
//
// WHY TIER C AND NOT B: clause 1 would be the replaceable gate (Tier B: `gate` = hp.full, `residual` = clauses 2 to 4).
// Four ER classes extend this one (PreFaintReviveAbAttr, PostFaintDetonateAbAttr, PostFaintReviveAbAttr,
// CelestialJellyAbAttr) and PreFaintReviveAbAttr already owns a PRIVATE field called `gate`, so adding the Tier B
// methods to this base class would not compile. Splitting it needs that field renamed first (another batch's file).
import { PreDefendFullHpEndureAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PreDefendFullHpEndureAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Survive a knockout hit from full HP",
  summary: () =>
    "At full HP, a hit that would knock me out leaves me with 1 HP instead, once per turn. Example: a 300 damage hit on a 200 HP Pokemon leaves 1 HP.",
  synonyms: ["sturdy", "endure", "survive at 1 hp", "cannot be one hit knocked out", "focus sash", "immovable object"],
  examples: ["Survive any hit that would knock me out while at full HP, like Sturdy"],
  params: [],
  noParamsReason:
    "The rule is fixed in the class (no constructor argument): full HP, a lethal hit and a 1 HP leftover. A configurable version is a separate ER class (see the note).",
  conditions: [],
  guards: [],
  feasibility: [
    "I must be at full HP",
    "My max HP must be above 1",
    "The hit must be strong enough to knock me out",
    "I must not already be enduring a hit this turn",
    "Not used when the attacker's move ignores abilities",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Full HP (the endure can fire) and one HP below full (it must not).
      name: "full HP against a strong hit",
      axes: { hp: ["max", "max-1"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (2 attrs): Sturdy (attr 0, followed by BlockOneHitKOAbAttr, which is dead in ER because the four OHKO moves became normal damaging moves), Immovable Object (attr 1). Tier B was NOT done on purpose, see the header: PreFaintReviveAbAttr has a private field named gate. Requests in requests/B01.md: an effect 'survive a knockout hit with 1 HP' and an atom 'the hit would knock me out'. Subclasses are separate classes with their own declarations; PreFaintReviveAbAttr and CelestialJellyAbAttr override canApply and do not call this one.",
});
