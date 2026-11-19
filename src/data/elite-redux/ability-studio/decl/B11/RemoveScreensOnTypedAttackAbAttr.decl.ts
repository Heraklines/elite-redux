/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / event-effect (Tier C).
//
// Read by hand from archetypes/remove-screens-on-typed-attack.ts. PostAttack hook (WHEN "after my attack lands"),
// constructor `{ type }` kept in the private field `moveType`; `super(undefined, false)`: the default attack condition
// (the move is not a status move) and no ability banner. No closure of its own, so there is nothing to bind.
//   canApply, in the ORIGINAL order:
//     1. super.canApply: the attack condition, the move is a damaging move           (condition: move.damaging)
//     2. no opponent                                                                  -> false   (feasibility)
//     3. `pokemon.getMoveType(move) === moveType`                                     (condition: move.type, the param)
//   apply: simulated or no opponent -> nothing. Else removes Reflect, Light Screen and Aurora Veil from the TARGET's side.
// No random draw.
//
// Why Tier C: there is no library effect "remove the screens on the target's side" (request R-B11-03 in
// requests/B11.md), and the move type the class tests is its own param, so the rule is one effect with one setting.
// Staff can still AND further IFs on top.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { RemoveScreensOnTypedAttackAbAttr } from "#data/elite-redux/archetypes/remove-screens-on-typed-attack";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(RemoveScreensOnTypedAttackAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Break the target's screens when my move is of one type",
  summary: params =>
    `After my damaging ${params.type} move hits, the target's side loses Reflect, Light Screen and Aurora Veil. Example: a Fighting move smashes the screens.`,
  synonyms: [
    "break screens",
    "brick break",
    "psychic fangs",
    "shatter reflect",
    "remove light screen",
    "destroy aurora veil",
  ],
  examples: ["My Fighting moves break Reflect and Light Screen", "Break the foe's screens with every Steel move"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      ctorOption: "type",
      path: "moveType",
      control: "select",
      label: "Only when my move is this type",
      editable: true,
      default: "FIGHTING",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The move must be a damaging move (status moves never break screens)",
    "Needs a target; the screens are removed from the TARGET's side, not from mine",
    "The type is the one my move really has when it is used (after any type change), and it never happens in a preview",
  ],
  effect: { id: "effect.package", params: ["type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a move of the type, one of another type, a status move",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "BITE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier C, justified in the header. Users: Warrior's Spear and (through the dispatcher, not the inventory) Qigong, whose attr carries an attr-level condition `holder.isOfType(FIGHTING)` set by `addCondition`; `recomposeAttr` copies that onto the rebuild, so it needs no binding. Nothing to bind: the class has no constructor closure and no gate. The screens of the TARGET's side are removed (`opponent.isPlayer() ? PLAYER : ENEMY`). Edge, NOT fixed: when the attacker hits its own ally in doubles, the screens of its OWN side are removed.",
});
