/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 2. "While the game decides the type of my move, IF <condition>, the move becomes <type>" (Aerilate, Pixilate,
// Normalize, Steelworker, Liquid Voice, ...).
//
// Source: src/data/abilities/ab-attrs.ts MoveTypeChangeAbAttr. Dispatched from Pokemon.getMoveType (pokemon.ts, with
// `opponent: this`, so the "target" argument of the closure is the user itself there) and from Move.calculateBattlePower
// (move.ts, simulated, with the real target). canApply: `this.condition(pokemon, opponent, move)`, the only clause.
// apply: `moveType.value = this.newType`.
// Constructor: (newType, condition). The condition is a PokemonAttackCondition `(user, target, move)`; all 27 attrs
// pass one. No random draw, no state. Tier A: the closure is the staff-editable IF and every user is bound
// individually in bindings.ts.
//
// IMPORTANT for the bindings: the atom move.type must be used with `effective: false` (the raw `move.type`). The
// default `effective: true` asks `moveUser.getMoveType(move)`, which dispatches THIS class again and would recurse.
import { MoveTypeChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(MoveTypeChangeAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-type",
  label: "Change the type of my moves",
  summary: params =>
    `My moves that pass the condition become ${params.type} type. Example: add the condition "the move is Normal type" and pick Flying to get Aerilate.`,
  synonyms: [
    "aerilate",
    "pixilate",
    "refrigerate",
    "galvanize",
    "normalize",
    "liquid voice",
    "convert moves",
    "change move type",
    "ate ability",
  ],
  examples: ["Normal moves become Flying type, like Aerilate", "All of my moves become Normal type, like Normalize"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "newType",
      control: "select",
      label: "Moves become this type",
      editable: true,
      default: "STEEL",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [{ slot: "ctor:1", ctx: "attack", path: "condition", removable: true, editable: true }],
  guards: [],
  feasibility: [],
  effect: { id: "effect.change-move-type", params: ["type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder attacks with a Normal move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A. 27 attrs. 14 closures are bound to library atoms, 13 stay legacy-closure pending request B02-14 (`anyTypeMoveConversionCondition`, init-abilities.ts:2380, needs a 'the move can have its type changed by an ability' atom: it tests noAbilityTypeOverrideMoves, the user's Terastallized state, Tera Blast and Tera Starstorm for Stellar Terapagos, none of which exist as atoms). Bound now: `(_u,_t,move) => !!move && move.type === NORMAL` = move.type NORMAL raw (12 attrs: Steelworker, Hydrate, Spectralize, Deviate, Stainless Steel x2, Waterborne x2, Mob Boss, Weighted Scales, Crude Steel, Solar Panel), and Two-Faced's two form-keyed closures (not in the hangry form and Normal / in the hangry form and Normal; formKey tested with mon.in-form). Legacy: Normalize (condition alone; the rule that moves whose type is fixed by the move itself, such as Weather Ball, Judgment, Multi Attack, Terrain Pulse, Natural Gift, Techno Blast, Hidden Power and Revelation Dance, are never changed lives in that closure only, not in the class, so it is described here and in B02-14, not as a safety rule of the block), Refrigerate, Pixilate x2, Aerilate, Galvanize, Atomic Burst, Fluttering Spirit, Thunder Gods Vessel, Malicious Empathy, Fae Heart (Normal AND convertible), Liquid Voice and Siren's Song (sound move AND Normal AND convertible; the sound test is the library atom move.flag but the convertible part is missing). Every user has a separate MovePowerBoostAbAttr that is another class (the 20% boost). Subclasses TypeConversionAbAttr and MoveTypeReplacementAbAttr (archetypes) are separate classes. The same Normal-to-X ability can appear several times (Pixilate 182 and 5954, Waterborne 5689 and 5955, Stainless Steel 5530 and 6003): different ids, same signature. Steelworker's attr was pushed by init-elite-redux-vanilla-rebalance.ts:1319 after the vanilla list, so its index is not the line order.",
});
