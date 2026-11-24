/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect, Tier B (the terrain rule sits inside canApply). See ../PRECEDENTS.md.
//
// `Arena.trySetTerrain` (arena.ts:714), after it stored the new terrain, tells every Pokemon on the field in speed order:
// `applyAbAttrs("PostTerrainChangeAbAttr", { pokemon, terrain })`. canApply is now `gate && residual`, in the ORIGINAL clause order
// (no guard, no prepare step, no random draw):
//   1. gate      `!!terrainTypes.find(t => t === terrain)`   the NEW terrain is one of the listed ones   <- staff may replace it
//   2. residual  `pokemon.canAddTag(tagType)`                the holder can take the battle effect (feasibility, stays in the class)
// apply: not when `simulated`; otherwise `pokemon.addTag(tagType, turnCount)`. The constructor is
// `(tagType, turnCount, ...terrainTypes)`.
import { PostTerrainChangeAddBattlerTagAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";

export default defineDecl(PostTerrainChangeAddBattlerTagAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.terrain-changed",
  label: "Gain a battle effect when a chosen terrain starts",
  summary: params =>
    `When the terrain changes to one of: ${params.terrains}, I gain the effect ${params.tag}. Example: Quark Drive starts when Electric Terrain is set.`,
  synonyms: [
    "quark drive",
    "terrain boost start",
    "gain effect in electric terrain",
    "start boost when terrain changes",
    "terrain boost",
    "electric terrain boost",
  ],
  examples: ["Start my terrain boost when Electric Terrain is set, like Quark Drive"],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      path: "tagType",
      control: "select",
      label: "Battle effect I gain",
      editable: true,
      gateIndependent: true,
      default: "QUARK_DRIVE",
      options: Object.values(BattlerTagType),
    },
    {
      id: "turns",
      ctorIndex: 1,
      path: "turnCount",
      control: "number",
      min: 0,
      max: 99,
      step: 1,
      integer: true,
      label: "Turns the effect lasts (0 = until something removes it)",
      editable: true,
      gateIndependent: true,
      default: 0,
    },
    {
      id: "terrains",
      ctorIndex: 2,
      path: "terrainTypes",
      control: "text",
      // The list is also the gate ("the new terrain is one of these"), which staff edit through the gate block. This list only
      // feeds the class's own default gate, so editing it alone would not move a replaced gate.
      label: "Terrains that start it (comma separated names)",
      editable: false,
      default: "ELECTRIC",
      codec: enumListCodec(TerrainType, "terrain"),
      spread: true,
    },
  ],
  conditions: [
    // The gate: "the terrain that was just set is one of these". NOT the library atom field.terrain: that one reads
    // `arena.terrainType`, which says NONE while Clueless switches field effects off, whereas the class compares the terrain
    // the dispatch passes (request R-B05-29, an atom that reads the `terrain` slot).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "I must be able to take that battle effect (for example I do not already have it)",
    "Nothing happens during a simulated check",
  ],
  // The library's apply-tag effect is not implemented and has no turn count (R-B05-21), so the effect is a package.
  effect: { id: "effect.package", params: ["tag", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the terrain changes to Electric Terrain and to another terrain", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B. User: Quark Drive (282 attr 1, tag QUARK_DRIVE, 0 turns, ELECTRIC). Its entry half (`PostSummonAddBattlerTagAbAttr` behind a terrain condition, attr 0) is another class. The gate is bound `legacy-closure` pending R-B05-29: the class compares the `terrain` the dispatch passes, field.terrain reads `arena.terrainType`, and the two differ while Clueless (isFieldEffectSuppressed) is on the field (the tag would still be added by the class, never by a field.terrain gate). Until the atom exists the attr is not rebuilt by L1 or L2 (the terrain-change WHEN is also not reached by the L2 templates); chunk4-sites.test.ts proves the Tier B split and the gate override path by hand. The effect is a package ONLY for lack of a library apply-tag effect with a turn count (R-B05-21). The `terrains` list is not editable on purpose: staff change the terrains through the gate block. The tag is removed again by the engine, not by this class: arena.ts (`findAndRemoveTags(tag => 'terrainTypes' in tag && ...)`) strips a tag whose own terrain list does not contain the new terrain. Observation, not fixed: the gate is `!!find(...)`, so a list that held TerrainType.NONE (0) could never match (find returns 0, which is falsy); no user lists NONE, so this cannot happen today.",
});
