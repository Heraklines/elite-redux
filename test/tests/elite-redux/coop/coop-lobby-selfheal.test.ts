/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op LOBBY self-healing handshake (#868). The live strand: the lobby-critical
// state (runConfig, roster, ready) crossed the wire ONE-SHOT with no way to
// re-request or re-broadcast it. When a single lobby frame was lost - dropped on a
// channel flap (#805 hot-rejoin) or sent while the transport was momentarily down -
// the two clients were left permanently divergent with no heal:
//   - the GUEST sat at starter-select requesting the runConfig forever (case a), and
//   - the HOST looped proceedIfReady with partnerReady=false forever ("partner got
//     kicked, no players showing" - case b),
// because the runtime's #805 rejoin resync only heals BATTLE state
// (isCoopAuthoritativeGuest), never the LOBBY, and the roster/ready direction had no
// re-request at all.
//
// The fix makes every lobby-critical state re-answerable/re-broadcastable at any time
// the session lives: a symmetric `requestRoster` (mirror of `requestRunConfig`), a
// `resyncLobbyState()` that re-establishes both directions, and an automatic resync on
// a transport RECONNECT (disconnected -> connected). These are pure-controller tests
// over a loopback pair + a tiny controllable flap transport - no game engine.
// =============================================================================

import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import type { CoopConnectionState, CoopMessage, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { describe, expect, it } from "vitest";

/** LoopbackTransport / the flap transport deliver on a microtask; flush before asserting. */
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

const resumeCommitment = (wave: number, runId = `run-${"b".repeat(20)}`, checkpointRevision = wave) => ({
  version: 1 as const,
  digest: "0".repeat(64),
  gameMode: GameModes.COOP,
  wave,
  revision: 0,
  runId,
  checkpointRevision,
  timestamp: wave * 10,
  participants: ["Guest", "Host"] as [string, string],
  seats: { host: "Host", guest: "Guest" },
});

/**
 * A minimal controllable in-process transport used to REPRODUCE a channel FLAP: it delivers to the
 * peer on a microtask like the loopback, but its `connected` flag can be toggled at will so a test can
 * drive `connected -> disconnected -> connected` (a #805 hot-rejoin). While DARK, a `send` is dropped
 * at the source (mirrors {@linkcode WebRtcTransport.send} bailing when the channel is not open) and a
 * frame in flight is dropped if the peer is dark at delivery - exactly the lobby-frame loss the fix heals.
 */
class FlapTransport implements CoopTransport {
  readonly role: CoopRole;
  readonly sent: CoopMessage[] = [];
  private peer: FlapTransport | null = null;
  private _state: CoopConnectionState = "connected";
  private readonly msgHandlers = new Set<(msg: CoopMessage) => void>();
  private readonly stateHandlers = new Set<(state: CoopConnectionState) => void>();
  private dropNextMessageType: CoopMessage["t"] | null = null;

  constructor(role: CoopRole) {
    this.role = role;
  }

  _pair(peer: FlapTransport): void {
    this.peer = peer;
  }

  get state(): CoopConnectionState {
    return this._state;
  }

  /** Flip the channel up/down and fire the lifecycle event (drives the controller's reconnect resync). */
  setConnected(connected: boolean): void {
    const next: CoopConnectionState = connected ? "connected" : "disconnected";
    if (this._state === next) {
      return;
    }
    this._state = next;
    for (const h of [...this.stateHandlers]) {
      h(next);
    }
  }

  send(msg: CoopMessage): void {
    this.sent.push(msg);
    if (this.dropNextMessageType === msg.t) {
      this.dropNextMessageType = null;
      return;
    }
    if (this._state !== "connected") {
      return; // dark: dropped at the source (like the real transport bailing on a closed channel)
    }
    const peer = this.peer;
    if (peer == null) {
      return;
    }
    queueMicrotask(() => {
      if (peer._state !== "connected") {
        return; // peer went dark before delivery: the frame is lost
      }
      for (const h of [...peer.msgHandlers]) {
        h(msg);
      }
    });
  }

  dropNext(type: CoopMessage["t"]): void {
    this.dropNextMessageType = type;
  }

  /** Test-only delivery of a delayed frame that was retained by an old wire. */
  deliver(msg: CoopMessage): void {
    for (const h of [...this.msgHandlers]) {
      h(msg);
    }
  }

  onMessage(handler: (msg: CoopMessage) => void): () => void {
    this.msgHandlers.add(handler);
    return () => {
      this.msgHandlers.delete(handler);
    };
  }

  onStateChange(handler: (state: CoopConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  close(): void {
    this._state = "closed";
    this.msgHandlers.clear();
    this.stateHandlers.clear();
  }
}

function makeFlapPair(): { host: FlapTransport; guest: FlapTransport } {
  const host = new FlapTransport("host");
  const guest = new FlapTransport("guest");
  host._pair(guest);
  guest._pair(host);
  return { host, guest };
}

describe("co-op lobby self-healing handshake (#868)", () => {
  it("the host mints a nonzero operation epoch and the guest echoes the same epoch", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1 });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();
    await flush();

    const hostHello = host.sent.find((msg): msg is Extract<CoopMessage, { t: "hello" }> => msg.t === "hello");
    const guestHellos = guest.sent.filter((msg): msg is Extract<CoopMessage, { t: "hello" }> => msg.t === "hello");
    const epoch = (hostHello as unknown as { epoch?: number } | undefined)?.epoch;
    expect(epoch, "host-authored epoch is carried in hello").toBeTypeOf("number");
    expect(epoch).toBeGreaterThan(0);
    expect(
      guestHellos.some(msg => (msg as unknown as { epoch?: number }).epoch === epoch),
      "guest echoes the adopted host epoch",
    ).toBe(true);
    expect(h.sessionEpoch).toBe(epoch);
    expect(g.sessionEpoch).toBe(epoch);

    // A wire-only hot rejoin keeps the control-plane identity intact.
    host.setConnected(false);
    guest.setConnected(false);
    guest.setConnected(true);
    host.setConnected(true);
    await flush();
    await flush();
    expect(h.sessionEpoch, "hot rejoin does not mint").toBe(epoch);
    expect(g.sessionEpoch, "hot rejoin does not mint").toBe(epoch);

    // A hard run boundary mints on the host and is adopted by the guest.
    const next = h.beginNewOperationEpoch("test-cold-resume");
    await flush();
    expect(next).toBeGreaterThan(epoch!);
    expect(g.sessionEpoch, "cold resume adopts the new host epoch").toBe(next);
  });

  it("a delayed reply from an older resume offer cannot resolve the current offer", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1 });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();

    let surfacedOffers = 0;
    g.armResumeOfferHandler(() => {
      surfacedOffers++;
    });
    const first = h.offerResume(resumeCommitment(10));
    await flush();
    expect(surfacedOffers).toBe(1);
    const firstFrame = host.sent.find(
      (msg): msg is Extract<CoopMessage, { t: "resumeOffer" }> => msg.t === "resumeOffer" && msg.commitment.wave === 10,
    );
    expect(firstFrame).toBeDefined();
    await g.replyResume(false);
    await expect(first).resolves.toBe(false);

    const second = h.offerResume(resumeCommitment(20));
    await flush();
    expect(surfacedOffers, "a settled decline allows the next host offer in the same lobby epoch").toBe(2);
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });

    host.deliver({ t: "resumeReply", decisionId: firstFrame!.decisionId, accept: true });
    guest.deliver(firstFrame!);
    await flush();
    expect(secondSettled, "stale reply was rejected by transaction id").toBe(false);
    expect(surfacedOffers, "a delayed settled offer cannot replace the active offer").toBe(2);

    const committed = g.replyResume(true);
    await expect(second).resolves.toBe(true);
    await expect(committed, "guest receives the host's durable ACCEPT commit").resolves.toBe(true);
  });

  it("binds offers/start-new to an epoch so delayed launch decisions cannot replace the active run", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1 });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();

    guest.setConnected(false);
    let offersSurfaced = 0;
    g.armResumeOfferHandler(() => {
      offersSurfaced++;
    });
    const abandonedOffer = h.offerResume(resumeCommitment(10), 60_000);
    const delayedOffer = host.sent.find(
      (msg): msg is Extract<CoopMessage, { t: "resumeOffer" }> => msg.t === "resumeOffer",
    );
    expect(delayedOffer).toBeDefined();

    guest.setConnected(true);
    let starts = 0;
    g.armResumeStartNewHandler(() => {
      starts++;
    });
    await expect(h.sendResumeStartNew(), "the newer atomic launch decision is ACKed").resolves.toBe(true);
    const firstStart = host.sent.find(
      (msg): msg is Extract<CoopMessage, { t: "resumeStartNew" }> => msg.t === "resumeStartNew",
    );
    expect(firstStart).toBeDefined();
    const activeEpoch = g.sessionEpoch;
    const activeRun = g.runId;
    const offersBeforeDelayedReplay = offersSurfaced;

    guest.deliver(delayedOffer!);
    expect(offersSurfaced, "old proposal is not surfaced again after the epoch advanced").toBe(
      offersBeforeDelayedReplay,
    );
    expect(g.sessionEpoch).toBe(activeEpoch);
    expect(g.runId).toBe(activeRun);

    g.armResumeStartNewHandler(() => {
      starts++;
    });
    const newerRun = `newer-run-${"z".repeat(24)}`;
    guest.deliver({
      t: "resumeStartNew",
      decisionId: "newer-launch-decision",
      epoch: activeEpoch + 1,
      runId: newerRun,
      checkpointRevision: 0,
    });
    expect(starts).toBe(2);
    expect(g.runId).toBe(newerRun);

    guest.deliver(firstStart!);
    expect(starts, "an older start-new frame cannot re-enter the UI").toBe(2);
    expect(g.sessionEpoch).toBe(activeEpoch + 1);
    expect(g.runId).toBe(newerRun);

    h.dispose();
    await expect(abandonedOffer).resolves.toBe(false);
    g.dispose();
  });

  it("replays a lost ACCEPT reply after reconnect and waits for applied-state ACK", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1 });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();

    g.armResumeOfferHandler(() => {});
    const offered = h.offerResume(resumeCommitment(20));
    await flush();

    host.dropNext("resumeAccepted");
    const committed = g.replyResume(true);
    let guestCommitted = false;
    void committed.then(value => {
      guestCommitted = value;
    });
    await flush();
    expect(guestCommitted, "a lost post-commit carrier leaves the guest behind the barrier").toBe(false);
    await expect(offered, "the host committed the ACCEPT before its carrier was lost").resolves.toBe(true);

    host.setConnected(false);
    guest.setConnected(false);
    guest.setConnected(true);
    host.setConnected(true);
    await flush();
    await expect(committed, "the guest receives the matching resumeAccepted commit").resolves.toBe(true);

    const applied = h.awaitResumeApplied(1_000);
    const delivered = g.reportResumeApplied(true);
    await flush();
    await expect(applied, "host observes actual snapshot materialization").resolves.toBe(true);
    await expect(delivered, "guest observes the host apply ACK").resolves.toBe(true);

    const appliedFrames = guest.sent.filter(msg => msg.t === "resumeApplied").length;
    host.setConnected(false);
    guest.setConnected(false);
    guest.setConnected(true);
    host.setConnected(true);
    await flush();
    await flush();
    expect(
      guest.sent.filter(msg => msg.t === "resumeApplied").length,
      "host ACK clears the guest apply-result outbox before a later reconnect",
    ).toBe(appliedFrames);
  });

  it("a resumeStartNew release lost during a flap is re-sent on reconnect", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1 });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();

    let released = 0;
    g.armResumeStartNewHandler(() => {
      released++;
    });

    // The host decides while the wire is dark. This is a durable lobby decision: after
    // reconnect the guest must observe it instead of waiting for the anti-hang timeout.
    host.setConnected(false);
    guest.setConnected(false);
    const committed = h.sendResumeStartNew();
    await flush();
    expect(released).toBe(0);

    guest.setConnected(true);
    host.setConnected(true);
    await flush();
    await flush();
    await flush();

    expect(released, "the durable start-new decision healed immediately on reconnect").toBe(1);
    await expect(committed, "the host advances only after the guest applied and ACKed the release").resolves.toBe(true);
  });

  it("parks the host until the guest UI applies the exact start-new decision", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1 });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();

    const committed = h.sendResumeStartNew();
    let hostReleased = false;
    void committed.then(() => {
      hostReleased = true;
    });
    await flush();
    expect(hostReleased, "receipt without a guest UI handler is not application").toBe(false);

    let guestReleased = 0;
    g.armResumeStartNewHandler(() => {
      guestReleased++;
    });
    await expect(committed).resolves.toBe(true);
    expect(guestReleased).toBe(1);
    expect(hostReleased).toBe(true);

    h.resyncLobbyState();
    await flush();
    expect(guestReleased, "a replayed committed decision re-ACKs without re-entering team select").toBe(1);
  });

  it("replays an exact host checkpoint when the guest persistence ACK is lost", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1 });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();

    let persisted = 0;
    g.armResumeCheckpointHandler(async () => {
      persisted++;
      host.setConnected(false); // persistence succeeds, but its first ACK cannot reach the host.
      return { success: true };
    });
    const mirrored = h.sendResumeCheckpoint(
      '{"waveIndex":12}',
      resumeCommitment(12, h.runId, h.checkpointRevision),
      5_000,
    );
    await flush();
    expect(persisted).toBe(1);

    host.setConnected(true);
    await flush();
    await flush();
    await expect(mirrored, "retained checkpoint is re-sent and duplicate persistence is re-ACKed").resolves.toBe(true);
    expect(persisted, "same checkpoint id is persisted exactly once").toBe(1);
  });

  it("retires a timed-out checkpoint outbox when its reconnect ACK arrives without a live waiter", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1 });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();

    let persisted = 0;
    g.armResumeCheckpointHandler(async () => {
      persisted++;
      host.setConnected(false); // local persistence succeeds, but the first ACK is dropped.
      return { success: true };
    });
    await expect(
      h.sendResumeCheckpoint('{"waveIndex":15}', resumeCommitment(15, h.runId, h.checkpointRevision), 5),
    ).resolves.toBe(false);
    expect(persisted).toBe(1);

    host.setConnected(true);
    await flush();
    await flush();
    const afterHealing = host.sent.filter(message => message.t === "resumeCheckpoint").length;
    expect(afterHealing, "the timed-out durable frame was replayed once").toBe(2);

    host.setConnected(false);
    host.setConnected(true);
    await flush();
    await flush();
    expect(
      host.sent.filter(message => message.t === "resumeCheckpoint").length,
      "the late successful ACK retired the outbox even though its waiter had timed out",
    ).toBe(afterHealing);
    expect(persisted, "duplicate replay never re-runs guest persistence").toBe(1);
  });

  it("carries failed cloud-mirror debt into the next complete checkpoint", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1 });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();

    const mirrorRequests: boolean[] = [];
    g.armResumeCheckpointHandler(async (_session, _commitment, mirrorCloud) => {
      mirrorRequests.push(mirrorCloud);
      return mirrorRequests.length === 1 ? { success: false, reason: "cloud-failed" } : { success: true };
    });
    await expect(
      h.sendResumeCheckpoint('{"waveIndex":20}', resumeCommitment(20, h.runId, h.checkpointRevision), 5_000, true),
    ).resolves.toBe(false);
    await expect(
      h.sendResumeCheckpoint('{"waveIndex":21}', resumeCommitment(21, h.runId, h.checkpointRevision), 5_000, false),
      "a newer full snapshot supersedes bytes but cannot erase outstanding guest-cloud durability",
    ).resolves.toBe(true);
    expect(mirrorRequests).toEqual([true, true]);
  });

  // -------------------------------------------------------------------------
  // REPRO (ii): a guest lock-in LOST during a channel flap must heal on reconnect,
  // so the HOST's proceedIfReady converges to bothReady (case b: "partner got kicked").
  // FAILS before the fix (the reconnect did nothing for lobby state).
  // -------------------------------------------------------------------------
  it("a guest lock-in lost during a flap heals on reconnect -> host reaches bothReady (case b)", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1 });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();

    // The host picks + locks in (this half reaches the guest fine).
    h.setLocalRoster([{ speciesId: 1, cost: 1 }]);
    h.setLocalReady(true);
    await flush();
    expect(h.bothReady()).toBe(false); // guest hasn't picked yet

    // The channel flaps DARK on BOTH endpoints, and the guest locks in while dark:
    // its rosterSync (with ready=true) is dropped at the source and never reaches the host.
    guest.setConnected(false);
    host.setConnected(false);
    g.setLocalRoster([{ speciesId: 4, cost: 1 }]);
    g.setLocalReady(true);
    await flush();
    expect(h.partnerReady).toBe(false); // the strand: host never learned the guest is ready
    expect(h.bothReady()).toBe(false);

    // The #805 hot-rejoin brings the channel back.
    guest.setConnected(true);
    host.setConnected(true);
    await flush();
    await flush();
    await flush();

    // The reconnect re-ran the lobby handshake: the guest re-broadcast its roster+ready
    // (and the host re-requested it), so the host converged and the run can launch.
    expect(h.partnerReady).toBe(true);
    expect(h.bothReady()).toBe(true);
    expect(h.partnerEntries().map(e => e.speciesId)).toEqual([4]);
  });

  // -------------------------------------------------------------------------
  // REPRO (i): a host runConfig LOST during a flap must be re-broadcast on reconnect,
  // so a late guest still gets it EVEN IF the guest never re-requests (case a).
  // FAILS before the fix (the host never re-broadcast the runConfig after launch/flap).
  // -------------------------------------------------------------------------
  it("a host runConfig lost during a flap is re-broadcast on reconnect -> the guest still gets it (case a)", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1 });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();

    // The channel flaps dark; the host picks difficulty (broadcasts the authoritative runConfig)
    // while the guest is dark, so that single one-shot frame is lost.
    host.setConnected(false);
    guest.setConnected(false);
    h.broadcastRunConfig({ difficulty: "hell", challenges: [], seed: "SEED123" });
    await flush();
    expect(g.runConfig()).toBeNull(); // the strand: the guest never received the runConfig

    // The host still has _runConfig (it decided) and the controller survives the "launch" -
    // on reconnect it MUST re-broadcast it unprompted so a guest whose own re-request was also
    // lost still converges.
    host.setConnected(true);
    guest.setConnected(true);
    await flush();
    await flush();
    await flush();

    expect(g.runConfig()?.difficulty).toBe("hell");
    expect(g.runConfig()?.seed).toBe("SEED123");
  });

  // -------------------------------------------------------------------------
  // Direct coverage of the symmetric `requestRoster` answer path (the mechanism the
  // waiting starter-select screen drives on an interval). A host that MISSED the guest's
  // one-shot lock-in recovers it by asking the guest to re-broadcast.
  // -------------------------------------------------------------------------
  it("requestRoster recovers a rosterSync the host missed (one-shot re-answered)", async () => {
    // Use the explicit loss-injection transport here. Loopback intentionally buffers frames sent
    // before the first subscription, matching WebRTC early-rx behavior, so it cannot model a truly
    // missed one-shot frame anymore.
    const { host, guest } = makeFlapPair();
    const g = new CoopSessionController(guest, { username: "Guest" });
    // The guest announces + locks in BEFORE the host controller exists, so the host misses
    // the one-shot rosterSync entirely (it is delivered to no handler).
    g.connect();
    g.setLocalRoster([{ speciesId: 7, cost: 3 }]);
    g.setLocalReady(true);
    await flush();

    const h = new CoopSessionController(host, { username: "Host" });
    h.connect();
    await flush();
    expect(h.partnerReady).toBe(false); // the host missed the guest's ready

    // The self-heal: the host asks the guest to re-send its roster; the guest answers.
    h.requestRoster();
    await flush();
    await flush();
    expect(h.partnerReady).toBe(true);
    expect(h.partnerEntries().map(e => e.speciesId)).toEqual([7]);
  });

  // -------------------------------------------------------------------------
  // resyncLobbyState is idempotent + re-drives BOTH directions in one call. Two fully
  // synced clients calling it repeatedly stay correct (never desyncs the counter/roster).
  // -------------------------------------------------------------------------
  it("resyncLobbyState is idempotent on an already-synced session", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new CoopSessionController(host, { username: "Host" });
    const g = new CoopSessionController(guest, { username: "Guest" });
    h.connect();
    g.connect();
    h.setLocalRoster([{ speciesId: 1, cost: 1 }]);
    g.setLocalRoster([{ speciesId: 2, cost: 1 }]);
    h.setLocalReady(true);
    g.setLocalReady(true);
    h.broadcastRunConfig({ difficulty: "ace", challenges: [], seed: "SX" });
    await flush();
    expect(h.bothReady()).toBe(true);
    expect(g.bothReady()).toBe(true);

    // Re-drive the whole handshake several times from both sides.
    h.resyncLobbyState();
    g.resyncLobbyState();
    await flush();
    h.resyncLobbyState();
    g.resyncLobbyState();
    await flush();
    await flush();

    // Everything still agrees - roster, ready, runConfig, and the interaction counter parity.
    expect(h.bothReady()).toBe(true);
    expect(g.bothReady()).toBe(true);
    expect(g.runConfig()?.difficulty).toBe("ace");
    expect(g.runConfig()?.seed).toBe("SX");
    expect(h.partnerEntries().map(e => e.speciesId)).toEqual([2]);
    expect(g.partnerEntries().map(e => e.speciesId)).toEqual([1]);
    expect(h.interactionCounter()).toBe(0);
    expect(g.interactionCounter()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // The initial connecting -> connected is NOT a reconnect: a fresh session does not
  // spuriously resync (the reconnect heal only fires after a real disconnect).
  // -------------------------------------------------------------------------
  it("does not treat the initial connect as a reconnect (no spurious resync)", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, { username: "Host" });
    const g = new CoopSessionController(guest, { username: "Guest" });

    // `requestRoster` is emitted ONLY by resyncLobbyState (the reconnect heal); a genuine initial
    // connect never sends one. Count it as the tell-tale of a spurious resync.
    let hostSawRequestRoster = false;
    host.onMessage(msg => {
      if (msg.t === "requestRoster") {
        hostSawRequestRoster = true;
      }
    });

    h.connect();
    g.connect();
    g.setLocalRoster([{ speciesId: 9, cost: 2 }]);
    g.setLocalReady(true);
    await flush();
    await flush();

    // No reconnect fired, so neither client ran resyncLobbyState on the initial connect.
    expect(hostSawRequestRoster).toBe(false);
    expect(h.partnerReady).toBe(true);
  });
});
