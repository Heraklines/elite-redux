/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03. Tier A with nothing to bind: the class has no canApply (the base class answers true) and no closure.
// `apply` queues one StatStageChangePhase for the holder (skipped when simulated).
//
// WHEN: PostKnockOutAbAttr is dispatched by FaintPhase for EVERY Pokemon on the field once ANY Pokemon has fainted,
// with `victim` = the Pokemon that fainted. It is not limited to knock-outs by the holder (that is PostVictory), so
// Soul-Heart reacts to a foe, an ally or even an indirect faint. The WHEN is registered as "When I knock out a
// Pokemon"; the label is wrong for this class and is part of requests/B03.md.
//
// The `stat` argument may be a function in the type, but no user passes one (all three pass a plain stat).
import { PostKnockOutStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { Stat } from "#enums/stat";

export default defineDecl(PostKnockOutStatStageChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-ko",
  label: "Raise one of my stats whenever a Pokemon faints",
  summary: params =>
    `Whenever any other Pokemon is knocked out, my ${params.stat} changes by ${params.stages} stage(s). Example: +1 Sp. Atk.`,
  synonyms: ["soul heart", "pure good", "fae heart", "boost when anyone faints", "faint boost", "snowball on faint"],
  examples: ["Raise my Sp. Atk by one stage whenever any Pokemon faints"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which stat",
      editable: true,
      default: "SPATK",
      options: ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"],
      codec: enumCodec(Stat, "stat"),
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
  ],
  conditions: [],
  guards: [],
  feasibility: ["The stat must not be at its limit (the game then only says it cannot go any higher)"],
  effect: { id: "effect.stat-stage", params: ["stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "knock out a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 3 attrs: Soul-Heart, Pure Good and Fae Heart, all Sp. Atk +1. The class does not look at the victim: every faint on the field triggers it for every holder, including a faint caused by the holder itself and (if the engine still dispatches to it) the fainted holder. The registered WHEN label 'When I knock out a Pokemon' describes PostVictory, not this dispatch; requested to be corrected. Quirk recorded, not fixed: apply evaluates a function-valued stat even for a simulated call (no user has one, and it would be pure); the phase itself is skipped when simulated.",
});
