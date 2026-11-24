/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 2 (Tier B, calc-modifier). "While the game works out one of my stats: if my HP is at most a third of my maximum, multiply the
// stat" (Defeatist: Attack and Sp. Atk halve).
//
// Source: init-elite-redux-vanilla-rebalance.ts, ErDefeatistStatMultiplierAbAttr (extends StatMultiplierAbAttr), created by
// patchDefeatistThreshold, which REPLACES the two vanilla StatMultiplierAbAttr instances of Defeatist (the vanilla threshold was one half).
// Dispatched like its parent from Pokemon.getEffectiveStat (`applyAbAttrs("StatMultiplierAbAttr")`). canApply, original clause order,
// now `guards && gate`:
//   guards  1. super.canApply: `stat === this.stat && (!this.condition || this.condition(pokemon, null, move))`. The stat is the param;
//              the optional constructor closure (argument 2) never exists on the two live instances and is declared optional.
//   gate    2. `pokemon.getHpRatio() <= 1 / 3`   getHpRatio() is the game's HP ratio ROUNDED TO TWO DECIMALS (round(hp / max * 100) / 100),
//              so this is NOT the exact integer test hp * 100 <= max * 33 of the library atom hp.at-most: at 33.4 percent HP the rounded
//              ratio is 0.33 (passes) while the exact test fails. A faithful atom must call getHpRatio() itself -> requested as R-B16-11.
// apply: the parent's `statVal.value *= multiplier`. No random draw, no state, nothing reads `simulated`.
// The literal `1 / 3` is now constructor argument 3 `hpPercent` (default 33). The ratio is a multiple of 0.01, so `ratio <= 1 / 3` and
// `ratio <= 33 / 100` give the same answer for every possible ratio (proven for every HP in chunk2.test.ts).
// There is a SECOND gate on the same ability that is not part of this class: patchDefeatistThreshold also rewrites the ability-level
// conditions to `getHpRatio() <= 1 / 3` (the blueprint carries it, recomposeAttr leaves it alone), so the effective rule is that test twice.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { ErDefeatistStatMultiplierAbAttr } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
import { Stat } from "#enums/stat";

export default defineDecl(ErDefeatistStatMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Multiply a stat while my HP is at or below a set share",
  summary: params =>
    `While my HP is at most ${params.hpPercent}% of my maximum, my ${params.stat} is multiplied by ${params.multiplier}. Example: 0.5 = half, so a Pokemon on low HP hits half as hard.`,
  synonyms: [
    "defeatist",
    "weaker when hurt",
    "lose attack on low hp",
    "halve a stat at low hp",
    "stat drop when weak",
    "low health penalty",
    "slump",
  ],
  examples: ["Halve my Attack and Sp. Atk while I am at a third of my HP or less, like Defeatist"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which stat (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy or Evasion)",
      editable: true,
      // The gate never reads the stat (it is the parent's test, in guards).
      gateIndependent: true,
      default: "ATK",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Stat multiplier (1.5 = 50% higher, 0.5 = half)",
      editable: true,
      gateIndependent: true,
      default: 0.5,
    },
    {
      id: "hpPercent",
      ctorIndex: 3,
      path: "hpPercent",
      control: "number",
      integer: true,
      min: 1,
      max: 100,
      step: 1,
      label: "Applies while my HP is at most this share of my maximum (% of max HP)",
      editable: true,
      default: 33,
    },
  ],
  // The gate repeats the threshold: once the librarian adds the rounded-ratio atom (R-B16-11) this moves its `pct` with the slider.
  gateParams: [{ param: "hpPercent", block: "hp.ratio-at-most", field: "pct" }],
  conditions: [
    // Constructor argument 2: the parent's optional attack condition. None of the live instances has one.
    { slot: "ctor:2", ctx: "attack", path: "condition", optional: true, removable: true, editable: true },
    // The gate: my HP ratio (rounded to two decimals) is at most the threshold. Bound as a legacy closure until R-B16-11 exists.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-stat", params: ["stat", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Only values at or under the line: above it the ability-level condition of Defeatist (a second HP test, see the header) stops the
      // dispatch altogether and the twin would see no evaluation. The failing side (34 percent, full HP) and the two-decimal rounding at
      // about 33.5 percent are proven directly in test/tests/elite-redux/decomp/B16/chunk2.test.ts.
      name: "HP at the one-third line and below it",
      axes: { hp: ["33%", "33%-1", "20%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. Two users, both on Defeatist (129): attr 0 Attack x0.5 and attr 1 Sp. Atk x0.5 (attr 2 is OnceLowHpStatRaiseAbAttr, another batch). WHEN, the two numbers (stat, multiplier), the HP share and the effect are real, typed, swappable parts. The gate (HP at most a share, read through the rounded getHpRatio) has no library atom: legacy-closure for both users, reason documented in bindings.ts, requested as R-B16-11 in requests/B16.md (hp.ratio-at-most with param pct and formula `pokemon.getHpRatio() <= pct / 100`). Status is therefore legacy-closure-pending-request. Class edits are behaviour-neutral (own constructor with the old behaviour as defaults, Tier B split in the original clause order, class exported). STAT MULTIPLIER CAVEATS: this class replaces the vanilla instances, so a rebuilt Defeatist uses these; the parent StatMultiplierAbAttr (B02) is a separate declaration. Oddities, not fixed: (1) the ability carries the same HP test a second time as an ability-level condition (patchDefeatistThreshold rewrites it to 1/3), so the real rule is the test twice; (2) the ratio is rounded to two decimals, so Defeatist already switches on at 33.4 percent HP and switches off at 33.5 percent.",
});
