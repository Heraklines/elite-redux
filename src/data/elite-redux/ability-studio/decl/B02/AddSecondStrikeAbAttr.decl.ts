/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 2. "My single-target attacks hit one extra time" (Parental Bond).
//
// Source: src/data/abilities/ab-attrs.ts AddSecondStrikeAbAttr. Dispatched from MoveEffectPhase (move-effect-phase.ts,
// when the first hit resolves the move's total hit count): `applyAbAttrs("AddSecondStrikeAbAttr", { pokemon: user, move,
// hitCount, opponent })`, or `applyFilteredAbAttrs(..., bypassesOpponentMultiHitSuppression)` when the target suppresses
// multi-hit abilities (the engine decides, not the class).
// canApply: `move.canBeMultiStrikeEnhanced(pokemon, true, opponent)`, the only clause (feasibility: the move must be an
// ordinary single-target damaging move: not a charging move, not a spread move with several targets, not a status move,
// not Fling, Uproar, Rollout, Ice Ball or Endeavor, and not a multi-hit or sacrificial move). apply: `hitCount.value += 1`.
// No constructor argument (showAbility keeps the default true), no random draw, no state.
import { AddSecondStrikeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(AddSecondStrikeAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.hit-count",
  label: "Add an extra strike to my attacking moves",
  summary: () =>
    "My single-target damaging moves hit one extra time. Moves that already hit several times, charging moves, spread moves and status moves are left alone.",
  synonyms: ["parental bond", "hit twice", "double hit", "extra strike", "second hit", "multi hit"],
  examples: ["Every attacking move hits twice, like Parental Bond"],
  params: [],
  noParamsReason:
    "The class always adds exactly one strike (`hitCount.value += 1`) and takes no constructor argument; changing that would be a class edit, which the decomposition does not allow. Request B02-12 asks for an 'add extra strikes' effect with a number setting.",
  conditions: [],
  guards: [],
  feasibility: [
    "The move must be able to take an extra strike: a damaging move that is not a charging move, not a spread move with several targets, not already a multi-hit or self-sacrificing move, and not Fling, Uproar, Rollout, Ice Ball or Endeavor",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder attacks with a single-hit and a multi-hit move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C. One user: Parental Bond (185). The 25% damage of the extra strike is NOT part of this class: it is the next attr of the same ability (MoveDamageBoostAbAttr 0.25 with a closure on turnData.hitsLeft), another class. The effect is 'add one to the hit count', which the library's hit-n-times (sets the total) does not express when two sources stack, so it stays effect.package (request B02-12). The single clause is the feasibility rule `canBeMultiStrikeEnhanced`; B02-14b asks for a registered guard so the editor can show it as a locked safety rule. Subclasses ErMultiHeadedAbAttr, HitMultiplierAbAttr and PartyCountMultiHitAbAttr override apply (and the last two canApply); they are other classes. The engine dispatches this key through the base class, so those subclasses also run for this WHEN. The harness has no engine-parameter builder for this trigger (request B02-16), so the shared L1 attr differential skips the class; canApply is a pure call of the move helper and B02/chance-and-effects.test.ts proves it against the rebuild.",
});
