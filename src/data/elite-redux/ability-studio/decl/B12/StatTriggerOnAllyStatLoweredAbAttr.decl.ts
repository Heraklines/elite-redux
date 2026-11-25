/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 1. "When someone lowers my ALLY's stats, change some of my stats" (King's Wrath, Queen's Mourning, Knight's Honor...).
//
// Source: src/data/elite-redux/archetypes/stat-trigger-on-event.ts, StatTriggerOnAllyStatLoweredAbAttr (extends
// PostAllyStatStageChangeAbAttr). Dispatched by stat-stage-change-phase.ts:372 for each ally of the Pokemon whose stat changed;
// `pokemon` is the observer (the holder), `stats`, `stages` and `selfTarget` describe the change on its ally.
// Constructor: one options object `{ stats }`; it throws for an empty list or a zero stage change.
// Clauses, in the original order (Tier B):
//   1. `stages < 0`            GATE (replaceable)  = stage.just-changed { lowered }
//   2. `!selfTarget`           RESIDUAL, kept in the class: the drop came from a foreign source, not the ally's own move. R-B12-05.
// apply: skipped when `simulated`; every listed change is repeated once for each stat that was lowered on the ally
// (`stats.length` times, the stages multiplied). One StatStageChangePhase per listed stat (holder, selfTarget true).
// No random draw. There is no `scope` setting: the repeat is fixed.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { StatTriggerOnAllyStatLoweredAbAttr } from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { statChangesCodec } from "./b12-chunk1-codecs";

const IN_PAYLOAD = { ctorIndex: 0 } as const;

export default defineDecl(StatTriggerOnAllyStatLoweredAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.ally-stat-changed",
  label: "Change my stats when someone lowers my ally's stats",
  summary: params =>
    `When a foe (not my ally's own move) lowers my ally's stats, my stats change once for each stat lowered: ${params.stats}. Example: two stats lowered doubles it.`,
  synonyms: [
    "king's wrath",
    "queen's mourning",
    "knight's honor",
    "partner stat drop reaction",
    "ally was lowered",
    "avenge my partner",
    "boost when my ally is weakened",
  ],
  examples: [
    "Raise my Attack and Defense by one stage for each stat a foe lowers on my ally, like King's Wrath",
    "Raise my Sp. Atk and Sp. Def by one stage when my ally's stats are lowered, like Queen's Mourning",
  ],
  params: [
    {
      id: "stats",
      ...IN_PAYLOAD,
      ctorOption: "stats",
      path: "stats",
      control: "text",
      label: "Stat changes, like 'Attack +1, Defense +1' (stages -6 to 6; the game stops at 6, so 12 acts like 6)",
      editable: true,
      gateIndependent: true,
      default: "Attack +1, Defense +1",
      codec: statChangesCodec,
    },
  ],
  conditions: [
    // The gate is one atom: the change on my ally was a drop (`stages < 0`).
    { slot: "gate", ctx: "params", lib: "stage.just-changed", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only a drop caused by someone else counts, never one from my ally's own move (this rule stays in the ability for now)",
    "I need an ally on the field: the game only tells an ally about the change",
    "A stat that is already at its limit does not move further",
    "Nothing happens when the game only previews the change",
  ],
  effect: { id: "effect.stat-stage", params: ["stats"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a foe lowers my ally's stat", axes: {} }],
  l2StaticReason:
    "The L2 doubles template (event.ally-stat-changed) only attacks and BOOSTS the holder's ally, so the engine never dispatches a stat DROP on the ally and never evaluates this attr (the reach check lists it as unreached). The B12 test (test/tests/elite-redux/decomp/B12/chunk1.test.ts) drives canApply and apply of the original and the rebuild for every live user, over every stage change, own move or not, with one and two stats.",
  status: "decomposed",
  notes:
    "Tier B, 6 attrs, all gates bound to stage.just-changed { lowered }; the `!selfTarget` residual stays in the class (R-B12-05). Always the second half of a StatTriggerOnStatLoweredAbAttr (scope side) on the previous attr, with the same stats: King's Wrath (5145 attr 1), Queen's Mourning (5146 attr 1), Fire Ruler (5664 attr 1), Emperor's Wrath (5671 attr 1 Attack and Defense, attr 3 Sp. Atk and Sp. Def), Knight's Honor (5939 attr 1). The two classes react to disjoint dispatch surfaces (the holder's own drop versus an ally's drop), so no drop is counted twice. The repeat 'once for each stat lowered' multiplies the stages and is not a library effect option yet (R-B12-06). Oddity, not fixed: the gate reads `stages`, the REQUESTED change, so an ally already at -6 still triggers the holder.",
});
