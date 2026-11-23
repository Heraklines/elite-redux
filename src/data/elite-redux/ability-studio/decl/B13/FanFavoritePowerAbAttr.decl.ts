/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Fan Favorite, part 1 of 2 (Tier B, package effect). "My special moves gain 5% power for every healthy teammate waiting on the bench (up to 5)."
//
// Source: abilities/newcomer-signature-mechanics.ts, FanFavoritePowerAbAttr (MovePowerBoostAbAttr; the constructor now
// takes bonusPercentPerBenched and maxBenched, defaults = the old literals 0.05 as 5 / 100, which is the same double,
// and 5, and still hands the base class the original closure and 1).
//   canApply (the original closure, two clauses in this order, now gate && residual; pure, no RNG):
//     gate      1. move.category === SPECIAL                          -> library atom move.category {SPECIAL}
//     residual  2. livingBenchCount(holder, maxBenched) > 0           (no library atom yet: R-B13-29)
//       livingBenchCount = min(maxBenched, party members of my side that are neither fainted nor on the field)
//   apply (overridden): power *= 1 + livingBenchCount(holder, maxBenched) * (bonusPercentPerBenched / 100)
// A "ctor:0" slot is impossible (the constructor's arguments are two numbers), so this is Tier B.
import { FanFavoritePowerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FanFavoritePowerAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.move-power",
  label: "Boost special moves for each teammate waiting on the bench",
  summary: params =>
    `My special moves gain ${params.bonusPercentPerBenched}% power for every healthy teammate waiting in the back, up to ${params.maxBenched}. Example: 3 waiting at 5% turns 100 power into 115.`,
  synonyms: [
    "cheering section",
    "bench support",
    "backup boost",
    "team spirit",
    "fan favorite",
    "power from reserves",
    "waiting teammates",
  ],
  examples: ["My special attacks get stronger for every healthy teammate cheering from the back"],
  params: [
    {
      id: "bonusPercentPerBenched",
      ctorIndex: 0,
      path: "bonusPercentPerBenched",
      control: "number",
      label: "Extra power for each waiting teammate (percent)",
      editable: true,
      gateIndependent: true,
      default: 5,
      min: 0,
      max: 100,
      step: 1,
    },
    {
      id: "maxBenched",
      ctorIndex: 1,
      path: "maxBenched",
      control: "number",
      label: "Most waiting teammates that count (1-5)",
      editable: true,
      gateIndependent: true,
      default: 5,
      min: 1,
      max: 5,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // Clause 1 of the original closure: the move is a special move (library atom, see bindings.ts). Clause 2 is the
    // class's residual.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "At least one healthy teammate must be waiting on the bench: not fainted and not on the field (checked inside the class until the librarian adds that condition, R-B13-29)",
  ],
  effect: { id: "effect.package", params: ["bonusPercentPerBenched", "maxBenched"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The trigger's registered dispatch key (MovePowerBoostAbAttr) is never dispatched by the engine, which dispatches VariableMovePowerAbAttr, so the shared reach probe cannot see it (decomp-l2-reach.json, request R-B13-12). The twin still shows the original evaluating this attr when a damaging move is used, and B13/chunk3.test.ts drives the bench count.",
  probes: [
    {
      // Special and physical foe moves are irrelevant here (the holder attacks); the bench size is in B13/chunk3.test.ts.
      name: "a move used with the default party",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only; the trigger (move power) and the special-move condition are separate and bound to a library atom. Why the effect cannot be split with today's blocks: the multiplier is 1 + 5% * (number of waiting teammates), read live from the party, not a constant that effect.multiply-power can hold; requested as R-B13-26 (`effect.multiply-power-per-count`). The 'a teammate waits' clause stays in the class as the residual (second position, as in the original) and is listed under 'also requires'; R-B13-29 adds `party.bench-count` so it can move into the gate. The 5% and the cap of 5 were literals, now constructor arguments 0 and 1 with the old values as defaults (the cap of 5 is also the most that can wait: a party has 6 and one is on the field). Users: Fan Favorite (5990, attr 0; attr 1 is FanFavoriteAccuracyAbAttr). ODDITIES (not fixed): (1) in a double battle both field slots are 'on the field', so only the 4 back Pokemon can count. (2) the cap of 5 is also the most that can wait, so a bigger value of the second param changes nothing in a normal party.",
});
