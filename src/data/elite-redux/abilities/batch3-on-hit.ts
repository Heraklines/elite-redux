/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Batch 3 on-hit dispatcher.
//
// A single seam called from `MoveEffectPhase.applyOnTargetEffects` (once per
// target per hit) that drives every "same-turn, same-target" Batch 3 effect and
// then records the hit in the shared turn-attack ledger. ORDER MATTERS: the
// second-actor triggers query the ledger for the PARTNER's earlier hit, so they
// must run BEFORE this hit is recorded (otherwise a mon could match itself).
//
// Consumers (added as their abilities land):
//   - Rendezvous (5919): both linked mons heal when the pair's second move lands.
//   - Synchronized Current (5921): paralyze a target both Plus/Minus allies damage.
//   - Closed Circuit (5924): second actor of a linked pair fires an extra hit.
// =============================================================================

import type { Pokemon } from "#field/pokemon";
import { erClosedCircuitOnHit, erSyncCurrentOnHit } from "./plusle-minun";
import { erRendezvousOnHit } from "./rendezvous";
import { recordTurnAttack } from "./turn-attack-ledger";

/**
 * Drive Batch 3 same-turn effects for `user`'s hit on `target`, then record the
 * hit. `damaging` is whether the hit dealt direct damage.
 */
export function erBatch3OnTargetHit(user: Pokemon, target: Pokemon, damaging: boolean): void {
  // Second-actor triggers first (they read the PARTNER's prior ledger entry).
  erRendezvousOnHit(user, target);
  erSyncCurrentOnHit(user, target, damaging);
  erClosedCircuitOnHit(user, target);
  // Record this hit last so it is visible to LATER movers this turn.
  recordTurnAttack(user, target, damaging);
}
