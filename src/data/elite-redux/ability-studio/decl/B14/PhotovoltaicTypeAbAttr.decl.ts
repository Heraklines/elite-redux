/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14. "When I enter, gain the Electric type next to my own types."
//
// The class has no condition, no guard and no constructor argument. Its `apply` does one assignment:
//   current = summonData.types.length > 0 ? summonData.types : [...getTypes()]
//   summonData.types = current.includes(ELECTRIC) ? current : [...current, ELECTRIC]
// It never reads `simulated`, and it is dispatched without it (PostSummonAbAttr), so recording "ignores" is exact.
//
// KIND: this is declared as a package ONLY because the effect library has no "gain a type" effect (`effect.add-type`
// is requested in requests/B14.md). The effect is one assignment and is splittable the moment the effect exists; it
// is not a mechanic that cannot be split. The WHEN (on entry) is already a separate, swappable block, and the class
// has no IF at all.
import { PhotovoltaicTypeAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(PhotovoltaicTypeAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Gain an extra type when I enter",
  summary: params =>
    `When I enter the battle, I gain the ${params.type} type in addition to my own types. Example: a Water type that gains Electric becomes Water and Electric.`,
  synonyms: [
    "add a type",
    "extra type",
    "dual type",
    "gain electric type",
    "second type",
    "electric typing",
    "photovoltaic",
  ],
  examples: ["Gain the Electric type when I enter the battle"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "type",
      control: "select",
      label: "Type to gain",
      editable: true,
      default: "ELECTRIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
      gateIndependent: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["Does nothing if I already have that type", "The new type lasts until I leave the field"],
  effect: { id: "effect.package", params: ["type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "ignores" },
  probes: [{ name: "enter the field", axes: {} }],
  status: "decomposed",
  notes:
    "The gained type is a constructor argument (default Electric, so the shipped ability is unchanged) and an editable param. Package, reason: no effect.add-type in the effect library (requested), not because the effect cannot be split. Users (1): Photovoltaic (6030) attr 1; attr 0 is a SelfHighestStatMultiplierAbAttr (Solar Power half) from another batch. apply writes pokemon.summonData.types, which is reset when the Pokemon leaves the field. It ignores `simulated` (never read), harmless because PostSummon is never dispatched simulated. A Pokemon that already has summonData.types set (a type change before entry) keeps that list and gets Electric appended; with no summon types it starts from getTypes().",
});
