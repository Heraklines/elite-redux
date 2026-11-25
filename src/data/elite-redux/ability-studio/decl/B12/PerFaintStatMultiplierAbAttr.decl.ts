/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 1. "A stat grows by a few percent for every Pokemon that has fainted" (the second half of Soul Harvest).
//
// Source: src/data/elite-redux/archetypes/stat-multiplier-per-faint.ts, PerFaintStatMultiplierAbAttr (extends
// StatMultiplierAbAttr). Dispatched while a stat is calculated (Pokemon.getEffectiveStat and friends).
// Clauses, in the original order:
//   canApply  inherited from StatMultiplierAbAttr: `stat === this.stat && (!this.condition || ...)`. The constructor passes
//             `super(stat, 1)` and no closure, so it is only "the stat the game asks about is the chosen one"   -> built into the effect
//   apply     `statVal.value *= 1 + this.perFaint * faintCount(pokemon)`, `faintCount` = the holder's
//             `battleData.erSoulHarvestFaintCount ?? 0` (written by FaintCountTriggerAbAttr)                      -> effect
// Constructor: (stat, perFaint = 0.05). The parent `multiplier` stays 1. No random draw. Nothing reads `simulated`.
//
// Package: the multiplier is 1 + perFaint x (a count), where the count is the counter FaintCountTriggerAbAttr keeps. The library
// has no counter to read and no "multiply a stat by a number that grows with a count" effect (effect.multiply-stat is a fixed
// multiplier), so it is requested as R-B12-03. Both settings are typed and extra IFs can still be ANDed on top.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PerFaintStatMultiplierAbAttr } from "#data/elite-redux/archetypes/stat-multiplier-per-faint";
import { Stat } from "#enums/stat";
import { perFaintPercentCodec } from "./b12-chunk1-codecs";

export default defineDecl(PerFaintStatMultiplierAbAttr, {
  tier: "A",
  kind: "package",
  when: "calc.stat-value",
  label: "Grow a stat with every faint (like Soul Harvest)",
  summary: params =>
    `My ${params.stat} goes up by ${params.perFaint}% for every Pokemon that fainted while I was out. Example: 5% and 3 faints makes it x1.15.`,
  synonyms: [
    "soul harvest",
    "snowball",
    "faint boost",
    "stat grows per faint",
    "stronger for each knock out",
    "faint counter boost",
  ],
  examples: ["Attack, Sp. Atk and Sp. Def each go up 5% for every Pokemon that fainted, like Soul Harvest"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which stat grows",
      editable: true,
      default: "ATK",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "perFaint",
      ctorIndex: 1,
      path: "perFaint",
      control: "number",
      label: "Boost for each fainted Pokemon (% of the stat, 5 = 5%)",
      editable: true,
      min: 0.5,
      max: 100,
      step: 0.5,
      default: 5,
      codec: perFaintPercentCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only the chosen stat is changed",
    "Nothing changes until at least one Pokemon has fainted (the count starts at 0)",
  ],
  effect: { id: "effect.package", params: ["stat", "perFaint"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [{ name: "a stat is asked for with no faint counted", axes: {} }],
  status: "decomposed",
  notes:
    "Package, justified: the multiplier is 1 + perFaint x the faint count, and the count is the private counter that FaintCountTriggerAbAttr keeps in the holder's battle data. The library has no counter to read and its multiply-stat effect is a fixed number, so the formula cannot be split further until R-B12-02 and R-B12-03 exist. Tier A: nothing to bind (the parent gets no closure). 3 attrs, all in Soul Harvest (5589): attr 1 Attack, attr 2 Sp. Atk, attr 3 Sp. Def, each 0.05 (5%). The percent shown to staff is perFaint x 100; the class keeps the fraction. Oddities, not fixed: (a) the parent `multiplier` stays 1, so code that reads it (the studio's reflection) sees 1, not the formula; (b) the multiplier is applied on every stat query, including previews and the AI; (c) the count is not capped, so a long battle can grow a stat without limit.",
});
