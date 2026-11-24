/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 4 / event-effect, Tier A (nothing to bind, nothing to gate). Read from the source (archetypes/disable-foe-items-on-entry.ts, its parent
// PostSummonAbAttr in ab-attrs.ts, the tag ER_ITEM_DISABLED in battler-tags and the switch-in dispatch) and from the two live users, Frisk
// (119, attr 1) and Gleam Eyes (5410, attr 1). The class has no canApply (PostSummonAbAttr's always-true) and:
//
//   apply   unless simulated: for every opponent on the field (pokemon.getOpponents()) ->
//           opponent.addTag(ER_ITEM_DISABLED, turns, undefined, holder.id). While the tag lasts the opponent's held-item effects are
//           suppressed (checked in PokemonHeldItemModifier.shouldApply; mega stones keep working). No feasibility check before addTag, no random draw.
//
// `turns` is new as a constructor argument (default 3, what both users get). The tag count 3 means "2 full turns" because TurnEndPhase lapses
// the tag before the held-item turn-end effects (see the class comment). The ability bar is not shown by this rider (showAbility false: the
// vanilla Frisk reveal already shows it); activateOnGain stays true (PostSummonAbAttr's default).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { DisableFoeItemsOnEntryAbAttr } from "#data/elite-redux/archetypes/disable-foe-items-on-entry";

export default defineDecl(DisableFoeItemsOnEntryAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Switch off the foes' held items for a few turns",
  summary: params =>
    `When I enter the battle, every foe's held item stops working for ${params.turns} turns (3 = the items stop working for 2 full turns). Mega stones keep working.`,
  synonyms: [
    "frisk",
    "gleam eyes",
    "embargo",
    "disable items",
    "block held items",
    "foe items stop working",
    "item lock on entry",
  ],
  examples: ["When I enter, the foe's held items stop working for 2 turns"],
  params: [
    {
      id: "turns",
      ctorIndex: 0,
      path: "turns",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Number of turns the items stay switched off (3 = the items stop working for 2 full turns)",
      editable: true,
      default: 3,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [],
  effect: { id: "effect.apply-tag", params: ["turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", rngOrder: [], state: "none", simulated: "respects" },
  probes: [{ name: "enter the battle", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A: no closure and no gate in the class; extra IFs are ANDed by the composition carrier. The effect is `effect.apply-tag` (ER_ITEM_DISABLED on every foe for `turns`); the library effect is still planned and cannot yet name the battle effect, a count and 'every foe' together (request R-B08-17, extended by R-B08-41 for the ER_ITEM_DISABLED choice and the target 'every foe'), so the declaration names it and the class stays the single source of behaviour. Users (2): Frisk (119, attr 1) and Gleam Eyes (5410, attr 1, followed by PostSummonStatStageChangeAbAttr); both use the default 3. `simulated`: apply returns before touching anything. No random draw. No feasibility check before addTag, so an opponent that already carries the tag simply gets whatever addTag does with a second copy. showAbility is false and activateOnGain is true.",
});
