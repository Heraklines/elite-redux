/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
// B09 chunk 3. "A stat grows smoothly as my HP gets lower" (Last Stand: Defense and Sp. Def x1.0 at full HP up to x1.6 at 0 HP).
//
// Source: src/data/elite-redux/archetypes/hp-scaling-stat-multiplier.ts, class HpScalingStatMultiplierAbAttr (extends
// StatMultiplierAbAttr). Dispatched while a stat is calculated (`applyAbAttrs("StatMultiplierAbAttr")` from
// Pokemon.getEffectiveStat and the accuracy helpers).
// Clauses:
//   canApply: the parent's `stat === this.stat && (!condition || condition(...))`. The constructor passes `(opts.stat, 1)` and
//             no closure, so it is just "the stat the game asks about is the chosen one"            -> built into the effect
//   apply:    `statVal.value *= multiplierAt(pokemon.hp, pokemon.getMaxHp())` where
//             `multiplierAt = min + (max - min) * (1 - clamp(hp / maxHp, 0, 1))` (0 when maxHp is 0)  -> effect
// Constructor: ({ stat, minMultiplier, maxMultiplier }), one options object; throws unless both multipliers are above 0 (the
// parent gets the multiplier 1, which apply never uses). No random draw, no state, nothing reads `simulated`.
//
// Package: the multiplier is a continuous formula of the missing HP, which no fixed "multiply a stat" effect or threshold
// condition can express (HP tiers would be a different, stepped ability). It keeps three typed settings and extra IFs can be
// ANDed on top. Request R-B09-14 asks for a library effect with this formula.
import { HpScalingStatMultiplierAbAttr } from "#data/elite-redux/archetypes/hp-scaling-stat-multiplier";
import { Stat } from "#enums/stat";

export default defineDecl(HpScalingStatMultiplierAbAttr, {
  tier: "A",
  kind: "package",
  when: "calc.stat-value",
  label: "Raise a stat as my HP gets lower",
  summary: params =>
    `My ${params.stat} is multiplied by ${params.minMultiplier} at full HP and grows smoothly to ${params.maxMultiplier} at 0 HP. Example: 1 to 1.6 gives x1.3 at half HP.`,
  synonyms: [
    "last stand",
    "stat grows with missing hp",
    "low hp boost",
    "pinch boost",
    "desperation",
    "scaling defense",
    "gradual boost",
  ],
  examples: ["Defense rises smoothly from x1 at full HP to x1.6 at 0 HP, like Last Stand"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      ctorOption: "stat",
      path: "stat",
      control: "select",
      label: "Which stat grows (Attack, Defense, Sp. Atk, Sp. Def or Speed)",
      editable: true,
      default: "DEF",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "minMultiplier",
      ctorIndex: 0,
      ctorOption: "minMultiplier",
      path: "minMultiplier",
      control: "number",
      label: "Multiplier at full HP (1 = no change)",
      editable: true,
      min: 0.05,
      max: 4,
      step: 0.05,
      default: 1,
    },
    {
      id: "maxMultiplier",
      ctorIndex: 0,
      ctorOption: "maxMultiplier",
      path: "maxMultiplier",
      control: "number",
      label: "Multiplier at 0 HP (1.6 = 60% higher)",
      editable: true,
      min: 0.05,
      max: 4,
      step: 0.05,
      default: 1.6,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["Only the chosen stat is changed; accuracy and evasion count as stats here too"],
  effect: { id: "effect.package", params: ["stat", "minMultiplier", "maxMultiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "the stat is asked at HP boundaries while the foe uses a physical and a special move",
      axes: { hp: ["max", "max-1", "50%", "50%-1", "50%+1", "25%"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Package, justified: the multiplier is a continuous formula of the holder's missing HP, so it is neither a fixed stat multiplier nor an HP threshold; the formula is the class's multiplierAt. Tier A because there is no closure or gate to bind (the parent gets no condition). 2 attrs: Last Stand (5338 attr 0 Defense, attr 1 Sp. Def, both 1.0 to 1.6). The same formula is repeated by hand in abilities/pressure-vessel.ts (its own class, outside this batch). Oddities, not fixed: (a) the HP fraction is hp / maxHp clamped to 0..1 with plain float math, so the values at 50% and 25% are exactly the dex points only for even max HP; (b) the parent's `multiplier` stays 1, so code that reads it (the studio's runtime reflection) sees 1, not the formula; (c) the multiplier is applied on every stat query, including AI previews. The L1 grid covers HP at every boundary; B09/chunk3.test.ts also checks multiplierAt over a range of HP values for the rebuilt attr.",
});
