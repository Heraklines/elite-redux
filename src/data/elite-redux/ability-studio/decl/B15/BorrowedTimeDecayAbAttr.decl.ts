/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 1. Package (decay half). "At the end of each turn, a Speed swap I started returns one more step; after the last step both Speeds are exactly back."
//
// Source: src/data/elite-redux/abilities/borrowed-time.ts, class BorrowedTimeDecayAbAttr (extends PostTurnAbAttr; showAbility true).
// Clauses, in order:
//   canApply  `BORROWED_TIME_STATE.has(pokemon)`                                      -> feasibility (a swap from the entry half is still running on me)
//   apply     1. `if (simulated) return`                                              -> effect-side (respects simulated)
//             2. state = BORROWED_TIME_STATE.get(pokemon); none -> return (same test again)
//             3. state.elapsed += 1
//             4. elapsed >= state.turns: holder.setStat(SPD, max(1, holderBase)), partner.setStat(SPD, max(1, partnerBase)), delete the state, stop
//             5. otherwise applyDecay (holder = round(holderBase - diff * remaining / turns), partner = round(partnerBase + diff * remaining / turns)), remaining = turns - elapsed
// No random draw. State: the WeakMap written by BorrowedTimeSummonAbAttr; this half reads and advances it, and deletes it when the swap is over. The length of the
// fade (state.turns) is set by the entry half, so this class has no number of its own.
//
// Why a package (honest limit): it is a step of the same stored-number state machine as the entry half (restore exact originals, count steps, clear). There is no
// block for "remember numbers and move a raw stat back towards them", so splitting would re-implement the class. The trigger (end of every turn) is the separate WHEN.
import { BorrowedTimeDecayAbAttr } from "#data/elite-redux/abilities/borrowed-time";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BorrowedTimeDecayAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.end-of-turn",
  label: "Fade a Speed swap back a step at the end of each turn",
  summary: () =>
    "At the end of every turn, a Speed swap I started when I entered returns one more step, until both Pokemon have their own base Speed back. It does nothing if no swap is running.",
  synonyms: ["speed swap fades", "return borrowed speed", "decay speed swap", "borrowed time ending", "restore speed"],
  examples: ["Each turn end, give back a third of the Speed that was swapped when I entered"],
  params: [],
  noParamsReason:
    "The length of the fade is stored with the swap by the entry half (its Turns setting), so this half has no number of its own to tune.",
  conditions: [],
  guards: [],
  feasibility: [
    "A Speed swap started by the entry half must still be running on me",
    "After the last step both Pokemon get exactly their own base Speed back, even if the other one has left the field",
    "Nothing changes in a preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "let three turns pass after entering", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified (see the header). 1 attr in 1 ability: Borrowed Time (5910 attr 1). Only meaningful together with BorrowedTimeSummonAbAttr (attr 0), which writes the state. No params and no constructor change: the fade length is read from the stored state (new `turns` field written by the entry half). Whether this half should be separately reusable is a design question for the owner; as built, a rule with only this block never finds a state and does nothing (the class is safe on its own).",
});
