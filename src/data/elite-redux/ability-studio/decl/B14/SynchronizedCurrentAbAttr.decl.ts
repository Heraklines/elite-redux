/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 5. PARKED until the librarian adds this class to the `flagKeys` of the WHEN `while.active` (request R-B14-5.1, same shape
// as R-B14-3.1 and R-B14-4.1); then rename this file to SynchronizedCurrentAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "While I have this, a foe that both an ally and I damage in the same turn is paralyzed."
//
// Source: plusle-minun.ts `export class SynchronizedCurrentAbAttr extends AbAttr { constructor() { super(false); } apply() {} }`.
// An empty presence marker: nothing dispatches it. It is read by class NAME in two places, both in plusle-minun.ts:
//   erSyncCurrentOnHit(user, target, damaging)   called by erBatch3OnTargetHit (batch3-on-hit.ts, from MoveEffectPhase.applyOnTargetEffects,
//       once per target per hit, BEFORE the hit is recorded in the turn-attack ledger). Clauses in order: `damaging` and the target is not
//       fainted; syncCurrentPartner(user, target) finds an ACTIVE ally that already damaged the target this turn (ledger: allyHitTargetThisTurn)
//       and forms a pair: one end carries the marker (`carriesAttr(.., "SynchronizedCurrentAbAttr")`) and BOTH ends are Plus/Minus aligned;
//       then `target.trySetStatus(PARALYSIS, user)` (normal paralysis immunities apply inside trySetStatus).
//   isPlusMinusAligned(pokemon)   the marker's name is in SUITE_ABATTR_NAMES, so a holder counts as Plus/Minus aligned (this also feeds
//       Positive Feedback, Negative Feedback and Closed Circuit).
// No constructor argument, no closure, no random draw (trySetStatus may draw for immunities). The check is by class name and must
// never be renamed.
import { SynchronizedCurrentAbAttr } from "#data/elite-redux/abilities/plusle-minun";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SynchronizedCurrentAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Paralyze a foe that my ally and I both hit in one turn",
  summary: () =>
    "While I have this, a foe that both my ally and I damage in the same turn is paralyzed after the second hit. I also count as a Plus or Minus partner. Example: two attackers paralyze one foe.",
  synonyms: [
    "synchronized current",
    "team paralysis",
    "double hit paralysis",
    "paralyze together",
    "ally paralyze",
    "plus minus pair",
    "shared target paralysis",
  ],
  examples: ["If my ally and I both damage the same foe in one turn, that foe is paralyzed, like Synchronized Current"],
  params: [],
  noParamsReason:
    "A presence marker: the paralysis, the 'same foe in the same turn' rule and the Plus/Minus pairing are fixed code in two engine functions (erSyncCurrentOnHit, isPlusMinusAligned); the class holds no number, type or status, so nothing in it can be tuned.",
  conditions: [],
  guards: [],
  feasibility: [
    "Needs a partner on the field that is also Plus or Minus aligned, and that already damaged the same foe this turn",
    "The foe must still be standing and the hit must deal direct damage",
    "A foe that cannot be paralyzed (Electric types, an existing status, a safeguard) is unaffected",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder attacks in the default battle and the battles must match. The paralysis rule itself is driven by B14/chunk5.test.ts in a real double battle.",
  probes: [{ name: "the holder attacks a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C. Users (1): Synchronized Current (5921) attr 0 (attr 1 is the both-attack power boost, attr 2 the heal; both decomposed in this chunk). The mechanic itself (paralysis, who counts as a pair) is not in the class: it lives in erSyncCurrentOnHit and syncCurrentPartner, so the numbers and the status cannot be offered as settings until an engine owner moves them (R-B14-5.12). Oddities, not fixed: (1) alignment is by attr class name, so a Pokemon without Plus or Minus counts as aligned only through this marker or the three sister abilities; (2) `isPlusMinusAligned` also requires the Pokemon to be active, so a fainted partner never pairs.",
});
