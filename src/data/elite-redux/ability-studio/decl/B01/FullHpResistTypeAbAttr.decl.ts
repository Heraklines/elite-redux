/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 2, Tier B calc-modifier (Tera Shell). The "full HP" rule is the gate, everything else stays in the class.
//
// "While the game calculates the type matchup against me, IF I am at full HP, no attack counts as more effective than
// x0.5." Four clauses, all pure, in this ORIGINAL order (ab-attrs.ts, `FullHpResistTypeAbAttr.canApply`):
//   1. `typeMultiplier instanceof NumberHolder`   = guard of the frame (the class's own `guards()`, never removable)
//   2. `!move?.hasAttr("FixedDamageAttr")`        = feasibility, a fixed-damage move (Seismic Toss) has no matchup
//                                                   to cap (the class's `guards()`)
//   3. `pokemon.isFullHp()`                       = the GATE, the library atom hp.full (the design rule of Tera Shell)
//   4. `typeMultiplier.value > 0.5`               = residual: only a matchup ABOVE the ceiling is capped, so a x0.25 or
//                                                   x0 hit is never raised
// canApply is now `gatedCanApply`: guards (1, 2), gate (3), residual (4), same order, same short-circuiting.
// `apply` sets `typeMultiplier.value` to the ceiling and caches the same number in `pokemon.turnData.moveEffectiveness`
// (reset after each hit by move-effect-phase.ts:1276). The two 0.5 literals and the one in clause 4 were the same number,
// they are now the single constructor argument `matchupCeiling` (default 0.5, a field the declaration reads back).
// The class shows its own trigger message ("fullHpResistType").
//
// The dispatch (pokemon.ts:4279) runs AFTER every other immunity and not for status moves or when abilities are ignored.
// TimeLimitedEffectivenessFloorAbAttr (ER archetype) extends this class but overrides `canApply`, so it never uses the
// split; its inherited `apply` now reads the ceiling, which is 0.5 for it as well.
import { FullHpResistTypeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FullHpResistTypeAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.type-matchup",
  label: "Limit how effective attacks are against me",
  summary: params =>
    `Attacks never count as more effective than ${params.ceiling}x against this Pokemon. Example: 0.5 turns a super effective hit into a not very effective one. Fixed-damage moves are skipped.`,
  synonyms: [
    "tera shell",
    "resist every attack",
    "cap type effectiveness",
    "no super effective hits",
    "damage reduction from weaknesses",
    "filter",
  ],
  examples: ["Every attack is at most not very effective while I am at full HP, like Tera Shell"],
  params: [
    {
      id: "ceiling",
      ctorIndex: 0,
      path: "matchupCeiling",
      control: "number",
      label: "Highest allowed effectiveness (0.5 = not very effective, 1 = normal)",
      editable: true,
      // Read by the residual and by `apply`; the gate (full HP) never repeats it.
      gateIndependent: true,
      default: 0.5,
      min: 0,
      max: 4,
      step: 0.25,
    },
  ],
  conditions: [
    // The gate: library atom hp.full (calls pokemon.isFullHp(), the same predicate); each user's binding is in bindings.ts.
    { slot: "gate", ctx: "params", lib: "hp.full", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Moves that always do a fixed amount of damage (Seismic Toss, Dragon Rage) are not affected",
    "Only an effectiveness above the highest allowed value is lowered, a weaker one is never raised",
    "Not used for status moves, and not when the attacker's move ignores abilities",
  ],
  // No library effect caps the type matchup yet (R-B01-15); it is shown as one piece until it exists.
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Full HP and one HP below full; a super effective move, a neutral move and a fixed-damage move.
      name: "full HP against a super effective, a neutral and a fixed-damage move",
      axes: { foeMove: ["KARATE_CHOP", "TACKLE", "SEISMIC_TOSS"], hp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (2 attrs): Tera Shell (id 308, attr 0) and Teraform Zero (309, attr 2); init-elite-redux-vanilla-rebalance.ts:477 pushes one only when the ability has none, so no extra instance exists. Both gates are the plain atom hp.full on the holder. The effect is shown with effect.package only because the library has no 'cap the type matchup' effect yet (request R-B01-15, a calc effect with a ceiling number that also caches turnData.moveEffectiveness); the class itself is fully split (guards, gate, residual, ceiling setting). Not a true one-piece mechanic. The Tier B split and the new ceiling argument are pure moves of code; test/tests/elite-redux/decomp/B01/immunity-gates.test.ts compares the new canApply with the old formula over every clause combination.",
});
