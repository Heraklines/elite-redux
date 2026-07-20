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
  commandTargetsOwnedBySeat,
  controlIdOf,
  controlOwnerSeatId,
  controlOwnerSeatIds,
  controlsEqual,
  isValidNextControl,
  sameControlAddress,
  successorWaitAllowsLocalPresentationInput,
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

const reward = (over: Partial<Extract<Projectable, { kind: "REWARD" }>> = {}): Projectable => ({
  kind: "REWARD",
  operationId: "op-reward-1",
  ownerSeatId: 0,
  ...over,
});

const terminal = (terminalId = "term-1"): Projectable => ({ kind: "TERMINAL", terminalId });

const successorWait = (
  over: Partial<Extract<Projectable, { kind: "AWAIT_SUCCESSOR" }>> = {},
): Extract<Projectable, { kind: "AWAIT_SUCCESSOR" }> => ({
  kind: "AWAIT_SUCCESSOR",
  afterOperationId: "reward-terminal",
  epoch: 1,
  wave: 3,
  turn: 7,
  allowedKinds: ["CONTROL_COMMIT", "INTERACTION_COMMIT"],
  allowNextWaveStart: true,
  expectedOperationId: null,
  ...over,
});

describe("ordered-wait local presentation lease", () => {
  const exactNextEncounter = {
    sessionEpoch: 1,
    wave: 4,
    turn: 1,
    phaseName: "NextEncounterPhase",
    messageHandlerActionable: true,
  };
  const exactSameAddressLevelUp = {
    sessionEpoch: 1,
    wave: 3,
    turn: 7,
    phaseName: "LevelUpPhase",
    messageHandlerActionable: true,
  };

  it("admits only the explicit terminal-result LevelUp and N+1/t1 NextEncounter action prompts", () => {
    expect(successorWaitAllowsLocalPresentationInput(successorWait(), exactNextEncounter)).toBe(true);
    expect(successorWaitAllowsLocalPresentationInput(successorWait(), exactSameAddressLevelUp)).toBe(true);
    expect(
      successorWaitAllowsLocalPresentationInput(successorWait({ allowNextWaveStart: false }), exactNextEncounter),
    ).toBe(false);
    expect(
      successorWaitAllowsLocalPresentationInput(successorWait({ allowNextWaveStart: false }), exactSameAddressLevelUp),
    ).toBe(false);
    expect(successorWaitAllowsLocalPresentationInput(successorWait(), { ...exactNextEncounter, sessionEpoch: 2 })).toBe(
      false,
    );
    expect(successorWaitAllowsLocalPresentationInput(successorWait(), { ...exactNextEncounter, wave: 3 })).toBe(false);
    expect(successorWaitAllowsLocalPresentationInput(successorWait(), { ...exactNextEncounter, turn: 2 })).toBe(false);
    expect(
      successorWaitAllowsLocalPresentationInput(successorWait(), {
        ...exactSameAddressLevelUp,
        phaseName: "MessagePhase",
      }),
    ).toBe(false);
    expect(successorWaitAllowsLocalPresentationInput(successorWait(), { ...exactSameAddressLevelUp, turn: 8 })).toBe(
      false,
    );
    expect(
      successorWaitAllowsLocalPresentationInput(successorWait(), {
        ...exactNextEncounter,
        phaseName: "MysteryEncounterPhase",
      }),
    ).toBe(false);
    expect(
      successorWaitAllowsLocalPresentationInput(successorWait(), {
        ...exactNextEncounter,
        messageHandlerActionable: false,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// controlId
// ---------------------------------------------------------------------------

describe("controlIdOf", () => {
  it("is a stable, complete encoding - identical inputs give identical ids", () => {
    expect(controlIdOf(command())).toBe(controlIdOf(command()));
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
    expect(controlsEqual(command(), reward())).toBe(false);
  });

  it("sameControlAddress matches controlId equality", () => {
    expect(sameControlAddress(reward(), reward())).toBe(true);
    expect(sameControlAddress(reward(), reward({ ownerSeatId: 1 }))).toBe(false);
  });
});

describe("control ownership", () => {
  it("returns the owner seat for owned controls and null for TERMINAL", () => {
    expect(controlOwnerSeatId(command({ ownerSeatId: 0 }))).toBe(0);
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

  it("partitions a complete frontier by numeric seat for N-seat replica projection", () => {
    const frontier = command({
      commands: [
        { fieldIndex: 4, ownerSeatId: 2, pokemonId: 44 },
        { fieldIndex: 0, ownerSeatId: 0, pokemonId: 42 },
        { fieldIndex: 3, ownerSeatId: 2, pokemonId: 43 },
      ],
    });
    expect(commandTargetsOwnedBySeat(frontier, 2)).toEqual([
      { fieldIndex: 3, ownerSeatId: 2, pokemonId: 43 },
      { fieldIndex: 4, ownerSeatId: 2, pokemonId: 44 },
    ]);
    expect(commandTargetsOwnedBySeat(frontier, 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

describe("validateNextControl", () => {
  it("accepts well-formed controls of every kind", () => {
    expect(isValidNextControl(command())).toBe(true);
    expect(isValidNextControl(reward())).toBe(true);
    expect(isValidNextControl({ kind: "BIOME", operationId: "b", ownerSeatId: 0 })).toBe(true);
    expect(isValidNextControl({ kind: "MYSTERY", operationId: "m", ownerSeatId: 2 })).toBe(true);
    expect(
      isValidNextControl({
        kind: "SHARED_INTERACTION",
        operationId: "i",
        ownerSeatId: 1,
        epoch: 1,
        wave: 1,
        turn: 1,
        surfaceClass: "op:learnMove",
        operationKind: "LEARN_MOVE",
        successor: { operationKinds: ["LEARN_MOVE"], operationIds: ["result-i"] },
      }),
    ).toBe(true);
    expect(
      isValidNextControl({
        kind: "AWAIT_SUCCESSOR",
        afterOperationId: "i",
        epoch: 1,
        wave: 2,
        turn: 3,
        allowedKinds: ["INTERACTION_COMMIT", "WAVE_ADVANCE"],
        allowNextWaveStart: false,
        expectedOperationId: null,
      }),
    ).toBe(true);
    expect(isValidNextControl(terminal())).toBe(true);
  });

  it("requires the cross-wave permission only on successor waits", () => {
    const shared = {
      kind: "SHARED_INTERACTION",
      operationId: "i",
      ownerSeatId: 1,
      epoch: 1,
      wave: 1,
      turn: 1,
      surfaceClass: "op:learnMove",
      operationKind: "LEARN_MOVE",
      successor: { operationKinds: ["LEARN_MOVE"], operationIds: ["result-i"] },
    } as const;
    expect(validateNextControl(shared)).toEqual({ ok: true });
    expect(
      validateNextControl({
        kind: "AWAIT_SUCCESSOR",
        afterOperationId: "i",
        epoch: 1,
        wave: 1,
        turn: 1,
        allowedKinds: ["CONTROL_COMMIT"],
        expectedOperationId: null,
      }),
    ).toMatchObject({ ok: false, reason: "allowNextWaveStart" });
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

  it("rejects a negative pokemonId / seat", () => {
    expect(validateNextControl(command({ pokemonId: 0 })).ok).toBe(false);
    expect(validateNextControl(command({ ownerSeatId: -1 })).ok).toBe(false);
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

  it("rejects a shared surface without a closed mechanical successor contract", () => {
    const base = {
      kind: "SHARED_INTERACTION",
      operationId: "presentation",
      ownerSeatId: 1,
      surfaceClass: "op:learnMove",
      operationKind: "LEARN_MOVE",
    } as const;
    expect(validateNextControl(base).ok).toBe(false);
    expect(validateNextControl({ ...base, successor: { operationKinds: [], operationIds: null } }).ok).toBe(false);
    expect(
      validateNextControl({
        ...base,
        successor: { operationKinds: ["LEARN_MOVE"], operationIds: [] },
      }).ok,
    ).toBe(false);
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
    installReplacement: (...args) => {
      calls.push({ verb: "installReplacement", args });
      return true;
    },
    installReward: (...args) => calls.push({ verb: "installReward", args }),
    installBiome: (...args) => calls.push({ verb: "installBiome", args }),
    installMystery: (...args) => calls.push({ verb: "installMystery", args }),
    installSharedInteraction: (...args) => {
      calls.push({ verb: "installSharedInteraction", args });
      return true;
    },
    installSuccessorWait: (...args) => calls.push({ verb: "installSuccessorWait", args }),
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

  it("installs every local-seat frontier component without fabricating another seat's input", () => {
    const frontier = command({
      commands: [
        { fieldIndex: 0, ownerSeatId: 0, pokemonId: 42 },
        { fieldIndex: 1, ownerSeatId: 1, pokemonId: 43 },
      ],
    });
    const { result, calls } = project(frontier, { fieldSlots: { 42: 0, 43: 1 } }, /*localSeatId*/ 0);
    expect(result.kind).toBe("installed");
    expect(calls).toEqual([
      {
        verb: "installCommand",
        args: [0, commandControlTargetId(1, 3, 2, frontier.commands[0])],
      },
    ]);
  });

  it("projects the authenticated replica seat's partition even when a remote actor is absent locally", () => {
    const frontier = command({
      commands: [
        { fieldIndex: 0, ownerSeatId: 0, pokemonId: 42 },
        { fieldIndex: 1, ownerSeatId: 1, pokemonId: 43 },
      ],
    });
    const { result, calls } = project(frontier, { fieldSlots: { 43: 1 } }, /*localSeatId*/ 1);
    expect(result.kind).toBe("installed");
    expect(calls).toEqual([
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
        { fieldIndex: 1, ownerSeatId: 0, pokemonId: 43 },
      ],
    });
    const { result, calls } = project(frontier, { fieldSlots: { 42: 0 } });
    expect(result.kind).toBe("deferred");
    expect(calls).toHaveLength(0);
  });

  it("installs the owning interaction surface for REWARD / BIOME / MYSTERY", () => {
    expect(project(reward(), {}).calls[0].verb).toBe("installReward");
    expect(project({ kind: "BIOME", operationId: "b", ownerSeatId: 0 }, {}).calls[0].verb).toBe("installBiome");
    expect(project({ kind: "MYSTERY", operationId: "m", ownerSeatId: 0 }, {}).calls[0].verb).toBe("installMystery");
  });

  it("projects registered shared interactions and explicit address-constrained successor waits", () => {
    expect(
      project(
        {
          kind: "SHARED_INTERACTION",
          operationId: "learn-1",
          ownerSeatId: 1,
          epoch: 1,
          wave: 2,
          turn: 3,
          surfaceClass: "op:learnMove",
          operationKind: "LEARN_MOVE",
          successor: { operationKinds: ["LEARN_MOVE"], operationIds: ["learn-result-1"] },
        },
        {},
      ).calls[0].verb,
    ).toBe("installSharedInteraction");
    expect(
      project(
        {
          kind: "AWAIT_SUCCESSOR",
          afterOperationId: "done-1",
          epoch: 1,
          wave: 2,
          turn: 3,
          allowedKinds: ["WAVE_ADVANCE", "TERMINAL_COMMIT"],
          allowNextWaveStart: false,
          expectedOperationId: null,
        },
        {},
      ).calls[0].verb,
    ).toBe("installSuccessorWait");
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

  it("classifies admitted live material pacing as deferred without signing or projecting", () => {
    const rec = recordingSink();
    const projector = { project: vi.fn() };
    const out = applyEntry(CTX, entryWith(command()), {
      applyMaterial: () => "deferred",
      projector: projector as unknown as CoopControlProjector,
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(rec.stages).toEqual(["admitted"]);
    expect(out).toMatchObject({
      kind: "materialDeferred",
      reason: expect.stringContaining("awaiting live completion"),
    });
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
    const out = applyEntry(CTX, entryWith(reward()), {
      applyMaterial: () => true,
      projector: fixedProjector({ kind: "rejected", reason: "impossible" }),
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(rec.stages).toEqual(["admitted", "materialApplied"]);
    expect(out).toMatchObject({ kind: "controlRejected", reason: "impossible" });
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
  it("mirrors the projected controlId for the mandatory stated control", () => {
    expect(expectedControlId(entryWith(command()))).toBe(controlIdOf(command()));
  });
});
