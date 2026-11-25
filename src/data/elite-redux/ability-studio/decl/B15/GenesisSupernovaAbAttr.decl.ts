/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 2. Tier B, event-effect. "After I use a Psychic-type move (damaging or not), Psychic Terrain starts."
//
// Source: src/data/elite-redux/abilities/genesis-supernova.ts, class GenesisSupernovaAbAttr (extends PostMoveUsedAbAttr; showAbility true).
// canApply, in the ORIGINAL clause order (now `gatedCanApply`, so the whole rule is the replaceable `gate`, there is no guard and no residual):
//   1. source.getBattlerIndex() === pokemon.getBattlerIndex()  -> condition "the Pokemon that used the move is me" (PostMoveUsed fires for every field Pokemon)
//   2. source.getMoveType(move.getMove()) === moveType         -> condition "the move is of that type after ability changes" (-ate abilities count)
// apply: unless simulated, arena.trySetTerrain(terrainType, false, holder). The setter is the non-forced one: a terrain that is already up is a no-op.
// Constructor change (behaviour-neutral): the two literals became constructor arguments with the old values as defaults (terrain Psychic, move type Psychic).
// Dispatch: applyAbAttrs("PostMoveUsedAbAttr") after every move (WHEN event.after-any-move; the frame's `other` is the user, `moveUser` is `other`).
// No random draw, no state of its own (the terrain lives in the arena).
import { GenesisSupernovaAbAttr } from "#data/elite-redux/abilities/genesis-supernova";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TerrainType } from "#data/terrain";
import { PokemonType } from "#enums/pokemon-type";

const TERRAIN_CHOICES = ["MISTY", "ELECTRIC", "GRASSY", "PSYCHIC", "TOXIC"];

export default defineDecl(GenesisSupernovaAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-any-move",
  label: "Set a terrain when I use a move of a chosen type",
  summary: params =>
    `Each time I use a ${params.moveType}-type move, damaging or not, the terrain changes to ${params.terrain}. A terrain that is already up is left alone.`,
  synonyms: [
    "genesis supernova",
    "psychic terrain",
    "terrain on move",
    "terrain after a move",
    "set terrain when attacking",
    "move type sets terrain",
  ],
  examples: ["Psychic moves summon Psychic Terrain", "Using a Grass move starts Grassy Terrain"],
  params: [
    {
      id: "terrain",
      ctorIndex: 0,
      path: "terrainType",
      control: "select",
      label: "Terrain to set",
      editable: true,
      default: "PSYCHIC",
      options: TERRAIN_CHOICES,
      codec: enumCodec(TerrainType, "terrain"),
      gateIndependent: true,
    },
    {
      id: "moveType",
      ctorIndex: 1,
      path: "moveType",
      control: "select",
      label: "Move type that triggers it",
      editable: true,
      default: "PSYCHIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  // The type lives twice: the moveType param and the literal type of the gate binding. gateParams keeps them equal.
  gateParams: [{ param: "moveType", block: "move.type", field: "type" }],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: ["A terrain that is already active is left alone", "It does nothing in a preview"],
  effect: { id: "effect.set-terrain", params: ["terrain"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder uses a Psychic move and a Normal move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B, 1 attr in 1 ability: Genesis Supernova (5937 attr 0). The gate holds both clauses in the original order and is bound as all[ side.is self, move.type PSYCHIC effective ]. side.is self compares object identity (other === holder) where the class compares getBattlerIndex(); for the real field Pokemon these agree (the L1 grid uses real Pokemon). Suspected oddity, NOT fixed: getBattlerIndex() of a benched player Pokemon is -1 and of a benched enemy is 1, so a benched enemy that just used a pivot move could in theory match a player holder standing in slot 1; the identity atom cannot. Constructor change is behaviour-neutral (defaults are the old literals).",
});
