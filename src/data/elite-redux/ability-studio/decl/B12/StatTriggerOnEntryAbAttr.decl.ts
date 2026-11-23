/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 1. "When I enter the battle, change some of my stats" (Headstrong, the Embody Aspect family, Petal Shield).
//
// Source: src/data/elite-redux/archetypes/stat-trigger-on-event.ts, StatTriggerOnEntryAbAttr (extends PostSummonAbAttr).
// Constructor: one options object `{ stats }`; `super(true)` makes the ability also work when it is gained in the middle of a
// battle (activateOnGain); it throws for an empty list or a zero stage change.
// Clauses: there is NO canApply (the base class answers true), so there is no gate, no guard and nothing to bind. Tier A.
// apply: skipped when `simulated`; one StatStageChangePhase per entry of `stats` (holder, selfTarget true). No random draw.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { StatTriggerOnEntryAbAttr } from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { statChangesCodec } from "./b12-chunk1-codecs";

export default defineDecl(StatTriggerOnEntryAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Change my stats when I enter the battle",
  summary: params =>
    `As soon as I enter the battle, my stats change: ${params.stats}. Example: Sp. Def +1, like Headstrong. It also works when the ability is gained mid-battle.`,
  synonyms: [
    "headstrong",
    "embody aspect",
    "petal shield",
    "switch in boost",
    "start with a boost",
    "entry boost",
    "self buff on entry",
  ],
  examples: [
    "Raise Sp. Def by one stage when I enter the battle, like Headstrong",
    "Raise Defense by 12 stages (the most the game allows is 6) when I enter, like Petal Shield",
  ],
  params: [
    {
      id: "stats",
      ctorIndex: 0,
      ctorOption: "stats",
      path: "stats",
      control: "text",
      label: "Stat changes, like 'Sp. Def +1, Speed +1' (stages -6 to 6; the game stops at 6, so 12 acts like 6)",
      editable: true,
      default: "Sp. Def +1",
      codec: statChangesCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A stat that is already at its limit does not move further",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.stat-stage", params: ["stats"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, nothing to bind, 1 attr: Petal Shield (5713 attr 0, Defense +12, which the phase clamps to +6; attr 1 of the same ability is a StatTriggerOnHitAbAttr, Defense -1 on every hit). The class has no canApply, so it fires on every entry and on every mid-battle ability gain (activateOnGain true), as the plain stat-on-entry effect does. Oddity, not fixed: +12 is more than the game allows (a stage change stops at 6), so it ends at +6 exactly like a +6 would; the class only refuses a zero change.",
});
