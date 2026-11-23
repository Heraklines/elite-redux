/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 4 / event effect (Mimicry), Tier C. See ../PRECEDENTS.md.
//
// Read from src/data/abilities/ab-attrs.ts (TerrainEventTypeChangeAbAttr, a PostSummonAbAttr):
//   constructor      four optional type arguments (Electric, Misty, Grassy, Psychic terrain; defaults Electric, Fairy, Grass, Psychic), super(true)
//   canApply         `!pokemon.isTerastallized`                                     FEASIBILITY (a Terastallized Pokemon keeps its type;
//                                                                                   same classification as B02's PokemonTypeChangeAbAttr)
//   apply            reads `globalScene.arena.terrainType` and maps it with the private `determineTypeChange`:
//                      ELECTRIC -> [ELECTRIC], MISTY -> [FAIRY], GRASSY -> [GRASS], PSYCHIC -> [PSYCHIC],
//                      anything else (NONE, and the ER Toxic terrain) -> the base types, `pokemon.getTypes(false, false, true)`
//                    if the result is not empty: when `summonData.addedType` (a third type from Forest's Curse and the like) is one of the
//                    new types it is cleared, then `summonData.types = typeChange` and `pokemon.updateInfo()`. Nothing reads `simulated`.
//   getTriggerMessage  "reverted to its original type" for NONE, otherwise "became <first of determineTypeChange> type"
// Two dispatch moments reach the same attr: the PostSummon base key when the holder enters (`applyAbAttrs("PostSummonAbAttr")`) and the
// class's own key from `Arena.trySetTerrain` for every Pokemon on the field when the terrain changes
// (`applyAbAttrs("TerrainEventTypeChangeAbAttr", { pokemon })`, arena.ts, right after PostTerrainChangeAbAttr). The WHEN registry lists the
// class under `event.terrain-changed` (alsoDispatchKeys), so that is the declared moment; entry is the second one.
// No closure, no gate, no random draw. Tier C: one atomic effect, extra IFs can only be ANDed on top.
import { TerrainEventTypeChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(TerrainEventTypeChangeAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.terrain-changed",
  label: "Change my type to match the terrain",
  // WHEN note: event.terrain-changed covers a change while I am on the field; entering the field reaches the same attr through the inherited
  // PostSummon key, so a rebuilt ability keeps this one block (not a second one) to also react on entry.
  summary: params =>
    `On entry or a terrain change I become ${params.electricType} (Electric Terrain), ${params.mistyType} (Misty), ${params.grassyType} (Grassy), ${params.psychicType} (Psychic); no terrain: my own types.`,
  synonyms: [
    "mimicry",
    "terrain type",
    "become the terrain's type",
    "type follows terrain",
    "change type with terrain",
    "terrain adaptation",
  ],
  examples: ["Become a Grass type on Grassy Terrain, like Mimicry"],
  params: [
    {
      id: "electricType",
      ctorIndex: 0,
      path: "electricTerrainType",
      control: "select",
      label: "Type I become on Electric Terrain",
      editable: true,
      default: "ELECTRIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "mistyType",
      ctorIndex: 1,
      path: "mistyTerrainType",
      control: "select",
      label: "Type I become on Misty Terrain",
      editable: true,
      default: "FAIRY",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "grassyType",
      ctorIndex: 2,
      path: "grassyTerrainType",
      control: "select",
      label: "Type I become on Grassy Terrain",
      editable: true,
      default: "GRASS",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "psychicType",
      ctorIndex: 3,
      path: "psychicTerrainType",
      control: "select",
      label: "Type I become on Psychic Terrain",
      editable: true,
      default: "PSYCHIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Also reacts when I enter the battle, not only when the terrain changes later (same block, no extra setting)",
    "Does nothing while I am Terastallized: a Terastallized Pokemon keeps its type",
    "On a terrain with no matching type (no terrain, or the Toxic terrain) I go back to the types I was born with, which also drops a type that Soak-like moves gave me",
  ],
  effect: { id: "effect.package", params: ["electricType", "mistyType", "grassyType", "psychicType"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "the foe sets Electric Terrain while the holder is on the field", axes: {} }],
  status: "decomposed",
  notes:
    "Package for the effect only, reason: no library effect changes the holder's own typing (request R-B07-14). The four terrain-to-type pairs are four typed settings (class change, behaviour identical: optional constructor arguments defaulting to Electric, Fairy, Grass, Psychic, stored as public fields); the fall-back to the base types on any other terrain stays in the class and is listed as feasibility. WHEN (event.terrain-changed) and the Terastallized feasibility are separate, swappable blocks. One user: Mimicry (250, attr 0); no closure, so no binding. ODDITIES (recorded, not changed): (1) `apply` ignores `simulated` and canApply does not look at it either. (2) The default branch also runs for the ER Toxic terrain: the holder reverts to its base types (dropping any Soak-like change) but getTriggerMessage reads `determineTypeChange(...)[0]` and announces 'became <first base type> type', which reads as a change that did not happen. (3) On a NONE terrain the revert message shows on every entry into a field without terrain, even when nothing changed (apply runs because `typeChange.length > 0` is always true for a Pokemon that has types). (4) The ER description of Mimicry says type changes from moves like Soak are retained, but the revert replaces `summonData.types` with the base types.",
});
