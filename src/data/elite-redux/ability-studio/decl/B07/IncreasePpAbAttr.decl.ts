/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 / while-active flag (Pressure). PARKED: status legacy-closure-pending-request.
//
// This file is written and complete, but it is deliberately NOT named `*.decl.ts`, so the registry glob does not pick
// it up yet. Reason: the class is a presence flag, but it is not in the `flagKeys` of the shared WHEN `while.active`
// (vocabulary/when-registry.ts), and `vocabulary/dispatch-keys.ts` lists it in UNEXPOSED_DISPATCH_KEYS ("needs its own
// WHEN once a class agent declares it"). The L0 rule "the WHEN's dispatch key is the class or an ancestor" therefore
// cannot be met, and a batch may not edit the library (spec 6, step 3). The request is requests/B07.md, R-B07-4.
//
// To finish: once the librarian has added `IncreasePpAbAttr` to the `flagKeys` of `while.active` and removed it from
// UNEXPOSED_DISPATCH_KEYS, rename this file to IncreasePpAbAttr.decl.ts and run L0 / L1 / L2 for the class.
//
// What the class is (read from the source): `IncreasePpAbAttr` has an empty body and no constructor argument
// (`private declare readonly _: never`), so `showAbility` is the AbAttr default true. The only reader is
// `MovePhase.getPpIncreaseFromPressure(targets)` (move-phase.ts): the number of the user's opponents that are among the
// move's targets AND `hasAbilityWithAttr("IncreasePpAbAttr")`. That number is the extra PP the move costs, one per such foe
// (a TODO in the engine says the amount is hard-coded at 1 per opponent instead of being read from the ability).
// No closure, no random draw, nothing to bind.
import { IncreasePpAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IncreasePpAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Foes' moves aimed at me cost 1 extra PP",
  summary: () =>
    "While I have this, each foe that aims a move at me spends 1 extra PP on it. Example: a move with 10 PP uses 2 PP when it targets me.",
  synonyms: ["pressure", "drain pp", "extra pp", "pp cost", "waste pp", "pp pressure"],
  examples: ["Foes use 2 PP for every move aimed at me, like Pressure"],
  params: [],
  noParamsReason:
    "A pure presence flag: the engine only checks that the attr exists (hasAbilityWithAttr) and then adds a fixed 1 PP per such foe, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: ["The extra PP only counts for foes that are among the targets of the move"],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a move aimed at the holder and a move aimed at someone else", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment, so the shared twin only compares whole battles. The engine site (MovePhase.getPpIncreaseFromPressure) is driven directly in test/tests/elite-redux/decomp/B07/flag-sites.test.ts for the original and a control (the rebuilt attr joins once the declaration is live).",
  status: "decomposed",
  notes:
    "While-active flag, Tier C, parked until the WHEN `while.active` lists the class (R-B07-4). Read only by MovePhase.getPpIncreaseFromPressure (move-phase.ts). User: Pressure (46, attr 0). Nothing to bind (no closure).",
});
