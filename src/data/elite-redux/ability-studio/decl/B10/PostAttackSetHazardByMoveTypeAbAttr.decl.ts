/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 3 / event-effect (Tier B, RNG inside the gate).
//
// Read by hand from archetypes/post-attack-set-field-by-type.ts. The class extends PostAttackAbAttr (WHEN "after my attack
// lands"), constructor `(chance, moveType, tagType)`, `super()` (banner shown, the parent's damaging-move rule). canApply in the
// ORIGINAL clause order:
//   1. parent rule: the move is a damaging move                        gate    (library move.damaging)
//   2. landedDamagingHit: hitResult < NO_EFFECT                        guards  (pure read, moved in front of clause 1;
//                                                                              guard "the hit really landed", R-B10-c3-01)
//   3. move.type === moveType (the printed type)                       gate    (library move.type, `effective: false`)
//   4. chance >= 100 || holder.randBattleSeedInt(100) < chance         gate    (library rng.chance; the ONE random draw, last)
// no prepare, no residual. apply: simulated -> nothing; else arena.addTag(tagType, 0, undefined, holder.id, the foe's side).
//
// Random draw order: one draw, clause 4, only after clauses 1 to 3 passed. Same shape as the terrain class.
//
// Clause classification: the move type and the chance are the rules staff would change, so both are in the replaceable gate and
// both are editable settings kept equal to the gate's atoms through `gateParams`. The hazard to lay is an effect setting.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PostAttackSetHazardByMoveTypeAbAttr } from "#data/elite-redux/archetypes/post-attack-set-field-by-type";
import { PokemonType } from "#enums/pokemon-type";
import { HAZARD_CHOICES, hazardCodec } from "./c3-codecs";

export default defineDecl(PostAttackSetHazardByMoveTypeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Lay a hazard (sometimes) when a move of one type hits",
  summary: params =>
    `After my ${params.moveType} move hits, there is a ${params.chance}% chance that ${params.hazard} is laid on the foe's side. Example: Rock moves lay Stealth rock.`,
  synonyms: [
    "set stealth rock on hit",
    "hazard on hit",
    "entry hazard after attacking",
    "spikes after attacking",
    "rock moves lay stealth rock",
    "archmage",
    "familiar",
  ],
  examples: [
    "30% chance that my Rock moves set Stealth Rock on the foe's side, like Archmage",
    "My Poison moves sometimes lay Toxic Spikes",
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
    {
      id: "moveType",
      ctorIndex: 1,
      path: "moveType",
      control: "select",
      label: "Type of move that lays the hazard",
      editable: true,
      default: "ROCK",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "hazard",
      ctorIndex: 2,
      path: "tagType",
      control: "select",
      label: "Hazard to lay on the foe's side",
      editable: true,
      gateIndependent: true,
      default: "STEALTH_ROCK",
      options: HAZARD_CHOICES,
      codec: hazardCodec,
    },
  ],
  gateParams: [
    { param: "chance", block: "rng.chance", field: "pct" },
    { param: "moveType", block: "move.type", field: "type" },
  ],
  conditions: [
    // The gate: all[ move.damaging, move.type <moveType> (raw type), rng.chance pct ], in that order (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really have landed (not missed and not blocked by an immunity)",
    "The hazard is laid on the side opposite me; the field decides what happens when it is already there",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.arena-tag", params: ["hazard"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: ["canApply gate: the chance roll, drawn last, only after the damaging-move and move-type tests passed"],
    state: "none",
    simulated: "ignores",
  },
  probes: [{ name: "a Rock move and other moves", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B split by hand (guards: the hit landed; gate: damaging, move type, chance roll; no residual). Users (2 attrs): Archmage attr 13 and Familiar attr 14, both 30% Rock -> Stealth Rock, each bound as all[move.damaging, move.type ROCK (raw type), rng.chance 30]. The hazard choice lists the four common hazards (the class takes any field effect; a live instance with another one is refused when read back). The class ignores `simulated` in canApply (it rolls for a preview); the library atom answers true without a draw when simulated; no engine path calls PostAttack attrs simulated today. Oddities, NOT fixed: the class passes no layer count to the field, so a layered hazard gets whatever one bare add gives; the class tests the move's printed type, not the type after ability changes; Archmage and Familiar both carry this attr.",
});
