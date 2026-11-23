/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 3 / event-effect (Tier B, RNG inside the gate).
//
// Read by hand from archetypes/post-attack-set-field-by-type.ts. The class extends PostAttackAbAttr (WHEN "after my attack
// lands"), constructor `(chance, terrainByType)` with a Map from move type to terrain, `super()` (banner shown, the parent's
// damaging-move rule). canApply in the ORIGINAL clause order:
//   1. parent rule: the move is a damaging move                        gate    (library move.damaging)
//   2. landedDamagingHit: hitResult < NO_EFFECT (the hit really hurt: not missed, not immune)   guards (pure read; moved in
//      front of clause 1)                                              guard "the hit really landed", request R-B10-c3-01
//   3. the move's type is a key of the map                             gate    (library move.type, raw type: move.type, not the
//      effective type, so `effective: false`)
//   4. chance >= 100 || holder.randBattleSeedInt(100) < chance         gate    (library rng.chance; the ONE random draw, last)
// no prepare, no residual. apply: simulated -> nothing; else arena.trySetTerrain(map.get(move.type), false, holder) (the terrain
// priority rules apply and a no-op is silent).
//
// Random draw order: exactly one draw, in clause 4, and only after clauses 1 to 3 passed. The rebuilt gate keeps rng.chance last.
//
// Clause classification: "a damaging move of one of these types" and "the chance" are the rules staff would change, so they are
// the replaceable gate (the chance is repeated in the gate through `gateParams`). The hit-landed test is a guard. Each pair "this
// move type sets that terrain" is split into a non-editable type setting (it IS the gate's type test) and an editable terrain.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TERRAIN_OPTIONS, TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PostAttackSetTerrainByMoveTypeAbAttr } from "#data/elite-redux/archetypes/post-attack-set-field-by-type";
import { buildTerrainByType, NOTHING, terrainPairTerrainCodec, terrainPairTypeCodec } from "./c3-codecs";

const PAIRS = [1, 2, 3, 4] as const;

export default defineDecl(PostAttackSetTerrainByMoveTypeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Sometimes set a terrain that matches my move's type",
  summary: params =>
    `After my damaging move hits, there is a ${params.chance}% chance the terrain changes to the one linked to the move's type. Example: ${params.type1} moves set ${params.terrain1} terrain.`,
  synonyms: [
    "set terrain on hit",
    "terrain by move type",
    "electric moves make electric terrain",
    "terrain after attacking",
    "field change on hit",
    "archmage",
    "familiar",
  ],
  examples: [
    "30% chance that my Electric moves set Electric Terrain and my Grass moves set Grassy Terrain, like Archmage",
    "My Psychic moves sometimes set Psychic Terrain",
  ],
  params: [
    {
      id: "chance",
      ctorIndex: 0,
      path: "chance",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Chance (%)",
      editable: true,
      default: 30,
    },
    ...PAIRS.flatMap(position => [
      {
        id: `type${position}`,
        ctorIndex: 1,
        ctorOption: `type${position}`,
        path: "terrainByType",
        control: "select" as const,
        label: `Built-in rule: move type number ${position} that sets a terrain (None = not used; replaced by the condition block you set)`,
        editable: false,
        default: position === 1 ? "ELECTRIC" : NOTHING,
        options: [NOTHING, ...TYPE_OPTIONS],
        codec: terrainPairTypeCodec(position - 1),
      },
      {
        id: `terrain${position}`,
        ctorIndex: 1,
        ctorOption: `terrain${position}`,
        path: "terrainByType",
        control: "select" as const,
        label: `Terrain that move type number ${position} sets (None = not used)`,
        editable: true,
        gateIndependent: true,
        default: position === 1 ? "ELECTRIC" : NOTHING,
        options: TERRAIN_OPTIONS,
        codec: terrainPairTerrainCodec(position - 1),
      },
    ]),
  ],
  assembleCtorArg: { index: 1, build: buildTerrainByType },
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate: all[ move.damaging, any[ move.type <type of pair> (raw type) ... ], rng.chance pct ], in that order (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really have landed (not missed and not blocked by an immunity)",
    "The terrain only changes if the field accepts it (terrain priority rules apply; a failed change is silent)",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.set-terrain", params: ["terrain1", "terrain2", "terrain3", "terrain4"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: ["canApply gate: the chance roll, drawn last, only after the damaging-move and move-type tests passed"],
    state: "none",
    simulated: "ignores",
  },
  probes: [{ name: "moves of different types", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B split by hand (guards: the hit landed; gate: damaging, type has a terrain, chance roll; no residual). Users (2 attrs): Archmage attr 12 and Familiar attr 13, both 30% with Electric -> Electric, Psychic -> Psychic, Grass -> Grassy, Fairy -> Misty; each bound as all[move.damaging, any[move.type ELECTRIC, PSYCHIC, GRASS, FAIRY (raw type)], rng.chance 30]. The map is four (type, terrain) setting pairs (the class takes any number; a longer map is refused when read back). The hit-landed rule is a guard (a request for a named guard and atom is R-B10-c3-01). The class ignores `simulated` in canApply: it draws and rolls even for a preview, whereas the library atom rng.chance answers true without a draw when simulated (same note as the contact-status precedent); no engine path calls PostAttack attrs simulated today. Oddities, NOT fixed: the class tests the move's printed type (move.type) and not the type after ability changes (a Normalize or -ate ability would not set the terrain of the new type); the chance has no -1 'always' sentinel, 100 means always and then draws nothing; Archmage and Familiar both carry this attr, so a Pokemon with both would roll twice.",
});
