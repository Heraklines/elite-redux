/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 2 / calc modifier, Tier C with typed params and one yes/no setting. See ../PRECEDENTS.md.
//
// Constructor `(statusEffect: readonly StatusEffect[], defenderType: readonly PokemonType[], statusMoveOnly = false)`, `super(false)`.
// Dispatched from TWO engine places, both inside Pokemon.canSetStatus (pokemon.ts):
//   - POISON / TOXIC: for each of the target's types that is Poison or Steel (the immune ones), when there IS a source Pokemon
//       (no source, such as Toxic Spikes, means blocked): `applyAbAttrs("IgnoreTypeStatusEffectImmunityAbAttr", { pokemon: source, cancelled,
//       statusEffect, defenderType: defType, moveCategory })`; the status is blocked unless the cancel came back true;
//   - BURN: only when the target is Fire type and there is a source, the same call with defenderType FIRE.
//   There is NO call for PARALYSIS or any other status, see the notes.
// In its original order:
//   canApply  1. `statusMoveOnly && moveCategory !== STATUS` -> false   (the "only with status moves" setting)
//             2. `!cancelled.value && statusEffect.includes(status) && defenderType.includes(type)`   (shared "already decided" check
//                plus the two list matches, which are the SETTINGS of the class)
//   apply     `cancelled.value = true`  -> the effect.
// The two lists are matched independently (any listed status with any listed type), never as pairs.
import { IgnoreTypeStatusEffectImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STATUS_OPTIONS, TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(IgnoreTypeStatusEffectImmunityAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "cancel.status-type-immunity",
  label: "My status effects get past a type's normal immunity",
  summary: params =>
    `I can inflict ${params.statuses} even on ${params.types}-type Pokemon that are normally immune to it.${params.statusMovesOnly === true ? " Only my status moves can do this." : ""} Example: poison works on Steel types.`,
  synonyms: [
    "corrosion",
    "poison steel types",
    "poison poison types",
    "burn fire types",
    "ignore status immunity",
    "status ignores type immunity",
    "mycelium might",
  ],
  examples: [
    "I can poison Steel and Poison types, like Corrosion",
    "My status moves can burn Fire types, like Mycelium Might",
  ],
  params: [
    {
      id: "statuses",
      ctorIndex: 0,
      path: "statusEffect",
      control: "text",
      label: "Status effects that get through (comma separated)",
      editable: true,
      default: "POISON,TOXIC",
      options: STATUS_OPTIONS,
      codec: enumListCodec(StatusEffect, "status"),
    },
    {
      id: "types",
      ctorIndex: 1,
      path: "defenderType",
      control: "text",
      label: "Types that are normally immune (comma separated)",
      editable: true,
      default: "STEEL,POISON",
      options: TYPE_OPTIONS,
      codec: enumListCodec(PokemonType, "type"),
    },
    {
      id: "statusMovesOnly",
      ctorIndex: 2,
      path: "statusMoveOnly",
      control: "boolean",
      label: "Only with status moves, not damaging moves",
      editable: true,
      default: false,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Does nothing when the immunity was already ignored by something earlier",
    "Only asked when the status comes from a Pokemon; hazards such as Toxic Spikes never get past a type immunity",
  ],
  // No library effect says "ignore a type's status immunity"; request R-B07-8 (effect.ignore-status-type-immunity).
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "Poison and a burn against a Steel, a Poison and a Fire type", axes: {} }],
  l2StaticReason:
    "The dispatch sits inside Pokemon.canSetStatus and no scenario of the battle twin applies a status to a Steel, Poison or Fire defender; the engine site is driven directly in test/tests/elite-redux/decomp/B07/flag-sites-2.test.ts for the original, the rebuilt attr and a control.",
  status: "decomposed",
  notes:
    "Tier C with three params (the three constructor fields; no closure, so no binding). Users and live values (dump): Corrosion (212, attr 1), Pyroclastic Flow (5339, attr 2), Trash Heap (5427, attr 1), Acidic Slime (5461, attr 1), Tummyache (5653, attr 3): statuses Poison and Toxic, types Steel and Poison; Mycelium Might (298, attr 4): Poison, Toxic and Burn against Steel, Poison and Fire, status moves only; Overcharge (5087, attr 1), Depravity (5419, attr 2) and Extermination Vector (20003, attr 3): Paralysis against Electric. SUSPECTED GAME BUG (not fixed): canSetStatus has no dispatch for PARALYSIS (the case only checks the Electric type and Glare's own flag), so the three paralysis users never get past the Electric immunity; the engine site test records this. The archetype dispatcher builds the same class for Paralysis versus Electric. The class ignores `simulated`.",
});
