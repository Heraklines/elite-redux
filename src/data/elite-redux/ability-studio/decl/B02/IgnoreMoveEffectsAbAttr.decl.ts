/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 2. "Moves that hit me lose their extra effects" (Shield Dust, Scarecrow, Bad Luck).
//
// Source: src/data/abilities/ab-attrs.ts IgnoreMoveEffectsAbAttr, a PreDefendAbAttr dispatched from Move.getMoveChance
// (`applyAbAttrs("IgnoreMoveEffectsAbAttr", { pokemon: target, move, simulated: !showAbility, chance })`) for every
// non-self effect, after the attacker's own multiplier.
// canApply: `chance.value > 0` (feasibility: nothing to remove from a missing or guaranteed effect). apply: `chance.value = 0`.
// The constructor's only argument is `showAbility` (default false); all three users leave it false, so it is a fixed
// argument and not a setting. No closure, no random draw, no state.
//
// The engine ALSO asks for this class by presence (`hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")`) in Sparkling Aria
// (move.ts), the Covert Cloak and chance-status archetypes and the absorbant archetype. A rebuilt attr is the same
// class, so those queries keep working; a staff block built from a different effect would not be seen by them.
import { IgnoreMoveEffectsAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IgnoreMoveEffectsAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.incoming-effect-chance",
  label: "Block the extra effects of moves that hit me",
  summary: () =>
    "Moves that hit me lose their extra effects (flinch, burn, stat drops). The damage still happens. Example: a 30% flinch chance becomes 0%.",
  synonyms: [
    "shield dust",
    "block secondary effects",
    "no side effects",
    "flinch immunity",
    "extra effect immunity",
    "ignore added effects",
  ],
  examples: ["Moves that hit me never burn, flinch or lower stats as a side effect, like Shield Dust"],
  params: [],
  noParamsReason:
    "The class always sets the effect chance to zero and has no setting. The only constructor argument is the ability flash, which every user leaves off. A staff-built version uses the multiply-chance effect with 0 (request B02-10).",
  fixedCtorArgs: { 0: false },
  conditions: [],
  guards: [],
  feasibility: ["The move's extra effect must have a chance above 0 (a guaranteed or missing effect is left alone)"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared reach table (decomp-l2-reach.json) lists this trigger as unreached because its generic foe-hits-holder run uses a move without an extra effect. With the probe foe moves below (Ember and Flamethrower, both with a burn chance) the original DOES evaluate and apply the attr in every scenario (request B02-17 asks B20 to refresh the table); B02's own tests (B02/chance-and-effects.test.ts, B02/l2-chunk2.test.ts) read the trace by eye.",
  probes: [
    {
      name: "the enemy hits the holder with a move that has an extra effect",
      axes: { foeMove: ["EMBER", "FLAMETHROWER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, nothing to bind. Three users: Shield Dust (attr 0), Bad Luck (attr 1) and Scarecrow (attr 2). The effect has no library block yet: effect.package, request B02-10 (the same multiply-the-chance effect as Sheer Force, with 0). The dispatch is `applyAbAttrs(..., { pokemon: target })`, so the holder is the TARGET of the move; the library frame for this WHEN has holder = the Pokemon being hit. UserFieldIgnoreMoveEffectsAbAttr (Desert Cloak, sand archetype) is a separate class that shares the WHEN. The class also acts through presence checks (see the header); that is an engine query the foundation owns.",
});
