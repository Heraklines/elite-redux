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

export default defineDecl(PhotovoltaicTypeAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Gain the Electric type when I enter",
  summary: () =>
    "When I enter the battle, I gain the Electric type in addition to my own types. Example: a Water type becomes Water and Electric.",
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
  params: [],
  noParamsReason:
    "The added type (Electric) is fixed in the class, which takes no constructor argument, so there is no value to tune until the class is given one (requested in requests/B14.md).",
  conditions: [],
  guards: [],
  feasibility: ["Does nothing if I am already an Electric type", "The new type lasts until I leave the field"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "ignores" },
  probes: [{ name: "enter the field", axes: {} }],
  status: "decomposed",
  notes:
    "Package, reason: no effect.add-type in the effect library (requested), not because the effect cannot be split. Users (1): Photovoltaic (6030) attr 1; attr 0 is a SelfHighestStatMultiplierAbAttr (Solar Power half) from another batch. apply writes pokemon.summonData.types, which is reset when the Pokemon leaves the field. It ignores `simulated` (never read), harmless because PostSummon is never dispatched simulated. A Pokemon that already has summonData.types set (a type change before entry) keeps that list and gets Electric appended; with no summon types it starts from getTypes().",
});
