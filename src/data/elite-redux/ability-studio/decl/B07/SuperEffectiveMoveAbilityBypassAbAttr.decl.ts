/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 / calc modifier, Tier B (the gate sits inside canApply), a subclass of MoveAbilityBypassAbAttr. See ../PRECEDENTS.md.
//
// canApply is now `guards && gate` in the ORIGINAL clause order (no prepare step, no residual, no random draw):
//   1. guards  `super.canApply(params)` = `!cancelled.value && this.moveIgnoreFunc(pokemon, move)`: the "already decided"
//              check and the constructor closure (default `() => true`, so all three users are unconditional here).
//   2. gate    `target != null && target.getMoveEffectiveness(pokemon, move) > 1`: a foe is known and the move is super
//              effective against it. It fails closed without a foe (the ally-accuracy path passes none).   <- staff may replace it
// apply is the parent's `cancelled.value = true`. The engine asks in Move.doesFlagEffectApply(IGNORE_ABILITIES) (move.ts) and
// threads the defender through as `target`.
//
// Honest limit: the library atom `move.effectiveness` needs the slots `other` (the foe) and `moveUser`, and the WHEN
// `calc.ability-bypass` provides only the holder and the move, and has no entry in WHEN_MOVE_USER. The gate is therefore
// bound as a legacy closure with the exact formula (request R-B07-1 asks the librarian for the two slots).
import { SuperEffectiveMoveAbilityBypassAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SuperEffectiveMoveAbilityBypassAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.ability-bypass",
  label: "My super effective moves ignore the target's ability",
  summary: () =>
    "My super effective moves ignore the target's ability, so abilities that block or weaken them do not work. Needs a known target, otherwise nothing happens.",
  synonyms: [
    "deadly precision",
    "weakness breaks abilities",
    "super effective ignores ability",
    "type advantage ignores ability",
    "mold breaker on weakness",
    "flawless precision",
    "mach 3",
  ],
  examples: ["Super effective hits ignore the target's damage-cutting abilities, like Deadly Precision"],
  params: [],
  noParamsReason:
    "The only constructor argument is the per-move closure, which is the condition slot (ctor:0), not a setting. showAbility is not an argument (`super(false)`).",
  conditions: [
    // `(pokemon, move) => boolean`: no library context takes this signature yet (see MoveAbilityBypassAbAttr).
    { slot: "ctor:0", ctx: "none", path: "moveIgnoreFunc", removable: false, editable: false },
    // The gate: "the move is super effective against the target". Each user's binding names it (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Needs a known target; without one the bypass does not happen",
    "Does nothing when something earlier already decided that abilities are ignored",
  ],
  // No library effect says "ignore the target's ability"; request R-B07-1.
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a super effective, a neutral and a resisted move against a known foe, and no foe", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B. The gate/guards split is a pure move of code (guards = `super.canApply`, gate = the second clause, order unchanged); the direct test test/tests/elite-redux/decomp/B07/super-effective-bypass.test.ts compares the split with a verbatim copy of the old body. Users (live dump): Deadly Precision (5495, attr 1), Flawless Precision (5622, attr 1) and Mach 3 (5635, attr 1); all three use the constructor default closure `() => true` and showAbility false. Both slots are legacy closures for now: ctor:0 (no context for `(pokemon, move)`) and gate (the WHEN lacks `other` and `moveUser`); see requests/B07.md R-B07-1. The effect is 'package' for the missing 'ignore the target's ability' effect. ENGINE QUERY ASPECT: Move.doesFlagEffectApply and Pokemon.getAccuracyMultiplier ask `hasAbilityWithAttr(\"MoveAbilityBypassAbAttr\")` by presence; the subclass counts because it extends the class, so the pre-filter lets it through and the gate decides. The class ignores `simulated`.",
});
