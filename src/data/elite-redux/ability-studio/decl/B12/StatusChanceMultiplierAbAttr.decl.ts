/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 2. "My moves that can inflict one specific status do so N times as often" (Pyromancy, Cryomancy, Thermomancy, ...).
//
// Source: src/data/elite-redux/archetypes/status-chance-multiplier.ts, StatusChanceMultiplierAbAttr (extends the shared
// MoveEffectChanceMultiplierAbAttr, which Serene Grace uses with no status filter). Dispatched from Move.getMoveChance
// (applyAbAttrs("MoveEffectChanceMultiplierAbAttr", ...)). Constructor: `(status, multiplier)`; the parent hides the ability banner.
// Clauses, in the original order (Tier B):
//   1. `super.canApply`: `chance.value > 0` and the move is not Order Up or Electro Shot     GUARD (the class method `guards`):
//      a real chance can be multiplied, a guaranteed or missing one is left alone
//   2. the move has a StatusEffectAttr whose effect is the configured status                  GATE (replaceable) ...
//   3. for FREEZE only: the move has an AddBattlerTagAttr for the frostbite tag               ... same GATE: the frostbite analogue
// apply (inherited): `chance.value = min(chance.value * multiplier, 100)`. No random draw, no state, no `simulated` test.
//
// The gate is one idea, "the move inflicts <status>", but the library has no atom for it (request R-B12-11), so every user's gate is
// a legacy-closure until it exists. The effect is the same "multiply the extra-effect chance" mechanic the librarian already has a
// request for (R-B02-10, effect.package until it exists).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STATUS_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { StatusChanceMultiplierAbAttr } from "#data/elite-redux/archetypes/status-chance-multiplier";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(StatusChanceMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.effect-chance",
  label: "Make my moves inflict one status more often",
  summary: params =>
    `Moves of mine that can inflict ${params.status} do it ${params.multiplier} times as often, never above 100%. Example: 5 = five times the chance. Other moves are left alone.`,
  synonyms: [
    "burn more often",
    "freeze more often",
    "frostbite chance",
    "status chance boost",
    "inflict status more often",
    "serene grace for one status",
    "pyromancy",
    "cryomancy",
  ],
  examples: [
    "Moves inflict burn 5 times as often, like Pyromancy",
    "Moves inflict frostbite 5 times as often, like Cryomancy",
  ],
  params: [
    {
      id: "status",
      ctorIndex: 0,
      path: "status",
      control: "select",
      label: "Status condition that becomes more likely (Freeze also covers frostbite)",
      editable: true,
      default: "BURN",
      options: STATUS_OPTIONS,
      codec: enumCodec(StatusEffect, "status"),
    },
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "chanceMultiplier",
      control: "number",
      min: 0,
      max: 10,
      step: 0.5,
      label: "Chance multiplier (5 = five times as often, 0 = never)",
      editable: true,
      // Only the effect reads it; the gate (does the move inflict the status) never repeats it.
      gateIndependent: true,
      default: 5,
    },
  ],
  // The status the gate looks for is the same setting as `status`: moving the setting moves the gate's status (the atom of R-B12-11).
  gateParams: [{ param: "status", block: "move.inflicts-status", field: "status" }],
  conditions: [
    // The gate is the move test "it inflicts the configured status" (a status effect of the move, or for freeze the frostbite
    // effect). No library atom yet: R-B12-11. Every user's binding is a legacy-closure with that reason.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must already have an extra effect with a chance above 0 (a guaranteed or missing effect is left alone)",
    "Order Up and Electro Shot are never changed",
    "The new chance never goes above 100%",
  ],
  // No library effect multiplies the effect chance yet (R-B02-10); it is shown as one piece until it exists.
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the holder's moves that can burn, freeze, or do neither",
      axes: {},
    },
  ],
  l2StaticReason:
    "Every user's gate is a legacy-closure (no atom for 'the move inflicts a status'), so the shared L2 has no rebuilt attr to twin. B12's own test (B12/chunk2.test.ts) drives the class over every move of the game against a reference formula.",
  status: "decomposed",
  notes:
    "legacy-closure-pending-request for all 6 attrs. Tier B, 5 abilities: Pyromancy (5008 attr 0, Burn x5), Cryomancy (5187 attr 0, Freeze x5), Thermomancy (5564 attr 0 Burn x5 and attr 1 Freeze x5), Chandelier (5665 attr 2, Burn x5), Cryostasis (5682 attr 0, Freeze x5); every user multiplies by 5. The class is split into `guards` (the parent's canApply: a real chance, not Order Up or Electro Shot, the first clause of the old canApply) and `gate` (the move inflicts the status, clauses 2 and 3) in the original order; the new canApply is gatedCanApply with the same short-circuiting. The gate has no library atom: request R-B12-11 (`move.inflicts-status{status}` with the frostbite rider). The effect is the package 'multiply the extra-effect chance' (R-B02-10), same as Serene Grace. Oddities, not fixed: (a) the status test only looks at `StatusEffectAttr` and (for Freeze) the frostbite tag effect, so a move that inflicts burn through another class (a custom ER move effect, an ability, or a secondary tag) is not boosted; (b) the multiplier is applied to `chance.value`, which already includes Serene Grace if the user also has it, and the parent's cap at 100 applies once at the end; (c) the status is also boosted on a move whose status effect has chance -1 (guaranteed) only if chance.value > 0, so a guaranteed burn is never touched; (d) `showAbility` is false, so no banner shows.",
});
