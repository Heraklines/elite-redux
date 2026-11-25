/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 3, Tier B calc-modifier. "While the game calculates the damage I take, IF the move deals damage AND the Pokemon
// using it is of type <type>, multiply it by <multiplier>."
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts, a subclass of ReceivedMoveDamageMultiplierAbAttr that builds its
// own constructor closure `(_target, attacker, move) => move.category !== STATUS && attacker.isOfType(attackerType)` and passes
// the multiplier on (showAbility false, affectsFixedDamage false). It is attacker-type based, NOT move-type based: a Water-type
// attacker's Normal move is reduced, a Fire move from a non-Water Pokemon is not.
//   canApply  inherited `this.condition(pokemon, attacker, move)` = the closure above (two pure reads, in this order):
//               1. the move is not a status move                         -> condition (library atom move.damaging)
//               2. attacker.isOfType(attackerType)                       -> condition (library atom mon.has-type, who: other)
//   apply     inherited `damage.value = toDmgValue(damage.value * multiplier)`. No random draw, no state.
// Tier B because the closure is built inside the constructor and is not an argument: the class got the gate/residual split
// (canApply = gatedCanApply, `gate` = the inherited rule moved verbatim, no guard and no residual) so the type rule becomes
// swappable blocks. `attackerType` is repeated in the gate binding, so it is listed in `gateParams`.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { AttackerTypeDamageReductionAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(AttackerTypeDamageReductionAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take less damage from attackers of one type",
  summary: params =>
    `Damaging moves used by a ${params.attackerType}-type Pokemon do damage multiplied by ${params.multiplier} to me. Example: Water and 0.5 means Water-type attackers do half damage.`,
  synonyms: [
    "resist attackers of a type",
    "half damage from water types",
    "damage reduction against a type of Pokemon",
    "bulky against one type",
    "type resistance by attacker",
    "marine apex",
    "king of the jungle",
  ],
  examples: [
    "Take half damage from moves used by Water-type Pokemon, like Marine Apex",
    "Take half damage from Grass-type attackers, like King of the Jungle",
  ],
  params: [
    {
      id: "attackerType",
      ctorIndex: 0,
      path: "attackerType",
      control: "select",
      label: "Type of the attacker (the Pokemon using the move, not the move's own type)",
      editable: true,
      default: "WATER",
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
      label: "Damage multiplier (0.5 = half damage, 1 = no change, 2 = double)",
      editable: true,
      gateIndependent: true,
      default: 0.5,
    },
  ],
  // The gate is all[move.damaging, mon.has-type {who: other, type}], in the class's own order (spelled out per user in bindings.ts).
  gateParams: [{ param: "attackerType", block: "mon.has-type", field: "type" }],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: ["Skipped when the attacker ignores my ability (Mold Breaker style)"],
  effect: { id: "effect.multiply-damage-taken", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a physical, a special and a Fire hit from a Water foe (the default foe is a Water-type Magikarp)",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package: every clause maps to a library atom. Users (2 attrs): Marine Apex (5127 attr 2, Water, x0.5) and King of the Jungle (5729 attr 2, Grass, x0.5). Binding: all[move.damaging, mon.has-type who other type]; `move.damaging` is `move.category !== STATUS` through matchesAbilityStudioMoveFilter and `mon.has-type` is `attacker.isOfType(type)`, the same calls as the closure, so L1 proves the equality over the grid (it varies the foe's types and every grid move). Class change (pure move, no behaviour change): gateOverride field, canApply = gatedCanApply, `gate` calls the inherited rule. Not part of this class: the ability-level flags of the two users. Different from ReceivedTypeDamageMultiplierAbAttr (B01): that class reads the type of the MOVE, this one the type of the POKEMON using it. No oddity found.",
});
