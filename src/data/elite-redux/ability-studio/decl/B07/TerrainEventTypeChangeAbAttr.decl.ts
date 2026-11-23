/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 4 / event effect (Mimicry), Tier C. See ../PRECEDENTS.md.
//
// Read from src/data/abilities/ab-attrs.ts (TerrainEventTypeChangeAbAttr, a PostSummonAbAttr):
//   constructor      `super(true)`, no argument (showAbility true; the dump of the live attr says true)
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

export default defineDecl(TerrainEventTypeChangeAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.terrain-changed",
  label: "Change my type to match the terrain",
  summary: () =>
    "When I enter or the terrain changes, I take the terrain's type: Electric, Fairy (Misty), Grass or Psychic. With no terrain I go back to my own types.",
  synonyms: [
    "mimicry",
    "terrain type",
    "become the terrain's type",
    "type follows terrain",
    "change type with terrain",
    "terrain adaptation",
  ],
  examples: ["Become a Grass type on Grassy Terrain, like Mimicry"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: the four terrain-to-type pairs are a literal table inside the class (Electric, Misty->Fairy, Grassy->Grass, Psychic), so there is no number, type or choice to set today (request R-B07-14 asks for a typed effect).",
  conditions: [],
  guards: [],
  feasibility: [
    "Does nothing while I am Terastallized: a Terastallized Pokemon keeps its type",
    "On a terrain with no matching type (no terrain, or the Toxic terrain) I go back to the types I was born with, which also drops a type that Soak-like moves gave me",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "the foe sets Electric Terrain while the holder is on the field", axes: {} }],
  status: "decomposed",
  notes:
    "Package for the effect only, reason: no library effect changes the holder's own typing (request R-B07-14), and the terrain-to-type table is a literal inside the private determineTypeChange with no constructor argument, so it cannot be turned into typed settings without a class change that is outside a batch's remit. WHEN (event.terrain-changed) and the Terastallized feasibility are separate, swappable blocks. One user: Mimicry (250, attr 0); no closure, so no binding. ODDITIES (recorded, not changed): (1) `apply` ignores `simulated` and canApply does not look at it either. (2) The default branch also runs for the ER Toxic terrain: the holder reverts to its base types (dropping any Soak-like change) but getTriggerMessage reads `determineTypeChange(...)[0]` and announces 'became <first base type> type', which reads as a change that did not happen. (3) On a NONE terrain the revert message shows on every entry into a field without terrain, even when nothing changed (apply runs because `typeChange.length > 0` is always true for a Pokemon that has types). (4) The ER description of Mimicry says type changes from moves like Soak are retained, but the revert replaces `summonData.types` with the base types.",
});
