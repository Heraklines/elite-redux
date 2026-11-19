/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
// B09 chunk 2. "My moves with one property have their power multiplied" (Keen Edge, Striker, Iron Fist style abilities and
// ~50 Elite Redux abilities: Archer, Mighty Horn, Giant Wings, Samba, Megabite ...).
//
// Source: src/data/elite-redux/archetypes/flag-damage-boost.ts, class FlagDamageBoostAbAttr (extends MovePowerBoostAbAttr,
// which extends VariableMovePowerAbAttr). Dispatched from Move.calculateBattlePower (`applyAbAttrs("VariableMovePowerAbAttr")`).
// The constructor builds the closure itself and hands it to the parent:
//   `(pokemon, defender, move) => move.doesFlagEffectApply({ flag, user: pokemon, target: defender ?? undefined })`
// Clauses, in order:
//   canApply: the parent's `condition(...)`, i.e. the move has the property (doesFlagEffectApply, so flags that other abilities
//             inject and the contact rules count)  -> the `flag` setting IS this condition (library atom move.flag, same call)
//   apply:    `power.value *= resolveMultiplier(pokemon.getHpRatio(true))`: the multiplier, or the low-HP multiplier when one is
//             set and the holder's HP ratio is STRICTLY below the threshold                                      -> effect
// Constructor: ({ flag, multiplier, lowHpMultiplier?, lowHpThreshold? }), one options object; throws for a multiplier <= 0
// or a low-HP multiplier <= 0 or no flag. Nobody uses the low-HP pair today (lowHpMultiplier is null for all 59 attrs); it is
// still a real behaviour of the class, so it is a setting (0 = no low-HP change, the default). No random draw, no state.
// Tier A: nothing to bind because the constructor takes the property, not a closure (same shape as the type booster).
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { MoveFlags } from "#enums/move-flags";

/** lowHpMultiplier: null on the instance means "no low-HP change", shown as 0; 0 builds an instance without one. */
const lowHpMultiplierCodec: ParamCodec = {
  toCtor: value => (Number(value) > 0 ? Number(value) : undefined),
  fromInstance: raw => (raw === null || raw === undefined ? 0 : typeof raw === "number" ? raw : undefined),
};

export default defineDecl(FlagDamageBoostAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost the power of my moves with one property",
  summary: params =>
    `My moves with the property "${params.flag}" have their power multiplied by ${params.multiplier} (1.3 = 30% stronger)${Number(params.lowHpMultiplier) > 0 ? `, or by ${params.lowHpMultiplier} while my HP is below ${Math.round(Number(params.lowHpThreshold) * 100)}%` : ""}.`,
  synonyms: [
    "iron fist",
    "strong jaw",
    "mega launcher",
    "keen edge",
    "punching boost",
    "biting boost",
    "slicing boost",
    "kicking boost",
    "sound boost",
    "horn boost",
    "wing boost",
    "boost one kind of move",
  ],
  examples: [
    "Boost slicing moves by 30%, like Keen Edge",
    "Boost punching moves by 30%, like Iron Fist",
    "Boost sound moves by 30%, like Amplifier",
  ],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "flag",
      control: "select",
      label: "Move property that is boosted",
      editable: true,
      default: "SLICING_MOVE",
      options: MOVE_FLAG_OPTIONS,
      codec: enumCodec(MoveFlags, "move property"),
    },
    {
      id: "multiplier",
      ctorIndex: 0,
      ctorOption: "multiplier",
      path: "highHpMultiplier",
      control: "number",
      min: 0.05,
      max: 10,
      step: 0.05,
      label: "Power multiplier (1.3 = 30% more power)",
      editable: true,
      default: 1.3,
    },
    {
      id: "lowHpMultiplier",
      ctorIndex: 0,
      ctorOption: "lowHpMultiplier",
      path: "lowHpMultiplier",
      control: "number",
      min: 0,
      max: 10,
      step: 0.05,
      label: "Power multiplier while my HP is low (0 = no change)",
      editable: true,
      default: 0,
      codec: lowHpMultiplierCodec,
    },
    {
      id: "lowHpThreshold",
      ctorIndex: 0,
      ctorOption: "lowHpThreshold",
      path: "lowHpThreshold",
      control: "slider",
      min: 0.01,
      max: 0.99,
      step: 0.01,
      label: "Low HP line (0.33 = below a third of max HP)",
      editable: true,
      default: 1 / 3,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["Moves that deal a fixed amount of damage are not changed"],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared reach table (decomp-l2-reach.json) lists calc.move-power as unreached, although the engine dispatches the moment under the key VariableMovePowerAbAttr. The attrs of this class are proven by the L1 attr differential over the state grid (canApply and the value apply leaves behind) and by B09/flag-damage-boost.test.ts (every user, every flag, with and without a low-HP pair).",
  probes: [
    {
      name: "my attack at several HP values against foes that use different move types",
      axes: { hp: ["max", "max-1", "33%+1", "33%-1", 1], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, 59 attrs in 50 abilities, none needs a binding (the constructor takes the property, not a closure). The flag test is the `flag` setting, the same engine call as the library atom move.flag (doesFlagEffectApply with the holder as user). All 59 live attrs have lowHpMultiplier null and lowHpThreshold 1/3; the low-HP pair is a real, tested behaviour that no ability uses yet, exposed as two settings (0 = off). `resolveMultiplier` uses getHpRatio(true) with a strict `<`, so exactly one third does not count as low; the threshold setting keeps the exact double (no percent rounding) so a rebuild is bit-identical. Constructor throws for a multiplier <= 0, a low-HP multiplier <= 0 or flag NONE; the multiplier setting starts at 0.05. Oddities, not fixed: (a) the doc comment says 'Strong Jaw also flinches composes via CompositeAbAttr' and 'Giant Wings ... wire as multi-instance', both true today (Combat Specialist, Blade's Essence, Spiritual Saber and others carry two instances); (b) MovePowerBoostAbAttr.canApply does not call super, so skipDuringMovesetGen is dead here too; (c) the apply multiplies power.value with no rounding. Subclass relations: this class extends MovePowerBoostAbAttr (B02) and has its own declaration.",
});
