/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolveCoopV2SessionIdentity } from "#data/elite-redux/coop/authority-v2/session-identity";
import type { CoopMembershipSnapshotV2 } from "#data/elite-redux/coop/coop-membership";
import type { CoopSessionBindingV1 } from "#data/elite-redux/coop/coop-session-binding";
import { describe, expect, it } from "vitest";

const SEAT_MAP_ID = "a".repeat(64);
const BINDING: CoopSessionBindingV1 = {
  version: 1,
  bindingId: "p33-binding:pair:7:aaaa",
  sessionId: "p33-session:pair:7",
  runId: "run-shared-identity",
  sessionEpoch: 7,
  checkpointRevision: 0,
  seatMap: {
    version: 1,
    revision: 1,
    seatMapId: SEAT_MAP_ID,
    seats: [
      { seatId: 0, accountId: "account-a" },
      { seatId: 1, accountId: "account-b" },
    ],
  },
  authoritySeatId: 0,
  membershipRevision: 1,
  source: "fresh",
};
const MEMBERSHIP: CoopMembershipSnapshotV2 = {
  version: 2,
  revision: 1,
  authoritySeatId: 0,
  state: "active",
  members: [
    {
      seatId: 0,
      accountId: "account-a",
      displayName: "A",
      state: "present",
      connectionGeneration: 3,
    },
    {
      seatId: 1,
      accountId: "account-b",
      displayName: "B",
      state: "present",
      connectionGeneration: 5,
    },
  ],
  requiredAckSeats: [0, 1],
};

describe("Authority V2 session identity", () => {
  it("defers authenticated peers until the shared binding exists", () => {
    expect(
      resolveCoopV2SessionIdentity({
        hasAuthenticatedPairing: true,
        authenticatedBinding: null,
        membership: null,
        localSeatId: 1,
        authoritySeatId: 0,
        runId: "browser-local-provisional-run",
        sessionEpoch: 7,
        connectionGeneration: 5,
      }),
    ).toBeNull();
  });

  it("gives both authenticated seats identical immutable session axes", () => {
    const authority = resolveCoopV2SessionIdentity({
      hasAuthenticatedPairing: true,
      authenticatedBinding: BINDING,
      membership: MEMBERSHIP,
      localSeatId: 0,
      authoritySeatId: 0,
      runId: "authority-local-run-must-not-win",
      sessionEpoch: 99,
      connectionGeneration: 3,
    });
    const replica = resolveCoopV2SessionIdentity({
      hasAuthenticatedPairing: true,
      authenticatedBinding: BINDING,
      membership: MEMBERSHIP,
      localSeatId: 1,
      authoritySeatId: 0,
      runId: "replica-local-run-must-not-win",
      sessionEpoch: 42,
      connectionGeneration: 5,
    });

    expect(authority).not.toBeNull();
    expect(replica).not.toBeNull();
    expect({
      sessionId: authority?.sessionId,
      runId: authority?.runId,
      epoch: authority?.epoch,
      seatMapId: authority?.seatMapId,
      membershipRevision: authority?.membershipRevision,
      authoritySeatId: authority?.authoritySeatId,
    }).toEqual({
      sessionId: replica?.sessionId,
      runId: replica?.runId,
      epoch: replica?.epoch,
      seatMapId: replica?.seatMapId,
      membershipRevision: replica?.membershipRevision,
      authoritySeatId: replica?.authoritySeatId,
    });
    expect(authority?.peerBindings).toEqual([{ seatId: 1, connectionGeneration: 5 }]);
    expect(replica?.peerBindings).toEqual([{ seatId: 0, connectionGeneration: 3 }]);
  });

  it("keeps the synthesized identity only for unauthenticated loopback peers", () => {
    const identity = resolveCoopV2SessionIdentity({
      hasAuthenticatedPairing: false,
      authenticatedBinding: null,
      membership: null,
      localSeatId: 0,
      authoritySeatId: 0,
      runId: "loopback-shared-run",
      sessionEpoch: 4,
      connectionGeneration: 2,
    });

    expect(identity).toMatchObject({
      sessionId: "loopback-shared-run",
      runId: "loopback-shared-run",
      epoch: 4,
      seatMapId: "coop-v2-shadow-seatmap:loopback-shared-run",
      peerBindings: [{ seatId: 1, connectionGeneration: 2 }],
    });
  });
});
