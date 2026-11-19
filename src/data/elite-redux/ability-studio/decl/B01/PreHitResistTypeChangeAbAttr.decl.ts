/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 3, Tier B event-effect with a package effect. "Just before a damaging hit lands on me, I turn into the
// single type that resists that move best."
//   canApply (now `gatedCanApply`): `gate` then `residual`
//     gate      `pokemon !== opponent`                = the hit is not my own move  (atom side.is self, negated)
//               `move.category !== STATUS`            = the move deals damage       (atom move.damaging)
//     residual  `!pokemon.isTerastallized`            = feasibility (a Terastallized Pokemon keeps its type)
//               `!move.hasAttr("TypelessAttr")`       = feasibility (a typeless move has no type to resist)
//               `bestResistType(moveType, pokemon) !== null` = feasibility (some type resists it better than my first type)
//     The old order was self, Terastallized, status, typeless; all four are pure reads (no draw, no side effect), so the
//     split cannot change the answer.
//   apply     (skipped when `simulated`) `summonData.types = [bestType]` and `updateInfo()`.
//
// Why the effect is a package (justified): the type is CHOSEN by a search of the type chart: the first type among Normal
// to Fairy whose multiplier against the move's type is strictly the lowest, compared with the holder's current FIRST type
// (`getTypes(true, true)[0]`, defaulting to Normal). There is no number or type to set, and no library effect changes the
// holder's own type from a chart search (effect.change-move-type changes the MOVE's type). Request R-B01-22.
import { PreHitResistTypeChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PreHitResistTypeChangeAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.before-hit-lands",
  label: "Turn into the type that resists the incoming move best",
  summary: () =>
    "Just before a damaging move hits me, I change into the one type that takes the least damage from it. Example: a Water move makes me Grass, like Color Change in Elite Redux.",
  synonyms: [
    "color change",
    "prismatic fur",
    "adapt type to resist",
    "become resistant",
    "protean defense",
    "change type before being hit",
    "type shift to resist",
  ],
  examples: ["Change into the type that best resists the attack before it lands, like Color Change"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: the choice of type is a search of the type chart that is fixed in the class, so there is no number, type or stat to set.",
  conditions: [
    // The gate is the group [not side.is self, move.damaging], in that order.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A Terastallized Pokemon keeps its type",
    "A move with no type (typeless) is ignored",
    "Only when some type resists the move better than my current first type",
    "Nothing changes when the game only previews the move",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "damaging moves of different types and a status move",
      axes: { foeMove: ["EMBER", "WATER_GUN", "TACKLE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Package for the effect, justified in the header; the trigger (Just before a hit lands on me) and both conditions are separate blocks. Users (2 attrs): Color Change (16 attr 0, installed by the ER rebalance patcher in place of the vanilla after-hit version) and Prismatic Fur (5176 attr 0). Dispatched from move-effect-phase.ts:612 before the type-effectiveness check. Oddity (not fixed): the holder's type is compared against its first type only, so a dual-typed holder can be 'improved' to a single type that is worse overall than its current pair.",
});
