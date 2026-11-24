/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 1 (Tier A, calc-modifier). "While the game decides the type of my move, IF the move is a Normal move, it becomes a Stellar move."
//
// Source: fakemon-pitch-mechanics.ts, StellarizeTypeAbAttr (extends MoveTypeChangeAbAttr, whose canApply is
// `this.condition(pokemon, opponent, move)` and whose apply is `moveType.value = this.newType`; showAbility false).
// The class used to be `constructor() { super(PokemonType.STELLAR, (_user, _target, move) => move.type === PokemonType.NORMAL) }`; the
// constructor now takes (newType, condition) with those two as defaults (behaviour-neutral), so the closure is a real constructor
// slot (ctor:1) like in the parent class. The only clause is the closure `move.type === PokemonType.NORMAL`, the move's OWN printed
// type, so the library atom move.type must be bound with `effective: false` (the default `true` asks moveUser.getMoveType(move),
// which dispatches this very class again). No random draw, no state.
// Dispatch: Pokemon.getMoveType and Move.calculateBattlePower, key MoveTypeChangeAbAttr (WHEN calc.move-type).
// The same ability also carries StabAddAbAttr (same-type bonus for Stellar) and StellarizePowerAbAttr; they are separate attrs.
import { StellarizeTypeAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(StellarizeTypeAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-type",
  label: "Turn my Normal moves into another type (Stellar by default)",
  summary: params =>
    `While the game decides the type of my move, a Normal move becomes ${params.type} type. Example: Stellar makes Normal moves Stellar moves.`,
  synonyms: [
    "stellarize",
    "normal becomes stellar",
    "convert normal moves",
    "change move type",
    "type conversion",
    "stellar moves",
    "pixilate style",
  ],
  examples: ["My Normal moves become Stellar moves, like Stellarize", "Turn Normal moves into Flying moves"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "newType",
      control: "select",
      label: "Moves become this type",
      editable: true,
      default: "STELLAR",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [{ slot: "ctor:1", ctx: "attack", lib: "move.type", path: "condition", removable: true, editable: true }],
  guards: [],
  feasibility: [],
  effect: { id: "effect.change-move-type", params: ["type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder attacks with a Normal move and a non-Normal move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, fully decomposed (trigger, one IF, one effect with a typed param). 2 attrs: Stellarize (6053 attr 0) and Bejeweled (6111 attr 2); both bind ctor:1 to move.type NORMAL with effective false (the move's own printed type, the same test as the closure; the effective form would recurse into this very class). Constructor change (behaviour-neutral): (newType, condition) with the old values as defaults; the instance fields are the parent's private newType and condition, read back through `path`. Pair: StellarizePowerAbAttr (the x1.5 power rider, also in these two abilities). Not a bug, worth knowing: the type test uses the PRINTED type, so a move that another ability turned into Normal is not converted.",
});
