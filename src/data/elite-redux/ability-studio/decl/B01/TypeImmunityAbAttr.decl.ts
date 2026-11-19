/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 2, Tier A calc-modifier (an immunity with an OPTIONAL constructor closure). Copy of the AttackTypeImmunity
// precedent, but this class is the BASE of the whole family and it differs in one visible way: it has no filter for
// status moves, so a status move of the chosen type is blocked too (AttackTypeImmunityAbAttr adds that filter, and
// the Thousand Arrows exception).
//
// "While the game checks whether a move can hit me, IF <condition>, I am immune to <type> moves."
// The old `canApply` has four clauses, all pure, in this order (ab-attrs.ts `TypeImmunityAbAttr.canApply`):
//   1. the move does not target a whole side or both sides (BOTH_SIDES, ENEMY_SIDE, USER_SIDE)  = feasibility
//   2. `attacker !== pokemon`                                                                   = feasibility
//   3. `immuneType !== null`                                                                    = feasibility (the type setting exists)
//   4. `getTriggeredMoveTypes(...).has(immuneType)`                                             = the type setting itself
// Nothing here is a design condition that staff would swap, so the class needs no Tier B split: the only swappable
// condition is the optional constructor closure (slot ctor:1, `getCondition()` returns it to the ability engine).
// `apply` sets `typeMultiplier.value = 0`.
import { TypeImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(TypeImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Block every move of one type, status moves too",
  summary: params =>
    `Moves of the ${params.type} type do nothing to this Pokemon, status moves included. Example: Water blocks Water Gun and also a Water-type status move.`,
  synonyms: [
    "type immunity",
    "immune to a type",
    "no effect from a type",
    "block a type",
    "low tide",
    "immune to status moves of a type",
  ],
  examples: ["Immune to every Water move, even Water-type status moves"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "immuneType",
      control: "select",
      label: "Immune to this type",
      editable: true,
      default: "WATER",
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
    "Moves that hit every Pokemon or a whole side (Spikes, Rain Dance) are never blocked",
    "A Pokemon never blocks its own move",
    "Moves that count as another type for this Pokemon's other abilities are blocked as well",
  ],
  effect: { id: "effect.immune-to-type", params: ["type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a Water move, a neutral move and a Water status move",
      axes: { foeMove: ["WATER_GUN", "TACKLE", "SOAK"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (1 attr): Low Tide (id 6071, attr 1, Water, no closure). Difference to AttackTypeImmunityAbAttr (precedent): no status-move filter and no Thousand Arrows exception, so a Water STATUS move is blocked too. The library effect effect.immune-to-type carries the Levitate feasibility text 'does not block status moves', which does NOT hold for this block; this declaration's own summary and feasibility say what really happens (see requests/B01.md, R-B01-9). All subclasses (Heal, StatStageChange, AddBattlerTag, NonSuperEffective and the ER archetypes) inherit canApply from here, so they share clauses 1 to 4. Engine reads: battler-tags.ts:4555 asks `getAbilityAttrs('TypeImmunityAbAttr').some(a => a.getImmuneType() === WATER)` for a Water-immunity check; that read goes through getImmuneType() and is only reproduced by an attr built from this class family.",
});
