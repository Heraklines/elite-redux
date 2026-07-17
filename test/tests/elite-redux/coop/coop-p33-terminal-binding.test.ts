/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  type CoopAccountIdentityV1,
  type CoopFrameContextV1,
  type CoopP33AuthenticatedContextV1,
  createFreshCoopP33Context,
} from "#data/elite-redux/coop/coop-session-binding";
import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { hasBoundCoopSharedTerminal } from "#data/elite-redux/coop/coop-shared-terminal-runtime";
import { COOP_PROTOCOL_VERSION, type CoopMessage, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

const authority: CoopAccountIdentityV1 = {
  version: 1,
  accountId: "er-account:10",
  displayName: "Authority",
  canonicalUsername: "authority",
};

const replica: CoopAccountIdentityV1 = {
  version: 1,
  accountId: "er-account:20",
  displayName: "Replica",
  canonicalUsername: "replica",
};

function authenticatedContext(overrides: Partial<CoopP33AuthenticatedContextV1> = {}): CoopP33AuthenticatedContextV1 {
  const context = createFreshCoopP33Context({
    pairingId: "PAIR33TERMINAL",
    pairingBearer: "A".repeat(43),
    transportRole: "answerer",
    account: authority,
    peerAccount: replica,
    connectionGeneration: 4,
    peerConnectionGeneration: 7,
  });
  if (context == null) {
    throw new Error("P33 test context was rejected");
  }
  return { ...context, ...overrides };
}

async function waitForMessage<T extends CoopMessage>(
  received: CoopMessage[],
  predicate: (message: CoopMessage) => message is T,
): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const found = received.find(predicate);
    if (found != null) {
      return found;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error("expected P33 fixture message was not sent");
}

async function bindAuthority(context = authenticatedContext()) {
  const { host: local, guest: remote } = createLoopbackPair();
  const received: CoopMessage[] = [];
  remote.onMessage(message => received.push(message));
  const controller = new CoopSessionController(local, {
    version: COOP_PROTOCOL_VERSION,
    p33: context,
    localCapabilities: [],
  });

  remote.send({
    t: "hello",
    version: COOP_PROTOCOL_VERSION,
    pairingId: context.pairingId,
    account: context.peerAccount,
    transportRole: "offerer",
    authorityClaim: "replica",
    capabilities: [],
  });
  await Promise.resolve();

  const startPromise = controller.sendResumeStartNew(2_000);
  const start = await waitForMessage(
    received,
    (message): message is Extract<CoopMessage, { t: "resumeStartNew" }> => message.t === "resumeStartNew",
  );
  remote.send({ t: "resumeDecisionAck", decisionId: start.decisionId });

  const binding = await waitForMessage(
    received,
    (message): message is Extract<CoopMessage, { t: "sessionBinding" }> => message.t === "sessionBinding",
  );
  remote.send({
    t: "sessionBindingAck",
    bindingId: binding.binding.bindingId,
    seatId: 1,
    accountId: replica.accountId,
    accepted: true,
  });
  await expect(startPromise).resolves.toBe(true);
  await Promise.resolve();

  return { controller, local, remote, received, binding: binding.binding };
}

describe("P33 authenticated terminal binding adapter", () => {
  it("fails closed for legacy and authenticated-but-unbound sessions", () => {
    const legacyPair = createLoopbackPair();
    const legacy = new CoopSessionController(legacyPair.host);
    const frame: CoopFrameContextV1 = {
      sessionId: "p33-session:unbound:1",
      sessionEpoch: 1,
      seatMapId: "0".repeat(64),
      membershipRevision: 1,
      fromSeatId: 1,
      connectionGeneration: 0,
    };
    expect(hasBoundCoopSharedTerminal(legacy)).toBe(false);
    expect(legacy.p33MembershipSnapshot()).toBeNull();
    expect(legacy.validateP33PeerFrameContext(frame, 1)).toBe(false);

    const pendingPair = createLoopbackPair();
    const pending = new CoopSessionController(pendingPair.host, { p33: authenticatedContext() });
    expect(hasBoundCoopSharedTerminal(pending)).toBe(false);
    expect(pending.p33MembershipSnapshot()).toBeNull();
    expect(pending.validateP33PeerFrameContext(frame, 1)).toBe(false);

    legacy.dispose();
    pending.dispose();
    legacyPair.host.close();
    legacyPair.guest.close();
    pendingPair.host.close();
    pendingPair.guest.close();
  });

  it("maps stable authenticated seats and rejects every forged frame axis", async () => {
    const fixture = await bindAuthority();
    const { controller, binding } = fixture;
    expect(hasBoundCoopSharedTerminal(controller)).toBe(true);
    const membership = controller.p33MembershipSnapshot();
    expect(membership).toEqual({
      version: 2,
      revision: binding.membershipRevision,
      authoritySeatId: 0,
      state: "active",
      members: [
        {
          seatId: 0,
          accountId: authority.accountId,
          displayName: authority.displayName,
          state: "present",
          connectionGeneration: 4,
        },
        {
          seatId: 1,
          accountId: replica.accountId,
          displayName: replica.displayName,
          state: "present",
          connectionGeneration: 7,
        },
      ],
      requiredAckSeats: [0, 1],
    });

    const local = controller.p33FrameContext();
    expect(local).not.toBeNull();
    const peer: CoopFrameContextV1 = {
      ...local!,
      fromSeatId: 1,
      connectionGeneration: 7,
    };
    expect(controller.validateP33PeerFrameContext(peer, membership!.revision)).toBe(true);

    const forged = [
      { ...peer, fromSeatId: 0 },
      { ...peer, sessionId: `${peer.sessionId}:forged` },
      { ...peer, sessionEpoch: peer.sessionEpoch + 1 },
      { ...peer, seatMapId: "f".repeat(64) },
      { ...peer, membershipRevision: peer.membershipRevision + 1 },
      { ...peer, connectionGeneration: peer.connectionGeneration - 1 },
      { ...peer, connectionGeneration: peer.connectionGeneration + 1 },
    ];
    for (const context of forged) {
      expect(controller.validateP33PeerFrameContext(context, membership!.revision)).toBe(false);
    }
    expect(controller.validateP33PeerFrameContext({ ...peer, membershipRevision: 2 }, 2)).toBe(false);

    fixture.controller.dispose();
    fixture.local.close();
    fixture.remote.close();
  });

  it("accepts only current hot-rejoin generations while preserving the frozen binding", async () => {
    const fixture = await bindAuthority();
    const before = fixture.controller.p33MembershipSnapshot()!;
    const oldPeerFrame: CoopFrameContextV1 = {
      ...fixture.controller.p33FrameContext()!,
      fromSeatId: 1,
      connectionGeneration: 7,
    };
    const rejoined = authenticatedContext({
      pairingBearer: "B".repeat(43),
      account: { ...authority, displayName: "Authority Renamed" },
      connectionGeneration: 5,
      peerConnectionGeneration: 8,
    });
    expect(fixture.controller.adoptP33Rejoin(rejoined)).toBe(true);
    expect(fixture.controller.p33MembershipSnapshot()).toBeNull();
    expect(fixture.controller.validateP33PeerFrameContext(oldPeerFrame, before.revision)).toBe(false);

    const forgedAccount = authenticatedContext({
      pairingBearer: "C".repeat(43),
      account: rejoined.account,
      peerAccount: { ...replica, accountId: "er-account:forged" },
      connectionGeneration: 6,
      peerConnectionGeneration: 9,
    });
    expect(fixture.controller.adoptP33Rejoin(forgedAccount)).toBe(false);

    fixture.controller.resyncLobbyState();
    fixture.remote.send({
      t: "hello",
      version: COOP_PROTOCOL_VERSION,
      pairingId: rejoined.pairingId,
      account: rejoined.peerAccount,
      transportRole: "offerer",
      authorityClaim: "replica",
      capabilities: [],
      existingBinding: {
        sessionId: fixture.binding.sessionId,
        runId: fixture.binding.runId!,
        sessionEpoch: fixture.binding.sessionEpoch,
        seatMapId: fixture.binding.seatMap.seatMapId,
        authoritySeatId: fixture.binding.authoritySeatId,
        membershipRevision: fixture.binding.membershipRevision,
      },
    });
    await Promise.resolve();
    fixture.remote.send({
      t: "sessionBindingAck",
      bindingId: fixture.binding.bindingId,
      seatId: 1,
      accountId: replica.accountId,
      accepted: true,
    });
    await Promise.resolve();

    const after = fixture.controller.p33MembershipSnapshot();
    expect(after).toMatchObject({
      revision: before.revision + 1,
      authoritySeatId: before.authoritySeatId,
      requiredAckSeats: before.requiredAckSeats,
      members: [
        {
          seatId: 0,
          accountId: authority.accountId,
          displayName: "Authority Renamed",
          connectionGeneration: 5,
        },
        { seatId: 1, accountId: replica.accountId, connectionGeneration: 8 },
      ],
    });
    expect(fixture.controller.authenticatedBinding).toEqual(fixture.binding);
    expect(fixture.controller.p33FrameContext()).toMatchObject({
      sessionId: oldPeerFrame.sessionId,
      sessionEpoch: oldPeerFrame.sessionEpoch,
      seatMapId: oldPeerFrame.seatMapId,
      membershipRevision: before.revision + 1,
      fromSeatId: 0,
      connectionGeneration: 5,
    });
    expect(fixture.controller.validateP33PeerFrameContext(oldPeerFrame, before.revision)).toBe(false);
    expect(
      fixture.controller.validateP33PeerFrameContext({ ...oldPeerFrame, connectionGeneration: 8 }, before.revision),
    ).toBe(true);
    expect(
      fixture.controller.validateP33PeerFrameContext(
        { ...oldPeerFrame, membershipRevision: before.revision + 1, connectionGeneration: 8 },
        before.revision + 1,
      ),
    ).toBe(true);

    fixture.controller.dispose();
    fixture.local.close();
    fixture.remote.close();
  });
});
