/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  awaitCoopPublicLaunchSurface,
  isCoopPublicLaunchSurfaceReady,
} from "#data/elite-redux/coop/coop-launch-surface";
import {
  type CoopFreshRunDecisionAddress,
  CoopSessionController,
} from "#data/elite-redux/coop/coop-session-controller";
import type {
  CoopConnectionState,
  CoopMessage,
  CoopResumeCommitment,
  CoopRole,
  CoopTransport,
} from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { describe, expect, it } from "vitest";

const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

class DecisionTransport implements CoopTransport {
  readonly role: CoopRole;
  readonly sent: CoopMessage[] = [];
  private peer: DecisionTransport | null = null;
  private currentState: CoopConnectionState = "connected";
  private readonly messageHandlers = new Set<(message: CoopMessage) => void>();
  private readonly stateHandlers = new Set<(state: CoopConnectionState) => void>();

  constructor(role: CoopRole) {
    this.role = role;
  }

  pair(peer: DecisionTransport): void {
    this.peer = peer;
  }

  get state(): CoopConnectionState {
    return this.currentState;
  }

  setConnected(connected: boolean): void {
    const next: CoopConnectionState = connected ? "connected" : "disconnected";
    if (next === this.currentState) {
      return;
    }
    this.currentState = next;
    for (const handler of this.stateHandlers) {
      handler(next);
    }
  }

  send(message: CoopMessage): void {
    this.sent.push(message);
    if (this.currentState !== "connected" || this.peer == null) {
      return;
    }
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer.currentState !== "connected") {
        return;
      }
      peer.deliver(message);
    });
  }

  deliver(message: CoopMessage): void {
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  onMessage(handler: (message: CoopMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: (state: CoopConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  close(): void {
    this.currentState = "closed";
    this.messageHandlers.clear();
    this.stateHandlers.clear();
  }
}

function makePair(): {
  hostWire: DecisionTransport;
  guestWire: DecisionTransport;
  host: CoopSessionController;
  guest: CoopSessionController;
} {
  const hostWire = new DecisionTransport("host");
  const guestWire = new DecisionTransport("guest");
  hostWire.pair(guestWire);
  guestWire.pair(hostWire);
  const host = new CoopSessionController(hostWire, { username: "Host", tiebreak: 1 });
  const guest = new CoopSessionController(guestWire, { username: "Guest", tiebreak: 2 });
  host.connect();
  guest.connect();
  return { hostWire, guestWire, host, guest };
}

function commitment(wave: number): CoopResumeCommitment {
  return {
    version: 1,
    digest: wave.toString(16).padStart(64, "0"),
    gameMode: GameModes.COOP,
    wave,
    revision: wave,
    runId: `resume-run-${"r".repeat(24)}`,
    checkpointRevision: wave,
    timestamp: wave * 1_000,
    participants: ["Guest", "Host"],
    seats: { host: "Host", guest: "Guest" },
  };
}

describe("co-op lobby public-surface authority", () => {
  it("requires the exact phase, UI mode, and active handler and fails bounded when the session changes", async () => {
    const expected = { phaseName: "SelectStarterPhase", uiMode: 17 };
    const probe = { phaseName: "SelectStarterPhase", uiMode: 17, handlerActive: false };
    expect(isCoopPublicLaunchSurfaceReady(probe, expected), "a queued/inactive UI is not continuation-ready").toBe(
      false,
    );

    const opened = awaitCoopPublicLaunchSurface({
      expected,
      read: () => probe,
      isCurrent: () => true,
      timeoutMs: 100,
      pollMs: 1,
    });
    queueMicrotask(() => {
      probe.handlerActive = true;
    });
    await expect(opened, "the exact public input surface completes the bounded proof").resolves.toBe(true);

    await expect(
      awaitCoopPublicLaunchSurface({
        expected,
        read: () => probe,
        isCurrent: () => false,
        timeoutMs: 100,
      }),
      "a replaced session cannot satisfy a late public-surface callback",
    ).resolves.toBe(false);
  });

  it("retains a fresh decision through reconnect but ACKs only after its public team surface is ready", async () => {
    const { hostWire, guestWire, host, guest } = makePair();
    await flush();
    await flush();

    let surfaceCalls = 0;
    let markSurfaceReady!: (ready: boolean) => void;
    const publicSurface = new Promise<boolean>(resolve => {
      markSurfaceReady = resolve;
    });
    let appliedAddress: CoopFreshRunDecisionAddress | null = null;
    guest.armResumeStartNewHandler(address => {
      surfaceCalls++;
      appliedAddress = address;
      return publicSurface;
    });

    const committed = host.sendResumeStartNew(1_000);
    let hostAdvanced = false;
    void committed.then(result => {
      hostAdvanced = result;
    });
    await flush();
    await flush();
    expect(surfaceCalls).toBe(1);
    expect(hostAdvanced, "wire receipt cannot release the host").toBe(false);
    expect(guestWire.sent.some(message => message.t === "resumeDecisionAck")).toBe(false);

    const decision = hostWire.sent.find(
      (message): message is Extract<CoopMessage, { t: "resumeStartNew" }> => message.t === "resumeStartNew",
    );
    expect(decision).toBeDefined();
    expect(appliedAddress).toEqual({
      decisionId: decision!.decisionId,
      epoch: decision!.epoch,
      runId: decision!.runId,
      checkpointRevision: decision!.checkpointRevision,
    });

    // A delayed old result cannot resolve the live decision, and duplicate/reconnect carriers
    // cannot invoke the public UI twice while its first transition is still in flight.
    hostWire.deliver({ t: "resumeDecisionAck", decisionId: "older-decision" });
    guestWire.deliver(decision!);
    hostWire.setConnected(false);
    guestWire.setConnected(false);
    guestWire.setConnected(true);
    hostWire.setConnected(true);
    await flush();
    await flush();
    expect(surfaceCalls).toBe(1);
    expect(hostAdvanced).toBe(false);

    markSurfaceReady(true);
    await flush();
    await expect(committed).resolves.toBe(true);
    expect(hostAdvanced).toBe(true);

    const ackCount = guestWire.sent.filter(message => message.t === "resumeDecisionAck").length;
    guestWire.deliver(decision!);
    await flush();
    expect(surfaceCalls, "a duplicate committed decision never reopens team selection").toBe(1);
    expect(
      guestWire.sent.filter(message => message.t === "resumeDecisionAck").length,
      "a duplicate exact decision is re-ACKed for a recovering host",
    ).toBe(ackCount + 1);

    host.dispose();
    guest.dispose();
  });

  it("surfaces and commits only the exact matching resumable save", async () => {
    const { hostWire, host, guest, guestWire } = makePair();
    await flush();
    await flush();
    const exact = commitment(20);
    let surfaced: CoopResumeCommitment | null = null;
    let surfaceCount = 0;
    guest.armResumeOfferHandler(commitmentValue => {
      surfaceCount++;
      surfaced = commitmentValue;
    });

    const offerResult = host.offerResume(exact, 1_000);
    await flush();
    expect(surfaced, "the matching save opens the guest's public Resume surface").toEqual(exact);
    const guestAccepted = guest.replyResume(true, 1_000);
    await expect(offerResult).resolves.toBe(true);
    await expect(guestAccepted, "guest crosses only after the exact host ACCEPT commit").resolves.toBe(true);

    const hostApplied = host.awaitResumeApplied(1_000);
    const guestDelivered = guest.reportResumeApplied(true, 1_000);
    await flush();
    await expect(hostApplied).resolves.toBe(true);
    await expect(guestDelivered).resolves.toBe(true);

    const guestRelease = guest.awaitResumeGameplayRelease(1_000);
    const hostRelease = host.releaseResumeGameplay(1_000);
    await flush();
    await expect(guestRelease).resolves.toBe(true);
    await expect(hostRelease).resolves.toBe(true);

    const originalOffer = hostWire.sent.find(
      (message): message is Extract<CoopMessage, { t: "resumeOffer" }> => message.t === "resumeOffer",
    );
    expect(originalOffer).toBeDefined();
    guestWire.deliver(originalOffer!);
    expect(surfaceCount, "settled duplicate traffic cannot reopen the accepted public surface").toBe(1);

    host.dispose();
    guest.dispose();
  });

  it("rejects mismatched and stale save offers before they can open a public Resume surface", async () => {
    const { host, guest, guestWire } = makePair();
    await flush();
    await flush();
    let surfaced = 0;
    guest.armResumeOfferHandler(() => {
      surfaced++;
    });
    const exact = commitment(30);
    const foreign: CoopResumeCommitment = {
      ...exact,
      participants: ["Guest", "Other"],
      seats: { host: "Other", guest: "Guest" },
    };
    guestWire.deliver({
      t: "resumeOffer",
      decisionId: "foreign",
      epoch: guest.sessionEpoch,
      commitment: foreign,
    });
    guestWire.deliver({
      t: "resumeOffer",
      decisionId: "stale",
      epoch: guest.sessionEpoch - 1,
      commitment: exact,
    });
    expect(surfaced).toBe(0);
    await expect(host.offerResume(foreign, 10), "host also refuses a foreign save before transmission").resolves.toBe(
      false,
    );

    const valid = host.offerResume(exact, 1_000);
    await flush();
    expect(surfaced).toBe(1);
    await guest.replyResume(false);
    await expect(valid).resolves.toBe(false);

    host.dispose();
    guest.dispose();
  });

  it("fails both sides bounded when the fresh public surface cannot open", async () => {
    const { hostWire, guestWire, host, guest } = makePair();
    await flush();
    await flush();
    let attempts = 0;
    guest.armResumeStartNewHandler(() => {
      attempts++;
      return false;
    });

    const committed = host.sendResumeStartNew(10);
    await expect(committed, "host never silently advances without continuation readiness").resolves.toBe(false);
    expect(guestWire.sent.some(message => message.t === "resumeDecisionAck")).toBe(false);

    const decision = hostWire.sent.find(
      (message): message is Extract<CoopMessage, { t: "resumeStartNew" }> => message.t === "resumeStartNew",
    );
    expect(decision).toBeDefined();
    guestWire.deliver(decision!);
    guest.armResumeStartNewHandler(() => {
      attempts++;
      return true;
    });
    await flush();
    expect(attempts, "a failed exact application is terminal, not an unbounded re-entry loop").toBe(1);

    host.dispose();
    guest.dispose();
  });
});
