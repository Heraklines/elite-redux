/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-pure tests for co-op authority-v2 Interactions lane 2 (mystery encounter
// + catch-full + revival adapter).
//
// These pin the ENGINE-FREE interaction transactions that replace the legacy
// carriers (coop-me-operation.ts, coop-catch-full-operation.ts,
// coop-revival-operation.ts):
//   - ME option pick: owner-seat addressed; host-owned (seat 0) and guest-owned
//     (seat 1) are SYMMETRIC by seat; the battle-handoff is an EXPLICIT material
//     field (the terminal-without-trailing-resync class, #693);
//   - ME outcome/terminal: ONE entry that subsumes the stale ME option-pick waits
//     on its window via `subsumes` (retired by ordinary log order);
//   - MAJOR-3 STRUCTURAL rejection: an embedded reward advance addressed inside an
//     open ME window cannot be built (the invariant is material, not delivery pacing);
//   - catch-full keep/release + revival pick material validation + applier;
//   - the replica applier closes an open watcher (owner-install anti-softlock) and
//     rejects a tampered digest;
//   - zero scheduler timers survive after the entries retire (zero-leak).
// No Phaser / globalScene / legacy netcode is imported.
// =============================================================================

import {
  addressInsideOpenWindow,
  buildCatchFullDecisionEntry,
  buildMysteryEmbeddedAdvanceEntry,
  buildMysteryOptionPickEntry,
  buildMysteryTerminalEntry,
  buildRevivalPickEntry,
  type CoopInteractionAddress,
  type CoopInteractionApplierSurface,
  CoopInteractionBuildError,
  type CoopInteractionMaterial,
  catchFullOperationId,
  decodeInteractionMaterial,
  interactionMaterialDigest,
  interactionShadowsAgree,
  isValidCatchFullMaterial,
  isValidInteractionMaterial,
  isValidRevivalMaterial,
  makeInteractionApplier,
  mysteryOptionPickOperationId,
  mysteryTerminalOperationId,
  mysteryWindowSubsumes,
  type OpenInteractionWatcher,
  openMysteryWindow,
  revivalOperationId,
  shadowOfInteractionEntry,
} from "#data/elite-redux/coop/authority-v2/adapters/interactions-mystery";
import { isValidAuthorityEntry } from "#data/elite-redux/coop/authority-v2/authority-entry";
import { AuthorityLog, type CoopAuthorityWire } from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthorityEntry,
  CoopAuthorityReceipt,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import { type CoopSchedulerClock, createCoopScheduler } from "#data/elite-redux/coop/authority-v2/scheduler";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRAME: CoopFrameContextV2 = {
  sessionId: "session-A",
  runId: "run-A",
  sessionEpoch: 1,
  seatMapId: "seatmap-A",
  membershipRevision: 1,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 1,
};

function address(over: Partial<CoopInteractionAddress> = {}): CoopInteractionAddress {
  return { epoch: 1, wave: 12, turn: 1, interactionSeq: 4, ownerSeatId: 0, ...over };
}

function mysterySuccessor(ownerSeatId = 0): Extract<CoopNextControl, { kind: "SHARED_INTERACTION" }> {
  return {
    kind: "SHARED_INTERACTION",
    operationId: "me-op-42",
    ownerSeatId,
    epoch: 1,
    wave: 12,
    turn: 1,
    surfaceClass: "op:me",
    operationKind: "ME_PRESENT",
    successor: { operationKinds: ["ME_PICK"], operationIds: null },
  };
}

function exactMysterySuccessor(
  operationKind: "ME_PICK" | "ME_TERMINAL",
  operationId: string,
  ownerSeatId = 0,
): Extract<CoopNextControl, { kind: "SHARED_INTERACTION" }> {
  return {
    ...mysterySuccessor(ownerSeatId),
    successor: { operationKinds: [operationKind], operationIds: [operationId] },
  };
}

const MYSTERY_SUCCESSOR = mysterySuccessor();
const BATTLE_SUCCESSOR: CoopNextControl = {
  kind: "COMMAND_FRONTIER",
  epoch: 1,
  wave: 12,
  turn: 1,
  commands: [{ ownerSeatId: 0, pokemonId: 55, fieldIndex: 0 }],
};
const REWARD_SUCCESSOR: CoopNextControl = {
  kind: "SHARED_INTERACTION",
  operationId: "rew-op-9",
  ownerSeatId: 0,
  epoch: 1,
  wave: 12,
  turn: 1,
  surfaceClass: "op:reward",
  operationKind: "REWARD_PRESENT",
  successor: { operationKinds: ["REWARD"], operationIds: null },
};

/**
 * A deterministic {@link CoopSchedulerClock}: `setTimer` records a fire-at, and
 * `advance` fires every timer whose deadline the advanced wall time crossed. This
 * drives the REAL CoopSchedulerImpl (no re-implementation of active-time).
 */
class ManualClock implements CoopSchedulerClock {
  private wall = 0;
  private seq = 0;
  private readonly timers = new Map<number, { fireAt: number; cb: () => void }>();

  now(): number {
    return this.wall;
  }

  setTimer(callback: () => void, delayMs: number): number {
    const id = ++this.seq;
    this.timers.set(id, { fireAt: this.wall + Math.max(0, delayMs), cb: callback });
    return id;
  }

  clearTimer(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(ms: number): void {
    this.wall += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.fireAt <= this.wall) {
        this.timers.delete(id);
        timer.cb();
      }
    }
  }
}

function makeLog(sent: CoopAuthorityWire[]) {
  const scheduler = createCoopScheduler(new ManualClock());
  const log = new AuthorityLog({
    localContext: FRAME,
    scheduler,
    send: wire => sent.push(wire),
    peerBindings: [{ seatId: 1, connectionGeneration: FRAME.connectionGeneration }],
  });
  return { log, scheduler };
}

function receipt(
  entry: CoopAuthorityEntry,
  stage: CoopAuthorityReceipt["stage"],
  controlId?: string,
): CoopAuthorityReceipt {
  return {
    context: { ...entry.context, senderSeatId: 1 },
    revision: entry.revision,
    operationId: entry.operationId,
    stage,
    ...(controlId == null ? {} : { controlId }),
  };
}

// ---------------------------------------------------------------------------
// (1) ME option pick - owner-seat addressed, symmetric, battle-handoff explicit
// ---------------------------------------------------------------------------

describe("ME option pick", () => {
  it("builds a non-handoff pick the foundation validator accepts, opening the ME window", () => {
    const { entry, window } = buildMysteryOptionPickEntry({
      context: FRAME,
      address: address(),
      optionIndex: 2,
      successor: MYSTERY_SUCCESSOR,
    });
    expect(entry.kind).toBe("INTERACTION_COMMIT");
    expect(isValidAuthorityEntry({ ...entry, revision: 3 })).toBe(true);
    expect(entry.operationId).toBe(mysteryOptionPickOperationId(address(), 0));
    // A non-handoff pick opens the window and states an OPEN material window.
    expect(window).toEqual(openMysteryWindow(address()));
    const material = entry.material.payload as CoopInteractionMaterial;
    expect(material.kind).toBe("me-option-pick");
    if (material.kind === "me-option-pick") {
      expect(material.battleHandoff).toBe(false);
      expect(material.window).toBe("open");
      expect(material.optionIndex).toBe(2);
    }
    expect(entry.material.digest).toBe(interactionMaterialDigest(material));
    expect(entry.nextControl).toEqual(MYSTERY_SUCCESSOR);
  });

  it("is SYMMETRIC by seat: host-owned (seat 0) and guest-owned (seat 1) differ only in the address", () => {
    const hostPick = buildMysteryOptionPickEntry({
      context: FRAME,
      address: address({ ownerSeatId: 0 }),
      optionIndex: 1,
      successor: mysterySuccessor(0),
    });
    const guestPick = buildMysteryOptionPickEntry({
      context: FRAME,
      address: address({ ownerSeatId: 1 }),
      optionIndex: 1,
      successor: mysterySuccessor(1),
    });
    // Distinct owner-seat addresses (no host/guest branch - only the seat id changes).
    expect(hostPick.entry.operationId).not.toBe(guestPick.entry.operationId);
    expect(hostPick.entry.operationId).toContain("/s0");
    expect(guestPick.entry.operationId).toContain("/s1");
    const hostMaterial = hostPick.entry.material.payload as CoopInteractionMaterial;
    const guestMaterial = guestPick.entry.material.payload as CoopInteractionMaterial;
    if (hostMaterial.kind === "me-option-pick" && guestMaterial.kind === "me-option-pick") {
      expect(hostMaterial.address.ownerSeatId).toBe(0);
      expect(guestMaterial.address.ownerSeatId).toBe(1);
      // Everything but the addressed seat is identical - the surfaces are symmetric.
      expect({ ...hostMaterial, address: { ...hostMaterial.address, ownerSeatId: 0 } }).toEqual({
        ...guestMaterial,
        address: { ...guestMaterial.address, ownerSeatId: 0 },
      });
    }
  });

  it("states the BATTLE-HANDOFF as an explicit field and closes the window by itself (#693)", () => {
    const { entry, window } = buildMysteryOptionPickEntry({
      context: FRAME,
      address: address(),
      optionIndex: 0,
      battleHandoff: true,
      successor: BATTLE_SUCCESSOR,
    });
    const material = entry.material.payload as CoopInteractionMaterial;
    expect(material.kind).toBe("me-option-pick");
    if (material.kind === "me-option-pick") {
      // The terminal-without-trailing-resync class is now an EXPLICIT material field.
      expect(material.battleHandoff).toBe(true);
      expect(material.window).toBe("closed");
    }
    // A battle-handoff pick closed the window by itself - no trailing resync/terminal is required to close it.
    expect(window).toBeNull();
    // Its successor is the battle command (the handoff destination).
    expect(entry.nextControl).toEqual(BATTLE_SUCCESSOR);
    // The explicit field is surfaced in the shadow descriptor for parity.
    const shadow = shadowOfInteractionEntry(entry);
    expect(shadow?.battleHandoff).toBe(true);
  });

  it("rejects a malformed pick (non-finite optionIndex / bad address)", () => {
    expect(() =>
      buildMysteryOptionPickEntry({
        context: FRAME,
        address: address(),
        optionIndex: Number.NaN,
        successor: MYSTERY_SUCCESSOR,
      }),
    ).toThrow(CoopInteractionBuildError);
    expect(() =>
      buildMysteryOptionPickEntry({
        context: FRAME,
        address: address({ epoch: 0 }),
        optionIndex: 0,
        successor: MYSTERY_SUCCESSOR,
      }),
    ).toThrow(CoopInteractionBuildError);
  });
});

// ---------------------------------------------------------------------------
// (2) ME outcome/terminal - one entry, subsuming stale ME waits via subsumes
// ---------------------------------------------------------------------------

describe("ME outcome/terminal", () => {
  it("subsumes the unretired ME option-pick waits on its window via the log frontier", () => {
    const sent: CoopAuthorityWire[] = [];
    const { log } = makeLog(sent);
    const pick1OperationId = mysteryOptionPickOperationId(address(), 1);
    const terminalOperationId = mysteryTerminalOperationId(address());

    // Two option-pick steps on the SAME window (present + a sub-pick), both unretired.
    const pick0 = log.commit(
      buildMysteryOptionPickEntry({
        context: FRAME,
        address: address(),
        optionIndex: 1,
        step: 0,
        successor: exactMysterySuccessor("ME_PICK", pick1OperationId),
      }).entry,
    );
    const pick1 = log.commit(
      buildMysteryOptionPickEntry({
        context: FRAME,
        address: address(),
        optionIndex: 0,
        step: 1,
        successor: exactMysterySuccessor("ME_TERMINAL", terminalOperationId),
      }).entry,
    );
    // A synthetic retained pick on a DIFFERENT window must NOT be subsumed. It is deliberately not committed
    // into this mechanical log: one global log cannot interleave an unrelated window into this exact chain.
    const otherPick: CoopAuthorityEntry = {
      ...buildMysteryOptionPickEntry({
        context: FRAME,
        address: address({ interactionSeq: 9 }),
        optionIndex: 0,
        successor: MYSTERY_SUCCESSOR,
      }).entry,
      revision: 99,
    };

    const window = openMysteryWindow(address());
    const subsumed = mysteryWindowSubsumes([...log.retained(), otherPick], window);
    expect(subsumed).toEqual([pick0.revision, pick1.revision]);
    expect(subsumed).not.toContain(otherPick.revision);

    // The ONE terminal entry states the outcome + carries the computed subsumes.
    const terminal = log.commit(
      buildMysteryTerminalEntry({
        context: FRAME,
        address: address(),
        outcome: "leave",
        successor: REWARD_SUCCESSOR,
        subsumes: subsumed,
      }),
    );
    expect(terminal.operationId).toBe(mysteryTerminalOperationId(address()));
    expect(terminal.subsumes).toEqual([pick0.revision, pick1.revision]);
    const terminalMaterial = terminal.material.payload as CoopInteractionMaterial;
    expect(terminalMaterial.kind).toBe("me-terminal");
    if (terminalMaterial.kind === "me-terminal") {
      expect(terminalMaterial.outcome).toBe("leave");
      expect(terminalMaterial.window).toBe("closed");
    }
  });

  it("retires the stale ME waits by ordinary log order when the terminal is admitted", () => {
    const sent: CoopAuthorityWire[] = [];
    const { log } = makeLog(sent);

    const pick = log.commit(
      buildMysteryOptionPickEntry({
        context: FRAME,
        address: address(),
        optionIndex: 1,
        successor: exactMysterySuccessor("ME_TERMINAL", mysteryTerminalOperationId(address())),
      }).entry,
    );
    // The option pick is retained + unretired (its MYSTERY control is not yet installed).
    expect(log.retained().map(e => e.revision)).toContain(pick.revision);

    const terminal = log.commit(
      buildMysteryTerminalEntry({
        context: FRAME,
        address: address(),
        outcome: "battle-settled",
        successor: REWARD_SUCCESSOR,
        subsumes: mysteryWindowSubsumes(log.retained(), openMysteryWindow(address())),
      }),
    );
    // Admitting the terminal (its subsumption acts on first admitted) supersedes the stale option-pick wait.
    expect(log.acceptReceipt(receipt(terminal, "admitted"))).toBe(false);
    const retainedRevisions = log.retained().map(e => e.revision);
    expect(retainedRevisions).not.toContain(pick.revision);
  });
});

// ---------------------------------------------------------------------------
// (3) MAJOR-3 - structural rejection of an embedded advance inside an open window
// ---------------------------------------------------------------------------

describe("MAJOR-3 structural rejection (mid-ME embedded advance)", () => {
  it("addressInsideOpenWindow reports the exact owned-counter predicate", () => {
    const window = openMysteryWindow(address({ interactionSeq: 4 }));
    expect(addressInsideOpenWindow(window, address({ interactionSeq: 4 }))).toBe(true);
    // A DIFFERENT interaction counter, wave, or epoch is outside the window.
    expect(addressInsideOpenWindow(window, address({ interactionSeq: 5 }))).toBe(false);
    expect(addressInsideOpenWindow(window, address({ wave: 13 }))).toBe(false);
    expect(addressInsideOpenWindow(window, address({ epoch: 2 }))).toBe(false);
  });

  it("REJECTS building an embedded advance addressed inside an open ME window", () => {
    // Open a window with a non-handoff option pick.
    const { window } = buildMysteryOptionPickEntry({
      context: FRAME,
      address: address({ interactionSeq: 4 }),
      optionIndex: 0,
      successor: MYSTERY_SUCCESSOR,
    });
    expect(window).not.toBeNull();

    // An embedded reward advance addressed at the window's OWNED counter cannot be built (structural, not pacing).
    expect(() =>
      buildMysteryEmbeddedAdvanceEntry({
        context: FRAME,
        address: address({ interactionSeq: 4 }),
        openWindow: window,
        successor: REWARD_SUCCESSOR,
      }),
    ).toThrow(CoopInteractionBuildError);
  });

  it("ALLOWS an advance once the window is closed (null) or addressed past it", () => {
    const { window } = buildMysteryOptionPickEntry({
      context: FRAME,
      address: address({ interactionSeq: 4 }),
      optionIndex: 0,
      successor: MYSTERY_SUCCESSOR,
    });

    // Past the window (a later interaction counter) - permitted even while the window is open.
    const past = buildMysteryEmbeddedAdvanceEntry({
      context: FRAME,
      address: address({ interactionSeq: 5 }),
      openWindow: window,
      successor: REWARD_SUCCESSOR,
    });
    expect(past.kind).toBe("INTERACTION_COMMIT");

    // With NO open window (the terminal closed it), an advance at the same counter is permitted.
    const afterClose = buildMysteryEmbeddedAdvanceEntry({
      context: FRAME,
      address: address({ interactionSeq: 4 }),
      openWindow: null,
      successor: REWARD_SUCCESSOR,
    });
    expect(afterClose.kind).toBe("INTERACTION_COMMIT");
  });

  it("a battle-handoff pick does NOT open a window, so an advance at its counter is permitted", () => {
    const { window } = buildMysteryOptionPickEntry({
      context: FRAME,
      address: address({ interactionSeq: 4 }),
      optionIndex: 0,
      battleHandoff: true,
      successor: BATTLE_SUCCESSOR,
    });
    expect(window).toBeNull();
    expect(() =>
      buildMysteryEmbeddedAdvanceEntry({
        context: FRAME,
        address: address({ interactionSeq: 4 }),
        openWindow: window,
        successor: REWARD_SUCCESSOR,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (4) catch-full keep/release + revival pick
// ---------------------------------------------------------------------------

describe("catch-full keep/release", () => {
  it("builds a KEEP-into-slot decision the foundation validator accepts", () => {
    const entry = buildCatchFullDecisionEntry({
      context: FRAME,
      address: address(),
      decision: "keep",
      partySlot: 3,
      speciesId: 279,
      successor: BATTLE_SUCCESSOR,
    });
    expect(entry.kind).toBe("INTERACTION_COMMIT");
    expect(isValidAuthorityEntry({ ...entry, revision: 1 })).toBe(true);
    expect(entry.operationId).toBe(catchFullOperationId(address()));
    const material = entry.material.payload as CoopInteractionMaterial;
    if (material.kind === "catch-full") {
      expect(material.decision).toBe("keep");
      expect(material.partySlot).toBe(3);
      expect(material.speciesId).toBe(279);
    }
  });

  it("builds a RELEASE decision (partySlot -1) and rejects malformed slots", () => {
    const release = buildCatchFullDecisionEntry({
      context: FRAME,
      address: address(),
      decision: "release",
      partySlot: -1,
      speciesId: 100,
      successor: BATTLE_SUCCESSOR,
    });
    expect((release.material.payload as { decision: string }).decision).toBe("release");
    // release MUST carry partySlot -1; a keep MUST carry a 0..5 slot.
    expect(
      isValidCatchFullMaterial({
        kind: "catch-full",
        address: address(),
        decision: "release",
        partySlot: 2,
        speciesId: 1,
      }),
    ).toBe(false);
    expect(
      isValidCatchFullMaterial({
        kind: "catch-full",
        address: address(),
        decision: "keep",
        partySlot: 6,
        speciesId: 1,
      }),
    ).toBe(false);
    expect(() =>
      buildCatchFullDecisionEntry({
        context: FRAME,
        address: address(),
        decision: "keep",
        partySlot: 6,
        speciesId: 1,
        successor: BATTLE_SUCCESSOR,
      }),
    ).toThrow(CoopInteractionBuildError);
  });
});

describe("revival pick", () => {
  it("builds a revival pick carrying the field slot + party slot + identity", () => {
    const entry = buildRevivalPickEntry({
      context: FRAME,
      address: address(),
      fieldIndex: 1,
      partySlot: 4,
      speciesId: 405,
      successor: BATTLE_SUCCESSOR,
    });
    expect(entry.operationId).toBe(revivalOperationId(address(), 1));
    const material = entry.material.payload as CoopInteractionMaterial;
    if (material.kind === "revival") {
      expect(material.fieldIndex).toBe(1);
      expect(material.partySlot).toBe(4);
      expect(material.speciesId).toBe(405);
    }
    expect(isValidAuthorityEntry({ ...entry, revision: 7 })).toBe(true);
  });

  it("rejects out-of-domain revival coordinates (fieldIndex/partySlot/speciesId)", () => {
    expect(
      isValidRevivalMaterial({ kind: "revival", address: address(), fieldIndex: 4, partySlot: 0, speciesId: 1 }),
    ).toBe(false);
    expect(
      isValidRevivalMaterial({ kind: "revival", address: address(), fieldIndex: 0, partySlot: 6, speciesId: 1 }),
    ).toBe(false);
    expect(
      isValidRevivalMaterial({ kind: "revival", address: address(), fieldIndex: 0, partySlot: 0, speciesId: 0 }),
    ).toBe(false);
    expect(() =>
      buildRevivalPickEntry({
        context: FRAME,
        address: address(),
        fieldIndex: 9,
        partySlot: 0,
        speciesId: 1,
        successor: BATTLE_SUCCESSOR,
      }),
    ).toThrow(CoopInteractionBuildError);
  });
});

// ---------------------------------------------------------------------------
// (5) replica applier - digest-verified, owner install closes the watcher
// ---------------------------------------------------------------------------

describe("replica applier (watcher-close semantics)", () => {
  const stubCtx = {} as CoopRuntimeContext;

  function catchFullEntry(): CoopAuthorityEntry {
    const built = buildCatchFullDecisionEntry({
      context: FRAME,
      address: address(),
      decision: "keep",
      partySlot: 2,
      speciesId: 279,
      successor: BATTLE_SUCCESSOR,
    });
    return { ...built, revision: 9 };
  }

  it("closes an open local watcher and adopts the committed decision, then installs", () => {
    const adopt = vi.fn();
    const install = vi.fn(() => true);
    const openWatcher: OpenInteractionWatcher = { adopt };
    const surface: CoopInteractionApplierSurface = {
      openWatcherFor: material => (material.kind === "catch-full" ? openWatcher : null),
      installInteraction: install,
    };
    const ok = makeInteractionApplier(surface)(stubCtx, catchFullEntry());
    expect(ok).toBe(true);
    expect(adopt).toHaveBeenCalledTimes(1);
    const adopted = adopt.mock.calls[0][0] as CoopInteractionMaterial;
    expect(adopted.kind).toBe("catch-full");
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("installs without a watcher-close when none is open", () => {
    const install = vi.fn(() => true);
    const surface: CoopInteractionApplierSurface = { openWatcherFor: () => null, installInteraction: install };
    expect(makeInteractionApplier(surface)(stubCtx, catchFullEntry())).toBe(true);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("rejects (returns false) a tampered entry whose digest does not match its payload", () => {
    const entry = catchFullEntry();
    const tampered: CoopAuthorityEntry = {
      ...entry,
      material: { ...entry.material, digest: "ix1-catch-full-0-deadbeef" },
    };
    const install = vi.fn(() => true);
    const ok = makeInteractionApplier({ openWatcherFor: () => null, installInteraction: install })(stubCtx, tampered);
    expect(ok).toBe(false);
    expect(install).not.toHaveBeenCalled();
    expect(decodeInteractionMaterial(tampered)).toBeNull();
  });

  it("rejects a non-interaction / foreign entry kind", () => {
    const turn: CoopAuthorityEntry = {
      context: FRAME,
      revision: 1,
      operationId: "op-turn",
      kind: "TURN_COMMIT",
      material: { digest: "d", payload: {} },
      nextControl: { kind: "TERMINAL", terminalId: "foreign-turn-terminal" },
      subsumes: [],
    };
    expect(decodeInteractionMaterial(turn)).toBeNull();
    expect(makeInteractionApplier({ openWatcherFor: () => null, installInteraction: () => true })(stubCtx, turn)).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// shadow parity seam
// ---------------------------------------------------------------------------

describe("shadow parity seam", () => {
  it("re-derives an identical descriptor from a rebuilt entry (parity holds)", () => {
    const build = () =>
      buildMysteryOptionPickEntry({
        context: FRAME,
        address: address(),
        optionIndex: 2,
        battleHandoff: false,
        successor: MYSTERY_SUCCESSOR,
      }).entry;
    const a = shadowOfInteractionEntry(build());
    const b = shadowOfInteractionEntry(build());
    expect(a).not.toBeNull();
    expect(interactionShadowsAgree(a!, b!)).toBe(true);
  });

  it("disagrees when the resolved decision differs (a real divergence surfaces)", () => {
    const keep = shadowOfInteractionEntry(
      buildCatchFullDecisionEntry({
        context: FRAME,
        address: address(),
        decision: "keep",
        partySlot: 2,
        speciesId: 279,
        successor: BATTLE_SUCCESSOR,
      }),
    );
    const release = shadowOfInteractionEntry(
      buildCatchFullDecisionEntry({
        context: FRAME,
        address: address(),
        decision: "release",
        partySlot: -1,
        speciesId: 279,
        successor: BATTLE_SUCCESSOR,
      }),
    );
    expect(interactionShadowsAgree(keep!, release!)).toBe(false);
  });

  it("distinguishes a battle-handoff pick from a normal pick", () => {
    const normal = shadowOfInteractionEntry(
      buildMysteryOptionPickEntry({ context: FRAME, address: address(), optionIndex: 0, successor: MYSTERY_SUCCESSOR })
        .entry,
    );
    const handoff = shadowOfInteractionEntry(
      buildMysteryOptionPickEntry({
        context: FRAME,
        address: address(),
        optionIndex: 0,
        battleHandoff: true,
        successor: BATTLE_SUCCESSOR,
      }).entry,
    );
    expect(normal?.battleHandoff).toBe(false);
    expect(handoff?.battleHandoff).toBe(true);
    expect(interactionShadowsAgree(normal!, handoff!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// material guards + zero-leak
// ---------------------------------------------------------------------------

describe("material guards", () => {
  it("isValidInteractionMaterial accepts each surface and rejects a foreign shape", () => {
    const optionPick = buildMysteryOptionPickEntry({
      context: FRAME,
      address: address(),
      optionIndex: 0,
      successor: MYSTERY_SUCCESSOR,
    }).entry;
    expect(isValidInteractionMaterial(optionPick.material.payload)).toBe(true);
    expect(isValidInteractionMaterial({ kind: "not-a-surface" })).toBe(false);
    expect(isValidInteractionMaterial(null)).toBe(false);
    // A battle-handoff pick that lies about its window state is not representable.
    expect(
      isValidInteractionMaterial({
        kind: "me-option-pick",
        address: address(),
        optionIndex: 0,
        step: 0,
        battleHandoff: true,
        window: "open",
      }),
    ).toBe(false);
  });
});

describe("zero timers after retire (zero-leak)", () => {
  it("leaves zero scheduler timers once the terminal + its subsumed picks retire", () => {
    const sent: CoopAuthorityWire[] = [];
    const { log, scheduler } = makeLog(sent);

    const pick = log.commit(
      buildMysteryOptionPickEntry({
        context: FRAME,
        address: address(),
        optionIndex: 1,
        successor: exactMysterySuccessor("ME_TERMINAL", mysteryTerminalOperationId(address())),
      }).entry,
    );
    const terminal = log.commit(
      buildMysteryTerminalEntry({
        context: FRAME,
        address: address(),
        outcome: "leave",
        successor: REWARD_SUCCESSOR,
        subsumes: mysteryWindowSubsumes(log.retained(), openMysteryWindow(address())),
      }),
    );
    // Both entries have live delivery timers now.
    expect(scheduler.pendingTimerCount).toBeGreaterThan(0);

    // Admitting the terminal subsumes + retires the stale pick.
    expect(log.acceptReceipt(receipt(terminal, "admitted"))).toBe(false);
    expect(log.retained().map(e => e.revision)).not.toContain(pick.revision);

    // Drive the terminal to its required retirement stage (nextControl != null -> controlInstalled).
    const controlId = terminal.nextControl == null ? undefined : controlIdOf(terminal.nextControl);
    expect(log.acceptReceipt(receipt(terminal, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(terminal, "controlInstalled", controlId))).toBe(true);

    // Retired -> zero orphan timers.
    expect(log.retained()).toHaveLength(0);
    expect(log.diagnostics().activeDeliveryTimers).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });
});
