/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopRole } from "#data/elite-redux/coop/coop-transport";

export type CoopSeatId = 0 | 1;
export type CoopMembershipState = "active" | "recovering" | "terminated";

export interface CoopMemberSnapshotV1 {
  seatId: CoopSeatId;
  role: CoopRole;
  present: boolean;
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

  constructor(private readonly getLocalRole: () => CoopRole) {}

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
