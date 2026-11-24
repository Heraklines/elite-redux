/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Anticipation, Telepathy and Wandering Spirit (Tier C, marker). "While a conscious party member has this ability, the world
// map reveals extra destinations".
//
// Source: ability-upgrades/attrs/meta-markers.ts (constructor: count >= 1, integer; `erMetaKind` "biome-reveal-bonus").
// Nothing is dispatched. The reader is `getBiomeRevealBonus()` (archetypes/ability-meta-consumers.ts:83), called by
// er-biome-routing.ts: for every NON-FAINTED player party member it takes the member's ACTIVE ability sources
// (`eligibleAttrs`: an attr counts when `attr.getCondition()` is null or returns true for that Pokemon) and sums
// `getCount()`. So the bonus is the sum over the party, and an attr-level condition added by staff is honoured by the reader.
import { BiomeRevealBonusAbAttr } from "#data/elite-redux/ability-upgrades/attrs/meta-markers";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BiomeRevealBonusAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Reveal extra biome choices on the world map",
  summary: params =>
    `While a conscious party member has this, the world map shows ${params.count} more biome destination${params.count === 1 ? "" : "s"}. Example: 1 is one extra choice.`,
  synonyms: [
    "anticipation",
    "telepathy",
    "wandering spirit",
    "see more routes",
    "reveal biomes",
    "map vision",
    "extra destinations",
  ],
  examples: ["Show one more biome to pick from on the map, like Anticipation"],
  params: [
    {
      id: "count",
      ctorIndex: 0,
      path: "count",
      control: "slider",
      min: 1,
      max: 5,
      step: 1,
      integer: true,
      label: "Extra biome choices shown (number)",
      editable: true,
      gateIndependent: true,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["Only party members that have not fainted count", "The bonuses of all party members add up"],
  effect: { id: "effect.package", params: ["count"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a plain battle with the marker on the holder", axes: {} }],
  l2StaticReason:
    "The marker is never dispatched; the biome map reads it by name (getBiomeRevealBonus), which no battle scenario reaches. B18/meta-markers.test.ts reads the live reader with a party of holders, a fainted holder and a staff-added condition.",
  status: "decomposed",
  notes:
    "PACKAGE (marker), justified: the class has no behaviour of its own (apply and canApply are the base no-ops, showAbility false); it is a number a reader asks for by name. The library has no effect that adds map destinations, so the effect is the package and the request is R-B18-5 (effect 'Show extra biome choices'). The trigger is the shared always-on WHEN; its flag key list names this class (a minimal library edit, see requests/B18.md R-B18-0). The extra IFs a staff member ANDs on become the attr's own condition (`addCondition`), which the reader honours through getCondition, so `if` is true. Users: Anticipation (107, attr 2), Telepathy (140, attr 3), Wandering Spirit (254, attr 1), count 1 each. NOTE: Anticipation's marker is pushed together with DodgeFirstSuperEffectiveAbAttr, and Wandering Spirit gets its marker from a fix-up pass (init-elite-redux-vanilla-rebalance.ts:2188) that runs only when none exists; each ability ends up with one marker, as the live dump shows.",
});
