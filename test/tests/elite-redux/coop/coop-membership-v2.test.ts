/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopAckQuorumTracker, CoopMembershipControllerV2 } from "#data/elite-redux/coop/coop-membership";
import {
  coopFrameContextMatchesBinding,
  createFreshCoopSeatMap,
  validateCoopRunSeatMap,
} from "#data/elite-redux/coop/coop-session-binding";
import { describe, expect, it } from "vitest";

async function seatMap(count: number) {
  const map = await createFreshCoopSeatMap(
    Array.from({ length: count }, (_, index) => `er-account:${String(index + 1).padStart(2, "0")}`),
  );
  expect(map).not.toBeNull();
  return map!;
}

describe("P33 stable seats and membership ACK quorum", () => {
  it("derives the same stable seat map in either invitation direction and detects tampering", async () => {
    const forward = await createFreshCoopSeatMap(["er-account:22", "er-account:11"]);
    const reverse = await createFreshCoopSeatMap(["er-account:11", "er-account:22"]);
    expect(forward).toEqual(reverse);
    expect(forward?.seats).toEqual([
      { seatId: 0, accountId: "er-account:11" },
      { seatId: 1, accountId: "er-account:22" },
    ]);
    expect(await validateCoopRunSeatMap(forward!)).toBe(true);
    expect(await validateCoopRunSeatMap({ ...forward!, seatMapId: "0".repeat(64) })).toBe(false);
    expect(await createFreshCoopSeatMap(["er-account:11", "er-account:11"])).toBeNull();
  });

  for (const playerCount of [2, 3, 6]) {
    it(`requires the exact ${playerCount}-seat quorum and rejects wrong, duplicate, and stale ACKs`, async () => {
      const map = await seatMap(playerCount);
      const membership = new CoopMembershipControllerV2(map, new Map(), 0);
      const target = membership.freezeAckQuorum();
      const tracker = new CoopAckQuorumTracker(target);

      expect(
        tracker.accept(
          { membershipRevision: target.membershipRevision + 1, seatId: 0, connectionGeneration: 0 },
          membership.snapshot(),
        ),
      ).toBe("membership-mismatch");
      expect(
        tracker.accept(
          { membershipRevision: target.membershipRevision, seatId: playerCount, connectionGeneration: 0 },
          membership.snapshot(),
        ),
      ).toBe("seat-not-required");

      for (let seatId = 0; seatId < playerCount; seatId++) {
        const expected = seatId === playerCount - 1 ? "complete" : "accepted";
        expect(
          tracker.accept(
            { membershipRevision: target.membershipRevision, seatId, connectionGeneration: 0 },
            membership.snapshot(),
          ),
        ).toBe(expected);
      }
      expect(
        tracker.accept(
          { membershipRevision: target.membershipRevision, seatId: 0, connectionGeneration: 0 },
          membership.snapshot(),
        ),
      ).toBe("duplicate");
      expect(tracker.pendingSeats()).toEqual([]);
    });
  }

  it("never waives a disconnected seat and accepts its retained commit only from the rebound generation", async () => {
    const map = await seatMap(3);
    const membership = new CoopMembershipControllerV2(map, new Map(), 1);
    const target = membership.freezeAckQuorum();
    const tracker = new CoopAckQuorumTracker(target);

    expect(membership.disconnect(2, 0)?.requiredAckSeats).toEqual([0, 1, 2]);
    expect(() => membership.freezeAckQuorum()).toThrow(/not active/);
    expect(
      tracker.accept(
        { membershipRevision: target.membershipRevision, seatId: 2, connectionGeneration: 0 },
        membership.snapshot(),
      ),
    ).toBe("seat-not-current");

    const secondTracker = new CoopAckQuorumTracker(target);
    expect(membership.rejoin(2, "er-account:03")?.members[2].connectionGeneration).toBe(1);
    expect(
      secondTracker.accept(
        { membershipRevision: target.membershipRevision, seatId: 2, connectionGeneration: 0 },
        membership.snapshot(),
      ),
    ).toBe("generation-mismatch");
    expect(
      secondTracker.accept(
        { membershipRevision: target.membershipRevision, seatId: 2, connectionGeneration: 1 },
        membership.snapshot(),
      ),
    ).toBe("accepted");
    expect(secondTracker.pendingSeats()).toEqual([0, 1]);
  });

  it("rejects a different account on hot rejoin and preserves every other generation", async () => {
    const map = await seatMap(6);
    const membership = new CoopMembershipControllerV2(map, new Map(), 5);
    expect(membership.disconnect(4, 0)).not.toBeNull();
    expect(membership.rejoin(4, "er-account:99")).toBeNull();
    const rebound = membership.rejoin(4, "er-account:05");
    expect(rebound?.members.map(member => member.connectionGeneration)).toEqual([0, 0, 0, 0, 1, 0]);
    expect(rebound).toMatchObject({ authoritySeatId: 5, state: "active" });
  });

  it("rejects conflicting equal-revision membership and never removes the authority or continues solo", async () => {
    const map = await seatMap(3);
    const replica = new CoopMembershipControllerV2(map, new Map(), 1);
    const equalConflict = replica.snapshot();
    equalConflict.members[0].displayName = "forged-without-a-revision";
    expect(replica.adopt(equalConflict)).toBe(false);
    expect(replica.remove(1)).toBeNull();
    expect(replica.remove(2)).not.toBeNull();
    expect(replica.remove(0)).toBeNull();
    expect(replica.snapshot().requiredAckSeats).toEqual([0, 1]);
  });

  it("authorizes frames from the channel-bound account, not a claimed seat", async () => {
    const map = await seatMap(2);
    const binding = {
      version: 1 as const,
      bindingId: "binding-1",
      sessionId: "session-1",
      runId: "run-1",
      sessionEpoch: 7,
      checkpointRevision: 3,
      seatMap: map,
      authoritySeatId: 1,
      membershipRevision: 4,
      source: "resume" as const,
    };
    const context = {
      sessionId: "session-1",
      sessionEpoch: 7,
      seatMapId: map.seatMapId,
      membershipRevision: 4,
      fromSeatId: 0,
      connectionGeneration: 2,
    };
    expect(coopFrameContextMatchesBinding(context, binding, "er-account:01", 2)).toBe(true);
    expect(coopFrameContextMatchesBinding({ ...context, fromSeatId: 1 }, binding, "er-account:01", 2)).toBe(false);
    expect(coopFrameContextMatchesBinding(context, binding, "er-account:02", 2)).toBe(false);
    expect(coopFrameContextMatchesBinding(context, binding, "er-account:01", 3)).toBe(false);
    expect(coopFrameContextMatchesBinding({ ...context, membershipRevision: 3 }, binding, "er-account:01", 2, 3)).toBe(
      true,
    );
  });
});
