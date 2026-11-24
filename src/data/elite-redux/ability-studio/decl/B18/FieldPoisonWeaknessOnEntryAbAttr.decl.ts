/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
// Toxic Spill (Tier C, package). "When I enter the battle, DO mark every Pokemon on the field as weak to Poison for as long as
// it stays in".
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over PostSummonAbAttr (showAbility true). Dispatch:
// applyAbAttrs("PostSummonAbAttr", { pokemon, simulated }) when a Pokemon enters. There is no canApply of its own.
// apply: unless simulated, for every Pokemon of `globalScene.getField(true)` (all battlers on the field, both sides, the holder
// included) sets `tempSummonData.erWeakToType = this.weakType` (ctor arg 0, default Poison). The reader is Pokemon.getAttackTypeEffectiveness
// (pokemon.ts:4474): for a move of that type, `multi = max(2, multi)` when multi > 0, so existing immunities stay immune and every other matchup
// becomes super effective. tempSummonData ends when that Pokemon leaves the field.
import { FieldPoisonWeaknessOnEntryAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(FieldPoisonWeaknessOnEntryAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Make everyone on the field weak to Poison",
  summary: params =>
    `When I enter the battle, every Pokemon on the field (mine, my allies and the foes) takes at least double damage from ${params.weakType} moves while it stays in. Pokemon that are immune to that type stay immune.`,
  synonyms: [
    "toxic spill",
    "poison weakness",
    "everyone weak to poison",
    "poison field",
    "super effective poison",
    "poison hazard",
  ],
  examples: ["Everyone on the field becomes weak to Poison when I come in, like Toxic Spill"],
  params: [
    {
      id: "weakType",
      ctorIndex: 0,
      path: "weakType",
      control: "select",
      label: "Type everyone on the field becomes weak to",
      editable: true,
      default: "POISON",
      options: enumOptions(PokemonType),
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Nothing is marked while the game is only previewing",
    "Pokemon already immune to the type stay immune (the double damage only applies when the matchup was not 0x)",
  ],
  effect: { id: "effect.package", params: ["weakType"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: it writes a per-summon mark (summonData `erWeakToType`) on every battler on the field that the damage calculation reads for moves of the chosen type; the library has no 'make everything on the field weak to a type' effect and no type-chart override effect (request R-B18-16). There is no condition: the class has no canApply, so the trigger (event.on-entry) is the only block around the effect and staff can AND any condition on top. The weak type is a typed setting (the constructor takes it, default Poison, added with this declaration without changing behaviour for the shipped ability; the mark now stores that type instead of a Poison-only boolean and pokemon.ts reads it). The x2 floor is the fixed rule of the mark, not a per-ability number. Users: Toxic Spill (5147, attr 0). ODDITIES (not fixed): (1) the mark is set only for Pokemon on the field at that moment; a Pokemon that comes in later is not marked, and a marked one loses it when it leaves; (2) the holder itself is marked too, so Toxic Spill is weak to Poison as well; (3) the mark is the same type for everyone, so two Toxic Spill holders do nothing extra.",
});
