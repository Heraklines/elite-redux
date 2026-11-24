/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 3 (Tier B, calc-modifier). "The extra-effect chance of my moves that can paralyze is multiplied (x5 by default)."
//
// Source: fakemon-pitch-mechanics.ts, ElectromancyEffectChanceAbAttr (extends MoveEffectChanceMultiplierAbAttr). Dispatched from
// Move.getMoveChance (`applyAbAttrs("MoveEffectChanceMultiplierAbAttr", { pokemon: user, simulated: !showAbility, chance, move })`).
// Constructor `(chanceMultiplier = 5, boostedStatus = PARALYSIS)`: argument 0 goes to the parent (private field `chanceMultiplier`),
// argument 1 is `boostedStatus`. Both are new constructor arguments whose defaults equal the old literals (`super(5)` and PARALYSIS).
// canApply, original clause order, now `guards && gate`:
//   guards  1. super.canApply: `!(chance.value <= 0 || [ORDER_UP, ELECTRO_SHOT].includes(move.id))`   a real chance above 0, two moves skipped
//   gate    2. move.getAttrs("StatusEffectAttr").some(attr => attr.effect === boostedStatus)          the move has a part that can inflict
//                                                                                                     the status -> NO library atom yet (R-B16-15)
// apply (the parent's, not overridden): `chance.value *= chanceMultiplier; chance.value = Math.min(chance.value, 100)`.
// No random draw, no state; the class never reads `simulated`.
import { ElectromancyEffectChanceAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(ElectromancyEffectChanceAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.effect-chance",
  label: "Multiply the chance that my moves cause one chosen status",
  summary: params =>
    `The extra-effect chance of my moves that can cause ${params.status} is multiplied by ${params.multiplier}, never above 100%. Example: 5 = a 10% chance becomes 50%.`,
  synonyms: [
    "electromancy",
    "more paralysis",
    "paralysis chance",
    "serene grace for one status",
    "status chance boost",
    "stronger side effect",
  ],
  examples: ["Make my paralyzing moves paralyze five times as often, like Electromancy"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "chanceMultiplier",
      control: "number",
      min: 0,
      max: 10,
      step: 0.1,
      label: "Chance multiplier (5 = five times as likely, 0 = never)",
      editable: true,
      gateIndependent: true,
      default: 5,
    },
    {
      id: "status",
      ctorIndex: 1,
      path: "boostedStatus",
      control: "select",
      label: "Which status the move must be able to cause",
      editable: true,
      default: "PARALYSIS",
      options: enumOptions(StatusEffect),
      codec: enumCodec(StatusEffect, "status"),
    },
  ],
  gateParams: [{ param: "status", block: "move.can-inflict-status", field: "status" }],
  conditions: [
    // The gate: the move has a part that can inflict the chosen status. Staff may replace or drop it.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must have an extra effect with a chance above 0 (a guaranteed or missing effect is left alone)",
    "Order Up and Electro Shot are never changed",
    "The result never goes above 100%",
  ],
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The shared L2 scenario for this trigger lets the holder attack with Tackle and Double Slap, and neither has an extra effect with a chance, so nothing ever asks for the chance. test/tests/elite-redux/decomp/B16/chunk3.test.ts drives Thunderbolt (10% paralysis), Ember (10% burn) and Order Up through the original attr and the rebuild.",
  probes: [{ name: "a move with a paralysis chance", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B: trigger (while the game calculates my move's effect chance), one IF in the gate (the move can inflict the chosen status), one effect (multiply the chance; no library block yet, so effect.package with the typed multiplier, same as the parent class declared by B02: request B02-10, and R-B16-21 here). The gate has NO library atom (the move's own parts are not readable by any atom), so its binding is a legacy closure until R-B16-15 (`move.can-inflict-status {status}`) exists; the declaration already lists gateParams status -> that atom's `status`. The parent's rule (a real chance above 0, not Order Up or Electro Shot) is clause 1 of `guards` and stays in the class; it is also what the parent's declaration lists as feasibility. The class previously had no constructor arguments; the two new ones default to the old literals, so `builder.attr(ElectromancyEffectChanceAbAttr)` is unchanged. The effect reads `chance.value`, the value AFTER earlier modifiers, not `move.chance`. The gate looks at `StatusEffectAttr` parts only (Thunderbolt, Nuzzle, Thunder), not at a status that comes from an ability or a Tag, and a move whose only paralysis part is a guaranteed status (Thunder Wave, chance -1) fails clause 1 first. User: Electromancy (6037, attr 0). Same shape as HydromancyEffectChanceAbAttr (another test on the move).",
});
