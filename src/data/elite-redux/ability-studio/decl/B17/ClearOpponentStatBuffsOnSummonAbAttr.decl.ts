/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 2 / Pressure (its stat-clearing rider). Read by hand: init-elite-redux-vanilla-rebalance.ts
// `ClearOpponentStatBuffsOnSummonAbAttr` (the one user pushes it onto the vanilla ability:
// `ab.attrs.push(new ClearOpponentStatBuffsOnSummonAbAttr())`), its base PostSummonAbAttr (ab-attrs.ts; this class passes
// super(true)) and the dispatch of `PostSummonAbAttr`. Pressure's other attrs are IncreasePpAbAttr and PostSummonMessageAbAttr
// (separate classes in other batches).
//
// canApply: `pokemon.getOpponents().length > 0` (feasibility, a foe exists). No guards, no condition, no residual, no closure.
// apply, unless simulated: for every ADJACENT foe that is not fainted: for each of Attack, Defense, Sp. Atk, Sp. Def, Speed,
// Accuracy, Evasion in that order: if `opp.getStatStage(stat) > 0`, `opp.setStatStage(stat, 0)` (negative stages are left alone);
// then `opp.updateInfo()`. No message, no random draw.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ClearOpponentStatBuffsOnSummonAbAttr } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";

export default defineDecl(ClearOpponentStatBuffsOnSummonAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Wipe the stat boosts of adjacent foes when I enter",
  summary: () =>
    "When I enter the battle, every raised stat of each adjacent foe goes back to normal. Lowered stats stay lowered. Example: a foe at +2 Attack and -1 Defense ends at 0 and -1.",
  synonyms: ["pressure", "clear boosts", "remove stat boosts", "reset foe stats", "haze on entry", "cancel buffs"],
  examples: ["Remove the foes' stat boosts when I switch in", "Reset every raised foe stat to normal on entry"],
  params: [],
  noParamsReason:
    "The rule has no number, type, stat or status to set: it always resets every raised stage of all seven battle stats (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy, Evasion) of every adjacent foe to 0.",
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must be on the field",
    "Only foes next to me are affected in a double or triple battle, and fainted foes are skipped",
    "It never changes anything for a preview (a simulated entry)",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Entry against the grid's foe; raised and lowered foe stages are driven in alchemy-pressure.test.ts because the grid
      // foe starts with neutral stages.
      name: "enter against a foe",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Tier C, PACKAGE with a written reason: effect.stat-stage only RAISES or LOWERS a chosen stat by a number of stages, so it cannot reproduce 'set every stage above zero back to zero, leave stages below zero alone, for seven stats on every adjacent foe' (the amount differs per stat and per foe). Request R21 asks for a 'reset raised stat stages' effect with who (adjacent foes, holder, all) and which stats. No typed param exists (the seven stats are fixed). The trigger is a separate block, extra IFs can be ANDed on top. Users: Pressure (46, attr 2) only. Oddity, not a bug: canApply counts all foes while apply only reaches adjacent ones, so with no adjacent foe the ability flyout shows and nothing happens; the class shows no message of its own (the Pressure entry message comes from PostSummonMessageAbAttr). No game bug found.",
});
