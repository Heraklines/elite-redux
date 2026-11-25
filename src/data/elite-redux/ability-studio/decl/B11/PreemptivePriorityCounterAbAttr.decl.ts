/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 2 / event-effect (Tier C: one effect that carries its own per-foe tests; the trigger and the holder-side IF stay swappable).
//
// Read by hand from archetypes/preemptive-priority-counter.ts and phases/turn-start-phase.ts. The class extends only AbAttr (no
// dispatch key of its own): TurnStartPhase.queuePreemptiveCounters scans every Pokemon on the field BY CLASS NAME at the start of the
// turn (after the commands are chosen, before anyone moves) and, when the attr has no condition or its attr-level condition is true for
// the holder, calls `queueCounters(holder)`. Constructor: none (`super(false)`). No canApply, no apply.
//   queueCounters, for each of the holder's opponents in `getOpponents()` order:
//     skip unless the foe's turn command is FIGHT, is not skipped and names a move               (the foe chose to attack)
//     skip unless `allMoves[move].getPriority(foe) > 0`                                           (the move's priority for that foe)
//     then `unshiftNew("MovePhase", holder, [foe's battler index], scriptedPokemonMove(ASTONISH, 40, { bypassFirstMoveCondition: true }),
//       MoveUseMode.INDIRECT, MovePhaseTimingModifier.FIRST)`                                     (a free 40 power Astonish, first)
//   No random draw in the class (Astonish's flinch chance is rolled later by the move itself), no `simulated`, no message.
//
// The holder-side rule of the shipped user (Surprise!: the weather is fog and not suppressed) is NOT inside the class: it is an
// attr-level condition (`addCondition`), which the engine reads before it calls the class. That is the IF block of this rule, and
// recomposeAttr carries it over. The four per-foe tests are what makes the effect, and the move, its power and the "priority above 0"
// line are fixed in the class (no constructor argument), so they cannot be settings without a class change (request R-B11-C2-07).
// The trigger "at the start of each turn, before anyone moves" is the library WHEN event.turn-start (added with this
// declaration; the class is found by a by-name scan in TurnStartPhase).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PreemptivePriorityCounterAbAttr } from "#data/elite-redux/archetypes/preemptive-priority-counter";

export default defineDecl(PreemptivePriorityCounterAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.turn-start",
  label: "Flinch foes that chose a priority move before they act",
  summary: () =>
    "At the start of the turn, every foe that picked a move with priority above 0 is hit first by a free 40 power Astonish, which can make it flinch. Example: Surprise! in fog.",
  synonyms: [
    "surprise",
    "astonish first",
    "counter priority moves",
    "stop quick attack",
    "flinch priority users",
    "pre-empt the foe",
  ],
  examples: ["In fog, Astonish any foe that is about to use a priority move like Quick Attack"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the counter move (Astonish), its power (40) and the 'priority above 0' line are fixed in the effect. Staff cannot change them until the class takes them as arguments (request R-B11-C2-07).",
  conditions: [],
  guards: [],
  feasibility: [
    "Only a foe that chose to attack counts (not one that switches, uses an item or has its turn skipped)",
    "The foe's move priority is read for that foe, so abilities that change priority count",
    "Each such foe is hit once, for free (no PP used), before any move of the turn",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "a foe that uses a priority move and one that does not",
      axes: { foeMove: ["QUICK_ATTACK", "TACKLE"] },
    },
  ],
  l2StaticReason:
    "The class is found by a by-name scan in TurnStartPhase, never dispatched with applyAbAttrs, and its trigger is the by-name WHEN event.turn-start, so no applyAbAttrs trace event shows it evaluated. test/tests/elite-redux/decomp/B11/chunk2.test.ts drives queueCounters on the original and on the rebuild against foes that chose a priority move, a normal move and a switch.",
  status: "decomposed",
  notes:
    "Tier C package, justified in the header. Only user: Surprise! (5327, its only attr), with the attr-level condition `fog or eerie fog, not suppressed` (a closure from archetype-dispatcher getWeatherCondition; carried over by recomposeAttr, not a constructor argument, so nothing is bound). Remark, NOT fixed: with two opposing foes in doubles, one MovePhase is unshifted for EACH qualifying foe, in `getOpponents()` order. The class itself does not check whether the holder can act (it only queues the move; the MovePhase decides).",
});
