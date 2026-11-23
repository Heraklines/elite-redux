/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 3. "After my trapping move lands, the trap lasts N turns and hurts 1/N of the target's max HP each turn" (Tentalock, Tangled Tails, Wildfire).
//
// Source: src/data/elite-redux/archetypes/trap-duration-modifier.ts, TrapDurationModifierAbAttr (extends PostAttackAbAttr).
// Constructor: one options object `{ turns, damageFraction, moveIds? }`; `super(undefined, false)` keeps the default attack condition (which the
// class never consults: its own canApply does not call the parent) and hides the ability banner. Dispatched after a hit (applyAbAttrs("PostAttackAbAttr")).
// Clauses, in the original order (Tier B):
//   canApply 1  the target exists and has not fainted                    GUARD-like (class method `guards`): the trap goes on a standing target
//   canApply 2  the move is one of the ten trapping moves AND, when a subset is set, one of `moveIds`   GATE (replaceable)
//   apply 1     `simulated` or no target -> nothing                       respects the preview flag
//   apply 2     remove the ten trap tags the target may carry             EFFECT (written as one piece, see notes)
//   apply 3     add the generic trap tag for `turns` turns, with the holder as its source   EFFECT
//   apply 4     when `damageFraction > 0`, the tag takes `Math.round(1 / damageFraction)` as its damage divisor   EFFECT
// No random draw, no state. Staff say "1 in N" for the damage; the class keeps the fraction (1 / N), so the setting is N.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TrapDurationModifierAbAttr } from "#data/elite-redux/archetypes/trap-duration-modifier";
import { moveListCodec, trapDamageDenominatorCodec, trapTurnsCodec } from "./b12-chunk3-codecs";

const IN_OPTIONS = { ctorIndex: 0, path: "opts" } as const;

export default defineDecl(TrapDurationModifierAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Make my trapping moves last longer and hurt more",
  summary: params =>
    `After my trapping move (Fire Spin, Wrap, Whirlpool...) lands, the trap lasts ${params.turns} turns and hurts 1/${params.denominator} of the target's max HP each turn. Example: 6 turns, 1/6, like Tentalock.`,
  synonyms: [
    "trap lasts longer",
    "binding moves",
    "wrap damage",
    "partial trapping",
    "grappler",
    "fire spin duration",
    "tentalock",
    "tangled tails",
    "wildfire",
  ],
  examples: [
    "Trapping moves last 6 turns and deal 1/6 of max HP, like Tentalock",
    "Only Fire Spin lasts 4 turns and deals 1/6 of max HP, like Wildfire",
  ],
  params: [
    {
      id: "turns",
      ...IN_OPTIONS,
      ctorOption: "turns",
      control: "number",
      min: 1,
      max: 15,
      step: 1,
      integer: true,
      label: "Turns the trap lasts (6 = six turns)",
      editable: true,
      gateIndependent: true,
      default: 6,
      codec: trapTurnsCodec,
    },
    {
      id: "denominator",
      ...IN_OPTIONS,
      ctorOption: "damageFraction",
      control: "number",
      min: 1,
      max: 16,
      step: 1,
      integer: true,
      label: "Trap damage each turn (1/N of the target's max HP, 6 = one sixth)",
      editable: true,
      gateIndependent: true,
      default: 6,
      codec: trapDamageDenominatorCodec,
    },
    {
      id: "moves",
      ...IN_OPTIONS,
      ctorOption: "moveIds",
      control: "text",
      label: "Only these trapping moves, like 'Fire Spin, Wrap' (empty = every trapping move)",
      // It decides the shape of the gate (which moves count), which staff change with the move blocks.
      editable: false,
      default: "",
      codec: moveListCodec,
    },
  ],
  conditions: [
    // The gate: the move is one of the trapping moves (and one of `moves` when a subset is set): an `any` group of move-is blocks.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The target must still be on the field and standing",
    "Nothing happens when the game only previews the move",
  ],
  // No library effect can replace the trap a move already put on the target with a new length and a new damage share (R-B12-22).
  effect: { id: "effect.package", params: ["turns", "denominator"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Trapping moves (Fire Spin, Wrap) and a move that does not trap reach both sides of the gate; B12's own test drives the moves.
      name: "trapping and non-trapping moves of the holder",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 3 attrs, every gate bound: Tentalock (5519 attr 0) and Tangled Tails (5649 attr 1) turns 6, 1/6, every trapping move; Wildfire (5420 attr 1) turns 4, 1/6, only Fire Spin. The old canApply is split into `guards` (the target is there and standing) and `gate` (a trapping move, and one of the configured moves) in the original order. The effect is 'effect.package': it removes any trap the target carries (ten tag types), re-adds the generic trap for `turns` turns with the holder as source and sets a damage divisor on it; no library effect can set a trap length and damage share, so it is a request (R-B12-22, 'Change the trap my move put on the target'); the numbers are typed params. Oddities, not fixed: (a) the ten trapping moves are listed in the class (Bind, Wrap, Fire Spin, Whirlpool, Sand Tomb, Magma Storm, Infestation, Clamp, Thunder Cage, Snap Trap) and a move of another kind is never touched; (b) the re-added trap is always the generic Wrap trap, so a Fire Spin victim carries the Wrap trap afterwards (its own tag type is removed); (c) it runs after every hit of a multi-hit move and refreshes the trap each time; (d) the parent's default 'damaging move' condition is never consulted (canApply does not call it), which does not matter because every trapping move deals damage; (e) a damage share of 0 would leave the default divisor, which the setting (1 to 16) cannot express; (f) the ability banner is hidden.",
});
