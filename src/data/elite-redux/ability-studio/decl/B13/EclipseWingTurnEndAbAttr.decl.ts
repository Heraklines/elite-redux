/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Eclipse Wing, part 2 of 3 (Tier B, package effect). "At turn end, if my counter-strike knocked out its target, I faint."
//
// Source: abilities/newcomer-signature-mechanics.ts, EclipseWingTurnEndAbAttr (PostTurnAbAttr; no constructor).
//   canApply, in the ORIGINAL order was: 1. ECLIPSE_COUNTER_TARGET[holder]?.isFainted() === true   2. !holder.isFainted()
//   canApply now: guards (2: the shared safety rule not-fainted) && gate (1). Both clauses are pure (no RNG, no side
//   effect), so swapping them changes no result; L1 compares the old and new rule over the grid.
//   apply: ECLIPSE_COUNTER_TARGET.delete(holder)  (even when simulated)
//          not simulated: holder.damageAndUpdate(holder.hp, { result: HitResult.INDIRECT })   (all my remaining HP)
// The counter target is stored by tryEclipseWing (called by name from Pokemon.damageAndUpdate, field/pokemon.ts:6660),
// the once-per-battle survive-at-1-HP-and-counter part of the ability (not this class).
import { EclipseWingTurnEndAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(EclipseWingTurnEndAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.end-of-turn",
  label: "Faint if my counter-strike knocked out its target",
  summary: () =>
    "At the end of the turn, if the foe my counter-strike aimed at has fainted, I lose all my remaining HP and faint too.",
  synonyms: [
    "sacrifice after counter",
    "faint at turn end",
    "trade knock out",
    "self knock out",
    "eclipse wing",
    "last stand",
  ],
  examples: ["If my counter-attack knocks the foe out, I faint at the end of the turn"],
  params: [],
  noParamsReason:
    "The effect takes ALL my remaining HP, which is not a number you can set, and the choice of foe is remembered by the counter-strike part; there is nothing to tune.",
  conditions: [
    // Clause 1: the foe my counter-strike aimed at has fainted (a legacy-closure binding, see bindings.ts and R-B13-35).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "Only a Pokemon that struck back this battle has a foe to look at (the counter-strike is a separate part, Eclipse Wing's survive at 1 HP)",
    "The memory of the foe is cleared every time this triggers, even if I do not faint",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "The counter-strike that fills the memory needs a lethal hit from full HP; B13/eclipse-wing.test.ts stores a counter target and drives the turn end.",
  probes: [{ name: "turn end with no counter-strike recorded", axes: { hp: ["max", "max-1"] } }],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only. The trigger (end of every turn) and the conditions are separate: the safety rule is the shared guard not-fainted, the 'my counter target fainted' clause is the editable gate. Why the effect cannot be split with today's blocks: it makes me lose ALL my remaining HP (damageAndUpdate(holder.hp, indirect)) and clears a private per-Pokemon memory; the library has no 'faint myself' effect and no memory-clearing block (requested as R-B13-35 `effect.faint-self` and the shared `effect.reset-memory`, R-B13-23), and `effect.recoil` is a share of damage dealt, not all remaining HP. The gate is a legacy-closure binding until R-B13-35 adds the atom 'the foe I struck back at has fainted' (it reads the WeakMap that tryEclipseWing fills). Users: Eclipse Wing (5971, attr 1; attr 0 is the power boost, attr 2 the marker). ODDITIES (not fixed): (1) apply clears the memory BEFORE its simulated check, so a simulated call spends it; no engine path simulates PostTurn today; (2) the guard now runs before the gate (order swapped, both pure); (3) because the memory is only cleared when this triggers, a counter target that is still alive keeps the memory for later turns, so the faint can happen turns later if that foe is knocked out by someone else.",
});
