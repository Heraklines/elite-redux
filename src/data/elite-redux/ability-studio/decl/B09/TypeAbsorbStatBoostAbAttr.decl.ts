/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS, TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TypeAbsorbStatBoostAbAttr } from "#data/elite-redux/archetypes/immunity-with-absorb";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";

// B09 chunk 4. "Moves of one type do nothing to me and change one of my stats instead" (Aerodynamics, Fluttering Spirit; the
// Storm Drain, Motor Drive and Sap Sipper idea).
//
// Source: src/data/elite-redux/archetypes/immunity-with-absorb.ts, class TypeAbsorbStatBoostAbAttr (extends
// TypeImmunityStatStageChangeAbAttr, which extends TypeImmunityAbAttr, ab-attrs.ts:458-552). Dispatched while the game checks
// whether a move can hit the holder (`applyAbAttrs("TypeImmunityAbAttr", ...)`).
// Clauses, in order:
//   canApply  (TypeImmunityAbAttr): the move does not target a whole side or the field, the attacker is not the holder, and the
//             move's triggered types include the chosen type. No status-move exclusion.                         -> the immunity itself
//   apply     (parent, not overridden): typeMultiplier = 0, `cancelled` = true (so "no effect" is never shown), and when the call is
//             not simulated queue a StatStageChangePhase on the holder for [stat] by `stages`.                    -> effect
// Constructor: ({ type, stat, stages }), one options object; throws when stages is 0. The parent gets no condition closure.
// Tier A: nothing to bind. No random draw, no state.
export default defineDecl(TypeAbsorbStatBoostAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Be immune to a type and change a stat when hit by it",
  summary: params =>
    `Moves of the ${params.type} type cannot hurt me; instead my ${params.stat} changes by ${params.stages} stage(s). Example: Flying, Speed, 1 = like Aerodynamics.`,
  synonyms: [
    "storm drain",
    "motor drive",
    "sap sipper",
    "lightning rod",
    "absorb a type and boost",
    "immune and raise a stat",
    "aerodynamics",
  ],
  examples: [
    "Immune to Flying moves and my Speed rises by 1 stage when one hits me, like Aerodynamics",
    "Immune to Grass moves and my Attack rises by 1 stage, like Sap Sipper",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      ctorOption: "type",
      path: "immuneType",
      control: "select",
      label: "Immune to moves of this type",
      editable: true,
      default: "WATER",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "stat",
      ctorIndex: 0,
      ctorOption: "stat",
      path: "stat",
      control: "select",
      label: "Which stat changes (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy or Evasion)",
      editable: true,
      default: "SPATK",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "stages",
      ctorIndex: 0,
      ctorOption: "stages",
      path: "stages",
      control: "number",
      label: "Number of stages (1 to 6 raises, -1 to -6 lowers, never 0)",
      editable: true,
      integer: true,
      min: -6,
      max: 6,
      step: 1,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Moves that hit a whole side or the whole field (Spikes, Rain Dance) and my own moves are never blocked",
    "Status moves of the chosen type are blocked too (unlike a plain type immunity)",
    "The stat change happens even at full HP, and nothing happens if the stat cannot go further",
  ],
  effect: { id: "effect.immune-to-type", params: ["type", "stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a move of the type and a neutral move, at full HP and one HP below",
      axes: { hp: ["max", "max-1"], foeMove: ["GUST", "TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A calc-modifier, 2 attrs: Aerodynamics (5020 attr 0) and Fluttering Spirit (6019 attr 4), both Flying and Speed +1. Nothing is bound (no closure; the inherited condition is null). The stat change has no library effect inside this moment, so effect.immune-to-type names all three settings and request R-B09-29 asks for one 'absorb' effect. The stages value 0 makes the constructor throw; the number control cannot forbid one value, so the label says never 0 and a build with 0 fails with the class's own message. Oddities, not fixed: (a) `cancelled` is set even when the stat change cannot happen (already at +6), so the player never sees the no-effect message; (b) no status-move exclusion, like the heal sibling.",
});
