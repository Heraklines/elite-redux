/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 2 / while-active flag (Tier C). See ../PRECEDENTS.md. PARKED: status legacy-closure-pending-request.
//
// This file is written and complete, but it is deliberately NOT named `*.decl.ts`, so the registry glob does not pick it up yet.
// Reason: the class is a presence flag, but it is not in the `flagKeys` of the shared WHEN `while.active`
// (vocabulary/when-registry.ts), and the L0 rule "the WHEN's dispatch key is the class or an ancestor" therefore cannot be met; a
// batch may not edit the library (spec 6, step 3). The request is requests/B07.md, R-B07-6.
//
// To finish: once the librarian has added `IgnoreProtectFirstTurnAbAttr` to the `flagKeys` of `while.active`, rename this file to
// IgnoreProtectFirstTurnAbAttr.decl.ts and run L0 / L1 / L2 for the class.
//
// What the class is (read from the source): an empty marker, `constructor() { super(false) }`, `apply` empty and never dispatched.
// The only reader is Move.doesFlagEffectApply (move.ts, IGNORE_PROTECT): it scans `user.getAllActiveAbilityAttrs()` for an attr whose
// `constructor.name === "IgnoreProtectFirstTurnAbAttr"` (by NAME, so a rebuilt attr must keep the class name), but only while the
// user's `summonData.moveHistory` is missing or empty, that is until the holder has used a move since it was sent out. After the
// contact bypass and the flag bypass, before nothing else.
import { IgnoreProtectFirstTurnAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IgnoreProtectFirstTurnAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "My moves go through protection on my first turn",
  summary: () =>
    "While I have this, every move I use on my first turn after coming in ignores protection moves such as Protect and hits anyway. Example: my Tackle breaks Protect, but not on turn two.",
  synonyms: [
    "demolitionist",
    "readied action",
    "first turn ignores protect",
    "break through protect once",
    "bypass protect on entry",
    "opening move ignores protection",
  ],
  examples: ["All my moves ignore Protect on the turn I come in, like Demolitionist"],
  params: [],
  noParamsReason:
    "A pure presence flag: the engine only checks that the attr exists and that the holder has not used a move yet, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only until the holder has used a move since it was sent out; the engine tests that itself (the first turn rule is built into the flag)",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a move before and after the holder has used a move", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment, so the shared twin only compares whole battles. The engine site (Move.doesFlagEffectApply, IGNORE_PROTECT) is driven directly in test/tests/elite-redux/decomp/B07/flag-sites-2.test.ts.",
  status: "decomposed",
  notes:
    "While-active flag, Tier C, parked (R-B07-6). Only user: Demolitionist (5320, attr 1); showAbility false by `super(false)`. The first-turn rule is inside the engine reader (empty moveHistory), not in the class, so it is not a condition staff can move; the library atom time.first-turn is a different test (turn count) and must not be bound here. The reader matches by constructor NAME, so any rebuild must keep the class name.",
});
