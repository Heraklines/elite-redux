/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op session state + ownership model (#633, co-op mode).
//
// Pure logic - NO game-engine imports - so it is fully unit-testable headlessly.
// Encodes the two structural rules that the rest of co-op keys off:
//   1. The single 6-slot party array is PARTITIONED by owner: party slots 0..2 =
//      host (Player 1), 3..5 = guest (Player 2). Each player has up to 3 mons.
//   2. In the co-op DOUBLE battle, field slot 0 = host's active mon, field slot 1
//      = guest's active mon. Command / forced-switch routing keys off fieldIndex.
// Plus the alternating-interaction-owner counter (reward / shop / mystery
// encounter screens take turns; a multi-step ME counts as one interaction).
// =============================================================================

import type { CoopRole } from "#data/elite-redux/coop/coop-transport";

/** Max party members per player in co-op. */
export const COOP_SLOTS_PER_PLAYER = 3;

/** Field slot of the host's active mon in the co-op double. */
export const COOP_HOST_FIELD_INDEX = 0;
/** Field slot of the guest's active mon in the co-op double. */
export const COOP_GUEST_FIELD_INDEX = 1;

/** Which player owns party slot `partySlot` (0..2 = host, 3..5 = guest). */
export function coopOwnerOfPartySlot(partySlot: number): CoopRole {
  return partySlot < COOP_SLOTS_PER_PLAYER ? "host" : "guest";
}

/** The party-slot index range `[start, end)` owned by `role`. */
export function coopPartySlotRange(role: CoopRole): { start: number; end: number } {
  return role === "host"
    ? { start: 0, end: COOP_SLOTS_PER_PLAYER }
    : { start: COOP_SLOTS_PER_PLAYER, end: COOP_SLOTS_PER_PLAYER * 2 };
}

/** Which player owns battle FIELD slot `fieldIndex` (0 = host active, 1 = guest active). */
export function coopOwnerOfFieldIndex(fieldIndex: number): CoopRole {
  return fieldIndex === COOP_GUEST_FIELD_INDEX ? "guest" : "host";
}

/** The field slot a given player commands. */
export function coopFieldIndexOf(role: CoopRole): number {
  return role === "guest" ? COOP_GUEST_FIELD_INDEX : COOP_HOST_FIELD_INDEX;
}

/**
 * Tracks whose turn it is to drive an alternating interaction screen (reward /
 * shop / mystery encounter). The owner makes the picks (spending the shared
 * pool) while the partner watches; ownership advances ONCE per completed
 * interaction. A multi-step mystery encounter counts as a single interaction -
 * the owner keeps choosing through it; only advance when they leave it.
 *
 * The counter lives in the persisted run record so a resume continues the
 * correct order.
 */
export class CoopInteractionTurn {
  constructor(private counter = 0) {}

  /** The role that owns the current interaction. */
  current(): CoopRole {
    return this.counter % 2 === 0 ? "host" : "guest";
  }

  /** Whether `role` owns the current interaction. */
  isOwner(role: CoopRole): boolean {
    return this.current() === role;
  }

  /** Advance to the next interaction's owner. Call once per COMPLETED interaction. */
  advance(): void {
    this.counter += 1;
  }

  /** Serialize for the persistent run record. */
  toJSON(): number {
    return this.counter;
  }

  /** Restore from the persistent run record. */
  static fromJSON(counter: number): CoopInteractionTurn {
    return new CoopInteractionTurn(Number.isInteger(counter) && counter >= 0 ? counter : 0);
  }
}
