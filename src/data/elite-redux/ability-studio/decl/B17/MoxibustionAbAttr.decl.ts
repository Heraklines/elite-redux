/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MoxibustionAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
// B17 / Moxibustion. Read by hand: fakemon-pitch-mechanics.ts `MoxibustionAbAttr`, its base PostAttackAbAttr
// (ab-attrs.ts:2196).
//
// canApply, clause by clause. Original order: attackCondition, damage > 0, burned. The split is `guards && gate`;
// moving `damage > 0` in front of the attackCondition is safe because both are pure reads.
//   1. guard      damage > 0: the hit really dealt damage                                -> `guards`
//   2. condition  the move deals damage: PostAttackAbAttr's default attackCondition,
//                 `move.category !== STATUS`                                             -> `gate`, atom move.damaging
//   3. condition  the target is burned: `opponent.status?.effect === StatusEffect.BURN`  -> `gate`, atom status.has (other, BURN)
//   apply: unless simulated, queue a PokemonHealPhase of max(1, floor(damage * healShare)) for the holder. No random draw.
// The heal share used to be the literal 0.75 in apply; it is now the constructor argument `healShare` (default 0.75), so
// the shipped ability is unchanged and the share becomes a typed setting.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MoxibustionAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Heal by a share of the damage I dealt",
  summary: params =>
    `After my attack hurts a burned target, I heal ${params.healPercent}% of the damage dealt (at least 1 HP). Example: 75 means three quarters.`,
  synonyms: ["moxibustion", "drain", "lifesteal", "leech", "heal from damage", "absorb hp", "vampiric"],
  examples: ["Heal 75% of the damage dealt to burned targets", "Drain half the damage dealt to a burned foe"],
  params: [
    {
      id: "healPercent",
      ctorIndex: 0,
      path: "healShare",
      control: "number",
      label: "Share of the damage dealt that I heal (%, 75 = three quarters)",
      editable: true,
      gateIndependent: true,
      default: 75,
      min: 1,
      max: 200,
      step: 1,
      integer: true,
      // The class stores a ratio (0.75); staff see a whole percent.
      codec: {
        toCtor: value => Number(value) / 100,
        fromInstance: raw => (typeof raw === "number" ? Math.round(raw * 100) : undefined),
      },
    },
  ],
  conditions: [
    // The gate: all[move.damaging, status.has { who: other, status: BURN }], in that order. Bound in bindings.ts.
    { slot: "gate", ctx: "params", lib: "move.damaging and status.has", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The hit must have dealt at least 1 damage"],
  effect: { id: "effect.drain", params: ["healPercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The target HP changes how much of the hit can land; a knockout is left out because it ends the battle scenario.
      name: "hit on a healthy and a half-health target",
      axes: { foeHp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package: the effect is the library's 'heal a share of the damage dealt' (effect.drain; the class heals through a PokemonHealPhase with at least 1 HP, floor(damage * share), which is what the declared effect means). `damage > 0` has no registry guard id (request R6), so it is written as feasibility. Dropping the burn condition is safe: nothing else tests it. The share was a literal 0.75 in apply; I made it the constructor argument `healShare = 0.75` (same behaviour for the shipped ability, typed setting for staff). Users: Moxibustion (6032, attr 0) only. No game bug found.",
});
