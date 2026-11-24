/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 3, Tier B event-effect. "After a hit that really hurt me, the terrain changes."
//   canApply (now `gatedCanApply`): `gate` then `residual`, in the original order
//     gate      `hitResult < HitResult.NO_EFFECT`            = the hit dealt damage (Effective, Super effective, Not very
//                                                              effective or One-hit KO), not a blocked or immune hit
//     residual  `arena.canSetTerrain(terrainType)`           = feasibility (that terrain can be set right now)
//   apply     (skipped when `simulated`) `arena.trySetTerrain(terrainType, false, holder)`
// The terrain is a real constructor argument (ctor 0) and the effect is the library's "Set the terrain".
//
// Honest limit of the gate binding: there is no library atom for "the hit dealt damage" (the frame has the `hitResult`
// slot, no atom reads it), so Seed Sower's gate is a legacy-closure until the librarian adds one (R-B01-23).
import { PostDefendTerrainChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TerrainType } from "#data/terrain";

export default defineDecl(PostDefendTerrainChangeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Change the terrain after a damaging hit on me",
  summary: params =>
    `After a move deals damage to me, the terrain becomes ${params.terrain}. Example: Grassy terrain after any damaging hit, like Seed Sower.`,
  synonyms: [
    "seed sower",
    "set terrain when hit",
    "grassy terrain on hit",
    "terrain on being hit",
    "electric terrain when hit",
    "field change when hit",
  ],
  examples: ["Set Grassy terrain when I take damage from a move, like Seed Sower"],
  params: [
    {
      id: "terrain",
      ctorIndex: 0,
      path: "terrainType",
      control: "select",
      label: "Which terrain is set",
      editable: true,
      gateIndependent: true,
      default: "GRASSY",
      options: ["MISTY", "ELECTRIC", "GRASSY", "PSYCHIC", "TOXIC"],
      codec: enumCodec(TerrainType, "terrain"),
    },
  ],
  conditions: [
    // The gate is the single clause "the hit dealt damage" (no library atom yet).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "That terrain must be possible right now (for example it is not already active)",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.set-terrain", params: ["terrain"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a damaging hit and a status move",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (1 attr): Seed Sower (269 attr 0, Grassy). Its sibling attr PostDefendPartyStatusHealAbAttr (attr 1, another batch) heals the whole party on the same trigger, and the ability has bypassFaint so it still fires when the hit knocks the holder out. The gate is a legacy-closure pending R-B01-23. The terrain list leaves out None: setting 'no terrain' is not a terrain change a player would expect from this block.",
});
