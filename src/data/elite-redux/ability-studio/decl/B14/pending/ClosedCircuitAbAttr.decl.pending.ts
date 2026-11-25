/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 6. PARKED until the librarian adds this class to the `flagKeys` of the WHEN `while.active` (request R-B14-6.11, same shape
// as R-B14-3.1, R-B14-4.1 and R-B14-5.1); then rename this file to ClosedCircuitAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "While I have this, if my ally and I aim at the same foe in one turn, each of us launches an extra 25 base power Electric and Fairy
// special attack at that foe after both main moves."
//
// Source: plusle-minun.ts `export class ClosedCircuitAbAttr extends AbAttr { constructor() { super(false); } apply() {} }`. An empty
// presence marker: nothing dispatches it. It is read by class NAME in plusle-minun.ts:
//   erClosedCircuitOnHit(user, target)   called by erBatch3OnTargetHit (batch3-on-hit.ts, from MoveEffectPhase.applyOnTargetEffects,
//       once per target per hit, BEFORE the hit is recorded in the turn-attack ledger). In order: `closedCircuitPartner(user, target)`
//       finds an ACTIVE ally that already TARGETED the target this turn (ledger: allyHitTargetThisTurn(ally, target)) and where one of
//       the two carries the marker (`carriesAttr(.., "ClosedCircuitAbAttr")`); none means this is not the second actor. Then a
//       module memory key `wave:turn:min(userId, partnerId):targetId` stops a second launch for the same pair, target and turn; and
//       finally `unshiftNew("ErClosedCircuitBurstPhase", [partner, user], target)`.
//   ErClosedCircuitBurstPhase (phases/er-closed-circuit-burst-phase.ts): for each attacker still on the field, in order (partner
//       first), it unshifts a MovePhase (MoveUseMode.INDIRECT) of a scripted Shock Wave clone at 25 base power with Fairy added as a
//       second type (`CLOSED_CIRCUIT_FOLLOWUP_POWER`); the target is the shared target while it is still an opponent, otherwise a seeded
//       pick (`randBattleSeedInt`) among the attacker's remaining opponents; with none left it ends.
//   isPlusMinusAligned(pokemon)   the marker's name is in SUITE_ABATTR_NAMES, so a holder counts as Plus/Minus aligned (this also feeds
//       Synchronized Current, Positive Feedback and Negative Feedback).
// No constructor argument, no closure, no random draw in the class (the burst phase draws only for a carry-over target). The check is by
// class name and must never be renamed.
import { ClosedCircuitAbAttr } from "#data/elite-redux/abilities/plusle-minun";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ClosedCircuitAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Launch an extra attack when my ally and I hit the same foe",
  summary: () =>
    "While I have this, when my ally and I both aim at the same foe in one turn, each of us launches an extra 25 base power Electric and Fairy attack at it after both main moves. I also count as a Plus or Minus partner.",
  synonyms: [
    "closed circuit",
    "team follow up attack",
    "double battle combo",
    "ally combo attack",
    "extra hit with a partner",
    "linked attack",
    "shared target bonus attack",
  ],
  examples: [
    "If my ally and I both target the same foe, each of us fires an extra weak Electric and Fairy attack, like Closed Circuit",
  ],
  params: [],
  noParamsReason:
    "A presence marker: the 25 base power, the Shock Wave copy, the Fairy second type and the 'same foe in the same turn' pair rule are fixed code in erClosedCircuitOnHit and ErClosedCircuitBurstPhase; the class holds no number, type or move, so nothing in it can be tuned.",
  conditions: [],
  guards: [],
  feasibility: [
    "Needs an ally on the field, and one of the two carries this; the ally must already have targeted the same foe this turn",
    "Each pair launches only once per turn per foe",
    "If the shared foe faints before an extra attack, that attack goes to another foe still standing (a random pick); with none left it is skipped",
    "The extra attacks are special, cannot trigger further follow-ups and have no secondary effects",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder attacks in the default battle and the battles must match. The pair rule and the burst are driven by B14/chunk6.test.ts in a real double battle.",
  probes: [{ name: "the holder attacks a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C. Users (1): Closed Circuit (5924), its only attr. The mechanic itself (who pairs, the 25 base power, the types, the carry-over) is not in the class: it lives in erClosedCircuitOnHit, closedCircuitPartner and ErClosedCircuitBurstPhase, so the numbers and the types cannot be offered as settings until an engine owner moves them (R-B14-6.12). Oddities, not fixed: (1) alignment is by attr class name, so a Pokemon without Plus or Minus counts as aligned through this marker or its three sister abilities; (2) the module key that stops a second launch is one string, not a set, so it only remembers the LAST launch; (3) the pair memory is module level and shared by every battle.",
});
