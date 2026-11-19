/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 2. Tier A, event-effect, no condition slot.
//
//   canApply   none of its own (AbAttr answers true)
//   apply      stats  = mirrorIncoming && the dispatch carries stats ? the dispatch's stats : this.stats
//              stages = mirrorIncoming && the dispatch carries a delta ? |delta| : this.stages
//              unless simulated: unshift ONE StatStageChangePhase for the holder with `stats` and `stages`
//              always: cancelled.value = this.overwrites     (written even when simulated)
//
// Dispatched once per foe hit by an Intimidate-family entry effect, right after IntimidateImmunityAbAttr (ab-attrs.ts
// near line 3087). `overwrites` decides whether the incoming drop is cancelled ("Guard Dog: no drop, raise instead") or
// left alone ("Rattled: still drops, and I gain Speed"). Nothing in the class is a yes/no rule, so there is nothing to
// bind: the four constructor arguments are all params.
//
// The class's `apply` is not behind a canApply gate, so the "reaction" has no condition of its own; staff add IFs with
// the usual AND (the WHEN provides only the holder, stat and stage change).
import { PostIntimidateStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { BATTLE_STAT_NAMES, statListCodec } from "./codecs";

export default defineDecl(PostIntimidateStatStageChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.intimidated",
  label: "Change my stats when Intimidate hits me",
  summary: params =>
    `When a foe's Intimidate reaches me, my ${params.stats} change by ${params.stages} stage(s). Example: Rattled raises my Speed by 1 stage.`,
  synonyms: [
    "rattled",
    "guard dog",
    "intimidate reaction",
    "scared boost",
    "speed boost when intimidated",
    "react to intimidate",
  ],
  examples: ["Raise my Speed by one stage when a foe's Intimidate hits me"],
  params: [
    {
      id: "stats",
      ctorIndex: 0,
      path: "stats",
      control: "text",
      label: "Stats to change (comma separated names)",
      editable: true,
      default: "SPD",
      options: [...BATTLE_STAT_NAMES],
      codec: statListCodec,
    },
    {
      id: "stages",
      ctorIndex: 1,
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages to change (+1 raises one stage, -1 lowers one stage)",
      editable: true,
      default: 1,
    },
    {
      id: "overwrites",
      ctorIndex: 2,
      path: "overwrites",
      control: "boolean",
      label: "Also cancel the incoming Intimidate drop (yes = the drop does not happen)",
      editable: true,
      default: false,
    },
    {
      id: "mirrorIncoming",
      ctorIndex: 3,
      path: "mirrorIncoming",
      control: "boolean",
      label: "Raise the same stat by the same amount that was about to drop (instead of the stats above)",
      editable: true,
      default: false,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["The stat must not be at its limit (the game then only says it cannot go any higher)"],
  effect: { id: "effect.stat-stage", params: ["stats", "stages"] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a foe enters with Intimidate", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 2 attrs of 2 abilities: Rattled (155 attr 1: Speed +1, drop NOT cancelled) and Guard Dog (275 attr 0: Attack +1, cancels the drop and mirrors the incoming stat, so Scare/Terrify raise Sp. Atk). Guard Dog is rewritten by init-elite-redux-vanilla-rebalance.ts (`ab.attrs[idx] = new PostIntimidateStatStageChangeAbAttr([Stat.ATK], 1, true, true)`), so the live attr is the ER one. `apply` writes `cancelled.value = this.overwrites` even for a simulated call (only the phase is skipped); the flag is therefore recorded as 'respects' for the effect and the cancel write is noted here. Quirk recorded, not fixed: the write is unconditional, so a non-overwriting reaction (Rattled) sets `cancelled` back to false after an immunity (IntimidateImmunityAbAttr) has set it to true; no shipped ability has both. Rattled's `stats` array is a fresh array per user, so there is no shared mutable state.",
});
