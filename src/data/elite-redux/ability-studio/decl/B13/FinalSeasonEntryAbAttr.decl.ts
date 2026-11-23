/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Final Season, part 1 of 3 (Tier B, event-effect). "When I switch in on purpose, every foe moves last for 2 turns."
//
// Source: abilities/newcomer-signature-mechanics.ts, FinalSeasonEntryAbAttr (PostSummonAbAttr).
//   canApply  one clause: the holder is in the VOLUNTARY_ENTRY set. markGenuineVoluntaryEntry() adds it from
//             SwitchSummonPhase when the switch type is SWITCH and the turn command was a party command.
//             -> the gate. No library atom for "came in by a deliberate switch" exists: legacy-closure + request
//             `entry.voluntary-switch-in` (requests/B13.md).
//   apply     1. VOLUNTARY_ENTRY.delete(holder)            (even when simulated)
//             2. simulated: stop
//             3. every opponent gets the ER_QUASHED tag for 2 turns (source move NONE, source id = holder)
//             4. a message
//             5. the holder is armed for the end-of-turn fog (FINAL_SEASON_PENDING_FOG), read by FinalSeasonFogAbAttr
//   No RNG. The effect is "apply a battle effect to every foe", an existing effect block (effect.apply-tag).
import { FinalSeasonEntryAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FinalSeasonEntryAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Make foes move last when I switch in on purpose",
  summary: () =>
    "When I switch in on purpose, every foe moves last in its priority bracket for 2 turns, and the end-of-turn fog is readied.",
  synonyms: ["quash", "move last", "slow the foes", "delay the opponent", "switch in debuff", "final season"],
  examples: ["Foes move last for 2 turns when I am switched in by choice"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the 2 turns, the foes-only target and the 'moves last' battle effect are fixed in its code. Staff reach the same behaviour with a composed rule (a switch-in trigger, a deliberate-switch condition and the apply-battle-effect block).",
  conditions: [
    // The one clause of canApply. Legacy closure until the librarian adds the atom (see bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // A battle's first Pokemon is not a deliberate switch, so the gate is false; the deliberate case is in B13/final-season.test.ts.
      name: "entry as the first Pokemon of the battle",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Users: Final Season (5972, attr 0). Gate = VOLUNTARY_ENTRY.has(holder), legacy-closure pending request `entry.voluntary-switch-in`. The effect is one existing block (apply a battle effect to the foes) plus two bookkeeping side effects that ride along in the same apply: the message, and arming FINAL_SEASON_PENDING_FOG, which FinalSeasonFogAbAttr reads at turn end. ODDITY (not fixed): apply deletes the voluntary-entry flag BEFORE its simulated check, so a simulated PostSummon call would spend the flag without doing anything. No engine path simulates PostSummon today. The ER_QUASHED duration (2) is a literal in apply, so there is no constructor argument to expose as a param.",
});
