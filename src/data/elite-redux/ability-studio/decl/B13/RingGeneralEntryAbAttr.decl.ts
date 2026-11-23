/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Ring General, part 1 of 2 (Tier C, package). "When I enter, remember which turn it was."
//
// Source: abilities/newcomer-signature-mechanics.ts, RingGeneralEntryAbAttr (PostSummonAbAttr).
//   canApply  the base class's (always true): no condition at all.
//   apply     RING_ENTRY_TURN.set(holder, "wave:turn")   (one assignment of the current turn; ignores `simulated`)
// No RNG, no constructor arguments, no condition. RingGeneralTrapAbAttr reads the note ("I did not come in this turn").
import { RingGeneralEntryAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(RingGeneralEntryAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Remember the turn I came in",
  summary: () =>
    "When I enter the battle, I note the current turn. Another part of the ability uses that note to stay quiet until the next turn.",
  synonyms: [
    "note arrival turn",
    "mark entry turn",
    "just arrived",
    "entry timestamp",
    "ring general",
    "fresh arrival",
  ],
  examples: ["Remember that I only just came in, so my trap waits one turn"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments and no number: it stores the current turn for the Pokemon that came in (a private per-Pokemon record that the trapping part reads). There is nothing to tune.",
  conditions: [],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [{ name: "entry as the first Pokemon of the battle", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified: the effect writes one private per-Pokemon note (the turn I came in) that only RingGeneralTrapAbAttr (and the debug snapshot in newcomer-signature-mechanics.ts) read. The library's `effect.arm-effect` arms a key with its own memory and has no 'this turn only' scope, and no condition reads it, so it cannot replace this note; requested as R-B13-30 (arm-effect with a this-turn scope plus `time.armed-this-turn` / `time.entered-this-turn`, shared with R-B13-2 and R-B13-22). It is a single assignment, so there is nothing further to split. The trigger is a normal switch-in WHEN and the class has no condition. Users: Ring General (5987, attr 0). ODDITY (not fixed): apply ignores `simulated`; no engine path simulates PostSummon today.",
});
