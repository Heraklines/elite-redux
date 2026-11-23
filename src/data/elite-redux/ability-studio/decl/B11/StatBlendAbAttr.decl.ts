/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 5 / calc-modifier (Tier B: "which stats" is the gate inside canApply).
//
// Read by hand from archetypes/stat-blend.ts. It extends StatMultiplierAbAttr, so the trigger is "while the game calculates one of
// my stats" (dispatch key StatMultiplierAbAttr, from Pokemon.getEffectiveStat, once per stat per calculation). Constructor
// `(options = { appliesTo, sourceStat, fraction })`; `super(appliesTo[0] ?? ATK, 1)` (the parent's own multiplier is never used,
// apply is replaced). The constructor THROWS when the fraction is not above 0. showAbility false.
//   canApply is now `gate` alone (no guards, no residual):
//     1. the stat being calculated is one of `appliesTo`                      (CONDITION, slot gate; no library atom yet, request R-B11-C5-03)
//   apply: `statVal += floor(fraction * holder.getStat(sourceStat, false))` (the raw stat, no stages, no abilities, so no recursion).
// No random draw, no state, and `simulated` is not looked at (a stat calculation is a pure read).
//
// The stat test is a real condition ("while the game works out Attack or Sp. Atk") and is now its own block (slot gate) that staff can
// swap or extend; chunk 4 left the same kind of test inside its effect, this one does not. "Add a share of one of my stats to the
// stat being worked out" has no library effect (request R-B11-C5-04, the sibling of R-B11-C4-06), so the effect is one piece with
// typed settings: the stat the share is taken from and the share. The list of stats is a locked setting for now, because it feeds the
// gate and the gate has no library atom to carry it yet (it is read by the class's own gate until then).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { StatBlendAbAttr } from "#data/elite-redux/archetypes/stat-blend";
import { STAT_SET_OPTIONS, statSetCodec } from "./b11-chunk3-codecs";
import { SOURCE_STAT_OPTIONS, sourceStatCodec } from "./b11-chunk4-codecs";

export default defineDecl(StatBlendAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Add a share of one of my stats to the stat being worked out",
  summary: params =>
    `While my ${params.appliesTo} are worked out, ${params.fraction} times my ${params.source} is added on top (rounded down). Example: 0.2 of my Sp. Def added to my attacking stat.`,
  synonyms: [
    "use defense for attack",
    "add stat to attack",
    "stat blend",
    "best offense",
    "magus blades",
    "extra attack from defense",
    "borrow another stat",
  ],
  examples: [
    "Add 20% of my Sp. Def to my Attack and Sp. Atk while I use moves",
    "Use a share of my Speed as extra Defense",
  ],
  params: [
    {
      id: "appliesTo",
      ctorIndex: 0,
      ctorOption: "appliesTo",
      path: "appliesTo",
      control: "select",
      label: "Which of my stats get the bonus (set by the first condition; locked here)",
      editable: false,
      default: "Attack, Sp. Atk",
      options: STAT_SET_OPTIONS,
      codec: statSetCodec,
    },
    {
      id: "source",
      ctorIndex: 0,
      ctorOption: "sourceStat",
      path: "sourceStat",
      control: "select",
      label: "Which of my stats the bonus is taken from",
      editable: true,
      gateIndependent: true,
      default: "Sp. Def",
      options: SOURCE_STAT_OPTIONS,
      codec: sourceStatCodec,
    },
    {
      id: "fraction",
      ctorIndex: 0,
      ctorOption: "fraction",
      path: "fraction",
      control: "number",
      min: 0.05,
      max: 4,
      step: 0.05,
      label: "Share of that stat (0.2 = 20%, 1 = all of it)",
      editable: true,
      gateIndependent: true,
      default: 0.2,
    },
  ],
  conditions: [
    // Best Offense and Magus Blades: the stat is Attack or Sp. Atk. Legacy closure for now (request R-B11-C5-03).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The bonus is read from the stat as it is in battle right now, before stat stages and before a Choice Scarf",
    "The share is rounded down to a whole number",
  ],
  effect: { id: "effect.package", params: ["source", "fraction"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "my stats while a foe hits me and while I hit",
      axes: { weather: ["NONE", "RAIN"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header; a package only for the effect (request R-B11-C5-04), the trigger and the stat test are separate blocks. Users, both with Attack and Sp. Atk, Sp. Def as the source and 0.2: Best Offense (5545 attr 1) and Magus Blades (5547 attr 1). The gate of both is a legacy closure (request R-B11-C5-03: an atom 'the stat being worked out is one of these'); until it exists the class's own gate stays and the list of stats is locked. Remarks, NOT fixed: (1) `appliesTo` can contain only the stats of BattleStat (the codec offers the five combat stats, not Accuracy or Evasion); (2) the class reads the source stat with getStat(stat, false), the in-battle value without stages, so a Choice Scarf or a stage change in the source stat never raises the bonus.",
});
