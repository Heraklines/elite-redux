/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 3. "My moves of one type are stronger while my HP is low" (Blaze, Torrent, Overgrow, Swarm, Lepidopteran).
//
// Source: src/data/abilities/ab-attrs.ts LowHpMoveTypePowerBoostAbAttr (extends MoveTypePowerBoostAbAttr). Dispatch of the power
// multiplication is the parent's (Move.calculateBattlePower). The low-HP rule is NOT part of canApply: the class overrides
// `getCondition()`, an attr-level holder condition that applySingleAbAttrs checks BEFORE canApply.
// Clauses, in order:
//   getCondition: `pokemon.getHpRatio() <= 0.33`, getHpRatio() rounds the ratio to two decimals     -> condition (ctor:2)
//   canApply:     parent's "the move's type after ability changes is the boosted type"             -> the `type` setting
//   apply:        parent's `power.value *= powerMultiplier`                                        -> effect
// Constructor: (boostedType). Refactor of this chunk (behaviour identical, spec 3.1): two trailing arguments with defaults,
// `powerMultiplier = 1.5` (the parent already used `|| 1.5`) and `lowHpCondition` (default `getHpRatio() <= 0.33`, the old
// getCondition body); `getCondition()` returns it. The `skipDuringMovesetGen = true` field is kept; the parent MovePowerBoostAbAttr
// overrides canApply without calling super, so the field is never read (see notes).
// No random draw, no state. Tier A.
import { LowHpMoveTypePowerBoostAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { boostedTypeCodec } from "#data/elite-redux/ability-studio/decl/B02/boosted-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";

export default defineDecl(LowHpMoveTypePowerBoostAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost my moves of one type while my HP is low",
  summary: params =>
    `While my HP is about a third or less (33% rounded), my ${params.type}-type moves have their base power multiplied by ${params.multiplier}. Example: Fire at 1.5, like Blaze.`,
  synonyms: [
    "blaze",
    "torrent",
    "overgrow",
    "swarm",
    "pinch boost",
    "low hp boost",
    "when almost fainted",
    "desperation boost",
  ],
  examples: ["Make Fire moves 50% stronger while my HP is low, like Blaze", "Make Water moves 50% stronger in a pinch, like Torrent"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "condition",
      control: "select",
      label: "Move type that is boosted",
      editable: true,
      default: "FIRE",
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
      step: 0.05,
      label: "Power multiplier (1.5 = 50% more power)",
      editable: true,
      default: 1.5,
    },
  ],
  conditions: [{ slot: "ctor:2", ctx: "holder", path: "lowHpCondition", removable: true, editable: true }],
  guards: [],
  feasibility: ["Moves that deal a fixed amount of damage are not changed"],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared reach table (decomp-l2-reach.json) lists calc.move-power as unreached, although the original's attrs ARE evaluated in the shared scenario (the run shows no attr-not-evaluated problem for this class and every twin trace is identical): the engine dispatches the moment under the key VariableMovePowerAbAttr. Request B02-37 asks B20 to move the trigger to reached. B02/power-boost.test.ts proves the closures over a wide move list.",
  probes: [
    {
      // 0.33 is tested on the ratio ROUNDED to two decimals: 33.4% still counts as low, 33.5% does not.
      name: "my attack around the 33% line",
      axes: { hp: ["33%", "33%+1", "34%", "32%", "max", 1] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, 5 attrs (Overgrow, Blaze, Torrent, Swarm, Lepidopteran), each next to a MoveTypePowerBoostAbAttr copy (1.2x with the opposite HP condition added by addCondition). The low-HP test `pokemon.getHpRatio() <= 0.33` is NOT the library atom hp.at-most: getHpRatio() rounds hp/maxHp to two decimals (Math.round(ratio * 100) / 100), so 33.4% counts as low and 33.5% does not, while hp.at-most (hp * 100 <= maxHp * pct) would say no at 33.4%. All five closures are therefore legacy-closure pending request B02-21 (an HP atom with the two-decimal rounding of getHpRatio). `getCondition()` is the class's own attr-level condition: it ignores any condition added with addCondition. Suspected game oddity (not fixed): `skipDuringMovesetGen = true` is never read because MovePowerBoostAbAttr.canApply does not call super. The type is the `type` setting (the move.type atom with effective = true).",
});
