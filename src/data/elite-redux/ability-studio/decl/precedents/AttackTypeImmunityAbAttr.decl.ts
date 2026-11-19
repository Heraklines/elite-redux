/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT: calc-modifier whose effect is an immunity, with an OPTIONAL constructor closure (Tier A).
// See ../PRECEDENTS.md. This is the "immune to Ground" golden recipe.
//
// "While the game checks whether a move can hit me, IF <condition>, I am immune to <type> moves". Most users pass
// only the type (Hover, Dragonfly, Gifted Mind, ...). Levitate-style users also pass a closure
// ("not grounded by a tag and Gravity is not active"), which is bound in bindings.ts. A user without a closure
// needs no binding: the slot is `optional`.
import { AttackTypeImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(AttackTypeImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Be immune to one type of attack",
  summary: params => `Immune to ${params.type} moves`,
  synonyms: ["immunity", "levitate", "ground immune", "no damage from a type", "type immunity", "float"],
  examples: ["Immune to Ground moves", "Immune to Dark moves"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "immuneType",
      control: "select",
      label: "Immune to this type",
      editable: true,
      default: "GROUND",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [
    // Optional AbAttrCondition `(pokemon) => boolean`; the field is null for users that pass none.
    { slot: "ctor:1", ctx: "holder", path: "condition", removable: true, editable: true, optional: true },
  ],
  guards: [],
  feasibility: [
    "Status moves and moves that treat Flying types neutrally (Thousand Arrows) are never blocked",
    "Moves that hit every Pokemon or a whole side (Spikes, Rain Dance) are never blocked",
    "A Pokemon never blocks its own move",
  ],
  effect: { id: "effect.immune-to-type", params: ["type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a move of the type, a neutral move, a Dark and a Ghost move",
      axes: { foeMove: ["EARTHQUAKE", "TACKLE", "BITE", "SHADOW_BALL"] },
    },
  ],
  status: "verified",
  notes:
    "Precedent for an optional constructor closure. Levitate, Aerialist, Imposing Wings, Spectacle and Free Spirit pass the grounded/Gravity closure (bound as not(tag IGNORE_FLYING) and not(gravity)); the other 12 abilities pass none. The engine ALSO asks `hasAbility(LEVITATE)` in Pokemon.isGrounded and a few move conditions: that identity check is an engine-query and is not reproduced by a rebuilt attr (see FloatAbAttr). Subclasses TypeImmunityHealAbAttr / NonSuperEffectiveImmunityAbAttr are separate classes.",
});
