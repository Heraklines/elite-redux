/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06, Tier C event-effect (bookkeeping half of Cud Chew). See ../PRECEDENTS.md.
//
// "At the end of every turn, remember the berries I ate this turn, so they can be eaten again next turn." The class has no
// `canApply` (always true), no constructor argument (`showAbility` is fixed to false by the class itself) and no closure,
// so there is nothing to bind and nothing to refactor.
//   - `apply`: `pokemon.summonData.berriesEatenLast = pokemon.turnData.berriesEaten`. It does NOT check `simulated` and
//     it stores the SAME array object, not a copy (see notes).
// It only means something together with CudChewConsumeBerryAbAttr, which replays the remembered berries one turn later (that
// class has its own declaration, parked in pending/ until the librarian adds its trigger).
import { CudChewRecordBerryAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CudChewRecordBerryAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Remember the berries I ate this turn",
  summary: () =>
    "At the end of every turn, I remember which berries I ate during it, so another block can eat them again next turn. Example: Cud Chew.",
  synonyms: ["cud chew", "remember eaten berries", "berry memory", "record berries", "chew again later"],
  examples: ["Remember this turn's berries so they can be eaten twice, like Cud Chew"],
  params: [],
  noParamsReason:
    "The class has no constructor argument and no number, type or status: it copies one list of berries from this turn's record into the memory that lasts until I switch out.",
  conditions: [],
  guards: [],
  feasibility: ["Does nothing useful without the block that eats the remembered berries next turn"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [{ name: "end of turn after eating nothing", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE for the effect only (written reason: it is pure bookkeeping, there is no effect block that writes the berry memory, and it has no number, type, stat or status to expose; request R-B06-6 asks for effect.remember-eaten-berries). The trigger is separate and there is no condition. Only user: Cud Chew (291, attr 1; attr 0 is CudChewConsumeBerryAbAttr). Order matters: Cud Chew lists Consume first (it runs in the berry phase, before turn end) and Record second (turn end), so the replay always reads LAST turn's memory. Oddities, not fixed: (1) `apply` ignores `simulated` and writes the memory even for a simulated call; no engine path simulates PostTurn today. (2) It stores the same array object as `turnData.berriesEaten`, not a copy; this is only safe because turnData is replaced at the next turn start. If a future change cleared turnData.berriesEaten in place, the memory would be cleared with it. (3) The class comment says to use it only for Cud Chew.",
});
