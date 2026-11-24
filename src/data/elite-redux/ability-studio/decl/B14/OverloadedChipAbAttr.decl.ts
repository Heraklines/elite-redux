/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 7. Tier B event-effect. "At the end of every turn, if I am still at the maximum number of charge stacks, I lose an eighth
// of my maximum HP (at least 1), as indirect damage" (Overloaded). Also the marker that the engine looks for by class name:
// `overloadedActive` (power and priority halves) and `erOverloadedSelfLocked` (charge-stack.ts, the switch lock) ask for an active
// attr named OverloadedChipAbAttr, so the class name must never change.
//
// Source: electivire.ts OverloadedChipAbAttr (extends PostTurnAbAttr, dispatched at every end of turn). The parent's `canApply` is
// `true`; the original `apply`, in this order:
//   1. `simulated`                                      a preview does nothing           (the frame flag, kept first)
//   2. `pokemon.isFainted()`                            a fainted holder takes nothing   (library guard: not-fainted)
//   3. `getCharge(pokemon) !== CHARGE_STACK_MAX`        I must hold exactly 4 stacks     (gate; no atom: R-B14-6.2)
//   4. `chip = max(1, floor(maxHp * 1/8))`; `pokemon.damageAndUpdate(chip, { result: INDIRECT })`   the effect
// Nothing is random. The gate cannot move into `canApply`: the inherited `canApply` is always true, so the ability flyout is queued at
// EVERY end of turn (apply-ab-attrs.ts, `attr.showAbility && !simulated`), also when no chip follows. A gate in `canApply` would drop
// that flyout, which the player can see. So the clauses stay in `apply` in the original order, now through the same
// `gatedCanApply` helper the other Tier B classes use (`guards` then `gate`), still replaceable through `gateOverride`.
// Class edit (pure move of code): a constructor argument `chipFraction` (1/8) and the `guards` and `gate` methods.
// Planned tree for the gate: mon.charge-stacks { holder, cmp "=", n 4 }.
import { OverloadedChipAbAttr } from "#data/elite-redux/abilities/electivire";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(OverloadedChipAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Lose a share of max HP each turn at full charge",
  summary: params =>
    `At the end of every turn, if I hold the maximum of 4 charge stacks, I lose ${params.fraction} of my max HP (at least 1 HP). Example: 0.125 = one eighth.`,
  synonyms: [
    "overloaded",
    "overcharge damage",
    "end of turn self damage",
    "burn off charge",
    "hurt myself when charged",
    "residual damage at max stacks",
    "life orb style chip",
  ],
  examples: ["At the end of each turn, while I am fully charged, I lose 1/8 of my max HP, like Overloaded"],
  params: [
    {
      id: "fraction",
      ctorIndex: 0,
      path: "chipFraction",
      control: "number",
      min: 0.01,
      max: 1,
      step: 0.005,
      label: "Share of max HP lost each turn (0.125 = one eighth, 0.25 = a quarter)",
      editable: true,
      default: 0.125,
      // Only the effect reads it; the gate never repeats it.
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [I hold exactly the maximum stacks] (bindings.ts, legacy until R-B14-6.2). Removable: "lose HP every turn" and "lose HP
    // while I hold some other number of stacks" are valid designs.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "Does nothing while the game is only previewing",
    "Always loses at least 1 HP, the share is rounded down",
    "Counts as indirect damage: no attacker, no ability trigger from a hit",
    "The ability flyout shows at every end of turn, also when no HP is lost",
  ],
  effect: { id: "effect.package", params: ["fraction"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "the turn ends", axes: {} }],
  l2StaticReason:
    "The gate binding is a legacy closure (no atom reads the charge stacks yet, and no scenario axis can build them), so the twin has no rebuilt attr to compare; B14/chunk7.test.ts drives the end-of-turn dispatch with every stack count, a fainted holder and a preview.",
  status: "decomposed",
  notes:
    "Tier B, gate kept inside apply (reason in the header: the inherited canApply is always true and the flyout shows every turn). Users (1): Overloaded (5927) attr 2. The effect is a package ONLY because the library has no 'lose a share of my own max HP as indirect damage' effect: effect.heal-percent heals, effect.recoil is a share of the damage dealt. R-B14-7.1 requests effect.lose-hp-percent with the exact formula; the one number is a typed setting. The gate is a legacy binding until R-B14-6.2 (charge stacks). The class is also the marker the engine finds by name; removing it from a rebuilt ability switches off the power and priority halves and the switch lock. Oddities, not fixed: (1) SUSPECTED BUG (cosmetic): the ability flyout is shown at every end of turn, even when the holder has fewer than 4 stacks and nothing happens; (2) the chip is indirect damage with no source, so it is not reduced by anything that reads an attacker; (3) the count is exactly 4 (`===`), same as 'at least 4' only because the store clamps at 4.",
});
