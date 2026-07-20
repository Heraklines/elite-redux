/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type {
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  type CoopV2InteractionControl,
  CoopV2InteractionControlLedger,
  type CoopV2InteractionSurfaceObservation,
} from "#data/elite-redux/coop/authority-v2/interaction-control-ledger";
import { describe, expect, it } from "vitest";

const CONTEXT: CoopFrameContextV2 = {
  sessionId: "session",
  runId: "run",
  sessionEpoch: 3,
  seatMapId: "map",
  membershipRevision: 1,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 1,
};

function interactionEntry(revision: number, operationId: string, nextControl: CoopNextControl): CoopAuthorityEntry {
  return {
    context: CONTEXT,
    revision,
    operationId,
    kind: "INTERACTION_COMMIT",
    material: { digest: `digest-${operationId}`, payload: null },
    nextControl,
    subsumes: [],
  };
}

function shared(
  operationId = "operation-1",
  successor: Extract<CoopV2InteractionControl, { kind: "SHARED_INTERACTION" }>["successor"] = {
    operationKinds: ["REWARD"],
    operationIds: null,
  },
): CoopV2InteractionControl {
  return {
    kind: "SHARED_INTERACTION",
    operationId,
    ownerSeatId: 1,
    epoch: 1,
    wave: 1,
    turn: 1,
    surfaceClass: "op:reward",
    operationKind: "REWARD",
    successor,
  };
}

function interactionResultEntry(
  revision: number,
  operationId: string,
  operationKind: "REWARD" | "SHOP_BUY",
): CoopAuthorityEntry {
  return {
    ...interactionEntry(revision, operationId, TERMINAL_CONTROL),
    material: {
      digest: `digest-${operationId}`,
      payload: { envelope: { pendingOperation: { kind: operationKind } } },
    },
  };
}

const TERMINAL_CONTROL: CoopNextControl = { kind: "TERMINAL", terminalId: "test-terminal" };

function wait(
  operationId = "operation-1",
  expectedOperationId: string | null = null,
  allowedKinds: Extract<CoopV2InteractionControl, { kind: "AWAIT_SUCCESSOR" }>["allowedKinds"] = [
    "WAVE_ADVANCE",
    "TERMINAL_COMMIT",
  ],
): CoopV2InteractionControl {
  return {
    kind: "AWAIT_SUCCESSOR",
    afterOperationId: operationId,
    epoch: 3,
    wave: 5,
    turn: 1,
    allowedKinds,
    expectedOperationId,
  };
}

function observation(
  phaseToken: object = {},
  handlerToken: object = {},
  overrides: Partial<CoopV2InteractionSurfaceObservation> = {},
): CoopV2InteractionSurfaceObservation {
  return {
    operationId: "operation-1",
    phaseName: "SelectModifierPhase",
    uiMode: 20,
    phaseToken,
    handlerToken,
    handlerActive: true,
    actionable: true,
    ...overrides,
  };
}

describe("Authority V2 interaction control ledger", () => {
  it("cannot project before the exact entry material applies", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const control = shared();
    const entry = interactionEntry(1, "operation-1", control);
    expect(ledger.registerEntry(entry)).toBe(true);
    expect(ledger.project(control, observation())).toMatchObject({ kind: "deferred" });
    expect(ledger.markMaterialApplied(entry)).toBe(true);
    expect(ledger.project(control, observation())).toMatchObject({ kind: "installed" });
  });

  it("allows an entry to authorize a different exact successor surface address", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const control = shared("biome-picker-after-crossroads");
    const entry = interactionEntry(1, "crossroads-result", control);
    expect(ledger.registerEntry(entry)).toBe(true);
    expect(ledger.markMaterialApplied(entry)).toBe(true);
    expect(
      ledger.project(control, observation({}, {}, { operationId: "biome-picker-after-crossroads" })),
    ).toMatchObject({ kind: "installed" });
  });

  it("binds control to one phase generation and explicitly rebinds its public handler steps", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const control = shared();
    const entry = interactionEntry(1, "operation-1", control);
    const phase = {};
    const handler = {};
    const exact = observation(phase, handler);
    expect(ledger.registerEntry(entry)).toBe(true);
    expect(ledger.markMaterialApplied(entry)).toBe(true);
    expect(ledger.project(control, exact)).toMatchObject({ kind: "installed" });
    expect(ledger.project(control, exact)).toMatchObject({ kind: "already-installed" });
    expect(ledger.allowsHumanInput(1, exact)).toBe(true);
    expect(ledger.allowsHumanInput(0, exact)).toBe(false);
    const nextHandler = {};
    const nextStep = observation(phase, nextHandler, { uiMode: 21 });
    expect(ledger.allowsHumanInput(1, nextStep)).toBe(false);
    expect(ledger.project(control, nextStep)).toMatchObject({ kind: "already-installed" });
    expect(ledger.allowsHumanInput(1, nextStep)).toBe(true);
    expect(ledger.project(control, observation({}, {}))).toMatchObject({ kind: "deferred" });
  });

  it("does not accept an inactive handler or a keepalive-only message as actionable", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const control = shared();
    const entry = interactionEntry(1, "operation-1", control);
    expect(ledger.registerEntry(entry)).toBe(true);
    expect(ledger.markMaterialApplied(entry)).toBe(true);
    expect(ledger.project(control, observation({}, {}, { handlerActive: false }))).toMatchObject({
      kind: "deferred",
    });
    expect(ledger.project(control, observation({}, {}, { actionable: false }))).toMatchObject({
      kind: "deferred",
    });
  });

  it("installs a wait as a non-input lease and admits only its immediate permitted successor", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const control = wait();
    const entry = interactionEntry(1, "operation-1", control);
    expect(ledger.registerEntry(entry)).toBe(true);
    expect(ledger.markMaterialApplied(entry)).toBe(true);
    expect(ledger.project(control, null)).toMatchObject({ kind: "installed" });
    expect(ledger.allowsHumanInput(1, observation())).toBe(false);

    expect(
      ledger.admitSuccessor({
        ...interactionEntry(2, "wrong", TERMINAL_CONTROL),
        kind: "TURN_COMMIT",
      }),
    ).toBe(false);
    expect(
      ledger.admitSuccessor({
        ...interactionEntry(2, "wave", TERMINAL_CONTROL),
        kind: "WAVE_ADVANCE",
      }),
    ).toBe(true);
    expect(ledger.latestControl).toBeNull();
  });

  it("owns ordered waits emitted by non-interaction entries and checks an exact successor operation", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const control = wait("TURN/e3/w5/t1", "RC/e3/w5/t1/o0/f0/s1", ["REPLACEMENT_COMMIT"]);
    const turn: CoopAuthorityEntry = {
      ...interactionEntry(1, "TURN/e3/w5/t1", control),
      kind: "TURN_COMMIT",
    };
    expect(ledger.registerEntry(turn)).toBe(true);
    expect(ledger.markMaterialApplied(turn)).toBe(true);
    expect(ledger.project(control, null)).toMatchObject({ kind: "installed" });
    expect(
      ledger.admitSuccessor({
        ...interactionEntry(2, "RC/e3/w5/t1/o0/f1/s1", TERMINAL_CONTROL),
        kind: "REPLACEMENT_COMMIT",
      }),
    ).toBe(false);
    expect(
      ledger.admitSuccessor({
        ...interactionEntry(2, "RC/e3/w5/t1/o0/f0/s1", TERMINAL_CONTROL),
        kind: "REPLACEMENT_COMMIT",
      }),
    ).toBe(true);
  });

  it("refuses a successor until the predecessor's real control was installed", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const control = shared();
    const entry = interactionEntry(1, "operation-1", control);
    expect(ledger.registerEntry(entry)).toBe(true);
    expect(ledger.markMaterialApplied(entry)).toBe(true);
    expect(
      ledger.admitSuccessor({
        ...interactionEntry(2, "operation-2", TERMINAL_CONTROL),
        kind: "INTERACTION_COMMIT",
      }),
    ).toBe(false);
  });

  it("consumes a shared surface only with its authority-stated result kind and exact address", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const control = shared("presentation", {
      operationKinds: ["REWARD"],
      operationIds: ["result-1"],
    });
    const entry = interactionEntry(1, "presentation", control);
    expect(ledger.registerEntry(entry)).toBe(true);
    expect(ledger.markMaterialApplied(entry)).toBe(true);
    expect(ledger.project(control, observation({}, {}, { operationId: "presentation" }))).toMatchObject({
      kind: "installed",
    });

    expect(ledger.admitSuccessor(interactionResultEntry(2, "result-1", "SHOP_BUY"))).toBe(false);
    expect(ledger.admitSuccessor(interactionResultEntry(2, "result-2", "REWARD"))).toBe(false);
    expect(ledger.admitSuccessor(interactionResultEntry(2, "result-1", "REWARD"))).toBe(true);
  });

  it("reserves authority material atomically and restores the exact predecessor on refusal", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const control = wait("operation-1", null, ["WAVE_ADVANCE"]);
    const first = interactionEntry(1, "operation-1", control);
    const rollback = ledger.prepareAuthorityEntry(first);
    expect(rollback).not.toBeNull();
    expect(ledger.isMaterialApplied(control)).toBe(true);
    expect(ledger.project(control, null)).toMatchObject({ kind: "installed" });

    const refused = {
      ...interactionEntry(2, "not-a-wave", TERMINAL_CONTROL),
      kind: "TURN_COMMIT" as const,
    };
    expect(ledger.prepareAuthorityEntry(refused)).toBeNull();
    expect(ledger.activeControl).toEqual(control);
    expect(ledger.isMaterialApplied(control)).toBe(true);

    rollback?.();
    expect(ledger.latestControl).toBeNull();
    expect(ledger.activeControl).toBeNull();
  });
});
