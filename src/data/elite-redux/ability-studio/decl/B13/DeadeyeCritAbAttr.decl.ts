/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Deadeye Draw, part 2 of 3 (Tier B, calc-modifier). "My pulse moves always crit the foe I marked."
//
// Source: abilities/newcomer-signature-mechanics.ts, DeadeyeCritAbAttr (ConditionalCritAbAttr). The constructor used to
// be `super(deadeyeApplies)`; it is now `super(() => true)` and the rule moved into guards / gate / residual.
//   ConditionalCritAbAttr.canApply = !isCritical.value && condition(holder, target, move); apply: isCritical.value = true.
//   Original condition `deadeyeApplies(holder, target, move)`, in order, all pure, no RNG:
//     a. !!target  b. DEADEYE_MARK[holder] === target  c. move.hasFlag(PULSE_MOVE)  d. target.isOnField()
//   canApply now: guards (not already critical, a target exists) && gate (pulse move: library atom move.flag) &&
//   residual (the target is my mark, it is on the field). Clause c moved in front of a and b; every clause is pure, so
//   no result, draw or side effect changes (L1 compares the old and new rule over the grid).
// Dispatched by pokemon.ts:6438 (applyAbAttrs("ConditionalCritAbAttr", ...)) when the game decides if a hit is a crit.
import { DeadeyeCritAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(DeadeyeCritAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.crit-roll",
  label: "Always crit my marked foe with pulse moves",
  summary: () =>
    "While the game decides if a hit is a critical hit, my pulse moves always crit the foe I marked, as long as it is on the field.",
  synonyms: [
    "guaranteed crit on mark",
    "always crit",
    "sure crit",
    "crit the marked foe",
    "sniper crit",
    "deadeye draw",
  ],
  examples: ["My pulse moves always crit the foe I marked earlier"],
  params: [],
  noParamsReason:
    "Forcing a critical hit has no number or choice. The pulse-move rule is the editable gate; the mark is remembered by the Deadeye marking part.",
  conditions: [
    // Clause c: the move is a pulse move (library atom move.flag, see bindings.ts). The base closure is a fixed always-true
    // function, so there is no ctor:0 slot.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must not already be a critical hit (nothing is left to force)",
    "A target must exist",
    "The target must be the foe I marked and still be on the field (a private memory kept by the marking part, R-B13-34)",
  ],
  effect: { id: "effect.force-crit", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "A foe has to be marked first (an arrow or pulse hit), which the generic scenario of the crit-roll trigger does not do; B13/deadeye.test.ts marks a foe and drives the crit roll.",
  probes: [{ name: "a damaging hit with nothing marked", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "Fully decomposed with existing blocks except one memory: trigger 'the game decides if a hit is critical', condition 'the move is a pulse move' (library atom, editable), effect 'always land a critical hit' (library effect, no params). Two clauses stay in the class and are listed as 'also requires': the target is my mark (a private WeakMap of the marking part; needs the atom requested as R-B13-34, then it joins the gate) and the target is on the field. Users: Deadeye Draw (5984, attr 1). The base class's ignore of `isCritical` already being true is kept as the first guard clause. ODDITIES (not fixed): (1) `deadeyeApplies` is still used by shouldDeadeyeUseLowerDefense (the weaker-defence rule in pokemon.ts) and is unchanged, so the crit rule and the defence rule can drift apart if one is edited; (2) the ability text says 'cannon moves', the code tests the PULSE_MOVE flag only (not ARROW_BASED); (3) the rule is source-side: a target that prevents crits (Shell Armor) is handled by the engine after this dispatch.",
});
