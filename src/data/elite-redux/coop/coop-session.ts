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

import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
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
/**
 * #800 follow-up ("my Dracovish counted as the host's"): while a capture resolves, the
 * ACTUAL BALL-THROWER's role is pinned here (set by AttemptCapturePhase, cleared when it
 * ends). {@linkcode coopAttributeNewMon} prefers it whenever that half has room, so a mon
 * you caught is YOURS - the emptier-half balancing only decides when the thrower is full
 * or unknown (ME grants / gifts have no thrower and keep the balance rule).
 */
let coopCatchThrowerHint: CoopRole | null = null;
export function setCoopCatchThrowerHint(role: CoopRole | null): void {
  coopCatchThrowerHint = role;
}

export function coopAttributeNewMon(party: readonly CoopOwnedMon[]): CoopRole | null {
  const hostCount = coopOwnedCount(party, "host");
  const guestCount = coopOwnedCount(party, "guest");
  if (coopCatchThrowerHint != null) {
    const throwerCount = coopCatchThrowerHint === "host" ? hostCount : guestCount;
    if (throwerCount < COOP_SLOTS_PER_PLAYER) {
      return coopCatchThrowerHint;
    }
  }
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

// =============================================================================
// Seat / PlayerId model (#633, M5: generalize role/ownership to N players).
//
// The binary host/guest role maps BIJECTIVELY onto 0-based SEAT indices: host =
// seat 0 = the AUTHORITY, guest = seat 1. Every ownership / turn / authority rule
// below is expressed as a SEAT rule, so raising the player count is a DATA change
// (playerCount, seatOf(mon)) rather than a control-flow rewrite. These helpers are
// ADDITIVE - the binary API above is unchanged - so the 2-player path stays
// byte-identical while the model becomes N-ready. All pure / engine-free.
// =============================================================================

/** A co-op player's stable 0-based seat index. Seat {@linkcode COOP_AUTHORITY_ID} is the
 *  authority (the host, in the 2-player model). */
export type CoopPlayerId = number;

/** The authoritative seat: the persistence + battle authority. Seat 0 by convention. */
export const COOP_AUTHORITY_ID: CoopPlayerId = 0;

/** The player count of the current co-op model. The rest of co-op is 2-player today;
 *  N-ready helpers take an explicit `playerCount` and default to this. */
export const COOP_PLAYER_COUNT = 2;

/** Map the binary role to its seat index (host = 0 = authority, guest = 1). */
export function coopSeatOfRole(role: CoopRole): CoopPlayerId {
  return role === "host" ? COOP_AUTHORITY_ID : 1;
}

/** Map a seat index back to the binary role (seat 0 = host, any other seat = guest).
 *  Bijective for the 2-player model; seats > 1 collapse to "guest" until N distinct
 *  roles land (the binary role type only encodes authority-vs-not today). */
export function coopRoleOfSeat(seat: CoopPlayerId): CoopRole {
  return seat === COOP_AUTHORITY_ID ? "host" : "guest";
}

/** Whether `seat` is the authoritative seat (seat 0). */
export function coopSeatIsAuthority(seat: CoopPlayerId): boolean {
  return seat === COOP_AUTHORITY_ID;
}

/**
 * N-ready field-slot ownership (#633, M5): resolve the OWNER of battle field slot `slot`
 * from the persistent `coopOwner` tag of the mon ACTUALLY in that slot - not a hardcoded
 * guest slot. `field[slot]` is the active mon at that field index (`undefined` if empty).
 *
 * Falls back to the fixed 2-player slot map ({@linkcode coopOwnerOfFieldIndex}) when the
 * slot is empty or its mon is untagged, so the binary launch order (slot 0 = host, slot 1
 * = guest) is preserved bit-for-bit. But once slots reorder (a switch / give-to-partner),
 * this reads the TRUE owner off the mon rather than assuming the launch layout - the
 * correctness the design (§3.4) keys command / switch routing off. Pure over the
 * `coopOwner` tag so the routing gate and its unit test share one source of truth.
 */
export function coopOwnerOfFieldSlot(field: readonly (CoopOwnedMon | undefined)[], slot: number): CoopRole {
  const mon = field[slot];
  if (mon?.coopOwner !== undefined) {
    return mon.coopOwner;
  }
  return coopOwnerOfFieldIndex(slot);
}

/**
 * The SEAT that owns the interaction whose counter is `n`, round-robin over `playerCount`
 * players (#633, M5). The 2-player parity rule (even counter -> seat 0 -> host, odd -> seat
 * 1 -> guest) is exactly the `playerCount === 2` case, so {@linkcode CoopInteractionTurn.ownerOf}
 * delegates here and stays bit-for-bit identical while alternation becomes N-ready. The modulo
 * is written to be safe for negative / non-integer counters (clamped like the old parity math).
 */
export function coopInteractionOwnerSeat(counter: number, playerCount: number = COOP_PLAYER_COUNT): CoopPlayerId {
  const n = Math.max(1, Math.trunc(playerCount));
  const c = Math.trunc(counter);
  return ((c % n) + n) % n;
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
  return coopSwitchBlocksMonForOwner(coopOwnerOfFieldIndex(fieldIndex), monOwner);
}

/**
 * N-ready switch gate (#633, M5): same rule as {@linkcode coopSwitchBlocksMon} but keyed on the
 * slot's RESOLVED owner (from {@linkcode coopOwnerOfFieldSlot} / the mon's `coopOwner` tag) instead
 * of the fixed 2-player slot map. A candidate is BLOCKED when it belongs to a different owner than
 * the slot being switched; an untagged candidate fails open (never lock the player out).
 */
export function coopSwitchBlocksMonForOwner(slotOwner: CoopRole, monOwner: CoopRole | undefined): boolean {
  if (monOwner === undefined) {
    return false;
  }
  return monOwner !== slotOwner;
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
  /**
   * The highest interaction counter the PARTNER has broadcast (#788 wave-start barrier).
   * Independent of the local live counter: the local side may defer folding a remote value
   * in, but the BARRIER only needs to know "has my partner finished interaction N too?".
   */
  private remoteSeen = 0;
  /** One-shot waiters keyed by the remote counter value they need (#788). */
  private remoteWaiters: { need: number; resolve: () => void }[] = [];

  /** Highest partner-broadcast counter observed this session (#788). */
  remoteCounterSeen(): number {
    return this.remoteSeen;
  }

  /**
   * Resolves once the PARTNER'S broadcast counter reaches `need` (immediately when it already
   * has), or returns false after `timeoutMs` as a replay pulse. The controller requests a fresh
   * counter and waits again; false is never permission for a shared boundary to proceed.
   */
  awaitRemoteCounter(need: number, timeoutMs: number): Promise<boolean> {
    if (this.remoteSeen >= need) {
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      const entry = { need, resolve: () => resolve(true) };
      this.remoteWaiters.push(entry);
      setTimeout(() => {
        const i = this.remoteWaiters.indexOf(entry);
        if (i >= 0) {
          this.remoteWaiters.splice(i, 1);
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  /**
   * #863: like {@linkcode awaitRemoteCounter} but with NO timeout and a CANCELLER, so a race LOSER leaves
   * no dangling waiter (a lingering 20-min timer would retain the scene under vitest's `isolate:false`).
   * Resolves once the peer's broadcast counter reaches `need`; the caller cancels it if its other race arm
   * wins first. Resolves immediately when the peer is already there.
   */
  awaitRemoteCounterCancellable(need: number): { promise: Promise<void>; cancel: () => void } {
    if (this.remoteSeen >= need) {
      return { promise: Promise.resolve(), cancel: () => {} };
    }
    const entry: { need: number; resolve: () => void } = { need, resolve: () => {} };
    const promise = new Promise<void>(resolve => {
      entry.resolve = resolve;
      this.remoteWaiters.push(entry);
    });
    const cancel = (): void => {
      const i = this.remoteWaiters.indexOf(entry);
      if (i >= 0) {
        this.remoteWaiters.splice(i, 1);
      }
    };
    return { promise, cancel };
  }

  private noteRemote(counter: number): void {
    if (counter > this.remoteSeen) {
      this.remoteSeen = counter;
    }
    const ready = this.remoteWaiters.filter(w => this.remoteSeen >= w.need);
    this.remoteWaiters = this.remoteWaiters.filter(w => this.remoteSeen < w.need);
    for (const w of ready) {
      w.resolve();
    }
  }

  constructor(private counter = 0) {}

  /**
   * A DEFERRED peer catch-up target (#633, BUG2). The live `counter` is moved ONLY by
   * this client's own deterministic local advances; an inbound peer broadcast is parked
   * here (monotonic-max) and folded in at the NEXT local advance rather than mutating the
   * live counter eagerly. -1 means nothing is pending.
   *
   * Why: an eager live-counter write from a broadcast landing in the inter-wave GAP
   * (after the prior interaction's terminal, BEFORE the next screen pins its owner) let
   * the guest pin its reward-shop owner from a poisoned counter -> alternation drift.
   * Deferring keeps the value SelectModifierPhase pins from moving only on the client's
   * own idempotent advances, so both clients pin the same value for the same wave's shop.
   */
  private pendingRemote = -1;

  /** The role that owns the current interaction. */
  current(): CoopRole {
    return CoopInteractionTurn.ownerOf(this.counter);
  }

  /** Whether `role` owns the current interaction. */
  isOwner(role: CoopRole): boolean {
    return this.current() === role;
  }

  /**
   * Co-op (#633): whether the PEER has broadcast an interaction counter STRICTLY BEYOND `seq` -
   * i.e. the owner has already advanced PAST the interaction pinned at `seq`. Reads the deferred
   * {@linkcode pendingRemote} (the peer's last broadcast counter, parked but not yet folded in).
   *
   * Used by the resync safety net to tell a genuinely-ORPHANED watcher wait (the owner left this
   * interaction, so the wait can never resolve) from a LIVE one (the owner is still on this
   * interaction and the watcher must keep waiting). A live interaction leaves `pendingRemote` at
   * -1, so this is `false` and the parked wait is spared - the regression where a benign mid-shop
   * battle resync sticky-cancelled the LIVE reward-shop wait and dropped the watcher off the shop.
   */
  peerAdvancedPast(seq: number): boolean {
    return this.pendingRemote > seq;
  }

  /**
   * The role that owns the interaction whose counter is `n` (parity rule). Co-op (#633):
   * exposed STATICALLY so a phase can resolve the owner from the counter it PINNED at the
   * interaction's start - never from the live counter, which can be bumped mid-interaction
   * by an inbound reconcile broadcast (the cursor-mirror / choice-relay seq + owner must be
   * STABLE for the whole interaction, or the watcher follows the wrong seq).
   */
  static ownerOf(counter: number): CoopRole {
    // N-ready (#633, M5): resolve the owning SEAT round-robin, then map back to the binary
    // role. For the 2-player model this is exactly the old parity rule (even -> seat 0 ->
    // host, odd -> seat 1 -> guest), so the alternation is unchanged bit-for-bit.
    const seat = coopInteractionOwnerSeat(counter);
    const owner = coopRoleOfSeat(seat);
    if (isCoopDebug()) {
      coopLog("owner", `ownerOf(counter=${counter}) seat=${seat} -> owner=${owner}`);
    }
    return owner;
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
      // Idempotent no-op: this interaction already advanced (a duplicate terminal,
      // or the reconcile broadcast already bumped past `fromCounter`). The whole
      // point of the guard - log WHY we skipped so a missing skip (a double-count)
      // is unmissable in the next repro.
      coopLog(
        "interaction",
        `CoopInteractionTurn.advance NO-OP idempotent (fromCounter=${fromCounter} != counter=${this.counter}); counter stays ${this.counter}`,
      );
      return false;
    }
    const before = this.counter;
    this.counter += 1;
    coopLog(
      "interaction",
      `CoopInteractionTurn.advance INCREMENT (fromCounter=${fromCounter === undefined ? "none" : fromCounter}) counter ${before} -> ${this.counter}`,
    );
    // Co-op (#633, BUG2): fold in a DEFERRED peer catch-up target (monotonic, never
    // backward). A genuine missed advance parked by mergeRemote is reconciled here, at
    // the client's OWN next deterministic advance - never in the inter-wave gap where it
    // would poison the next screen's owner pin.
    if (this.pendingRemote > this.counter) {
      coopLog(
        "interaction",
        `CoopInteractionTurn.advance catch-up (pendingRemote=${this.pendingRemote} > counter=${this.counter}) counter ${this.counter} -> ${this.pendingRemote}`,
      );
      this.counter = this.pendingRemote;
    }
    this.pendingRemote = -1;
    return true;
  }

  /**
   * Co-op (#633, BUG2): reconcile this counter against a peer's broadcast value by
   * DEFERRING it (monotonic-max) into {@linkcode pendingRemote} instead of writing the
   * LIVE counter. Both clients advance the live counter LOCALLY in lockstep, so the
   * broadcast is only a catch-up safety net - parked here and folded in at the NEXT local
   * advance (see {@linkcode advance}). This stops a stray/early broadcast landing in the
   * inter-wave gap (after the prior interaction's terminal, before the next screen pins
   * its owner) from bumping the live counter and poisoning the next reward-shop owner pin
   * - the alternation-drift root cause. A genuinely-behind client still catches up; a
   * late / stale / duplicated message can never rewind anything (monotonic on both ends).
   */
  mergeRemote(remote: number): void {
    this.noteRemote(remote);
    const before = this.counter;
    const valid = Number.isInteger(remote);
    if (valid && remote > this.pendingRemote) {
      this.pendingRemote = remote;
    }
    coopWarn(
      "interaction",
      valid
        ? `CoopInteractionTurn.mergeRemote DEFER (remote=${remote}, counter=${before}, pendingRemote=${this.pendingRemote}) live counter UNCHANGED (folds in at next advance if still ahead)`
        : `CoopInteractionTurn.mergeRemote NO-CHANGE (remote=${remote} not an integer) counter stays ${before}`,
    );
  }

  /** Serialize for the persistent run record. */
  toJSON(): number {
    return this.counter;
  }

  /**
   * W2b (contract doc §4): restore the LIVE counter from a persisted `SessionSaveData` on a COLD resume, so
   * the alternating-owner parity + revision ordering continue monotonically rather than resetting to 0.
   * Clamps an invalid/negative value to the current counter (no-op) so an older save can never corrupt it.
   * Only moves FORWARD (a resume never rewinds the counter below the fresh base).
   */
  restore(counter: number): void {
    if (Number.isInteger(counter) && counter > this.counter) {
      this.counter = counter;
    }
  }

  /**
   * Atomic CONTROL-transaction rollback only. Unlike cold-resume restore, rollback must be able to
   * move the live counter backward to the exact pre-transaction value. The caller owns notification
   * and restores the other CONTROL ledgers in the same rollback block.
   */
  restoreExactForTransaction(counter: number): void {
    if (!Number.isSafeInteger(counter) || counter < 0) {
      throw new Error(`Invalid transactional interaction counter ${counter}.`);
    }
    this.counter = counter;
  }

  /** Restore from the persistent run record. */
  static fromJSON(counter: number): CoopInteractionTurn {
    const restored = Number.isInteger(counter) && counter >= 0 ? counter : 0;
    coopLog(
      "interaction",
      `CoopInteractionTurn.fromJSON restore (raw=${counter}) -> counter=${restored}${restored === counter ? "" : " (clamped from invalid/negative)"}`,
    );
    return new CoopInteractionTurn(restored);
  }
}
