/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Wave-2e OPERATION <-> DURABILITY end-to-end CHANNEL-CUT PROOF (contract doc §4.2/§4.4/§4.6).
//
// Wave-2a/b built the operation envelope + the durability journal in parallel behind a documented
// plug-in point; Wave-2e closed it (coop-operation-journal.ts). This is the direct proof that a
// committed operation on a MIGRATED surface (biome travel) now rides a journaled, ACK'd, resendable
// wire frame end-to-end: it CUTS the channel between the owner's committed op and the watcher's
// adoption, RECONNECTS, and proves the op arrives via the JOURNAL resend / reconnect-tail replay -
// with the bespoke self-heals PROVABLY NOT the mechanism (the only wire traffic is the `envelope`
// op stream + the generic coopAck / coopResync durability arms).
//
// It reuses the W2b convergence-test pattern (coop-durability-convergence.test.ts): two
// CoopDurabilityManagers over a ChannelGate / seeded fault transport. The difference is the op stream
// is the REAL one the migrated adapter produces (commitBiomeOwnerIntent / adoptBiomeWatcherChoice ->
// journalCoopCommittedEnvelope) and applies (the registered applyJournaledBiomeEnvelope guest applier),
// not a synthetic wave op. Engine-free (no GameManager / ER_SCENARIO): the operation + durability
// layers are pure.
//
// ONE TEST PER DIRECTION (the deliverable): the journal ALWAYS flows from the sole committer (the
// host, invariant 3) to the receiver, so both directions are a host-committed envelope healed by the
// journal - they differ by op OWNERSHIP:
//   1. HOST-OWNED op -> guest watcher (committed on the host's OWNER seam, commitBiomeOwnerIntent).
//   2. GUEST-MINTED intent -> host, committed on the host's WATCHER seam (adoptBiomeWatcherChoice) and
//      journaled back to the guest. The single-process guest-applier is reset AFTER the host commit to
//      model the separate guest process (the §8.2 single-process state-sharing pitfall), so the journal
//      replay lands on a fresh applier exactly as it would across two real processes.
// =============================================================================

import {
  adoptBiomeWatcherChoice,
  commitBiomeOwnerIntent,
  preflightCoopBiomeJournalMaterialization,
  resetCoopBiomeOperationFlag,
  resetCoopBiomeOperationState,
  setCoopBiomeOperationEnabled,
} from "#data/elite-redux/coop/coop-biome-operation";
import { CoopDurabilityManager, setCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import type { CoopAuthoritativeEnvelopeV1, CoopBiomePickPayload } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  coopOperationDurabilityHooks,
  getCoopOperationJournalApplied,
  getCoopOperationLiveSinkInvoked,
  registerCoopOperationLiveSink,
  resetCoopOperationJournalLog,
  setCoopOperationDurability,
} from "#data/elite-redux/coop/coop-operation-journal";
import { createCoopRuntimeOpState, setActiveCoopRuntimeOpState } from "#data/elite-redux/coop/coop-operation-runtime";
import {
  armCoopBiomeTransitionTailPermit,
  clearCoopBiomeTransitionTailPermit,
  getCoopBiomeTransitionTailPermit,
} from "#data/elite-redux/coop/coop-renderer-gate";
import { COOP_BIOME_PICK_SEQ_BASE, COOP_CROSSROADS_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopConnectionState, CoopMessage, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { COOP_NO_FAULT_PROFILE, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Await several microtask turns so the loopback (queueMicrotask) delivery + ACK round-trips settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

/**
 * A thin gate over a {@linkcode CoopTransport} endpoint that can CUT the channel (drop outbound frames -
 * exactly a dark channel: the frame is "sent" but never reaches the peer) and RESTORE it. Delegates
 * everything else verbatim so the framing the peer sees is byte-identical. (Same shape as the W2b proof.)
 */
class ChannelGate implements CoopTransport {
  cut = false;
  readonly sentTypes: string[] = [];
  constructor(private readonly inner: CoopTransport) {}
  get role(): CoopRole {
    return this.inner.role;
  }
  get state(): CoopConnectionState {
    return this.inner.state;
  }
  send(msg: CoopMessage): void {
    this.sentTypes.push(msg.t);
    if (this.cut) {
      return;
    }
    this.inner.send(msg);
  }
  onMessage(handler: (msg: CoopMessage) => void): () => void {
    return this.inner.onMessage(handler);
  }
  onStateChange(handler: (state: CoopConnectionState) => void): () => void {
    return this.inner.onStateChange(handler);
  }
  close(): void {
    this.inner.close();
  }
}

/** The bespoke self-heal message classes that must NOT be the mechanism (review finding 3, §4.6). */
const BESPOKE_SELFHEAL_TYPES = new Set([
  "requestStateSync",
  "stateSync",
  "requestRunConfig",
  "requestRoster",
  "requestEnemyParty",
  "rendezvous",
]);

/**
 * The biomeIds the journal carrier ROUTED INTO the live-mutation seam on this client, in order (W2e-R). This
 * is the LIVE-STATE proxy the reviewer's core point demands: it proves the journal carrier drives the ONE
 * mutation seam (the production biome materializer - pushing SwitchBiomePhase on the guest - is the parked
 * keystone; the engine-free proof registers a recording sink), NOT merely that a sidecar history log grew.
 */
function liveBiomes(): number[] {
  return getCoopOperationLiveSinkInvoked().map(e => (e.pendingOperation?.payload as CoopBiomePickPayload).biomeId);
}

/** SECONDARY (journal history): the biomeIds recorded in the receiver's idempotency ledger, in order. */
function appliedBiomes(): number[] {
  return getCoopOperationJournalApplied().map(e => (e.pendingOperation?.payload as CoopBiomePickPayload).biomeId);
}

/** Assert the whole run's wire traffic never used a bespoke self-heal (the journal was the mechanism). */
function assertNoSelfHeal(...gates: ChannelGate[]): void {
  for (const g of gates) {
    for (const t of g.sentTypes) {
      expect(BESPOKE_SELFHEAL_TYPES.has(t), `unexpected self-heal on the wire: ${t}`).toBe(false);
    }
  }
}

describe("Wave-2e operation<->durability convergence: a cut committed op is repaired by the journal, not a self-heal", () => {
  beforeEach(() => {
    setActiveCoopRuntimeOpState(createCoopRuntimeOpState());
    setCoopDurabilityEnabled(true);
    setCoopBiomeOperationEnabled(true);
    resetCoopBiomeOperationState();
    resetCoopOperationJournalLog();
    // W2e-R: register a recording LIVE-MUTATION sink so the convergence proof asserts LIVE STATE (the op
    // reached the mutation seam), not just that the sidecar journal history grew (the reviewer's core point).
    // A real materializer pushes SwitchBiomePhase on the guest (the parked keystone); the mock returns true.
    registerCoopOperationLiveSink("op:biome", () => true);
    setCoopOperationDurability(null);
  });

  afterEach(() => {
    setCoopOperationDurability(null);
    registerCoopOperationLiveSink("op:biome", null);
    resetCoopOperationJournalLog();
    resetCoopBiomeOperationState();
    resetCoopBiomeOperationFlag();
    setCoopDurabilityEnabled(true);
    setActiveCoopRuntimeOpState(null);
  });

  /** Commit a HOST-OWNED biome pick (even pin -> host seat) through the real owner seam; it journals. */
  function commitHostOwnedBiome(pinned: number, biomeId: number): void {
    commitBiomeOwnerIntent({
      kind: "BIOME_PICK",
      seq: COOP_BIOME_PICK_SEQ_BASE + pinned,
      pinned,
      choice: 0,
      payload: { sourceBiomeId: 0, biomeId, nodeIndex: 0, nextWave: 12 } satisfies CoopBiomePickPayload,
      localRole: "host",
      wave: 11,
      turn: 0,
      boundarySourceBiomeId: 0,
      boundaryNextWave: 12,
      allowedRoutes: [biomeId],
      deterministicDestination: null,
    });
  }

  it("host local-tail reservation precedes journal publish and re-ACK preserves the original revision", () => {
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const hostMgr = new CoopDurabilityManager(hostGate);
    setCoopOperationDurability(hostMgr);

    expect(
      armCoopBiomeTransitionTailPermit({
        operationId: "1:0:BIOME_PICK:9800002",
        sessionEpoch: 1,
        revision: 77,
        wave: 1,
        sourceBiomeId: 0,
        destinationBiomeId: 1,
        nextWave: 2,
      }),
    ).toBe(true);
    const blocked = commitBiomeOwnerIntent({
      kind: "BIOME_PICK",
      seq: COOP_BIOME_PICK_SEQ_BASE + 2,
      pinned: 2,
      choice: 0,
      payload: { sourceBiomeId: 0, biomeId: 10, nodeIndex: 0, nextWave: 12 },
      localRole: "host",
      wave: 11,
      turn: 0,
      boundarySourceBiomeId: 0,
      boundaryNextWave: 12,
      allowedRoutes: [10],
      deterministicDestination: null,
      armLocalTail: true,
    });
    expect(blocked, "a conflicting unfinished permit prevents the commit itself").toBeNull();
    expect(hostGate.sentTypes, "no envelope is exposed before the local tail slot is reserved").not.toContain(
      "envelope",
    );

    clearCoopBiomeTransitionTailPermit();
    const first = commitBiomeOwnerIntent({
      kind: "BIOME_PICK",
      seq: COOP_BIOME_PICK_SEQ_BASE + 2,
      pinned: 2,
      choice: 0,
      payload: { sourceBiomeId: 0, biomeId: 10, nodeIndex: 0, nextWave: 12 },
      localRole: "host",
      wave: 11,
      turn: 0,
      boundarySourceBiomeId: 0,
      boundaryNextWave: 12,
      allowedRoutes: [10],
      deterministicDestination: null,
      armLocalTail: true,
    });
    expect(first?.revision).toBe(1);
    const later = commitBiomeOwnerIntent({
      kind: "CROSSROADS_PICK",
      seq: COOP_CROSSROADS_SEQ_BASE + 4,
      pinned: 4,
      choice: 0,
      payload: { optionIndex: 0 },
      localRole: "host",
      wave: 11,
      turn: 0,
      boundarySourceBiomeId: 0,
      boundaryNextWave: 12,
      allowedRoutes: [],
      deterministicDestination: null,
    });
    expect(later?.revision).toBe(2);
    const reack = commitBiomeOwnerIntent({
      kind: "BIOME_PICK",
      seq: COOP_BIOME_PICK_SEQ_BASE + 2,
      pinned: 2,
      choice: 0,
      payload: { sourceBiomeId: 0, biomeId: 10, nodeIndex: 0, nextWave: 12 },
      localRole: "host",
      wave: 11,
      turn: 0,
      boundarySourceBiomeId: 0,
      boundaryNextWave: 12,
      allowedRoutes: [10],
      deterministicDestination: null,
      armLocalTail: true,
    });
    expect(reack?.revision, "re-ACK uses op A's immutable revision, not the later global clock").toBe(1);
    expect(getCoopBiomeTransitionTailPermit()?.revision).toBe(1);
    hostMgr.dispose();
  });

  it("a committed biome transition cannot arm its local permit until exact journal retention succeeds", () => {
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const hostMgr = new CoopDurabilityManager(hostGate);
    setCoopOperationDurability(hostMgr);
    const retain = vi.spyOn(hostMgr, "commit").mockReturnValueOnce(false);
    const params = {
      kind: "BIOME_PICK" as const,
      seq: COOP_BIOME_PICK_SEQ_BASE + 2,
      pinned: 2,
      choice: 0,
      payload: { sourceBiomeId: 0, biomeId: 10, nodeIndex: 0, nextWave: 12 },
      localRole: "host" as const,
      wave: 11,
      turn: 0,
      boundarySourceBiomeId: 0,
      boundaryNextWave: 12,
      allowedRoutes: [10],
      deterministicDestination: null,
      armLocalTail: true,
    };

    expect(commitBiomeOwnerIntent(params), "the committed-but-unretained first attempt remains closed").toBeNull();
    expect(getCoopBiomeTransitionTailPermit(), "no permit can outrun journal retention").toBeNull();
    expect(hostGate.sentTypes, "a failed retention attempt cannot publish an envelope").not.toContain("envelope");

    const reack = commitBiomeOwnerIntent(params);
    expect(reack?.revision, "the exact retry re-journals the original immutable commit").toBe(1);
    expect(getCoopBiomeTransitionTailPermit()).toMatchObject({
      operationId: reack?.operationId,
      revision: 1,
      destinationBiomeId: 10,
    });
    expect(retain).toHaveBeenCalledTimes(2);
    expect(hostGate.sentTypes).toContain("envelope");
    hostMgr.dispose();
  });

  it("journal preflight rejects impossible permit ids and incoherent authoritative envelope addresses", () => {
    const valid = {
      version: 1,
      sessionEpoch: 1,
      revision: 1,
      wave: 11,
      turn: 3,
      logicalPhase: "BIOME_SELECT",
      pendingOperation: {
        id: `1:0:BIOME_PICK:${COOP_BIOME_PICK_SEQ_BASE + 2}`,
        kind: "BIOME_PICK",
        owner: 0,
        status: "applied",
        payload: { sourceBiomeId: 0, biomeId: 10, nodeIndex: 0, nextWave: 12 },
      },
      // The materializer deliberately validates only the common authoritative address here. The rest of
      // the battle carrier is immaterial to this engine-free permit preflight.
      authoritativeState: { version: 1, wave: 11, turn: 3 },
    } as CoopAuthoritativeEnvelopeV1;
    expect(preflightCoopBiomeJournalMaterialization(valid), "the exact interactive address is accepted").not.toBeNull();

    const mutate = (patch: Record<string, unknown>): CoopAuthoritativeEnvelopeV1 =>
      ({ ...valid, ...patch }) as CoopAuthoritativeEnvelopeV1;
    const mutateOperation = (patch: Record<string, unknown>): CoopAuthoritativeEnvelopeV1 =>
      mutate({ pendingOperation: { ...valid.pendingOperation!, ...patch } });

    const impossible: CoopAuthoritativeEnvelopeV1[] = [
      mutateOperation({ id: `1:0:BIOME_PICK:${COOP_BIOME_PICK_SEQ_BASE + 3}` }), // suffix != BASE + pin
      mutateOperation({ id: `1:1:BIOME_PICK:${COOP_BIOME_PICK_SEQ_BASE + 2}` }), // id owner != op owner/parity
      mutateOperation({ id: `2:0:BIOME_PICK:${COOP_BIOME_PICK_SEQ_BASE + 2}` }), // id epoch != envelope/session
      mutate({ version: 2 }),
      mutate({ logicalPhase: "SHOP" }),
      mutate({ authoritativeState: { ...valid.authoritativeState, wave: 10 } }),
      mutate({ authoritativeState: { ...valid.authoritativeState, turn: 2 } }),
    ];
    for (const envelope of impossible) {
      expect(
        preflightCoopBiomeJournalMaterialization(envelope),
        `impossible envelope must fail closed: ${JSON.stringify(envelope)}`,
      ).toBeNull();
    }
    expect(getCoopBiomeTransitionTailPermit(), "rejected preflights cannot reserve a tail slot").toBeNull();
  });

  // ===========================================================================================
  // DIRECTION 1: host-committed op -> guest watcher.
  // ===========================================================================================
  it("DIRECTION 1 (host-owned -> guest) MID-STREAM cut: a dropped committed biome op is healed by the gap-triggered tail", async () => {
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const guestGate = new ChannelGate(pair.guest);
    const hostMgr = new CoopDurabilityManager(hostGate); // committer: no receiver hooks (the host never applies)
    const guestMgr = new CoopDurabilityManager(guestGate, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    // Commit two host-owned biome ops cleanly (distinct interactions -> distinct ops -> revisions 1, 2).
    commitHostOwnedBiome(2, 10);
    commitHostOwnedBiome(4, 11);
    await flush();
    expect(appliedBiomes()).toEqual([10, 11]);

    // CUT the channel and commit a THIRD op - it is journaled + "sent" but never reaches the guest.
    hostGate.cut = true;
    commitHostOwnedBiome(6, 12);
    await flush();
    expect(appliedBiomes()).toEqual([10, 11]); // op 3 lost between commit and apply (the review-finding-3 hole)

    // Channel recovers; a FOURTH op commits. The guest sees revision 4 out of order -> requests the tail
    // after 2, and the host replays 3 then 4. Convergence, with NO bespoke self-heal involved.
    hostGate.cut = false;
    commitHostOwnedBiome(8, 13);
    await flush();
    expect(liveBiomes(), "LIVE STATE: the cut op reached the mutation seam via the journal tail").toEqual([
      10, 11, 12, 13,
    ]);
    expect(appliedBiomes(), "(secondary) journal history converged").toEqual([10, 11, 12, 13]);

    assertNoSelfHeal(hostGate, guestGate);
    expect(guestGate.sentTypes).toContain("coopResync"); // the generic tail request WAS the mechanism
    expect(hostGate.sentTypes).toContain("envelope"); // the op rode the journaled envelope arm
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("DIRECTION 1 (host-owned -> guest) TAIL cut + REJOIN: a committed-but-unacked op is recovered by reconnect()", async () => {
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const guestGate = new ChannelGate(pair.guest);
    const hostMgr = new CoopDurabilityManager(hostGate);
    const guestMgr = new CoopDurabilityManager(guestGate, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostOwnedBiome(2, 20);
    await flush();
    expect(appliedBiomes()).toEqual([20]);

    // CUT, then commit the FINAL op. Nothing follows it, so the guest never sees a gap -> without the
    // journal this committed-but-unacked op is unrecoverable short of a full snapshot.
    hostGate.cut = true;
    commitHostOwnedBiome(4, 21);
    await flush();
    expect(appliedBiomes()).toEqual([20]);

    // #805 hot rejoin: the channel recovers. PRODUCTION TOPOLOGY (#898): only the GUEST reconnects; its
    // coopResync + coopResyncAll make the host resend its committed-but-unacked tail; the guest converges -
    // precisely the message the buffer purge dropped pre-W2b.
    hostGate.cut = false;
    guestMgr.reconnect();
    await flush();
    expect(liveBiomes(), "LIVE STATE: the committed-but-unacked op reached the mutation seam on reconnect").toEqual([
      20, 21,
    ]);
    expect(appliedBiomes(), "(secondary) journal history converged").toEqual([20, 21]);

    assertNoSelfHeal(hostGate, guestGate);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // DIRECTION 2: guest-minted intent -> host, journaled back to the guest.
  // ===========================================================================================
  it("DIRECTION 2 (guest-minted -> host) cut + REJOIN: the host-committed envelope reaches the guest via the journal", async () => {
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const guestGate = new ChannelGate(pair.guest);
    const hostMgr = new CoopDurabilityManager(hostGate);
    const guestMgr = new CoopDurabilityManager(guestGate, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    // CUT first: the host is about to commit a GUEST-owned pick (odd pin -> guest seat) on its watcher seam
    // (the guest relayed the minted intent). The committed envelope is journaled but the guest never sees it.
    hostGate.cut = true;
    const decision = adoptBiomeWatcherChoice({
      kind: "BIOME_PICK",
      seq: COOP_BIOME_PICK_SEQ_BASE + 3,
      pinned: 3, // odd -> guest owns; the host is the sole committer of the guest's relayed intent (invariant 3)
      res: { choice: 0, data: [30] },
      localRole: "host",
      wave: 11,
      turn: 0,
      sourceBiomeId: 0,
      nextWave: 12,
      allowedRoutes: [30],
      deterministicDestination: null,
    });
    expect(decision.adopt, "the host committed + adopted the guest's relayed pick").toBe(true);
    const replay = adoptBiomeWatcherChoice({
      kind: "BIOME_PICK",
      seq: COOP_BIOME_PICK_SEQ_BASE + 3,
      pinned: 3,
      // A late/callback replay tries to carry a different value. The deterministic id reacks the original.
      res: { choice: 0, data: [31] },
      localRole: "host",
      wave: 11,
      turn: 0,
      sourceBiomeId: 0,
      nextWave: 12,
      allowedRoutes: [30],
      deterministicDestination: null,
    });
    expect(replay).toEqual({ adopt: true, choice: 0, data: [30] });
    const invalidRoute = adoptBiomeWatcherChoice({
      kind: "BIOME_PICK",
      seq: COOP_BIOME_PICK_SEQ_BASE + 5,
      pinned: 5,
      res: { choice: 0, data: [31] },
      localRole: "host",
      wave: 11,
      turn: 0,
      sourceBiomeId: 0,
      nextWave: 12,
      allowedRoutes: [30],
      deterministicDestination: null,
    });
    expect(invalidRoute).toMatchObject({ adopt: false, reason: "host-rejected" });
    const invalidCrossroads = adoptBiomeWatcherChoice({
      kind: "CROSSROADS_PICK",
      seq: COOP_CROSSROADS_SEQ_BASE + 7,
      pinned: 7,
      res: { choice: 2 },
      localRole: "host",
      wave: 11,
      turn: 0,
      sourceBiomeId: 0,
      nextWave: 12,
      allowedRoutes: [],
      deterministicDestination: null,
    });
    expect(invalidCrossroads).toMatchObject({ adopt: false, reason: "host-rejected" });
    await flush();
    expect(appliedBiomes()).toEqual([]); // the guest has not received the committed envelope (channel dark)

    // Model the separate guest process: the host's single-process watcher-adopt touched the shared guest
    // applier, so reset it - the real guest process never applied this op (its channel was cut). The journal
    // (held in the host MANAGER, independent of the adapter) still holds the committed envelope.
    resetCoopBiomeOperationState();

    // Hot rejoin: PRODUCTION TOPOLOGY (#898) - only the GUEST reconnects. The guest has NEVER applied
    // op:biome (its channel was cut for the sole op), so it cannot name the class in a per-class coopResync;
    // its coopResyncAll makes the host proactively resend its unacked tail, and the guest applies it via the
    // journal. (This is exactly the never-seen-class case the #898 fix closes.)
    hostGate.cut = false;
    guestMgr.reconnect();
    await flush();
    expect(liveBiomes(), "LIVE STATE: the guest-minted op reached the mutation seam via the journal").toEqual([30]);
    expect(appliedBiomes(), "(secondary) the committed envelope arrived via the journal").toEqual([30]);

    assertNoSelfHeal(hostGate, guestGate);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // FAULT TRANSPORT + FLAG interplay.
  // ===========================================================================================
  it("a seeded fault profile that DROPS the envelope op stream still converges after reconnect", async () => {
    const faultable = (msg: CoopMessage) => msg.t === "envelope";
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      { drop: 0.6, reorder: 0, delay: 0, faultable },
      { seed: 0xe11e },
    );
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    const N = 10;
    const expected = Array.from({ length: N }, (_, i) => i + 1);
    for (let i = 0; i < N; i++) {
      commitHostOwnedBiome(2 * (i + 1), expected[i]);
      await flush();
    }
    expect(pair.faultsInjected(), "the run must actually inject faults (not vacuous)").toBeGreaterThan(0);

    // Recover + rejoin repeatedly: each round the guest re-requests the next missing revision; the tail
    // replay is idempotent, so it converges to the full, in-order op history despite the drops.
    pair.setProfile(COOP_NO_FAULT_PROFILE);
    for (let round = 0; round < N + 2; round++) {
      guestMgr.reconnect(); // production single-sided reconnect (#898): coopResyncAll drives the host resend
      await flush();
      if (liveBiomes().length === N) {
        break;
      }
    }
    expect(liveBiomes(), "LIVE STATE: every dropped op eventually reached the mutation seam").toEqual(expected);
    expect(appliedBiomes(), "(secondary) journal history converged").toEqual(expected);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("FLAG OFF anywhere = today's behavior: no envelope is journaled or sent", async () => {
    // (a) durability manager NOT installed (isCoopDurabilityEnabled OFF at assembly): the commit still runs
    // its host log, but journalCoopCommittedEnvelope is a no-op - nothing rides the wire.
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const guestGate = new ChannelGate(pair.guest);
    const guestMgr = new CoopDurabilityManager(guestGate, coopOperationDurabilityHooks());
    setCoopOperationDurability(null); // durability OFF -> no active manager
    commitHostOwnedBiome(2, 40);
    await flush();
    expect(hostGate.sentTypes).not.toContain("envelope");
    expect(liveBiomes(), "LIVE STATE: nothing reached the mutation seam (durability OFF)").toEqual([]);
    expect(appliedBiomes()).toEqual([]);
    guestMgr.dispose();

    // (b) per-surface flag OFF: commit early-returns, so no op is minted, committed, or journaled.
    const pair2 = createLoopbackPair();
    const hostGate2 = new ChannelGate(pair2.host);
    const guestGate2 = new ChannelGate(pair2.guest);
    const hostMgr2 = new CoopDurabilityManager(hostGate2);
    const guestMgr2 = new CoopDurabilityManager(guestGate2, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr2);
    setCoopBiomeOperationEnabled(false);
    commitHostOwnedBiome(2, 41);
    await flush();
    expect(hostGate2.sentTypes).not.toContain("envelope");
    expect(liveBiomes(), "LIVE STATE: nothing reached the mutation seam (surface flag OFF)").toEqual([]);
    expect(appliedBiomes()).toEqual([]);
    hostMgr2.dispose();
    guestMgr2.dispose();
  });
});
