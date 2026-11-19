/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / package (Tier C, memory on the Pokemon).
//
// Read by hand from archetypes/on-crit-stat-boost-lowest.ts. PostAttack hook (WHEN "after my hit lands"), constructor
// `{ n, stages }` kept in the private field `opts`; `super(undefined, false)` so there is no closure and the attr
// shows no ability banner.
//   canApply, in the ORIGINAL order:
//     1. once per turn:  pokemon[LAST_TURN_FLAG] === globalScene.currentBattle?.turn ?? 0  -> false  (a Symbol property on
//        the Pokemon OBJECT, written in apply; not simulated)
//     2. `params.opponent` missing -> false
//     3. crit test: opponent.turnData.attacksReceived[0]?.critical  (the FIRST hit the target took this turn)
//   apply: simulated -> nothing. Else write the turn flag, sort the five stats (ATK, DEF, SPATK, SPDEF, SPD) by the holder's
//     current stage (stable sort, ties keep that order), take the first n and queue one StatStageChangePhase of `stages`
//     for each (selfTarget true).
// No random draw. The two oddities in `notes` are NOT fixed here.
//
// Why a package and not three blocks: the library has no atom for "my hit was a critical hit", no memory atom that reads the
// class's own per-Pokemon turn flag, and no effect "raise my lowest stats" (requests R-B10-04, R-B10-05, R-B10-06 in
// requests/B10.md). Until they exist the whole rule is one piece with two typed settings.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OnCritStatBoostLowestAbAttr } from "#data/elite-redux/archetypes/on-crit-stat-boost-lowest";
import { optionNumber } from "./b10-codecs";

export default defineDecl(OnCritStatBoostLowestAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.after-my-hit",
  label: "Raise my lowest stats when I land a critical hit",
  summary: params =>
    `When my move lands a critical hit, raise my ${params.n} lowest stats by ${params.stages} stage each. Works once per turn. Example: 3 stats, 1 stage.`,
  synonyms: ["home run", "crit boost", "critical hit boost", "boost weakest stats", "lowest stats up", "reward crits"],
  examples: ["Landing a critical hit raises my three lowest stats by one stage, once per turn"],
  params: [
    {
      id: "n",
      ctorIndex: 0,
      ctorOption: "n",
      path: "opts",
      control: "number",
      min: 1,
      max: 5,
      step: 1,
      integer: true,
      label: "How many of my lowest stats to raise (1-5)",
      editable: true,
      default: 3,
      codec: optionNumber("n"),
    },
    {
      id: "stages",
      ctorIndex: 0,
      ctorOption: "stages",
      path: "opts",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages to change each of them by (1-6, negative lowers)",
      editable: true,
      default: 1,
      codec: optionNumber("stages"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Works only once per turn for each Pokemon",
    "Needs a target, and the first hit that target took this turn must have been a critical hit",
    "The five stats are ranked by their current stage (Attack, Defense, Sp. Atk, Sp. Def, Speed); ties keep that order",
  ],
  effect: { id: "effect.package", params: ["n", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "I hit a foe with a normal and a critical hit", axes: {} }],
  status: "decomposed",
  notes:
    "Package, justified (see the header). Only user: Home Run (n = 3, stages = 1), nothing to bind. Suspected game bugs, NOT fixed: (1) the once-per-turn memory is a Symbol property written on the Pokemon object with the battle's turn NUMBER, which is never cleared, so a Pokemon that landed a crit on turn 3 of one battle is blocked on turn 3 of the next battle (a party member survives between waves); (2) the crit is read from the TARGET's `attacksReceived[0]`, the first hit the target took this turn, which in doubles or after an ally hit first may be somebody else's hit; (3) a dead code block reads `attacksReceived[0]` of the holder and does nothing. The L1 grid and the L2 twin cannot see the turn memory, so the B10 test (test/tests/elite-redux/decomp/B10/on-crit-stat-boost-lowest.test.ts) drives canApply and apply on the original and the rebuild.",
});
