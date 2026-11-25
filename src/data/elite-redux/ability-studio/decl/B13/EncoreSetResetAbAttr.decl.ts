/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Encore Set, part 1 of 2 (Tier C, package). "When I enter, forget the move I played before."
//
// Source: abilities/newcomer-signature-mechanics.ts, EncoreSetResetAbAttr (PostSummonAbAttr).
//   canApply  the base class's (always true): no condition at all.
//   apply     ENCORE_SET.set(holder, {})     (one assignment of an empty record: no remembered move, no counted move;
//                                             ignores `simulated`)
// No RNG, no constructor arguments, no condition. The record is filled and read by EncoreSetAbAttr (a sibling class that
// is not part of this chunk): it remembers the previous damaging move and the last counted move record.
import { EncoreSetResetAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(EncoreSetResetAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Forget the move I played before when I enter",
  summary: () =>
    "When I enter the battle, the damaging move I remembered from before is wiped, so the first move I use has nothing to echo.",
  synonyms: [
    "reset replay memory",
    "forget last move",
    "clear echo memory",
    "fresh start on switch in",
    "encore set",
    "forget previous move",
  ],
  examples: ["Every time I come in, I forget which move I used before, so there is nothing to replay"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments and no number: it empties one private per-Pokemon record (the remembered previous move and the last counted move record). There is nothing to tune.",
  conditions: [],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [{ name: "entry as the first Pokemon of the battle", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified: the effect is the reset of a private per-Pokemon record (previous move, last counted move record) that only EncoreSetAbAttr reads and writes; the library has no memory block to express a reset of it (requested as `effect.reset-memory`, R-B13-23, the same block Anneal's, Porous' and Setlist's resets need). It is a single assignment, so there is nothing further to split. The trigger is a normal switch-in WHEN and the class has no condition. Users: Encore Set (5988, attr 0). ODDITIES (not fixed): (1) apply ignores `simulated`; no engine path simulates PostSummon today; (2) the record is a WeakMap entry keyed by the Pokemon, so a replacement summoned from the party never sees an old record and the reset only matters when the same Pokemon comes back in.",
});
