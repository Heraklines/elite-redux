/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-pure tests for co-op authority-v2 Migration B (faint/replacement adapter).
//
// These pin the ENGINE-FREE faint-replacement transaction that replaces the
// legacy faint-switch carriers:
//   - proposal validation: no non-finite / hole-able payload is representable
//     (the sparse-array faint-stall class made structurally impossible);
//   - the owner window resolves to fallback-auto after 60s of "humanInput"
//     ACTIVE time, driven through the REAL foundation scheduler with a manual
//     clock + pause/resume (a suspended window does not burn its deadline);
//   - a same-turn double-KO commits two occurrence-addressed entries with the
//     correct successor chaining (occurrence 0 -> exact executable replacement
//     control, occurrence 1 -> resume COMMAND);
//   - a committed entry closes an open local picker (the seam-level anti-softlock
//     authority-close) and adopts the committed pick;
//   - zero scheduler timers survive after the entry retires.
// No Phaser / globalScene / legacy netcode is imported.
// =============================================================================

import {
  armReplacementOwnerWindow,
  buildReplacementCommitEntry,
  COOP_REPLACEMENT_OWNER_WINDOW_MS,
  decodeReplacementCommitMaterial,
  makeReplacementApplier,
  type OpenReplacementPicker,
  type ReplacementApplierSurface,
  type ReplacementAuthorityCarrier,
  type ReplacementCommitImage,
  type ReplacementProposal,
  type ReplacementSourceAddress,
  replacementImageDigest,
  replacementOperationId,
  replacementShadowsAgree,
  shadowParityOfEntry,
  toReplacementCommitImage,
  validateReplacementProposal,
} from "#data/elite-redux/coop/authority-v2/adapters/faint-replacement";
import { isValidAuthorityEntry } from "#data/elite-redux/coop/authority-v2/authority-entry";
import { AuthorityLog, type CoopAuthorityWire } from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthorityEntry,
  CoopAuthorityReceipt,
  CoopFrameContextV2,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import {
  type CoopSchedulerClock,
  type CoopSchedulerImpl,
  createCoopScheduler,
} from "#data/elite-redux/coop/authority-v2/scheduler";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const AUTHORITY_CARRIER: ReplacementAuthorityCarrier = {
  checkpoint: { tick: 40, field: [{ hp: 81 }] },
  checksum: "replacement-checksum",
  preimage: '{"field":[{"hp":81}]}',
  fullField: [{ side: "player", fieldIndex: 1, pokemonId: 4242 }],
  authoritativeState: { version: 1, wave: 3, turn: 3, tick: 41 },
  epoch: 1,
  wave: 3,
  turn: 3,
  presentation: {
    bi: 0,
    partySlot: 2,
    pokemonId: 4242,
    speciesId: 279,
    switchType: 1,
    doReturn: false,
  },
};

function address(over: Partial<ReplacementSourceAddress> = {}): ReplacementSourceAddress {
  return { epoch: 1, wave: 3, turn: 2, occurrence: 0, fieldIndex: 0, ...over };
}

function proposal(over: Partial<ReplacementProposal> = {}): ReplacementProposal {
  return {
    sourceAddress: address(over.sourceAddress),
    ownerSeatId: over.ownerSeatId ?? 1,
    selected: over.selected === undefined ? { partySlot: 2, speciesId: 279 } : over.selected,
  };
}

/**
 * A deterministic {@link CoopSchedulerClock}: `setTimer` records a fire-at, and
 * `advance` fires every timer whose deadline the advanced wall time crossed. This
 * drives the REAL CoopSchedulerImpl so its active-time pause/resume is exercised
 * for real (not re-implemented here).
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

// ---------------------------------------------------------------------------
// (1) proposal validation - no non-finite / hole-able payloads representable
// ---------------------------------------------------------------------------

describe("validateReplacementProposal", () => {
  it("accepts a well-formed owner pick and an explicit null (no-replacement)", () => {
    expect(validateReplacementProposal(proposal()).ok).toBe(true);
    expect(validateReplacementProposal(proposal({ selected: null })).ok).toBe(true);
    expect(validateReplacementProposal(proposal({ ownerSeatId: 0 })).ok).toBe(true);
  });

  it("rejects every non-finite coordinate (NaN / Infinity) with a named reason", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(validateReplacementProposal(proposal({ sourceAddress: address({ turn: bad }) })).ok).toBe(false);
      expect(validateReplacementProposal({ ...proposal(), ownerSeatId: bad }).ok).toBe(false);
      expect(validateReplacementProposal(proposal({ selected: { partySlot: 1, speciesId: bad } })).ok).toBe(false);
    }
    const verdict = validateReplacementProposal(proposal({ sourceAddress: address({ wave: Number.NaN }) }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("wave");
    }
  });

  it("rejects a HOLE - an undefined/absent coordinate that a sparse payload would carry", () => {
    // The legacy carrier's faint stall: a positional array left index 1 a hole
    // (undefined -> null over JSON) that failed the guest's finite check. Here a
    // missing named field is just as rejected - there is no positional slot to
    // hide a hole in.
    const holed = { ...proposal(), sourceAddress: { epoch: 1, wave: 3, turn: 2, fieldIndex: 0 } };
    expect(validateReplacementProposal(holed).ok).toBe(false); // occurrence missing
    const holedSel = { ...proposal(), selected: { partySlot: 2 } };
    expect(validateReplacementProposal(holedSel).ok).toBe(false); // speciesId missing
  });

  it("rejects non-integers, negatives, and out-of-domain coordinates", () => {
    expect(validateReplacementProposal(proposal({ sourceAddress: address({ turn: 1.5 }) })).ok).toBe(false);
    expect(validateReplacementProposal(proposal({ sourceAddress: address({ epoch: 0 }) })).ok).toBe(false);
    expect(validateReplacementProposal(proposal({ sourceAddress: address({ occurrence: -1 }) })).ok).toBe(false);
    expect(validateReplacementProposal(proposal({ sourceAddress: address({ fieldIndex: -1 }) })).ok).toBe(false);
    expect(validateReplacementProposal({ ...proposal(), ownerSeatId: -1 }).ok).toBe(false);
    expect(validateReplacementProposal(proposal({ selected: { partySlot: 2, speciesId: 0 } })).ok).toBe(false);
    expect(validateReplacementProposal(proposal({ selected: { partySlot: -1, speciesId: 1 } })).ok).toBe(false);
  });

  it("survives a JSON round-trip: a validated proposal has no hole-able absence", () => {
    const round = JSON.parse(JSON.stringify(proposal())) as unknown;
    expect(validateReplacementProposal(round).ok).toBe(true);
    // A payload that WAS sparse loses its hole to null over JSON and is rejected.
    const sparse = JSON.parse(
      JSON.stringify({ ...proposal(), selected: { partySlot: 2, speciesId: undefined } }),
    ) as unknown;
    expect(validateReplacementProposal(sparse).ok).toBe(false);
  });

  it("toReplacementCommitImage throws on an invalid proposal (a bad image never commits)", () => {
    expect(() =>
      toReplacementCommitImage(proposal({ sourceAddress: address({ turn: Number.NaN }) }), "owner-pick"),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// entry construction + foundation acceptance
// ---------------------------------------------------------------------------

describe("buildReplacementCommitEntry", () => {
  it("refuses live replacement material without an explicit presentation result", () => {
    const { presentation: _presentation, ...incomplete } = AUTHORITY_CARRIER;
    expect(() =>
      buildReplacementCommitEntry({
        context: FRAME,
        proposal: proposal(),
        resolution: "owner-pick",
        authorityCarrier: incomplete,
        successor: { kind: "terminal" },
      }),
    ).toThrow(/invalid replacement presentation/u);

    expect(() =>
      buildReplacementCommitEntry({
        context: FRAME,
        proposal: proposal(),
        resolution: "owner-pick",
        authorityCarrier: {
          ...AUTHORITY_CARRIER,
          presentation: { ...AUTHORITY_CARRIER.presentation!, bi: -1 },
        },
        successor: { kind: "terminal" },
      }),
    ).toThrow(/invalid replacement presentation/u);
  });

  it("builds a REPLACEMENT_COMMIT entry the foundation validator accepts", () => {
    const built = buildReplacementCommitEntry({
      context: FRAME,
      proposal: proposal(),
      resolution: "owner-pick",
      successor: {
        kind: "resume-command-frontier",
        epoch: 1,
        wave: 3,
        turn: 2,
        commands: [{ ownerSeatId: 1, pokemonId: 4242, fieldIndex: 1 }],
      },
    });
    expect(built.kind).toBe("REPLACEMENT_COMMIT");
    // A committed entry (revision assigned) passes the foundation's own guard.
    expect(isValidAuthorityEntry({ ...built, revision: 5 })).toBe(true);
    expect(built.operationId).toBe(replacementOperationId(address(), 1));
    // Material is the typed image, digested deterministically.
    expect(built.material.digest).toBe(replacementImageDigest(toReplacementCommitImage(proposal(), "owner-pick")));
    expect(built.nextControl).toEqual({
      kind: "COMMAND_FRONTIER",
      epoch: 1,
      wave: 3,
      turn: 2,
      commands: [{ ownerSeatId: 1, pokemonId: 4242, fieldIndex: 1 }],
    });
  });

  it("records the resolution mode in the authoritative image", () => {
    const owner = buildReplacementCommitEntry({
      context: FRAME,
      proposal: proposal(),
      resolution: "owner-pick",
      successor: { kind: "terminal" },
    });
    const fallback = buildReplacementCommitEntry({
      context: FRAME,
      proposal: proposal(),
      resolution: "fallback-auto",
      successor: { kind: "terminal" },
    });
    expect((owner.material.payload as ReplacementCommitImage).resolution).toBe("owner-pick");
    expect((fallback.material.payload as ReplacementCommitImage).resolution).toBe("fallback-auto");
    // Same window (identity) despite different results - the operationId is stable.
    expect(owner.operationId).toBe(fallback.operationId);
    // ...but the resolution changes the image, so the digest differs.
    expect(owner.material.digest).not.toBe(fallback.material.digest);
    // A non-executable terminal boundary is still explicit: local phases may not derive the successor. Its
    // allowedKinds mirror the sibling turn-command no-immediate-frontier wait so a SURVIVING battle's next
    // command-open (CONTROL_COMMIT at turn N+1) is admitted - omitting CONTROL_COMMIT deadlocked a mid-wave
    // replacement whose wave continued (the DIRTY command-open deadlock, run 29944796250 wave 3).
    expect(owner.nextControl).toMatchObject({
      kind: "AWAIT_SUCCESSOR",
      afterOperationId: owner.operationId,
      allowedKinds: ["CONTROL_COMMIT", "REPLACEMENT_COMMIT", "INTERACTION_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"],
      expectedOperationId: null,
    });
  });

  it("carries and digests every complete post-summon companion for live cutover", () => {
    const built = buildReplacementCommitEntry({
      context: FRAME,
      proposal: proposal(),
      resolution: "owner-pick",
      authorityCarrier: AUTHORITY_CARRIER,
      successor: { kind: "terminal" },
    });
    const image = built.material.payload as ReplacementCommitImage;
    expect(image.authorityCarrier).toEqual(AUTHORITY_CARRIER);
    expect(built.material.digest).toBe(
      replacementImageDigest(toReplacementCommitImage(proposal(), "owner-pick", AUTHORITY_CARRIER)),
    );

    const changed = buildReplacementCommitEntry({
      context: FRAME,
      proposal: proposal(),
      resolution: "owner-pick",
      authorityCarrier: { ...AUTHORITY_CARRIER, checksum: "different-checksum" },
      successor: { kind: "terminal" },
    });
    expect(
      changed.material.digest,
      "no post-summon companion may travel outside the authenticated material digest",
    ).not.toBe(built.material.digest);
    expect(decodeReplacementCommitMaterial({ ...built, revision: 6 })?.authorityCarrier).toEqual(AUTHORITY_CARRIER);
  });

  it("preserves an exact differently-addressed successor wait and rejects a foreign binding", () => {
    const operationId = replacementOperationId(address(), 1);
    const wait = {
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: operationId,
      epoch: 1,
      wave: 3,
      turn: 2,
      allowedKinds: ["INTERACTION_COMMIT" as const],
      allowedInteractionAddresses: [
        { surfaceClass: "op:me" as const, operationKind: "ME_TERMINAL" as const, wave: 3, turn: 0 },
      ],
      allowNextWaveStart: false,
      expectedOperationId: null,
    };
    const built = buildReplacementCommitEntry({
      context: FRAME,
      proposal: proposal(),
      resolution: "owner-pick",
      successor: { kind: "ordered-wait", control: wait },
    });
    expect(built.nextControl).toEqual(wait);
    expect(isValidAuthorityEntry({ ...built, revision: 5 })).toBe(true);

    expect(() =>
      buildReplacementCommitEntry({
        context: FRAME,
        proposal: proposal(),
        resolution: "owner-pick",
        successor: {
          kind: "ordered-wait",
          control: { ...wait, afterOperationId: "RC/e1/w3/t2/o0/f0/s0" },
        },
      }),
    ).toThrow(/not bound to the replacement/u);
  });

  it("throws on a successor that would encode an invalid control", () => {
    expect(() =>
      buildReplacementCommitEntry({
        context: FRAME,
        proposal: proposal(),
        resolution: "owner-pick",
        successor: {
          kind: "resume-command-frontier",
          epoch: 1,
          wave: 3,
          turn: 2,
          commands: [{ ownerSeatId: 1, pokemonId: 0, fieldIndex: 1 }],
        }, // pokemonId must be positive
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// (3) double-KO - two occurrences, correct successor chaining
// ---------------------------------------------------------------------------

describe("double-KO chaining", () => {
  function makeAuthorityLog(sent: CoopAuthorityWire[], scheduler: CoopSchedulerImpl): AuthorityLog {
    return new AuthorityLog({
      localContext: FRAME,
      scheduler,
      send: wire => sent.push(wire),
      peerBindings: [{ seatId: 1, connectionGeneration: FRAME.connectionGeneration }],
    });
  }

  it("commits two occurrence-addressed entries whose successors chain", () => {
    const scheduler = createCoopScheduler(new ManualClock());
    const sent: CoopAuthorityWire[] = [];
    const log = makeAuthorityLog(sent, scheduler);

    const secondControl = {
      kind: "REPLACEMENT" as const,
      operationId: replacementOperationId(address({ occurrence: 1, fieldIndex: 1 }), 0),
      ownerSeatId: 0,
      ...address({ occurrence: 1, fieldIndex: 1 }),
      remaining: [],
    };
    // Occurrence 0 commits immediately after its own summon and explicitly opens occurrence 1.
    const entry0Input = buildReplacementCommitEntry({
      context: FRAME,
      proposal: proposal({ sourceAddress: address({ occurrence: 0, fieldIndex: 0 }), ownerSeatId: 1 }),
      resolution: "owner-pick",
      successor: { kind: "next-replacement", control: secondControl },
    });
    // Occurrence 1 is the last faint; its successor resumes the turn (COMMAND).
    const entry1Input = buildReplacementCommitEntry({
      context: FRAME,
      proposal: proposal({ sourceAddress: address({ occurrence: 1, fieldIndex: 1 }), ownerSeatId: 0 }),
      resolution: "owner-pick",
      successor: {
        kind: "resume-command-frontier",
        epoch: 1,
        wave: 3,
        turn: 2,
        commands: [{ ownerSeatId: 0, pokemonId: 7, fieldIndex: 1 }],
      },
    });

    const entry0 = log.commit(entry0Input);
    const entry1 = log.commit(entry1Input);

    // One global revision order (foundation decision 1).
    expect(entry0.revision).toBe(1);
    expect(entry1.revision).toBe(2);

    // Distinct occurrence-addressed identities (a same-turn double-KO is two ops).
    expect(entry0.operationId).not.toBe(entry1.operationId);
    expect(entry0.operationId).toBe(replacementOperationId(address({ occurrence: 0, fieldIndex: 0 }), 1));
    expect(entry1.operationId).toBe(replacementOperationId(address({ occurrence: 1, fieldIndex: 1 }), 0));

    // Successor chaining: entry0 -> exact executable replacement picker, entry1 -> COMMAND.
    expect(entry0.nextControl).toEqual(secondControl);
    expect(entry1.nextControl).toMatchObject({
      kind: "COMMAND_FRONTIER",
      commands: [{ ownerSeatId: 0, pokemonId: 7, fieldIndex: 1 }],
    });

    // The stated successor of entry0 addresses exactly entry1's own replacement operation.
    const entry0SuccessorId = entry0.nextControl == null ? null : controlIdOf(entry0.nextControl);
    expect(entry0SuccessorId).toBe(controlIdOf(secondControl));

    // Shadow parity distinguishes the two occurrences.
    const p0 = shadowParityOfEntry(entry0);
    const p1 = shadowParityOfEntry(entry1);
    expect(p0).not.toBeNull();
    expect(p1).not.toBeNull();
    expect(replacementShadowsAgree(p0!, p1!)).toBe(false);
    expect(replacementShadowsAgree(p0!, p0!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shadow parity seam
// ---------------------------------------------------------------------------

describe("shadow parity seam", () => {
  it("re-derives an identical descriptor from a rebuilt entry (parity holds)", () => {
    const input = {
      context: FRAME,
      proposal: proposal(),
      resolution: "owner-pick" as const,
      successor: {
        kind: "resume-command-frontier" as const,
        epoch: 1,
        wave: 3,
        turn: 2,
        commands: [{ ownerSeatId: 1, pokemonId: 99, fieldIndex: 1 }],
      },
    };
    // Two independent builds of the same resolution must agree byte-for-byte -
    // the property a shadow run asserts of the legacy path vs the v2 adapter.
    const a = shadowParityOfEntry(buildReplacementCommitEntry(input));
    const b = shadowParityOfEntry(buildReplacementCommitEntry(input));
    expect(a).not.toBeNull();
    expect(replacementShadowsAgree(a!, b!)).toBe(true);
  });

  it("disagrees when the resolved pick differs (a real divergence surfaces)", () => {
    const base = shadowParityOfEntry(
      buildReplacementCommitEntry({
        context: FRAME,
        proposal: proposal({ selected: { partySlot: 2, speciesId: 279 } }),
        resolution: "owner-pick",
        successor: { kind: "terminal" },
      }),
    );
    const drifted = shadowParityOfEntry(
      buildReplacementCommitEntry({
        context: FRAME,
        proposal: proposal({ selected: { partySlot: 3, speciesId: 280 } }),
        resolution: "owner-pick",
        successor: { kind: "terminal" },
      }),
    );
    expect(replacementShadowsAgree(base!, drifted!)).toBe(false);
  });

  it("returns null for a non-REPLACEMENT_COMMIT entry", () => {
    const turn: CoopAuthorityEntry = {
      context: FRAME,
      revision: 1,
      operationId: "op-turn",
      kind: "TURN_COMMIT",
      material: { digest: "d", payload: {} },
      nextControl: { kind: "TERMINAL", terminalId: "foreign-turn-terminal" },
      subsumes: [],
    };
    expect(shadowParityOfEntry(turn)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (4) committed entry closes an open picker (seam-level authority-close)
// ---------------------------------------------------------------------------

describe("replica applier (picker-close semantics)", () => {
  function committedEntry(resolution: "owner-pick" | "fallback-auto" = "fallback-auto"): CoopAuthorityEntry {
    const built = buildReplacementCommitEntry({
      context: FRAME,
      proposal: proposal({ selected: { partySlot: 2, speciesId: 279 } }),
      resolution,
      successor: {
        kind: "resume-command-frontier",
        epoch: 1,
        wave: 3,
        turn: 2,
        commands: [{ ownerSeatId: 1, pokemonId: 42, fieldIndex: 1 }],
      },
    });
    return { ...built, revision: 9 };
  }

  const stubCtx = {} as CoopRuntimeContext;

  it("closes an open local picker for the address and adopts the committed pick", () => {
    const adopt = vi.fn();
    const install = vi.fn(() => true);
    const openPicker: OpenReplacementPicker = { address: address(), adopt };
    const surface: ReplacementApplierSurface = {
      openPickerFor: addr => (addr.occurrence === 0 && addr.fieldIndex === 0 ? openPicker : null),
      installReplacementImage: install,
    };
    const applier = makeReplacementApplier(surface);

    const ok = applier(stubCtx, committedEntry());
    expect(ok).toBe(true);
    // The committed entry closed the open picker (adopt fired with the image)...
    expect(adopt).toHaveBeenCalledTimes(1);
    const adopted = adopt.mock.calls[0][0] as ReplacementCommitImage;
    expect(adopted.selected).toEqual({ partySlot: 2, speciesId: 279 });
    expect(adopted.resolution).toBe("fallback-auto");
    // ...and installed the authoritative image.
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("installs without a picker close when no picker is open for the address", () => {
    const adopt = vi.fn();
    const install = vi.fn(() => true);
    const surface: ReplacementApplierSurface = {
      openPickerFor: () => null,
      installReplacementImage: install,
    };
    const ok = makeReplacementApplier(surface)(stubCtx, committedEntry());
    expect(ok).toBe(true);
    expect(adopt).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("rejects (returns false) a tampered entry whose digest does not match its payload", () => {
    const entry = committedEntry();
    const tampered: CoopAuthorityEntry = { ...entry, material: { ...entry.material, digest: "rc1-0-deadbeef" } };
    const install = vi.fn(() => true);
    const ok = makeReplacementApplier({ openPickerFor: () => null, installReplacementImage: install })(
      stubCtx,
      tampered,
    );
    expect(ok).toBe(false);
    expect(install).not.toHaveBeenCalled();
    expect(decodeReplacementCommitMaterial(tampered)).toBeNull();
  });

  it("rejects a malformed or digest-tampered post-summon carrier before the engine seam runs", () => {
    const built = buildReplacementCommitEntry({
      context: FRAME,
      proposal: proposal(),
      resolution: "owner-pick",
      authorityCarrier: AUTHORITY_CARRIER,
      successor: { kind: "terminal" },
    });
    const entry: CoopAuthorityEntry = { ...built, revision: 10 };
    const image = entry.material.payload as ReplacementCommitImage;
    const install = vi.fn(() => true);
    const tampered: CoopAuthorityEntry = {
      ...entry,
      material: {
        ...entry.material,
        payload: {
          ...image,
          authorityCarrier: { ...image.authorityCarrier, fullField: [{ pokemonId: 9999 }] },
        },
      },
    };
    expect(
      makeReplacementApplier({ openPickerFor: () => null, installReplacementImage: install })(stubCtx, tampered),
    ).toBe(false);
    expect(install).not.toHaveBeenCalled();

    const missingField = {
      ...entry,
      material: {
        ...entry.material,
        payload: {
          ...image,
          authorityCarrier: {
            checkpoint: AUTHORITY_CARRIER.checkpoint,
            checksum: AUTHORITY_CARRIER.checksum,
          },
        },
      },
    } as CoopAuthorityEntry;
    expect(decodeReplacementCommitMaterial(missingField)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (2) owner-window fallback after 60s of humanInput ACTIVE time
// ---------------------------------------------------------------------------

describe("owner window (fallback-auto)", () => {
  let clock: ManualClock;
  let scheduler: CoopSchedulerImpl;

  beforeEach(() => {
    clock = new ManualClock();
    scheduler = createCoopScheduler(clock);
  });

  it("fires the fallback only after 60s of humanInput ACTIVE time (a pause does not burn it)", () => {
    let fallbacks = 0;
    const cancel = armReplacementOwnerWindow({ scheduler } as unknown as CoopRuntimeContext, address(), 1, () => {
      fallbacks++;
    });

    // 30s of active human-input time - not yet the deadline.
    clock.advance(30_000);
    expect(fallbacks).toBe(0);

    // Suspend the human-input class (tab hidden / disconnect): the window FREEZES.
    scheduler.pauseClass("humanInput", "hidden");
    clock.advance(100_000); // wall moves, but paused active-time does not.
    expect(fallbacks).toBe(0);

    // Resume: the remaining 30s of active time re-arm.
    scheduler.resumeClass("humanInput", "hidden");
    clock.advance(29_999);
    expect(fallbacks).toBe(0);
    clock.advance(1); // now exactly 60s of ACTIVE time has elapsed.
    expect(fallbacks).toBe(1);

    // The fallback resolves a fallback-auto entry (the authority's auto pick).
    const fallbackEntry = buildReplacementCommitEntry({
      context: FRAME,
      proposal: proposal({ selected: { partySlot: 3, speciesId: 100 } }),
      resolution: "fallback-auto",
      successor: {
        kind: "resume-command-frontier",
        epoch: 1,
        wave: 3,
        turn: 2,
        commands: [{ ownerSeatId: 1, pokemonId: 55, fieldIndex: 1 }],
      },
    });
    expect((fallbackEntry.material.payload as ReplacementCommitImage).resolution).toBe("fallback-auto");

    cancel();
    expect(scheduler.pendingTimerCount).toBe(0);
  });

  it("cancels the window when the owner picks first (no fallback)", () => {
    let fallbacks = 0;
    const cancel = armReplacementOwnerWindow({ scheduler } as unknown as CoopRuntimeContext, address(), 1, () => {
      fallbacks++;
    });
    clock.advance(10_000);
    cancel(); // owner picked within the window.
    clock.advance(COOP_REPLACEMENT_OWNER_WINDOW_MS * 2);
    expect(fallbacks).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (5) zero timers after retire
// ---------------------------------------------------------------------------

describe("zero timers after retire", () => {
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

  it("leaves zero scheduler timers once the committed entry retires and the window is cancelled", () => {
    const clock = new ManualClock();
    const scheduler = createCoopScheduler(clock);
    const sent: CoopAuthorityWire[] = [];
    const log = new AuthorityLog({
      localContext: FRAME,
      scheduler,
      send: wire => sent.push(wire),
      peerBindings: [{ seatId: 1, connectionGeneration: FRAME.connectionGeneration }],
    });

    const entry = log.commit(
      buildReplacementCommitEntry({
        context: FRAME,
        proposal: proposal(),
        resolution: "owner-pick",
        successor: {
          kind: "resume-command-frontier",
          epoch: 1,
          wave: 3,
          turn: 2,
          commands: [{ ownerSeatId: 1, pokemonId: 42, fieldIndex: 1 }],
        },
      }),
    );

    // The owner window + the log's delivery timer are both live now.
    const cancelWindow = armReplacementOwnerWindow(
      { scheduler } as unknown as CoopRuntimeContext,
      entry.nextControl == null ? address() : address(),
      1,
      () => {},
    );
    expect(scheduler.pendingTimerCount).toBeGreaterThan(0);

    // Owner picked -> cancel the window.
    cancelWindow();

    // Drive the replica receipts to the required retirement stage (nextControl != null
    // -> controlInstalled). The log cancels the delivery lease on retire.
    const controlId = entry.nextControl == null ? undefined : controlIdOf(entry.nextControl);
    expect(log.acceptReceipt(receipt(entry, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(entry, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(entry, "controlInstalled", controlId))).toBe(true);

    // Retired + window cancelled -> zero orphan timers.
    expect(log.retained()).toHaveLength(0);
    expect(log.diagnostics().activeDeliveryTimers).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });
});
