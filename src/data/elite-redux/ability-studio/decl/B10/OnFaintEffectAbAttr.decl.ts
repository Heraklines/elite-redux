/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / event-effect (Tier B, seven branches).
//
// Read by hand from archetypes/on-faint-effect.ts. PostFaint hook (WHEN "when I faint"), constructor `{ effect }` where
// `effect` is a discriminated union of seven payloads; `super(true)` so the ability banner shows. The constructor validates the
// payload (no NONE weather, a damage fraction in (0, 1], layers a positive integer, turns a non-negative integer, at least one
// non-zero stat change). No random draw anywhere, and `apply` returns at once when simulated.
//
// The old `canApply` switched on the kind. It is now the Tier B split `gate` then `residual`, per kind and in the ORIGINAL clause
// order of that kind (a pure move of code, every clause is a read):
//   kind                 gate (about the Pokemon that knocked me out)                residual (stays in the class)
//   set-weather          always true                                                 the field accepts the weather
//   set-terrain          always true                                                 the field accepts the terrain
//   attacker-damage-flat there is an attacker AND a known move                       the attacker does not block indirect damage (Magic Guard)
//   set-hazard           always true                                                 always true
//   attacker-battler-tag there is an attacker, it is standing, it is NOT of a        always true
//                        skipped type
//   attacker-stat-change there is an attacker and it is standing                     always true
//   attacker-pp-drain    there is an attacker, a known move, the attacker is         the move is in the attacker's moveset with PP left
//                        standing, and the move is not a status move
//
// Every setting is its own param (the kind, and the weather, terrain, percent, hazard, layers, effect, turns, skipped type, two
// stats with their stages and the stages for the attacker's allies). `assembleCtorArg` builds the one `{ effect }` object from
// the settings of the chosen kind; each setting's codec reads its value back out of a live payload.
//
// The seven branches name the library block each one maps to. effect.set-weather, effect.set-terrain and effect.stat-stage
// (target: the Pokemon that knocked me out, slot `other` of "when I faint") are real library effects, so a plain "lower the
// attacker's Attack by 2" can be built from blocks today; this class is needed for the parts the library cannot do (lowering the
// attacker's allies too, the hurt, hazard, lasting-effect and PP-drain payloads: requests R-B10-c1-01 to R-B10-c1-04).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TERRAIN_OPTIONS, TYPE_OPTIONS, WEATHER_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import {
  buildFaintEffect,
  FAINT_HAZARDS,
  FAINT_KIND_HAZARD,
  FAINT_KIND_HURT,
  FAINT_KIND_PP,
  FAINT_KIND_STATS,
  FAINT_KIND_TAG,
  FAINT_KIND_TERRAIN,
  FAINT_KIND_WEATHER,
  FAINT_KINDS,
  FAINT_STATS,
  FAINT_TAGS,
  faintAllyStagesCodec,
  faintHazardCodec,
  faintHurtPercentCodec,
  faintKindCodec,
  faintLayersCodec,
  faintSkipTypeCodec,
  faintStagesCodec,
  faintStatCodec,
  faintTagCodec,
  faintTerrainCodec,
  faintTurnsCodec,
  faintWeatherCodec,
  NO_STAT,
  NO_TYPE,
} from "./b10-codecs";

/** Every setting lives inside the one `{ effect }` argument; `ctorOption` only names the setting (the builder places it). */
const IN_EFFECT = { ctorIndex: 0, path: "effect" } as const;

const SOME_WEATHERS = WEATHER_OPTIONS.filter(name => name !== "NONE");

export default defineDecl(OnFaintEffectAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.faint",
  label: "Punish whoever knocked me out, or change the field",
  summary: params => {
    const stat = (name: unknown, stages: unknown): string => `${String(name)} changed by ${String(stages)} stages`;
    switch (params.kind) {
      case FAINT_KIND_WEATHER:
        return `When I faint, the weather changes to ${params.weather}. It fails if a stronger weather is active.`;
      case FAINT_KIND_TERRAIN:
        return `When I faint, the terrain changes to ${params.terrain}.`;
      case FAINT_KIND_HURT:
        return `When I faint, the Pokemon that knocked me out loses ${params.hurtPercent}% of its max HP. Example: 25 = a quarter.`;
      case FAINT_KIND_HAZARD:
        return `When I faint, ${params.hazard} (${params.layers} layers) is set on the foe's side.`;
      case FAINT_KIND_TAG:
        return `When I faint, the Pokemon that knocked me out gets ${params.tag} (0 turns = until removed). Attackers of the skipped type (${params.skipType}) are not affected.`;
      case FAINT_KIND_STATS:
        return `When I faint, the Pokemon that knocked me out has its ${stat(params.stat, params.stages)}${params.stat2 === NO_STAT || params.stat2 === "None" ? "" : ` and its ${stat(params.stat2, params.stages2)}`}. Its allies get ${params.allyStages} and ${params.allyStages2} stages.`;
      case FAINT_KIND_PP:
        return "When I faint, the move that knocked me out loses all its PP in the attacker's moves. It must be a damaging move.";
      default:
        return "When I faint, something happens to the Pokemon that knocked me out or to the field.";
    }
  },
  synonyms: [
    "last words",
    "aftermath",
    "revenge when knocked out",
    "curse the attacker",
    "lower the attacker's stats on faint",
    "set weather when fainting",
    "set a hazard when fainting",
    "guilt trip",
    "ill will",
    "haunted spirit",
    "vengeful spirit",
  ],
  examples: [
    "When I am knocked out, curse the Pokemon that knocked me out unless it is a Ghost type, like Haunted Spirit",
    "When I faint, lower the attacker's Attack and Sp. Atk by 2 and its allies' by 1, like Guilt Trip",
    "When I faint, drain all the PP of the move that knocked me out, like Ill Will",
    "When I faint, set Stealth Rock on the foe's side",
    "When I faint, the attacker loses 25% of its max HP",
  ],
  params: [
    {
      id: "kind",
      ...IN_EFFECT,
      ctorOption: "kind",
      control: "select",
      label: "What happens when I faint",
      editable: true,
      gateIndependent: true,
      default: FAINT_KIND_TAG,
      options: FAINT_KINDS,
      codec: faintKindCodec,
    },
    {
      id: "weather",
      ...IN_EFFECT,
      ctorOption: "weather",
      control: "select",
      label: "Weather to set",
      editable: true,
      gateIndependent: true,
      default: "SANDSTORM",
      options: SOME_WEATHERS,
      codec: faintWeatherCodec,
    },
    {
      id: "terrain",
      ...IN_EFFECT,
      ctorOption: "terrain",
      control: "select",
      label: "Terrain to set",
      editable: true,
      gateIndependent: true,
      default: "GRASSY",
      options: TERRAIN_OPTIONS,
      codec: faintTerrainCodec,
    },
    {
      id: "hurtPercent",
      ...IN_EFFECT,
      ctorOption: "hurtPercent",
      control: "number",
      min: 1,
      max: 100,
      step: 1,
      label: "Damage to the Pokemon that knocked me out (% of its max HP)",
      editable: true,
      gateIndependent: true,
      default: 25,
      codec: faintHurtPercentCodec,
    },
    {
      id: "hazard",
      ...IN_EFFECT,
      ctorOption: "hazard",
      control: "select",
      label: "Hazard to set on the foe's side",
      editable: true,
      gateIndependent: true,
      default: "STEALTH_ROCK",
      options: FAINT_HAZARDS,
      codec: faintHazardCodec,
    },
    {
      id: "layers",
      ...IN_EFFECT,
      ctorOption: "layers",
      control: "number",
      min: 1,
      max: 3,
      step: 1,
      integer: true,
      label: "Number of layers of the hazard (1-3)",
      editable: true,
      gateIndependent: true,
      default: 1,
      codec: faintLayersCodec,
    },
    {
      id: "tag",
      ...IN_EFFECT,
      ctorOption: "tag",
      control: "select",
      label: "Lasting effect to put on the Pokemon that knocked me out",
      editable: true,
      gateIndependent: true,
      default: "CURSED",
      options: FAINT_TAGS,
      codec: faintTagCodec,
    },
    {
      id: "turns",
      ...IN_EFFECT,
      ctorOption: "turns",
      control: "number",
      min: 0,
      max: 10,
      step: 1,
      integer: true,
      label: "Turns the lasting effect lasts (0 = until it is removed)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: faintTurnsCodec,
    },
    {
      id: "skipType",
      ...IN_EFFECT,
      ctorOption: "skipType",
      control: "select",
      label: "Do not affect attackers of this type (None = affect every type)",
      editable: true,
      default: "GHOST",
      options: [NO_TYPE, ...TYPE_OPTIONS],
      codec: faintSkipTypeCodec,
    },
    {
      id: "stat",
      ...IN_EFFECT,
      ctorOption: "stat",
      control: "select",
      label: "First stat of the Pokemon that knocked me out to change",
      editable: true,
      gateIndependent: true,
      default: "ATK",
      options: FAINT_STATS,
      codec: faintStatCodec(0),
    },
    {
      id: "stages",
      ...IN_EFFECT,
      ctorOption: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages to change the first stat by (-6 to 6, not 0; negative lowers)",
      editable: true,
      gateIndependent: true,
      default: -2,
      codec: faintStagesCodec(0),
    },
    {
      id: "allyStages",
      ...IN_EFFECT,
      ctorOption: "allyStages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages to change the same stat of its allies by (0 = leave allies alone)",
      editable: true,
      gateIndependent: true,
      default: -1,
      codec: faintAllyStagesCodec(0),
    },
    {
      id: "stat2",
      ...IN_EFFECT,
      ctorOption: "stat2",
      control: "select",
      label: "Second stat to change (None = only the first stat)",
      editable: true,
      gateIndependent: true,
      default: "SPATK",
      options: [NO_STAT, ...FAINT_STATS],
      codec: faintStatCodec(1),
    },
    {
      id: "stages2",
      ...IN_EFFECT,
      ctorOption: "stages2",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages to change the second stat by (-6 to 6; used only with a second stat)",
      editable: true,
      gateIndependent: true,
      default: -2,
      codec: faintStagesCodec(1),
    },
    {
      id: "allyStages2",
      ...IN_EFFECT,
      ctorOption: "allyStages2",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages to change the second stat of its allies by (0 = leave allies alone)",
      editable: true,
      gateIndependent: true,
      default: -1,
      codec: faintAllyStagesCodec(1),
    },
  ],
  assembleCtorArg: { index: 0, build: buildFaintEffect },
  // The skipped type is the one setting the gate reads: "the attacker is NOT of this type" (mon.has-type, who: other).
  gateParams: [{ param: "skipType", block: "mon.has-type", field: "type" }],
  conditions: [
    // The gate: the clauses about the Pokemon that knocked me out, per kind (table in the header). All five live users carry a
    // written legacy binding in bindings.ts until the library has "that Pokemon is still standing" (R-B10-c1-05).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Setting the weather or terrain only works if the field accepts it (a stronger weather cannot be replaced)",
    "Hurting the attacker does nothing to a Pokemon that blocks indirect damage (like Magic Guard)",
    "Draining PP needs that move to be in the attacker's moves with PP left",
    "Nothing happens in a preview",
  ],
  branches: [
    {
      label: "Set the weather",
      conditions: ["the field accepts this weather (kept in the class)"],
      effect: { id: "effect.set-weather", params: ["weather"] },
    },
    {
      label: "Set the terrain",
      conditions: ["the field accepts this terrain (kept in the class)"],
      effect: { id: "effect.set-terrain", params: ["terrain"] },
    },
    {
      label: "Hurt the Pokemon that knocked me out",
      conditions: [
        "there is a Pokemon that knocked me out and a move that did it (gate)",
        "it does not block indirect damage (kept in the class)",
      ],
      effect: { id: "effect.package", params: ["hurtPercent"] },
    },
    {
      label: "Set a hazard on the foe's side",
      conditions: [],
      effect: { id: "effect.arena-tag", params: ["hazard", "layers"] },
    },
    {
      label: "Put a lasting effect on the one that knocked me out",
      conditions: [
        "the Pokemon that knocked me out is still standing (gate, requested atom)",
        "it is not of the skipped type (mon.has-type, who = other, inside a not)",
      ],
      effect: { id: "effect.apply-tag", params: ["tag", "turns", "skipType"] },
    },
    {
      label: "Change the stats of the one that knocked me out",
      conditions: ["the Pokemon that knocked me out is still standing (gate, requested atom)"],
      effect: { id: "effect.stat-stage", params: ["stat", "stages", "stat2", "stages2", "allyStages", "allyStages2"] },
    },
    {
      label: "Drain the PP of the move that knocked me out",
      conditions: [
        "the Pokemon that knocked me out is still standing (gate, requested atom)",
        "the move that did it is a damaging move (move.damaging)",
        "that move is in its moves with PP left (kept in the class)",
      ],
      effect: { id: "effect.package", params: [] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a foe knocks me out", axes: {} }],
  l2StaticReason:
    "The L2 faint scenario never makes the engine evaluate a PostFaintAbAttr of the holder (the reach ratchet lists event.faint as unreached), so the original cannot be shown evaluating the attr. The B10 test (test/tests/elite-redux/decomp/B10/on-faint-effect.test.ts) drives canApply and apply of the original and the rebuild for every live user and every payload kind.",
  status: "decomposed",
  notes:
    "Tier B, one block with a kind setting and seven branches (not a one-sentence package): the weather, terrain, percent, hazard, layers, lasting effect, turns, skipped type, stats and stages are separate settings; the gate/residual split exposes the clauses about the Pokemon that knocked me out. Users (5 attrs): Haunted Spirit and Vengeful Spirit (curse the attacker, not against Ghost), Guilt Trip (attacker Attack and Sp. Atk -2, its allies -1 each), Ill Will and Cursed Spirit (drain PP; Cursed Spirit is a PP drain, not a curse). The gate of each is bound legacy (the library has no 'that Pokemon is still standing' atom, R-B10-c1-05); the effect blocks that exist (set weather, set terrain, stat stage with target other) are named in the branches. Set-weather, set-terrain, hurt and set-hazard are not used by a live ability today but are declared and built by the B10 test. Representable limits, not fixed: a lasting effect skips ONE type (the class takes a list), a stat change has two stats (the class takes a list), allies get the same stats as the attacker, the lasting-effect and hazard choices are short lists (the class takes any). Oddities, not fixed: a lasting effect written without turns lasts until lifted (the class treats a missing number as 0); the hazard payload is added to the side opposite the fainting Pokemon even when the attacker is on the same side as the fainter.",
});
