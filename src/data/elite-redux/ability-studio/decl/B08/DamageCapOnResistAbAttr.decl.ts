/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 4 / calc-modifier, Tier B. Read from the source (archetypes/damage-cap-on-resist.ts, its parent
// ReceivedMoveDamageMultiplierAbAttr in ab-attrs.ts, the dispatch Pokemon.getAttackDamage -> applyAbAttrs("ReceivedMoveDamageMultiplierAbAttr"))
// and from the one live user (Survivor Bias, 5701, attr 0). The parent's constructor closure is the constant `() => true` and the
// class overrides `canApply` completely, so the parent's condition is never asked. canApply is now `guards && gate && residual`,
// in the ORIGINAL clause order:
//
//   guards    1. the move is an attacking move (move?.is("AttackMove"))                                  -> else false
//   gate      2. the move is resisted: pokemon.getMoveEffectiveness(opponent, move) is below 1           -> atom move.effectiveness lt 1
//   residual  3. the hit would faint the holder: damage.value >= pokemon.hp                              (feasibility)
//   apply     damage = max(0, pokemon.hp - hpLeft); the original value of hpLeft is the fixed 1. No random draw. Runs for simulated
//             calls too (it only rewrites the damage holder).
//
// `hpLeft` is new as a constructor argument (default 1, what the live user gets), so that the one number of the effect is a typed
// setting. The "would faint me" test is classified as feasibility, not as a condition: the effect rewrites the damage to
// hp - hpLeft, which would RAISE a hit that does less than that, so dropping the test would change the meaning of the block.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { DamageCapOnResistAbAttr } from "#data/elite-redux/archetypes/damage-cap-on-resist";

export default defineDecl(DamageCapOnResistAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Survive a resisted hit that would knock me out",
  summary: params =>
    `When an attack I resist would knock me out, I keep ${params.hpLeft} HP instead. Example: 1 means I survive with 1 HP. Attacks I do not resist are not changed.`,
  synonyms: [
    "survivor bias",
    "sturdy",
    "endure",
    "cannot faint from resisted moves",
    "survive with 1 hp",
    "not very effective moves cannot knock out",
  ],
  examples: ["Not very effective moves cannot knock me out", "Survive any resisted hit with 1 HP left"],
  params: [
    {
      id: "hpLeft",
      ctorIndex: 0,
      path: "hpLeft",
      control: "number",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "HP I keep when the cap applies (1 = survive with 1 HP)",
      editable: true,
      gateIndependent: true,
      default: 1,
    },
  ],
  conditions: [
    // The gate is [move.effectiveness lt 1] (bindings.ts): the move is not very effective against me.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must be an attacking move",
    "The hit must be strong enough to knock me out (its damage is at least my current HP)",
  ],
  effect: { id: "effect.package", params: ["hpLeft"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", rngOrder: [], state: "none", simulated: "respects" },
  probes: [
    {
      // Low HP makes the hit lethal; the foe moves cover a resisted and a neutral matchup against the grid's Steel and Water holders.
      name: "low HP against a special, a physical and a Fire move",
      axes: { hp: ["max", "max-1", 1], foeMove: ["WATER_GUN", "BITE", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand (guards: attacking move; gate: resisted; residual: lethal). The effect is a package PLACEHOLDER with the typed setting hpLeft: written reason: no library effect rewrites the damage to 'my current HP minus N'; effect.cap-damage caps at a share of MAX HP (maxPct), a different formula, and effect.multiply-damage-taken multiplies. Request R-B08-36 asks for `effect.leave-hp` (damage = max(0, hp - N)). The effect is one fixed rule with one number, so nothing more can be split off. One user, Survivor Bias (5701, attr 0), gate [move.effectiveness lt 1] on the holder (the atom calls holder.getMoveEffectiveness(attacker, move), the same call as the class). SUSPECTED ODDITY, NOT FIXED: the effectiveness is read with getMoveEffectiveness, which for a status move with the Mycelium Might bypass or a cached turnData.moveEffectiveness can differ from the chart multiplier the ability text speaks of; and a move that does 0 damage because the holder is immune counts as resisted (effectiveness 0 is below 1) but never passes the lethal test. showAbility is false (the parent's constructor argument). The parent's closure `() => true` is never asked because canApply is overridden. Siblings (ReceivedMoveDamageMultiplierAbAttr, FirstDefendDamageReductionAbAttr) are separate classes.",
});
