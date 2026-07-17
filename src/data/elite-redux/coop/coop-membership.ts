/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopAccountId, CoopRunSeatMapV1, CoopSeatId } from "#data/elite-redux/coop/coop-session-binding";
import { isCoopAccountId } from "#data/elite-redux/coop/coop-session-binding";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";

export type { CoopSeatId } from "#data/elite-redux/coop/coop-session-binding";

export type CoopMembershipState = "active" | "recovering" | "terminated";

export interface CoopMemberSnapshotV1 {
  seatId: CoopSeatId;
  role: CoopRole;
  present: boolean;
}

export type CoopMemberStateV2 = "present" | "recovering" | "removed";

export interface CoopMemberSnapshotV2 {
  seatId: CoopSeatId;
  accountId: CoopAccountId;
  displayName: string;
  state: CoopMemberStateV2;
  connectionGeneration: number;
}

export interface CoopMembershipSnapshotV2 {
  version: 2;
  revision: number;
  authoritySeatId: CoopSeatId;
  state: CoopMembershipState;
  members: CoopMemberSnapshotV2[];
  /** Every non-removed seat. Recovering seats are intentionally not waived. */
  requiredAckSeats: CoopSeatId[];
}

export interface CoopFrozenAckQuorumV1 {
  version: 1;
  membershipRevision: number;
  requiredAckSeats: CoopSeatId[];
}

export interface CoopQuorumAckV1 {
  membershipRevision: number;
  seatId: CoopSeatId;
  connectionGeneration: number;
}

export type CoopQuorumAckResult =
  | "accepted"
  | "complete"
  | "duplicate"
  | "membership-mismatch"
  | "seat-not-required"
  | "seat-not-current"
  | "generation-mismatch";

function validMemberV2(member: CoopMemberSnapshotV2): boolean {
  return (
    Number.isSafeInteger(member.seatId)
    && member.seatId >= 0
    && isCoopAccountId(member.accountId)
    && typeof member.displayName === "string"
    && (["present", "recovering", "removed"] as const).includes(member.state)
    && Number.isSafeInteger(member.connectionGeneration)
    && member.connectionGeneration >= 0
  );
}

function cloneMemberV2(member: CoopMemberSnapshotV2): CoopMemberSnapshotV2 {
  return { ...member };
}

/**
 * Generic P33 membership model. The current runtime can remain on V1 while binding adapters land; this
 * controller is deliberately engine-free so two-, three-, and six-seat quorum behavior shares one source.
 */
export class CoopMembershipControllerV2 {
  private revision = 1;
  private state: CoopMembershipState = "active";
  private readonly members = new Map<CoopSeatId, CoopMemberSnapshotV2>();
  private readonly authoritySeatId: CoopSeatId;

  constructor(
    seatMap: CoopRunSeatMapV1,
    displayNames: ReadonlyMap<CoopAccountId, string>,
    authoritySeatId: CoopSeatId,
  ) {
    if (
      seatMap.seats.length < 2
      || !seatMap.seats.some(seat => seat.seatId === authoritySeatId)
      || seatMap.seats.some((seat, index) => seat.seatId !== index || this.members.has(seat.seatId))
      || new Set(seatMap.seats.map(seat => seat.accountId)).size !== seatMap.seats.length
      || seatMap.seats.some(seat => !isCoopAccountId(seat.accountId))
    ) {
      throw new Error("invalid P33 seat map");
    }
    this.authoritySeatId = authoritySeatId;
    for (const seat of seatMap.seats) {
      this.members.set(seat.seatId, {
        seatId: seat.seatId,
        accountId: seat.accountId,
        displayName: displayNames.get(seat.accountId) ?? "Trainer",
        state: "present",
        connectionGeneration: 0,
      });
    }
  }

  /** Disconnect freezes gameplay but never removes the seat from an already-frozen or future quorum. */
  disconnect(seatId: CoopSeatId, connectionGeneration: number): CoopMembershipSnapshotV2 | null {
    const member = this.members.get(seatId);
    if (this.state === "terminated" || member == null || member.state === "removed") {
      return null;
    }
    if (member.connectionGeneration !== connectionGeneration) {
      return null;
    }
    if (member.state !== "recovering") {
      member.state = "recovering";
      this.state = "recovering";
      this.revision++;
    }
    return this.snapshot();
  }

  /** Hot rejoin requires the same account and advances only that seat's channel generation. */
  rejoin(seatId: CoopSeatId, accountId: CoopAccountId): CoopMembershipSnapshotV2 | null {
    const member = this.members.get(seatId);
    if (
      this.state === "terminated"
      || member == null
      || member.state !== "recovering"
      || member.accountId !== accountId
    ) {
      return null;
    }
    member.connectionGeneration++;
    member.state = "present";
    this.state = [...this.members.values()].some(candidate => candidate.state === "recovering")
      ? "recovering"
      : "active";
    this.revision++;
    return this.snapshot();
  }

  /** Future planned removal is explicit; it is never inferred from a disconnect. */
  remove(seatId: CoopSeatId): CoopMembershipSnapshotV2 | null {
    const member = this.members.get(seatId);
    const remaining = [...this.members.values()].filter(candidate => candidate.state !== "removed").length;
    if (
      this.state !== "active"
      || member == null
      || member.state === "removed"
      || seatId === this.authoritySeatId
      || remaining <= 2
    ) {
      return null;
    }
    member.state = "removed";
    this.state = [...this.members.values()].some(candidate => candidate.state === "recovering")
      ? "recovering"
      : "active";
    this.revision++;
    return this.snapshot();
  }

  terminate(): CoopMembershipSnapshotV2 {
    if (this.state !== "terminated") {
      this.state = "terminated";
      this.revision++;
    }
    return this.snapshot();
  }

  freezeAckQuorum(): CoopFrozenAckQuorumV1 {
    if (this.state !== "active") {
      throw new Error("cannot author gameplay while P33 membership is not active");
    }
    const snapshot = this.snapshot();
    return {
      version: 1,
      membershipRevision: snapshot.revision,
      requiredAckSeats: [...snapshot.requiredAckSeats],
    };
  }

  snapshot(): CoopMembershipSnapshotV2 {
    const members = [...this.members.values()].sort((a, b) => a.seatId - b.seatId).map(cloneMemberV2);
    return {
      version: 2,
      revision: this.revision,
      authoritySeatId: this.authoritySeatId,
      state: this.state,
      members,
      requiredAckSeats: members.filter(member => member.state !== "removed").map(member => member.seatId),
    };
  }

  canAdopt(authoritative: CoopMembershipSnapshotV2): boolean {
    if (
      authoritative.version !== 2
      || !Number.isSafeInteger(authoritative.revision)
      || authoritative.revision < this.revision
      || authoritative.authoritySeatId !== this.authoritySeatId
      || !(["active", "recovering", "terminated"] as const).includes(authoritative.state)
      || authoritative.members.length !== this.members.size
      || authoritative.members.some((member, index) => member.seatId !== index || !validMemberV2(member))
      || new Set(authoritative.members.map(member => member.accountId)).size !== authoritative.members.length
    ) {
      return false;
    }
    const hasRecovering = authoritative.members.some(member => member.state === "recovering");
    if (
      (authoritative.state === "active" && hasRecovering)
      || (authoritative.state === "recovering" && !hasRecovering)
    ) {
      return false;
    }
    if (authoritative.revision === this.revision) {
      return JSON.stringify(authoritative) === JSON.stringify(this.snapshot());
    }
    for (const remote of authoritative.members) {
      const local = this.members.get(remote.seatId);
      if (
        local == null
        || remote.accountId !== local.accountId
        || remote.connectionGeneration < local.connectionGeneration
      ) {
        return false;
      }
    }
    const expectedAckSeats = authoritative.members
      .filter(member => member.state !== "removed")
      .map(member => member.seatId);
    return (
      expectedAckSeats.length === authoritative.requiredAckSeats.length
      && expectedAckSeats.every((seat, index) => authoritative.requiredAckSeats[index] === seat)
    );
  }

  adopt(authoritative: CoopMembershipSnapshotV2): boolean {
    if (!this.canAdopt(authoritative)) {
      return false;
    }
    this.revision = authoritative.revision;
    this.state = authoritative.state;
    for (const remote of authoritative.members) {
      this.members.set(remote.seatId, cloneMemberV2(remote));
    }
    return true;
  }
}

/** One retained commit's ACK set. Current membership validates the live channel generation. */
export class CoopAckQuorumTracker {
  private readonly accepted = new Set<CoopSeatId>();
  private readonly target: CoopFrozenAckQuorumV1;

  constructor(target: CoopFrozenAckQuorumV1) {
    if (
      target.version !== 1
      || !Number.isSafeInteger(target.membershipRevision)
      || target.membershipRevision < 1
      || target.requiredAckSeats.length < 2
      || target.requiredAckSeats.some(
        (seatId, index) =>
          !Number.isSafeInteger(seatId) || seatId < 0 || (index > 0 && seatId <= target.requiredAckSeats[index - 1]),
      )
    ) {
      throw new Error("invalid P33 ACK quorum");
    }
    this.target = {
      ...target,
      requiredAckSeats: [...target.requiredAckSeats],
    };
  }

  accept(ack: CoopQuorumAckV1, current: CoopMembershipSnapshotV2): CoopQuorumAckResult {
    if (ack.membershipRevision !== this.target.membershipRevision) {
      return "membership-mismatch";
    }
    if (!this.target.requiredAckSeats.includes(ack.seatId)) {
      return "seat-not-required";
    }
    const member = current.members.find(candidate => candidate.seatId === ack.seatId);
    if (member == null || member.state !== "present") {
      return "seat-not-current";
    }
    if (ack.connectionGeneration !== member.connectionGeneration) {
      return "generation-mismatch";
    }
    if (this.accepted.has(ack.seatId)) {
      return "duplicate";
    }
    this.accepted.add(ack.seatId);
    return this.complete() ? "complete" : "accepted";
  }

  complete(): boolean {
    return this.target.requiredAckSeats.every(seatId => this.accepted.has(seatId));
  }

  pendingSeats(): CoopSeatId[] {
    return this.target.requiredAckSeats.filter(seatId => !this.accepted.has(seatId));
  }
}

/** Authority-authored membership carried atomically with every full state snapshot. */
export interface CoopMembershipSnapshotV1 {
  version: 1;
  revision: number;
  authoritySeat: 0;
  connectionGeneration: number;
  state: CoopMembershipState;
  members: [CoopMemberSnapshotV1, CoopMemberSnapshotV1];
}

function roleSeat(role: CoopRole): CoopSeatId {
  return role === "host" ? 0 : 1;
}

/**
 * Two-seat membership state machine. It deliberately exists before N-player transport work: disconnect,
 * reconnect, snapshot adoption, and terminal loss must already be explicit revisioned control transitions.
 */
export class CoopMembershipController {
  private revision = 1;
  private connectionGeneration = 0;
  private state: CoopMembershipState = "active";
  private readonly present: [boolean, boolean] = [true, true];
  private readonly getLocalRole: () => CoopRole;

  constructor(getLocalRole: () => CoopRole) {
    this.getLocalRole = getLocalRole;
  }

  peerDisconnected(): CoopMembershipSnapshotV1 {
    const localRole = this.getLocalRole();
    const peerSeat = roleSeat(localRole === "host" ? "guest" : "host");
    if (this.state !== "recovering" || this.present[peerSeat]) {
      this.present[peerSeat] = false;
      this.state = "recovering";
      this.revision++;
    }
    return this.snapshot();
  }

  reconnected(connectionGeneration?: number): CoopMembershipSnapshotV1 {
    const nextGeneration =
      Number.isSafeInteger(connectionGeneration) && (connectionGeneration ?? -1) >= 0
        ? (connectionGeneration as number)
        : this.connectionGeneration + 1;
    const changed = this.state !== "active" || !this.present[0] || !this.present[1];
    this.present[0] = true;
    this.present[1] = true;
    this.state = "active";
    this.connectionGeneration = Math.max(this.connectionGeneration, nextGeneration);
    if (changed) {
      this.revision++;
    }
    return this.snapshot();
  }

  terminate(): CoopMembershipSnapshotV1 {
    if (this.state !== "terminated") {
      this.state = "terminated";
      this.revision++;
    }
    return this.snapshot();
  }

  /** Adopt only a well-formed, non-stale authority snapshot. */
  canAdopt(authoritative: CoopMembershipSnapshotV1): boolean {
    return !(
      authoritative.version !== 1
      || authoritative.authoritySeat !== 0
      || !Number.isSafeInteger(authoritative.revision)
      || authoritative.revision < this.revision
      || !Number.isSafeInteger(authoritative.connectionGeneration)
      || authoritative.connectionGeneration < this.connectionGeneration
      || !(["active", "recovering", "terminated"] as const).includes(authoritative.state)
      || authoritative.members.length !== 2
      || authoritative.members[0].seatId !== 0
      || authoritative.members[0].role !== "host"
      || authoritative.members[1].seatId !== 1
      || authoritative.members[1].role !== "guest"
      || typeof authoritative.members[0].present !== "boolean"
      || typeof authoritative.members[1].present !== "boolean"
    );
  }

  adopt(authoritative: CoopMembershipSnapshotV1): boolean {
    if (!this.canAdopt(authoritative)) {
      return false;
    }
    this.revision = authoritative.revision;
    this.connectionGeneration = authoritative.connectionGeneration;
    this.state = authoritative.state;
    this.present[0] = authoritative.members[0].present;
    this.present[1] = authoritative.members[1].present;
    return true;
  }

  /** Exact local rollback for a failed atomic DATA+CONTROL snapshot commit. */
  restoreForTransaction(snapshot: CoopMembershipSnapshotV1): void {
    this.revision = snapshot.revision;
    this.connectionGeneration = snapshot.connectionGeneration;
    this.state = snapshot.state;
    this.present[0] = snapshot.members[0].present;
    this.present[1] = snapshot.members[1].present;
  }

  snapshot(): CoopMembershipSnapshotV1 {
    return {
      version: 1,
      revision: this.revision,
      authoritySeat: 0,
      connectionGeneration: this.connectionGeneration,
      state: this.state,
      members: [
        { seatId: 0, role: "host", present: this.present[0] },
        { seatId: 1, role: "guest", present: this.present[1] },
      ],
    };
  }
}
