/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 4 / calc-modifier (Tier A: the weather test is one constructor closure).
//
// Read by hand from archetypes/self-highest-stat-multiplier.ts. It extends StatMultiplierAbAttr, so the trigger is "while the game
// calculates one of my stats" (dispatch key StatMultiplierAbAttr, from Pokemon.getEffectiveStat, once per stat per calculation).
// Constructor `(opts = { candidates, multiplier, weathers? }, condition?)`; `super(candidates[0], multiplier)` (a placeholder stat:
// the parent's own stat test is called but its answer is thrown away) with showAbility false. The constructor THROWS for an empty
// candidate list and for a multiplier that is not above 0. `condition(holder)` is handed in at constructor argument 1 (slot ctor:1,
// field `activeCondition`); its DEFAULT is the weather list test built from `opts.weathers`.
//   canApply, in the ORIGINAL order:
//     0. `super.canApply(params)`: pure (stat === placeholder && no condition), its answer is ignored          (dead call, kept)
//     1. `weathers` set AND (no weather OR the active weather is not in the list)  -> false   (CONDITION: ctor:1, raw `arena.weather?.weatherType`)
//     2. the stat being calculated is not one of the candidates                      -> false   (part of the effect: WHICH stat)
//     3. the stat is not the candidate with the highest `getStat(stat, false)` (strict `>`, a tie goes to the one listed first) -> false  (part of the effect)
//   apply: `statVal.value *= multiplier`. No random draw, and `simulated` is not looked at (a stat calculation is a pure read).
//
// The weather test is a real condition and is now one condition block (slot ctor:1) that staff can swap or extend (any weather, a
// status, HP and so on). "Only the highest of these stats" is WHICH stat the effect multiplies, so it stays with the effect: the
// library has no block "multiply my highest stat of a list" (request R-B11-C4-01 in requests/B11.md), hence one piece with typed
// settings (the stat list and the multiplier).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SelfHighestStatMultiplierAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-multiplier";
import { STAT_SET_OPTIONS, statSetCodec } from "./b11-chunk3-codecs";

export default defineDecl(SelfHighestStatMultiplierAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Multiply the highest of my chosen stats",
  summary: params =>
    `While my stats are worked out, the highest of ${params.candidates} is multiplied by ${params.multiplier}, if the condition holds. Example: x1.5 to my better attack in sun.`,
  synonyms: [
    "best attacking stat",
    "highest stat boost",
    "strongest attack up",
    "solar power",
    "sand force",
    "whiteout",
    "weather attack boost",
  ],
  examples: ["Multiply my higher attacking stat by 1.5 in sun", "Boost my best stat by 1.5 in a sandstorm"],
  params: [
    {
      id: "candidates",
      ctorIndex: 0,
      ctorOption: "candidates",
      path: "candidates",
      control: "select",
      label: "Which stats to compare (the highest of them is multiplied)",
      editable: true,
      default: "Attack, Sp. Atk",
      options: STAT_SET_OPTIONS,
      codec: statSetCodec,
    },
    {
      id: "multiplier",
      ctorIndex: 0,
      ctorOption: "multiplier",
      path: "mult",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Multiplier (1.5 = half as much again, 2 = double)",
      editable: true,
      default: 1.5,
    },
  ],
  conditions: [
    // Solar Power, Big Leaves, Rite Of Spring, Photovoltaic: Sun or Extremely harsh sunlight. Sand Force, Sand Bender, Sand Fiend:
    // Sandstorm. Whiteout: Hail or Snow. Ectoplasm: Fog or Eerie fog. Raging Storm: Rain or Heavy rain.
    { slot: "ctor:1", ctx: "holder", lib: "field.weather", path: "activeCondition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only the highest stat of the list is multiplied; when two are equal the one listed first wins (Attack before Sp. Atk)",
    "The highest stat is picked by the real stat value right now, before stat stages",
  ],
  effect: { id: "effect.package", params: ["candidates", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "my stats in sun, rain, sandstorm, hail and clear weather",
      axes: { weather: ["SUNNY", "RAIN", "SANDSTORM", "NONE", "HAIL", "FOG"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, justified in the header; a package only for the effect (request R-B11-C4-01), the trigger and the weather condition are separate blocks. Users: Solar Power (94 attr 0), Sand Force (159 attr 1), Whiteout (5007), Big Leaves (5111 attrs 4 and 5), Ectoplasm (5325), Sand Bender (5445 attr 3), Rite Of Spring (5503 attr 1), Sand Fiend (5601 attr 1), Raging Storm (5636), Photovoltaic (6030); all use Attack and Sp. Atk with 1.5. The four with an attr-level condition (Big Leaves attr 4, Sand Bender, Sand Fiend, Photovoltaic: `addCondition` from a composed ability) keep it on the rebuild (recomposeAttr copies it). The weather lists are bound to `any` of field.weather (`arena.weatherType` is `weather?.weatherType ?? NONE`, the class reads the raw `weather?.weatherType`: the same for every real weather; neither tests suppression). The class no longer keeps the `weathers` list as a field (the default condition holds it), like SelfHighestStatBoostOnSummonAbAttr; V1 runtime-parameters reflection therefore no longer sees it. Remarks, NOT fixed: (1) `super.canApply(params)` is called and its answer thrown away; (2) the highest stat is read with getStat(stat, false) (in-battle overridden stats, no stages), so a Choice Scarf or a stat stage never changes which stat is the highest.",
});
