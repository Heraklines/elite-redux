/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / event-effect (Tier B, memory on the Pokemon).
//
// Read by hand from archetypes/on-crit-stat-boost-lowest.ts. PostAttack hook (WHEN "after my hit lands"), constructor
// `{ n, stages }` kept in the private field `opts`; `super(undefined, false)` so there is no closure and the attr
// shows no ability banner.
//   old canApply, in the ORIGINAL order:
//     1. once per turn:  pokemon[LAST_TURN_FLAG] === globalScene.currentBattle?.turn ?? 0  -> false  (a Symbol property on
//        the Pokemon OBJECT, written in apply; not simulated)
//     2. `params.opponent` missing -> false
//     3. crit test: opponent.turnData.attacksReceived[0]?.critical  (the FIRST hit the target took this turn)
//   apply: simulated -> nothing. Else write the turn flag, sort the five stats (ATK, DEF, SPATK, SPDEF, SPD) by the holder's
//     current stage (stable sort, ties keep that order), take the first n and queue one StatStageChangePhase of `stages`
//     for each (selfTarget true).
// No random draw.
//
// Tier B split (a pure move of code): all three clauses of the old canApply are CONDITIONS (a rule staff may change: "once per
// turn", "my hit was a critical hit"), so they are the `gate`, in the old order, and nothing stays as a residual. The effect is
// "raise my lowest stats" (no library effect yet, R-B10-06). The gate is bound legacy for Home Run: the library has neither
// "my hit was a critical hit" (R-B10-04) nor a once-per-turn memory that shares the class's own flag (R-B10-05).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OnCritStatBoostLowestAbAttr } from "#data/elite-redux/archetypes/on-crit-stat-boost-lowest";
import { optionNumber } from "./b10-codecs";

export default defineDecl(OnCritStatBoostLowestAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Raise my lowest stats after a critical hit, once a turn",
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
      // Read only by apply; the gate never repeats it.
      gateIndependent: true,
      default: 3,
      codec: optionNumber("n"),
    },
    {
      id: "stages",
      ctorIndex: 0,
      ctorOption: "stages",
      path: "opts",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages to raise each of them by (1-6)",
      editable: true,
      gateIndependent: true,
      default: 1,
      codec: optionNumber("stages"),
    },
  ],
  conditions: [
    // The gate, in the old order: not already used this turn, there is a target, and the first hit that target took this turn
    // was a critical hit. Legacy binding in bindings.ts until R-B10-04 and R-B10-05 exist.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The five stats are ranked by their current stage (Attack, Defense, Sp. Atk, Sp. Def, Speed); ties keep that order",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.package", params: ["n", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "I hit a foe with a normal and a critical hit", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B, effect declared as a package only for the missing 'raise my lowest stats' effect (R-B10-06). The critical-hit test and the once-per-turn memory are now the gate (conditions), not hidden in the class; the gate is bound legacy for Home Run until the library has the atoms (R-B10-04, R-B10-05). Only user: Home Run (n = 3, stages = 1). The stages setting is 1 to 6 (the class would also accept a negative number, which no ability uses and the setting no longer offers). Suspected game bugs, NOT fixed: (1) the once-per-turn memory is a Symbol property written on the Pokemon object with the battle's turn NUMBER, which is never cleared, so a Pokemon that landed a crit on turn 3 of one battle is blocked on turn 3 of the next battle (a party member survives between waves); (2) the crit is read from the TARGET's `attacksReceived[0]`, the first hit the target took this turn, which in doubles or after an ally hit first may be somebody else's hit; (3) a dead block that read `attacksReceived[0]` of the holder and did nothing was dropped while moving the clauses into the gate (it had no effect). The L1 grid and the L2 twin cannot see the turn memory, so the B10 test (test/tests/elite-redux/decomp/B10/on-crit-stat-boost-lowest.test.ts) drives canApply and apply on the original and the rebuild.",
});
