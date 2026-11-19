/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 3. "While I am on the field, every Pokemon's moves of one type are stronger" (Dark Aura, Fairy Aura, Aura Break, Pixie Power).
//
// Source: src/data/abilities/ab-attrs.ts FieldMoveTypePowerBoostAbAttr (extends PreAttackFieldMoveTypePowerBoostAbAttr extends
// FieldMovePowerBoostAbAttr; no body of its own). It is NOT dispatched with applyAbAttrs. Move.calculateBattlePower
// (src/data/moves/move.ts:1363) scans EVERY Pokemon on the field with `p.getAbilityAttrs("FieldMoveTypePowerBoostAbAttr")`,
// keeps an attr when `!attr.getCondition() || attr.getCondition()(p)` (the attr-level condition, e.g. Aura Break's "a Dark Aura or
// Fairy Aura is on the field"), collects them in a Set and calls `aura.apply({ pokemon: source, simulated, opponent: target, move, power })`
// for each. So the attr sits on the aura's owner, but its closure is asked about the MOVE USER (`pokemon` is the source).
// Clauses, in order:
//   attr condition (getCondition): the engine skips the attr when it fails              -> attr-level, carried by addCondition
//   canApply: always true (the class comment says the logic lives in move.ts)           -> nothing
//   apply: `if (condition(pokemon, opponent, move)) power.value *= powerMultiplier`      -> the type test is the `type` setting
// Constructor (parent): (boostedType, powerMultiplier?) = `powerMultiplier || 1.5`. 
// The class is not touched: the live value is read back by asking the closure (boosted-codecs.ts), because a new instance field would change the configuration snapshot that the frozen fingerprints of the saved abilities guard.
// No random draw, no state. Tier A. The WHEN calc.move-power is the same moment (the move's power is being calculated); the
// class is not one of its dispatch keys yet: request B02-19.
import { FieldMoveTypePowerBoostAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { boostedTypeCodec } from "#data/elite-redux/ability-studio/decl/B02/boosted-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";

export default defineDecl(FieldMoveTypePowerBoostAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Multiply one move type's power for everyone on the field",
  summary: params =>
    `While I am on the field, ${params.type}-type moves used by any Pokemon (mine, my ally's and the foes') have their base power multiplied by ${params.multiplier}. Example: Dark at 1.33, like Dark Aura.`,
  synonyms: [
    "dark aura",
    "fairy aura",
    "aura break",
    "aura",
    "boost for everyone",
    "field boost",
    "weaken a type",
    "pixie power",
  ],
  examples: [
    "Make every Dark move on the field 33% stronger, like Dark Aura",
    "Make every Fairy move on the field weaker, like Aura Break next to a Fairy Aura",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "condition",
      control: "select",
      label: "Move type that is boosted",
      editable: true,
      default: "DARK",
      options: TYPE_OPTIONS,
      codec: boostedTypeCodec,
    },
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "powerMultiplier",
      control: "number",
      min: 0.05,
      max: 10,
      step: 0.01,
      label: "Power multiplier (1.33 = 33% more power, 0.75 = a quarter less)",
      editable: true,
      default: 1.33,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Affects every Pokemon on the field, not only me",
    "Does nothing while the move user's own ability is being ignored",
  ],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The engine reads this class with getAbilityAttrs inside the power calculation, never with applyAbAttrs, so no trace event shows it evaluated and the shared twin cannot prove it ran. B02/power-boost.test.ts drives the original and the rebuilt attr of every user through the same apply call and compares the power.",
  probes: [{ name: "any move of the boosted type used next to the aura", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 10 attrs: Dark Aura (186 attr 1), Fairy Aura (187 attr 1), Aura Break (188 attrs 0 and 1: 0.5625 = 0.75 squared, each with an attr-level condition that the matching aura is on the field), Pixie Power, Nihil Blaster (attrs 0 and 1, same two Aura Break copies), Pure Good, Dreadful Winds and Fairy Wings. Nothing to bind: the constructor takes the type, not a closure. The attr-level conditions of Aura Break and Nihil Blaster call abilityQuery and are carried by addCondition. Note for readers of the frame: the closure is asked about the move USER, not about the ability owner. Aura Break works as a second, smaller multiplier on top of the aura it is paired with (1.3333 x 0.5625 = 0.75), because the engine multiplies every matching attr.",
});
