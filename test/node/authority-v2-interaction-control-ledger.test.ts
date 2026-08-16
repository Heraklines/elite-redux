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
  buildTerminalCommitEntry,
  buildWaveAdvanceEntry,
  type CoopWaveTransitionMaterialV2,
} from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import {
  type CoopV2AuthorityProposalWaitObservation,
  type CoopV2InteractionControl,
  CoopV2InteractionControlLedger,
  type CoopV2InteractionSurfaceObservation,
} from "#data/elite-redux/coop/authority-v2/interaction-control-ledger";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
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
    material: {
      digest: `digest-${operationId}`,
      payload: {
        envelope: {
          sessionEpoch: CONTEXT.sessionEpoch,
          wave: 5,
          turn: 1,
          pendingOperation: { kind: "REWARD" },
        },
      },
    },
    nextControl,
    subsumes: [],
  };
}

function commandControl(wave = 5, turn = 1): Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }> {
  return {
    kind: "COMMAND_FRONTIER",
    epoch: CONTEXT.sessionEpoch,
    wave,
    turn,
    commands: [{ ownerSeatId: 0, fieldIndex: 0, pokemonId: 25 }],
  };
}

function turnEntry(revision: number, operationId: string, nextControl: CoopNextControl): CoopAuthorityEntry {
  return {
    context: CONTEXT,
    revision,
    operationId,
    kind: "TURN_COMMIT",
    material: {
      digest: `digest-${operationId}`,
      payload: { epoch: CONTEXT.sessionEpoch, wave: 5, turn: 1 },
    },
    nextControl,
    subsumes: [],
  };
}

const BOUNDARY_TRANSITION: CoopWaveTransitionMaterialV2 = {
  kind: "wave-advance",
  wave: 5,
  turn: 1,
  outcome: "win",
  nextWave: 6,
  biomeChange: false,
  eggLapse: false,
  meBoundary: "none",
  victoryKind: "wild",
};

function shared(
  operationId = "operation-1",
  successor: Extract<CoopV2InteractionControl, { kind: "SHARED_INTERACTION" }>["successor"] = {
    operationKinds: ["REWARD"],
    operationIds: null,
  },
): Extract<CoopV2InteractionControl, { kind: "SHARED_INTERACTION" }> {
  return {
    kind: "SHARED_INTERACTION",
    operationId,
    ownerSeatId: 1,
    epoch: CONTEXT.sessionEpoch,
    wave: 5,
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
      payload: {
        envelope: {
          sessionEpoch: CONTEXT.sessionEpoch,
          wave: 5,
          turn: 1,
          pendingOperation: { kind: operationKind },
        },
      },
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
    allowNextWaveStart: false,
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

function proposalWait(
  overrides: Partial<CoopV2AuthorityProposalWaitObservation> = {},
): CoopV2AuthorityProposalWaitObservation {
  return {
    controlOperationId: "operation-1",
    relaySequence: 8_000_004,
    acceptedKinds: ["me"],
    waiterToken: {},
    active: true,
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
        material: { digest: "digest-wrong", payload: { epoch: 3, wave: 5, turn: 1 } },
      }),
    ).toBe(false);
    expect(
      ledger.admitSuccessor({
        ...interactionEntry(2, "wave", TERMINAL_CONTROL),
        kind: "WAVE_ADVANCE",
        material: { digest: "digest-wave", payload: { wave: 5, turn: 1 } },
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
        material: {
          digest: "digest-wrong-replacement",
          payload: { sourceAddress: { epoch: 3, wave: 5, turn: 1 } },
        },
      }),
    ).toBe(false);
    expect(
      ledger.admitSuccessor({
        ...interactionEntry(2, "RC/e3/w5/t1/o0/f0/s1", TERMINAL_CONTROL),
        kind: "REPLACEMENT_COMMIT",
        material: {
          digest: "digest-replacement",
          payload: { sourceAddress: { epoch: 3, wave: 5, turn: 1 } },
        },
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

  it("installs a remote-owner interaction only from its exact live authority proposal waiter", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const control = shared();
    const entry = interactionEntry(1, "operation-1", control);
    expect(ledger.registerEntry(entry)).toBe(true);
    expect(ledger.markMaterialApplied(entry)).toBe(true);

    expect(
      ledger.projectAuthorityProposalWait(control, proposalWait({ controlOperationId: "wrong" }), 0),
    ).toMatchObject({ kind: "deferred" });
    expect(ledger.projectAuthorityProposalWait(control, proposalWait({ active: false }), 0)).toMatchObject({
      kind: "deferred",
    });
    expect(ledger.projectAuthorityProposalWait(control, proposalWait(), 1)).toMatchObject({
      kind: "rejected",
    });

    const exact = proposalWait({ expectedRewardSurface: { ordinal: 0, surfaceId: "mystery-reward" } });
    expect(ledger.projectAuthorityProposalWait(control, exact, 0)).toMatchObject({ kind: "installed" });
    expect(ledger.projectAuthorityProposalWait(control, exact, 0)).toMatchObject({ kind: "already-installed" });
    expect(
      ledger.projectAuthorityProposalWait(
        control,
        proposalWait({
          expectedRewardSurface: { ordinal: 1, surfaceId: "mystery-reward" },
          waiterToken: exact.waiterToken,
        }),
        0,
      ),
    ).toMatchObject({ kind: "deferred" });
    expect(ledger.project(control, observation(), 0)).toMatchObject({ kind: "already-installed" });
    expect(ledger.isAuthorityProposalWaitInstalled(control)).toBe(true);
    expect(ledger.allowsHumanInput(0, observation())).toBe(false);
    expect(ledger.allowsHumanInput(1, observation())).toBe(false);
    expect(ledger.admitSuccessor(interactionResultEntry(2, "result-1", "REWARD"))).toBe(true);
  });

  it("revokes only the exact timed-out remote proposal waiter generation", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const control = shared();
    const entry = interactionEntry(1, "operation-1", control);
    const token = {};
    expect(ledger.registerEntry(entry)).toBe(true);
    expect(ledger.markMaterialApplied(entry)).toBe(true);
    expect(ledger.projectAuthorityProposalWait(control, proposalWait({ waiterToken: token }), 0)).toMatchObject({
      kind: "installed",
    });
    expect(ledger.revokeAuthorityProposalWait(control, {})).toBe(false);
    expect(ledger.revokeAuthorityProposalWait(control, token)).toBe(true);
    expect(ledger.admitSuccessor(interactionResultEntry(2, "result-1", "REWARD"))).toBe(false);
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

  it("keeps superseded source revisions authenticated when a reusable control address is subsumed at a boundary", () => {
    for (const boundaryKind of ["wave", "terminal"] as const) {
      const ledger = new CoopV2InteractionControlLedger();
      const command = commandControl();
      const first = turnEntry(1, "command-open-1", command);
      expect(ledger.registerEntry(first)).toBe(true);
      expect(ledger.markMaterialApplied(first)).toBe(true);
      expect(
        ledger.projectMechanical(command, () => ({ kind: "installed", controlId: controlIdOf(command) })),
      ).toMatchObject({ kind: "installed" });

      const modalControl = wait("modal-result", null, ["TURN_COMMIT"]);
      const modalWait = turnEntry(2, "modal-result", modalControl);
      expect(ledger.admitSuccessor(modalWait)).toBe(true);
      expect(ledger.registerEntry(modalWait)).toBe(true);
      expect(ledger.markMaterialApplied(modalWait)).toBe(true);
      expect(ledger.project(modalControl, null)).toMatchObject({ kind: "installed" });

      // Revision 3 deliberately reuses revision 1's exact COMMAND_FRONTIER address.
      const reopenedCommand = turnEntry(3, "command-open-2", command);
      expect(ledger.admitSuccessor(reopenedCommand)).toBe(true);
      expect(ledger.registerEntry(reopenedCommand)).toBe(true);
      expect(ledger.markMaterialApplied(reopenedCommand)).toBe(true);
      expect(
        ledger.projectMechanical(command, () => ({ kind: "installed", controlId: controlIdOf(command) })),
      ).toMatchObject({ kind: "installed" });

      const boundary: CoopAuthorityEntry =
        boundaryKind === "wave"
          ? {
              ...buildWaveAdvanceEntry({
                context: CONTEXT,
                operationId: "wave-boundary",
                transition: BOUNDARY_TRANSITION,
                destination: commandControl(6),
                subsumes: [1, 2, 3],
              }),
              revision: 4,
            }
          : {
              ...buildTerminalCommitEntry({
                context: CONTEXT,
                operationId: "terminal-boundary",
                terminal: {
                  kind: "terminal",
                  terminalId: "terminal-boundary",
                  reason: "game-over",
                  wave: 5,
                  turn: 1,
                },
                subsumes: [1, 2, 3],
              }),
              revision: 4,
            };

      // The exact multi-revision proof must survive the command claim's controlId reuse.
      const rollback = ledger.prepareAuthorityEntry(boundary);
      expect(rollback).not.toBeNull();
      rollback?.();
    }
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

  it("restores an uninstalled predecessor when a later boundary reservation step collides", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const predecessor = turnEntry(3, "uninstalled-predecessor", commandControl());
    expect(ledger.prepareAuthorityEntry(predecessor)).not.toBeNull();
    expect(ledger.activeControl).toBeNull();

    // This unrelated claim occupies the boundary's destination address. The boundary proof can consume the
    // uninstalled predecessor, but registration must then fail and roll the whole snapshot back.
    const blocker: CoopAuthorityEntry = {
      context: CONTEXT,
      revision: 2,
      operationId: "terminal-address-blocker",
      kind: "TERMINAL_COMMIT",
      material: { digest: "digest-terminal-address-blocker", payload: { wave: 5, turn: 1 } },
      nextControl: { kind: "TERMINAL", terminalId: "rollback-terminal" },
      subsumes: [],
    };
    expect(ledger.registerEntry(blocker)).toBe(true);
    expect(ledger.markMaterialApplied(blocker)).toBe(true);

    const boundary: CoopAuthorityEntry = {
      ...buildTerminalCommitEntry({
        context: CONTEXT,
        operationId: "rollback-boundary",
        terminal: {
          kind: "terminal",
          terminalId: "rollback-terminal",
          reason: "game-over",
          wave: 5,
          turn: 1,
        },
        subsumes: [3],
      }),
      revision: 4,
    };
    expect(ledger.prepareAuthorityEntry(boundary)).toBeNull();

    // The predecessor was materially reserved but never projected; rollback must leave it in exactly that
    // state so the real projector can still install it after the failed later reservation.
    expect(ledger.latestControl).toEqual(predecessor.nextControl);
    expect(ledger.activeControl).toBeNull();
    expect(ledger.isMaterialApplied(predecessor.nextControl)).toBe(true);
    expect(ledger.sourceEntryOf(predecessor.nextControl)).toMatchObject({
      revision: predecessor.revision,
      operationId: predecessor.operationId,
    });
  });

  it("reopens a superseded command address as a new lease generation after an ordered modal", () => {
    const ledger = new CoopV2InteractionControlLedger();
    const command: Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }> = {
      kind: "COMMAND_FRONTIER",
      epoch: CONTEXT.sessionEpoch,
      wave: 5,
      turn: 1,
      commands: [{ ownerSeatId: 0, fieldIndex: 0, pokemonId: 25 }],
    };
    const firstCommand: CoopAuthorityEntry = {
      ...interactionEntry(1, "command-open-1", command),
      kind: "CONTROL_COMMIT",
      material: {
        digest: "digest-command-open-1",
        payload: { kind: "command-open", wave: 5, turn: 1 },
      },
    };
    expect(ledger.registerEntry(firstCommand)).toBe(true);
    expect(ledger.markMaterialApplied(firstCommand)).toBe(true);
    expect(
      ledger.projectMechanical(command, () => ({ kind: "installed", controlId: controlIdOf(command) })),
    ).toMatchObject({ kind: "installed" });

    const modalResultOperationId = "modal-result";
    const modalWait = wait(modalResultOperationId, null, [
      "TURN_COMMIT",
      "INTERACTION_COMMIT",
      "CONTROL_COMMIT",
      "WAVE_ADVANCE",
      "TERMINAL_COMMIT",
    ]);
    const modalResult: CoopAuthorityEntry = {
      ...interactionEntry(2, modalResultOperationId, modalWait),
      kind: "TURN_COMMIT",
      material: {
        digest: "digest-modal-result",
        payload: { epoch: CONTEXT.sessionEpoch, wave: 5, turn: 1 },
      },
    };
    expect(ledger.admitSuccessor(modalResult)).toBe(true);
    expect(ledger.registerEntry(modalResult)).toBe(true);
    expect(ledger.markMaterialApplied(modalResult)).toBe(true);
    expect(ledger.project(modalWait, null)).toMatchObject({ kind: "installed" });

    const reopenedCommand: CoopAuthorityEntry = {
      ...firstCommand,
      revision: 3,
      operationId: "command-open-2",
      material: {
        digest: "digest-command-open-2",
        payload: { kind: "command-open", wave: 5, turn: 1 },
      },
    };
    expect(ledger.prepareAuthorityEntry(reopenedCommand)).not.toBeNull();
    expect(ledger.sourceEntryOf(command)).toMatchObject({ revision: 3, operationId: "command-open-2" });
  });
});
