/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 1, part 1 of 3 of Confectious (Tier A, event-effect). "When I enter the battle, I become Confected."
//
// Source: fakemon-pitch-mechanics.ts, ConfectiousEntryAbAttr (PostSummonAbAttr).
//   canApply  the base class's (always true): no condition.
//   apply     !simulated: holder.addTag(ER_CONFECTED, 0, MoveId.NONE, holder.id)
// The tag is the "Confected" marker (ErConfectedTag: lapses when the Pokemon leaves the field). While it is on, the engine
// treats the Pokemon as Food-based (`isErFoodPokemon` in abilities/food-based.ts reads the tag), which other effects use.
// No random draw, no constructor argument. The effect is the library effect "put a battle effect on a Pokemon" (effect.apply-tag)
// with the target fixed to myself and the effect fixed to Confected.
import { ConfectiousEntryAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ConfectiousEntryAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Count as Food-based from the moment I enter",
  summary: () =>
    "When I enter the battle, I get the Confected marker until I leave the field. While it is on, I count as a Food-based Pokemon.",
  synonyms: ["confectious", "food based", "sugar coated", "candy coat", "count as food", "sweet marker"],
  examples: ["Every time I come in, I am coated in sugar and count as Food-based, like Confectious"],
  params: [],
  noParamsReason:
    "The effect is fixed: it puts one specific marker (Confected) on myself. The marker has no number, stat, type or status to tune; what the marker does is defined where Food-based Pokemon are checked.",
  conditions: [],
  guards: [],
  feasibility: ["Nothing happens while the game only previews the entry"],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "entry as the first Pokemon of the battle", axes: {} }],
  status: "decomposed",
  notes:
    "Fully decomposed: trigger (on entry) and effect (apply a battle effect to the holder). No IF exists in the class. The effect block effect.apply-tag is planned in the library (implemented: false); the class stays the single source of behaviour, so the declaration only names it. The library effect must keep the exact call `addTag(tag, 0, MoveId.NONE, holder.id)` with no turn limit, noted in R-B16-7 in requests/B16.md. Users: Confectious (6034, attr 0; attr 1 is ConfectiousAttackAbAttr, attr 2 ConfectiousDefendAbAttr in chunk 2).",
});
