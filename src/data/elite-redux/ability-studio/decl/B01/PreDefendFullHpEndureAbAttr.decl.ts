/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01, Tier B calc-modifier (the gate "I am at full HP" is split out). See ../PRECEDENTS.md and spec 3.3.
//
// "While the game calculates the damage I take, if I am at full HP and the hit would knock me out, I survive with 1 HP."
// The old `canApply` had four clauses, all pure (no random draw, no side effect), in this ORIGINAL order:
//   1. `pokemon.isFullHp()`                       = the GATE (library atom hp.full; the design condition of Sturdy)
//   2. `pokemon.getMaxHp() > 1`                   = residual / feasibility (a 1 HP Pokemon cannot be left at 1 HP)
//   3. `damage.value >= pokemon.hp`               = residual / feasibility ("the hit would knock me out")
//   4. `!pokemon.getTag(BattlerTagType.STURDY)`   = residual / feasibility ("not already enduring this turn")
// canApply is now `gatedCanApply`: gate (clause 1), then residual (clauses 2 to 4), same order, same short-circuiting.
// `apply` only adds the STURDY tag for 1 turn (skipped when `simulated`); the damage pipeline reads the tag later and
// clamps the damage so 1 HP stays. The engine asks this attr at pokemon.ts:6386, after Friend Guard and before the
// "ModifiedDamageAttr" step, and not at all when the attacker ignores abilities.
//
// The four ER subclasses (PreFaintReviveAbAttr, PostFaintDetonateAbAttr, PostFaintReviveAbAttr, CelestialJellyAbAttr)
// override `canApply` and never reach the split. PreFaintReviveAbAttr used to own a private field `gate`, which would
// clash with the new `gate()` method; the field was renamed to `hpGate` (pure rename, `getGate()` is unchanged).
import { PreDefendFullHpEndureAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PreDefendFullHpEndureAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Survive a knockout hit with 1 HP while at full HP",
  summary: () =>
    "When I am at full HP, a hit that would knock me out leaves me with 1 HP instead, once per turn. Example: a 300 damage hit on a 200 HP Pokemon leaves 1 HP.",
  synonyms: ["sturdy", "endure", "survive at 1 hp", "cannot be one hit knocked out", "focus sash", "immovable object"],
  examples: ["Survive any hit that would knock me out while at full HP, like Sturdy"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: the 1 HP leftover is fixed. The one rule staff may change, full HP, is the gate condition below, not a setting.",
  conditions: [
    // The gate: library atom hp.full (calls pokemon.isFullHp(), the same predicate); each user's binding is in bindings.ts.
    { slot: "gate", ctx: "params", lib: "hp.full", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "My max HP must be above 1",
    "The hit must be strong enough to knock me out",
    "I must not already be enduring a hit this turn",
    "Not used when the attacker's move ignores abilities",
  ],
  effect: { id: "effect.survive-lethal-hit", params: [] },
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
    "Users (2 attrs): Sturdy (id 5, attr 0, followed by BlockOneHitKOAbAttr, which is dead in ER because the four OHKO moves became normal damaging moves) and Immovable Object (id 5490, attr 1). Both gates are the plain atom hp.full on the holder. The Tier B split moved clause 1 to gate() and clauses 2 to 4 to residual(), nothing else changed. Subclasses are separate classes with their own declarations; PreFaintReviveAbAttr and CelestialJellyAbAttr override canApply and do not call this one. Requests in requests/B01.md: effect survive-lethal-hit (added as planned) and the atom 'the hit would knock me out' for a future finer split.",
});
