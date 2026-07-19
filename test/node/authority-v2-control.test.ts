/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-pure tests for co-op authority-v2 Lane 3 (canonical next-control).
//
// These pin the ENGINE-FREE halves of the lane: controlId derivation, control
// equality / address-compatibility, structural validation, the projector's
// decision logic (over a FAKE ControlSurface - no Phaser), and the replica
// application pipeline (over a fake projector + recording receipt sink). The one
// engine-coupled seam - sceneControlSurface - is exercised only by the sentinel
// suite and is deliberately never touched here.
// =============================================================================

import type {
  CoopAuthorityEntry,
  CoopAuthorityReceipt,
  CoopControlInstallResult,
  CoopControlProjector,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import { type ControlSurface, createCoopControlProjector } from "#data/elite-redux/coop/authority-v2/control-projector";
import {
  commandControlTargetId,
  controlIdOf,
  controlOwnerSeatId,
  controlOwnerSeatIds,
  controlsEqual,
  isValidNextControl,
  sameControlAddress,
  validateNextControl,
} from "#data/elite-redux/coop/authority-v2/next-control";
import { applyEntry, expectedControlId, type ReplicaReceiptSink } from "#data/elite-redux/coop/authority-v2/replica";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Projectable = NonNullable<CoopNextControl>;

const PIPELINE_BOOKKEEPING = {
  receiptContext: {
    sessionId: "s",
    runId: "r",
    sessionEpoch: 1,
    seatMapId: "m",
    membershipRevision: 1,
    senderSeatId: 1,
    authoritySeatId: 0,
    connectionGeneration: 1,
  } satisfies CoopFrameContextV2,
  recordStage: () => true,
};

type CommandFrontier = Extract<Projectable, { kind: "COMMAND_FRONTIER" }>;
type CommandTarget = CommandFrontier["commands"][number];
type CommandOverrides = Partial<Omit<CommandFrontier, "kind" | "commands">> &
  Partial<CommandTarget> & { commands?: readonly CommandTarget[] };

const command = (over: CommandOverrides = {}): CommandFrontier => {
  const {
    ownerSeatId = 0,
    pokemonId = 42,
    fieldIndex = 0,
    commands = [{ ownerSeatId, pokemonId, fieldIndex }],
    ...frontier
  } = over;
  return {
    kind: "COMMAND_FRONTIER",
    epoch: 1,
    wave: 3,
    turn: 2,
    ...frontier,
    commands,
  };
};

const replacement = (over: Partial<Extract<Projectable, { kind: "REPLACEMENT" }>> = {}): Projectable => ({
  kind: "REPLACEMENT",
  epoch: 1,
  wave: 3,
  turn: 2,
  occurrence: 0,
  fieldIndex: 1,
  ownerSeatId: 1,
  ...over,
});

const reward = (over: Partial<Extract<Projectable, { kind: "REWARD" }>> = {}): Projectable => ({
  kind: "REWARD",
  operationId: "op-reward-1",
  ownerSeatId: 0,
  ...over,
});

const terminal = (terminalId = "term-1"): Projectable => ({ kind: "TERMINAL", terminalId });

// ---------------------------------------------------------------------------
// controlId
// ---------------------------------------------------------------------------

describe("controlIdOf", () => {
  it("is a stable, complete encoding - identical inputs give identical ids", () => {
    expect(controlIdOf(command())).toBe(controlIdOf(command()));
    expect(controlIdOf(replacement())).toBe(controlIdOf(replacement()));
    expect(controlIdOf(reward())).toBe(controlIdOf(reward()));
    expect(controlIdOf(terminal())).toBe(controlIdOf(terminal()));
  });

  it("distinguishes every field (id equality == structural equality)", () => {
    const base = controlIdOf(command());
    expect(controlIdOf(command({ epoch: 2 }))).not.toBe(base);
    expect(controlIdOf(command({ wave: 4 }))).not.toBe(base);
    expect(controlIdOf(command({ turn: 3 }))).not.toBe(base);
    expect(controlIdOf(command({ ownerSeatId: 1 }))).not.toBe(base);
    expect(controlIdOf(command({ pokemonId: 43 }))).not.toBe(base);
    expect(controlIdOf(command({ fieldIndex: 1 }))).not.toBe(base);
  });

  it("canonicalizes a multi-battler frontier independent of input order", () => {
    const a = { fieldIndex: 0, ownerSeatId: 0, pokemonId: 42 };
    const b = { fieldIndex: 1, ownerSeatId: 1, pokemonId: 43 };
    expect(controlIdOf(command({ commands: [a, b] }))).toBe(controlIdOf(command({ commands: [b, a] })));
  });

  it("distinguishes kinds even when scalar fields coincide", () => {
    const rew = controlIdOf(reward({ operationId: "x", ownerSeatId: 0 }));
    const biome = controlIdOf({ kind: "BIOME", operationId: "x", ownerSeatId: 0 });
    const mystery = controlIdOf({ kind: "MYSTERY", operationId: "x", ownerSeatId: 0 });
    expect(new Set([rew, biome, mystery]).size).toBe(3);
  });

  it("percent-encodes opaque ids so delimiters can't collide addresses", () => {
    // Without encoding, "a/s9" + seat 0 could collide with "a" + seat 9/s0-style ids.
    const a = controlIdOf(reward({ operationId: "a/s9", ownerSeatId: 0 }));
    const b = controlIdOf(reward({ operationId: "a", ownerSeatId: 0 }));
    expect(a).not.toBe(b);
    expect(controlIdOf(terminal("a/b"))).not.toBe(controlIdOf(terminal("a%2Fb")));
  });
});

// ---------------------------------------------------------------------------
// equality / ownership
// ---------------------------------------------------------------------------

describe("controlsEqual / sameControlAddress", () => {
  it("treats null as equal only to null", () => {
    expect(controlsEqual(null, null)).toBe(true);
    expect(controlsEqual(command(), null)).toBe(false);
    expect(controlsEqual(null, command())).toBe(false);
  });

  it("is exact structural equality for non-null controls", () => {
    expect(controlsEqual(command(), command())).toBe(true);
    expect(controlsEqual(command(), command({ pokemonId: 99 }))).toBe(false);
    expect(controlsEqual(command(), replacement())).toBe(false);
  });

  it("sameControlAddress matches controlId equality", () => {
    expect(sameControlAddress(reward(), reward())).toBe(true);
    expect(sameControlAddress(reward(), reward({ ownerSeatId: 1 }))).toBe(false);
  });
});

describe("control ownership", () => {
  it("returns the owner seat for owned controls and null for TERMINAL", () => {
    expect(controlOwnerSeatId(command({ ownerSeatId: 0 }))).toBe(0);
    expect(controlOwnerSeatId(replacement({ ownerSeatId: 1 }))).toBe(1);
    expect(controlOwnerSeatId(reward({ ownerSeatId: 0 }))).toBe(0);
    expect(controlOwnerSeatId(terminal())).toBeNull();
  });

  it("preserves every distinct owner and refuses to collapse a multi-owner frontier", () => {
    const frontier = command({
      commands: [
        { fieldIndex: 0, ownerSeatId: 0, pokemonId: 42 },
        { fieldIndex: 1, ownerSeatId: 1, pokemonId: 43 },
        { fieldIndex: 2, ownerSeatId: 1, pokemonId: 44 },
      ],
    });
    expect(controlOwnerSeatIds(frontier)).toEqual([0, 1]);
    expect(controlOwnerSeatId(frontier)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

describe("validateNextControl", () => {
  it("accepts well-formed controls of every kind", () => {
    expect(isValidNextControl(command())).toBe(true);
    expect(isValidNextControl(replacement())).toBe(true);
    expect(isValidNextControl(reward())).toBe(true);
    expect(isValidNextControl({ kind: "BIOME", operationId: "b", ownerSeatId: 0 })).toBe(true);
    expect(isValidNextControl({ kind: "MYSTERY", operationId: "m", ownerSeatId: 2 })).toBe(true);
    expect(isValidNextControl(terminal())).toBe(true);
  });

  it("rejects non-positive mechanical coordinates with a named reason", () => {
    expect(validateNextControl(command({ epoch: 0 }))).toMatchObject({ ok: false });
    expect(validateNextControl(command({ wave: -1 }))).toMatchObject({ ok: false });
    expect(validateNextControl(command({ turn: 1.5 }))).toMatchObject({ ok: false });
    const bad = validateNextControl(command({ turn: 0 }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toContain("turn");
    }
  });

  it("rejects a negative pokemonId / seat and a non-integer occurrence", () => {
    expect(validateNextControl(command({ pokemonId: 0 })).ok).toBe(false);
    expect(validateNextControl(command({ ownerSeatId: -1 })).ok).toBe(false);
    expect(validateNextControl(replacement({ occurrence: 1.2 })).ok).toBe(false);
    expect(validateNextControl(replacement({ fieldIndex: -1 })).ok).toBe(false);
    // occurrence 0 and seat 0 are legal (non-negative).
    expect(validateNextControl(replacement({ occurrence: 0, ownerSeatId: 0, fieldIndex: 0 })).ok).toBe(true);
  });

  it("rejects empty and duplicate-field command frontiers while allowing side-scoped Pokemon ids", () => {
    expect(validateNextControl(command({ commands: [] })).ok).toBe(false);
    // Opposing parties may legally reuse a numeric Pokemon id. Canonical fieldIndex + owner seat keeps
    // both targets unambiguous, so Showdown must not reject the complete two-sided frontier.
    expect(
      validateNextControl(
        command({
          commands: [
            { fieldIndex: 0, ownerSeatId: 0, pokemonId: 42 },
            { fieldIndex: 0, ownerSeatId: 1, pokemonId: 43 },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateNextControl(
        command({
          commands: [
            { fieldIndex: 0, ownerSeatId: 0, pokemonId: 42 },
            { fieldIndex: 1, ownerSeatId: 1, pokemonId: 42 },
          ],
        }),
      ).ok,
    ).toBe(true);
  });

  it("rejects empty opaque ids", () => {
    expect(validateNextControl(reward({ operationId: "" })).ok).toBe(false);
    expect(validateNextControl(terminal("")).ok).toBe(false);
  });

  it("rejects malformed and retired wire shapes without throwing", () => {
    const untrusted: readonly unknown[] = [
      null,
      [],
      "COMMAND_FRONTIER",
      { kind: "COMMAND" },
      { kind: "COMMAND", epoch: 1, wave: 1, turn: 1, ownerSeatId: 0, pokemonId: 42, fieldIndex: 0 },
      { kind: "COMMAND_FRONTIER", epoch: 1, wave: 1, turn: 1, commands: [null] },
      { kind: "REPLACEMENT", epoch: 1, wave: 1, turn: 1, occurrence: 0, fieldIndex: 0 },
    ];

    for (const candidate of untrusted) {
      expect(() => validateNextControl(candidate)).not.toThrow();
      expect(isValidNextControl(candidate)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// projector (over a FAKE ControlSurface - engine-free)
// ---------------------------------------------------------------------------

interface FakeSurfaceScript {
  has?: Set<string>;
  pacing?: boolean;
  fieldSlots?: Record<number, number>;
  validFieldSlots?: Set<number>;
}

function fakeSurface(script: FakeSurfaceScript = {}) {
  const calls: Array<{ verb: string; args: unknown[] }> = [];
  const surface: ControlSurface = {
    hasControl: id => script.has?.has(id) ?? false,
    isEnginePacing: () => script.pacing ?? false,
    fieldSlotOfPokemon: pid => script.fieldSlots?.[pid] ?? -1,
    isPlayerFieldSlot: fi => script.validFieldSlots?.has(fi) ?? true,
    installCommand: (...args) => calls.push({ verb: "installCommand", args }),
    installReplacementPicker: (...args) => calls.push({ verb: "installReplacementPicker", args }),
    installReplacementAwait: (...args) => calls.push({ verb: "installReplacementAwait", args }),
    installReward: (...args) => calls.push({ verb: "installReward", args }),
    installBiome: (...args) => calls.push({ verb: "installBiome", args }),
    installMystery: (...args) => calls.push({ verb: "installMystery", args }),
    installTerminal: (...args) => calls.push({ verb: "installTerminal", args }),
  };
  return { surface, calls };
}

function ctxWithSeat(localSeatId: number): CoopRuntimeContext {
  return { localSeatId } as unknown as CoopRuntimeContext;
}

function project(
  control: Projectable,
  script: FakeSurfaceScript,
  localSeatId = 0,
): {
  result: CoopControlInstallResult;
  calls: Array<{ verb: string; args: unknown[] }>;
} {
  const { surface, calls } = fakeSurface(script);
  const projector = createCoopControlProjector(() => surface);
  const result = projector.project(ctxWithSeat(localSeatId), control);
  return { result, calls };
}

describe("DefaultCoopControlProjector", () => {
  it("rejects a structurally invalid control before touching the engine", () => {
    const { result, calls } = project(command({ turn: 0 }), {});
    expect(result.kind).toBe("rejected");
    expect(calls).toHaveLength(0);
  });

  it("reports already-installed when the exact controlId is present (no re-install)", () => {
    const c = command();
    const { result, calls } = project(c, { has: new Set([controlIdOf(c)]), fieldSlots: { 42: 0 } });
    expect(result).toEqual({ kind: "already-installed", controlId: controlIdOf(c) });
    expect(calls).toHaveLength(0);
  });

  it("defers (never terminals) when the engine is mid-transition", () => {
    const { result, calls } = project(command(), { pacing: true, fieldSlots: { 42: 0 } });
    expect(result.kind).toBe("deferred");
    expect(calls).toHaveLength(0);
  });

  it("installs every command-frontier component only after all actors resolve", () => {
    const frontier = command({
      commands: [
        { fieldIndex: 0, ownerSeatId: 0, pokemonId: 42 },
        { fieldIndex: 1, ownerSeatId: 1, pokemonId: 43 },
      ],
    });
    const { result, calls } = project(frontier, { fieldSlots: { 42: 0, 43: 1 } });
    expect(result.kind).toBe("installed");
    expect(calls).toEqual([
      {
        verb: "installCommand",
        args: [0, commandControlTargetId(1, 3, 2, frontier.commands[0])],
      },
      {
        verb: "installCommand",
        args: [1, commandControlTargetId(1, 3, 2, frontier.commands[1])],
      },
    ]);
  });

  it("defers COMMAND when the actor is not yet on field", () => {
    const { result, calls } = project(command({ pokemonId: 7 }), { fieldSlots: {} });
    expect(result.kind).toBe("deferred");
    expect(calls).toHaveLength(0);
  });

  it("does not partially install a frontier when one actor is missing", () => {
    const frontier = command({
      commands: [
        { fieldIndex: 0, ownerSeatId: 0, pokemonId: 42 },
        { fieldIndex: 1, ownerSeatId: 1, pokemonId: 43 },
      ],
    });
    const { result, calls } = project(frontier, { fieldSlots: { 42: 0 } });
    expect(result.kind).toBe("deferred");
    expect(calls).toHaveLength(0);
  });

  it("projects REPLACEMENT to the owner's picker when local seat owns it", () => {
    const c = replacement({ ownerSeatId: 1, fieldIndex: 1 });
    const { result, calls } = project(c, { validFieldSlots: new Set([1]) }, /*localSeatId*/ 1);
    expect(result.kind).toBe("installed");
    expect(calls[0].verb).toBe("installReplacementPicker");
  });

  it("projects REPLACEMENT to the non-owner's await when a different seat owns it", () => {
    const c = replacement({ ownerSeatId: 1, fieldIndex: 1 });
    const { result, calls } = project(c, { validFieldSlots: new Set([1]) }, /*localSeatId*/ 0);
    expect(result.kind).toBe("installed");
    expect(calls[0].verb).toBe("installReplacementAwait");
  });

  it("rejects REPLACEMENT whose field slot is outside the battle geometry", () => {
    const c = replacement({ fieldIndex: 5 });
    const { result, calls } = project(c, { validFieldSlots: new Set([0, 1]) });
    expect(result.kind).toBe("rejected");
    expect(calls).toHaveLength(0);
  });

  it("installs the owning interaction surface for REWARD / BIOME / MYSTERY", () => {
    expect(project(reward(), {}).calls[0].verb).toBe("installReward");
    expect(project({ kind: "BIOME", operationId: "b", ownerSeatId: 0 }, {}).calls[0].verb).toBe("installBiome");
    expect(project({ kind: "MYSTERY", operationId: "m", ownerSeatId: 0 }, {}).calls[0].verb).toBe("installMystery");
  });

  it("installs the shared terminal freeze for TERMINAL", () => {
    const { result, calls } = project(terminal("t9"), {});
    expect(result.kind).toBe("installed");
    expect(calls[0].verb).toBe("installTerminal");
  });
});

// ---------------------------------------------------------------------------
// replica pipeline
// ---------------------------------------------------------------------------

const FRAME: CoopFrameContextV2 = {
  sessionId: "s",
  runId: "r",
  sessionEpoch: 1,
  seatMapId: "m",
  membershipRevision: 1,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 1,
};

function entryWith(nextControl: CoopNextControl, digest = "d1"): CoopAuthorityEntry {
  return {
    context: FRAME,
    revision: 7,
    operationId: "op-7",
    kind: "TURN_COMMIT",
    material: { digest, payload: { any: true } },
    nextControl,
    subsumes: [],
  };
}

function recordingSink(): { sink: ReplicaReceiptSink; stages: string[]; receipts: CoopAuthorityReceipt[] } {
  const receipts: CoopAuthorityReceipt[] = [];
  return {
    sink: { emit: r => receipts.push(r) },
    get stages() {
      return receipts.map(r => r.stage);
    },
    receipts,
  };
}

function fixedProjector(result: CoopControlInstallResult): CoopControlProjector {
  return { project: () => result };
}

const CTX = ctxWithSeat(1);

describe("applyEntry (replica pipeline)", () => {
  it("signs admitted -> materialApplied -> controlInstalled in order on the happy path", () => {
    const rec = recordingSink();
    const control = command();
    const cid = controlIdOf(control);
    const out = applyEntry(CTX, entryWith(control), {
      applyMaterial: () => true,
      projector: fixedProjector({ kind: "installed", controlId: cid }),
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(rec.stages).toEqual(["admitted", "materialApplied", "controlInstalled"]);
    expect(rec.receipts[2].controlId).toBe(cid);
    expect(rec.receipts.every(receipt => receipt.context.senderSeatId === 1)).toBe(true);
    expect(out).toEqual({ kind: "applied", controlId: cid, presentationSettled: false });
  });

  it("refuses to emit self-signed authority receipts or accept an address-mismatched projector result", () => {
    const selfSigned = applyEntry(CTX, entryWith(command()), {
      applyMaterial: () => true,
      projector: fixedProjector({ kind: "installed", controlId: controlIdOf(command()) }),
      receipts: recordingSink().sink,
      ...PIPELINE_BOOKKEEPING,
      receiptContext: FRAME,
    });
    expect(selfSigned).toMatchObject({
      kind: "materialRejected",
      reason: "receipt context is not the authenticated receiving replica",
    });

    const wrongControl = applyEntry(CTX, entryWith(command()), {
      applyMaterial: () => true,
      projector: fixedProjector({ kind: "installed", controlId: "wrong" }),
      receipts: recordingSink().sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(wrongControl).toMatchObject({ kind: "controlRejected" });
  });

  it("stops at admitted and reports materialRejected when material does not apply", () => {
    const rec = recordingSink();
    const projector = { project: vi.fn() };
    const out = applyEntry(CTX, entryWith(command()), {
      applyMaterial: () => false,
      projector: projector as unknown as CoopControlProjector,
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(rec.stages).toEqual(["admitted"]);
    expect(out.kind).toBe("materialRejected");
    expect(projector.project).not.toHaveBeenCalled();
  });

  it("surfaces a thrown applyMaterial as materialRejected (no materialApplied receipt)", () => {
    const rec = recordingSink();
    const out = applyEntry(CTX, entryWith(command()), {
      applyMaterial: () => {
        throw new Error("boom");
      },
      projector: fixedProjector({ kind: "installed", controlId: "x" }),
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(rec.stages).toEqual(["admitted"]);
    expect(out).toMatchObject({ kind: "materialRejected", reason: "boom" });
  });

  it("does NOT sign controlInstalled when the control defers", () => {
    const rec = recordingSink();
    const out = applyEntry(CTX, entryWith(command()), {
      applyMaterial: () => true,
      projector: fixedProjector({ kind: "deferred", reason: "pacing" }),
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(rec.stages).toEqual(["admitted", "materialApplied"]);
    expect(out).toMatchObject({ kind: "controlDeferred", reason: "pacing" });
  });

  it("surfaces a rejected control without retiring (no controlInstalled)", () => {
    const rec = recordingSink();
    const out = applyEntry(CTX, entryWith(replacement()), {
      applyMaterial: () => true,
      projector: fixedProjector({ kind: "rejected", reason: "impossible" }),
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(rec.stages).toEqual(["admitted", "materialApplied"]);
    expect(out).toMatchObject({ kind: "controlRejected", reason: "impossible" });
  });

  it("treats a null nextControl as complete at materialApplied", () => {
    const rec = recordingSink();
    const out = applyEntry(CTX, entryWith(null), {
      applyMaterial: () => true,
      projector: fixedProjector({ kind: "installed", controlId: "unused" }),
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(rec.stages).toEqual(["admitted", "materialApplied"]);
    expect(out).toEqual({ kind: "applied", controlId: null, presentationSettled: false });
  });

  it("emits presentationSettled opportunistically and never blocks on a throwing probe", () => {
    const okRec = recordingSink();
    const okOut = applyEntry(CTX, entryWith(command()), {
      applyMaterial: () => true,
      projector: fixedProjector({ kind: "installed", controlId: controlIdOf(command()) }),
      receipts: okRec.sink,
      ...PIPELINE_BOOKKEEPING,
      presentation: () => true,
    });
    expect(okRec.stages).toEqual(["admitted", "materialApplied", "controlInstalled", "presentationSettled"]);
    expect(okOut).toMatchObject({ presentationSettled: true });

    const throwRec = recordingSink();
    const throwOut = applyEntry(CTX, entryWith(command()), {
      applyMaterial: () => true,
      projector: fixedProjector({ kind: "installed", controlId: controlIdOf(command()) }),
      receipts: throwRec.sink,
      ...PIPELINE_BOOKKEEPING,
      presentation: () => {
        throw new Error("render blew up");
      },
    });
    // A throwing presentation probe must NOT block mechanical liveness: the entry
    // still reached controlInstalled, just without a presentationSettled receipt.
    expect(throwRec.stages).toEqual(["admitted", "materialApplied", "controlInstalled"]);
    expect(throwOut).toMatchObject({ kind: "applied", presentationSettled: false });
  });

  it("contains a throwing receipt sink so it cannot abort the ordered apply", () => {
    let calls = 0;
    const sink: ReplicaReceiptSink = {
      emit: () => {
        calls++;
        throw new Error("sink down");
      },
    };
    const out = applyEntry(CTX, entryWith(command()), {
      applyMaterial: () => true,
      projector: fixedProjector({ kind: "installed", controlId: controlIdOf(command()) }),
      receipts: sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(calls).toBe(3); // admitted, materialApplied, controlInstalled all attempted
    expect(out.kind).toBe("applied");
  });
});

describe("expectedControlId", () => {
  it("mirrors the projected controlId for a stated control and null for none", () => {
    expect(expectedControlId(entryWith(command()))).toBe(controlIdOf(command()));
    expect(expectedControlId(entryWith(null))).toBeNull();
  });
});
