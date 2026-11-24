/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 4 / calc-modifier, Tier B. Read from the source (archetypes/dodge-first-super-effective.ts, its parent TypeImmunityAbAttr in ab-attrs.ts, the
// dispatch Pokemon.getAttackTypeEffectiveness -> applyAbAttrs("TypeImmunityAbAttr", { pokemon: defender, opponent: attacker, move, cancelled, typeMultiplier }),
// the battle-data field in pokemon-data.ts) and from the two live users, Anticipation (107, attr 1) and Telepathy (140, attr 2). The class passes
// the immune type `null` to the parent and overrides canApply, so the parent's own test is never asked. canApply was ONE `&&` chain of pure
// reads and is now `guards && gate && residual`:
//
//   guards    1. the move is an attacking move (move.is("AttackMove"))
//             3. the damage comes from another Pokemon (attacker !== pokemon): the charge is not burned on self or ally hits
//   gate      4. the once-per-battle charge is still there: !pokemon.battleData.anticipationDodgeUsed        -> atom time.once-per (battle)
//   residual  2. the type chart multiplier of the hit is at least minMultiplier (2): typeMultiplier.value >= 2   -> NO library atom yet (R-B08-37)
//   apply     typeMultiplier.value = 0, cancelled.value = true (hides the "No Effect" message); unless simulated, battleData.anticipationDodgeUsed = true.
//             getTriggerMessage shows the "avoided damage" line. No random draw.
//
// Every clause is a pure read and no random number is drawn, so sorting them (original order 1, 2, 3, 4) by kind cannot change the answer.
// `minMultiplier` is new as a constructor argument (default 2, what both users get): the one number of the rule is a typed setting.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { DodgeFirstSuperEffectiveAbAttr } from "#data/elite-redux/archetypes/dodge-first-super-effective";

export default defineDecl(DodgeFirstSuperEffectiveAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Dodge the first super effective hit of a battle",
  summary: params =>
    `The first attack that hits me for ${params.minMultiplier} times damage or more (super effective) does nothing, once per battle. Example: 2 means a normal super effective hit.`,
  synonyms: [
    "anticipation",
    "telepathy",
    "dodge one super effective hit",
    "first weakness hit misses",
    "once per battle dodge",
    "avoid damage",
  ],
  examples: ["Dodge one super effective hit per battle", "The first hit that would be 2x or more does nothing"],
  params: [
    {
      id: "minMultiplier",
      ctorIndex: 0,
      path: "minMultiplier",
      control: "number",
      min: 1,
      max: 16,
      step: 0.25,
      label: "Damage multiplier from which a hit is dodged (2 = super effective)",
      editable: true,
      gateIndependent: true,
      default: 2,
    },
  ],
  conditions: [
    // The gate is [time.once-per battle] (bindings.ts): the charge of this battle is not spent yet.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must be an attacking move",
    "The hit must come from another Pokemon, not from me",
    "The hit must be super effective (its type matchup multiplier is at least the number above)",
  ],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", rngOrder: [], state: "battle", simulated: "ignores" },
  probes: [
    {
      // Water Gun, Bite and Ember against the grid's holder types give a super effective, a neutral and a resisted matchup.
      name: "super effective, neutral and resisted foe moves",
      axes: { foeMove: ["WATER_GUN", "BITE", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand (guards: attacking move, another Pokemon; gate: the charge is unspent; residual: the multiplier test). PARTLY DECOMPOSED, request R-B08-37: the multiplier test reads `typeMultiplier.value`, the running chart multiplier that the engine hands to this very hook; the library has no slot for it (the frame has no typeMultiplier) and move.effectiveness would call getMoveEffectiveness, which itself asks this hook (a loop) and is a different number. So that clause stays in the class as a locked 'also requires' line until an atom `move.type-multiplier` (with a slot) exists; this is the clause marked legacy-closure-pending-request. The effect is `effect.negate` (the library calc effect that sets `cancelled`), but the class ALSO zeroes typeMultiplier and spends the charge, so the effect is partly a package: nothing in the library spends a once-per-battle memory by itself except the atom time.once-per, which does it when the rule applies. The charge: the class keeps it in battleData.anticipationDodgeUsed (a plain field), the library atom keeps its own memory in a WeakMap keyed by the same battle-data object; both are reset when a new battle starts and both are written when the rule applies, so a rebuilt attr is consistent with itself, but the two stores are separate (see request R-B08-26, extended to this class, which asks for an atom that reads and writes a named field). Users (2): Anticipation (107, attr 1, after PostSummonMessageAbAttr, before BiomeRevealBonusAbAttr) and Telepathy (140, attr 2, after MoveImmunityAbAttr and PostSummonMessageAbAttr), both with the default 2, both gate [time.once-per battle]. ODDITIES, NOT FIXED: (1) `simulated`: canApply and apply ignore it for the multiplier (a simulated type-effectiveness call is zeroed just like the real one) and only the charge write skips simulated calls, so a preview already counts the dodge while the charge is spent only by the real hit. (2) getTriggerMessage reuses the Ice Face line ('avoided damage'). showAbility is true (TypeImmunityAbAttr passes true to AbAttr).",
});
