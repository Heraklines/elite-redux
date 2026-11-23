/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 2 / event-effect (Tier B: "the new terrain is Electric" is the gate inside canApply).
//
// Read by hand from archetypes/recharge-on-electric-terrain.ts and PostTerrainChangeAbAttr in ab-attrs.ts. PostTerrainChange hook (WHEN
// "when the terrain changes", dispatched by Arena.trySetTerrain for every Pokemon on the field in speed order, with `terrain` = the
// terrain that was just set), no constructor of its own (the parent's default: shows the ability banner).
//   canApply is now `gate && residual`, in the ORIGINAL clause order:
//     1. gate, CONDITION: `terrain === TerrainType.ELECTRIC`           (the terrain that just began is Electric Terrain)
//     2. residual, feasibility: `pokemon.canAddTag(BattlerTagType.CHARGED)`   (the holder can take the Charged state)
//   apply: not when simulated. `pokemon.addTag(CHARGED, 0)` (the next Electric move does double damage; duration 0 = until used).
//   No random draw, no message of its own.
//
// Clause 1 is the condition staff would change ("when Grassy Terrain begins"). It reads the terrain slot of the event, which is the
// terrain that was JUST SET. The library atom field.terrain reads `arena.terrainType`, which is NONE while a Clueless-style effect
// suppresses fields, so it is not the same predicate (request R-B11-C2-10: "the terrain that just began is X"). The gate is therefore a
// legacy closure for now. The effect is the library block effect.apply-tag with a fixed tag (Charged): the class has no constructor
// argument for the tag or the duration, so they are not settings (request R-B11-C2-11 asks the class to take them).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { RechargeChargedOnElectricTerrainAbAttr } from "#data/elite-redux/archetypes/recharge-on-electric-terrain";

export default defineDecl(RechargeChargedOnElectricTerrainAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.terrain-changed",
  label: "Become charged when Electric Terrain begins",
  summary: () =>
    "When a new terrain begins and it is Electric Terrain, I become charged: my next Electric move does double damage. Example: Energized and Generator.",
  synonyms: [
    "energized",
    "generator",
    "charge up on terrain",
    "electric terrain charge",
    "recharge on electric terrain",
    "double the next electric move",
  ],
  examples: ["Get charged up whenever Electric Terrain begins on the field"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the Charged state and its duration (until used) are fixed in the effect, and the terrain is the condition block, not a setting. Staff cannot change them until the class takes them as arguments (request R-B11-C2-11).",
  conditions: [
    // "The terrain that just began is Electric Terrain" (a legacy closure for now, see the header).
    { slot: "gate", ctx: "params", lib: "field.terrain", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["I must be able to take the Charged state (it cannot be added twice)", "Never in a preview"],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "Electric Terrain starting at full HP and at half HP", axes: { hp: ["max", "50%"] } }],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Users: Generator (5208, attr 1) and Energized (5402, attr 1); both are paired with an entry-time Charged attr (PostSummonAddBattlerTagAbAttr). The gate is bound as a legacy closure for both (the terrain-slot atom is missing, R-B11-C2-10). Charged (the tag) is the same state Charge gives; adding it while already charged is refused by `canAddTag`, which is why the residual exists. Shared state: none in the class.",
});
