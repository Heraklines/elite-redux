/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 1, part 1 of 2 of Ballaster (Tier C, package). "When I enter the battle, forget the hit charge I had stored."
//
// Source: src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts, BallasterResetAbAttr (PostSummonAbAttr).
//   canApply  the base class's (always true): no condition at all.
//   apply     pokemon.summonData.erAbilityProvenance = erAbilityProvenance.filter(entry => entry !== "ballaster:1")
//             (one assignment; it does NOT read `simulated`, so a simulated entry call would clear the charge too).
// No random draw, no constructor argument, no condition. The charge it clears is the marker "ballaster:1" that
// BallasterAbAttr (part 2) stores after a first damaging hit.
import { BallasterResetAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BallasterResetAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Clear my stored hit charge when I enter",
  summary: () => "When I enter the battle, any hit charge I had stored is cleared, so I start with no hit counted.",
  synonyms: [
    "reset charge",
    "forget stored hit",
    "clear charge",
    "fresh start on entry",
    "ballaster",
    "empty the counter",
  ],
  examples: ["Start every switch-in with no damaging hit counted yet"],
  params: [],
  noParamsReason:
    "The class has no constructor argument and no number: it removes one private marker from the Pokemon's own memory. There is nothing to tune.",
  conditions: [],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "ignores" },
  probes: [
    {
      // The entry template makes the foe Tackle twice, and Ballaster's second hit retaliates and knocks the template's Magikarp out, which
      // ends the battle before the next turn. A harmless foe move keeps the entry itself (the only thing this attr does) under test.
      name: "entry as the first Pokemon of the battle, against a foe that does nothing",
      axes: { foeMove: ["CELEBRATE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE, justified: the effect clears one marker string ('ballaster:1') from `summonData.erAbilityProvenance`, the per-Pokemon list of ability markers. The library has no memory block that can name and clear such a marker (requested as `effect.reset-memory`, R-B16-2 in requests/B16.md, the same request as R-B13-23). It is a single assignment, so there is nothing further to split; the trigger is a normal on-entry WHEN and there is no IF. The marker key is fixed on purpose: it is the private name that BallasterAbAttr (part 2) writes, so it is not a param. Users: Ballaster (6006, attr 0). ODDITY, not fixed: apply ignores `simulated`, so a simulated PostSummon call would clear the charge; no engine path simulates PostSummon today.",
});
