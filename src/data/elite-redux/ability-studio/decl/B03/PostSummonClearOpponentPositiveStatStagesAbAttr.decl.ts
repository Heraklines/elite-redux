/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 3. Tier A, event-effect on entry, no constructor argument, no closure.
//
//   canApply   some active foe has at least one stat stage above 0 in any of the seven stats
//              (`getOpponents().some(o => o.isActive(true) && BATTLE_STATS.some(s => o.getStatStage(s) > 0))`)
//   apply      unless simulated, for EVERY active foe: each stat stage above 0 is set to 0; drops stay, and my own side
//              is not touched; no message is queued
//
// The "some foe has a raised stat" test is effect-side feasibility: it only decides that there is something to clear,
// and removing it would just make the ability flash its name for nothing. (The library has `stage.compare`, but it
// reads ONE Pokemon and "any foe" is not one of its choices, so it could not stand in for this predicate anyway.) There
// is nothing to tune, so there are no params. No library DO block resets stat stages, so `effect.reset-stat-stages`
// (target foes, which = only the raised ones) is requested in requests/B03.md and `effect` is left out.
import { PostSummonClearOpponentPositiveStatStagesAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonClearOpponentPositiveStatStagesAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Remove every active foe's stat boosts when I enter",
  summary: () =>
    "When I enter the battle, every active foe loses its stat boosts. Their stat drops and my own stages stay. Example: a foe at +2 Attack and -1 Speed ends at 0 Attack and -1 Speed.",
  synonyms: [
    "petrify",
    "clear foe boosts",
    "remove enemy buffs",
    "haze on entry",
    "stat reset foes",
    "remove stat raises",
    "negate boosts",
  ],
  examples: ["Remove the foes' stat boosts when I enter, but keep their stat drops"],
  params: [],
  noParamsReason:
    "The class takes no arguments: it always sets every raised stat stage of every active foe to 0. There is no number, stat or type to tune.",
  conditions: [],
  guards: [],
  feasibility: [
    "At least one active foe must have a raised stat, otherwise nothing happens and the ability does not show",
    "It does nothing in a preview",
  ],
  reusableAlone: { when: true, if: true, do: false },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 1 attr of 1 ability: Petrify (5381 attr 0; its attr 1 is PostSummonStatStageChangeAbAttr, Speed -1 with the Intimidate rules). Dispatch order inside Petrify is attr 0 then attr 1, so the boosts are cleared before the Speed drop. The foe's raised stages come from the harness field, which has one foe at 0 everywhere, so L2 proves only the 'nothing to clear' path; test/tests/elite-redux/decomp/B03/chunk3.test.ts drives the real attr with raised and lowered foes. Pending request: `effect.reset-stat-stages` (requests/B03.md). Unlike PostSummonClearAllyStatStagesAbAttr this class queues no message.",
});
