/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 3. PARKED until the librarian adds this class to the `flagKeys` of the WHEN `while.active` (request R-B14-3.1, same
// shape as R-B14-2.3 and R-B12-13); then rename this file to SeaSpecterAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "While I have it, two move types count as each other for my abilities' type checks" (Sea Specter: Ghost and Water).
//
// Source: fakemon-pitch-mechanics.ts SeaSpecterAbAttr (extends AbAttr directly, `super(false)`). It has one method,
// `getTriggeredMoveTypes(move)`: the move's printed type `move.type` maps to a pair: first -> [first, second], second ->
// [second, first], anything else -> [move.type]. Nothing dispatches the class. The engine finds it by DUCK TYPING on the
// holder's active attrs (`"getTriggeredMoveTypes" in attr`):
//   ab-attrs.ts getTriggeredMoveTypes(holder, attacker, move)  starts from `attacker.getMoveType(move)` and adds every type any
//                                                              active attr of the holder returns; used by TypeImmunityAbAttr
//                                                              (immune to a type) and the redirect-by-type attr (draw in moves)
//   archetypes/post-attack-scripted-move.ts                    the same union (starting from `move.type`) for the `typeFilter`
//                                                              of follow-up moves after my own attack
// No constructor closure, no random draw, no state, no `simulated` test.
// The two types were literals (Ghost, Water); they are now constructor arguments 0 and 1 with the same defaults and editable
// params. getTriggeredMoveTypes keeps its exact shape for the defaults.
import { SeaSpecterAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(SeaSpecterAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Let two move types count as each other",
  summary: params =>
    `While I have this, a ${params.firstType} move also counts as ${params.secondType}, and the other way round, for my type-based abilities. Example: a Ghost move also triggers a Water absorb.`,
  synonyms: [
    "sea specter",
    "ghost and water",
    "type counts as",
    "also counts as",
    "type equivalence",
    "dual type moves",
    "water ghost",
  ],
  examples: ["Ghost and Water moves both set off my Water immunity and my Water follow-up"],
  params: [
    {
      id: "firstType",
      ctorIndex: 0,
      path: "firstType",
      control: "select",
      label: "First type of the pair",
      editable: true,
      default: "GHOST",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "secondType",
      ctorIndex: 1,
      path: "secondType",
      control: "select",
      label: "Second type of the pair",
      editable: true,
      default: "WATER",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only abilities that look at a move's type notice it (a type immunity, drawing in moves of a type, a follow-up move after a type of move)",
    "It reads the move's printed type, so a move whose type another ability changed is judged by its new type plus this pair",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "A duck-typed query has no dispatch moment (no trace event), so the twin only compares the whole battle: a Ghost move and a Water move hit the holder and the battles must match.",
  probes: [{ name: "a Ghost move and a Water move hit the holder", axes: { foeMove: ["SHADOW_BALL", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C. Users (1): Sea Specter (6072) attr 0 (its only attr; showAbility false). The class has a unit test that calls getTriggeredMoveTypes directly (fakemon-pitch-expansion-abilities.test.ts). The two types were literals, now constructor arguments (defaults Ghost and Water) and editable params. Oddities, not fixed: the holder's OWN Water-type abilities see Ghost moves as Water, so a Pokemon with Sea Specter and a Water immunity is immune to Ghost moves too, which is the ability text; the pair is symmetric and a pair of the same type twice is harmless. The ability has no other attr, so the holder's own type checks only matter when another ability or innate on the same Pokemon looks at move types.",
});
