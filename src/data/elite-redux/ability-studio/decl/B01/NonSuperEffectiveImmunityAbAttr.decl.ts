/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 2, Tier B calc-modifier (the Wonder Guard rule is the gate; its library atoms are still missing).
//
// "While the game checks whether a move can hit me, IF the move deals damage and its type matchup is below super
// effective, it has no effect." The class passes `null` as the immune type to TypeImmunityAbAttr and OVERRIDES
// `canApply` completely (it never calls the base), with two clauses in this order:
//   1. `move.is("AttackMove")`            = condition ("the move deals damage"; status moves get through)
//   2. `typeMultiplier.value < 2`         = condition ("its type matchup is not super effective", read from the matchup
//                                           the game has computed so far, NOT recomputed)
// Both are design rules (a staff member could want "also block neutral hits only" or "block below 4x"), so BOTH are the
// replaceable gate; there is no residual. canApply is now `gatedCanApply` with only a gate. `apply` sets
// `cancelled.value = true` (hides the "no effect" message) and `typeMultiplier.value = 0`, and the class shows its own
// trigger message ("nonSuperEffectiveImmunity").
//
// WHY THE GATE IS STILL A LEGACY CLOSURE: neither clause maps onto a library atom that calls the same predicate.
//   - clause 2 reads the in-flight `typeMultiplier` holder. The atom move.effectiveness recomputes
//     `defender.getMoveEffectiveness(...)`, which would call this very ability again (endless recursion), and the
//     frame of calc.move-immunity has no `typeMultiplier` slot (request R-B01-14: slot and atom).
//   - clause 1 is `instanceof AttackMove`; the atom move.damaging tests `category !== STATUS`. Equal for every move in
//     the game today, but not the same predicate (R-B01-14: atom move.is-attack-move).
// The second constructor argument slot (`condition`, an optional closure) is also declared; Wonder Guard passes none.
import { NonSuperEffectiveImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(NonSuperEffectiveImmunityAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Block every hit that is not super effective",
  summary: () =>
    "Damaging moves that are not super effective do nothing to this Pokemon. Example: a neutral or resisted move is blocked, a super effective move and a status move still work.",
  synonyms: [
    "wonder guard",
    "only super effective hits",
    "immune unless super effective",
    "block neutral hits",
    "block resisted hits",
    "only weakness hits",
  ],
  examples: ["Only super effective moves can hurt me, like Wonder Guard"],
  params: [],
  noParamsReason:
    "The class has no setting of its own: the rule 'damaging move that is not super effective' is the gate, a condition staff swap, and its threshold of 2 is inside that gate.",
  conditions: [
    // The gate: both clauses of the old canApply. Wonder Guard's binding is a legacy-closure (see the header).
    { slot: "gate", ctx: "params", removable: true, editable: true },
    // Optional AbAttrCondition `(pokemon) => boolean`; the field is null for the only user.
    { slot: "ctor:0", ctx: "holder", path: "condition", removable: true, editable: true, optional: true },
  ],
  guards: [],
  feasibility: ["Only works where the game asks for type immunities (not when the attacker ignores abilities)"],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a neutral move, a super effective move and a status move against a Normal type",
      axes: { foeMove: ["TACKLE", "KARATE_CHOP", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (1 attr): Wonder Guard (id 25, attr 0). Its gate is a legacy-closure pending R-B01-14 (typeMultiplier slot, matchup atom, attack-move atom); the Tier B split itself (gate = old canApply, no residual) is a pure move of code and is proven by test/tests/elite-redux/decomp/B01/immunity-gates.test.ts against the old formula. Because the gate is not bound the attr cannot be rebuilt, so the shared L2 twin skips it (an ability whose only declared attr is legacy has nothing to twin). The base class TypeImmunityAbAttr.getTriggeredMoveTypes machinery is not used here (immuneType is null). Suspected oddity (not fixed): a move that is already at 0x (a true type immunity) also passes `typeMultiplier.value < 2`, so Wonder Guard ends up cancelling and printing its own message instead of the plain 'no effect' text for moves the holder was immune to anyway.",
});
