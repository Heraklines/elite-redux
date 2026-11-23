/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TypeAbsorbHighestAttackStatBoostAbAttr } from "#data/elite-redux/archetypes/immunity-with-absorb";
import { PokemonType } from "#enums/pokemon-type";

// B09 chunk 4. "Moves of one type do nothing to me and raise my better attacking stat instead" (Heat Sink, Ice Dew, Alluring Skull).
//
// Source: src/data/elite-redux/archetypes/immunity-with-absorb.ts, class TypeAbsorbHighestAttackStatBoostAbAttr (extends
// TypeImmunityStatStageChangeAbAttr, ab-attrs.ts:534). Dispatched while the game checks whether a move can hit the holder
// (`applyAbAttrs("TypeImmunityAbAttr", ...)`).
// Clauses, in order:
//   canApply  (TypeImmunityAbAttr): not a whole-side or field move, the attacker is not the holder, the move's triggered types
//             include the chosen type. No status-move exclusion.                                                -> the immunity itself
//   apply     (overridden): typeMultiplier = 0, `cancelled` = true; when not simulated, pick the stat as
//             `getStat(SPATK, false) > getStat(ATK, false) ? SPATK : ATK` (a tie picks Attack) and queue a StatStageChangePhase
//             on the holder for [that stat] by `boostStages`.                                                    -> effect
// Constructor: ({ type, stages }); throws when stages is 0. It passes ATK to the parent only as a placeholder (apply never
// reads the parent's `stat`). Tier A: nothing to bind. No random draw, no state.
export default defineDecl(TypeAbsorbHighestAttackStatBoostAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Be immune to a type and raise my better attacking stat",
  summary: params =>
    `Moves of the ${params.type} type cannot hurt me; instead my higher attacking stat (Attack or Sp. Atk) rises by ${params.stages} stage(s). Example: Fire, 1 = like Heat Sink.`,
  synonyms: [
    "heat sink",
    "ice dew",
    "alluring skull",
    "absorb and boost best attack",
    "immune and raise highest attack",
    "flash fire",
    "highest attack",
  ],
  examples: [
    "Immune to Fire moves and my higher attacking stat rises by 1 stage when one hits me, like Heat Sink",
    "Immune to Ice moves and my best attack rises by 1 stage, like Ice Dew",
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
      default: "FIRE",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "stages",
      ctorIndex: 0,
      ctorOption: "stages",
      path: "boostStages",
      control: "number",
      label: "Number of stages for my higher attacking stat (1 to 6 raises, -1 to -6 lowers, never 0)",
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
    "The game compares my Attack and Sp. Atk without stat stages; on a tie Attack is chosen",
  ],
  effect: { id: "effect.immune-to-type", params: ["type", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a move of the type and a neutral move, at full HP and one HP below",
      axes: { hp: ["max", "max-1"], foeMove: ["EMBER", "ICE_BEAM", "TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A calc-modifier, 3 attrs: Ice Dew (5116 attr 1, Ice), Heat Sink (5566 attr 1, Fire), Alluring Skull (5965 attr 1, Ghost), all +1. Nothing is bound. The choice of stat is a rule of the effect (no 'raise my better attack' library effect exists), so request R-B09-29 covers it with the other absorb effects. Oddities, not fixed: (a) the class comment says the stat is picked from the current (stage-inclusive) values, but the code calls pokemon.getStat(stat, false), whose second argument is ignoreOverride, which is the stat WITHOUT stat stages; (b) a tie chooses Attack; (c) the parent's `stat` is a placeholder ATK, so the studio's runtime reflection sees ATK on this class (the declaration does not expose it).",
});
