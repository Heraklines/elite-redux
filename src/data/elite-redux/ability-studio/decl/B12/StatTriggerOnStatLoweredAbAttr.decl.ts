/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 1. "When someone lowers one of my stats, change some of my stats" (Defiant style: Rattled, Run Away, King's Wrath...).
//
// Source: src/data/elite-redux/archetypes/stat-trigger-on-event.ts, StatTriggerOnStatLoweredAbAttr (extends
// PostStatStageChangeAbAttr). Dispatched by stat-stage-change-phase.ts:357 on the Pokemon whose stat just changed, with
// `stats` (the stats that really moved), `stages` (the REQUESTED change) and `selfTarget` (my own move caused it).
// Constructor: one options object `{ stats, scope? }`; it throws for an empty list or a zero stage change.
// Clauses, in the original order (Tier B):
//   1. `stages < 0`            GATE (replaceable)  = stage.just-changed { lowered }
//   2. `!selfTarget`           RESIDUAL, kept in the class and checked after the gate: the drop came from someone else, not from
//                              my own move (otherwise Close Combat would trigger a Defiant-style reaction). No library atom or
//                              safety rule says "caused by someone else" yet: R-B12-05.
// apply: skipped when `simulated`. `scope` "self" queues the listed changes once; `scope` "side" repeats every listed change once
// for each stat that was lowered (`stats.length` times, the stages multiplied). One StatStageChangePhase per listed stat
// (holder, selfTarget true). No random draw.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { StatTriggerOnStatLoweredAbAttr } from "#data/elite-redux/archetypes/stat-trigger-on-event";
import {
  LOWER_SCOPE_OPTIONS,
  lowerScopeCodec,
  SCOPE_EACH_DROP,
  SCOPE_ONCE,
  statChangesCodec,
} from "./b12-chunk1-codecs";

const IN_PAYLOAD = { ctorIndex: 0 } as const;

export default defineDecl(StatTriggerOnStatLoweredAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.stat-changed",
  label: "Change my stats when someone lowers one of mine",
  summary: params =>
    `When a foe (not my own move) lowers one of my stats, my stats change: ${params.stats}. ${
      params.scope === SCOPE_EACH_DROP
        ? "The change repeats once for each stat lowered. Example: two stats lowered doubles it."
        : "It happens once per drop. Example: Speed +2, like Rattled."
    }`,
  synonyms: [
    "defiant",
    "competitive",
    "rattled",
    "run away",
    "boost after a stat drop",
    "stat drop reaction",
    "punish intimidate",
    "king's wrath",
  ],
  examples: [
    "Raise Speed by two stages whenever a foe lowers one of my stats",
    "Raise Attack and Defense by one stage for each stat a foe lowers, like King's Wrath",
  ],
  params: [
    {
      id: "stats",
      ...IN_PAYLOAD,
      ctorOption: "stats",
      path: "stats",
      control: "text",
      label: "Stat changes, like 'Speed +2' (stages -6 to 6; the game stops at 6, so 12 acts like 6)",
      editable: true,
      gateIndependent: true,
      default: "Speed +2",
      codec: statChangesCodec,
    },
    {
      id: "scope",
      ...IN_PAYLOAD,
      ctorOption: "scope",
      path: "scope",
      control: "select",
      label: "How often the change happens",
      editable: true,
      gateIndependent: true,
      default: SCOPE_ONCE,
      options: LOWER_SCOPE_OPTIONS,
      codec: lowerScopeCodec,
    },
  ],
  conditions: [
    // The gate is one atom: the stat change was a drop (`stages < 0`).
    { slot: "gate", ctx: "params", lib: "stage.just-changed", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only a drop caused by someone else counts, never one from my own move (this rule stays in the ability for now)",
    "A stat that is already at its limit does not move further",
    "Nothing happens when the game only previews the change",
  ],
  effect: { id: "effect.stat-stage", params: ["stats", "scope"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a foe lowers one of my stats", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B, 13 attrs, all gates bound to stage.just-changed { lowered }; the `!selfTarget` residual stays in the class (request R-B12-05 for an atom or a safety rule). Scope self (once per drop, Speed +2): Run Away (50 attr 1), Rattled (155 attr 4), Wimp Out (193 attr 2), Emergency Exit (194 attr 2), Coward (5165 attr 2), Dust Cloud (5210 attr 1), Tactical Retreat (5282 attr 2). Scope side (once for each stat lowered): King's Wrath (5145 attr 0, Attack +1 and Defense +1), Queen's Mourning (5146 attr 0, Sp. Atk +1 and Sp. Def +1), Fire Ruler (5664 attr 0, Attack and Defense), Emperor's Wrath (5671 attr 0 Attack and Defense, attr 2 Sp. Atk and Sp. Def), Knight's Honor (5939 attr 0, Defense and Sp. Def). Each side-scope user is paired with a StatTriggerOnAllyStatLoweredAbAttr on the next attr (the ally half). The 'once for each stat lowered' repeat multiplies the stages (stages x number of stats lowered) and is not a library effect option yet (R-B12-06). Oddities, not fixed: (a) the gate reads `stages`, the REQUESTED change, not what was really applied: a drop from -6 still triggers; (b) the vanilla-rebalance patcher pushes Rattled's, Wimp Out's, Emergency Exit's and Run Away's attr after construction, which is why they sit at later attr indexes; (c) in the side scope the number of stats comes from the filtered list the phase passes, so a drop of two stats at once counts twice.",
});
