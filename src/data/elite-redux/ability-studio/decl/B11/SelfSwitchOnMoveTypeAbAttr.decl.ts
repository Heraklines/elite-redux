/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 4 / event-effect (Tier B: the move test is the gate inside canApply).
//
// Read by hand from archetypes/self-switch-on-move-type.ts. PostAttack hook (WHEN "after my attack lands"), constructor `(moveType)`
// kept in the private field `moveType`; `super()` (default attack condition: the move is not a status move; banner shown). It owns
// a `ForceSwitchOutHelper(SwitchType.SWITCH)`.
//   canApply is now `guards && gate && residual`, in the ORIGINAL clause order:
//     1. guards:   `!simulated`                                                   (nothing happens in a preview)
//     2. gate:     `super.canApply(params)`  (the move is a damaging move)        (CONDITION: move.damaging)
//                  `pokemon.getMoveType(move) === moveType`                       (CONDITION: move.type, effective)
//     3. residual: `hitResult < HitResult.NO_EFFECT`   (the hit really connected) (feasibility; no library atom, request R-B11-C4-02)
//                  `pokemon.turnData.hitsLeft <= 1`    (only the LAST hit of a multi-hit move)  (guard wanted: request R-B11-C4-03)
//   apply: `helper.switchOutLogic(holder)` (the usual U-turn style switch; the helper checks that a switch is possible). No random draw.
//
// The effect is the library effect.force-switch-out. Note that effect carries the Wimp Out guards (not-own-hp-cost-move, ...),
// which this class does NOT apply and which are therefore not listed under `guards`.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { SelfSwitchOnMoveTypeAbAttr } from "#data/elite-redux/archetypes/self-switch-on-move-type";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(SelfSwitchOnMoveTypeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Switch out after my attack of one type hits",
  summary: params =>
    `After my damaging ${params.type}-type move connects (on its last hit), I switch out, like U-turn. Example: every Ice move pivots me out.`,
  synonyms: ["u-turn", "pivot", "switch after attacking", "flip turn", "hit and run", "hollow ice zone"],
  examples: ["Switch out after every Ice move I land", "Pivot out after a Water attack"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "moveType",
      control: "select",
      label: "Only after my move is this type",
      editable: true,
      default: "ICE",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  gateParams: [{ param: "type", block: "move.type", field: "type" }],
  conditions: [{ slot: "gate", ctx: "params", lib: "move.type", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "Never in a preview",
    "The hit must really connect: a move that is blocked or has no effect does not make me switch",
    "Only after the last hit of a multi-hit move",
    "The switch can fail like any switch (nothing to switch to, or something traps me)",
  ],
  effect: { id: "effect.force-switch-out", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "after my attack lands at full and half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Only user: Hollow Ice Zone (5680, attr 1; the attr-level data shows the default damaging-move condition). The gate binding is all[move.damaging, move.type ICE effective]: move.damaging is `category !== STATUS`, the same as the parent's default attackCondition, and move.type effective is `moveUser.getMoveType(move)`, the same call as the class; gateParams writes the live `type` into the atom. canApply is false for a preview (guard 1), so the class respects `simulated`. The residual (hit connected, final hit) is not a library condition yet: the atom 'my hit connected' (hitResult < NO_EFFECT) and a guard 'only after my final hit' (the existing after-final-hit guard reads the OTHER Pokemon's hitsLeft, here it is the holder's) are requested as R-B11-C4-02 and R-B11-C4-03. The L1 grid only gives hitResult EFFECTIVE and a holder with hitsLeft 0, so test/tests/elite-redux/decomp/B11/chunk4.test.ts drives the other values on the original and the rebuild.",
});
