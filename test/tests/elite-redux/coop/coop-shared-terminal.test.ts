/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopMembershipControllerV2 } from "#data/elite-redux/coop/coop-membership";
import type { CoopFrameContextV1, CoopRunSeatMapV1 } from "#data/elite-redux/coop/coop-session-binding";
import type { CoopSharedTerminalSupervisor } from "#data/elite-redux/coop/coop-shared-terminal";
import { createCoopRuntimeSharedTerminal } from "#data/elite-redux/coop/coop-shared-terminal-runtime";
import type { CoopMessage, CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { COOP_NO_FAULT_PROFILE, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { describe, expect, it } from "vitest";

const SESSION_ID = "session-terminal-proof";
const SEAT_MAP_ID = "a".repeat(64);
const EPOCH = 17;
const HOST_ACCOUNT = "er-account:host";
const GUEST_ACCOUNT = "er-account:guest";

const seatMap: CoopRunSeatMapV1 = {
  version: 1,
  revision: 1,
  seatMapId: SEAT_MAP_ID,
  seats: [
    { seatId: 0, accountId: HOST_ACCOUNT },
    { seatId: 1, accountId: GUEST_ACCOUNT },
  ],
};

const displayNames = new Map([
  [HOST_ACCOUNT, "Host"],
  [GUEST_ACCOUNT, "Guest"],
]);

const flushWire = async (): Promise<void> => {
  await new Promise<void>(resolve => queueMicrotask(resolve));
  await new Promise<void>(resolve => queueMicrotask(resolve));
};

class ManualScheduler {
  private now = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  readonly schedule = (callback: () => void, ms: number): (() => void) => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + ms, callback });
    return () => this.tasks.delete(id);
  };

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.tasks.entries()]
        .filter(([, candidate]) => candidate.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (next == null) {
        break;
      }
      const [id, task] = next;
      this.tasks.delete(id);
      this.now = task.at;
      task.callback();
    }
    this.now = target;
  }
}

function contextFor(membership: CoopMembershipControllerV2, seatId: 0 | 1): CoopFrameContextV1 {
  const snapshot = membership.snapshot();
  const member = snapshot.members[seatId];
  return {
    sessionId: SESSION_ID,
    sessionEpoch: EPOCH,
    seatMapId: SEAT_MAP_ID,
    membershipRevision: snapshot.revision,
    fromSeatId: seatId,
    connectionGeneration: member.connectionGeneration,
  };
}

function peerValidator(
  membership: CoopMembershipControllerV2,
  peerSeatId: 0 | 1,
): (context: CoopFrameContextV1, targetMembershipRevision: number) => boolean {
  return (context, targetMembershipRevision) => {
    const peer = membership.snapshot().members[peerSeatId];
    return (
      context.sessionId === SESSION_ID
      && context.sessionEpoch === EPOCH
      && context.seatMapId === SEAT_MAP_ID
      && context.membershipRevision === targetMembershipRevision
      && context.fromSeatId === peerSeatId
      && context.connectionGeneration === peer.connectionGeneration
    );
  };
}

function makeSupervisor(
  transport: CoopTransport,
  membership: CoopMembershipControllerV2,
  localSeatId: 0 | 1,
  scheduler: ManualScheduler,
  prepared: string[],
  finalized: string[],
  prepareResult = true,
): CoopSharedTerminalSupervisor {
  return createCoopRuntimeSharedTerminal(
    transport,
    {
      p33FrameContext: () => contextFor(membership, localSeatId),
      p33MembershipSnapshot: () => membership.snapshot(),
      validateP33PeerFrameContext: peerValidator(membership, localSeatId === 0 ? 1 : 0),
    },
    {
      onPrepare: commit => {
        prepared.push(commit.terminalId);
        if (prepareResult) {
          membership.terminate();
        }
        return prepareResult;
      },
      onFinalize: (commit, completion) => finalized.push(`${commit.terminalId}:${completion}`),
      schedule: scheduler.schedule,
      retryMs: 250,
      deadlineMs: 3_000,
      receiverGraceMs: 3_500,
    },
  );
}

const terminalStart = {
  boundary: "authority" as const,
  reasonCode: "apply-failed" as const,
  reason: "The addressed turn could not be reconstructed atomically.",
  wave: 20,
  turn: 3,
  boundaryRevision: 41,
};

describe("P33 runtime-bound generation-scoped shared terminal supervisor", () => {
  it("retains through a dropped first frame and finalizes only after exact terminal-entry evidence", async () => {
    const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x50333354 });
    const scheduler = new ManualScheduler();
    const hostMembership = new CoopMembershipControllerV2(seatMap, displayNames, 0);
    const guestMembership = new CoopMembershipControllerV2(seatMap, displayNames, 0);
    const hostPrepared: string[] = [];
    const guestPrepared: string[] = [];
    const hostFinalized: string[] = [];
    const guestFinalized: string[] = [];
    const host = makeSupervisor(pair.host, hostMembership, 0, scheduler, hostPrepared, hostFinalized);
    const guest = makeSupervisor(pair.guest, guestMembership, 1, scheduler, guestPrepared, guestFinalized);

    pair.armNextDrop("sharedTerminal", "host");
    const completed = host.begin(terminalStart);
    await flushWire();
    expect(hostPrepared).toHaveLength(1);
    expect(guestPrepared).toHaveLength(0);
    expect(hostFinalized).toHaveLength(0);

    scheduler.advance(250);
    await flushWire();
    await expect(completed).resolves.toMatchObject({ completion: "quorum", quorumReached: true });
    expect(guestPrepared).toHaveLength(1);
    expect(hostFinalized).toHaveLength(1);
    expect(guestFinalized).toHaveLength(0);

    scheduler.advance(3_500);
    expect(guestFinalized).toHaveLength(1);
    expect(hostPrepared[0]).toBe(guestPrepared[0]);
    host.dispose();
    guest.dispose();
  });

  it("rejects wrong-seat, stale-generation, and wrong-membership ACKs without retiring retention", async () => {
    const pair = createLoopbackPair();
    const scheduler = new ManualScheduler();
    const membership = new CoopMembershipControllerV2(seatMap, displayNames, 0);
    const prepared: string[] = [];
    const finalized: string[] = [];
    const host = makeSupervisor(pair.host, membership, 0, scheduler, prepared, finalized);
    const completed = host.begin(terminalStart);
    const commit = host.current()!;

    const sendAck = (overrides: Partial<Extract<CoopMessage, { t: "sharedTerminalAck" }>> = {}) => {
      const base: Extract<CoopMessage, { t: "sharedTerminalAck" }> = {
        t: "sharedTerminalAck",
        ctx: {
          ...contextFor(membership, 1),
          membershipRevision: commit.quorum.membershipRevision,
        },
        terminalId: commit.terminalId,
        terminalRevision: commit.terminalRevision,
        targetMembershipRevision: commit.quorum.membershipRevision,
        stage: "terminalEntered",
      };
      pair.guest.send({ ...base, ...overrides });
    };

    sendAck({ ctx: { ...contextFor(membership, 0), membershipRevision: commit.quorum.membershipRevision } });
    sendAck({
      ctx: {
        ...contextFor(membership, 1),
        membershipRevision: commit.quorum.membershipRevision,
        connectionGeneration: 9,
      },
    });
    sendAck({ targetMembershipRevision: commit.quorum.membershipRevision + 1 });
    await flushWire();
    expect(finalized).toHaveLength(0);
    expect(host.current()?.terminalId).toBe(commit.terminalId);

    sendAck();
    await flushWire();
    await expect(completed).resolves.toMatchObject({ completion: "quorum", quorumReached: true });
    expect(prepared).toHaveLength(1);
    expect(finalized).toHaveLength(1);
    host.dispose();
  });

  it("arbitrates simultaneous failures to the lower stable seat and prepares/finalizes once per runtime", async () => {
    const pair = createLoopbackPair();
    const scheduler = new ManualScheduler();
    const hostMembership = new CoopMembershipControllerV2(seatMap, displayNames, 0);
    const guestMembership = new CoopMembershipControllerV2(seatMap, displayNames, 0);
    const hostPrepared: string[] = [];
    const guestPrepared: string[] = [];
    const hostFinalized: string[] = [];
    const guestFinalized: string[] = [];
    const host = makeSupervisor(pair.host, hostMembership, 0, scheduler, hostPrepared, hostFinalized);
    const guest = makeSupervisor(pair.guest, guestMembership, 1, scheduler, guestPrepared, guestFinalized);

    const hostCompleted = host.begin({ ...terminalStart, reason: "Host apply failed." });
    const guestCompleted = guest.begin({
      ...terminalStart,
      boundary: "surface",
      reasonCode: "continuation-failed",
      reason: "Guest continuation surface failed.",
    });
    await flushWire();
    await expect(hostCompleted).resolves.toMatchObject({ completion: "quorum", quorumReached: true });
    expect(host.current()?.originSeatId).toBe(0);
    expect(guest.current()?.terminalId).toBe(host.current()?.terminalId);
    expect(hostPrepared).toHaveLength(1);
    expect(guestPrepared).toHaveLength(1);

    scheduler.advance(3_500);
    await expect(guestCompleted).resolves.toMatchObject({
      commit: { originSeatId: 0 },
      completion: "receiver-grace",
    });
    expect(hostFinalized).toHaveLength(1);
    expect(guestFinalized).toHaveLength(1);
    host.dispose();
    guest.dispose();
  });

  it("re-ACKs duplicate retained commits without reopening terminal preparation", async () => {
    const pair = createLoopbackPair();
    const scheduler = new ManualScheduler();
    const hostMembership = new CoopMembershipControllerV2(seatMap, displayNames, 0);
    const guestMembership = new CoopMembershipControllerV2(seatMap, displayNames, 0);
    const hostPrepared: string[] = [];
    const guestPrepared: string[] = [];
    const hostFinalized: string[] = [];
    const guestFinalized: string[] = [];
    let acknowledgements = 0;
    pair.host.onMessage(message => {
      if (message.t === "sharedTerminalAck") {
        acknowledgements++;
      }
    });
    const host = makeSupervisor(pair.host, hostMembership, 0, scheduler, hostPrepared, hostFinalized);
    const guest = makeSupervisor(pair.guest, guestMembership, 1, scheduler, guestPrepared, guestFinalized);
    await host.begin(terminalStart);
    await flushWire();
    const commit = host.current()!;
    const ctx = { ...contextFor(hostMembership, 0), membershipRevision: commit.quorum.membershipRevision };
    pair.host.send({ t: "sharedTerminal", ctx, commit });
    pair.host.send({ t: "sharedTerminal", ctx, commit });
    await flushWire();
    expect(guestPrepared).toHaveLength(1);
    expect(acknowledgements).toBeGreaterThanOrEqual(3);

    scheduler.advance(3_500);
    expect(guestFinalized).toHaveLength(1);
    host.dispose();
    guest.dispose();
  });

  it("never emits terminal-entry evidence when local preparation fails", async () => {
    const pair = createLoopbackPair();
    const scheduler = new ManualScheduler();
    const hostMembership = new CoopMembershipControllerV2(seatMap, displayNames, 0);
    const guestMembership = new CoopMembershipControllerV2(seatMap, displayNames, 0);
    const hostPrepared: string[] = [];
    const guestPrepared: string[] = [];
    const hostFinalized: string[] = [];
    const guestFinalized: string[] = [];
    let acknowledgements = 0;
    pair.host.onMessage(message => {
      if (message.t === "sharedTerminalAck") {
        acknowledgements++;
      }
    });
    const host = makeSupervisor(pair.host, hostMembership, 0, scheduler, hostPrepared, hostFinalized);
    const guest = makeSupervisor(pair.guest, guestMembership, 1, scheduler, guestPrepared, guestFinalized, false);

    const completed = host.begin(terminalStart);
    await flushWire();
    expect(guestPrepared).toHaveLength(1);
    expect(acknowledgements).toBe(0);
    scheduler.advance(3_000);
    await expect(completed).resolves.toMatchObject({ completion: "deadline", quorumReached: false });
    scheduler.advance(500);
    expect(hostFinalized).toHaveLength(1);
    expect(guestFinalized).toHaveLength(1);
    host.dispose();
    guest.dispose();
  });

  it("fails closed at an absolute deadline when no peer evidence can arrive", async () => {
    const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x44454144 });
    const scheduler = new ManualScheduler();
    const membership = new CoopMembershipControllerV2(seatMap, displayNames, 0);
    const prepared: string[] = [];
    const finalized: string[] = [];
    const host = makeSupervisor(pair.host, membership, 0, scheduler, prepared, finalized);
    for (let index = 0; index < 20; index++) {
      pair.armNextDrop("sharedTerminal", "host");
    }
    const completed = host.begin(terminalStart);
    await flushWire();
    scheduler.advance(3_000);
    await expect(completed).resolves.toMatchObject({ completion: "deadline", quorumReached: false });
    expect(prepared).toHaveLength(1);
    expect(finalized).toHaveLength(1);
    host.dispose();
  });
});
