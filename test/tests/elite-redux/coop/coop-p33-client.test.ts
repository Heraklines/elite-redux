/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopLobbyController } from "#data/elite-redux/coop/coop-lobby";
import {
  announceToP33Lobby,
  type CoopP33ClientDependencies,
  CoopP33HttpError,
  type CoopP33LobbyCredentialV1,
  endP33Run,
  fetchP33Lobby,
  heartbeatP33Run,
  leaveP33Lobby,
  leaveP33Run,
  pollP33Signal,
  pushP33Signal,
  rejoinP33Run,
  requestP33Player,
  respondToP33Request,
} from "#data/elite-redux/coop/coop-p33-client";
import { createFreshCoopP33Context, createFreshCoopSeatMap } from "#data/elite-redux/coop/coop-session-binding";
import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { COOP_PROTOCOL_VERSION, type CoopMessage, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { coopP33GameplayRole } from "#data/elite-redux/coop/coop-webrtc-connect";
import { afterEach, describe, expect, it, vi } from "vitest";

const identity = {
  version: 1 as const,
  accountId: "er-account:20",
  displayName: "Alice",
  canonicalUsername: "alice",
};
const peer = {
  accountId: "er-account:10",
  displayName: "Bob",
  canonicalUsername: "bob",
  connectionGeneration: 0,
};
const token = "A".repeat(43);
const nonce = "client_nonce_1234567890ABCDE";

function ticketResponse(overrides: Partial<typeof identity> = {}) {
  return {
    ticket: "signed-ticket",
    identity: { ...identity, ...overrides },
    expiresAt: Date.now() + 60_000,
  };
}

function pairing(overrides: Record<string, unknown> = {}) {
  return {
    code: "PAIR33",
    pairingId: "PAIR33",
    transportRole: "answerer",
    connectionGeneration: 0,
    account: {
      accountId: identity.accountId,
      displayName: identity.displayName,
      canonicalUsername: identity.canonicalUsername,
    },
    peer,
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function baseDependencies(fetcher: typeof fetch): CoopP33ClientDependencies {
  return {
    fetch: fetcher,
    getIdentityTicket: async () => [ticketResponse(), 200],
    createClientNonce: () => nonce,
    retryDelay: async () => {},
    serverBase: () => "https://coop.example.test",
  };
}

const credential: CoopP33LobbyCredentialV1 = {
  presenceId: "p33_presence",
  pairingToken: token,
  identity,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("authenticated P33 browser client", () => {
  it("retries a lost announce response with the exact same ticket and random client nonce", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let attempt = 0;
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      attempt++;
      if (attempt === 1) {
        throw new TypeError("response lost");
      }
      return response({
        presenceId: "p33_presence",
        pairingToken: token,
        identity,
        pairing: null,
      });
    };
    const getIdentityTicket = vi.fn(
      async (): Promise<[ReturnType<typeof ticketResponse>, number]> => [ticketResponse(), 200],
    );
    const announced = await announceToP33Lobby({
      ...baseDependencies(fetcher),
      getIdentityTicket,
    });

    expect(announced).toMatchObject({ presenceId: "p33_presence", identity, pairing: null });
    expect(getIdentityTicket).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/coop/v3/lobby/announce");
    expect(calls[0].init?.body).toBe(calls[1].init?.body);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ticket: "signed-ticket", clientNonce: nonce });
    expect(new Headers(calls[0].init?.headers).has("Authorization")).toBe(false);
  });

  it("bearer-authenticates every lobby, signal, heartbeat, leave, and terminal request", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      const url = String(input);
      if (url.includes("/lobby?")) {
        return response({ players: [], pairing: null, request: null, declined: null });
      }
      if (url.endsWith("/lobby/respond")) {
        return response(pairing({ transportRole: "offerer" }));
      }
      if (url.includes("/signal?") && init?.method === "GET") {
        return response({ signal: "peer-sdp" });
      }
      if (url.endsWith("/heartbeat")) {
        return response({ state: "active", bothPresent: true, partnerPresent: true, connectionGeneration: 0 });
      }
      return response({ ok: true });
    };
    const deps = baseDependencies(fetcher);

    await fetchP33Lobby(credential, deps);
    await requestP33Player(credential, "target", deps);
    await respondToP33Request(credential, "from", true, deps);
    await leaveP33Lobby(credential, deps);
    await pushP33Signal(credential, "PAIR33", "local-sdp", deps);
    await pollP33Signal(credential, "PAIR33", deps);
    await heartbeatP33Run(credential, "PAIR33", deps);
    await leaveP33Run(credential, "PAIR33", deps);
    await endP33Run(credential, "PAIR33", deps);

    expect(calls).toHaveLength(9);
    expect(calls.every(call => new Headers(call.init?.headers).get("Authorization") === `Bearer ${token}`)).toBe(true);
    expect(calls.every(call => call.url.includes("/coop/v3/"))).toBe(true);
  });

  it("rejects spoofed display identity and a pairing bound to another account", async () => {
    const spoofedAnnounce = baseDependencies(async () =>
      response({
        presenceId: "p33_presence",
        pairingToken: token,
        identity: { ...identity, displayName: "Mallory" },
        pairing: null,
      }),
    );
    await expect(announceToP33Lobby(spoofedAnnounce)).rejects.toThrow(/identity binding response/i);

    const wrongPairing = baseDependencies(async () =>
      response({
        players: [],
        pairing: pairing({
          account: {
            accountId: "er-account:99",
            displayName: "Mallory",
            canonicalUsername: "mallory",
          },
        }),
        request: null,
        declined: null,
      }),
    );
    await expect(fetchP33Lobby(credential, wrongPairing)).rejects.toThrow(/changed authenticated identity/i);
  });

  it("retries the exact rejoin transaction, surfaces third-account rejection, and rejects stale bearers", async () => {
    const bodies: string[] = [];
    const auth: string[] = [];
    let attempt = 0;
    const retryDeps = baseDependencies(async (_input, init) => {
      bodies.push(String(init?.body));
      auth.push(new Headers(init?.headers).get("Authorization") ?? "");
      attempt++;
      if (attempt === 1) {
        throw new TypeError("response lost");
      }
      return response({
        presenceId: "p33_rejoined",
        pairingToken: "B".repeat(43),
        identity,
        pairing: pairing({ connectionGeneration: 1 }),
      });
    });
    const rebound = await rejoinP33Run("PAIR33", credential, retryDeps);
    expect(rebound.pairing.connectionGeneration).toBe(1);
    expect(bodies[0]).toBe(bodies[1]);
    expect(auth).toEqual([`Bearer ${token}`, `Bearer ${token}`]);

    const thirdAccount = baseDependencies(async () => response({ error: "ticket account is not a run member" }, 403));
    await expect(rejoinP33Run("PAIR33", credential, thirdAccount)).rejects.toMatchObject({ status: 403 });

    const stale = baseDependencies(async () => response({ error: "invalid pairing credential" }, 401));
    await expect(fetchP33Lobby(credential, stale)).rejects.toBeInstanceOf(CoopP33HttpError);
  });

  it("keeps stable seats and authority invariant under reversed invitations", async () => {
    const alice = { ...identity, accountId: "er-account:20" };
    const bob = { version: 1 as const, accountId: "er-account:10", displayName: "Bob", canonicalUsername: "bob" };
    const asAnswerer = createFreshCoopP33Context({
      pairingId: "PAIR33",
      pairingBearer: token,
      transportRole: "answerer",
      account: alice,
      peerAccount: bob,
      connectionGeneration: 0,
      peerConnectionGeneration: 0,
    });
    const asOfferer = createFreshCoopP33Context({
      pairingId: "PAIR34",
      pairingBearer: token,
      transportRole: "offerer",
      account: alice,
      peerAccount: bob,
      connectionGeneration: 0,
      peerConnectionGeneration: 0,
    });
    const seatMapForward = await createFreshCoopSeatMap([alice.accountId, bob.accountId]);
    const seatMapReversed = await createFreshCoopSeatMap([bob.accountId, alice.accountId]);

    expect(asAnswerer).toMatchObject({ localSeatId: 1, authoritySeatId: 0, transportRole: "answerer" });
    expect(asOfferer).toMatchObject({ localSeatId: 1, authoritySeatId: 0, transportRole: "offerer" });
    expect(coopP33GameplayRole(asAnswerer!)).toBe("guest");
    expect(coopP33GameplayRole(asOfferer!)).toBe("guest");
    expect(seatMapForward).toEqual(seatMapReversed);
  });

  it("sends authenticated P33 hello/binding without exposing the signaling bearer", async () => {
    const authority = {
      version: 1 as const,
      accountId: "er-account:10",
      displayName: "Authority",
      canonicalUsername: "authority",
    };
    const replica = {
      version: 1 as const,
      accountId: "er-account:20",
      displayName: "Replica",
      canonicalUsername: "replica",
    };
    const context = createFreshCoopP33Context({
      pairingId: "PAIR33",
      pairingBearer: token,
      transportRole: "answerer",
      account: authority,
      peerAccount: replica,
      connectionGeneration: 0,
      peerConnectionGeneration: 0,
    });
    expect(context).not.toBeNull();
    const { host: local, guest: remote } = createLoopbackPair();
    const received: CoopMessage[] = [];
    remote.onMessage(message => received.push(message));
    const controller = new CoopSessionController(local, {
      version: COOP_PROTOCOL_VERSION,
      p33: context!,
      localCapabilities: [],
    });
    controller.connect();
    await Promise.resolve();

    const hello = received.find(message => message.t === "hello");
    expect(hello).toMatchObject({
      t: "hello",
      pairingId: "PAIR33",
      account: { accountId: authority.accountId },
      transportRole: "answerer",
      authorityClaim: "authority",
    });
    expect(JSON.stringify(hello)).not.toContain(token);

    remote.send({
      t: "hello",
      version: "er-coop-36",
      pairingId: "PAIR33",
      account: replica,
      transportRole: "offerer",
      authorityClaim: "replica",
      capabilities: [],
    });
    await Promise.resolve();
    const decisionPromise = controller.sendResumeStartNew(2_000);
    let bindingMessage = received.find(
      (message): message is Extract<CoopMessage, { t: "sessionBinding" }> => message.t === "sessionBinding",
    );
    for (let attempt = 0; bindingMessage == null && attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      bindingMessage = received.find(
        (message): message is Extract<CoopMessage, { t: "sessionBinding" }> => message.t === "sessionBinding",
      );
    }
    expect(bindingMessage?.binding).toMatchObject({
      version: 1,
      authoritySeatId: 0,
      membershipRevision: 1,
      seatMap: {
        seats: [
          { seatId: 0, accountId: authority.accountId },
          { seatId: 1, accountId: replica.accountId },
        ],
      },
    });
    expect(JSON.stringify(bindingMessage)).not.toContain(token);

    remote.send({
      t: "sessionBindingAck",
      bindingId: bindingMessage!.binding.bindingId,
      seatId: 1,
      accountId: replica.accountId,
      accepted: true,
    });
    const start = received.find(
      (message): message is Extract<CoopMessage, { t: "resumeStartNew" }> => message.t === "resumeStartNew",
    );
    remote.send({ t: "resumeDecisionAck", decisionId: start!.decisionId });
    await expect(decisionPromise).resolves.toBe(true);
    expect(controller.authenticatedBinding?.seatMap.seatMapId).toBe(bindingMessage!.binding.seatMap.seatMapId);
    expect(controller.isAuthority).toBe(true);
    expect(controller.transportRole).toBe("answerer");

    const beforeRejoin = {
      binding: controller.authenticatedBinding,
      epoch: controller.sessionEpoch,
      runId: controller.runId,
      seat: controller.localSeatId,
      authority: controller.authoritySeatId,
    };
    const rejoinedContext = createFreshCoopP33Context({
      pairingId: "PAIR33",
      pairingBearer: "B".repeat(43),
      transportRole: "answerer",
      account: { ...authority, displayName: "Authority Renamed" },
      peerAccount: replica,
      connectionGeneration: 1,
      peerConnectionGeneration: 0,
    });
    expect(controller.adoptP33Rejoin(rejoinedContext!)).toBe(true);
    expect(controller.authenticatedBinding).toEqual(beforeRejoin.binding);
    expect(controller.sessionEpoch).toBe(beforeRejoin.epoch);
    expect(controller.runId).toBe(beforeRejoin.runId);
    expect(controller.localSeatId).toBe(beforeRejoin.seat);
    expect(controller.authoritySeatId).toBe(beforeRejoin.authority);
    expect(controller.p33FrameContext()).toBeNull();
    controller.resyncLobbyState();
    await Promise.resolve();
    remote.send({
      t: "sessionBindingAck",
      bindingId: bindingMessage!.binding.bindingId,
      seatId: 1,
      accountId: replica.accountId,
      accepted: true,
    });
    await Promise.resolve();
    expect(controller.p33FrameContext()).toBeNull();
    remote.send({
      t: "hello",
      version: "er-coop-36",
      pairingId: "PAIR33",
      account: replica,
      transportRole: "offerer",
      authorityClaim: "replica",
      capabilities: [],
      existingBinding: {
        sessionId: beforeRejoin.binding!.sessionId,
        runId: beforeRejoin.binding!.runId!,
        sessionEpoch: beforeRejoin.binding!.sessionEpoch,
        seatMapId: beforeRejoin.binding!.seatMap.seatMapId,
        authoritySeatId: beforeRejoin.binding!.authoritySeatId,
        membershipRevision: beforeRejoin.binding!.membershipRevision,
      },
    });
    await Promise.resolve();
    remote.send({
      t: "sessionBindingAck",
      bindingId: bindingMessage!.binding.bindingId,
      seatId: 1,
      accountId: replica.accountId,
      accepted: true,
    });
    await Promise.resolve();
    expect(controller.p33FrameContext()).toMatchObject({
      fromSeatId: 0,
      connectionGeneration: 1,
      sessionEpoch: beforeRejoin.epoch,
    });
    controller.dispose();
    local.close();
    remote.close();
  });

  it("never probes or falls back to legacy routes after P33 selection", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async input => {
      urls.push(String(input));
      return response({ error: "not found" }, 404);
    };
    const onError = vi.fn();
    const controller = new CoopLobbyController(
      "Caller supplied name",
      { onPlayers: vi.fn(), onConnecting: vi.fn(), onConnected: vi.fn(), onError },
      { protocol: "p33", p33Dependencies: baseDependencies(fetcher) },
    );

    await controller.start();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/coop/v3/lobby/announce");
    expect(urls.some(url => /\/coop\/lobby(?!\/announce)/u.test(url))).toBe(false);
  });
});
