/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 3. "My moves of one type have their power multiplied" (Transistor, Water Bubble, Dragon's Maw, Rocky Payload ...).
//
// Source: src/data/abilities/ab-attrs.ts MoveTypePowerBoostAbAttr (extends MovePowerBoostAbAttr). Same dispatch as its
// parent (Move.calculateBattlePower, `applyAbAttrs("VariableMovePowerAbAttr", ...)`). The constructor builds the closure
// itself: `super((pokemon, _defender, move) => pokemon?.getMoveType(move) === boostedType, powerMultiplier || 1.5, false)`.
// Clauses, in order:
//   canApply: parent's `condition(pokemon, opponent, move)`, i.e. "the move's type after ability changes is the boosted type"
//             -> the `type` setting is that condition (it is the move.type atom with effective = true)
//   apply:    parent's `power.value *= powerMultiplier`                                           -> effect
// Constructor: (boostedType, powerMultiplier?, skipDuringMovesetGen?). `powerMultiplier || 1.5`, so 0 would silently become 1.5
// (the setting starts above 0). `skipDuringMovesetGen` is false for all 21 live users (vanilla Sand Force passes true, but the Elite Redux Sand Force replaces it and is not a user)
// (init-abilities.ts SAND_FORCE: `.attr(MoveTypePowerBoostAbAttr, ROCK/GROUND/STEEL, 1.3, true)`). It is read back from the
// instance field through a hidden (not editable) setting so a rebuild keeps it. Today the field is dead (the parent canApply
// that reads it is overridden by MovePowerBoostAbAttr.canApply without a super call), but it must survive a rebuild. The class is not touched; the live value is read back by asking the closure (boosted-codecs.ts) because a new instance field would change the configuration snapshot that the frozen fingerprints of the saved abilities guard.
// No random draw, no state. Tier A. Extra attr-level conditions (Blaze's "HP above 33%" on the 1.2x copy) are carried by
// `addCondition` and rebuilt with the attr.
import { MoveTypePowerBoostAbAttr } from "#abilities/ab-attrs";
import { boostedTypeCodec } from "#data/elite-redux/ability-studio/decl/B02/boosted-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";

export default defineDecl(MoveTypePowerBoostAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Multiply the power of my moves of one type",
  summary: params =>
    `My ${params.type}-type moves have their base power multiplied by ${params.multiplier}. Example: Electric at 1.5 = 50% stronger Electric moves, like Transistor.`,
  synonyms: [
    "transistor",
    "water bubble",
    "dragon's maw",
    "rocky payload",
    "type boost",
    "boost fire moves",
    "boost water moves",
    "elemental boost",
    "stronger electric moves",
  ],
  examples: [
    "Make Electric moves 50% stronger, like Transistor",
    "Make Water moves twice as strong, like Water Bubble",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "condition",
      control: "select",
      label: "Move type that is boosted",
      editable: true,
      default: "ELECTRIC",
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
    {
      id: "skipDuringMovesetGen",
      ctorIndex: 2,
      path: "skipDuringMovesetGen",
      control: "boolean",
      label: "Skip this boost while the game builds opponent move sets (not used by the battle today)",
      // Not editable: only the vanilla Sand Force (replaced in Elite Redux, so no live user) passes true, and the game never reads it for this class today. It is a setting so that a
      // rebuilt attr keeps its value and a future fix of the game cannot make original and rebuild differ.
      editable: false,
      default: false,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["Moves that deal a fixed amount of damage are not changed"],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared reach table (decomp-l2-reach.json) lists calc.move-power as unreached, although the original's attrs ARE evaluated in the shared scenario (the run shows no attr-not-evaluated problem for this class and every twin trace is identical): the engine dispatches the moment under the key VariableMovePowerAbAttr. Request B02-37 asks B20 to move the trigger to reached. B02/power-boost.test.ts proves the closures over a wide move list.",
  probes: [
    { name: "my attack against a foe that uses different move types", axes: { foeMove: ["TACKLE", "WATER_GUN"] } },
  ],
  status: "decomposed",
  notes:
    "Tier A, 21 attrs (skipDuringMovesetGen is false on all 21 live attrs, read back by the hidden setting; the vanilla Sand Force passes true but Elite Redux replaces that ability, so none of the 21 is a Sand Force attr); nothing to bind because the constructor takes the type, not a closure (the type test is the `type` setting, the same rule as the move.type atom with effective = true, which is exactly `user.getMoveType(move) === type`). The free-form version of this rule is MovePowerBoostAbAttr with a move.type binding. 'Blaze' style abilities carry a second copy of this class (1.2x) with an attr-level HP condition (`getHpRatio() > .33`, set with addCondition); recomposeAttr carries it over. Lepidopteran, Blaze, Overgrow, Swarm and Torrent also have a LowHpMoveTypePowerBoostAbAttr (another declaration). Several users sit at different attr indices in several ids (Dirty Snowball, Earthbound, Vengeance, Vengeful Spirit, Rocky Payload each also have a MovePowerBoostAbAttr). `powerMultiplier || 1.5` means a multiplier of exactly 0 cannot be built (it becomes 1.5); the setting starts at 0.05.",
});
