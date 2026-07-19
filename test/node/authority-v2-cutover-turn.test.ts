/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-lane unit tests for co-op AUTHORITY V2 - CUTOVER SURFACE 1 (turn/command):
// the switchboard + the harness's live-replica routing.
//
// The switchboard (cutover-turn.ts) is engine-free (the harness type is node-pure;
// the live replica seams are injected interfaces), so it runs in the node-pure
// project in milliseconds. The properties pinned here are the cutover contract:
//   - mode resolution FAILS CLOSED: v2 iff build-enabled AND negotiated AND the
//     harness is present; any missing precondition -> legacy;
//   - one suppression predicate per legacy loop the cutover retires;
//   - active-cutover accounting (set/clear/isActive) is a single module ref;
//   - CoopV2TurnCutover.commitHostTurn commits the v2 TURN_COMMIT via the harness;
//   - the harness's LIVE replica seams route a delivered TURN_COMMIT through the
//     injected real applier + projector (recorded), the entry retires, and shadow
//     state is still recorded; a live seam that returns null falls through to the
//     in-memory shadow behaviour byte-for-byte (a non-cutover kind stays shadow);
//   - with NO live seams the harness is pure shadow (the capability-off baseline).
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import type {
  CoopAuthorityEntry,
  CoopControlInstallResult,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  activeCoopTurnAuthorityMode,
  CoopV2TurnCutover,
  clearActiveCoopV2TurnCutover,
  getActiveCoopV2TurnCutover,
  isCoopV2TurnCutoverActive,
  isCoopV2TurnEnabled,
  resolveCoopTurnAuthorityMode,
  setActiveCoopV2TurnCutover,
  suppressesLegacyGuestTurnRequest,
  suppressesLegacyNextCommandBarrier,
  suppressesLegacyTurnAckProgression,
  suppressesLegacyTurnResend,
} from "#data/elite-redux/coop/authority-v2/cutover-turn";
import type { CoopFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import { encodeFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import {
  type CoopSchedulerClock,
  type CoopTimerHandle,
  createCoopScheduler,
} from "#data/elite-redux/coop/authority-v2/scheduler";
import {
  CoopAuthorityV2Shadow,
  type CoopV2LiveReplicaSeams,
  type CoopV2ShadowIdentity,
  clearActiveCoopV2Shadow,
  clearCoopV2ShadowInbound,
  registerCoopV2ShadowInbound,
  routeCoopV2InboundFrame,
} from "#data/elite-redux/coop/authority-v2/shadow";
import { afterEach, describe, expect, it } from "vitest";

// --- deterministic test doubles ---------------------------------------------

/** A fully deterministic wall clock + timer queue (no real time). */
class FakeClock implements CoopSchedulerClock {
  private t = 0;
  private seq = 1;
  private readonly pending = new Map<number, { fireAt: number; cb: () => void }>();

  now(): number {
    return this.t;
  }

  setTimer(cb: () => void, delayMs: number): CoopTimerHandle {
    const id = this.seq++;
    this.pending.set(id, { fireAt: this.t + Math.max(0, delayMs), cb });
    return id;
  }

  clearTimer(handle: CoopTimerHandle): void {
    this.pending.delete(handle as number);
  }
}

const STUB_SCENE = {} as unknown as BattleScene;
const STUB_TRANSPORT = {} as unknown as import("#data/elite-redux/coop/coop-transport").CoopTransport;

const SESSION = {
  sessionId: "sess-cutover-1",
  runId: "run-cutover-1",
  epoch: 4,
  authoritySeatId: 0,
  membershipRevision: 1,
  seatMapId: "seatmap-cutover-1",
};

function identity(localSeatId: number): CoopV2ShadowIdentity {
  return {
    runtimeId: `${SESSION.sessionId}:seat${localSeatId}`,
    sessionId: SESSION.sessionId,
    runId: SESSION.runId,
    epoch: SESSION.epoch,
    localSeatId,
    authoritySeatId: SESSION.authoritySeatId,
    membershipRevision: SESSION.membershipRevision,
    seatMapId: SESSION.seatMapId,
    connectionGeneration: 0,
    peerBindings: [{ seatId: localSeatId === 0 ? 1 : 0, connectionGeneration: 0 }],
  };
}

/** Validate a wire string via the SAME boundary the transport uses, then deliver the valid frame to a harness. */
function routeInto(harness: CoopAuthorityV2Shadow, wire: string): void {
  registerCoopV2ShadowInbound(frame => harness.handleInboundFrame(frame));
  try {
    routeCoopV2InboundFrame(wire);
  } finally {
    clearCoopV2ShadowInbound();
  }
}

/**
 * A host+guest harness pair over an in-memory channel (the shadow test's pattern). The GUEST optionally gets
 * injected live replica seams so a delivered entry routes through the real (here: recording-fake) applier +
 * projector - the cutover's guest path.
 */
function buildDuo(
  clock: FakeClock,
  guestLive?: CoopV2LiveReplicaSeams,
): {
  host: CoopAuthorityV2Shadow;
  guest: CoopAuthorityV2Shadow;
  dispose(): void;
} {
  let host!: CoopAuthorityV2Shadow;
  let guest!: CoopAuthorityV2Shadow;
  const deliver = (target: () => CoopAuthorityV2Shadow) => (frame: CoopFrameV2) =>
    routeInto(target(), encodeFrameV2(frame));
  host = new CoopAuthorityV2Shadow({
    identity: identity(0),
    scene: STUB_SCENE,
    transport: STUB_TRANSPORT,
    send: frame => deliver(() => guest)(frame),
    scheduler: createCoopScheduler(clock),
  });
  guest = new CoopAuthorityV2Shadow({
    identity: identity(1),
    scene: STUB_SCENE,
    transport: STUB_TRANSPORT,
    send: frame => deliver(() => host)(frame),
    scheduler: createCoopScheduler(clock),
    ...(guestLive == null ? {} : { liveReplica: guestLive }),
  });
  return {
    host,
    guest,
    dispose: () => {
      host.dispose();
      guest.dispose();
    },
  };
}

function turnTap(operationId = "TURN/w5/t1") {
  const capture = { turnResolution: { events: [1, 2, 3] }, checkpoint: { hp: 100 } };
  return {
    operationId,
    capture,
    nextCommandFrontier: {
      epoch: SESSION.epoch,
      wave: 5,
      resolvedTurn: 1,
      commands: [{ ownerSeatId: 0, pokemonId: 42, fieldIndex: 0 }],
    },
    legacyImage: capture,
    legacyDigest: "legacy-turn",
  };
}

afterEach(() => {
  clearActiveCoopV2TurnCutover();
  clearActiveCoopV2Shadow();
  clearCoopV2ShadowInbound();
});

// --- tests ------------------------------------------------------------------

describe("authority-v2 turn cutover - mode resolution (fail closed)", () => {
  it("is v2 ONLY when build-enabled AND negotiated AND the harness is present", () => {
    expect(resolveCoopTurnAuthorityMode({ buildEnabled: true, negotiated: true, harnessPresent: true })).toBe("v2");
  });

  it("is legacy when ANY precondition is missing", () => {
    for (const inputs of [
      { buildEnabled: false, negotiated: true, harnessPresent: true },
      { buildEnabled: true, negotiated: false, harnessPresent: true },
      { buildEnabled: true, negotiated: true, harnessPresent: false },
      { buildEnabled: false, negotiated: false, harnessPresent: false },
    ]) {
      expect(resolveCoopTurnAuthorityMode(inputs)).toBe("legacy");
    }
  });

  it("advertises OFF by default (no COOP_AUTHORITY_V2_TURN env in the test runner)", () => {
    // The build flag is read once at module load; the node lane never sets the env, so the cutover ships dark.
    expect(isCoopV2TurnEnabled()).toBe(false);
  });
});

describe("authority-v2 turn cutover - suppression predicates", () => {
  it("suppresses every legacy turn loop in v2 mode and NONE in legacy mode", () => {
    for (const suppress of [
      suppressesLegacyTurnResend,
      suppressesLegacyGuestTurnRequest,
      suppressesLegacyNextCommandBarrier,
      // The host's legacy turn-ACK terminal check retires under cutover too: the cosmetic carrier's ACK is
      // non-authoritative (the v2 receipt owns retirement), so a retained==null turn ACK is expected, not a
      // violation. Off (legacy) it stays armed, byte-identical to the pre-cutover build.
      suppressesLegacyTurnAckProgression,
    ]) {
      expect(suppress("v2")).toBe(true);
      expect(suppress("legacy")).toBe(false);
    }
  });
});

describe("authority-v2 turn cutover - active accounting (ship-safety gate)", () => {
  it("is INACTIVE by default so every legacy seam takes its exact legacy path", () => {
    expect(isCoopV2TurnCutoverActive()).toBe(false);
    expect(getActiveCoopV2TurnCutover()).toBeNull();
    expect(activeCoopTurnAuthorityMode()).toBe("legacy");
  });

  it("set/clear flips the single active reference; clear is match-scoped", () => {
    const clock = new FakeClock();
    const duo = buildDuo(clock);
    const cutover = new CoopV2TurnCutover(duo.host);

    setActiveCoopV2TurnCutover(cutover);
    expect(isCoopV2TurnCutoverActive()).toBe(true);
    expect(getActiveCoopV2TurnCutover()).toBe(cutover);
    expect(activeCoopTurnAuthorityMode()).toBe("v2");

    // A clear scoped to a DIFFERENT cutover leaves the active one intact.
    clearActiveCoopV2TurnCutover(new CoopV2TurnCutover(duo.guest));
    expect(isCoopV2TurnCutoverActive()).toBe(true);

    clearActiveCoopV2TurnCutover(cutover);
    expect(isCoopV2TurnCutoverActive()).toBe(false);

    duo.dispose();
  });
});

describe("authority-v2 turn cutover - host commit", () => {
  it("commitHostTurn commits the v2 TURN_COMMIT via the harness and the guest retires it", () => {
    const clock = new FakeClock();
    const duo = buildDuo(clock);
    const cutover = new CoopV2TurnCutover(duo.host);

    const entry = cutover.commitHostTurn(turnTap());
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe("TURN_COMMIT");
    expect(entry?.revision).toBe(1);

    const host = duo.host.diagnostics();
    const guest = duo.guest.diagnostics();
    // The commit round-tripped: the guest admitted + applied it, and the authority retired it (no dual carrier).
    expect(host.committed).toBe(1);
    expect(guest.admitted).toBe(1);
    expect(guest.applied).toBe(1);
    expect(host.retained).toBe(0);
    expect(host.pendingTimers).toBe(0);

    cutover.dispose();
    // A disposed cutover never commits again.
    expect(cutover.commitHostTurn(turnTap("TURN/after-dispose"))).toBeNull();
    duo.dispose();
  });
});

describe("authority-v2 turn cutover - guest LIVE replica routing", () => {
  it("routes a delivered TURN_COMMIT through the injected REAL applier + projector, retires it, and records shadow state", () => {
    const applied: number[] = [];
    const projected: string[] = [];
    const live: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: control => control.kind === "COMMAND_FRONTIER",
      applyMaterial(_ctx, entry: CoopAuthorityEntry): boolean | null {
        if (entry.kind !== "TURN_COMMIT") {
          return null; // only TURN is cut over on the guest.
        }
        applied.push(entry.revision);
        return true;
      },
      projectControl(_ctx, control: NonNullable<CoopNextControl>): CoopControlInstallResult | null {
        if (control.kind !== "COMMAND_FRONTIER") {
          return null;
        }
        const controlId = controlIdOf(control);
        projected.push(controlId);
        return { kind: "installed", controlId };
      },
    };
    const clock = new FakeClock();
    const duo = buildDuo(clock, live);

    duo.host.tapTurnCommit(turnTap());

    // The LIVE seams fired for the turn (the real applier + the COMMAND projector).
    expect(applied).toEqual([1]);
    expect(projected).toHaveLength(1);

    const guest = duo.guest.diagnostics();
    // Applied through the pipeline, and the entry retired (controlInstalled signed) with shadow state recorded too.
    expect(guest.applied).toBe(1);
    expect(guest.controlLedgerSize).toBe(1);
    expect(guest.shadowStateSize).toBe(1);
    expect(duo.host.diagnostics().retained).toBe(0);

    duo.dispose();
  });

  it("applies the material seam (materialApplied) BEFORE the projector signs controlInstalled", () => {
    // The fixed cutover contract: the v2 replica pipeline resolves the material/checkpoint legacy-consumer
    // seam (applyMaterial -> materialApplied) BEFORE the projector signs controlInstalled (retirement). If
    // the projector signed first, retirement would race a checkpoint that had not yet reconciled guest state.
    const timeline: string[] = [];
    const live: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: control => control.kind === "COMMAND_FRONTIER",
      applyMaterial(_ctx, entry: CoopAuthorityEntry): boolean | null {
        if (entry.kind !== "TURN_COMMIT") {
          return null;
        }
        timeline.push("applyMaterial");
        return true;
      },
      projectControl(_ctx, control: NonNullable<CoopNextControl>): CoopControlInstallResult | null {
        if (control.kind !== "COMMAND_FRONTIER") {
          return null;
        }
        timeline.push("projectControl");
        return { kind: "installed", controlId: controlIdOf(control) };
      },
    };
    const clock = new FakeClock();
    const duo = buildDuo(clock, live);

    duo.host.tapTurnCommit(turnTap());

    // Material reconciles first; only then is the COMMAND control's controlInstalled signed.
    expect(timeline).toEqual(["applyMaterial", "projectControl"]);
    // And the turn retired with no dual legacy authority left retained on the host.
    expect(duo.guest.diagnostics().applied).toBe(1);
    expect(duo.host.diagnostics().retained).toBe(0);

    duo.dispose();
  });

  it("a live seam that returns null falls through to the in-memory shadow behaviour, byte-identical to pure shadow", () => {
    // A fall-through seam (returns null for every kind/control) must leave the harness behaving exactly like
    // a harness with NO live seams at all - the capability-off / non-cutover-kind guarantee.
    const fallThrough: CoopV2LiveReplicaSeams = {
      ownsEntry: () => false,
      ownsControl: () => false,
      applyMaterial: () => null,
      projectControl: () => null,
    };
    const clock = new FakeClock();

    const withSeam = buildDuo(clock, fallThrough);
    withSeam.host.tapTurnCommit(turnTap());
    const seamGuest = withSeam.guest.diagnostics();
    withSeam.dispose();

    const pure = buildDuo(new FakeClock());
    pure.host.tapTurnCommit(turnTap());
    const pureGuest = pure.guest.diagnostics();
    pure.dispose();

    // Fall-through == pure shadow across every replica-observable counter.
    expect(seamGuest.applied).toBe(pureGuest.applied);
    expect(seamGuest.controlLedgerSize).toBe(pureGuest.controlLedgerSize);
    expect(seamGuest.shadowStateSize).toBe(pureGuest.shadowStateSize);
    expect(seamGuest.receiptsSent).toBe(pureGuest.receiptsSent);
  });

  it("never signs shadow materialApplied when an owned live material verb returns null", () => {
    const live: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: control => control.kind === "COMMAND_FRONTIER",
      applyMaterial: () => null,
      projectControl: () => null,
    };
    const duo = buildDuo(new FakeClock(), live);

    duo.host.tapTurnCommit(turnTap("TURN/owned-null-material"));

    expect(duo.guest.diagnostics().shadowStateSize).toBe(0);
    expect(duo.guest.diagnostics().applied).toBe(0);
    expect(duo.host.diagnostics().retained).toBe(1);
    duo.dispose();
  });

  it("never signs shadow controlInstalled when an owned live projector returns null", () => {
    const live: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: control => control.kind === "COMMAND_FRONTIER",
      applyMaterial: () => true,
      projectControl: () => null,
    };
    const duo = buildDuo(new FakeClock(), live);

    duo.host.tapTurnCommit(turnTap("TURN/owned-null-control"));

    expect(duo.guest.diagnostics().shadowStateSize).toBe(1);
    expect(duo.guest.diagnostics().controlLedgerSize).toBe(0);
    expect(duo.guest.diagnostics().applied).toBe(0);
    expect(duo.host.diagnostics().retained).toBe(1);
    duo.dispose();
  });
});

describe("authority-v2 turn cutover - replica context binding + authority self-apply guard", () => {
  it("delivers the applier a context that identifies a REPLICA (localSeat != authoritySeat) vs the AUTHORITY", () => {
    // The live seam (coop-runtime buildCoopV2TurnLiveSeams) must NOT read the ambient runtime/scene: the first
    // TURN_COMMIT delivery is SYNCHRONOUS on commit, so in a single-realm session it can run under a foreign
    // ambient. The seam instead consults the CONTEXT its harness carries. This locks that the delivered context
    // exposes the seat discriminator both fixes rely on: on the guest replica localSeatId != authoritySeatId
    // (it applies + wakes ITS OWN streamer), and the authority is exactly the seat where they are equal (it must
    // decline to replicate its own committed turn - the Yawn self-apply corruption guard).
    const seenCtx: { localSeatId: number; authoritySeatId: number }[] = [];
    const live: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: control => control.kind === "COMMAND_FRONTIER",
      applyMaterial(ctx, entry: CoopAuthorityEntry): boolean | null {
        if (entry.kind !== "TURN_COMMIT") {
          return null;
        }
        seenCtx.push({ localSeatId: ctx.localSeatId, authoritySeatId: ctx.authoritySeatId });
        return true;
      },
      projectControl: (_ctx, control: NonNullable<CoopNextControl>): CoopControlInstallResult | null =>
        control.kind === "COMMAND_FRONTIER" ? { kind: "installed", controlId: controlIdOf(control) } : null,
    };
    const clock = new FakeClock();
    const duo = buildDuo(clock, live);

    duo.host.tapTurnCommit(turnTap());

    // The guest replica applied under ITS seat (1), the authority seat is 0, and the two differ - so a runtime
    // whose local seat EQUALS the authority seat (the host) can recognize its own turn and skip replicating it.
    expect(seenCtx).toEqual([{ localSeatId: 1, authoritySeatId: 0 }]);
    expect(seenCtx[0].localSeatId).not.toBe(seenCtx[0].authoritySeatId);
    duo.dispose();
  });

  it("rejects an AUTHORITY self-loopback before it can enter replica or shadow state", () => {
    // Models the Yawn/B-13 corruption: a single-engine spoof peer (or the module-level inbound fallback) routes
    // the authority's OWN committed TURN_COMMIT back into its own inbound path. AuthorityLog admission now
    // rejects senderSeat===local authority before the replica applier or shadow ledger can observe it. This is
    // stronger than relying on the later live seam to decline the numeric checkpoint: there is no second
    // authority, no shadow accounting lie, and no chance to drop companions like sleepTurnsRemaining.
    const applyCalls: number[] = [];
    const engineApplies: number[] = [];
    const authoritySkipSeam: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: control => control.kind === "COMMAND_FRONTIER",
      applyMaterial(ctx, entry: CoopAuthorityEntry): boolean | null {
        if (entry.kind !== "TURN_COMMIT") {
          return null;
        }
        applyCalls.push(entry.revision);
        if (ctx.localSeatId === ctx.authoritySeatId) {
          return null;
        }
        engineApplies.push(entry.revision);
        return true;
      },
      projectControl: () => null,
    };
    const clock = new FakeClock();
    // A harness on the AUTHORITY seat (0) whose send self-loopbacks the committed frame back into itself.
    let authority!: CoopAuthorityV2Shadow;
    authority = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => routeInto(authority, encodeFrameV2(frame)),
      scheduler: createCoopScheduler(clock),
      liveReplica: authoritySkipSeam,
    });

    authority.tapTurnCommit(turnTap());

    const diag = authority.diagnostics();
    // The hostile/self-routed delivery is rejected at the authenticated authority/replica role boundary.
    expect(applyCalls).toEqual([]);
    expect(engineApplies).toEqual([]);
    expect(diag.admitted).toBe(0);
    expect(diag.applied).toBe(0);
    expect(diag.shadowStateSize).toBe(0);
    authority.dispose();
  });
});
