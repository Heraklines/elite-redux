/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14. Tier B calc-modifier, the fifth attr of Perpetual Motion. "While the game calculates a move's power, if my free
// follow-up is armed and the move is that follow-up, multiply the power by 1 + 0.1 x streak."
//
// canApply, original clause order, now `guards && gate`:
//   guards  1. `!!summonData.erPerpetualMotionPending`   the follow-up is armed (state of the ability's own state machine)
//   gate    2. the move is the ability's own scripted follow-up (ScriptedMoveMarkerAttr key "perpetual-motion")
// apply: `power.value *= 1 + summonData.erPerpetualMotionStreak * 0.1`.
// Nothing is random. The class does not call super.canApply, so the base class's skipDuringMovesetGen flag (false here)
// is never consulted; recorded in notes.
//
// The gate binding is LEGACY (needs the atom `move.scripted-marker`, requested). The effect is a package: its
// multiplier is a per-instance counter times a step, and the library's `effect.multiply-power` takes a fixed number.
import { PerpetualMotionPowerAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PerpetualMotionPowerAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.move-power",
  label: "Raise power for each free follow-up hit in a row",
  summary: () =>
    "While my free follow-up move is queued, its power is multiplied by 1 plus 0.1 for each hit in a row. Example: after 3 hits in a row, power x1.3.",
  synonyms: ["combo power", "power per hit", "streak bonus", "escalating power", "rollout", "perpetual motion"],
  examples: ["Each free Rollout that lands in a row hits 10% harder"],
  params: [],
  noParamsReason:
    "The 10% step and the marker name of the follow-up move are fixed inside the class (no constructor argument), and the streak is a battle value, not a setting.",
  conditions: [
    // Gate = [move.scripted-marker{key: "perpetual-motion"}]. Not removable: without it every move would be boosted
    // while the follow-up is armed.
    { slot: "gate", ctx: "params", removable: false, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only while my free follow-up is waiting to resolve (the streak is armed)",
    "The bonus is 10% of the power for each hit in a row that landed so far",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "ignores" },
  probes: [{ name: "the holder attacks", axes: {} }],
  l2StaticReason:
    "The gate binding is a legacy closure (no atom for the scripted-move marker yet), so the twin has no rebuilt attr to compare; the Tier B split is proven by test/tests/elite-redux/decomp/B14/gate-split.test.ts instead.",
  status: "decomposed",
  notes:
    "Package, reason: the multiplier is `1 + streak x 0.1` where the streak is a per-Pokemon counter written by PerpetualMotionProgressAbAttr; effect.multiply-power only takes a fixed number (a counter-based power effect is requested). Users (1): Perpetual Motion (6022) attr 4 of 5. Gate is legacy-closure pending move.scripted-marker. The armed-state check stays a non-editable guard clause in the class (it is state of the ability's own machine, listed under feasibility, not a registered guard). Oddities, not fixed: canApply does not call super.canApply, so skipDuringMovesetGen is ignored (it is false for this class, so no effect); the class applies on simulated power previews too, which is correct for damage previews.",
});
