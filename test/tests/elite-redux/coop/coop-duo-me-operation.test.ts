/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op MYSTERY ENCOUNTERS through the AUTHORITATIVE OPERATION PRIMITIVE
// (Wave-2c run-state migration; docs/plans/2026-07-10-coop-authoritative-run-state-migration.md
// §2.5 item 2, §5.1/§5.3). The migrated-path proof obligation:
//
//   1. END-TO-END, all THREE authoritative ME legs (flag ON): a full ME each of
//      - HOST-OWNED non-battle (DEPARTMENT_STORE_SALE): the guest's terminal is gated through
//        the operation primitive and adopts a host-stated terminal "leave".
//      - GUEST-OWNED non-battle (DEPARTMENT_STORE_SALE, odd counter): the guest mints an
//        ME_PICK intent; the HOST commits it (invariant 3).
//      - BATTLE-HANDOFF (FIGHT_OR_FLIGHT opt 1): the committed terminal STATES "battle" BEFORE
//        the guest builds its ME-battle phases - the #859/#860 phantom-turn structural cure.
//   2. ADVERSARIAL (engine-free, deterministic): a STALE decision from a PREVIOUS ME is REJECTED
//      (invariant 6, the #861 shape); a DUPLICATE re-delivery of an applied op is a no-op
//      (invariant 5); a LATE terminal arriving after the ME already terminal-adopted is dropped.
//   3. #859-SHAPE (engine-free): when the committed op states a NON-battle terminal, the watcher's
//      derived terminal is "leave" (it never routes to finishWithoutLeaving / builds the phantom
//      battle chain); a stale battle-handoff from an earlier ME is REJECTED, so it can never build
//      the phantom either. The type is stated by the OPERATION before any phase is constructed.
//
// The operation-gating (2/3) is ITSELF proof the primitive is active: with the flag OFF the
// watcher adopts the relayed sentinel verbatim (legacy pass-through). The companion duo suites
// (coop-duo-mystery, coop-duo-me-*) prove the surface stays green under BOTH flag states; this
// suite proves the NEW behavior the flag turns on.
//
// HOW TO RUN (gated ER_SCENARIO=1):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-me-operation.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import type { CoopAuthorityEntry, CoopFrameContextV2 } from "#data/elite-redux/coop/authority-v2/contract";
import {
  COOP_FRAME_PROTOCOL_VERSION,
  type CoopFrameV2,
  encodeFrameV2,
} from "#data/elite-redux/coop/authority-v2/frame-codec";
import {
  CoopAuthorityV2Shadow,
  type CoopV2ShadowIdentity,
} from "#data/elite-redux/coop/authority-v2/shadow";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import * as meOp from "#data/elite-redux/coop/coop-me-operation";
import {
  isCoopMeOperationEnabled,
  resetCoopMeOperationFlag,
  resetCoopMeOperationState,
  setCoopMeOperationEnabled,
} from "#data/elite-redux/coop/coop-me-operation";
import {
  captureCoopActiveMysteryControl,
  coopMeInteractionStartValue,
  setCoopMeInteractionStart,
} from "#data/elite-redux/coop/coop-me-pin-state";
import { COOP_ME_BATTLE_HANDOFF } from "#data/elite-redux/coop/coop-me-pump";
import {
  COOP_ME_BATTLE_SETTLED_CHOICE,
  COOP_ME_REWARD_SETTLED_CHOICE,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  isCoopOperationJournalActive,
  setCoopOperationDurability,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  CoopOperationHost,
  createCoopRuntimeOpState,
  setActiveCoopRuntimeOpState,
  withActiveCoopRuntimeOpState,
} from "#data/elite-redux/coop/coop-operation-runtime";
import {
  type CoopRuntime,
  assembleCoopRuntime,
  clearCoopRuntime,
  commitCoopMeBattleSettlementAtBattleEnd,
  commitCoopMeNoBattleRewardSettlementAfterPreparation,
  coopSessionGeneration,
  coopMeOwnerRelayBattleHandoff,
  coopHostStreamMeMessage,
  failCoopSharedSession,
  getCoopRuntime,
  getCoopV2Shadow,
  isCoopSharedTerminalFrozen,
  registerCoopMeTerminalRedrive,
  settleCoopV2InteractionOperation,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import {
  type CoopAccountIdentityV1,
  type CoopFrameContextV1,
  type CoopP33AuthenticatedContextV1,
  type CoopSessionBindingV1,
  createFreshCoopP33Context,
} from "#data/elite-redux/coop/coop-session-binding";
import { COOP_PROTOCOL_VERSION, type CoopMessage, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { type CoopWireChannel, WebRtcTransport } from "#data/elite-redux/coop/coop-webrtc-transport";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { ColosseumChoicePhase } from "#phases/colosseum-choice-phase";
import { FaintPhase } from "#phases/faint-phase";
import { MysteryEncounterBattlePhase } from "#phases/mystery-encounter-phases";
import { VictoryPhase } from "#phases/victory-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  awaitRewardShopPhaseExit,
  buildDuoForMe,
  drainGuestMeReplayToSettle,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestMeReplay,
  driveHostMeRewardShopWithGuestReplay,
  installDuoLogCapture,
  relayGuestMeOptionIndexOnly,
  relayGuestMeShopLeaveSync,
  type ShopPhaseSeam,
  settleDuoPromise,
  startGuestMeOutcomeRace,
  startGuestMeReplay,
  startGuestMeShopOwner,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { runMysteryEncounterToEnd, runSelectMysteryEncounterOption } from "#test/utils/encounter-test-utils";
import { ColosseumUiHandler } from "#ui/colosseum-ui-handler";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A valid ME wave (WILD, non-boss, in [10,180], waveIndex % 10 != 1). */
const ME_WAVE = 12;

const ME_REJOIN_AUTHORITY: CoopAccountIdentityV1 = {
  version: 1,
  accountId: "er-account:me-authority",
  displayName: "ME Authority",
  canonicalUsername: "me-authority",
};

const ME_REJOIN_REPLICA: CoopAccountIdentityV1 = {
  version: 1,
  accountId: "er-account:me-replica",
  displayName: "ME Replica",
  canonicalUsername: "me-replica",
};

/** Minimal cross-wired channel used by the production WebRtcTransport hot-rejoin adapter. */
class MeHotRejoinWire implements CoopWireChannel {
  readyState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: MeHotRejoinWire | null = null;
  private messageHandler: ((data: string) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  send(data: string): void {
    if (this.readyState !== "open" || this.peer?.readyState !== "open") {
      return;
    }
    this.peer.messageHandler?.(data);
  }

  close(): void {
    if (this.readyState === "closed") {
      return;
    }
    this.readyState = "closed";
    this.closeHandler?.();
    if (this.peer != null && this.peer.readyState !== "closed") {
      this.peer.readyState = "closed";
      this.peer.closeHandler?.();
    }
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onOpen(_handler: () => void): void {
    // Replacement wires are already open, matching the proven WebRtcTransport hot-rejoin fixture.
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  onBufferedAmountLow(_handler: () => void): void {
    // This narrow fixture never applies backpressure.
  }

  injectRaw(data: string): void {
    this.messageHandler?.(data);
  }
}

function linkedMeHotRejoinWires(): { authority: MeHotRejoinWire; replica: MeHotRejoinWire } {
  const authority = new MeHotRejoinWire();
  const replica = new MeHotRejoinWire();
  authority.peer = replica;
  replica.peer = authority;
  return { authority, replica };
}

function meAuthorityEntryFrame(entry: CoopAuthorityEntry): Extract<CoopFrameV2, { t: "authorityEntry" }> {
  const { context, ...body } = entry;
  return { v: COOP_FRAME_PROTOCOL_VERSION, t: "authorityEntry", ctx: context, body };
}

function meReplicaShadowIdentity(
  authorityFrame: CoopFrameContextV2,
  replicaConnectionGeneration: number,
): CoopV2ShadowIdentity {
  return {
    runtimeId: `${authorityFrame.sessionId}:me-terminal-replica`,
    sessionId: authorityFrame.sessionId,
    runId: authorityFrame.runId,
    epoch: authorityFrame.sessionEpoch,
    localSeatId: 1,
    authoritySeatId: authorityFrame.authoritySeatId,
    membershipRevision: authorityFrame.membershipRevision,
    seatMapId: authorityFrame.seatMapId,
    connectionGeneration: replicaConnectionGeneration,
    peerBindings: [
      {
        seatId: authorityFrame.authoritySeatId,
        connectionGeneration: authorityFrame.connectionGeneration,
      },
    ],
  };
}

function meHotRejoinContext(
  connectionGeneration: number,
  peerConnectionGeneration: number,
  bearer: string,
): CoopP33AuthenticatedContextV1 {
  const context = createFreshCoopP33Context({
    pairingId: "ME_TERMINAL_REJOIN",
    pairingBearer: bearer,
    transportRole: "answerer",
    account: ME_REJOIN_AUTHORITY,
    peerAccount: ME_REJOIN_REPLICA,
    connectionGeneration,
    peerConnectionGeneration,
  });
  if (context == null) {
    throw new Error("authenticated ME hot-rejoin context was rejected");
  }
  return context;
}

async function waitForCoopMessage<T extends CoopMessage>(
  received: readonly CoopMessage[],
  predicate: (message: CoopMessage) => message is T,
  label: string,
): Promise<T> {
  let found: T | undefined;
  await vi.waitFor(
    () => {
      found = received.find(predicate);
      expect(found, label).toBeDefined();
    },
    { timeout: 2_000, interval: 10 },
  );
  return found!;
}

interface AuthenticatedMeRuntimeFixture {
  readonly runtime: CoopRuntime;
  readonly localTransport: WebRtcTransport;
  readonly peerTransport: WebRtcTransport;
  readonly replicaShadow: CoopAuthorityV2Shadow;
  readonly initialContext: CoopP33AuthenticatedContextV1;
  readonly initialAuthorityWire: MeHotRejoinWire;
  readonly initialReplicaWire: MeHotRejoinWire;
  readonly received: CoopMessage[];
  readonly capabilities: readonly string[];
  readonly binding: CoopSessionBindingV1;
}

async function assembleAuthenticatedMeRuntime(scene: BattleScene): Promise<AuthenticatedMeRuntimeFixture> {
  const initialContext = meHotRejoinContext(0, 0, "A".repeat(43));
  const wires = linkedMeHotRejoinWires();
  const localTransport = new WebRtcTransport("host", wires.authority, initialContext.connectionGeneration);
  const peerTransport = new WebRtcTransport("guest", wires.replica, initialContext.peerConnectionGeneration);
  const received: CoopMessage[] = [];
  peerTransport.onMessage(message => received.push(message));
  const runtime = assembleCoopRuntime(localTransport, {
    username: initialContext.account.displayName,
    netcodeMode: "authoritative",
    p33: initialContext,
  });
  setCoopRuntime(runtime);
  runtime.controller.connect();

  const hello = await waitForCoopMessage(
    received,
    (message): message is Extract<CoopMessage, { t: "hello" }> => message.t === "hello",
    "the authority advertised its authenticated capability hello",
  );
  const fingerprint = await waitForCoopMessage(
    received,
    (message): message is Extract<CoopMessage, { t: "dataFingerprint" }> => message.t === "dataFingerprint",
    "the authority advertised its functional fingerprint",
  );
  const capabilities = [...(hello.capabilities ?? [])];
  peerTransport.send({
    t: "hello",
    version: COOP_PROTOCOL_VERSION,
    pairingId: initialContext.pairingId,
    account: initialContext.peerAccount,
    transportRole: "offerer",
    authorityClaim: "replica",
    capabilities,
  });
  peerTransport.send({ t: "dataFingerprint", fp: fingerprint.fp });
  await Promise.resolve();

  const startPromise = runtime.controller.sendResumeStartNew(2_000);
  const start = await waitForCoopMessage(
    received,
    (message): message is Extract<CoopMessage, { t: "resumeStartNew" }> => message.t === "resumeStartNew",
    "the authority committed the fresh authenticated run",
  );
  peerTransport.send({ t: "resumeDecisionAck", decisionId: start.decisionId });
  const bindingMessage = await waitForCoopMessage(
    received,
    (message): message is Extract<CoopMessage, { t: "sessionBinding" }> => message.t === "sessionBinding",
    "the authority published the authenticated seat binding",
  );
  peerTransport.send({
    t: "sessionBindingAck",
    bindingId: bindingMessage.binding.bindingId,
    seatId: 1,
    accountId: initialContext.peerAccount.accountId,
    accepted: true,
  });
  await expect(startPromise).resolves.toBe(true);
  await vi.waitFor(() => expect(runtime.controller.p33FrameContext()).not.toBeNull(), {
    timeout: 2_000,
    interval: 10,
  });
  expect(runtime.controller.authorityRole).toBe("authority");
  const authorityShadow = getCoopV2Shadow(runtime);
  expect(authorityShadow, "binding-ready installed the production Authority V2 shadow").not.toBeNull();
  const replicaShadow = new CoopAuthorityV2Shadow({
    identity: meReplicaShadowIdentity(
      authorityShadow!.authenticatedFrameContext,
      initialContext.peerConnectionGeneration,
    ),
    scene,
    transport: peerTransport,
    send: frame => peerTransport.send(frame),
  });

  return {
    runtime,
    localTransport,
    peerTransport,
    replicaShadow,
    initialContext,
    initialAuthorityWire: wires.authority,
    initialReplicaWire: wires.replica,
    received,
    capabilities,
    binding: bindingMessage.binding,
  };
}

interface AuthenticatedHotRejoin {
  readonly nextContext: CoopP33AuthenticatedContextV1;
  readonly replacementReady: Promise<{ authority: MeHotRejoinWire; replica: MeHotRejoinWire }>;
  readonly driverCompleted: Promise<void>;
  allowBinding(): void;
}

function beginAuthenticatedMeHotRejoin(fixture: AuthenticatedMeRuntimeFixture): AuthenticatedHotRejoin {
  const { runtime, localTransport, peerTransport, initialAuthorityWire, binding, capabilities, received } = fixture;
  const nextContext = meHotRejoinContext(1, 1, "B".repeat(43));
  let releaseBinding!: () => void;
  const bindingGate = new Promise<void>(resolve => {
    releaseBinding = resolve;
  });
  let resolveReplacement!: (wires: { authority: MeHotRejoinWire; replica: MeHotRejoinWire }) => void;
  let rejectReplacement!: (error: unknown) => void;
  const replacementReady = new Promise<{ authority: MeHotRejoinWire; replica: MeHotRejoinWire }>(
    (resolve, reject) => {
      resolveReplacement = resolve;
      rejectReplacement = reject;
    },
  );
  let resolveDriver!: () => void;
  let rejectDriver!: (error: unknown) => void;
  const driverCompleted = new Promise<void>((resolve, reject) => {
    resolveDriver = resolve;
    rejectDriver = reject;
  });

  received.length = 0;
  runtime.rejoinDriver = async () => {
    try {
      // The signaling Worker is the one external seam. Feed its already-authenticated replacement context
      // through the exact production order from coop-webrtc-connect: adopt first, then replace the live wire.
      if (!runtime.controller.adoptP33Rejoin(nextContext)) {
        throw new Error("production controller refused the authenticated ME hot rejoin");
      }
      const replacement = linkedMeHotRejoinWires();
      peerTransport.replaceChannel(replacement.replica);
      localTransport.replaceChannel(replacement.authority);
      resolveReplacement(replacement);
      await bindingGate;

      peerTransport.send({
        t: "hello",
        version: COOP_PROTOCOL_VERSION,
        pairingId: nextContext.pairingId,
        account: nextContext.peerAccount,
        transportRole: "offerer",
        authorityClaim: "replica",
        capabilities: [...capabilities],
        existingBinding: {
          sessionId: binding.sessionId,
          ...(binding.runId == null ? {} : { runId: binding.runId }),
          sessionEpoch: binding.sessionEpoch,
          seatMapId: binding.seatMap.seatMapId,
          authoritySeatId: binding.authoritySeatId,
          membershipRevision: binding.membershipRevision,
        },
      });
      const reboundBinding = await waitForCoopMessage(
        received,
        (message): message is Extract<CoopMessage, { t: "sessionBinding" }> => message.t === "sessionBinding",
        "the replacement channel replayed the retained authenticated binding",
      );
      peerTransport.send({
        t: "sessionBindingAck",
        bindingId: reboundBinding.binding.bindingId,
        seatId: 1,
        accountId: nextContext.peerAccount.accountId,
        accepted: true,
      });
      await vi.waitFor(
        () => {
          expect(runtime.controller.p33FrameContext()).toMatchObject({
            membershipRevision: binding.membershipRevision + 1,
            connectionGeneration: nextContext.connectionGeneration,
          });
        },
        { timeout: 2_000, interval: 10 },
      );
      resolveDriver();
      return true;
    } catch (error) {
      rejectReplacement(error);
      rejectDriver(error);
      throw error;
    }
  };
  initialAuthorityWire.close();

  return {
    nextContext,
    replacementReady,
    driverCompleted,
    allowBinding: releaseBinding,
  };
}

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** Read the typed ME_TERMINAL discriminator without treating a raw/legacy carrier as Authority V2 proof. */
function authorityMeTerminalKind(entry: {
  readonly kind?: unknown;
  readonly material?: { readonly payload?: unknown };
}): string | null {
  if (entry.kind !== "INTERACTION_COMMIT") {
    return null;
  }
  const material = entry.material?.payload;
  if (material == null || typeof material !== "object" || Array.isArray(material)) {
    return null;
  }
  const envelope = (material as { readonly envelope?: unknown }).envelope;
  if (envelope == null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return null;
  }
  const pendingOperation = (envelope as { readonly pendingOperation?: unknown }).pendingOperation;
  if (pendingOperation == null || typeof pendingOperation !== "object" || Array.isArray(pendingOperation)) {
    return null;
  }
  const pending = pendingOperation as {
    readonly kind?: unknown;
    readonly payload?: unknown;
  };
  if (pending.kind !== "ME_TERMINAL" || pending.payload == null || typeof pending.payload !== "object") {
    return null;
  }
  const terminal = (pending.payload as { readonly terminal?: unknown }).terminal;
  return typeof terminal === "string" ? terminal : null;
}

describe.skipIf(!RUN)("co-op DUO mystery encounter via the operation primitive (Wave-2c)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  async function prepareBattleSettledHandoffBoundary() {
    await game.runToMysteryEncounter(MysteryEncounterType.FIGHT_OR_FLIGHT, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    await withClient(rig.hostCtx, async () => {
      await runSelectMysteryEncounterOption(game, 1);
      await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
      expect(captureCoopActiveMysteryControl()).toMatchObject({ terminal: "battle", terminalStep: 0 });
      const tail = vi.fn();
      expect(
        commitCoopMeBattleSettlementAtBattleEnd(
          {
            result: "victory",
            continuation: "encounter",
            trainerVictory: false,
            rewardSurfaces: [],
            eggLapse: false,
          },
          tail,
        ),
      ).toBe(true);
      await vi.waitFor(() => expect(tail).toHaveBeenCalledTimes(1), { timeout: 2_000, interval: 10 });
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
      expect(captureCoopActiveMysteryControl()).toMatchObject({ terminal: "battle-settled", terminalStep: 1 });
    });
    return { hostScene, rig };
  }

  interface BattleSettledHandoffBoundary {
    readonly hostScene: BattleScene;
    readonly rig: { readonly hostRuntime: CoopRuntime };
  }

  async function prepareAuthenticatedBattleSettledHandoffBoundary() {
    await game.runToMysteryEncounter(MysteryEncounterType.FIGHT_OR_FLIGHT, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    toCoop(hostScene);
    const authenticated = await assembleAuthenticatedMeRuntime(hostScene);
    await runSelectMysteryEncounterOption(game, 1);
    await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
    expect(captureCoopActiveMysteryControl()).toMatchObject({ terminal: "battle", terminalStep: 0 });
    const tail = vi.fn();
    expect(
      commitCoopMeBattleSettlementAtBattleEnd(
        {
          result: "victory",
          continuation: "encounter",
          trainerVictory: false,
          rewardSurfaces: [],
          eggLapse: false,
        },
        tail,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(tail).toHaveBeenCalledOnce(), { timeout: 2_000, interval: 10 });
    expect(captureCoopActiveMysteryControl()).toMatchObject({ terminal: "battle-settled", terminalStep: 1 });
    return { hostScene, rig: { hostRuntime: authenticated.runtime }, authenticated };
  }

  async function parkSecondHandoff(boundary: BattleSettledHandoffBoundary) {
    const { hostScene, rig } = boundary;
    let blocked = true;
    let exactDeferredEntry: CoopAuthorityEntry | null = null;
    const originalPrepare = rig.hostRuntime.v2ControlLedger.prepareAuthorityEntry.bind(
      rig.hostRuntime.v2ControlLedger,
    );
    vi.spyOn(rig.hostRuntime.v2ControlLedger, "prepareAuthorityEntry").mockImplementation(entry => {
      if (blocked && authorityMeTerminalKind(entry) === "battle") {
        exactDeferredEntry = structuredClone(entry);
        return null;
      }
      return originalPrepare(entry);
    });
    const rawHandoff = vi.spyOn(rig.hostRuntime.mePump, "relayMeBattleHandoff");
    const priorControl = captureCoopActiveMysteryControl();
    expect(priorControl).toMatchObject({ terminal: "battle-settled", terminalStep: 1 });
    let resolutionCount = 0;
    let promiseSettled = false;
    const promise = coopMeOwnerRelayBattleHandoff({
      encounterMode: hostScene.currentBattle.mysteryEncounter?.encounterMode,
      disableSwitch: false,
    });
    void promise.then(() => {
      resolutionCount++;
      promiseSettled = true;
    });
    await vi.waitFor(() => expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).not.toBeNull(), {
      timeout: 2_000,
      interval: 10,
    });
    const parked = rig.hostRuntime.v2DeferredMeTerminalRedrive!;
    const immutable = JSON.stringify(parked);
    const retained = meOp.captureCoopMeDeferredTerminal(parked.operationId);
    expect(retained?.operationId).toBe(parked.operationId);
    expect(retained?.revision).toBe(parked.revision);
    expect(JSON.stringify(retained?.envelope)).toBe(JSON.stringify(parked.envelope));
    expect(exactDeferredEntry, "the parked terminal retained its exact withheld Authority V2 entry").toMatchObject({
      revision: parked.revision,
      operationId: parked.operationId,
      kind: "INTERACTION_COMMIT",
    });
    await Promise.resolve();
    expect(rawHandoff, "raw relay stays behind the exact proof").not.toHaveBeenCalled();
    expect(promiseSettled, "the owner handoff Promise remains parked").toBe(false);
    expect(JSON.stringify(rig.hostRuntime.v2DeferredMeTerminalRedrive)).toBe(immutable);
    return {
      immutable,
      exactDeferredEntry: exactDeferredEntry!,
      parked,
      priorControl,
      promise,
      promiseSettled: () => promiseSettled,
      rawHandoff,
      releaseProof: () => {
        blocked = false;
      },
      resolutionCount: () => resolutionCount,
    };
  }

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`me-op-${Date.now()}`);
    // Direct operation-seam assertions below intentionally run without assembling a transport runtime.
    // Install the same per-runtime operation state production assembly provides so fail-loud runtime
    // isolation remains part of the contract instead of falling back to process-global state.
    setActiveCoopRuntimeOpState(createCoopRuntimeOpState());
    // Explicitly select the MIGRATED path from clean operation state (no leftover from a prior file).
    setCoopMeOperationEnabled(true);
    resetCoopMeOperationState();
    game.override
      .battleStyle("double")
      .startingWave(ME_WAVE)
      .mysteryEncounterChance(100)
      .startingLevel(50)
      .disableTrainerWaves();
  });

  afterEach(() => {
    resetCoopMeOperationFlag();
    resetCoopMeOperationState();
    logs.dispose();
    clearCoopRuntime();
    setActiveCoopRuntimeOpState(null);
    vi.restoreAllMocks();
    // #710 harness-citizenship: buildDuoForMe builds a 2nd BattleScene (the guest) whose ctor steals
    // globalScene. Restore the host GameManager scene for the NEXT ER_SCENARIO file's GameManager.
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  // =====================================================================================
  // LEG 1 - HOST-OWNED non-battle ME: the guest's terminal is gated through the operation
  // primitive and adopts a host-stated terminal "leave".
  // =====================================================================================
  it("LEG 1 (host-owned non-battle): the guest adopts the ME terminal THROUGH the operation primitive (terminal 'leave')", async () => {
    expect(isCoopMeOperationEnabled(), "the migrated ME-operation path is active for this test").toBe(true);

    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    expect(hostScene.currentBattle.battleType, "host reached a MYSTERY_ENCOUNTER wave").toBe(
      BattleType.MYSTERY_ENCOUNTER,
    );

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore, "the ME opens on interaction counter 0 (host owns even)").toBe(0);

    const submitSpy = vi.spyOn(CoopOperationHost.prototype, "submit");
    const applyOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");
    let blockRewardSettlement = true;
    const originalPrepare = rig.hostRuntime.v2ControlLedger.prepareAuthorityEntry.bind(
      rig.hostRuntime.v2ControlLedger,
    );
    vi.spyOn(rig.hostRuntime.v2ControlLedger, "prepareAuthorityEntry").mockImplementation(entry => {
      if (blockRewardSettlement && authorityMeTerminalKind(entry) === "reward-settled") {
        return null;
      }
      return originalPrepare(entry);
    });

    // Drive the HOST through the option, then stop before the real reward phase starts. The typed
    // predecessor-control gate must park the exact reward-settled transaction instead of opening the
    // picker or ending the owning phase.
    let guestReplayPhase!: Phase;
    await withClient(rig.hostCtx, async () => {
      await runSelectMysteryEncounterOption(game, 1);
      game.onNextPrompt(
        "MysteryEncounterOptionSelectedPhase",
        UiMode.MESSAGE,
        () => {
          hostScene.ui.getMessageHandler().processInput(Button.ACTION);
        },
        () => game.isCurrentPhase("MysteryEncounterRewardsPhase"),
      );
      await game.phaseInterceptor.to("MysteryEncounterRewardsPhase", false);
      const rewards = hostScene.phaseManager.getCurrentPhase();
      expect(rewards?.phaseName, "host reached the automatic-preparation reward boundary").toBe(
        "MysteryEncounterRewardsPhase",
      );
      const rewardsEnd = vi.spyOn(rewards!, "end");
      rewards!.start();
      await vi.waitFor(() => expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).not.toBeNull(), {
        timeout: 2_000,
        interval: 10,
      });

      const parked = rig.hostRuntime.v2DeferredMeTerminalRedrive;
      expect(parked, "typed predecessor control parks the no-battle ME terminal").not.toBeNull();
      expect(parked?.envelope.pendingOperation?.kind).toBe("ME_TERMINAL");
      expect(
        (parked?.envelope.pendingOperation?.payload as { readonly terminal?: string } | undefined)?.terminal,
      ).toBe("reward-settled");
      expect(rewardsEnd, "the owning reward phase remains current before the V2 proof edge").not.toHaveBeenCalled();
      expect(hostScene.phaseManager.getCurrentPhase(), "the reward phase does not progress while parked").toBe(
        rewards,
      );
      expect(hostScene.phaseManager.getQueuedPhaseNames(), "no picker or post-ME tail opens while parked").not.toContain(
        "SelectModifierPhase",
      );

      const parkedOperationId = parked!.operationId;
      const parkedRevision = parked!.revision;
      const parkedEnvelope = JSON.stringify(parked!.envelope);
      const capturedDeferred = meOp.captureCoopMeDeferredTerminal(parkedOperationId);
      expect(capturedDeferred?.operationId).toBe(parkedOperationId);
      expect(capturedDeferred?.revision).toBe(parkedRevision);
      expect(JSON.stringify(capturedDeferred?.envelope)).toBe(parkedEnvelope);

      // A second owner must not replace the first phase/promise callback, even when it registers the
      // same immutable operation. The original parked record stays live for the proof edge.
      const duplicateRegistrationCancel = vi.fn();
      expect(
        registerCoopMeTerminalRedrive(rig.hostRuntime, parkedOperationId, vi.fn(), duplicateRegistrationCancel),
      ).toBeNull();
      expect(
        duplicateRegistrationCancel,
        "duplicate register attempts cancel only their new callback",
      ).toHaveBeenCalledOnce();
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive?.operationId).toBe(parkedOperationId);

      blockRewardSettlement = false;
      expect(settleCoopV2InteractionOperation(parkedOperationId, rig.hostRuntime)).toBe(true);
      await vi.waitFor(() => expect(rewardsEnd).toHaveBeenCalledTimes(1), { timeout: 2_000, interval: 10 });
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive, "the exact parked state releases after commit").toBeNull();
      expect(rewardsEnd, "the deferred reward tail resumes exactly once after commit").toHaveBeenCalledTimes(1);
      expect(meOp.captureCoopMeDeferredTerminal(parkedOperationId), "retained deferred state releases once").toBeNull();
      expect(captureCoopActiveMysteryControl()).toMatchObject({
        interactionCounter: counterBefore,
        terminal: "reward-settled",
        terminalOperationId: parkedOperationId,
        terminalStep: 0,
        terminalChoice: COOP_ME_REWARD_SETTLED_CHOICE,
      });
      expect(parkedRevision).toBeGreaterThan(0);
      expect(parkedEnvelope).toContain(parkedOperationId);

      // Duplicate proof callbacks are harmless: the one-shot redrive is disarmed before the tail runs.
      expect(settleCoopV2InteractionOperation(parkedOperationId, rig.hostRuntime)).toBe(true);
      await Promise.resolve();
      expect(rewardsEnd, "duplicate settlement proof cannot double-run the reward tail").toHaveBeenCalledTimes(1);

      await game.phaseInterceptor.to("SelectModifierPhase", false);
      const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      // Drive the embedded reward shop to its leave (the host is the forced reward owner mid-ME).
      guestReplayPhase = await driveHostMeRewardShopWithGuestReplay(hostShop, rig.guestCtx, rig.guestScene);
      await game.phaseInterceptor.to("PostMysteryEncounterPhase");
    });

    const guestReplay = await withClient(rig.guestCtx, () => drainGuestMeReplayToSettle(guestReplayPhase));
    expect(guestReplay.settled, "guest CoopReplayMePhase settled (left once)").toBe(true);

    const terminals = submitSpy.mock.calls
      .map(call => call[0])
      .filter(intent => intent.kind === "ME_TERMINAL")
      .map(intent => intent.payload);
    expect(
      terminals.map(terminal => (meOp.isCompleteCoopMeTerminalPayload(terminal) ? terminal.terminal : null)),
      "the pre-reward settlement and final leave are two complete, ordered retained transactions",
    ).toEqual(["reward-settled", "leave"]);
    const leave = terminals[1];
    if (meOp.isCompleteCoopMeTerminalPayload(leave)) {
      expect(leave.destination.kind).toBe("continue");
    }
    expect(
      applyOutcomeSpy,
      "the guest materializes the pre-reward settlement and final leave state exactly once each",
    ).toHaveBeenCalledTimes(2);

    // Lockstep, same as the legacy suite: both advanced once for the whole ME.
    expect(rig.hostRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    logs.flush();
  }, 300_000);

  it("DURABILITY: dropping the first retained leave transaction redelivers and executes it exactly once", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 0,
        reorder: 0,
        delay: 0,
      },
      { seed: 0x6d3e },
    );
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const applyOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");

    let guestReplayPhase!: Phase;
    await withClient(rig.hostCtx, async () => {
      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      guestReplayPhase = await driveHostMeRewardShopWithGuestReplay(hostShop, rig.guestCtx, rig.guestScene);
      // Lose exactly the first retained terminal frame. A permanent `drop: 1` profile would discard every
      // retransmission too and therefore model an unrecoverable partition, not the one-frame loss named by
      // this test. The journal must heal this one-shot loss from the same immutable transaction.
      pair.armNextDrop("envelope", "host");
      await game.phaseInterceptor.to("PostMysteryEncounterPhase");
    });
    expect(pair.faultsInjected(), "the first retained ME terminal delivery must actually be dropped").toBeGreaterThan(
      0,
    );

    const guestReplay = await withClient(rig.guestCtx, async () => {
      // The guest replay is already live so starting it no longer supplies the old implicit reconnect.
      // Reannounce the receiver's journal cursor exactly as a transport recovery does; the host must replay
      // the one dropped immutable terminal and the guest must materialize it once.
      rig.guestRuntime.durability?.reconnect();
      return drainGuestMeReplayToSettle(guestReplayPhase);
    });
    expect(guestReplay.settled, "the durable ME_TERMINAL must settle the real guest replay phase").toBe(true);
    expect(
      applyOutcomeSpy,
      "redelivery preserves exactly one apply for each ordered no-battle terminal step",
    ).toHaveBeenCalledTimes(2);
    expect(rig.guestRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    logs.flush();
  }, 300_000);

  it("STOPSHIP: a committed terminal whose first journal retention fails re-ACKs the exact first meResync", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const counterBefore = rig.hostRuntime.controller.interactionCounter();

    let guestReplayPhase!: Phase;
    await withClient(rig.hostCtx, async () => {
      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      guestReplayPhase = await driveHostMeRewardShopWithGuestReplay(hostShop, rig.guestCtx, rig.guestScene);
      await game.phaseInterceptor.to("PostMysteryEncounterPhase", false);
    });

    const durability = rig.hostRuntime.durability;
    expect(durability, "the production host runtime has an active durability journal").not.toBeNull();
    const originalJournalCommit = durability!.commit.bind(durability);
    let injected = false;
    const journalSpy = vi.spyOn(durability!, "commit").mockImplementation((cls, seq, msg) => {
      if (!injected && msg.t === "envelope" && msg.envelope.pendingOperation?.kind === "ME_TERMINAL") {
        injected = true;
        return false;
      }
      return originalJournalCommit(cls, seq, msg);
    });
    const submitSpy = vi.spyOn(CoopOperationHost.prototype, "submit");
    const captureSpy = vi.spyOn(coopEngine, "captureCoopMeOutcome");
    const releaseSpy = vi.spyOn(meOp, "releaseCoopMeRetainedTerminal");
    const advanceSpy = vi.spyOn(rig.hostRuntime.controller, "advanceInteraction");

    await withClient(rig.hostCtx, async () => {
      hostScene.phaseManager.getCurrentPhase()!.start();
      expect(injected, "the committed terminal hit the injected journal-retention failure").toBe(true);
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "the host cannot queue/advance past a terminal that is committed but not retained",
      ).toBe(counterBefore);
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "the guest remains on the same exact Mystery boundary",
      ).toBe(counterBefore);
      expect(hostScene.phaseManager.getCurrentPhase()?.phaseName).toBe("PostMysteryEncounterPhase");
      expect(captureSpy, "the first attempt captured one authoritative terminal image").toHaveBeenCalledTimes(1);
      expect(advanceSpy, "journal failure occurs before the local close/advance transaction").not.toHaveBeenCalled();
      expect(
        releaseSpy,
        "the exact terminal image stays retained while the shared boundary is held",
      ).not.toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 350));
    });

    const terminalSubmits = submitSpy.mock.calls
      .map((call, index) => ({ intent: call[0], result: submitSpy.mock.results[index] }))
      .filter(({ intent }) => intent.kind === "ME_TERMINAL");
    expect(terminalSubmits, "one committed attempt plus one exact deterministic re-ACK").toHaveLength(2);
    expect(
      new Set(terminalSubmits.map(({ intent }) => intent.id)).size,
      "the retry reuses the identical terminal operation address",
    ).toBe(1);
    expect(
      terminalSubmits.map(({ result }) => (result.type === "return" ? result.value.kind : result.type)),
      "the operation commits once, then the journal-only retry is an idempotent re-ACK",
    ).toEqual(["committed", "reack"]);
    expect(
      JSON.stringify(terminalSubmits[1].intent.payload),
      "the retry submits the byte-identical first-captured meResync payload",
    ).toBe(JSON.stringify(terminalSubmits[0].intent.payload));
    expect(captureSpy, "PostMysteryEncounterPhase must not recapture producer state on retry").toHaveBeenCalledTimes(1);

    const terminalJournalAttempts = journalSpy.mock.calls.filter(
      ([, , msg]) => msg.t === "envelope" && msg.envelope.pendingOperation?.kind === "ME_TERMINAL",
    );
    expect(terminalJournalAttempts, "the re-ACK retries the exact failed journal handoff").toHaveLength(2);
    expect(terminalJournalAttempts[1][1], "the journal retry retains the same committed envelope revision").toBe(
      terminalJournalAttempts[0][1],
    );
    expect(JSON.stringify(terminalJournalAttempts[1][2])).toBe(JSON.stringify(terminalJournalAttempts[0][2]));
    expect(rig.hostRuntime.controller.interactionCounter(), "the successful retry advances the host exactly once").toBe(
      counterBefore + 1,
    );
    expect(advanceSpy, "the successful retained terminal closes/advances exactly once").toHaveBeenCalledTimes(1);
    expect(releaseSpy, "the terminal image releases exactly once after close/advance succeeds").toHaveBeenCalledTimes(
      1,
    );
    expect(releaseSpy.mock.invocationCallOrder[0]).toBeGreaterThan(advanceSpy.mock.invocationCallOrder[0]);
    expect(
      rig.guestRuntime.controller.interactionCounter(),
      "delivery alone cannot mutate the inactive guest engine context",
    ).toBe(counterBefore);

    const guestReplay = await withClient(rig.guestCtx, () => drainGuestMeReplayToSettle(guestReplayPhase));
    expect(guestReplay.settled, "the retried committed terminal settles the production guest replay").toBe(true);
    expect(rig.guestRuntime.controller.interactionCounter(), "the guest advances exactly once from that terminal").toBe(
      counterBefore + 1,
    );
    logs.flush();
  }, 300_000);

  it("DURABILITY: dropping the top-level mePresent still materializes the host presentation", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 0,
        reorder: 0,
        delay: 0,
      },
      { seed: 0x6d3f },
    );
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    // The first host envelope on ME entry is the retained ME_PRESENT. Drop it once, while leaving every
    // resync replay deliverable, so this is a recovery proof rather than an endless partition.
    pair.armNextDrop("envelope", "host");
    const hostEncounter = hostScene.currentBattle.mysteryEncounter!;
    const populateHostTokens = hostEncounter.populateDialogueTokensFromRequirements.bind(hostEncounter);
    vi.spyOn(hostEncounter, "populateDialogueTokensFromRequirements").mockImplementation(() => {
      populateHostTokens();
      hostEncounter.dialogueTokens.durableProof = "host-authoritative";
    });
    rig.guestScene.currentBattle.mysteryEncounter!.dialogueTokens.durableProof = "guest-local";

    let guestReplayPhase!: Phase;
    await withClient(rig.hostCtx, async () => {
      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      guestReplayPhase = await driveHostMeRewardShopWithGuestReplay(hostShop, rig.guestCtx, rig.guestScene);
      await game.phaseInterceptor.to("PostMysteryEncounterPhase");
    });
    expect(pair.faultsInjected(), "the first retained top-level presentation must actually be dropped").toBeGreaterThan(
      0,
    );

    const guestReplay = await withClient(rig.guestCtx, () => drainGuestMeReplayToSettle(guestReplayPhase));
    expect(guestReplay.settled, "the guest replay still reaches its terminal").toBe(true);
    expect(
      rig.guestScene.currentBattle.mysteryEncounter!.dialogueTokens.durableProof,
      "the journal-delivered presentation must replace the guest-local token source",
    ).toBe("host-authoritative");
    logs.flush();
  }, 300_000);

  // =====================================================================================
  // LEG 2 - GUEST-OWNED non-battle ME: the guest MINTS an ME_PICK intent; the HOST COMMITS it.
  // =====================================================================================
  it("LEG 2 (guest-owned non-battle): the guest mints an ME_PICK intent, the HOST commits it through the primitive", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);

    // Seed the interaction counter to 1 (ODD -> guest owns the ME) via the real controller API.
    await withClient(rig.hostCtx, () => rig.hostRuntime.controller.advanceInteraction());
    await withClient(rig.guestCtx, () => rig.guestRuntime.controller.advanceInteraction());
    await drainLoopback();
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore, "the ME opens on interaction counter 1 (guest owns odd)").toBe(1);

    const authoritySubmitSpy = vi.spyOn(CoopOperationHost.prototype, "submit");

    // STEP A (host): reach MysteryEncounterPhase; the host parks awaiting the guest's relayed index.
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("MysteryEncounterPhase", false);
      await game.phaseInterceptor.to("MysteryEncounterPhase");
    });
    await drainLoopback();

    // STEP B (guest): start the divert, mint the exact typed/ordinal intent that the public selector mints,
    // then relay option index 0 synchronously (send-only). The race remains deferred until STEP D solely
    // because this two-engine harness shares one module graph; production browsers do not share globals.
    const replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
    withClientSync(rig.guestCtx, () => relayGuestMeOptionIndexOnly(replay, 0));

    // STEP C (host): flush the relayed index; the host commits the guest's ME_PICK (invariant 3) + applies it,
    // then reaches the embedded reward shop (the #828 pick-watcher on a guest-owned ME - rolls + streams).
    let hostShop!: ShopPhaseSeam;
    await withClient(rig.hostCtx, async () => {
      await drainLoopback();
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      hostShop.start();
      await drainLoopback();
    });

    // THE MIGRATED BEHAVIOR: the HOST committed the guest-owned ME_PICK it received (a host-role commit).
    const hostPickCommits = authoritySubmitSpy.mock.calls
      .map((call, index) => ({ intent: call[0], result: authoritySubmitSpy.mock.results[index] }))
      .filter(({ intent }) => intent.kind === "ME_PICK" && intent.owner === 1);
    expect(
      hostPickCommits.length,
      "the HOST committed the guest's relayed ME_PICK through the operation primitive (invariant 3)",
    ).toBeGreaterThan(0);
    expect(
      hostPickCommits[0].result.type === "return"
        ? hostPickCommits[0].result.value.kind
        : hostPickCommits[0].result.type,
      "the authority accepted and committed the guest-owned intent",
    ).toMatch(/^(committed|reack)$/);
    expect(
      (hostPickCommits[0].intent.payload as { optionIndex: number }).optionIndex,
      "the committed ME_PICK carries the guest's relayed option index (0)",
    ).toBe(0);

    // STEP C2 (guest): the guest OWNS the reward pick (#828) - open its shop as owner, relay LEAVE sync.
    const guestShop = await withClient(rig.guestCtx, () => startGuestMeShopOwner(rig.guestScene));
    withClientSync(rig.guestCtx, () => relayGuestMeShopLeaveSync(guestShop));

    // STEP C3: the host commits the guest owner's LEAVE, the guest materializes the retained result and
    // returns its reciprocal proof, then the host is allowed to leave the embedded shop. This interleave
    // is the production two-browser barrier; a sequential host-only drain cannot cross it.
    await withClient(rig.hostCtx, async () => {
      for (let i = 0; i < 8; i++) {
        await drainLoopback();
      }
    });
    await withClient(rig.guestCtx, async () => {
      for (let i = 0; i < 16; i++) {
        await drainLoopback();
      }
      await awaitRewardShopPhaseExit(guestShop);
    });
    await withClient(rig.hostCtx, async () => {
      for (let i = 0; i < 16; i++) {
        await drainLoopback();
        if (hostScene.phaseManager.getCurrentPhase()?.phaseName !== "SelectModifierPhase") {
          break;
        }
      }
      await game.phaseInterceptor.to("PostMysteryEncounterPhase");
    });
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once for the ME").toBe(
      counterBefore + 1,
    );

    // STEP D (guest): install the executable replay receiver after the embedded shop has closed. The host's
    // complete terminal was already retained while that nested surface owned the scene, so arming this exact
    // receiver must immediately reannounce readiness instead of waiting for a periodic durability resend.
    const guestDurability = rig.guestRuntime.durability;
    if (guestDurability == null) {
      throw new Error("guest-owned ME test lost its durability journal before terminal replay");
    }
    const terminalReadinessSpy = vi.spyOn(guestDurability, "reconnect");
    const guestReplay = await withClient(rig.guestCtx, async () => {
      startGuestMeOutcomeRace(replay);
      return drainGuestMeReplayToSettle(replay);
    });
    expect(
      terminalReadinessSpy,
      "the live Mystery replay receiver reannounced the retained complete terminal transaction",
    ).toHaveBeenCalled();
    expect(guestReplay.settled, "guest CoopReplayMePhase settled (left once)").toBe(true);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest counter lockstep after the ME").toBe(
      counterBefore + 1,
    );

    logs.flush();
  }, 300_000);

  // =====================================================================================
  // LEG 2b - TRACK R (run 29640634363 mystery lane): GUEST-OWNED NARRATION-BEARING ME. The guest owner
  // picks; the HOST commits the ME_PICK and RETAINS it awaiting the guest's continuation surface. The
  // guest then shows post-pick NARRATION in UiMode.MESSAGE, whose continuation surface is null by design
  // (coop-ui-registry.ts:311) - so WITHOUT the fix the committed ME_PICK's authority-continuation deadline
  // exhausts (`operation continuation EXHAUSTED key=...ME_PICK`, ~3min) -> shared session terminal -> both
  // to Title, and the ME terminal (gated behind the unreleased pick) can never substitute. The fix
  // (CoopReplayMePhase.releaseAppliedPickContinuationSurface, driven from the guest-owned ME_PICK
  // material-apply hook in applyJournaledMeEnvelope) emits ONE phase-owned `sharedInput` continuation for
  // the applied pick at its exact op-derived address. This LEG proves that release fires from the phase -
  // BEFORE any reward-shop surface opens - so the pick continuation drains, the guest reaches the terminal
  // without Title, and both engines converge in lockstep.
  // =====================================================================================
  it("LEG 2b (guest-owned, narration-bearing): the committed ME_PICK continuation releases from the post-pick surface, no Title (Track R)", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    // runToMysteryEncounter forces a 100% rate for its target wave. This leg crosses into wave 13 to
    // prove the real next-command continuation, so restore the ordinary-wave rate after wave 12 is built.
    game.override.mysteryEncounterChance(0);

    // Seed the interaction counter to 1 (ODD -> guest owns the ME).
    await withClient(rig.hostCtx, () => rig.hostRuntime.controller.advanceInteraction());
    await withClient(rig.guestCtx, () => rig.guestRuntime.controller.advanceInteraction());
    await drainLoopback();
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore, "the ME opens on interaction counter 1 (guest owns odd)").toBe(1);

    const guestDurability = rig.guestRuntime.durability;
    if (guestDurability == null) {
      throw new Error("guest-owned narration ME test lost its durability journal");
    }
    // The exact seam the fix relies on: the phase's post-pick sharedInput continuation emit routes through
    // the ACTIVE durability (the guest's, under guestCtx). Capturing it proves the phase - not a later
    // shop surface - retired the retained pick.
    const releaseSpy = vi.spyOn(guestDurability, "notifyOperationContinuationSurface");

    // STEP A (host): reach MysteryEncounterPhase; the host parks awaiting the guest's relayed index.
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("MysteryEncounterPhase", false);
      await game.phaseInterceptor.to("MysteryEncounterPhase");
    });
    await drainLoopback();

    // STEP B (guest): start the divert -> CoopReplayMePhase (opens the selector as owner), then relay
    // option index 0 send-only (the harness split; the outcome race defers to STEP D).
    const replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
    withClientSync(rig.guestCtx, () => relayGuestMeOptionIndexOnly(replay, 0));

    // STEP C (host): flush the relayed index; the host COMMITS the guest's ME_PICK (invariant 3), applies
    // it, and BROADCASTS the retained pick envelope. It then streams a post-pick NARRATION line (the guest
    // renders it in MESSAGE - a null continuation surface), and reaches the embedded reward shop.
    let hostShop!: ShopPhaseSeam;
    await withClient(rig.hostCtx, async () => {
      await drainLoopback();
      // Narration-bearing: stream one post-pick host line so the guest's onMeMessage secondary release path
      // is exercised too. The MESSAGE surface it renders in retires nothing (coopAuthorityContinuationSurface
      // MESSAGE -> null), so only the phase's own emit can release the retained pick.
      coopHostStreamMeMessage("The clerk rings up your order.");
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      hostShop.start();
      await drainLoopback();
    });

    // STEP C1 (guest): pump the guest so it APPLIES the broadcast ME_PICK envelope. The Track R
    // material-apply hook fires here and releases the pick's continuation from the phase - BEFORE the guest
    // opens any reward-shop (sharedInput) surface. Snapshot the emit count first so the assertion isolates
    // THIS pick-apply window (the earlier ME_PRESENT selector surface emit is excluded).
    const emitsBeforePickApply = releaseSpy.mock.calls.length;
    const pickApplyEmits = await withClient(rig.guestCtx, async () => {
      for (let i = 0; i < 8; i++) {
        await drainLoopback();
      }
      return releaseSpy.mock.calls.slice(emitsBeforePickApply);
    });
    expect(
      pickApplyEmits.some(
        ([surface, address]) => surface === "sharedInput" && address.wave === ME_WAVE && address.turn === 0,
      ),
      "the guest released its committed ME_PICK continuation from the phase at the pick apply, before any shop opened (Track R)",
    ).toBe(true);
    expect(
      guestDurability.operationContinuationDiagnostics().pending,
      "the guest owner's ME_PICK drained; only the already-applied pre-reward terminal awaits its public tail",
    ).toBe(1);

    // STEP C2 (guest): the guest OWNS the reward pick (#828) - open its shop as owner, relay LEAVE sync.
    const guestShop = await withClient(rig.guestCtx, () => startGuestMeShopOwner(rig.guestScene));
    withClientSync(rig.guestCtx, () => relayGuestMeShopLeaveSync(guestShop));

    // STEP C3 (host): drain so the guest owner's LEAVE applies, the host shop ends, and the option chain
    // runs to PostMysteryEncounterPhase (streams the terminal + advances once).
    await withClient(rig.hostCtx, async () => {
      for (let i = 0; i < 16; i++) {
        await drainLoopback();
        await withClient(rig.guestCtx, () => drainLoopback());
        await drainLoopback();
        if (hostScene.phaseManager.getCurrentPhase()?.phaseName !== "SelectModifierPhase") {
          break;
        }
      }
      await withClient(rig.guestCtx, () => awaitRewardShopPhaseExit(guestShop));
      await game.phaseInterceptor.to("PostMysteryEncounterPhase");
    });
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once for the ME").toBe(
      counterBefore + 1,
    );

    // STEP D (guest): start the outcome/terminal race and drain to the terminal. The guest REACHES its
    // terminal (settles) - it never fell to Title behind an unreleased pick.
    const guestReplay = await withClient(rig.guestCtx, async () => {
      startGuestMeOutcomeRace(replay);
      return drainGuestMeReplayToSettle(replay);
    });
    expect(guestReplay.settled, "guest CoopReplayMePhase reached its terminal (left once) - no Title").toBe(true);

    // The raw relay seam above intentionally stops at the ME terminal. Production does not: its real
    // PostMysteryEncounter/reward tail calls UI.setMode and reaches the next CommandPhase. Drive that exact
    // phase-manager path so the guest observes both still-retained public continuations (REWARD and
    // ME_TERMINAL) at wave+1/turn-1. Never notify the durability layer directly: this regression must fail
    // if a future real UI-to-relay call chain stops being wired.
    let hostMapCommitted = false;
    let guestMapCommitted = false;
    // Production ordering is host materialization/publication first, then guest carrier consumption.
    // Do not nest a host phase drive inside an outer guest withClient window: Promise continuations from
    // EncounterPhase assets/save/tweens can otherwise resume after the nested window restores the guest's
    // process-global scene, turning a host NextEncounterPhase into a correctly blocked guest renderer tail.
    const hostCommand = await withClient(rig.hostCtx, () =>
      driveClientPhaseQueueTo(rig.hostScene, "host post-ME CommandPhase", {
        matches: phase =>
          phase.phaseName === "CommandPhase"
          && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_HOST_FIELD_INDEX
          && rig.hostScene.currentBattle.waveIndex === ME_WAVE + 1
          && rig.hostScene.currentBattle.turn === 1,
        perPhaseTimeoutMs: 5_000,
        drivePublicPhaseInput: phase => {
          if (
            phase.phaseName === "SelectBiomePhase"
            && rig.hostScene.ui.getMode() === UiMode.ER_MAP
            && !hostMapCommitted
          ) {
            hostMapCommitted = rig.hostScene.ui.processInput(Button.ACTION);
            return hostMapCommitted;
          }
          return false;
        },
      }),
    );
    const guestCommand = await withClient(rig.guestCtx, () =>
      driveClientPhaseQueueTo(rig.guestScene, "guest post-ME CommandPhase", {
        matches: phase =>
          phase.phaseName === "CommandPhase"
          && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX
          && rig.guestScene.currentBattle.waveIndex === ME_WAVE + 1
          && rig.guestScene.currentBattle.turn === 1,
        perPhaseTimeoutMs: 5_000,
        drivePublicPhaseInput: phase => {
          if (
            phase.phaseName === "SelectBiomePhase"
            && rig.guestScene.ui.getMode() === UiMode.ER_MAP
            && !guestMapCommitted
          ) {
            guestMapCommitted = rig.guestScene.ui.processInput(Button.ACTION);
            return guestMapCommitted;
          }
          return false;
        },
      }),
    );

    // driveClientPhaseQueueTo deliberately stops BEFORE its target. Start both real CommandPhase objects
    // so their reciprocal rendezvous opens the public COMMAND surfaces that publish the two outstanding
    // continuation proofs. Merely making CommandPhase current is not player-observable and cannot retire
    // retained authority; the old fixture asserted zero pending immediately before this call chain.
    // Each client must start its OWN slot. The guest's preceding host-owned slot is a renderer-only
    // generated skip and driveClientPhaseQueueTo has already advanced past it. Queue every rendezvous
    // frame for its destination ClientCtx during this crossing: ordinary loopback can otherwise resolve
    // the guest's promise while the HOST's process-global scene is installed, a one-process-only failure
    // that cannot occur in two browsers. This is the same destination scheduler used by the canonical
    // production-fidelity driver.
    rig.pair.setDestinationContextDelivery?.(true);
    try {
      await withClient(rig.guestCtx, async () => {
        guestCommand.start();
        await drainLoopback();
      });
      await withClient(rig.hostCtx, async () => {
        hostCommand.start();
        await drainLoopback();
      });
      // Starting either realm first necessarily parks it at the reciprocal rendezvous.
      // A fixed one-sided drain loop is not representative of two event loops. Alternate both complete
      // destination contexts until both real phase starts expose COMMAND, bounded like production.
      const commandSurfacesOpened = (async () => {
        const deadline = Date.now() + 5_000;
        while (
          (rig.hostScene.ui.getMode() !== UiMode.COMMAND || rig.guestScene.ui.getMode() !== UiMode.COMMAND)
          && Date.now() < deadline
        ) {
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
        if (rig.hostScene.ui.getMode() !== UiMode.COMMAND || rig.guestScene.ui.getMode() !== UiMode.COMMAND) {
          throw new Error(
            `post-ME command surfaces did not open: host=${UiMode[rig.hostScene.ui.getMode()]}, `
              + `guest=${UiMode[rig.guestScene.ui.getMode()]}`,
          );
        }
      })();
      await settleDuoPromise(rig, commandSurfacesOpened, "post-ME reciprocal command surfaces", {
        timeoutMs: 5_000,
        intervalMs: 5,
      });
    } finally {
      rig.pair.setDestinationContextDelivery?.(false);
    }
    expect(rig.hostScene.ui.getMode(), "host exposed the next public command continuation").toBe(UiMode.COMMAND);
    expect(rig.guestScene.ui.getMode(), "guest exposed the next public command continuation").toBe(UiMode.COMMAND);

    // Both engines converged in lockstep - no pick, reward, or terminal continuation stranded the run.
    expect(rig.hostRuntime.controller.interactionCounter(), "host counter is 2 after the ME").toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest counter is 2 after the ME (lockstep)").toBe(
      counterBefore + 1,
    );
    expect(
      guestDurability.operationContinuationDiagnostics().pending,
      "the guest holds no stranded op:me continuation after the ME",
    ).toBe(0);

    logs.flush();
  }, 300_000);

  it("parks host BattleEnd battle-settlement until typed proof, then installs control before one tail", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.FIGHT_OR_FLIGHT, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, async () => {
      await runSelectMysteryEncounterOption(game, 1);
      await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
      expect(captureCoopActiveMysteryControl()).toMatchObject({ terminal: "battle", terminalStep: 0 });
    });

    let blockBattleSettlement = true;
    const originalPrepare = rig.hostRuntime.v2ControlLedger.prepareAuthorityEntry.bind(
      rig.hostRuntime.v2ControlLedger,
    );
    vi.spyOn(rig.hostRuntime.v2ControlLedger, "prepareAuthorityEntry").mockImplementation(entry => {
      if (blockBattleSettlement && authorityMeTerminalKind(entry) === "battle-settled") {
        return null;
      }
      return originalPrepare(entry);
    });
    const plan = {
      result: "victory" as const,
      continuation: "encounter" as const,
      trainerVictory: false,
      rewardSurfaces: [],
      eggLapse: false,
    };

    await withClient(rig.hostCtx, async () => {
      const battleEnd = new BattleEndPhase(true, null, plan);
      hostScene.phaseManager.clearPhaseQueue();
      hostScene.phaseManager.unshiftPhase(battleEnd);
      hostScene.phaseManager.shiftPhase();
      expect(hostScene.phaseManager.getCurrentPhase()).toBe(battleEnd);
      const battleEndEnd = vi.spyOn(battleEnd, "end");
      battleEnd.start();

      const parked = rig.hostRuntime.v2DeferredMeTerminalRedrive;
      expect(parked).not.toBeNull();
      expect(parked?.envelope.pendingOperation?.kind).toBe("ME_TERMINAL");
      expect(
        (parked?.envelope.pendingOperation?.payload as { readonly terminal?: string } | undefined)?.terminal,
      ).toBe("battle-settled");
      expect(battleEndEnd, "the BattleEnd tail remains parked before typed commit").not.toHaveBeenCalled();
      expect(hostScene.phaseManager.getCurrentPhase()).toBe(battleEnd);

      const parkedOperationId = parked!.operationId;
      const parkedRevision = parked!.revision;
      const parkedEnvelope = JSON.stringify(parked!.envelope);
      const capturedDeferred = meOp.captureCoopMeDeferredTerminal(parkedOperationId);
      expect(capturedDeferred?.operationId).toBe(parkedOperationId);
      expect(capturedDeferred?.revision).toBe(parkedRevision);
      expect(JSON.stringify(capturedDeferred?.envelope)).toBe(parkedEnvelope);

      blockBattleSettlement = false;
      expect(settleCoopV2InteractionOperation(parkedOperationId, rig.hostRuntime)).toBe(true);
      await vi.waitFor(() => expect(battleEndEnd).toHaveBeenCalledTimes(1), { timeout: 2_000, interval: 10 });
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
      expect(meOp.captureCoopMeDeferredTerminal(parkedOperationId)).toBeNull();
      expect(battleEndEnd, "BattleEnd resumes exactly once after the proof edge").toHaveBeenCalledOnce();
      expect(captureCoopActiveMysteryControl()).toMatchObject({
        terminal: "battle-settled",
        terminalOperationId: parkedOperationId,
        terminalStep: 1,
        terminalChoice: COOP_ME_BATTLE_SETTLED_CHOICE,
      });
      expect(parkedRevision).toBeGreaterThan(0);
      expect(parkedEnvelope).toContain(parkedOperationId);

      expect(settleCoopV2InteractionOperation(parkedOperationId, rig.hostRuntime)).toBe(true);
      await Promise.resolve();
      expect(battleEndEnd, "duplicate settlement proof cannot double-run BattleEnd").toHaveBeenCalledOnce();
    });

    logs.flush();
  }, 300_000);

  it("runs real Colosseum battle0-settled1-battle2-settled3 phases under exact typed proof", async () => {
    game.override.startingWave(42);
    await game.runToMysteryEncounter(MysteryEncounterType.COLOSSEUM, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    expect(hostScene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.COLOSSEUM);
    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);

    let blockedTerminal: "battle" | "battle-settled" | null = "battle";
    const originalPrepare = rig.hostRuntime.v2ControlLedger.prepareAuthorityEntry.bind(
      rig.hostRuntime.v2ControlLedger,
    );
    vi.spyOn(rig.hostRuntime.v2ControlLedger, "prepareAuthorityEntry").mockImplementation(entry => {
      if (blockedTerminal != null && authorityMeTerminalKind(entry) === blockedTerminal) {
        return null;
      }
      return originalPrepare(entry);
    });
    let expectedRawStep = 0;
    const originalRelay = rig.hostRuntime.mePump.relayMeBattleHandoff.bind(rig.hostRuntime.mePump);
    const rawHandoff = vi
      .spyOn(rig.hostRuntime.mePump, "relayMeBattleHandoff")
      .mockImplementation((hostTurn, sendRawTerminal) => {
        expect(captureCoopActiveMysteryControl(), "typed control is installed before either raw relay").toMatchObject({
          terminal: "battle",
          terminalStep: expectedRawStep,
          terminalChoice: COOP_ME_BATTLE_HANDOFF,
        });
        originalRelay(hostTurn, sendRawTerminal);
      });

    await withClient(rig.hostCtx, async () => {
      const terminalRevisions: number[] = [];
      const controlRevisions: number[] = [];
      const journeyLogStart = game.phaseInterceptor.log.length;
      const watchProductionPhaseStart = (phase: Phase, label: string) => {
        const leaseSnapshots: { readonly pendingTokens: number; readonly activeLabels: readonly string[] }[] = [];
        const originalStart = phase.start.bind(phase);
        const start = vi.spyOn(phase, "start").mockImplementation(() => {
          const snapshot = rig.hostRuntime.mutationLedger.snapshot();
          leaseSnapshots.push(snapshot);
          expect(
            snapshot.activeLabels,
            `${label} crosses PhaseInterceptor.run's production mutation boundary before start`,
          ).toContain(`phase:${phase.phaseName}`);
          expect(snapshot.pendingTokens, `${label} holds a live mutation lease while it starts`).toBeGreaterThan(0);
          originalStart();
        });
        return { leaseSnapshots, start };
      };
      const expectPhaseLeaseReleased = (phase: Phase, label: string) => {
        expect(
          rig.hostRuntime.mutationLedger.snapshot().activeLabels,
          `${label} releases its exact mutation lease only when the phase manager shifts it`,
        ).not.toContain(`phase:${phase.phaseName}`);
      };
      const parkedTerminal = (terminal: "battle" | "battle-settled") => {
        const parked = rig.hostRuntime.v2DeferredMeTerminalRedrive;
        expect(parked, `${terminal} owns one parked production transaction`).not.toBeNull();
        expect(parked?.envelope.pendingOperation?.kind).toBe("ME_TERMINAL");
        expect(
          (parked?.envelope.pendingOperation?.payload as { readonly terminal?: string } | undefined)?.terminal,
        ).toBe(terminal);
        const captured = meOp.captureCoopMeDeferredTerminal(parked!.operationId);
        expect(captured?.operationId).toBe(parked!.operationId);
        expect(captured?.revision).toBe(parked!.revision);
        expect(JSON.stringify(captured?.envelope)).toBe(JSON.stringify(parked!.envelope));
        terminalRevisions.push(parked!.revision);
        return parked!;
      };
      const recordControl = (terminal: "battle" | "battle-settled", step: number, operationId: string) => {
        const control = captureCoopActiveMysteryControl();
        expect(control).toMatchObject({ terminal, terminalStep: step, terminalOperationId: operationId });
        controlRevisions.push(control!.revision);
      };
      const reachRealBattleEnd = async (ordinal: number) => {
        const battlePhase = hostScene.phaseManager.getCurrentPhase();
        expect(battlePhase, `round ${ordinal} reached its production battle phase`).toBeInstanceOf(
          MysteryEncounterBattlePhase,
        );
        const battleStart = watchProductionPhaseStart(battlePhase, `round ${ordinal} MysteryEncounterBattlePhase`);
        const battleEnd = vi.spyOn(battlePhase, "end");
        await game.phaseInterceptor.to("TurnInitPhase", false);
        expect(battleStart.start, `round ${ordinal} battle starts once through the interceptor`).toHaveBeenCalledOnce();
        expect(battleStart.leaseSnapshots).toHaveLength(1);
        expect(battleEnd, `round ${ordinal} battle transition runs once`).toHaveBeenCalledOnce();
        expectPhaseLeaseReleased(battlePhase, `round ${ordinal} MysteryEncounterBattlePhase`);

        const enemies = hostScene.getEnemyParty();
        expect(enemies.length, `round ${ordinal} has a real Colosseum enemy party`).toBeGreaterThan(0);
        const activeEnemies = hostScene.getEnemyField().filter(enemy => enemy != null && !enemy.isFainted());
        expect(activeEnemies.length, `round ${ordinal} has a live enemy field target`).toBeGreaterThan(0);
        const finishingEnemy = activeEnemies[0]!;
        for (const enemy of enemies.filter(enemy => enemy !== finishingEnemy)) {
          enemy.hp = 0;
          enemy.doSetStatus(StatusEffect.FAINT);
          enemy.leaveField(true, true, false);
          expect(enemy.isFainted(true)).toBe(true);
        }
        const hpBefore = finishingEnemy.hp;
        expect(hpBefore, `round ${ordinal} finishing enemy is alive before the arranged KO`).toBeGreaterThan(0);
        expect(
          finishingEnemy.damage(hpBefore, true, true),
          `round ${ordinal} uses Pokemon.damage's real faint enqueue edge`,
        ).toBe(hpBefore);
        expect(finishingEnemy.isFainted()).toBe(true);
        expect(hostScene.phaseManager.getQueuedPhaseNames(), `round ${ordinal} queued a real FaintPhase`).toContain(
          "FaintPhase",
        );
        expect(
          hostScene.phaseManager.getQueuedPhaseNames(),
          `round ${ordinal} cannot synthesize Victory before FaintPhase runs`,
        ).not.toContain("VictoryPhase");

        await game.phaseInterceptor.to("FaintPhase", false);
        const faintPhase = hostScene.phaseManager.getCurrentPhase();
        expect(faintPhase, `round ${ordinal} reaches the queued production faint phase`).toBeInstanceOf(FaintPhase);
        const faintStart = watchProductionPhaseStart(faintPhase, `round ${ordinal} FaintPhase`);
        const faintEnd = vi.spyOn(faintPhase, "end");
        await game.phaseInterceptor.to("VictoryPhase", false);
        expect(
          faintStart.start,
          `round ${ordinal} FaintPhase starts once through the interceptor`,
        ).toHaveBeenCalledOnce();
        expect(faintStart.leaseSnapshots).toHaveLength(1);
        expect(faintEnd, `round ${ordinal} FaintPhase completes once`).toHaveBeenCalledOnce();
        expectPhaseLeaseReleased(faintPhase, `round ${ordinal} FaintPhase`);

        const victoryPhase = hostScene.phaseManager.getCurrentPhase();
        expect(victoryPhase, `round ${ordinal} reaches Victory only from the faint queue`).toBeInstanceOf(VictoryPhase);
        const victoryStart = watchProductionPhaseStart(victoryPhase, `round ${ordinal} VictoryPhase`);
        const victoryEnd = vi.spyOn(victoryPhase, "end");
        await game.phaseInterceptor.to("BattleEndPhase", false);
        expect(
          victoryStart.start,
          `round ${ordinal} Victory starts once through the interceptor`,
        ).toHaveBeenCalledOnce();
        expect(victoryStart.leaseSnapshots).toHaveLength(1);
        expect(victoryEnd, `round ${ordinal} Victory queues and shifts its real tail once`).toHaveBeenCalledOnce();
        expectPhaseLeaseReleased(victoryPhase, `round ${ordinal} VictoryPhase`);

        const productionBattleEnd = hostScene.phaseManager.getCurrentPhase();
        expect(productionBattleEnd, `round ${ordinal} reaches its production BattleEnd`).toBeInstanceOf(BattleEndPhase);
        return {
          battlePhase,
          battleEnd: productionBattleEnd,
          battleEndEnd: vi.spyOn(productionBattleEnd, "end"),
        };
      };
      const settleRealBattleEnd = async (
        ordinal: number,
        boundary: Awaited<ReturnType<typeof reachRealBattleEnd>>,
      ) => {
        blockedTerminal = "battle-settled";
        const battleEndStart = watchProductionPhaseStart(boundary.battleEnd, `round ${ordinal} BattleEndPhase`);
        const progression = game.phaseInterceptor.to("TrainerVictoryPhase", false);
        await vi.waitFor(() => expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).not.toBeNull(), {
          timeout: 2_000,
          interval: 10,
        });
        expect(
          battleEndStart.start,
          `round ${ordinal} BattleEnd starts once through the interceptor`,
        ).toHaveBeenCalledOnce();
        expect(battleEndStart.leaseSnapshots).toHaveLength(1);
        const parked = parkedTerminal("battle-settled");
        expect(boundary.battleEndEnd, `round ${ordinal} BattleEnd tail waits for proof`).not.toHaveBeenCalled();
        expect(hostScene.phaseManager.getCurrentPhase()).toBe(boundary.battleEnd);
        expect(
          rig.hostRuntime.mutationLedger.snapshot().activeLabels,
          `round ${ordinal} keeps the BattleEnd mutation lease across the typed-proof await`,
        ).toContain("phase:BattleEndPhase");
        const immutable = JSON.stringify(parked);
        await Promise.resolve();
        expect(JSON.stringify(rig.hostRuntime.v2DeferredMeTerminalRedrive)).toBe(immutable);

        blockedTerminal = null;
        expect(settleCoopV2InteractionOperation(parked.operationId, rig.hostRuntime)).toBe(true);
        await vi.waitFor(() => expect(boundary.battleEndEnd).toHaveBeenCalledTimes(1), {
          timeout: 2_000,
          interval: 10,
        });
        await progression;
        expect(hostScene.phaseManager.getCurrentPhase()?.phaseName).toBe("TrainerVictoryPhase");
        expectPhaseLeaseReleased(boundary.battleEnd, `round ${ordinal} BattleEndPhase`);
        recordControl("battle-settled", ordinal * 2 - 1, parked.operationId);
        expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
        expect(meOp.captureCoopMeDeferredTerminal(parked.operationId)).toBeNull();
        expect(settleCoopV2InteractionOperation(parked.operationId, rig.hostRuntime)).toBe(true);
        await Promise.resolve();
        expect(boundary.battleEndEnd, `round ${ordinal} duplicate proof cannot rerun its tail`).toHaveBeenCalledOnce();
        return parked;
      };

      const firstSelection = runSelectMysteryEncounterOption(game, 1);
      await vi.waitFor(() => expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).not.toBeNull(), {
        timeout: 10_000,
        interval: 10,
      });
      const battle0 = parkedTerminal("battle");
      const battle0Envelope = JSON.stringify(battle0);
      expect(rawHandoff, "round 1 raw handoff is suppressed before typed proof").not.toHaveBeenCalled();
      expect(hostScene.phaseManager.getCurrentPhase()).not.toBeInstanceOf(MysteryEncounterBattlePhase);
      await Promise.resolve();
      expect(JSON.stringify(rig.hostRuntime.v2DeferredMeTerminalRedrive)).toBe(battle0Envelope);

      blockedTerminal = null;
      expect(settleCoopV2InteractionOperation(battle0.operationId, rig.hostRuntime)).toBe(true);
      await firstSelection;
      await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
      expect(rawHandoff).toHaveBeenCalledTimes(1);
      recordControl("battle", 0, battle0.operationId);
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
      expect(meOp.captureCoopMeDeferredTerminal(battle0.operationId)).toBeNull();

      const firstBattle = await reachRealBattleEnd(1);
      const settled1 = await settleRealBattleEnd(1, firstBattle);

      const firstTrainerVictory = hostScene.phaseManager.getCurrentPhase();
      const trainerVictoryStart = watchProductionPhaseStart(firstTrainerVictory, "round 1 TrainerVictoryPhase");
      const trainerVictoryEnd = vi.spyOn(firstTrainerVictory, "end");
      game.onNextPrompt(
        "TrainerVictoryPhase",
        UiMode.MESSAGE,
        () => hostScene.ui.getMessageHandler().processInput(Button.ACTION),
        () => game.isCurrentPhase("MysteryEncounterRewardsPhase"),
      );
      await game.phaseInterceptor.to("MysteryEncounterRewardsPhase", false);
      expect(
        trainerVictoryStart.start,
        "the real trainer-victory phase starts once through the interceptor",
      ).toHaveBeenCalledOnce();
      expect(trainerVictoryStart.leaseSnapshots).toHaveLength(1);
      expect(trainerVictoryEnd, "the trainer-victory transition completes once").toHaveBeenCalledOnce();
      expectPhaseLeaseReleased(firstTrainerVictory, "round 1 TrainerVictoryPhase");
      const firstRewards = hostScene.phaseManager.getCurrentPhase();
      const firstRewardsStart = watchProductionPhaseStart(firstRewards, "round 1 MysteryEncounterRewardsPhase");
      const firstRewardsEnd = vi.spyOn(firstRewards, "end");
      await game.phaseInterceptor.to("ColosseumChoicePhase", false);
      expect(
        firstRewardsStart.start,
        "the real between-round reward phase starts once through the interceptor",
      ).toHaveBeenCalledOnce();
      expect(firstRewardsStart.leaseSnapshots).toHaveLength(1);
      expect(firstRewardsEnd, "the real between-round reward tail runs once").toHaveBeenCalledOnce();
      expectPhaseLeaseReleased(firstRewards, "round 1 MysteryEncounterRewardsPhase");

      const board = hostScene.phaseManager.getCurrentPhase();
      expect(board).toBeInstanceOf(ColosseumChoicePhase);
      const boardStart = watchProductionPhaseStart(board, "round 1 ColosseumChoicePhase");
      const boardEnd = vi.spyOn(board, "end");
      const boardProgression = game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
      await vi.waitFor(() => expect(hostScene.ui.getMode()).toBe(UiMode.COLOSSEUM), {
        timeout: 10_000,
        interval: 10,
      });
      expect(boardStart.start, "the real Colosseum board starts once through the interceptor").toHaveBeenCalledOnce();
      expect(boardStart.leaseSnapshots).toHaveLength(1);

      blockedTerminal = "battle";
      expectedRawStep = 2;
      const colosseumUi = hostScene.ui.getHandler<ColosseumUiHandler>();
      expect(colosseumUi.processInput(Button.ACTION), "the real board accepts CONTINUE").toBe(true);
      await vi.waitFor(() => expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).not.toBeNull(), {
        timeout: 10_000,
        interval: 10,
      });
      const battle2 = parkedTerminal("battle");
      expect(rawHandoff, "round 2 raw handoff is suppressed before typed proof").toHaveBeenCalledTimes(1);
      expect(boardEnd, "the real Colosseum board owns the unresolved handoff Promise").not.toHaveBeenCalled();
      expect(hostScene.phaseManager.getCurrentPhase()).toBe(board);
      expect(
        rig.hostRuntime.mutationLedger.snapshot().activeLabels,
        "the board mutation lease remains held while its handoff Promise is parked",
      ).toContain("phase:ColosseumChoicePhase");

      blockedTerminal = null;
      expect(settleCoopV2InteractionOperation(battle2.operationId, rig.hostRuntime)).toBe(true);
      await vi.waitFor(() => expect(boardEnd).toHaveBeenCalledTimes(1), { timeout: 10_000, interval: 10 });
      expect(rawHandoff).toHaveBeenCalledTimes(2);
      recordControl("battle", 2, battle2.operationId);
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
      expect(meOp.captureCoopMeDeferredTerminal(battle2.operationId)).toBeNull();
      expect(settleCoopV2InteractionOperation(battle2.operationId, rig.hostRuntime)).toBe(true);
      await Promise.resolve();
      expect(rawHandoff, "duplicate round-2 proof cannot relay twice").toHaveBeenCalledTimes(2);
      expect(boardEnd, "duplicate round-2 proof cannot end the board twice").toHaveBeenCalledOnce();

      await boardProgression;
      expect(hostScene.phaseManager.getCurrentPhase()).toBeInstanceOf(MysteryEncounterBattlePhase);
      expectPhaseLeaseReleased(board, "round 1 ColosseumChoicePhase");
      const secondBattle = await reachRealBattleEnd(2);
      const settled3 = await settleRealBattleEnd(2, secondBattle);
      expect(secondBattle.battlePhase, "round 2 owns a distinct production battle phase").not.toBe(
        firstBattle.battlePhase,
      );
      expect(secondBattle.battleEnd, "round 2 owns a distinct production BattleEnd").not.toBe(firstBattle.battleEnd);

      expect([battle0.revision, settled1.revision, battle2.revision, settled3.revision]).toEqual(terminalRevisions);
      expect(terminalRevisions).toHaveLength(4);
      for (let i = 1; i < terminalRevisions.length; i++) {
        expect(terminalRevisions[i]!).toBeGreaterThan(terminalRevisions[i - 1]!);
        expect(controlRevisions[i]!).toBeGreaterThan(controlRevisions[i - 1]!);
      }
      expect(controlRevisions).toHaveLength(4);
      const terminalJourneyPhases = new Set([
        "MysteryEncounterBattlePhase",
        "FaintPhase",
        "VictoryPhase",
        "BattleEndPhase",
        "TrainerVictoryPhase",
        "MysteryEncounterRewardsPhase",
        "ColosseumChoicePhase",
      ]);
      expect(
        game.phaseInterceptor.log.slice(journeyLogStart).filter(phase => terminalJourneyPhases.has(phase)),
        "both rounds traverse the production scheduler through faint/victory/BattleEnd and the real board",
      ).toEqual([
        "MysteryEncounterBattlePhase",
        "FaintPhase",
        "VictoryPhase",
        "BattleEndPhase",
        "TrainerVictoryPhase",
        "MysteryEncounterRewardsPhase",
        "ColosseumChoicePhase",
        "MysteryEncounterBattlePhase",
        "FaintPhase",
        "VictoryPhase",
        "BattleEndPhase",
      ]);
    });

    logs.flush();
  }, 300_000);

  it.each([
    { label: "scene replacement", mutation: "scene", freezes: true },
    { label: "controller replacement", mutation: "controller", freezes: true },
    { label: "battle replacement", mutation: "battle", freezes: true },
    { label: "pinned-interaction replacement", mutation: "pin", freezes: true },
    { label: "authority loss", mutation: "authority", freezes: false },
  ] as const)("cancels a parked owner handoff on $label without a raw relay or promise leak", async testCase => {
    const boundary = await prepareBattleSettledHandoffBoundary();
    const { hostScene, rig } = boundary;

    await withClient(rig.hostCtx, async () => {
      const pending = await parkSecondHandoff(boundary);
      const pinned = coopMeInteractionStartValue();
      const originalBattle = hostScene.currentBattle;
      const originalController = rig.hostRuntime.controller;
      const replacementController = rig.guestRuntime.controller;
      const replacementControllerRole = replacementController.role;
      const runtimeControllerSlot = rig.hostRuntime as unknown as { controller: typeof originalController };

      try {
        switch (testCase.mutation) {
          case "scene":
            expect(rig.guestScene).not.toBe(hostScene);
            initGlobalScene(rig.guestScene);
            break;
          case "controller":
            expect(replacementController).not.toBe(originalController);
            replacementController.role = "host";
            runtimeControllerSlot.controller = replacementController;
            break;
          case "battle":
            expect(rig.guestScene.currentBattle).not.toBe(originalBattle);
            hostScene.currentBattle = rig.guestScene.currentBattle;
            break;
          case "pin":
            setCoopMeInteractionStart(pinned + 2);
            break;
          case "authority":
            originalController.role = "guest";
            break;
        }

        pending.releaseProof();
        expect(settleCoopV2InteractionOperation(pending.parked.operationId, rig.hostRuntime)).toBe(true);
        await expect(pending.promise).resolves.toBe(false);
        expect(pending.promiseSettled()).toBe(true);
        expect(pending.resolutionCount(), "the parked Promise has one cancellation completion").toBe(1);
        expect(
          pending.rawHandoff,
          "an invalidated handoff never reaches the compatibility pump",
        ).not.toHaveBeenCalled();
        expect(rig.hostRuntime.v2DeferredMeTerminalRedrive, "the runtime releases its parked callback").toBeNull();
        expect(
          withActiveCoopRuntimeOpState(rig.hostRuntime.opState, () =>
            meOp.captureCoopMeDeferredTerminal(pending.parked.operationId),
          ),
          "the runtime releases its retained deferred envelope",
        ).toBeNull();
        expect(isCoopSharedTerminalFrozen(rig.hostRuntime)).toBe(testCase.freezes);

        expect(settleCoopV2InteractionOperation(pending.parked.operationId, rig.hostRuntime)).toBe(true);
        await Promise.resolve();
        expect(pending.resolutionCount(), "a duplicate proof cannot recancel the Promise").toBe(1);
        expect(pending.rawHandoff).not.toHaveBeenCalled();
      } finally {
        switch (testCase.mutation) {
          case "scene":
            initGlobalScene(hostScene);
            break;
          case "controller":
            runtimeControllerSlot.controller = originalController;
            replacementController.role = replacementControllerRole;
            break;
          case "battle":
            hostScene.currentBattle = originalBattle;
            break;
          case "pin":
            setCoopMeInteractionStart(pinned);
            break;
          case "authority":
            originalController.role = "host";
            break;
        }
      }
    });

    logs.flush();
  }, 300_000);

  it("keeps the exact parked Promise across an authenticated channel hot rejoin and resumes once", async () => {
    const boundary = await prepareAuthenticatedBattleSettledHandoffBoundary();
    const { authenticated, hostScene, rig } = boundary;
    const runtime = rig.hostRuntime;
    const generation = coopSessionGeneration();
    const pending = await parkSecondHandoff(boundary);
    const exactPromise = pending.promise;
    const oldMembership = runtime.controller.p33MembershipSnapshot()!;
    const oldLocalFrame = runtime.controller.p33FrameContext()!;
    const oldPeerFrame: CoopFrameContextV1 = {
      ...oldLocalFrame,
      fromSeatId: 1,
      connectionGeneration: authenticated.initialContext.peerConnectionGeneration,
    };
    const shadow = getCoopV2Shadow(runtime)!;
    const rebindIdentity = vi.spyOn(shadow, "rebindIdentity");
    const oldShadowFrame = structuredClone(shadow.authenticatedFrameContext);
    const oldFrontier = shadow.authorityFrontier();
    expect(oldFrontier, "the first battle and settlement established a real retained V2 frontier").not.toBeNull();
    expect(pending.exactDeferredEntry).toMatchObject({
      context: oldShadowFrame,
      revision: oldFrontier!.revision + 1,
      operationId: pending.parked.operationId,
      kind: "INTERACTION_COMMIT",
    });
    expect(runtime.controller.validateP33PeerFrameContext(oldPeerFrame, oldMembership.revision)).toBe(true);
    const replicaInbound = vi.spyOn(authenticated.replicaShadow, "handleInboundFrame");

    const rejoin = beginAuthenticatedMeHotRejoin(authenticated);
    const replacement = await rejoin.replacementReady;
    expect(rejoin.nextContext.pairingBearer, "the Worker-authenticated bearer rotated with the channel").not.toBe(
      authenticated.initialContext.pairingBearer,
    );
    expect(authenticated.localTransport.connectionGeneration(), "the live transport advanced in place").toBe(1);
    expect(runtime.membership.snapshot()).toMatchObject({ state: "recovering", connectionGeneration: 0 });
    expect(runtime.controller.p33FrameContext(), "the replacement channel has not re-proved its binding").toBeNull();
    expect(getCoopV2Shadow(runtime), "the retained shadow is unavailable until authenticated rebind").toBeNull();
    expect(runtime.controller.validateP33PeerFrameContext(oldPeerFrame, oldMembership.revision)).toBe(false);
    expect(
      runtime.controller.adoptP33Rejoin(authenticated.initialContext),
      "the superseded context and bearer cannot roll the authenticated generation back",
    ).toBe(false);
    const replicaBeforeStaleEntry = authenticated.replicaShadow.diagnostics();
    const guestQueueBeforeStaleEntry = authenticated.peerTransport.outboundQueueDepth();
    const livePhaseBeforeStaleEntry = hostScene.phaseManager.getCurrentPhase();
    const liveQueueBeforeStaleEntry = hostScene.phaseManager.getQueuedPhaseNames();
    const liveControlBeforeStaleEntry = structuredClone(captureCoopActiveMysteryControl());
    const staleDeferredFrame = meAuthorityEntryFrame(pending.exactDeferredEntry);
    authenticated.initialReplicaWire.injectRaw(encodeFrameV2(staleDeferredFrame));
    await Promise.resolve();
    expect(
      replicaInbound,
      "the retired WebRTC guest endpoint generation-fences the exact old-context authorityEntry before routing",
    ).not.toHaveBeenCalled();
    expect(authenticated.replicaShadow.diagnostics()).toMatchObject({
      admitted: replicaBeforeStaleEntry.admitted,
      applied: replicaBeforeStaleEntry.applied,
      controlLedgerSize: replicaBeforeStaleEntry.controlLedgerSize,
      shadowStateSize: replicaBeforeStaleEntry.shadowStateSize,
    });
    expect(
      authenticated.peerTransport.outboundQueueDepth(),
      "the superseded entry emits no receipt or queued transport traffic",
    ).toBe(guestQueueBeforeStaleEntry);
    expect(hostScene.phaseManager.getCurrentPhase(), "stale transport traffic cannot replace the live phase").toBe(
      livePhaseBeforeStaleEntry,
    );
    expect(
      hostScene.phaseManager.getQueuedPhaseNames(),
      "stale transport traffic cannot mutate the live phase queue",
    ).toEqual(liveQueueBeforeStaleEntry);
    expect(captureCoopActiveMysteryControl(), "stale transport traffic cannot install terminal control").toEqual(
      liveControlBeforeStaleEntry,
    );
    authenticated.initialAuthorityWire.injectRaw(
      JSON.stringify({
        t: "sessionBindingAck",
        bindingId: authenticated.binding.bindingId,
        seatId: 1,
        accountId: authenticated.initialContext.peerAccount.accountId,
        accepted: true,
      } satisfies CoopMessage),
    );
    expect(runtime.controller.p33FrameContext(), "a frame from the superseded wire is inert").toBeNull();
    expect(pending.promise, "the exact owner handoff Promise survives transport replacement").toBe(exactPromise);
    expect(pending.promiseSettled()).toBe(false);
    expect(pending.rawHandoff).not.toHaveBeenCalled();
    expect(runtime.v2DeferredMeTerminalRedrive, "channel replacement retains the exact parked callback").toBe(
      pending.parked,
    );
    expect(JSON.stringify(runtime.v2DeferredMeTerminalRedrive)).toBe(pending.immutable);

    rejoin.allowBinding();
    await rejoin.driverCompleted;
    await vi.waitFor(
      () => expect(runtime.membership.snapshot()).toMatchObject({ state: "active", connectionGeneration: 1 }),
      { timeout: 2_000, interval: 10 },
    );
    const reboundMembership = runtime.controller.p33MembershipSnapshot()!;
    const reboundLocalFrame = runtime.controller.p33FrameContext()!;
    const reboundPeerFrame: CoopFrameContextV1 = {
      ...reboundLocalFrame,
      fromSeatId: 1,
      connectionGeneration: rejoin.nextContext.peerConnectionGeneration,
    };
    expect(
      rebindIdentity,
      "the authenticated binding-ready lifecycle rebound the retained shadow before any test lookup",
    ).toHaveBeenCalledOnce();
    const reboundFrameBeforeLookup = structuredClone(shadow.authenticatedFrameContext);
    const reboundShadow = getCoopV2Shadow(runtime);
    expect(reboundShadow, "binding-ready reuses the one retained production shadow").toBe(shadow);
    expect(reboundFrameBeforeLookup).toMatchObject({
      sessionId: oldShadowFrame.sessionId,
      runId: oldShadowFrame.runId,
      sessionEpoch: oldShadowFrame.sessionEpoch,
      seatMapId: oldShadowFrame.seatMapId,
      membershipRevision: oldShadowFrame.membershipRevision + 1,
      connectionGeneration: oldShadowFrame.connectionGeneration + 1,
    });
    expect(reboundShadow!.authorityFrontier(), "rebind preserves the global revision/control frontier").toEqual(
      oldFrontier,
    );
    expect(reboundMembership.revision).toBe(oldMembership.revision + 1);
    expect(runtime.controller.validateP33PeerFrameContext(oldPeerFrame, oldMembership.revision)).toBe(false);
    expect(runtime.controller.validateP33PeerFrameContext(reboundPeerFrame, reboundMembership.revision)).toBe(true);
    expect(coopSessionGeneration(), "same-runtime hot rejoin does not create a teardown generation").toBe(generation);
    expect(pending.promise).toBe(exactPromise);
    expect(pending.promiseSettled(), "binding replay cannot resolve the parked gameplay continuation").toBe(false);
    expect(pending.rawHandoff).not.toHaveBeenCalled();
    expect(runtime.v2DeferredMeTerminalRedrive, "authenticated rebind retains the exact parked callback").toBe(
      pending.parked,
    );
    expect(JSON.stringify(runtime.v2DeferredMeTerminalRedrive)).toBe(pending.immutable);

    expect(
      authenticated.replicaShadow.rebindIdentity(
        meReplicaShadowIdentity(
          reboundShadow!.authenticatedFrameContext,
          rejoin.nextContext.peerConnectionGeneration,
        ),
      ),
      "the retained guest shadow rotates only its authenticated membership/channel axes",
    ).toBeGreaterThanOrEqual(0);
    const replicaBeforeFreshEntry = authenticated.replicaShadow.diagnostics();
    const freshDeferredEntry: CoopAuthorityEntry = {
      ...structuredClone(pending.exactDeferredEntry),
      context: structuredClone(reboundShadow!.authenticatedFrameContext),
    };
    expect(freshDeferredEntry).toMatchObject({
      revision: pending.parked.revision,
      operationId: pending.parked.operationId,
      context: {
        membershipRevision: oldShadowFrame.membershipRevision + 1,
        connectionGeneration: oldShadowFrame.connectionGeneration + 1,
      },
    });
    const livePhaseBeforeFreshEntry = hostScene.phaseManager.getCurrentPhase();
    const liveQueueBeforeFreshEntry = hostScene.phaseManager.getQueuedPhaseNames();
    const liveControlBeforeFreshEntry = structuredClone(captureCoopActiveMysteryControl());
    const freshDeferredFrame = meAuthorityEntryFrame(freshDeferredEntry);
    replacement.replica.injectRaw(encodeFrameV2(freshDeferredFrame));
    await Promise.resolve();
    expect(
      replicaInbound,
      "the replacement WebRTC guest receiver routes the fresh-context authorityEntry into the real shadow",
    ).toHaveBeenCalledOnce();
    expect(
      replicaInbound,
      "the replacement receiver decodes the exact fresh-context authorityEntry",
    ).toHaveBeenCalledWith(freshDeferredFrame);
    const replicaAfterFreshEntry = authenticated.replicaShadow.diagnostics();
    expect(replicaAfterFreshEntry).toMatchObject({
      admitted: replicaBeforeFreshEntry.admitted + 1,
      applied: replicaBeforeFreshEntry.applied + 1,
      controlLedgerSize: replicaBeforeFreshEntry.controlLedgerSize + 1,
      shadowStateSize: replicaBeforeFreshEntry.shadowStateSize + 1,
    });
    expect(hostScene.phaseManager.getCurrentPhase(), "replica admission alone cannot replace the owner phase").toBe(
      livePhaseBeforeFreshEntry,
    );
    expect(
      hostScene.phaseManager.getQueuedPhaseNames(),
      "replica admission alone cannot mutate the owner phase queue",
    ).toEqual(liveQueueBeforeFreshEntry);
    expect(captureCoopActiveMysteryControl(), "replica admission alone cannot install owner terminal control").toEqual(
      liveControlBeforeFreshEntry,
    );
    expect(pending.promise, "transport admission cannot replace the exact parked owner Promise").toBe(exactPromise);
    expect(pending.promiseSettled(), "fresh peer traffic alone cannot release the owner continuation").toBe(false);
    expect(pending.rawHandoff).not.toHaveBeenCalled();
    expect(runtime.v2DeferredMeTerminalRedrive).toBe(pending.parked);
    expect(JSON.stringify(runtime.v2DeferredMeTerminalRedrive)).toBe(pending.immutable);

    pending.releaseProof();
    expect(settleCoopV2InteractionOperation(pending.parked.operationId, runtime)).toBe(true);
    await expect(exactPromise).resolves.toBe(true);
    expect(pending.resolutionCount()).toBe(1);
    expect(pending.rawHandoff, "the exact post-rebind proof relays once").toHaveBeenCalledOnce();
    expect(captureCoopActiveMysteryControl()).toMatchObject({
      terminal: "battle",
      terminalStep: 2,
      terminalOperationId: pending.parked.operationId,
      terminalChoice: COOP_ME_BATTLE_HANDOFF,
    });
    expect(captureCoopActiveMysteryControl()!.revision).toBeGreaterThan(pending.priorControl!.revision);
    expect(runtime.v2DeferredMeTerminalRedrive).toBeNull();
    expect(
      withActiveCoopRuntimeOpState(runtime.opState, () =>
        meOp.captureCoopMeDeferredTerminal(pending.parked.operationId),
      ),
    ).toBeNull();
    await vi.waitFor(() => expect(replicaInbound).toHaveBeenCalledTimes(2), { timeout: 2_000, interval: 10 });
    expect(
      replicaInbound,
      "the production proof publishes the same fresh readdressed entry through the replacement receiver",
    ).toHaveBeenNthCalledWith(2, freshDeferredFrame);
    expect(authenticated.replicaShadow.diagnostics()).toMatchObject({
      admitted: replicaAfterFreshEntry.admitted,
      applied: replicaAfterFreshEntry.applied,
      controlLedgerSize: replicaAfterFreshEntry.controlLedgerSize,
      shadowStateSize: replicaAfterFreshEntry.shadowStateSize,
    });

    expect(settleCoopV2InteractionOperation(pending.parked.operationId, runtime)).toBe(true);
    await Promise.resolve();
    expect(pending.rawHandoff, "duplicate proof cannot relay after hot rejoin").toHaveBeenCalledOnce();
    expect(pending.resolutionCount()).toBe(1);
    authenticated.replicaShadow.dispose("authenticated ME receiver proof complete");
    expect(authenticated.replicaShadow.diagnostics()).toMatchObject({ disposed: true, pendingTimers: 0 });

    logs.flush();
  }, 300_000);

  it("shared-terminal freeze cancels a parked handoff once and suppresses every gameplay continuation", async () => {
    const boundary = await prepareBattleSettledHandoffBoundary();
    const { rig } = boundary;

    await withClient(rig.hostCtx, async () => {
      const pending = await parkSecondHandoff(boundary);
      failCoopSharedSession("test-only parked ME terminal freeze");
      await expect(pending.promise).resolves.toBe(false);

      expect(isCoopSharedTerminalFrozen(rig.hostRuntime)).toBe(true);
      expect(pending.resolutionCount()).toBe(1);
      expect(pending.rawHandoff).not.toHaveBeenCalled();
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
      expect(
        withActiveCoopRuntimeOpState(rig.hostRuntime.opState, () =>
          meOp.captureCoopMeDeferredTerminal(pending.parked.operationId),
        ),
      ).toBeNull();
      await Promise.resolve();
      expect(pending.resolutionCount(), "terminal preparation cannot leak or recancel the Promise").toBe(1);
    });

    logs.flush();
  }, 300_000);

  it("session-generation teardown cancels a parked handoff and clears both deferred owners", async () => {
    const boundary = await prepareBattleSettledHandoffBoundary();
    const { rig } = boundary;

    await withClient(rig.hostCtx, async () => {
      const pending = await parkSecondHandoff(boundary);
      const generation = coopSessionGeneration();
      clearCoopRuntime();
      await expect(pending.promise).resolves.toBe(false);

      expect(coopSessionGeneration()).toBe(generation + 1);
      expect(getCoopRuntime()).toBeNull();
      expect(pending.resolutionCount()).toBe(1);
      expect(pending.rawHandoff).not.toHaveBeenCalled();
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
      expect(
        withActiveCoopRuntimeOpState(rig.hostRuntime.opState, () =>
          meOp.captureCoopMeDeferredTerminal(pending.parked.operationId),
        ),
      ).toBeNull();
      await Promise.resolve();
      expect(pending.resolutionCount(), "teardown leaves no unresolved Promise continuation").toBe(1);
    });

    logs.flush();
  }, 300_000);

  it("runtime replacement cancels the old parked handoff before installing the new runtime", async () => {
    const boundary = await prepareBattleSettledHandoffBoundary();
    const { rig } = boundary;
    const replacementPair = createLoopbackPair();
    const replacement = assembleCoopRuntime(replacementPair.host, {
      username: "Replacement Host",
      netcodeMode: "authoritative",
    });
    replacement.controller.role = "host";

    await withClient(rig.hostCtx, async () => {
      const pending = await parkSecondHandoff(boundary);
      clearCoopRuntime();
      setCoopRuntime(replacement);
      await expect(pending.promise).resolves.toBe(false);

      expect(getCoopRuntime()).toBe(replacement);
      expect(pending.resolutionCount()).toBe(1);
      expect(pending.rawHandoff).not.toHaveBeenCalled();
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
      expect(
        withActiveCoopRuntimeOpState(rig.hostRuntime.opState, () =>
          meOp.captureCoopMeDeferredTerminal(pending.parked.operationId),
        ),
      ).toBeNull();
      await Promise.resolve();
      expect(pending.resolutionCount(), "replacement leaves no old-runtime Promise leak").toBe(1);
      clearCoopRuntime();
      replacementPair.guest.close();
    });

    logs.flush();
  }, 300_000);

  it("operation-disabled/no-journal owner handoff uses the compatibility pump once and never installs V2 control", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.FIGHT_OR_FLIGHT, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, async () => {
      setCoopMeOperationEnabled(false);
      setCoopOperationDurability(null);
      expect(isCoopMeOperationEnabled()).toBe(false);
      expect(isCoopOperationJournalActive()).toBe(false);
      const rawHandoff = vi.spyOn(rig.hostRuntime.mePump, "relayMeBattleHandoff");

      await runSelectMysteryEncounterOption(game, 1);
      await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
      expect(hostScene.phaseManager.getCurrentPhase()).toBeInstanceOf(MysteryEncounterBattlePhase);
      expect(rawHandoff, "legacy owner handoff retains its compatibility pump").toHaveBeenCalledOnce();
      expect(rawHandoff).toHaveBeenCalledWith(expect.any(Number), true);
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
      expect(captureCoopActiveMysteryControl()).toMatchObject({ terminal: "pending" });

      const disabledTail = vi.fn();
      const disabledDeferred = vi.fn();
      const plan = {
        result: "victory" as const,
        continuation: "encounter" as const,
        trainerVictory: false,
        rewardSurfaces: [],
        eggLapse: false,
      };
      expect(commitCoopMeBattleSettlementAtBattleEnd(plan, disabledTail, disabledDeferred)).toBe(false);
      setCoopMeOperationEnabled(true);
      expect(isCoopMeOperationEnabled()).toBe(true);
      expect(isCoopOperationJournalActive()).toBe(false);
      expect(commitCoopMeBattleSettlementAtBattleEnd(plan, disabledTail, disabledDeferred)).toBe(false);
      expect(disabledTail).not.toHaveBeenCalled();
      expect(disabledDeferred).not.toHaveBeenCalled();
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
      expect(captureCoopActiveMysteryControl()).toMatchObject({ terminal: "pending" });
      expect(rawHandoff, "settlement no-ops do not manufacture another compatibility relay").toHaveBeenCalledOnce();
    });

    logs.flush();
  }, 300_000);

  it("no-journal no-battle settlement stays unparked and the real legacy reward picker opens", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [
      SpeciesId.SNORLAX,
      SpeciesId.GENGAR,
    ]);
    const hostScene = game.scene;
    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, async () => {
      setCoopMeOperationEnabled(false);
      setCoopOperationDurability(null);
      await runSelectMysteryEncounterOption(game, 1);
      game.onNextPrompt(
        "MysteryEncounterOptionSelectedPhase",
        UiMode.MESSAGE,
        () => hostScene.ui.getMessageHandler().processInput(Button.ACTION),
        () => game.isCurrentPhase("MysteryEncounterRewardsPhase"),
      );
      await game.phaseInterceptor.to("MysteryEncounterRewardsPhase", false);
      const rewards = hostScene.phaseManager.getCurrentPhase();
      expect(rewards?.phaseName).toBe("MysteryEncounterRewardsPhase");
      expect(captureCoopActiveMysteryControl()).toMatchObject({ terminal: "pending" });

      const tail = vi.fn();
      const deferred = vi.fn();
      const plan = {
        result: "victory" as const,
        continuation: "rewards" as const,
        trainerVictory: false,
        rewardSurfaces: [],
        eggLapse: true,
      };
      expect(commitCoopMeNoBattleRewardSettlementAfterPreparation(plan, tail, deferred)).toBe(false);
      setCoopMeOperationEnabled(true);
      expect(isCoopMeOperationEnabled()).toBe(true);
      expect(isCoopOperationJournalActive()).toBe(false);
      expect(commitCoopMeNoBattleRewardSettlementAfterPreparation(plan, tail, deferred)).toBe(false);
      expect(tail).not.toHaveBeenCalled();
      expect(deferred).not.toHaveBeenCalled();
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();

      const rewardsStart = vi.spyOn(rewards, "start");
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      expect(rewardsStart, "the legacy production reward phase runs exactly once").toHaveBeenCalledOnce();
      expect(hostScene.phaseManager.getCurrentPhase()?.phaseName, "legacy rewards still open the real picker").toBe(
        "SelectModifierPhase",
      );
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
      expect(captureCoopActiveMysteryControl()).toMatchObject({ terminal: "pending" });
    });

    logs.flush();
  }, 300_000);

  // =====================================================================================
  // LEG 3 - BATTLE-HANDOFF ME (the #859/#860 phantom class). The committed terminal STATES "battle"
  // BEFORE the guest builds its ME-battle phases, so it routes off the OPERATION, never a leftover chain.
  // =====================================================================================
  it("LEG 3 (battle-handoff): the committed terminal STATES 'battle' before the guest builds phases (#859 structural cure)", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.FIGHT_OR_FLIGHT, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore, "the ME opens on interaction counter 0 (host owns even)").toBe(0);

    const applyMeOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");
    const submitSpy = vi.spyOn(CoopOperationHost.prototype, "submit");
    let blockBattleHandoff = true;
    const originalPrepare = rig.hostRuntime.v2ControlLedger.prepareAuthorityEntry.bind(
      rig.hostRuntime.v2ControlLedger,
    );
    vi.spyOn(rig.hostRuntime.v2ControlLedger, "prepareAuthorityEntry").mockImplementation(entry => {
      if (blockBattleHandoff && authorityMeTerminalKind(entry) === "battle") {
        return null;
      }
      return originalPrepare(entry);
    });
    const rawHandoff = vi.spyOn(rig.hostRuntime.mePump, "relayMeBattleHandoff");

    // Drive the HOST through the BATTLE option. The typed predecessor-control gate must park the exact
    // operation: no phase handoff or compatibility relay may run until the proof edge commits it.
    await withClient(rig.hostCtx, async () => {
      const optionPromise = runSelectMysteryEncounterOption(game, 1);
      await vi.waitFor(() => expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).not.toBeNull());
      const parked = rig.hostRuntime.v2DeferredMeTerminalRedrive;
      expect(parked?.envelope.pendingOperation?.kind).toBe("ME_TERMINAL");
      expect(
        (parked?.envelope.pendingOperation?.payload as { readonly terminal?: string } | undefined)?.terminal,
      ).toBe("battle");
      const parkedOperationId = parked!.operationId;
      const parkedRevision = parked!.revision;
      const parkedEnvelope = JSON.stringify(parked!.envelope);
      const capturedDeferred = meOp.captureCoopMeDeferredTerminal(parkedOperationId);
      expect(capturedDeferred?.operationId).toBe(parkedOperationId);
      expect(capturedDeferred?.revision).toBe(parkedRevision);
      expect(JSON.stringify(capturedDeferred?.envelope)).toBe(parkedEnvelope);
      expect(rawHandoff, "raw battle handoff waits for the typed commit").not.toHaveBeenCalled();
      expect(hostScene.phaseManager.getCurrentPhase()?.phaseName).not.toBe("MysteryEncounterBattlePhase");

      const duplicateRegistrationCancel = vi.fn();
      expect(
        registerCoopMeTerminalRedrive(rig.hostRuntime, parkedOperationId, vi.fn(), duplicateRegistrationCancel),
      ).toBeNull();
      expect(duplicateRegistrationCancel).toHaveBeenCalledOnce();

      blockBattleHandoff = false;
      expect(settleCoopV2InteractionOperation(parkedOperationId, rig.hostRuntime)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      await optionPromise;
      await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
      expect(hostScene.phaseManager.getCurrentPhase()?.phaseName, "host spawned the ME battle").toBe(
        "MysteryEncounterBattlePhase",
      );
      expect(rawHandoff, "the handoff resumes exactly once after the proof edge").toHaveBeenCalledOnce();
      expect(rig.hostRuntime.v2DeferredMeTerminalRedrive).toBeNull();
      expect(meOp.captureCoopMeDeferredTerminal(parkedOperationId)).toBeNull();
      expect(captureCoopActiveMysteryControl()).toMatchObject({
        interactionCounter: counterBefore,
        terminal: "battle",
        terminalOperationId: parkedOperationId,
        terminalStep: 0,
        hostTurn: expect.any(Number),
      });
      expect(parkedRevision).toBeGreaterThan(0);
      expect(parkedEnvelope).toContain(parkedOperationId);
      expect(settleCoopV2InteractionOperation(parkedOperationId, rig.hostRuntime)).toBe(true);
      await Promise.resolve();
      expect(rawHandoff, "duplicate proof callbacks cannot double-run the handoff").toHaveBeenCalledOnce();
    });

    // Drive the guest: the terminal race resolves the 9M battle-handoff; the guest finishes WITHOUT leaving.
    const guestReplay = await withClient(rig.guestCtx, () => driveGuestMeReplay(rig.guestScene));
    expect(guestReplay.settled, "guest CoopReplayMePhase settled at the battle-handoff").toBe(true);

    const terminal = submitSpy.mock.calls.map(call => call[0]).find(intent => intent.kind === "ME_TERMINAL")?.payload;
    expect(meOp.isCompleteCoopMeTerminalPayload(terminal), "battle handoff is a complete retained transaction").toBe(
      true,
    );
    if (meOp.isCompleteCoopMeTerminalPayload(terminal)) {
      expect(terminal.terminal).toBe("battle");
      expect(terminal.destination.kind).toBe("battle");
      expect(terminal.outcome.authoritativeState?.enemyParty.length).toBeGreaterThan(0);
      expect(terminal.outcome.authoritativeState?.double, "the post-degrade battle shape is in the transaction").toBe(
        hostScene.currentBattle.double,
      );
      if (terminal.destination.kind === "battle") {
        expect(terminal.destination.encounterMode).toBe(hostScene.currentBattle.mysteryEncounter?.encounterMode);
        expect(terminal.destination.disableSwitch).toBe(false);
      }
    }

    // The battle state/party is now causally bound to the terminal and applies before its exact boot.
    expect(applyMeOutcomeSpy, "guest applies the battle terminal state exactly once").toHaveBeenCalledTimes(1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest did NOT advance at the battle-handoff").toBe(
      counterBefore,
    );
    expect(rig.guestScene.currentBattle.mysteryEncounter, "guest did NOT leave the encounter").toBeDefined();

    logs.flush();
  }, 300_000);

  // Raw-terminal stale/duplicate tests moved to coop-me-terminal-transaction.test.ts: the retained
  // transaction receiver, not adoptMeWatcherChoice, now owns terminal identity/order/idempotence.
  it("an authoritative terminal retires unconfirmed sub-pick retries before the next encounter", () => {
    vi.useFakeTimers();
    try {
      let retransmits = 0;
      const pinned = 21;
      const id = meOp.commitMeOwnerIntent({
        kind: "ME_SUB",
        seq: 8_000_000 + pinned,
        pinned,
        step: 0,
        payload: { value: 0 },
        localRole: "guest",
        wave: 24,
        turn: 0,
        resend: () => retransmits++,
      });
      expect(id).not.toBeNull();

      vi.advanceTimersByTime(1_000);
      expect(retransmits, "the unconfirmed proposal retries while its encounter is open").toBe(1);

      meOp.settleCoopMeOwnerIntentRetries();
      vi.advanceTimersByTime(10_000);
      expect(retransmits, "the completed encounter cannot retransmit into a later ME").toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
