/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 4. Tier A, calc modifier. "While the game calculates the damage I take, IF the attacker moved before me this turn, multiply it by 0.75."
//
// Source: src/data/elite-redux/abilities/relativity.ts, class RelativityDefenseReductionAbAttr (extends ReceivedMoveDamageMultiplierAbAttr). The subclass passes the base class its closure
// `(holder, attacker, _move) => pokemonActedBefore(attacker, holder)` and the multiplier 0.75; showAbility stays false and affectsFixedDamage false (base defaults). canApply and apply are the BASE ones:
//   canApply = this.condition(holder, attacker, move)        -> the closure is the condition (constructor argument 0)
//   apply    = damage.value = toDmgValue(damage.value * damageMultiplier)
// pokemonActedBefore(first, second) reads the per-turn move order (dynamicQueueManager.getLastTurnOrder(), Trick Room aware): `first` must be in the list; a `second` that is not in it has not acted
// yet (so `first` is before); both present -> compare their indices. No random draw, no state of its own.
// Constructor change (behaviour-neutral): the condition and the multiplier are constructor arguments whose defaults are the old closure and 0.75, so a rebuilt rule can pass its own.
// The offence half in the same ability, RelativityAbAttr, is a separate class with its own declaration.
import { RelativityDefenseReductionAbAttr } from "#data/elite-redux/abilities/relativity";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(RelativityDefenseReductionAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take less damage from a foe that moved before me",
  summary: params =>
    `Damage I take from an attacker that moved before me this turn is multiplied by ${params.multiplier}. Example: 0.75 = 25% less. Follows the real turn order, so Trick Room works.`,
  synonyms: [
    "relativity",
    "slower means tougher",
    "resist the foe that went first",
    "reduce damage from the faster attacker",
    "take less damage when I move second",
    "order based damage reduction",
  ],
  examples: ["If the foe moves before me I take 25% less damage from it, like Relativity"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "damageMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Damage multiplier (0.75 = 25% less)",
      editable: true,
      default: 0.75,
    },
  ],
  conditions: [
    // The closure differs from every library atom (it reads the turn order list); see the legacy binding in bindings.ts and R-B15-36.
    { slot: "ctor:0", ctx: "defend", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-damage-taken", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // A special and a physical hit; the order test itself is driven in the chunk test because the grid cannot reorder the turn.
      name: "a special and a physical hit on the holder",
      axes: { foeMove: ["WATER_GUN", "BITE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, the same shape as the damage-taken precedent, with a legacy closure. 1 attr in 1 ability: Relativity (5911 attr 1, x0.75). The effect is the library effect.multiply-damage-taken (not a package). The only closure, 'the attacker acted before me this turn', is bound as a legacy closure: it reads the real move order list (getLastTurnOrder), the library atom time.acted reads the acted flag of one Pokemon (PokemonTurnData.acted), not the order list, so it is not the same predicate; requested as R-B15-36 (condition 'The attacker moved before me this turn', time.acted-before by the order list, which the offence half Relativity also needs). The multiplier is a typed setting. Suspected oddities, NOT fixed: (1) if the attacker is not in the order list (a move made outside the normal queue) pokemonActedBefore answers false, so no reduction; (2) the condition compares the order per incoming hit, so a spread move or a second hit from the same attacker is judged each time; (3) it follows the real order of the turn, not raw Speed, so priority and Trick Room count (as the ability text says).",
});
