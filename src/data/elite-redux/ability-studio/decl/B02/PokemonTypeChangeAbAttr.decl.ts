/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 2. "Just before I use a move, my type becomes the type of that move" (Protean, Libero, ...).
//
// Source: src/data/abilities/ab-attrs.ts PokemonTypeChangeAbAttr. Dispatched from MovePhase (move-phase.ts, right after
// the third failure check, `applyAbAttrs("PokemonTypeChangeAbAttr", { pokemon: user, move, opponent })`) and again from
// MovePhase.failMove for Roar, Whirlwind, Trick-or-Treat, Forest's Curse and moves blocked by terrain.
// canApply, in the original order (all of it is rule of the game, nothing a closure supplies):
//   1. `pokemon.isTerastallized` returns false                   feasibility: a Terastallized Pokemon keeps its type
//   2. `move.id === STRUGGLE` returns false                      feasibility
//   3. `move.hasAttr("CallMoveAttr") || move.hasAttr("NaturePowerAttr")` returns false
//                                                                feasibility: the called move triggers it instead
//   4. `pokemon.getTypes().every(t => t === moveType)` returns false   feasibility: already that type, nothing to change
//   5. WRITES `this.moveType = moveType` and returns true       state (scratch field read by getTriggerMessage)
// apply: unless simulated, `pokemon.summonData.types = [moveType]` and `pokemon.updateInfo()`. No random draw.
// Constructor: none (showAbility is fixed to true by `super(true)`). Tier C: one atomic effect, extra IFs can only be
// ANDed on top (for example "only once per entry").
import { PokemonTypeChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PokemonTypeChangeAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.before-i-use-move",
  label: "Change my type to match the move I use",
  summary: () =>
    "Just before I use a move, my type changes to the type of that move. Nothing happens if I am already that type, I am Terastallized, or the move calls another move.",
  synonyms: [
    "protean",
    "libero",
    "become the move's type",
    "type of the move",
    "adapt type",
    "color change before attacking",
  ],
  examples: ["Become the type of every move I use, like Protean"],
  params: [],
  noParamsReason:
    "The class takes no constructor argument: it always makes the holder the single type of the move it is about to use. There is nothing to set; the only variable is the move itself.",
  conditions: [],
  guards: [],
  feasibility: [
    "A Terastallized Pokemon keeps its type",
    "Struggle never changes the type",
    "Moves that call another move (Metronome, Nature Power and the like) do not trigger it; the move they call does",
    "Nothing happens when every type I have already equals the move's type",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder attacks with a Normal move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C, one atomic effect (no library block 'become the type of the move I use': request B02-11). Six users, all with no argument: Protean, Libero, RKS System (attr 1), Prismatic Fur (attr 1), Pattern Change, Gillie Suit (attr 1); RKS System attr is pushed after construction by init-elite-redux-vanilla-rebalance.ts:1474, so its index (1) is not the line order. `canApply` WRITES `this.moveType` (a scratch field on the ability's singleton attr, used only by getTriggerMessage) before apply runs, also for simulated calls; apply does respect `simulated`. Because the attr object is shared by every Pokemon with that ability, two holders in one turn could in theory show the other's type in the flyout message (never the wrong type on the Pokemon itself, which apply recomputes with `pokemon.getMoveType(move)`). Existing behaviour, recorded, not changed. A rebuilt attr gets its own scratch field. The effect uses `pokemon.getMoveType(move)` (so it follows Normalize-style conversions and Electrify) rather than `move.type`.",
});
