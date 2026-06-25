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

/** The number of real save slots (0..4). */
export const COOP_SAVE_SLOT_COUNT = 5;

/**
 * The slot a co-op GUEST launches its (non-authoritative) local run into (#633).
 * The guest never runs the interactive SAVE_SLOT picker (only the host is the
 * persistence authority), so it reuses whatever slot it already had selected from
 * the title/continue flow, clamped to a real slot, defaulting to slot 0 when the
 * current value is unset/invalid. Pure so the launch decision is unit-testable.
 */
export function coopGuestSessionSlot(current: number): number {
  return Number.isInteger(current) && current >= 0 && current < COOP_SAVE_SLOT_COUNT ? current : 0;
}

/**
 * Clamp a raw `current` slot to a real save slot (0..4), defaulting to 0 when it
 * is unset / out-of-range / non-integer. The HOST's all-slots-full FALLBACK (#633):
 * mirrors {@linkcode coopGuestSessionSlot} so the pure clamp is shared + unit-testable.
 */
export function coopHostFallbackSlot(current: number): number {
  return Number.isInteger(current) && current >= 0 && current < COOP_SAVE_SLOT_COUNT ? current : 0;
}

/**
 * The slot a co-op HOST launches its (authoritative) run into (#633). The host is
 * the persistence authority, but the interactive SAVE_SLOT picker hard-stalled the
 * launch (its per-slot cloud loads dead-end on empty slots and the callback never
 * fires, so the run never starts and the guest waits forever). So the host now
 * AUTO-PICKS a slot the same way the guest skips the picker, and co-op starts
 * immediately after difficulty.
 *
 * SAFE pick: probe slots 0..4 IN ORDER and select the FIRST EMPTY one. Falls back
 * to the host's CURRENT slot (clamped) ONLY when all 5 slots are non-empty.
 *
 * DATA SAFETY (critical): an empty pick must NEVER overwrite a real run, so `probeHasData`
 * MUST report occupancy from a source that cannot false-empty - the caller probes
 * localStorage DIRECTLY (a real LOCAL run is always present there; a cloud round-trip can
 * transiently fail and wrongly read as empty). `probeHasData(slot)` resolves `true` when the
 * slot holds data. Engine-free (the probe is injected) so the launch decision is unit-testable.
 */
export async function coopHostSessionSlot(
  probeHasData: (slot: number) => Promise<boolean>,
  current: number,
): Promise<number> {
  for (let slot = 0; slot < COOP_SAVE_SLOT_COUNT; slot++) {
    if (!(await probeHasData(slot))) {
      return slot;
    }
  }
  // All 5 slots are occupied: the maintainer-sanctioned fallback is the host's
  // current slot (it WILL overwrite, but every choice does when nothing is free).
  return coopHostFallbackSlot(current);
}

/** Field slot of the host's active mon in the co-op double. */
export const COOP_HOST_FIELD_INDEX = 0;
/** Field slot of the guest's active mon in the co-op double. */
export const COOP_GUEST_FIELD_INDEX = 1;

/** Which player owns party slot `partySlot` (0..2 = host, 3..5 = guest). */
export function coopOwnerOfPartySlot(partySlot: number): CoopRole {
  return partySlot < COOP_SLOTS_PER_PLAYER ? "host" : "guest";
}

/** The minimal shape the per-owner cap helpers operate on: anything that carries
 *  the persistent `coopOwner` tag. Engine-free so this is fully unit-testable. */
export interface CoopOwnedMon {
  coopOwner?: CoopRole;
}

/**
 * Count how many party members are owned by `owner` (#633, P1g). Slot index is
 * NOT used: slots shift on add/remove, so the persistent per-mon `coopOwner` tag
 * is the reliable signal. Mons with no tag (non-co-op) never count toward a half.
 */
export function coopOwnedCount(party: readonly CoopOwnedMon[], owner: CoopRole): number {
  let count = 0;
  for (const mon of party) {
    if (mon.coopOwner === owner) {
      count++;
    }
  }
  return count;
}

/** Whether `owner`'s half of the shared party is already at the per-player cap. */
export function coopHalfIsFull(party: readonly CoopOwnedMon[], owner: CoopRole): boolean {
  return coopOwnedCount(party, owner) >= COOP_SLOTS_PER_PLAYER;
}

/**
 * Decide which player a freshly OBTAINED co-op mon (catch / gift) is attributed
 * to in phase P1 (#633, P1g). There is no live co-op battle / command-routing
 * yet (that lands in P2 with the actual ball-thrower), so for now we attribute
 * the obtain to the half that has ROOM, preferring the EMPTIER half so the two
 * teams stay balanced. Returns `null` when BOTH halves are full (the add is
 * blocked by the caller). Exposed as a small helper so P2 can swap it for
 * "attribute to the actual thrower".
 */
export function coopAttributeNewMon(party: readonly CoopOwnedMon[]): CoopRole | null {
  const hostCount = coopOwnedCount(party, "host");
  const guestCount = coopOwnedCount(party, "guest");
  const hostFull = hostCount >= COOP_SLOTS_PER_PLAYER;
  const guestFull = guestCount >= COOP_SLOTS_PER_PLAYER;
  if (hostFull && guestFull) {
    return null;
  }
  if (hostFull) {
    return "guest";
  }
  if (guestFull) {
    return "host";
  }
  // Both have room: give it to the emptier half (ties go to host).
  return hostCount <= guestCount ? "host" : "guest";
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
 * Battle-control ownership predicate (#633, P2). When a switch is being made FOR
 * field slot `fieldIndex`, only the mons belonging to that slot's owner are legal
 * replacements: a host switch may only pull from the host's party half and a
 * guest switch only from the guest's. Returns `true` when `monOwner` is the WRONG
 * half for `fieldIndex` (i.e. the candidate must be BLOCKED).
 *
 * Pure logic - takes the candidate's `coopOwner` tag directly - so the switch UI
 * gate and its unit test share one source of truth. A mon with no `coopOwner` tag
 * (should not happen inside a co-op run) is treated as NOT blocked, so the gate
 * fails open rather than locking the player out of every replacement.
 */
export function coopSwitchBlocksMon(fieldIndex: number, monOwner: CoopRole | undefined): boolean {
  if (monOwner === undefined) {
    return false;
  }
  return monOwner !== coopOwnerOfFieldIndex(fieldIndex);
}

/**
 * Re-order a co-op party into the INTERLEAVED launch order (host0, guest0, host1,
 * guest1, ...), stable within each half, so the two double leads (index 0/1) are
 * one host and one guest mon - matching the field-slot ownership model. Mons with
 * no `coopOwner` tag (should not occur inside a co-op run) are appended at the end
 * so they are never silently dropped. Pure - returns a new array, mutates nothing.
 *
 * Used after a give-to-partner re-attribution (and at any point the party must be
 * normalized) to keep field slot 0 = host / slot 1 = guest. Generic over anything
 * carrying the `coopOwner` tag so the engine party and the unit test share it.
 */
export function coopInterleaveOrder<T extends CoopOwnedMon>(party: readonly T[]): T[] {
  const host = party.filter(m => m.coopOwner === "host");
  const guest = party.filter(m => m.coopOwner === "guest");
  const untagged = party.filter(m => m.coopOwner === undefined);
  const out: T[] = [];
  const max = Math.max(host.length, guest.length);
  for (let i = 0; i < max; i++) {
    if (i < host.length) {
      out.push(host[i]);
    }
    if (i < guest.length) {
      out.push(guest[i]);
    }
  }
  out.push(...untagged);
  return out;
}

/** Why a give-to-partner transfer was rejected, or `ok` when it is allowed. */
export type CoopGiveResult =
  | { ok: true }
  /** The mon carries no `coopOwner` tag, so it isn't a co-op mon to give. */
  | { ok: false; reason: "not-owned" }
  /** The partner already holds {@linkcode COOP_SLOTS_PER_PLAYER} Pokemon. */
  | { ok: false; reason: "partner-full" }
  /** This is the giver's only Pokemon - giving it would leave them with none. */
  | { ok: false; reason: "last-mon" };

/**
 * Validate giving the mon owned by `monOwner` to the partner (#633, P3). The gift
 * re-attributes the mon to the other half of the shared party. It is allowed only
 * when:
 *   - the mon is actually a co-op mon (`monOwner` is tagged),
 *   - the partner's half has room (`< COOP_SLOTS_PER_PLAYER`), and
 *   - the giver is NOT giving away their last Pokemon (each player must always
 *     keep at least one mon, else they would have nothing to control in the
 *     co-op double).
 *
 * Pure logic over the same `coopOwner`-tagged party the caps key off, so the UI
 * gate and its unit test share one source of truth.
 */
export function coopGiveToPartner(party: readonly CoopOwnedMon[], monOwner: CoopRole | undefined): CoopGiveResult {
  if (monOwner === undefined) {
    return { ok: false, reason: "not-owned" };
  }
  const partner: CoopRole = monOwner === "host" ? "guest" : "host";
  if (coopHalfIsFull(party, partner)) {
    return { ok: false, reason: "partner-full" };
  }
  if (coopOwnedCount(party, monOwner) <= 1) {
    return { ok: false, reason: "last-mon" };
  }
  return { ok: true };
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
    return CoopInteractionTurn.ownerOf(this.counter);
  }

  /** Whether `role` owns the current interaction. */
  isOwner(role: CoopRole): boolean {
    return this.current() === role;
  }

  /**
   * The role that owns the interaction whose counter is `n` (parity rule). Co-op (#633):
   * exposed STATICALLY so a phase can resolve the owner from the counter it PINNED at the
   * interaction's start - never from the live counter, which can be bumped mid-interaction
   * by an inbound reconcile broadcast (the cursor-mirror / choice-relay seq + owner must be
   * STABLE for the whole interaction, or the watcher follows the wrong seq).
   */
  static ownerOf(counter: number): CoopRole {
    return counter % 2 === 0 ? "host" : "guest";
  }

  /**
   * Advance to the next interaction's owner. Call once per COMPLETED interaction.
   *
   * Co-op (#633): IDEMPOTENT when `fromCounter` is supplied - the advance only fires
   * if the counter is STILL at the value observed when the interaction started, so a
   * second call for the same interaction (the owner's terminal AND the watcher's, or
   * a terminal that already ran after the reconcile broadcast bumped the counter) is
   * a no-op. Returns whether it actually advanced. With no arg it advances
   * unconditionally (legacy callers).
   */
  advance(fromCounter?: number): boolean {
    if (fromCounter !== undefined && fromCounter !== this.counter) {
      return false;
    }
    this.counter += 1;
    return true;
  }

  /**
   * Co-op (#633): reconcile this counter against a peer's broadcast value, MONOTONIC-
   * MAX (never moves backward). Both clients advance the counter LOCALLY in lockstep,
   * so the broadcast is only a safety net: a late / stale / duplicated `interaction`
   * message can never clobber a correct local counter or rewind the alternation - it
   * can only pull a genuinely-behind client forward.
   */
  mergeRemote(remote: number): void {
    if (Number.isInteger(remote) && remote > this.counter) {
      this.counter = remote;
    }
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
