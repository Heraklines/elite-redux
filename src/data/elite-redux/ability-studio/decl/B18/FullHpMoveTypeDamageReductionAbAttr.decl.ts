/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 3, Tier B calc-modifier. "While the game calculates the damage I take, IF I am at full HP AND the move deals damage
// AND its type is <type>, multiply it by <multiplier>."
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts, a subclass of ReceivedMoveDamageMultiplierAbAttr that builds its own
// constructor closure `(target, attacker, move) => target.isFullHp() && move.category !== STATUS && attacker.getMoveType(move) === moveType`
// and passes the multiplier on (showAbility false, affectsFixedDamage false).
//   canApply  inherited `this.condition(pokemon, attacker, move)` = the closure above (three pure reads, in this order):
//               1. target.isFullHp()                                     -> condition (library atom hp.full, who: holder)
//               2. the move is not a status move                         -> condition (library atom move.damaging)
//               3. attacker.getMoveType(move) === moveType (the type AFTER ability changes such as Normalize or Pixilate)
//                                                                         -> condition (library atom move.type, effective: true)
//   apply     inherited `damage.value = toDmgValue(damage.value * multiplier)`. No random draw, no state.
// Tier B for the same reason as AttackerTypeDamageReductionAbAttr: the closure is built in the constructor, so the class got the
// gate/residual split (`gate` = the inherited rule moved verbatim) and `moveType` is repeated in the gate binding (gateParams).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { FullHpMoveTypeDamageReductionAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(FullHpMoveTypeDamageReductionAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take less damage from one move type while at full HP",
  summary: params =>
    `While I am at full HP, ${params.moveType}-type moves do damage multiplied by ${params.multiplier} to me. Example: Dragon and 0.5 means Dragon moves do half damage until I get hurt.`,
  synonyms: [
    "full hp resist",
    "half damage from a type at full health",
    "multiscale for one type",
    "resist dragon at full hp",
    "damage reduction at full hp",
    "drakelp head",
  ],
  examples: [
    "Take half damage from Dragon moves while at full HP, like Drakelp Head",
    "Take half damage from Ice moves while at full HP",
  ],
  params: [
    {
      id: "moveType",
      ctorIndex: 0,
      path: "moveType",
      control: "select",
      label: "Type of the incoming move",
      editable: true,
      default: "DRAGON",
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
  // The gate is all[hp.full holder, move.damaging, move.type {type, effective: true}], in the class's own order (see bindings.ts).
  gateParams: [{ param: "moveType", block: "move.type", field: "type" }],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: ["Skipped when the attacker ignores my ability (Mold Breaker style)"],
  effect: { id: "effect.multiply-damage-taken", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The full HP boundary (max and max - 1) against a Dragon move, a physical contact move and a Fire move. 1 HP is last
      // so L1 reaches it and the L2 battle (first six combinations) does not faint the holder.
      name: "full HP boundary against a Dragon, a physical and a Fire hit",
      axes: { hp: ["max", "max-1", 1], foeMove: ["DRAGON_BREATH", "TACKLE", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package: every clause maps to a library atom. User (1 attr): Drakelp Head (5690 attr 2, Dragon, x0.5). Binding: all[hp.full holder, move.damaging, move.type {type, effective true}] (`isFullHp()`, `category !== STATUS`, `attacker.getMoveType(move)`: the same calls as the closure). Class change (pure move, no behaviour change): gateOverride field, canApply = gatedCanApply, `gate` calls the inherited rule. Same shape as B01's ReceivedTypeDamageMultiplierAbAttr with the extra full HP test. No oddity found.",
});
