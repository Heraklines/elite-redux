/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 6. Tier B, the effect works as one piece. "After I am hit by a damaging move, I gain a charge stack (up to the maximum)"
// (Capacitor Bank).
//
// Source: electivire.ts CapacitorBankGainAbAttr (extends PostDefendAbAttr, dispatched after I am hit). canApply, original clause
// order, is now `gate && residual` (no guard):
//   gate      1. `move.category === STATUS` -> false      the move deals damage                       (library: move.damaging)
//   residual  2. `damage <= 0` -> false                    the hit really dealt damage
//             3. `hitResult === NO_EFFECT || IMMUNE` -> false    the hit was not blocked
//             4. `getCharge(pokemon) >= CHARGE_STACK_MAX` -> false   I am below the maximum number of stacks (4)
//             5. `LAST_DEFEND_TOKEN.get(pokemon) !== defendToken(opponent, move)`   this incoming move was not counted yet
//                (the token is `wave:turn:attackerId:moveId`, so the hits of a multi-hit move grant ONE stack)
// Clauses 2 to 5 stay in the class (the first two are safety rules, the last two are the effect's own feasibility: a full counter
// cannot take more, and the memory of the last counted move), after the gate and in their original order. Clause 4 is also a rule
// staff may want to change ("while below N stacks"), which needs the atom `mon.charge-stacks` (request R-B14-6.2); until then it is
// feasibility text.
// Nothing is random.
//
// apply: `if (simulated) return`; remember the token of this incoming move; `addCharge(pokemon)` (+1, clamped to 4 by the store).
// The stack counter is a WeakMap in `charge-stack.ts`, shared with the other four charge-stack attrs and read by three engine hooks
// (`pokemon.ts` x2, `move-effect-phase.ts`); no library effect writes it (request R-B14-6.1), so the effect is a package.
// Class edit (pure move of code): the Tier B split and a constructor argument `stacks` (default 1) for the `+1`.
import { CapacitorBankGainAbAttr } from "#data/elite-redux/abilities/electivire";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CapacitorBankGainAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-hit",
  label: "Gain charge stacks when a damaging move hits me",
  summary: params =>
    `Each time a damaging move hurts me, I gain ${params.stacks} charge stack (at most 4 in total, once per incoming move). Example: 1 = one stack per move that hits me.`,
  synonyms: [
    "capacitor bank",
    "charge up when hit",
    "build charge",
    "stack a charge",
    "store electricity",
    "gain a stack",
    "charge counter",
  ],
  examples: [
    "Every time I get hit by a damaging move my charge goes up by one, to a maximum of four, like Capacitor Bank",
  ],
  params: [
    {
      id: "stacks",
      ctorIndex: 0,
      path: "stacks",
      control: "number",
      min: 1,
      max: 4,
      step: 1,
      integer: true,
      label: "Charge stacks gained per hit (1-4)",
      editable: true,
      default: 1,
      // Only the effect reads it; the gate never repeats it.
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [the move deals damage]. Removable: "gain a stack from any hit that deals damage" is the residual's own rule.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only when the hit really dealt damage and was not blocked",
    "Only while I hold fewer than the maximum number of stacks (4)",
    "A multi-hit move gives one stack, not one per hit",
    "Does nothing while the game is only previewing",
  ],
  effect: { id: "effect.package", params: ["stacks"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "a damaging foe move hits me", axes: { foeMove: ["TACKLE", "WATER_GUN", "GROWL"] } }],
  status: "decomposed",
  notes:
    "Package for the effect only; the trigger and the condition are separate blocks. Reason it cannot be split: the charge counter is a bespoke store (`charge-stack.ts`: a WeakMap keyed by Pokemon, clamped at CHARGE_STACK_MAX = 4) that no library effect can write, and the class also keeps a per-move memory (a module WeakMap of `wave:turn:attacker:move` tokens) so a multi-hit move counts once. Requests R-B14-6.1 (an effect that changes the charge counter), R-B14-6.2 (an atom that reads it) and R-B14-6.3 (the 'already counted this move' memory) would let it be built from blocks. Users (1): Capacitor Bank (5925) attr 0 (attr 1 absorbs Electric moves, attr 2 is the redirect of another batch). The gate (clause 1) is fully bound to move.damaging; the residual stays in the class. Not covered by this attr and held by engine code that finds the class BY NAME (`carriesAttr(.., 'CapacitorBankGainAbAttr')`, so this class name must never change and the class doubles as the holder marker): the attack-side gain (+1 when I land a damaging hit, once per move: `erCapacitorBankOnAttack`, called from `erBatch3OnTargetHit`) and the spend (an Electric move I use consumes one stack: `erCapacitorBankConsumeOnElectricUse`, called from `MoveEffectPhase`); request R-B14-6.4. The maximum of 4 stacks is a module constant used by all charge-stack code, so it is not a setting here. Oddity, not fixed: clause 3 tests HitResult.IMMUNE and NO_EFFECT only, not the other results that are no real hit (STATUS, MISS, FAIL, ...); those carry no damage in practice, so clause 2 stops them first. The grid cannot reach clauses 2 to 5 through the shared L1, so B14/chunk6.test.ts compares canApply with a literal copy of the original over every combination.",
});
