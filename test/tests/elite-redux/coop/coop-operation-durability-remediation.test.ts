/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// W2e-R P0 REMEDIATION - failure-first proof of the operation<->durability seam (contract doc §4.6/§4.7,
// the accepted external review's P0-1/P0-2/P0-3). The prior design (Wave-2e) could ACK an operation as
// APPLIED while performing ZERO real mutation: the durability receiver called a VOID apply hook then
// UNCONDITIONALLY marked applied + ACKed, and the surface journal appliers only recorded sidecar history
// (a dedicated journalGuest), never routing into a live-mutation seam. This suite is the failure-first
// spec for the remediation. It is ENGINE-FREE (the operation + durability layers are pure): the "live
// mutation" is proven at the LAYER boundary via a registered mock live-mutation sink (the real production
// scene materializer - pushing SwitchBiomePhase on the guest - is the PARKED keystone wave-advance work,
// documented as a residual). Each test's EXPECTED-RED reason against the pre-remediation code is in its
// comment; the fix makes it green for the RIGHT reason.
//
//   T1  the journal carrier ROUTES a committed biome op INTO the live-mutation seam (not a history sidecar).
//   T2  the receiver GATES its ACK + ledger advance on a SUCCESSFUL apply (a rejected apply -> no ACK,
//       retriable; a retry then applies exactly once). Plus the cross-carrier DUPLICATE must ACK (no spin).
//   T3  the SAME op re-delivered by the journal carrier (resend + reconnect tail) routes to the sink EXACTLY
//       ONCE (idempotent by operationId) - the exactly-once RECORDING guarantee.
//   T4  a COLD resume at revision N: the producer's NEXT op emits revision N+1 and the restored receiver
//       ACCEPTS it (the P0-3 "producer emits 1, receiver discards as stale" bug).
//   T8  a mid-stream lost reward action: ordinals + operationIds stay aligned after the gap-triggered tail.
// =============================================================================

import {
  commitBiomeOwnerIntent,
  resetCoopBiomeOperationFlag,
  resetCoopBiomeOperationState,
  setCoopBiomeOperationEnabled,
  setCoopBiomeOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-biome-operation";
import {
  type CoopApplyOutcome,
  type CoopDurabilityHooks,
  CoopDurabilityManager,
  type CoopJournalEntry,
  setCoopDurabilityEnabled,
} from "#data/elite-redux/coop/coop-durability";
import type { CoopBiomePickPayload, CoopRewardActionPayload } from "#data/elite-redux/coop/coop-operation-envelope";
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
  commitRewardAuthoritativeResult,
  commitRewardOwnerIntent,
  resetCoopRewardOperationFlag,
  resetCoopRewardOperationState,
  setCoopRewardAuthorityStateHooksForTest,
  setCoopRewardOperationEnabled,
} from "#data/elite-redux/coop/coop-reward-operation";
import { COOP_BIOME_PICK_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopConnectionState,
  CoopMessage,
  CoopRole,
  CoopTransport,
} from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BiomeId } from "#enums/biome-id";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Await several microtask turns so the loopback (queueMicrotask) delivery + ACK round-trips settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

/** A thin gate that can CUT a CoopTransport endpoint (drop outbound) + records every sent `t`. */
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

/** The biomeIds the journal carrier routed INTO the live-mutation seam this client (the live-state proxy). */
function sinkBiomes(): number[] {
  return getCoopOperationLiveSinkInvoked().map(e => (e.pendingOperation?.payload as CoopBiomePickPayload).biomeId);
}

describe("W2e-R P0 remediation: the operation<->durability seam mutates (or declines to ACK), never a phantom ACK", () => {
  beforeEach(() => {
    // Biome and reward apply state are per-runtime (fail-loud without an installed runtime). Install one
    // op-state for this engine-free realm so both surface records exist.
    setActiveCoopRuntimeOpState(createCoopRuntimeOpState());
    setCoopDurabilityEnabled(true);
    setCoopBiomeOperationEnabled(true);
    setCoopRewardOperationEnabled(true);
    resetCoopBiomeOperationState();
    resetCoopRewardOperationState();
    resetCoopOperationJournalLog();
    registerCoopOperationLiveSink("op:biome", null);
    registerCoopOperationLiveSink("op:reward", null);
    setCoopOperationDurability(null);
  });

  afterEach(() => {
    setCoopOperationDurability(null);
    setCoopRewardAuthorityStateHooksForTest(null);
    registerCoopOperationLiveSink("op:biome", null);
    registerCoopOperationLiveSink("op:reward", null);
    resetCoopOperationJournalLog();
    resetCoopBiomeOperationState();
    resetCoopRewardOperationState();
    resetCoopBiomeOperationFlag();
    resetCoopRewardOperationFlag();
    setCoopDurabilityEnabled(true);
    // Citizenship: clear the installed op-state so the next (--no-isolate) file starts with none installed.
    setActiveCoopRuntimeOpState(null);
  });

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

  // ===========================================================================================
  // T1 - the journal carrier ROUTES INTO the live-mutation seam (P0-1).
  // EXPECTED RED (pre-remediation): applyJournaledBiomeEnvelope only recorded into the sidecar journalGuest
  // and never invoked any live-mutation sink, so a journal-delivered op mutated NOTHING - yet was ACKed.
  // ===========================================================================================
  it("T1: a committed biome op delivered over the journal ROUTES INTO the live-mutation seam with the correct biome", async () => {
    const sinkSeen: number[] = [];
    registerCoopOperationLiveSink("op:biome", env => {
      sinkSeen.push((env.pendingOperation?.payload as CoopBiomePickPayload).biomeId);
      return true; // a real materializer would push SwitchBiomePhase on the guest (keystone); the mock records.
    });

    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostOwnedBiome(2, BiomeId.LABORATORY);
    await flush();

    // The op reached the ONE live-mutation seam carrying the ACTUAL biome target (not just sidecar history).
    expect(sinkSeen, "the journal carrier must route the committed biome op into the live-mutation sink").toEqual([
      BiomeId.LABORATORY,
    ]);
    expect(sinkBiomes()).toEqual([BiomeId.LABORATORY]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it.each([
    "missing",
    "throwing",
  ] as const)("T1b: a %s production sink leaves the committed op unacked and retriable", async failure => {
    if (failure === "throwing") {
      registerCoopOperationLiveSink("op:biome", () => {
        throw new Error("materializer failed");
      });
    }
    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostOwnedBiome(2, BiomeId.ISLAND);
    await flush();

    expect(hostMgr.unackedCount(), "no materialization means no ACK").toBe(1);
    expect(guestMgr.appliedMarks(), "the receiver ledger must not claim the op").toEqual({});
    expect(getCoopOperationJournalApplied(), "the sidecar ledger must not advance first").toEqual([]);

    registerCoopOperationLiveSink("op:biome", () => true);
    hostMgr.reconnect();
    await flush();
    expect(hostMgr.unackedCount(), "material recovery alone cannot release the retained authority").toBe(1);
    expect(guestMgr.appliedMarks()).toEqual({ "op:global": 1 });
    expect(guestMgr.notifyOperationContinuationSurface("sharedInput", { epoch: 1, wave: 11, turn: 0 })).toBe(1);
    await flush();
    expect(hostMgr.unackedCount(), "the exact shared continuation releases the retained op").toBe(0);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // T2 - the receiver GATES its ACK + ledger advance on a successful apply (P0-1).
  // EXPECTED RED (pre-remediation): receiveOp called a VOID apply then UNCONDITIONALLY markApplied + ACKed,
  // so a rejected apply still advanced the ledger + ACKed (the phantom-apply seam).
  // ===========================================================================================
  it("T2: a REJECTED apply is NOT acked + does NOT advance the ledger; a retry then applies exactly once", async () => {
    const pair = createLoopbackPair();
    const guestGate = new ChannelGate(pair.guest);

    let outcome: CoopApplyOutcome = "rejected";
    const applied: number[] = [];
    const hooks: CoopDurabilityHooks = {
      extractKey: msg => (msg.t === "waveResolved" ? { cls: "wave", seq: msg.wave } : null),
      apply: (entry: CoopJournalEntry) => {
        if (outcome === "applied" && entry.msg.t === "waveResolved") {
          applied.push(entry.msg.wave);
        }
        return outcome;
      },
    };
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(guestGate, hooks);

    // Deliver op seq=1 while the applier REJECTS (a transient failure - no real mutation happened).
    hostMgr.commit("wave", 1, { t: "waveResolved", wave: 1, outcome: "win" });
    await flush();
    expect(applied, "a rejected apply must not have mutated").toEqual([]);
    expect(
      guestGate.sentTypes.filter(t => t === "coopAck"),
      "a rejected apply must NOT ACK - the op must stay retriable",
    ).toEqual([]);

    // The applier recovers; the committer resends (reconnect) - now it applies exactly once + ACKs.
    outcome = "applied";
    hostMgr.reconnect();
    await flush();
    expect(applied, "the retry applies exactly once").toEqual([1]);
    expect(guestGate.sentTypes).toContain("coopAck");
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("T2a: rejected N plus retained N+1 coalesces and exhausts without recursive replay ping-pong", async () => {
    const pair = createLoopbackPair();
    const scheduled: { callback: () => void; cancelled: boolean }[] = [];
    const failures: { cls: string; from: number; blockedSeq: number; attempts: number; reason: string }[] = [];
    let resyncRequests = 0;
    pair.host.onMessage(message => {
      if (message.t === "coopResync") {
        resyncRequests++;
      }
    });
    const hooks: CoopDurabilityHooks = {
      extractKey: message => (message.t === "waveResolved" ? { cls: "wave", seq: message.wave } : null),
      apply: () => "rejected",
      scheduleRecovery: callback => {
        const timer = { callback, cancelled: false };
        scheduled.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
      recoveryInitialMs: 1,
      recoveryMaxMs: 1,
      recoveryMaxAttempts: 3,
      recoveryDeadlineMs: 100,
      onRecoveryExhausted: failure => failures.push(failure),
    };
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, hooks);

    // Pre-fix, seq=2's synchronous gap response recursively replayed [1,2] until the process OOMed.
    expect(hostMgr.commit("wave", 1, { t: "waveResolved", wave: 1, outcome: "win" })).toBe(true);
    expect(hostMgr.commit("wave", 2, { t: "waveResolved", wave: 2, outcome: "win" })).toBe(true);
    await flush();
    expect(resyncRequests, "nested rejection/gap deliveries coalesce behind the in-flight request").toBe(1);

    while (scheduled.some(timer => !timer.cancelled) && failures.length === 0) {
      const next = scheduled.find(timer => !timer.cancelled)!;
      next.cancelled = true;
      next.callback();
      await flush();
    }

    expect(failures).toEqual([{ cls: "wave", from: 0, blockedSeq: 2, attempts: 3, reason: "apply-rejected" }]);
    expect(resyncRequests, "the retry budget is finite and never recursively amplifies").toBe(3);
    const requestsAtTerminal = resyncRequests;
    hostMgr.reconnect();
    await flush();
    expect(resyncRequests, "the exhausted boundary stays latched until state actually advances").toBe(
      requestsAtTerminal,
    );
    expect(guestMgr.appliedMarks()).toEqual({});

    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("T2b: a DUPLICATE apply (already consumed) still ACKs, so a resend cannot spin the committer forever", async () => {
    const pair = createLoopbackPair();
    const guestGate = new ChannelGate(pair.guest);
    const hooks: CoopDurabilityHooks = {
      extractKey: msg => (msg.t === "waveResolved" ? { cls: "wave", seq: msg.wave } : null),
      apply: () => "duplicate" as CoopApplyOutcome,
    };
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(guestGate, hooks);

    hostMgr.commit("wave", 1, { t: "waveResolved", wave: 1, outcome: "win" });
    await flush();
    expect(
      guestGate.sentTypes.filter(t => t === "coopAck").length,
      "a duplicate/already-consumed op must ACK so the committer's resend loop terminates",
    ).toBeGreaterThan(0);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // T3 - the SAME committed op re-delivered by the journal routes to the sink EXACTLY ONCE (P0-2 recording).
  // EXPECTED RED (pre-remediation): "passes" only because the journal was a NO-OP w.r.t. live state (nothing
  // to double-apply). This asserts exactly-once ROUTING once the journal actually mutates.
  // ===========================================================================================
  it("T3: a committed biome op re-delivered (resend + reconnect tail) routes to the live-mutation seam exactly once", async () => {
    const sinkSeen: number[] = [];
    registerCoopOperationLiveSink("op:biome", env => {
      sinkSeen.push((env.pendingOperation?.payload as CoopBiomePickPayload).biomeId);
      return true;
    });

    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostOwnedBiome(2, BiomeId.END);
    await flush();
    // A redundant resend + a reconnect tail re-deliver the SAME committed op - it must NOT re-route.
    hostMgr.reconnect();
    guestMgr.reconnect();
    await flush();
    hostMgr.reconnect();
    await flush();

    expect(sinkSeen, "exactly-once routing across resend + reconnect re-deliveries").toEqual([BiomeId.END]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // T4 - COLD resume at revision N: the producer emits N+1 and the restored receiver ACCEPTS it (P0-3).
  // EXPECTED RED (pre-remediation): each surface CoopOperationHost restarted at revision 0, so the producer
  // emitted revision 1; the receiver ledger restored to N discarded it as a stale duplicate (1 <= N).
  // ===========================================================================================
  it("T4: after a cold resume at revision N, the producer emits N+1 and the restored receiver applies it", async () => {
    const N = 5;
    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);
    registerCoopOperationLiveSink("op:biome", () => true);

    // Simulate a COLD resume at high-water N for op:biome: restore BOTH managers' marks and floor the surface.
    hostMgr.restore({ "op:global": N }, { "op:global": N });
    guestMgr.restore({ "op:global": N }, { "op:global": N });
    setCoopBiomeOperationRevisionFloor(N);

    // The FIRST post-resume producer op must emit revision N+1 (not 1) so the restored receiver ACCEPTS it
    // (pre-fix: the producer restarts at 0 -> emits revision 1 -> the receiver ledger at N drops it as stale).
    commitHostOwnedBiome(2, BiomeId.VOLCANO);
    await flush();

    const applied = getCoopOperationJournalApplied();
    const last = applied.at(-1);
    expect(last?.revision, "the resumed producer must continue at N+1, not restart at 1").toBe(N + 1);
    expect(
      applied.map(e => (e.pendingOperation?.payload as CoopBiomePickPayload).biomeId),
      "the restored receiver must APPLY the resumed op (not discard it as a stale duplicate)",
    ).toEqual([BiomeId.VOLCANO]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // T8 - a mid-stream lost reward action: ordinals + operationIds stay aligned after the tail replay.
  // A multi-action reward stream drops action #2; the gap-triggered tail heals it in ORDER.
  // ===========================================================================================
  it("T8: a lost reward action mid-stream is healed in order - ordinals + operationIds stay aligned", async () => {
    const sinkIds: string[] = [];
    registerCoopOperationLiveSink("op:reward", env => {
      sinkIds.push(env.pendingOperation?.id ?? "");
      return true;
    });

    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const hostMgr = new CoopDurabilityManager(hostGate);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);
    setCoopRewardAuthorityStateHooksForTest({
      capture: () => null,
      apply: () => true,
      reapply: () => true,
    });

    const pinned = 4; // even -> host seat (host-owned reward stream)
    const authoritativeState = (tick: number): CoopAuthoritativeBattleStateV1 => ({
      version: 1,
      tick,
      wave: 11,
      turn: 0,
      playerParty: [{ id: 1 }],
      enemyParty: [],
      field: [],
      weather: 0,
      weatherTurnsLeft: 0,
      terrain: 0,
      terrainTurnsLeft: 0,
      arenaTags: [],
      money: 1_000 - tick,
      pokeballCounts: [],
      playerModifiers: [{ typeId: `reward-${tick}` }],
      enemyModifiers: [],
    });
    function commitAction(label: string, choice: number, terminal: boolean): void {
      const prepared = commitRewardOwnerIntent({
        surface: "reward",
        pinned,
        label,
        choice,
        data: [choice],
        terminal,
        localRole: "host",
        wave: 11,
      } satisfies Parameters<typeof commitRewardOwnerIntent>[0]);
      expect(prepared, "the typed intent must be retained before host execution").not.toBeNull();
      if (choice === 0) {
        expect(
          commitRewardAuthoritativeResult(prepared!.operationId, {
            ...authoritativeState(1),
            tick: 0,
            playerParty: [],
          }),
          "an empty control placeholder must never be journaled as a completed reward",
        ).toBeNull();
      }
      expect(
        commitRewardAuthoritativeResult(prepared!.operationId, authoritativeState(choice + 1)),
        "only the complete post-action result may enter the durability journal",
      ).not.toBeNull();
    }

    commitAction("reward", 0, false); // ordinal 0 -> revision 1
    await flush();
    hostGate.cut = true;
    commitAction("reward", 1, false); // ordinal 1 -> revision 2 - LOST on the wire
    await flush();
    hostGate.cut = false;
    commitAction("skip", 2, true); // ordinal 2 -> revision 3 - arrives, guest sees a gap
    await flush();
    // Heal the gap: the guest requested the tail after rev 1; the host replays 2 then 3 in order.
    hostMgr.reconnect();
    guestMgr.reconnect();
    await flush();

    const applied = getCoopOperationJournalApplied().filter(
      e => (e.pendingOperation?.payload as CoopRewardActionPayload) != null,
    );
    // All three actions converged, in revision order, exactly once each.
    expect(applied.map(e => e.revision)).toEqual([1, 2, 3]);
    expect(sinkIds.length, "each action routes to the sink exactly once").toBe(3);
    // The operationIds are distinct + monotonic in ordinal (the pin*STRIDE + ordinal addressing stays aligned).
    expect(new Set(sinkIds).size).toBe(3);
    hostMgr.dispose();
    guestMgr.dispose();
  });
});
