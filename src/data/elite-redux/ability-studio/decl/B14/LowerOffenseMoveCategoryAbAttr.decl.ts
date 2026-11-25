/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 4. PARKED until the librarian adds the WHEN `calc.move-category` with dispatch key LowerOffenseMoveCategoryAbAttr (request
// R-B14-4.8); then rename this file to LowerOffenseMoveCategoryAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "My damaging moves count as physical or special by comparing my Attack and my Sp. Atk" (Subversion: the lower one decides).
//
// Source: bernerd-roster-mechanics.ts LowerOffenseMoveCategoryAbAttr (extends AbAttr, no dispatch key). Pokemon.getAttackDamage
// (field/pokemon.ts, about line 5854) loops over the attacker's `getAllActiveAbilityAttrs()` unless the attacker's abilities are ignored,
// and for every attr with a `resolveCategory` function replaces the move's damage category with the answer when it is not null.
// resolveCategory(move, user), original order, now `gate` then the effect:
//   gate    1. move.category !== STATUS        a status move keeps its category (null)   -> library move.damaging
//   effect  2. user.getStat(ATK, false) <= user.getStat(SPATK, false) ? PHYSICAL : SPECIAL   raw stats, no stat stages
// Flipping the category makes the whole damage formula follow (Sp. Atk or Attack, the matching defense, burn, screens). The other half of
// Subversion (the offense stat itself) is AttackStatSubstituteAbAttr, a separate attr of B08. No random draw, no state, no `simulated`.
// Class edit (pure move of code): `gate` + `gateOverride` + `gatedCanApply`; a new constructor argument `useHigherStat` (default false) turns
// the comparison round (`>=` for the higher stat, the same tie-to-physical rule), so the direction is a typed setting.
import { LowerOffenseMoveCategoryAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { HIGHER_STAT, LOWER_STAT, lowerOrHigherCodec } from "#data/elite-redux/ability-studio/decl/B14/chunk4-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(LowerOffenseMoveCategoryAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-category",
  label: "Pick physical or special from my Attack and Sp. Atk",
  summary: params =>
    `My damaging moves count as physical or special by the ${params.useHigherStat === HIGHER_STAT ? "higher" : "lower"} of my Attack and Sp. Atk (a tie counts as physical). Example: Attack 80, Sp. Atk 120 gives ${params.useHigherStat === HIGHER_STAT ? "special" : "physical"}.`,
  synonyms: [
    "subversion",
    "use my weaker stat",
    "category by stat",
    "physical or special",
    "switch move category",
    "lower attacking stat",
    "higher attacking stat",
  ],
  examples: ["My moves are physical if my Attack is lower and special if my Sp. Atk is lower, like Subversion"],
  params: [
    {
      id: "useHigherStat",
      ctorIndex: 0,
      path: "useHigherStat",
      control: "select",
      label: "Which of my Attack and Sp. Atk decides the category",
      editable: true,
      default: LOWER_STAT,
      options: [LOWER_STAT, HIGHER_STAT],
      codec: lowerOrHigherCodec,
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [move.damaging] (bindings): a status move keeps its category. Removable.
    { slot: "gate", ctx: "params", lib: "move.damaging", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Uses my raw Attack and Sp. Atk, without stat stages",
    "Does nothing while the game ignores my ability (for example a move that ignores abilities)",
  ],
  // Package, reason in notes: the library has no effect that changes a move's damage category.
  effect: { id: "effect.package", params: ["useHigherStat"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The class is read by a duck-typed scan inside the damage formula (Pokemon.getAttackDamage), not dispatched, so no trace event shows it evaluated. test/tests/elite-redux/decomp/B14/chunk4.test.ts compares resolveCategory of the original and the rebuild over every grid move, both stat orders and a tie.",
  probes: [{ name: "a physical, a special and a status move", axes: { foeMove: ["TACKLE", "WATER_GUN", "GROWL"] } }],
  status: "decomposed",
  notes:
    "Tier B. Users (1): Subversion (6081) attr 1 (attr 0 is AttackStatSubstituteAbAttr with useLowerOffense, attr 2 a MovePowerBoostAbAttr x1.5, both of other batches). Package (effect only), reason: no library effect changes a move's damage category (B09 asked for effect.change-move-category, R-B09-34, which takes a move property and a fixed category) and this one chooses the category by comparing two of my own stats, so it cannot be a fixed-category block; the direction is a typed setting. The status-move test is the gate (move.damaging, the same expression as the original). The helper that the engine calls is `resolveCategory`; the engine call site is unchanged. Oddities, not fixed: (1) the category is decided from raw stats, so a +6 Attack boost or a burn does not change it (the other half, AttackStatSubstitute, also uses raw stats, so the two halves agree); (2) the stat order is read every time a move is damage-calculated, including previews, so the category can flip between turns when the stats change; (3) with a tie the category is physical for both directions.",
});
