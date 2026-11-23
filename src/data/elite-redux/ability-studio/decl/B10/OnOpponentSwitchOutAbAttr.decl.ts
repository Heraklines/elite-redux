/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / event-effect (Tier C, read by name).
//
// The class extends only AbAttr and is not dispatched through applyAbAttrs: phases/switch-summon-phase.ts scans each living
// Pokemon on the side OPPOSITE the one that switched out for `attr.constructor.name === "OnOpponentSwitchOutAbAttr"` (after the
// PreSwitchOut chain) and calls `attr.fire(observer, leavingOpponent)`. The WHEN `event.foe-switches-out` carries the class name
// as its dispatch key and provides the holder and the leaving foe (`other`).
//
// What the class is: constructor `{ moveId, power? }` kept in the private field `opts`, `super(false)`. `fire`:
//     leavingOpponent missing or fainted -> nothing
//     else queue a MovePhase for the HOLDER aimed at the leaving foe with scriptedPokemonMove(moveId, power), MoveUseMode.INDIRECT
// No closure, no random draw, no check on the holder (a fainted holder is skipped by the engine scan, not by the class).
// The engine scan does NOT check the attr-level condition, so extra IFs cannot be ANDed on (reusableAlone.if false).
//
// The move and its power are two settings: the move, and an optional power (0 = the move's own power, no `power` key at all).
// `assembleCtorArg` builds `{ moveId }` or `{ moveId, power }` so the rebuilt attr equals the original (Tag has no power, Super
// Sniper has 20). The effect is the library's "Use a move" (effect.scripted-move, params moveId and power).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OnOpponentSwitchOutAbAttr } from "#data/elite-redux/archetypes/on-opponent-switch-out";
import { buildScriptedMove, scriptedMoveIdCodec, scriptedMovePowerCodec } from "./b10-codecs";

export default defineDecl(OnOpponentSwitchOutAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.foe-switches-out",
  label: "Strike a foe with a move as it switches out",
  summary: params =>
    `When a foe switches out, I use ${params.moveId} on it before it leaves${Number(params.power) > 0 ? ` with ${params.power} power` : " at the move's own power"}. Example: Pursuit with 20 power.`,
  synonyms: ["tag", "super sniper", "pursuit", "punish switching", "hit the foe that leaves", "catch switchers"],
  examples: ["When the opposing Pokemon switches out, I hit it with a 20 power Pursuit, like Super Sniper"],
  params: [
    {
      id: "moveId",
      ctorIndex: 0,
      ctorOption: "moveId",
      path: "opts",
      control: "text",
      label: "Move to use (type its name, for example Pursuit)",
      editable: true,
      default: "PURSUIT",
      codec: scriptedMoveIdCodec,
    },
    {
      id: "power",
      ctorIndex: 0,
      ctorOption: "power",
      path: "opts",
      control: "number",
      min: 0,
      max: 250,
      step: 1,
      integer: true,
      label: "Power of the move (0 = the move's own power)",
      editable: true,
      default: 0,
      codec: scriptedMovePowerCodec,
    },
  ],
  assembleCtorArg: { index: 0, build: buildScriptedMove },
  conditions: [],
  guards: [],
  feasibility: ["The foe that is leaving must not have fainted", "The move is a free extra move: it uses no PP"],
  effect: { id: "effect.scripted-move", params: ["moveId", "power"] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a foe switches out", axes: {} }],
  l2StaticReason:
    "The class is read by a by-name scan in the switch phase, not dispatched, and the L2 twin puts the attr on the holder while the scan looks at the foe's side, so the twin cannot show the original evaluated. The B10 test (test/tests/elite-redux/decomp/B10/on-opponent-switch-out.test.ts) calls fire() on the original and the rebuild for a leaving and a fainted foe and compares the queued move.",
  status: "decomposed",
  notes:
    "Tier C. Users: Tag (Pursuit at its own power, power setting 0) and Super Sniper (Pursuit at 20 power), nothing to bind. The move and the power are separate settings (the power is a number of 0 to 250 with 0 meaning the move's own power). WHEN `event.foe-switches-out` was added to the library by this batch (R-B10-13, should have been a request). The effect is the library's 'Use a move' by id, but not equal to it yet: the library effect also refuses to run when the holder has fainted and aims through a frame the by-name scan does not build (request R-B10-14). `fire` never reads `simulated` (the engine scan passes none).",
});
