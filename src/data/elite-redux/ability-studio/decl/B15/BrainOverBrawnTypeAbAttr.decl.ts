/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 1. Tier A, calc-modifier. "While the game decides the type of my move, IF the move is a Fighting move, it becomes a Psychic move."
//
// Source: src/data/elite-redux/abilities/barbaracle-mechanics.ts, class BrainOverBrawnTypeAbAttr (extends MoveTypeChangeAbAttr, whose canApply is
// `this.condition(pokemon, opponent, move)` and whose apply is `moveType.value = this.newType`; showAbility false).
// The class used to be `constructor() { super(PSYCHIC, (_p, _t, move) => move.type === FIGHTING) }`; the constructor now takes (newType, condition)
// with those two as defaults (behaviour-neutral), so the closure is a real constructor slot (ctor:1) like in the parent class.
// The only clause is the closure `move.type === PokemonType.FIGHTING`, the move's OWN printed type. The library atom move.type must be bound with
// `effective: false` (the default `true` asks moveUser.getMoveType(move), which dispatches this very class again and would recurse). No random draw, no state.
// Dispatch: Pokemon.getMoveType and Move.calculateBattlePower, key MoveTypeChangeAbAttr (WHEN calc.move-type).
import { BrainOverBrawnTypeAbAttr } from "#data/elite-redux/abilities/barbaracle-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(BrainOverBrawnTypeAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-type",
  label: "Turn my Fighting moves into another type (Brain Over Brawn)",
  summary: params =>
    `While the game decides the type of my move, a move that passes the condition becomes ${params.type} type. By default Fighting moves become Psychic moves.`,
  synonyms: [
    "brain over brawn",
    "fighting becomes psychic",
    "convert fighting moves",
    "change move type",
    "type conversion",
    "psychic punches",
  ],
  examples: ["My Fighting moves become Psychic moves", "Turn Water moves into Ice moves, like a custom Refrigerate"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "newType",
      control: "select",
      label: "Moves become this type",
      editable: true,
      default: "PSYCHIC",
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
  probes: [{ name: "the holder attacks with a Fighting move and a Normal move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A. 2 attrs: Bodhisattva (6076 attr 2) and Brain Over Brawn (6080 attr 0); both bind ctor:1 to move.type FIGHTING with effective false (the move's own printed type). Constructor change (behaviour-neutral): (newType, condition) with the old values as defaults; the instance fields are the parent's private newType and condition, read back through `path`. Pair: BrainOverBrawnPowerAbAttr (the x1.2 power rider) is a separate attr with its own condition on the same native type. Not a bug, but worth knowing: both attrs test the NATIVE type (move.type), so a move another ability already turned into Fighting is not converted (the comment in barbaracle-mechanics.ts says this is intended).",
});
