/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 3, Tier B calc-modifier. "While the game calculates the power of a move I use, IF the move's type is <type> AND I am
// NOT of that type, multiply its power by <bonus>."
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts, a subclass of MovePowerBoostAbAttr (constructor `(type, fallbackMultiplier
// = 1.2)`, it passes the closure `(pokemon, _target, move) => pokemon.getMoveType(move) === type` and a multiplier of 1 to the parent).
// A holder that HAS the type already gets the normal same-type bonus (STAB) from the game, so the class adds nothing for it.
//   canApply  (before) inherited `this.condition(pokemon, opponent, move)`: the move's type (after ability changes) is `type`.
//   apply     (before) `if (!pokemon.isOfType(type)) power.value *= fallbackMultiplier`, otherwise nothing.
// The "I am not of that type" test was an `if` inside `apply`, which is a hidden condition. `apply` only runs after `canApply`
// passed, so moving the test into `canApply` (the gate) gives exactly the same result and makes it a separate, swappable block.
// Now: gate = [move.type {type, effective true}, not mon.has-type {holder, type}], in that order; apply = `power *= fallbackMultiplier`.
// No guard, no residual, no random draw, no state. `type` is repeated in two gate atoms, so it has two gateParams entries.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { SameTypeStabOtherwiseBoostAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(SameTypeStabOtherwiseBoostAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost moves of a type I do not have",
  summary: params =>
    `${params.type}-type moves I use get their power multiplied by ${params.fallbackMultiplier} while I am not ${params.type}-type myself. Example: Rock and 1.2 gives +20% power.`,
  synonyms: [
    "off type bonus",
    "fake same type bonus",
    "boost a type I am not",
    "stab for another type",
    "fossilized",
    "raw wood",
    "power up moves of a type",
  ],
  examples: [
    "Boost Rock moves by 20% when I am not a Rock type, like Fossilized",
    "Boost Grass moves by 20% on a Pokemon that is not a Grass type, like Raw Wood",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "type",
      control: "select",
      label: "Type of the move that gets the bonus",
      editable: true,
      default: "ROCK",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "fallbackMultiplier",
      ctorIndex: 1,
      path: "fallbackMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.2 = +20% power, 1.5 = +50%)",
      editable: true,
      gateIndependent: true,
      default: 1.2,
    },
  ],
  // The gate is all[move.type {type}, not mon.has-type {holder, type}]: the type appears in both atoms.
  gateParams: [
    { param: "type", block: "move.type", field: "type" },
    { param: "type", block: "mon.has-type", field: "type" },
  ],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-power", params: ["fallbackMultiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The engine dispatches the power calculation under the base key VariableMovePowerAbAttr (move.ts:1338 and :1509), but the L2 reach check looks for the key MovePowerBoostAbAttr, so every power-boost class shows as unreached; the class is verified by driving a real battle's power calculation in B18/chunk3.test.ts and by the L1 gate differential.",
  probes: [
    {
      name: "a move of the boosted type and moves of other types",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package. Users (2 attrs): Fossilized (5041 attr 0, Rock, x1.2) and Raw Wood (5075 attr 0, Grass, x1.2); both also carry a damage-reduction attr that is another class. Binding: all[move.type {type, effective true}, not mon.has-type {holder, type}]; `move.type` is `holder.getMoveType(move)` (the moveUser of calc.move-power is the holder) and `mon.has-type` is `holder.isOfType(type)`. Class change (not a pure move of canApply only: the old `apply` held an `if (!pokemon.isOfType(type))`; it is now the second gate clause and `apply` multiplies unconditionally; apply only runs after canApply passed and nothing else calls it, so every multiplication happens in exactly the same situations; clause order is unchanged, all reads are pure). The parent multiplier stays 1 (the class never passes the bonus up), so `getPowerMultiplier()` still returns 1. The two replaced TypeDamageBoostAbAttr (1.5) attrs of the original abilities are not part of this class. The default grid has no Rock or Grass holder, so B18/chunk3.test.ts compares the class gate with the library gate for every holder type. Oddity, not fixed: the class doc says 'gives natural STAB', but the class does nothing for a holder that has the type; the normal STAB is the game's own.",
});
