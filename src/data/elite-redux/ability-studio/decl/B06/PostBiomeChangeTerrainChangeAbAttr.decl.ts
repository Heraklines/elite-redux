/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 2, Tier A event-effect. See ../PRECEDENTS.md.
//
// "When the game moves on to a new biome, set the terrain again" (Electric Surge, Psychic Surge, Misty Surge, Grassy Surge, Hadron
// Engine, Psychic Supremacy, Reap and Sow, Surges Up). One constructor argument (the terrain), no closure, nothing to bind.
//   canApply  `arena.canSetTerrain(terrainType)`  = feasibility: the terrain differs from the one that is on the field now
//   apply     (skipped when `simulated`) `arena.trySetTerrain(terrainType, false, pokemon)`
import { PostBiomeChangeTerrainChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TerrainType } from "#data/terrain";

export default defineDecl(PostBiomeChangeTerrainChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.biome-changed",
  label: "Set the terrain again when the area changes",
  summary: params =>
    `When the game moves on to a new area, I set the terrain to ${params.terrain} if it is not already active. Example: Electric Terrain is back in the next area.`,
  synonyms: [
    "keep terrain after biome change",
    "terrain on new area",
    "electric surge",
    "grassy surge",
    "psychic surge",
    "misty surge",
    "terrain on new biome",
  ],
  examples: ["Set Electric Terrain again when the area changes, like Electric Surge"],
  params: [
    {
      id: "terrain",
      ctorIndex: 0,
      path: "terrainType",
      control: "select",
      label: "Which terrain is set",
      editable: true,
      default: "ELECTRIC",
      options: ["MISTY", "ELECTRIC", "GRASSY", "PSYCHIC", "TOXIC"],
      codec: enumCodec(TerrainType, "terrain"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The terrain must differ from the one on the field right now",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.set-terrain", params: ["terrain"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the same terrain already up, and a different terrain up", axes: {} }],
  l2StaticReason:
    "The shared entry template never changes the biome, so the engine never asks this attr (decomp-l2-reach.json lists event.biome-changed as unreached); test/tests/elite-redux/decomp/B06/b06-chunk2.test.ts drives the real attr against a real arena for the original and for the rebuild.",
  status: "decomposed",
  notes:
    "Users (8 attrs): Electric Surge (226), Psychic Surge (227), Misty Surge (228), Grassy Surge (229), Hadron Engine (289), Reap and Sow (6054), Surges Up (6061) at attr 1, and Psychic Supremacy (20000, the saved staff ability) at attr 3. The first four ER surges get an ErTerrainSummonAbAttr at attr 0 (the ER turn count); the biome attr is the vanilla one. The engine call is new-biome-encounter-phase.ts. Oddity, not fixed: unlike the weather sibling, this attr has no check that a lasting terrain is active, so it re-sets the terrain after EVERY biome change if the terrain is not the same type as the one left over (the TODO above the base class suggests re-running the entry effect).",
});
