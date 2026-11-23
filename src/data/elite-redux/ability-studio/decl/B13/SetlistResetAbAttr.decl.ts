/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Setlist, part 1 of 3 (Tier C, package). "When I enter, forget the two moves my set list recorded."
//
// Source: abilities/newcomer-signature-mechanics.ts, SetlistResetAbAttr (PostSummonAbAttr).
//   canApply  the base class's (always true): no condition at all.
//   apply     SETLIST.set(holder, { moves: [], expected: undefined, crescendo: 0, lastRecord: undefined })
//             (one assignment of the whole private record; ignores `simulated`)
// No RNG, no constructor arguments, no condition. The record is filled by finishSetlistMove (called by name from
// phases/move-effect-phase.ts after each of my moves) and read by SetlistPowerAbAttr and SetlistAccuracyAbAttr.
import { SetlistResetAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SetlistResetAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Forget my recorded move pattern when I enter",
  summary: () =>
    "When I enter the battle, the two moves I had recorded and my combo count are wiped, so I start recording a new pattern.",
  synonyms: [
    "reset combo",
    "forget move order",
    "clear sequence",
    "fresh start on switch in",
    "setlist",
    "forget pattern",
  ],
  examples: ["Every time I come in, my move pattern starts again from nothing"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments and no number: it empties one private per-Pokemon record (the two recorded moves, the move expected next, the combo count and the last counted move). There is nothing to tune.",
  conditions: [],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [{ name: "entry as the first Pokemon of the battle", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified: the effect is the reset of a private per-Pokemon record (a four-field state machine) that only the Setlist classes and finishSetlistMove use; the library has no memory block to express a reset of it (requested as `effect.reset-memory`, R-B13-23, the same block Anneal's and Porous' resets need). It is a single assignment, so there is nothing further to split. The trigger is a normal switch-in WHEN and the class has no condition. Users: Setlist (5989, attr 0). ODDITIES (not fixed): (1) apply ignores `simulated`; no engine path simulates PostSummon today. (2) SetlistTrackAbAttr, a fourth Setlist class in the same file, is never attached to any ability (the builder wires only reset, power and accuracy); the recording is done by finishSetlistMove from move-effect-phase.ts, so that class is dead code and is not in the inventory.",
});
