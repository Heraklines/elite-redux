/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EVERY_FIELD_NAMES, fieldEffectCodec } from "#data/elite-redux/ability-studio/decl/B08/chunk5-choices";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
// B08 chunk 5 / event-effect, Tier A (nothing to bind, nothing to gate). Read from the source
// (archetypes/entry-arena-tag-on-foe-side.ts, its parent PostSummonAbAttr in ab-attrs.ts, the three dispatcher cases 877, 893 and 924
// that build it, and a live dump of its four users). The class has no closure and:
//
//   canApply  always true (an explicit override of PostSummonAbAttr's own)
//   apply     unless simulated: ownSide/foeSide come from `pokemon.isPlayer()`, then
//             arena.addTag(tag, turns, undefined, holder.id, side === "self" ? ownSide : foeSide). No feasibility check, no random draw.
//
// The class is named "...OnFoeSide" but takes a `side` argument ("foe" by default, "self" for Taste the Rainbow and Rainbow Scales), so the
// side is a setting. Users (4): Swamp Thing (5578, Grass-Water pledge, foes), Deep Fried (5594, Fire-Grass pledge, foes), Rainbow Scales
// (5627, attr 1, Water-Fire pledge, my own side) and Taste the Rainbow (5628, Water-Fire pledge, my own side), all with 4 turns.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { EntryArenaTagOnFoeSideAbAttr } from "#data/elite-redux/archetypes/entry-arena-tag-on-foe-side";

const FOES = "The foes' side";
const MINE = "My own side";

/** "foe" / "self" <-> the words a player uses. */
const sideCodec: ParamCodec = {
  toCtor: value => (String(value) === MINE ? "self" : "foe"),
  fromInstance: raw => (raw === "self" ? MINE : raw === "foe" ? FOES : undefined),
};

export default defineDecl(EntryArenaTagOnFoeSideAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Put a field effect on one side of the field when I enter",
  summary: params =>
    `When I enter the battle, put ${String(params.tag)} on ${String(params.side).toLowerCase()} for ${params.turns} turns. Example: Sea of fire on the foes' side for 4 turns.`,
  synonyms: [
    "pledge on entry",
    "sea of fire",
    "swamp",
    "rainbow",
    "field effect on the foes' side",
    "entry hazard on the other side",
    "set a side effect",
    "deep fried",
    "swamp thing",
    "taste the rainbow",
  ],
  examples: [
    "Put a sea of fire on the foes' side for 4 turns when I enter",
    "Put a rainbow on my own side when I enter",
  ],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      path: "tag",
      control: "select",
      label: "Field effect",
      editable: true,
      default: "Sea of fire (Fire and Grass pledge)",
      options: EVERY_FIELD_NAMES,
      codec: fieldEffectCodec,
    },
    {
      id: "turns",
      ctorIndex: 1,
      path: "turns",
      control: "number",
      min: 1,
      max: 20,
      step: 1,
      integer: true,
      label: "Number of turns the field effect lasts",
      editable: true,
      default: 4,
    },
    {
      id: "side",
      ctorIndex: 2,
      path: "side",
      control: "select",
      label: "Which side of the field gets it",
      editable: true,
      default: FOES,
      options: [FOES, MINE],
      codec: sideCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Nothing happens while the game only previews the entry (a simulated check changes nothing)",
    "The game decides whether the field effect can be added again when it is already there (the class asks nothing first)",
  ],
  // The library effect is still planned and has no turns, no choice list and no source (R-B08-45); the class stays the single source of behaviour.
  effect: { id: "effect.arena-tag", params: ["tag", "turns", "side"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", rngOrder: [], state: "none", simulated: "ignores" },
  probes: [{ name: "enter the battle", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A: no closure, no gate (canApply is an unconditional true), so there is nothing to bind and extra IFs are ANDed by the composition carrier. Effect `effect.arena-tag` (planned): arena.addTag(tag, turns, undefined, holder.id, side) with the side worked out from the holder's own side, so a player or an enemy holder both work; the registry effect has no `turns` and its tag is a free text name, so request R-B08-45 asks for a turns setting, the player-word choice list and the source id. `simulated`: apply returns before touching anything (the class never reads it in canApply). No random draw. showAbility is true (PostSummonAbAttr default). Odd: the class and the ability texts say 'foe side' but Rainbow Scales and Taste the Rainbow pass side 'self' (the Rainbow pledge boosts the holder's own side), so the name is misleading, not the behaviour. The tag list offers the field effects and traps of chunk 5's choices only; any other arena tag the class could carry is not reachable from the editor. Users (4) are fully described by the three settings; none needs a binding.",
});
