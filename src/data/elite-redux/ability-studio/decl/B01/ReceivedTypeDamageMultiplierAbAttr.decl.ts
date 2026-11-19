/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01, Tier A calc-modifier (the condition is a constructor field). See ../PRECEDENTS.md.
//
// "While the game calculates the damage I take, if the move's type is <type>, multiply it by <multiplier>." The class
// is a subclass of ReceivedMoveDamageMultiplierAbAttr that builds the condition closure itself:
//   `super((_target, user, move) => user.getMoveType(move) === moveType, damageMultiplier, false)`
// so it has NO closure argument to bind. The type test is a rule fixed by the `type` param (the library atom
// move.type with effective=true calls the same `user.getMoveType(move)`, which is what a composed rule would use).
// Clauses: `canApply` is the inherited `this.condition(pokemon, attacker, move)` (the type test above, no random draw,
// no side effect); `apply` is the inherited `damage.value = toDmgValue(damage.value * damageMultiplier)`.
// The class gained one read-only field, `moveType`, that records the constructor argument; without it a live instance
// could not tell the declaration which type it reacts to (the closure hides it). No behaviour changes.
// Attr-level conditions that some users carry (Steelworker, Seaweed, Weighted Scales, ...: "only if I am Steel type")
// are not constructor arguments; `recomposeAttr` carries them over unchanged.
import { ReceivedTypeDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(ReceivedTypeDamageMultiplierAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take less (or more) damage from one type of move",
  summary: params =>
    `Damage from ${params.type}-type moves is multiplied by ${params.multiplier}. Example: 0.5 means half damage, 2 means double.`,
  synonyms: [
    "resist a type",
    "type resistance",
    "heatproof",
    "thick fat",
    "half damage from fire",
    "weakness to a type",
  ],
  examples: ["Take half damage from Fire moves, like Heatproof", "Take double damage from Fire moves"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "moveType",
      control: "select",
      label: "Type of the incoming move",
      editable: true,
      default: "FIRE",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "damageMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Damage multiplier (0.5 = half, 2 = double)",
      editable: true,
      default: 0.5,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["Ignored when the attacker's move ignores abilities (Mold Breaker style)"],
  effect: { id: "effect.multiply-damage-taken", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "one move of each type the users react to",
      axes: { foeMove: ["EMBER", "BITE", "ICE_SHARD", "POISON_STING", "METAL_CLAW", "TACKLE"] },
    },
    { name: "a Fairy move and a Normal move", axes: { foeMove: ["FAIRY_WIND", "TACKLE"] } },
  ],
  status: "decomposed",
  notes:
    "Users (42 attrs): the ER type resist and weakness abilities. Types in use: Fire, Water, Ice, Poison, Ghost, Steel, Dark and Fairy; multipliers 0.5, 0.7, 0.75, 1, 1.25, 2 and 4 (Fluffiest). Several abilities carry two or three of these (Thick Fat, Nocturnal, Stainless Steel). Prankster has a Dark x1.0 attr (a no-op kept as is). Some users are created by the archetype dispatcher and the vanilla rebalance (ab.attrs.push) and some carry an attr-level `.addCondition(p => p.isOfType(STEEL))`. The class was edited only to add the read-only `moveType` field, see the header. Proof that the type test equals the library atom: test/tests/elite-redux/decomp/B01/type-multiplier-library.test.ts compares all 42 live attrs with ReceivedMoveDamageMultiplierAbAttr + move.type over 20 moves (840 comparisons), so staff can also build this rule from the plain blocks. Different from ReceivedMoveDamageMultiplierAbAttr (precedent): there the closure is an argument and is bound per user; here the type is the only thing that differs.",
});
