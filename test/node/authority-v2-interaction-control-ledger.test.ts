/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  buildTerminalCommitEntry,
  buildWaveAdvanceEntry,
  type CoopWaveTransitionMaterialV2,
} from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import {
  AuthorityLog,
  authorityEntryProofScopeOf,
  type CoopAuthorityWire,
  revokeAuthorityEntryProofScope,
} from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
  CoopScheduler,
  CoopTimeClass,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import type { CoopTailProofBodyV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
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

const REPLICA_CONTEXT: CoopFrameContextV2 = { ...CONTEXT, senderSeatId: 1 };

const REPLICA_SCHEDULER: CoopScheduler = {
  now: (_timeClass: CoopTimeClass) => 0,
  schedule: (_owner: CoopTimerOwner, _delayMs: number, _timeClass: CoopTimeClass, _callback: () => void) => () => {},
  cancelOwner: (_ownerId: string) => {},
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

interface ReplicaBoundaryHarness {
  readonly log: AuthorityLog;
  readonly ledger: CoopV2InteractionControlLedger;
  readonly sent: CoopAuthorityWire[];
  readonly sources: readonly CoopAuthorityEntry[];
  readonly boundary: CoopAuthorityEntry;
}

function replicaBoundaryHarness(subsumes: readonly number[] = [1, 2, 3]): ReplicaBoundaryHarness {
  const sent: CoopAuthorityWire[] = [];
  const log = new AuthorityLog({
    localContext: REPLICA_CONTEXT,
    scheduler: REPLICA_SCHEDULER,
    send: wire => sent.push(wire),
    peerBindings: [{ seatId: 0, connectionGeneration: CONTEXT.connectionGeneration }],
  });
  const ledger = new CoopV2InteractionControlLedger();
  const sources: CoopAuthorityEntry[] = [];
  for (const revision of [1, 2, 3]) {
    const predecessorControl = commandControl();
    const source = turnEntry(revision, `recovered-replica-source-${revision}`, predecessorControl);
    if (
      log.admit(source).kind !== "admitted"
      || !ledger.admitSuccessor(source)
      || !ledger.registerEntry(source)
      || !ledger.markMaterialApplied(source)
      || !log.recordReplicaStage(source, "materialApplied")
    ) {
      throw new Error("replica boundary harness could not journal its exact predecessor sources");
    }
    const installed = ledger.projectMechanical(predecessorControl, () => ({
      kind: "installed",
      controlId: controlIdOf(predecessorControl),
    }));
    if (
      (installed.kind !== "installed" && installed.kind !== "already-installed")
      || !log.recordReplicaStage(source, "controlInstalled")
    ) {
      throw new Error("replica boundary harness could not install its exact predecessor sources");
    }
    sources.push(source);
  }
  return {
    log,
    ledger,
    sent,
    sources,
    boundary: {
      ...buildWaveAdvanceEntry({
        context: CONTEXT,
        operationId: "replica-wave-boundary",
        transition: BOUNDARY_TRANSITION,
        destination: commandControl(6),
        subsumes: [],
      }),
      revision: 4,
      subsumes,
    },
  };
}

type ReplicaBoundaryRequest = Extract<CoopAuthorityWire, { kind: "requestTail" }> & {
  readonly requestId: string;
  readonly candidateRevision: number;
  readonly candidateOperationId: string;
};

function beginReplicaBoundaryProof(harness: ReplicaBoundaryHarness): ReplicaBoundaryRequest {
  const admission = harness.log.admit(harness.boundary);
  if (admission.kind !== "gap") {
    throw new Error(`replica boundary harness expected a proof gap, received ${admission.kind}`);
  }
  const request = harness.sent.at(-1);
  if (
    request?.kind !== "requestTail"
    || request.requestId == null
    || request.candidateRevision == null
    || request.candidateOperationId == null
  ) {
    throw new Error("replica boundary harness did not emit a correlated tail request");
  }
  return request as ReplicaBoundaryRequest;
}

function boundaryProofBody(
  request: ReplicaBoundaryRequest,
  phase: CoopTailProofBodyV2["phase"],
  sourceRevisions: readonly number[] = [1, 2, 3],
): CoopTailProofBodyV2 {
  return {
    phase,
    requestId: request.requestId,
    fromRevision: request.missingFrom,
    candidateRevision: request.candidateRevision,
    candidateOperationId: request.candidateOperationId,
    headRevision: request.candidateRevision,
    sourceRevisions,
  };
}

function completeReplicaBoundaryProof(
  harness: ReplicaBoundaryHarness,
  request = beginReplicaBoundaryProof(harness),
  sources: readonly CoopAuthorityEntry[] = harness.sources,
): void {
  expect(harness.log.acceptBoundaryProofFrame(CONTEXT, boundaryProofBody(request, "manifest"))).toEqual({
    kind: "pending",
  });
  for (const source of sources) {
    expect(harness.log.admit(source)).toEqual({ kind: "gap", missingFrom: request.missingFrom });
  }
  expect(harness.log.acceptBoundaryProofFrame(CONTEXT, boundaryProofBody(request, "complete"))).toMatchObject({
    kind: "completed",
    candidate: harness.boundary,
  });
  expect(harness.log.admit(harness.boundary)).toEqual({ kind: "admitted" });
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
      const log = new AuthorityLog({
        localContext: CONTEXT,
        scheduler: REPLICA_SCHEDULER,
        send: () => {},
        peerBindings: [{ seatId: 1, connectionGeneration: CONTEXT.connectionGeneration }],
      });
      const prepareAndInstall = (entry: CoopAuthorityEntry): (() => void) | null => {
        const rollback = ledger.prepareAuthorityEntry(entry);
        if (rollback == null) {
          return null;
        }
        const result =
          entry.nextControl.kind === "AWAIT_SUCCESSOR"
            ? ledger.project(entry.nextControl, null)
            : entry.nextControl.kind === "COMMAND_FRONTIER" || entry.nextControl.kind === "TERMINAL"
              ? ledger.projectMechanical(entry.nextControl, () => ({
                  kind: "installed",
                  controlId: controlIdOf(entry.nextControl),
                }))
              : { kind: "rejected" as const, reason: "unexpected interaction control" };
        if (result.kind !== "installed" && result.kind !== "already-installed") {
          rollback();
          return null;
        }
        return rollback;
      };
      const commitEntry = (entry: CoopAuthorityEntry): CoopAuthorityEntry => {
        const { revision: _revision, ...body } = entry;
        return log.commit(body, prepareAndInstall);
      };
      const command = commandControl();
      const first = turnEntry(1, "command-open-1", command);
      expect(commitEntry(first)).toMatchObject({ revision: 1, operationId: first.operationId });

      const modalControl = wait("modal-result", null, ["TURN_COMMIT"]);
      const modalWait = turnEntry(2, "modal-result", modalControl);
      expect(commitEntry(modalWait)).toMatchObject({ revision: 2, operationId: modalWait.operationId });

      // Revision 3 deliberately reuses revision 1's exact COMMAND_FRONTIER address.
      const reopenedCommand = turnEntry(3, "command-open-2", command);
      expect(commitEntry(reopenedCommand)).toMatchObject({ revision: 3, operationId: reopenedCommand.operationId });

      const boundaryInput: Omit<CoopAuthorityEntry, "revision"> =
        boundaryKind === "wave"
          ? buildWaveAdvanceEntry({
              context: CONTEXT,
              operationId: "wave-boundary",
              transition: BOUNDARY_TRANSITION,
              destination: commandControl(6),
              subsumes: [1, 2, 3],
            })
          : buildTerminalCommitEntry({
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
            });

      // AuthorityLog admission supplies the exact retained proof; an unscoped direct ledger call is not
      // allowed to self-authenticate this boundary anymore.
      const boundary = log.commit(boundaryInput, prepareAndInstall);
      expect(boundary.revision).toBe(4);
      expect(ledger.authenticatedSourceCount).toBe(1);
      expect(ledger.sourceEntryOf(boundary.nextControl)).toMatchObject({
        revision: boundary.revision,
        operationId: boundary.operationId,
      });
    }
  });

  it("admits a replica boundary only after manifest -> exact sources -> complete and scopes one exact object", () => {
    const harness = replicaBoundaryHarness();
    const direct = structuredClone(harness.boundary);
    const emptyLedger = new CoopV2InteractionControlLedger();

    // Boundary kinds never self-authenticate, even when recovery left no active claim.
    expect(emptyLedger.admitSuccessor(harness.boundary)).toBe(false);
    expect(emptyLedger.admitSuccessor(direct)).toBe(false);
    expect(harness.ledger.admitSuccessor(harness.boundary)).toBe(false);

    const request = beginReplicaBoundaryProof(harness);
    expect(authorityEntryProofScopeOf(harness.boundary)).toBeNull();
    expect(harness.log.acceptBoundaryProofFrame(CONTEXT, boundaryProofBody(request, "manifest"))).toEqual({
      kind: "pending",
    });
    for (const source of harness.sources) {
      expect(harness.log.admit(source)).toEqual({ kind: "gap", missingFrom: request.missingFrom });
    }
    expect(authorityEntryProofScopeOf(harness.boundary)).toBeNull();
    expect(harness.log.acceptBoundaryProofFrame(CONTEXT, boundaryProofBody(request, "complete"))).toMatchObject({
      kind: "completed",
      candidate: harness.boundary,
    });
    expect(harness.log.admit(harness.boundary)).toEqual({ kind: "admitted" });

    const scope = authorityEntryProofScopeOf(harness.boundary);
    expect(scope).toMatchObject({
      kind: "replica-dense-frontier",
      source: harness.boundary,
      authenticatedThrough: 3,
    });
    if (scope?.kind !== "replica-dense-frontier") {
      throw new Error("replica boundary did not receive its exact proof scope");
    }
    expect(scope.trustedSources.map(source => source.revision)).toEqual([1, 2, 3]);
    expect(scope.authenticatedSources.map(source => source.revision)).toEqual([4]);

    // A byte-identical clone has no object capability; only the log-admitted object consumes the scope.
    expect(harness.ledger.admitSuccessor(direct)).toBe(false);
    expect(harness.ledger.admitSuccessor(harness.boundary)).toBe(true);
    expect(harness.ledger.registerEntry(harness.boundary)).toBe(true);
    expect(authorityEntryProofScopeOf(harness.boundary)).toBeNull();
    expect(harness.ledger.markMaterialApplied(harness.boundary)).toBe(true);

    // Scope consumption is one-shot: the stale admitted object cannot authorize another boundary transition.
    expect(harness.ledger.admitSuccessor(harness.boundary)).toBe(false);
  });

  it("cannot mint a replica proof for partial, unknown, duplicate, ranged, or predecessor-omitting subsumes", () => {
    const cases: readonly [string, readonly number[]][] = [
      ["partial", [1, 3]],
      ["ineligible/partial", [2, 3]],
      ["unknown", [1, 2, 3, 99]],
      ["duplicate", [1, 2, 3, 3]],
      ["out-of-range", [0, 1, 2, 3]],
      ["omitted-mandatory-predecessor", [1, 2]],
    ];
    for (const [label, subsumes] of cases) {
      const harness = replicaBoundaryHarness(subsumes);
      const first = harness.log.admit(harness.boundary);
      if (first.kind === "gap") {
        const request = harness.sent.at(-1);
        if (
          request?.kind !== "requestTail"
          || request.requestId == null
          || request.candidateRevision == null
          || request.candidateOperationId == null
        ) {
          throw new Error(`invalid ${label} boundary did not retain its correlated request`);
        }
        const correlated = request as ReplicaBoundaryRequest;
        expect(harness.log.acceptBoundaryProofFrame(CONTEXT, boundaryProofBody(correlated, "manifest")), label).toEqual(
          { kind: "pending" },
        );
        for (const source of harness.sources) {
          expect(harness.log.admit(source).kind, label).toBe("gap");
        }
        expect(
          harness.log.acceptBoundaryProofFrame(CONTEXT, boundaryProofBody(correlated, "complete")).kind,
          label,
        ).toBe("rejected");
      } else {
        expect(first.kind, label).toBe("rejected");
      }
      expect(authorityEntryProofScopeOf(harness.boundary), label).toBeNull();
      expect(harness.ledger.admitSuccessor(harness.boundary), label).toBe(false);
    }
  });

  it("restores a partial same-object admission when its proof is revoked, then reissues only that object", () => {
    const harness = replicaBoundaryHarness();
    completeReplicaBoundaryProof(harness);
    const predecessor = harness.sources.at(-1);
    if (predecessor == null) {
      throw new Error("replica rollback fixture has no predecessor");
    }
    const activeBefore = harness.ledger.activeControl;
    const sourceCountBefore = harness.ledger.authenticatedSourceCount;

    expect(harness.ledger.admitSuccessor(harness.boundary)).toBe(true);
    revokeAuthorityEntryProofScope(harness.boundary);
    expect(harness.ledger.admitSuccessor(harness.boundary)).toBe(false);

    // A same-entry retry without proof is a failed transaction, not permission to leave the predecessor
    // superseded after the callback lost its capability between admit and register.
    expect(harness.ledger.activeControl).toEqual(activeBefore);
    expect(harness.ledger.latestControl).toEqual(predecessor.nextControl);
    expect(harness.ledger.authenticatedSourceCount).toBe(sourceCountBefore);
    expect(harness.ledger.sourceEntryOf(predecessor.nextControl)).toMatchObject({
      revision: predecessor.revision,
      operationId: predecessor.operationId,
    });

    expect(harness.log.admit(harness.boundary)).toEqual({ kind: "duplicate-pending-material" });
    expect(harness.log.reissueReplicaEntryProof(harness.boundary)).toBe(true);
    expect(authorityEntryProofScopeOf(harness.boundary)).toMatchObject({ kind: "replica-dense-frontier" });
    expect(harness.ledger.admitSuccessor(harness.boundary)).toBe(true);
    expect(harness.ledger.registerEntry(harness.boundary)).toBe(true);
    expect(authorityEntryProofScopeOf(harness.boundary)).toBeNull();
    expect(harness.ledger.markMaterialApplied(harness.boundary)).toBe(true);
  });

  it("hot rejoin fences old-context frames and reissues proof only after a fresh exact capture", () => {
    const harness = replicaBoundaryHarness();
    const oldRequest = beginReplicaBoundaryProof(harness);
    completeReplicaBoundaryProof(harness, oldRequest);
    const oldEntry = harness.boundary;
    const oldScope = authorityEntryProofScopeOf(oldEntry);
    expect(oldScope).toMatchObject({ kind: "replica-dense-frontier" });

    const nextReplicaContext = { ...REPLICA_CONTEXT, membershipRevision: 2, connectionGeneration: 2 };
    const nextAuthorityContext = { ...CONTEXT, membershipRevision: 2, connectionGeneration: 2 };
    expect(harness.log.rebindConnection(nextReplicaContext, [{ seatId: 0, connectionGeneration: 2 }])).toBe(0);
    const freshRequest = harness.sent.at(-1);
    if (
      freshRequest?.kind !== "requestTail"
      || freshRequest.requestId == null
      || freshRequest.candidateRevision == null
      || freshRequest.candidateOperationId == null
    ) {
      throw new Error("hot rejoin did not issue a fresh correlated boundary request");
    }
    const correlated = freshRequest as ReplicaBoundaryRequest;
    expect(correlated.requestId).toBe(oldRequest.requestId);
    expect(correlated.context).not.toEqual(oldRequest.context);
    expect(correlated.context).toEqual(nextReplicaContext);
    expect(harness.log.admit(oldEntry)).toEqual({ kind: "rejected", reason: "membership-mismatch" });
    for (const oldSource of harness.sources) {
      expect(harness.log.admit(oldSource)).toEqual({ kind: "rejected", reason: "membership-mismatch" });
    }
    if (oldScope?.kind === "replica-dense-frontier") {
      expect(oldScope.isActive()).toBe(false);
    }
    expect(harness.ledger.admitSuccessor(oldEntry)).toBe(false);

    const reboundSources = harness.sources.map(source => ({ ...source, context: nextAuthorityContext }));
    const reboundEntry: CoopAuthorityEntry = { ...oldEntry, context: nextAuthorityContext };
    expect(
      harness.log.acceptBoundaryProofFrame(nextAuthorityContext, boundaryProofBody(correlated, "manifest")),
    ).toEqual({ kind: "pending" });
    for (const source of reboundSources) {
      expect(harness.log.admit(source)).toEqual({ kind: "gap", missingFrom: correlated.missingFrom });
    }
    expect(
      harness.log.acceptBoundaryProofFrame(nextAuthorityContext, boundaryProofBody(correlated, "complete")),
    ).toMatchObject({ kind: "completed", candidate: reboundEntry });
    expect(harness.log.admit(reboundEntry)).toEqual({ kind: "duplicate-pending-material" });
    expect(authorityEntryProofScopeOf(reboundEntry)).toBeNull();
    expect(harness.log.reissueReplicaEntryProof(reboundEntry)).toBe(true);
    expect(authorityEntryProofScopeOf(reboundEntry)).toMatchObject({
      kind: "replica-dense-frontier",
      authenticatedThrough: 3,
    });
    expect(harness.ledger.admitSuccessor(reboundEntry)).toBe(true);
    expect(harness.ledger.registerEntry(reboundEntry)).toBe(true);
    expect(authorityEntryProofScopeOf(reboundEntry)).toBeNull();
    expect(harness.ledger.markMaterialApplied(reboundEntry)).toBe(true);
  });

  it("refuses terminal-after-terminal before any replica proof can mint", () => {
    const log = new AuthorityLog({
      localContext: REPLICA_CONTEXT,
      scheduler: REPLICA_SCHEDULER,
      send: () => {},
      peerBindings: [{ seatId: 0, connectionGeneration: CONTEXT.connectionGeneration }],
    });
    const ledger = new CoopV2InteractionControlLedger();
    const first: CoopAuthorityEntry = {
      ...buildTerminalCommitEntry({
        context: CONTEXT,
        operationId: "replica-terminal-first",
        terminal: {
          kind: "terminal",
          terminalId: "replica-terminal-first",
          reason: "game-over",
          wave: 5,
          turn: 1,
        },
      }),
      revision: 1,
    };
    const firstControl = first.nextControl;
    if (firstControl.kind !== "TERMINAL") {
      throw new Error("terminal fixture lost its terminal control");
    }
    expect(log.admit(first)).toEqual({ kind: "admitted" });
    expect(authorityEntryProofScopeOf(first)).toMatchObject({ source: first });
    expect(ledger.admitSuccessor(first)).toBe(true);
    expect(ledger.registerEntry(first)).toBe(true);
    expect(ledger.markMaterialApplied(first)).toBe(true);
    expect(
      ledger.projectMechanical(firstControl, () => ({
        kind: "installed",
        controlId: controlIdOf(firstControl),
      })),
    ).toMatchObject({ kind: "installed" });
    expect(log.recordReplicaStage(first, "materialApplied")).toBe(true);
    expect(log.recordReplicaStage(first, "controlInstalled")).toBe(true);

    const second: CoopAuthorityEntry = {
      ...buildTerminalCommitEntry({
        context: CONTEXT,
        operationId: "replica-terminal-second",
        terminal: {
          kind: "terminal",
          terminalId: "replica-terminal-second",
          reason: "shared-fault",
          wave: 6,
          turn: 1,
        },
        subsumes: [1],
      }),
      revision: 2,
    };
    expect(log.admit(second)).toEqual({ kind: "rejected", reason: "predecessor-control-mismatch" });
    expect(authorityEntryProofScopeOf(second)).toBeNull();
    expect(ledger.admitSuccessor(second)).toBe(false);
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
    const authority = new AuthorityLog({
      localContext: CONTEXT,
      scheduler: REPLICA_SCHEDULER,
      send: () => {},
      peerBindings: [{ seatId: 1, connectionGeneration: REPLICA_CONTEXT.connectionGeneration }],
    });
    const destination = wait("rollback-boundary", null, ["TURN_COMMIT"]);
    const blocker = authority.commit(turnEntry(1, "rollback-boundary", destination));

    // A non-boundary source can legally own this exact wait address without a boundary proof. Install it so
    // its dense TURN successor is also legal, while retaining the claim that the later boundary must collide.
    expect(blocker.revision).toBe(1);
    expect(ledger.registerEntry(blocker)).toBe(true);
    expect(ledger.markMaterialApplied(blocker)).toBe(true);
    expect(ledger.project(destination, null)).toMatchObject({
      kind: "installed",
      controlId: controlIdOf(destination),
    });
    expect(ledger.sourceEntryOf(destination)).toMatchObject({
      revision: blocker.revision,
      operationId: blocker.operationId,
    });

    const predecessorControl = shared("rollback-predecessor-surface");
    const predecessor = authority.commit(turnEntry(2, "uninstalled-predecessor", predecessorControl));
    expect(predecessor.revision).toBe(blocker.revision + 1);
    expect(ledger.registerEntry(predecessor)).toBe(true);
    expect(ledger.markMaterialApplied(predecessor)).toBe(true);
    const waiterToken = {};
    expect(
      ledger.projectAuthorityProposalWait(
        predecessorControl,
        proposalWait({ controlOperationId: predecessorControl.operationId, waiterToken }),
        0,
      ),
    ).toMatchObject({ kind: "installed", controlId: controlIdOf(predecessorControl) });
    expect(ledger.revokeAuthorityProposalWait(predecessorControl, waiterToken)).toBe(true);
    expect(ledger.activeControl).toBeNull();

    const authenticatedSourceCountBeforeCollision = ledger.authenticatedSourceCount;
    const blockerSourceBeforeCollision = ledger.sourceEntryOf(destination);
    const predecessorSourceBeforeCollision = ledger.sourceEntryOf(predecessorControl);
    const reservations: ((() => void) | null)[] = [];
    let prepareCalls = 0;
    const firstAttempt = authority.commitDetailed(
      buildWaveAdvanceEntry({
        context: CONTEXT,
        operationId: "rollback-boundary",
        transition: BOUNDARY_TRANSITION,
        destination,
        subsumes: [blocker.revision, predecessor.revision],
      }),
      entry => {
        prepareCalls += 1;
        const proof = authorityEntryProofScopeOf(entry);
        expect(proof?.kind).toBe("authority-retained");
        if (proof?.kind === "authority-retained") {
          expect(proof.boundarySources).toEqual([blocker, predecessor]);
        }
        expect(controlIdOf(entry.nextControl)).toBe(controlIdOf(blocker.nextControl));
        const reservation = ledger.prepareAuthorityEntry(entry);
        reservations.push(reservation);
        return reservation;
      },
    );
    expect(firstAttempt.kind).toBe("deferred");
    if (firstAttempt.kind !== "deferred") {
      throw new Error("destination collision did not defer the exact boundary");
    }
    const boundary = firstAttempt.entry;
    expect(boundary.revision).toBe(predecessor.revision + 1);
    expect(prepareCalls).toBe(1);
    expect(reservations).toEqual([null]);
    expect(authorityEntryProofScopeOf(boundary)).toBeNull();

    // The predecessor was materially reserved but never projected; rollback must leave it in exactly that
    // state, preserve the blocker, and remove every partially reconciled boundary source/claim.
    expect(ledger.authenticatedSourceCount).toBe(authenticatedSourceCountBeforeCollision);
    expect(ledger.latestControl).toEqual(predecessorControl);
    expect(ledger.activeControl).toBeNull();
    expect(ledger.isMaterialApplied(destination)).toBe(true);
    expect(ledger.isMaterialApplied(predecessorControl)).toBe(true);
    expect(ledger.sourceEntryOf(destination)).toEqual(blockerSourceBeforeCollision);
    expect(ledger.sourceEntryOf(predecessorControl)).toEqual(predecessorSourceBeforeCollision);

    // A validated recovery removes the stale address owner while restoring the same uninstalled predecessor.
    // The authority's exact pending body then retries at the same revision and completes its reservation.
    expect(ledger.adoptRecoveryFrontier(predecessor)).toBe(true);
    expect(ledger.activeControl).toBeNull();
    expect(ledger.latestControl).toEqual(predecessorControl);
    expect(ledger.sourceEntryOf(destination)).toBeNull();
    const retry = authority.retryDeferredCommit(boundary.operationId);
    expect(retry.kind).toBe("committed");
    if (retry.kind !== "committed") {
      throw new Error("legal boundary retry did not commit after the address collision cleared");
    }
    expect(retry.entry).toBe(boundary);
    expect(prepareCalls).toBe(2);
    expect(reservations[0]).toBeNull();
    expect(reservations[1]).not.toBeNull();
    expect(ledger.sourceEntryOf(destination)).toMatchObject({
      revision: boundary.revision,
      operationId: boundary.operationId,
    });
    expect(ledger.isMaterialApplied(destination)).toBe(true);
    expect(ledger.latestControl).toEqual(destination);
    expect(ledger.activeControl).toBeNull();
    authority.dispose("destination collision fixture complete");
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
