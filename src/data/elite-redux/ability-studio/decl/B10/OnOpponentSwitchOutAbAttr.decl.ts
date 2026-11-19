/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / event-effect (Tier C, read by name).
//
// The class extends only AbAttr and is not dispatched through applyAbAttrs: phases/switch-summon-phase.ts scans each living
// Pokemon on the side OPPOSITE the one that switched out for `attr.constructor.name === "OnOpponentSwitchOutAbAttr"` (after the
// PreSwitchOut chain) and calls `attr.fire(observer, leavingOpponent)`. The new WHEN `event.foe-switches-out` carries the class name
// as its dispatch key and provides the holder and the leaving foe (`other`).
//
// What the class is: constructor `{ moveId, power? }` kept in the private field `opts`, `super(false)`. `fire`:
//     leavingOpponent missing or fainted -> nothing
//     else queue a MovePhase for the HOLDER aimed at the leaving foe with scriptedPokemonMove(moveId, power), MoveUseMode.INDIRECT
// No closure, no random draw, no check on the holder (a fainted holder is skipped by the engine scan, not by the class).
// The engine scan does NOT check the attr-level condition, so extra IFs cannot be ANDed on (reusableAlone.if false).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OnOpponentSwitchOutAbAttr } from "#data/elite-redux/archetypes/on-opponent-switch-out";
import { MoveId } from "#enums/move-id";
import { scriptedMoveCodec } from "./b10-codecs";

export default defineDecl(OnOpponentSwitchOutAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.foe-switches-out",
  label: "Strike a foe with a move as it switches out",
  summary: params =>
    `When a foe switches out, I use the move ${params.move} on it before it leaves. Example: a 20 power Pursuit.`,
  synonyms: ["tag", "super sniper", "pursuit", "punish switching", "hit the foe that leaves", "catch switchers"],
  examples: ["When the opposing Pokemon switches out, I hit it with a 20 power Pursuit, like Super Sniper"],
  params: [
    {
      id: "move",
      ctorIndex: 0,
      path: "opts",
      control: "text",
      label: "Move to use, with its power if you want to change it (for example: Pursuit at 20 power)",
      editable: true,
      default: "Pursuit",
      codec: scriptedMoveCodec(MoveId),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["The foe that is leaving must not have fainted", "The move is a free extra move: it uses no PP"],
  effect: { id: "effect.package", params: ["move"] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a foe switches out", axes: {} }],
  l2StaticReason:
    "The class is read by a by-name scan in the switch phase, not dispatched, and the L2 twin puts the attr on the holder while the scan looks at the foe's side, so the twin cannot show the original evaluated. The B10 test (test/tests/elite-redux/decomp/B10/on-opponent-switch-out.test.ts) calls fire() on the original and the rebuild for a leaving and a fainted foe and compares the queued move.",
  status: "decomposed",
  notes:
    "Tier C. Users: Tag (Pursuit at its own power) and Super Sniper (Pursuit at 20 power), nothing to bind. WHEN `event.foe-switches-out` was added to the library by this batch (R-B10-13). The effect is declared as one piece rather than the library's 'Use a move' effect because that effect also refuses to run when the holder has fainted and aims through a frame the by-name scan does not build; making them equal is request R-B10-14. `fire` never reads `simulated` (the engine scan passes none).",
});
