/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 2, Tier A calc-modifier with TWO consequences (an immunity, then a battle effect for me), as two branches.
//
// "While the game checks whether a move can hit me, IF <condition>, I am immune to <type> moves and I gain a boost."
// `canApply` is inherited from TypeImmunityAbAttr (four feasibility clauses). The only swappable condition is the
// optional constructor closure (slot ctor:3, `condition`), which no live user passes. `apply` runs in this order:
//   1. `super.apply`: `typeMultiplier.value = 0`                                   = effect "block it"
//   2. `cancelled.value = true` (hides the "no effect" message), ALWAYS, even when simulated
//   3. unless `simulated`: `pokemon.addTag(tagType, turnCount, undefined, pokemon.id)`  = effect "gain a battle effect"
//
// Honest limits of the two settings (both are real constructor arguments, ctor 1 and 2):
//   - the battle effect is the BattlerTagType given by the user. Only one value is used in the game (the Flash Fire
//     boost, which raises the holder's Fire moves by x1.5). The list below therefore has that single entry; the
//     picker is not editable until the librarian supplies a curated list of self-buffs (requests/B01.md, R-B01-17).
//   - `turnCount` is passed to `addTag`, but the factory in battler-tags.ts ignores it for FIRE_BOOST (a TypeBoostTag
//     is always built for one turn-end lapse). The setting is therefore shown, not editable, and the note says so.
import { TypeImmunityAddBattlerTagAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(TypeImmunityAddBattlerTagAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Absorb a type of move and power up instead",
  summary: params =>
    `Moves of the ${params.type} type do nothing, and this Pokemon gains the ${params.boost} instead. Example: Fire with the Fire boost makes its own Fire moves 1.5 times stronger, like Flash Fire.`,
  synonyms: [
    "flash fire",
    "absorb and power up",
    "fire boost",
    "immune and boost",
    "power up from a type",
    "elemental vortex",
    "absorb a move to get stronger",
  ],
  examples: ["Immune to Fire moves and power up my Fire moves when hit by one, like Flash Fire"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "immuneType",
      control: "select",
      label: "Immune to this type",
      editable: true,
      default: "FIRE",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "boost",
      ctorIndex: 1,
      path: "tagType",
      control: "select",
      label: "Power-up it gains (Fire moves get 1.5 times stronger)",
      editable: false,
      default: "FIRE_BOOST",
      options: ["FIRE_BOOST"],
    },
    {
      id: "turns",
      ctorIndex: 2,
      path: "turnCount",
      control: "number",
      label: "Duration of the power-up (turns)",
      editable: false,
      default: 1,
      min: 1,
      max: 10,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // Optional AbAttrCondition `(pokemon) => boolean`; the field is null for every live user.
    { slot: "ctor:3", ctx: "holder", path: "condition", removable: true, editable: true, optional: true },
  ],
  guards: [],
  feasibility: [
    "Moves that hit every Pokemon or a whole side (Spikes, Rain Dance) are never blocked",
    "A Pokemon never blocks its own move",
    "The power-up is only gained when the move is really used (not when the game only previews it)",
  ],
  branches: [
    {
      label: "Block the move",
      conditions: [],
      effect: { id: "effect.immune-to-type", params: ["type"] },
    },
    {
      label: "Gain a power-up",
      conditions: [],
      effect: { id: "effect.apply-tag", params: ["boost", "turns"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a Fire move, a neutral move and a second Fire move",
      axes: { foeMove: ["EMBER", "TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (3 attrs): Flash Fire (18, Fire, FIRE_BOOST, 1 turn), Elemental Vortex (5369 attr 0, same), Flash Fire copy (5949, same). No user passes the closure, so nothing is bound. The effect.apply-tag library entry takes a free-text name, which the declaration cannot offer to players; the boost and its duration are therefore listed but not editable (see the header). The power-up's own message comes from the tag (TypeBoostTag.onAdd, 'typeImmunityPowerBoost'), the overlap message from onOverlap. `cancelled` is set even for simulated calls, kept as it was.",
});
