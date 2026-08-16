/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op POST-BATTLE WAVE-ADVANCE through the AUTHORITATIVE OPERATION PRIMITIVE
// (Wave-2f KEYSTONE; docs/plans/2026-07-10-coop-authoritative-run-state-migration.md §2.5 item 4,
// §8.7). One `it` per TRANSITION CLASS (wild win / trainer victory / biome boundary @10 / ME boundary /
// game-over), each proving the KEYSTONE contract over TWO REAL engines:
//
//   HOST states the complete transition  -> the committed WAVE_ADVANCE op's PAYLOAD (outcome, victoryKind,
//   nextLogicalPhase, biomeChange, meBoundary) is host-authoritative, built from the host's REAL resolving
//   battle context (battleType per #867, isNewBiome). The op is journaled over the REAL durability carrier.
//
//   GUEST adopts the SAME statement -> the journal carrier ROUTES the committed op into the guest's
//   live-mutation sink (the FIRST production sink), carrying the identical host-stated payload. This is the
//   two-engine proof that the guest constructs its tail FROM the op's statement, not a one-bit derivation.
//
// The battle OUTCOME is set at the host's real wave-end commit chokepoint (`broadcastCoopWaveResolved`, the
// exact production call site VictoryPhase / AttemptRunPhase / GameOverPhase use) rather than driven through a
// full battle to each outcome - the wave-advance SURFACE is under test here, not the engine's path to each
// outcome (that is the multiwave / soak suites' job). Both sides are REAL BattleScene engines over the
// loopback, and the commit -> journal -> guest-sink SEAM is fully real.
//
// HOW TO RUN (gated ER_SCENARIO=1):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-wave-operation.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import type { CoopAuthorityEntry } from "#data/elite-redux/coop/authority-v2/contract";
import { getActiveCoopV2WaveCutover } from "#data/elite-redux/coop/authority-v2/cutover-wave";
import { type CoopFrameV2, encodeFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import { validateInboundFrame } from "#data/elite-redux/coop/authority-v2/protocol-validator";
import { setCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import type { CoopWaveAdvancePayload } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  registerCoopOperationLiveSink,
  resetCoopOperationJournalLog,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  assembleCoopRuntime,
  awaitCoopSettledWaveAdvanceAtBattleEnd,
  broadcastCoopWaveEndState,
  broadcastCoopWaveResolved,
  clearCoopRuntime,
  coopRetainedGameOverSupersedesReplay,
  flushCoopWaveResolvedAfterTurnCommit,
  getCoopV2Shadow,
  getCoopWaveBoundaryStatus,
  isCoopSharedTerminalFrozen,
  isCoopV2InteractionHumanInputFrozen,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import {
  type CoopAccountIdentityV1,
  type CoopP33AuthenticatedContextV1,
  createFreshCoopP33Context,
} from "#data/elite-redux/coop/coop-session-binding";
import {
  type CoopMessage,
  type CoopRole,
  type CoopTransport,
  createLoopbackPair,
} from "#data/elite-redux/coop/coop-transport";
import * as waveOp from "#data/elite-redux/coop/coop-wave-operation";
import {
  markCoopWaveAdvanceContinuationReady,
  markCoopWaveAdvanceDataApplied,
  resetCoopWaveAdvanceOperationFlag,
  resetCoopWaveAdvanceOperationState,
  setCoopWaveAdvanceOperationEnabled,
} from "#data/elite-redux/coop/coop-wave-operation";
import { type CoopWireChannel, WebRtcTransport } from "#data/elite-redux/coop/coop-webrtc-transport";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { CoopFinalizeTurnPhase, CoopWaveAdvanceBoundaryPhase } from "#phases/coop-replay-phases";
import { CoopReplayTurnPhase } from "#phases/coop-replay-turn-phase";
import { GameOverPhase } from "#phases/game-over-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  advanceCoopActiveTime,
  buildDuo,
  type ClientCtx,
  clearCoopSchedulerActiveTimeClock,
  type DuoRig,
  disposeDuoRig,
  drainLoopback,
  installCoopSchedulerActiveTimeClock,
  installDuoLogCapture,
  retireDuoInitialCommandForBoundaryTest,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

class DuoHotRejoinWire implements CoopWireChannel {
  readyState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: DuoHotRejoinWire | null = null;
  private messageHandler: ((data: string) => void) | null = null;
  private openHandler: (() => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private readonly deferredInbound: string[] = [];
  private readonly deferInboundDelivery: boolean;

  constructor(deferInboundDelivery = false) {
    this.deferInboundDelivery = deferInboundDelivery;
  }

  send(data: string): void {
    if (this.readyState === "open" && this.peer?.readyState === "open") {
      this.peer.receive(data);
    }
  }

  private receive(data: string): void {
    if (this.deferInboundDelivery) {
      this.deferredInbound.push(data);
      return;
    }
    this.messageHandler?.(data);
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

  onOpen(handler: () => void): void {
    this.openHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  injectRaw(data: string): void {
    this.messageHandler?.(data);
  }

  pumpInbound(kind: "all" | "coop" | "v2" = "all", limit = Number.POSITIVE_INFINITY): number {
    let delivered = 0;
    for (let index = 0; index < this.deferredInbound.length && delivered < limit; ) {
      const data = this.deferredInbound[index]!;
      let isV2 = false;
      try {
        const decoded = JSON.parse(data) as { v?: unknown };
        isV2 = decoded.v === 2;
      } catch {
        // Let the real transport validate malformed non-V2 data when the caller pumps ordinary traffic.
      }
      if ((kind === "coop" && isV2) || (kind === "v2" && !isV2)) {
        index++;
        continue;
      }
      this.deferredInbound.splice(index, 1);
      this.messageHandler?.(data);
      delivered++;
    }
    return delivered;
  }

  fireOpen(): void {
    this.openHandler?.();
  }
}

function createDuoHotRejoinWires(deferInboundDelivery = false): { host: DuoHotRejoinWire; guest: DuoHotRejoinWire } {
  const host = new DuoHotRejoinWire(deferInboundDelivery);
  const guest = new DuoHotRejoinWire(deferInboundDelivery);
  host.peer = guest;
  guest.peer = host;
  return { host, guest };
}

/** Keep WebRTC framing real while deferring V2 delivery into the destination duo context. */
class DuoHotRejoinTransport extends WebRtcTransport {
  private readonly deferredV2Frames: unknown[] = [];
  private readonly receivedV2Frames: CoopFrameV2[] = [];
  private readonly unsubscribeV2Frame: () => void;
  private v2Deferred = false;
  private deferredV2FrameHandler: ((frame: unknown) => void) | null = null;

  constructor(role: CoopRole, wire: CoopWireChannel) {
    super(role, wire);
    this.unsubscribeV2Frame = super.onV2Frame(frame => {
      const ownedFrame = structuredClone(frame);
      const validated = validateInboundFrame(ownedFrame);
      if (validated.kind === "valid") {
        this.receivedV2Frames.push(structuredClone(validated.frame));
      }
      if (this.v2Deferred || this.deferredV2FrameHandler == null) {
        this.deferredV2Frames.push(ownedFrame);
        return;
      }
      this.deferredV2FrameHandler(ownedFrame);
    });
  }

  override onV2Frame(handler: (frame: unknown) => void): () => void {
    this.deferredV2FrameHandler = handler;
    return () => {
      if (this.deferredV2FrameHandler === handler) {
        this.deferredV2FrameHandler = null;
      }
    };
  }

  setV2InboundDeferred(enabled: boolean): void {
    this.v2Deferred = enabled;
  }

  pumpV2Inbound(limit = Number.POSITIVE_INFINITY): number {
    if (this.deferredV2FrameHandler == null) {
      return 0;
    }
    let delivered = 0;
    while (this.deferredV2Frames.length > 0 && delivered < limit) {
      this.deferredV2FrameHandler(this.deferredV2Frames.shift()!);
      delivered++;
    }
    return delivered;
  }

  observedV2Frames(): CoopFrameV2[] {
    return structuredClone(this.receivedV2Frames);
  }

  override close(): void {
    this.deferredV2Frames.length = 0;
    this.deferredV2FrameHandler = null;
    this.unsubscribeV2Frame();
    super.close();
  }
}

interface DuoHotRejoinPair {
  host: DuoHotRejoinTransport;
  guest: DuoHotRejoinTransport;
  readonly initialWires: { host: DuoHotRejoinWire; guest: DuoHotRejoinWire };
  currentWires(): { host: DuoHotRejoinWire; guest: DuoHotRejoinWire };
  pumpWireInbound(role: CoopRole, kind?: "all" | "coop" | "v2"): number;
  replaceChannels(): void;
}

function createDuoHotRejoinPair(options: { deferInboundDelivery?: boolean } = {}): DuoHotRejoinPair {
  const deferInboundDelivery = options.deferInboundDelivery ?? false;
  const initialWires = createDuoHotRejoinWires(deferInboundDelivery);
  const host = new DuoHotRejoinTransport("host", initialWires.host);
  const guest = new DuoHotRejoinTransport("guest", initialWires.guest);
  let activeWires = initialWires;
  if (deferInboundDelivery) {
    host.setV2InboundDeferred(true);
    guest.setV2InboundDeferred(true);
  }
  return {
    host,
    guest,
    initialWires,
    currentWires: () => activeWires,
    pumpWireInbound: (role, kind = "all") => activeWires[role].pumpInbound(kind),
    replaceChannels(): void {
      const replacement = createDuoHotRejoinWires(deferInboundDelivery);
      // Both browser endpoints swap atomically in this one-process fixture. Detach the superseded pair first
      // so closing one old endpoint cannot synthesize a second disconnect on the peer before its own swap.
      activeWires.host.peer = null;
      activeWires.guest.peer = null;
      guest.replaceChannel(replacement.guest);
      host.replaceChannel(replacement.host);
      activeWires = replacement;
    },
  };
}

const P33_AUTHORITY_ACCOUNT: CoopAccountIdentityV1 = {
  version: 1,
  accountId: "er-account:10",
  displayName: "Host",
  canonicalUsername: "host",
};

const P33_REPLICA_ACCOUNT: CoopAccountIdentityV1 = {
  version: 1,
  accountId: "er-account:20",
  displayName: "Guest",
  canonicalUsername: "guest",
};

function authenticatedP33Contexts(generation: number): {
  host: CoopP33AuthenticatedContextV1;
  guest: CoopP33AuthenticatedContextV1;
} {
  const pairingBearer = String.fromCharCode(65 + generation).repeat(43);
  const host = createFreshCoopP33Context({
    pairingId: "WAVE33HOTREJOIN",
    pairingBearer,
    transportRole: "answerer",
    account: P33_AUTHORITY_ACCOUNT,
    peerAccount: P33_REPLICA_ACCOUNT,
    connectionGeneration: generation,
    peerConnectionGeneration: generation,
  });
  const guest = createFreshCoopP33Context({
    pairingId: "WAVE33HOTREJOIN",
    pairingBearer,
    transportRole: "offerer",
    account: P33_REPLICA_ACCOUNT,
    peerAccount: P33_AUTHORITY_ACCOUNT,
    connectionGeneration: generation,
    peerConnectionGeneration: generation,
  });
  if (host == null || guest == null) {
    throw new Error("authenticated wave hot-rejoin fixture rejected its P33 contexts");
  }
  return { host, guest };
}

async function pumpAuthenticatedPairUntil(
  pair: DuoHotRejoinPair,
  hostCtx: ClientCtx,
  guestCtx: ClientCtx,
  kind: "coop" | "v2",
  label: string,
  settled: () => boolean,
): Promise<void> {
  const pump = async (ctx: ClientCtx, role: CoopRole): Promise<void> => {
    await withClient(ctx, async () => {
      pair.pumpWireInbound(role, kind);
      if (kind === "v2") {
        pair[role].pumpV2Inbound();
      }
      await Promise.resolve();
    });
  };
  for (let round = 0; round < 60; round++) {
    await pump(hostCtx, "host");
    await pump(guestCtx, "guest");
    if (settled()) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`authenticated wave fixture did not settle ${label}`);
}

interface AuthenticatedWaveRuntimeRig {
  readonly rig: DuoRig;
  readonly pair: DuoHotRejoinPair;
}

async function buildAuthenticatedWaveRuntimeRig(donor: DuoRig): Promise<AuthenticatedWaveRuntimeRig> {
  const pair = createDuoHotRejoinPair({ deferInboundDelivery: true });
  const initial = authenticatedP33Contexts(0);
  const hostRuntime = assembleCoopRuntime(pair.host, {
    username: "Host",
    netcodeMode: "authoritative",
    p33: initial.host,
  });
  const guestRuntime = assembleCoopRuntime(pair.guest, {
    username: "Guest",
    netcodeMode: "authoritative",
    p33: initial.guest,
  });
  const hostCtx: ClientCtx = {
    ...donor.hostCtx,
    runtime: hostRuntime,
    pumpInbound: () => pair.pumpWireInbound("host") + pair.host.pumpV2Inbound(),
  };
  const guestCtx: ClientCtx = {
    ...donor.guestCtx,
    runtime: guestRuntime,
    pumpInbound: () => pair.pumpWireInbound("guest") + pair.guest.pumpV2Inbound(),
  };
  const rig: DuoRig = {
    hostScene: donor.hostScene,
    guestScene: donor.guestScene,
    hostRuntime,
    guestRuntime,
    hostCtx,
    guestCtx,
    pair,
  };

  try {
    withClientSync(guestCtx, () => guestRuntime.controller.armResumeStartNewHandler(() => {}));
    withClientSync(hostCtx, () => hostRuntime.controller.connect());
    withClientSync(guestCtx, () => guestRuntime.controller.connect());
    const startNew = withClientSync(hostCtx, () => hostRuntime.controller.sendResumeStartNew(300_000));
    await pumpAuthenticatedPairUntil(pair, hostCtx, guestCtx, "coop", "initial P33 binding", () => {
      return (
        hostRuntime.controller.p33MembershipSnapshot() != null
        && guestRuntime.controller.p33MembershipSnapshot() != null
      );
    });
    if (!(await startNew)) {
      throw new Error("authenticated wave fixture did not acknowledge its start-new boundary");
    }
    return { rig, pair };
  } catch (error) {
    disposeDuoRig(rig);
    throw error;
  }
}

async function rotateAuthenticatedWaveCarrier(fixture: AuthenticatedWaveRuntimeRig, generation: number): Promise<void> {
  const { rig, pair } = fixture;
  const next = authenticatedP33Contexts(generation);
  const hostAdopted = withClientSync(rig.hostCtx, () => rig.hostRuntime.controller.adoptP33Rejoin(next.host));
  const guestAdopted = withClientSync(rig.guestCtx, () => rig.guestRuntime.controller.adoptP33Rejoin(next.guest));
  if (!hostAdopted || !guestAdopted) {
    throw new Error(`authenticated wave fixture refused generation ${generation}`);
  }
  pair.replaceChannels();
  withClientSync(rig.hostCtx, () => rig.hostRuntime.controller.resyncLobbyState());
  withClientSync(rig.guestCtx, () => rig.guestRuntime.controller.resyncLobbyState());
  await pumpAuthenticatedPairUntil(pair, rig.hostCtx, rig.guestCtx, "coop", `P33 generation ${generation}`, () => {
    return (
      rig.hostRuntime.controller.p33MembershipSnapshot()?.revision === generation + 1
      && rig.guestRuntime.controller.p33MembershipSnapshot()?.revision === generation + 1
    );
  });
  const hostShadow = await withClient(rig.hostCtx, () => getCoopV2Shadow(rig.hostRuntime));
  const guestShadow = await withClient(rig.guestCtx, () => getCoopV2Shadow(rig.guestRuntime));
  if (hostShadow == null || guestShadow == null) {
    throw new Error(`authenticated wave fixture did not rebind generation ${generation}`);
  }
}

describe.skipIf(!RUN)("co-op DUO wave-advance via the operation primitive - per transition class (Wave-2f)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let detachedAuthenticatedRig: DuoRig | null = null;
  /** The decoded V2 WAVE_ADVANCE payloads admitted by the guest replica. */
  let routed: CoopWaveAdvancePayload[];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`wave-op-${Date.now()}`);
    setCoopWaveAdvanceOperationEnabled(true);
    resetCoopWaveAdvanceOperationState();
    resetCoopOperationJournalLog();
    setCoopDurabilityEnabled(true);
    detachedAuthenticatedRig = null;
    routed = [];
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    if (detachedAuthenticatedRig != null) {
      disposeDuoRig(detachedAuthenticatedRig);
      detachedAuthenticatedRig = null;
    }
    clearCoopSchedulerActiveTimeClock();
    registerCoopOperationLiveSink("op:wave", null);
    resetCoopOperationJournalLog();
    resetCoopWaveAdvanceOperationFlag();
    resetCoopWaveAdvanceOperationState();
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host scene for the NEXT ER_SCENARIO file's GameManager.
    initGlobalScene(game.scene);
    vi.restoreAllMocks();
  });

  afterAll(() => {
    // best-effort
  });

  /** Boot the host into a live battle + stand up the duo rig. */
  async function bootDuo(
    options: {
      preserveProductionWaveSink?: boolean;
      startingWave?: number;
      pair?: { host: CoopTransport; guest: CoopTransport };
    } = {},
  ): Promise<DuoRig> {
    if (options.startingWave != null) {
      game.override.startingWave(options.startingWave);
    }
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
    const rig = await buildDuo(game, options.pair ?? createLoopbackPair(), setCoopRuntime, toCoop);
    if (options.startingWave != null) {
      expect(rig.hostScene.currentBattle.waveIndex, "the initial V2 command belongs to the tested wave").toBe(
        options.startingWave,
      );
      expect(rig.guestScene.currentBattle.waveIndex, "the guest mirrored the tested command address").toBe(
        options.startingWave,
      );
    }
    expect(rig.hostRuntime.waveOperationBinding.opState).toBe(rig.hostRuntime.opState);
    expect(rig.hostRuntime.waveOperationBinding.durability).toBe(rig.hostRuntime.durability);
    expect(Object.isFrozen(rig.hostRuntime.waveOperationBinding)).toBe(true);
    expect(rig.guestRuntime.waveOperationBinding.opState).toBe(rig.guestRuntime.opState);
    expect(rig.guestRuntime.waveOperationBinding.durability).toBe(rig.guestRuntime.durability);
    expect(Object.isFrozen(rig.guestRuntime.waveOperationBinding)).toBe(true);
    expect(rig.guestRuntime.waveOperationBinding.opState).not.toBe(rig.hostRuntime.waveOperationBinding.opState);
    if (!options.preserveProductionWaveSink) {
      // Runtime assembly installs the receiver-bound production sink. Override it only after assembly for
      // boundary-seam recording tests; production materialization is selected explicitly by regressions
      // that need to execute the real retained-transition bootstrap.
      registerCoopOperationLiveSink("op:wave", env => {
        const payload = env.pendingOperation?.payload as CoopWaveAdvancePayload;
        routed.push(payload);
        markCoopWaveAdvanceDataApplied(payload.wave, rig.guestRuntime.waveOperationBinding);
        markCoopWaveAdvanceContinuationReady(payload.wave, rig.guestRuntime.waveOperationBinding);
        return true;
      });
    }
    return rig;
  }

  /**
   * Drive the host's REAL wave-end commit chokepoint under a chosen battle context, then pump the loopback
   * so the guest admits the ordered V2 entry. Returns the host-committed payload (the authority statement).
   */
  async function commitAndDeliver(
    rig: DuoRig,
    outcome: "win" | "capture" | "flee" | "gameOver",
    ctx: { battleType?: BattleType; waveIndex?: number },
  ): Promise<CoopWaveAdvancePayload | undefined> {
    const committedBefore = getCoopV2Shadow(rig.hostRuntime)?.diagnostics().committed ?? 0;
    await withClient(rig.hostCtx, () => {
      if (ctx.battleType !== undefined) {
        rig.hostScene.currentBattle.battleType = ctx.battleType;
      }
      if (ctx.waveIndex !== undefined) {
        expect(
          rig.hostScene.currentBattle.waveIndex,
          "the wave boundary must follow the exact command/turn address that booted the fixture",
        ).toBe(ctx.waveIndex);
      }
      // Normal wave outcomes are first staged while the final turn is still recording. Authority V2
      // correctly refuses a WAVE_ADVANCE directly behind COMMAND, so retire that real command below before
      // BattleEnd seals the transition. GameOver has no BattleEnd and is opened only after the turn wait.
      if (outcome !== "gameOver") {
        broadcastCoopWaveResolved(outcome);
      }
    });
    await retireDuoInitialCommandForBoundaryTest(rig);
    await withClient(rig.hostCtx, () => {
      if (outcome === "gameOver") {
        broadcastCoopWaveResolved(outcome);
      } else {
        if (outcome === "win") {
          expect(flushCoopWaveResolvedAfterTurnCommit(rig.hostScene.currentBattle.waveIndex)).toBe(true);
        }
        broadcastCoopWaveEndState(outcome === "win" || outcome === "capture");
      }
    });
    expect(
      getCoopV2Shadow(rig.hostRuntime)?.diagnostics().committed,
      "the host committed TURN_COMMIT then exactly one ordered wave/terminal boundary",
    ).toBe(committedBefore + 2);
    // Pump delivery under the GUEST ctx so the decoded entry is admitted by that replica, never by
    // whichever process-global scene happened to commit it.
    return withClient(rig.guestCtx, () => {
      return drainLoopback().then(() => {
        const status = getCoopWaveBoundaryStatus(
          ctx.waveIndex ?? rig.guestScene.currentBattle.waveIndex,
          rig.guestRuntime,
        );
        expect(status?.authority, "the guest observed the decoded Authority V2 boundary").toBe("v2");
        expect(status?.operationId, "the guest admitted an immutable V2 operation identity").toMatch(/^V2\//);
        expect(status?.entryRevision, "the guest admitted the authority's ordered log revision").toBeGreaterThan(0);
        if (status != null) {
          routed.push(status.transition);
        }
        return status?.transition;
      });
    });
  }

  it("still commits and routes the complete transaction when both raw wave carriers are dropped", async () => {
    const rig = await bootDuo({ startingWave: 2 });
    vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved").mockImplementation(() => {
      throw new Error("drop raw waveResolved");
    });
    vi.spyOn(rig.hostRuntime.battleStream, "sendWaveEndState").mockImplementation(() => {
      throw new Error("drop raw waveEndState");
    });

    const committed = await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 2 });

    expect(committed?.settledStateTick, "the raw drop cannot suppress the retained state image").toBeGreaterThan(0);
    expect(
      routed.map(payload => payload.wave),
      "the guest advances from the envelope alone",
    ).toContain(2);
    logs.flush();
  }, 300_000);

  it("withholds the raw victory hint until the material final-turn commit boundary", async () => {
    const rig = await bootDuo({ startingWave: 3 });
    const raw = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved");

    await withClient(rig.hostCtx, () => {
      broadcastCoopWaveResolved("win");
      expect(raw, "Victory may stage its transition but cannot publish ahead of turn authority").not.toHaveBeenCalled();
    });
    await retireDuoInitialCommandForBoundaryTest(rig);
    await withClient(rig.hostCtx, () => {
      expect(flushCoopWaveResolvedAfterTurnCommit(3)).toBe(true);
    });

    expect(raw, "the compatibility hint publishes exactly once after successful turn retention").toHaveBeenCalledOnce();
    logs.flush();
  }, 300_000);

  it("parks a real early-game-over terminal without raw compatibility, ignores duplicate callbacks, and cancels its microtask redrive on teardown", async () => {
    const rig = await bootDuo({ startingWave: 7 });
    const rawResolved = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved");
    const rawEndState = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveEndState");
    const originalPrepare = rig.hostRuntime.v2ControlLedger.prepareAuthorityEntry.bind(rig.hostRuntime.v2ControlLedger);
    vi.spyOn(rig.hostRuntime.v2ControlLedger, "prepareAuthorityEntry").mockImplementation(entry => {
      if (entry.kind === "WAVE_ADVANCE" || entry.kind === "TERMINAL_COMMIT") {
        return null;
      }
      return originalPrepare(entry);
    });

    await withClient(rig.hostCtx, () => broadcastCoopWaveResolved("gameOver"));
    const parked = rig.hostRuntime.v2DeferredHostBoundary;
    expect(parked).not.toBeNull();
    expect(parked).toMatchObject({
      kind: "terminal",
      wave: 7,
      compatibility: { kind: "wave-resolved", outcome: "gameOver" },
    });
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).not.toHaveBeenCalled();

    const parkedState = parked?.authoritativeState;
    rig.hostScene.currentBattle.turn += 1;
    await withClient(rig.hostCtx, () => {
      broadcastCoopWaveResolved("gameOver");
      broadcastCoopWaveEndState(false);
    });
    expect(rig.hostRuntime.v2DeferredHostBoundary).toBe(parked);
    expect(rig.hostRuntime.v2DeferredHostBoundary?.authoritativeState).toBe(parkedState);
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).not.toHaveBeenCalled();

    await withClient(rig.hostCtx, () => clearCoopRuntime());
    await Promise.resolve();
    expect(rig.hostRuntime.v2DeferredHostBoundary).toBeNull();
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).not.toHaveBeenCalled();
    logs.flush();
  }, 300_000);

  it("commits a parked early-game-over terminal through the proof edge and emits one waveResolved carrier", async () => {
    const rig = await bootDuo({ startingWave: 7 });
    const rawResolved = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved");
    const rawEndState = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveEndState");
    let blockBoundary = true;
    const originalPrepare = rig.hostRuntime.v2ControlLedger.prepareAuthorityEntry.bind(rig.hostRuntime.v2ControlLedger);
    vi.spyOn(rig.hostRuntime.v2ControlLedger, "prepareAuthorityEntry").mockImplementation(entry => {
      if (blockBoundary && (entry.kind === "WAVE_ADVANCE" || entry.kind === "TERMINAL_COMMIT")) {
        return null;
      }
      return originalPrepare(entry);
    });

    await retireDuoInitialCommandForBoundaryTest(rig);
    await withClient(rig.hostCtx, () => broadcastCoopWaveResolved("gameOver"));
    expect(rig.hostRuntime.v2DeferredHostBoundary).toMatchObject({
      kind: "terminal",
      compatibility: { kind: "wave-resolved", outcome: "gameOver" },
    });
    await withClient(rig.hostCtx, () => {
      broadcastCoopWaveResolved("gameOver");
      broadcastCoopWaveEndState(false);
    });
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).not.toHaveBeenCalled();

    blockBoundary = false;
    await withClient(rig.hostCtx, async () => {
      isCoopV2InteractionHumanInputFrozen(rig.hostRuntime);
      await Promise.resolve();
    });
    expect(rig.hostRuntime.v2DeferredHostBoundary).toBeNull();
    expect(rawResolved).toHaveBeenCalledOnce();
    expect(rawEndState).not.toHaveBeenCalled();
    expect(getCoopV2Shadow(rig.hostRuntime)?.diagnostics()).toMatchObject({ committed: 2 });

    await withClient(rig.hostCtx, () => broadcastCoopWaveResolved("gameOver"));
    expect(rawResolved).toHaveBeenCalledOnce();
    logs.flush();
  }, 300_000);

  it("parks a real BattleEnd wave, preserves it across hot rejoin, and sends waveEndState exactly once", async () => {
    installCoopSchedulerActiveTimeClock();
    const rejoinPair = createDuoHotRejoinPair();
    const rig = await bootDuo({ startingWave: 3, pair: rejoinPair });
    const guestCompatibilityMessages: CoopMessage[] = [];
    const unsubscribeGuestCompatibility = rig.guestRuntime.localTransport.onMessage(message => {
      if (message.t === "waveResolved" || message.t === "waveEndState") {
        guestCompatibilityMessages.push(structuredClone(message));
      }
    });
    const hostGenerationAtBoot = rejoinPair.host.connectionGeneration();
    const guestGenerationAtBoot = rejoinPair.guest.connectionGeneration();
    expect(rejoinPair.host.state, "the real host WebRTC transport booted on an open channel").toBe("connected");
    expect(rejoinPair.guest.state, "the real guest WebRTC transport booted on an open channel").toBe("connected");
    expect(rig.hostRuntime.localTransport.state).toBe("connected");
    expect(rig.guestRuntime.localTransport.state).toBe("connected");
    expect(rig.hostRuntime.localTransport.connectionGeneration?.()).toBe(hostGenerationAtBoot);
    expect(rig.guestRuntime.localTransport.connectionGeneration?.()).toBe(guestGenerationAtBoot);
    const rawResolved = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved");
    const rawEndState = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveEndState");
    let blockBoundary = true;
    const originalPrepare = rig.hostRuntime.v2ControlLedger.prepareAuthorityEntry.bind(rig.hostRuntime.v2ControlLedger);
    vi.spyOn(rig.hostRuntime.v2ControlLedger, "prepareAuthorityEntry").mockImplementation(entry => {
      if (blockBoundary && (entry.kind === "WAVE_ADVANCE" || entry.kind === "TERMINAL_COMMIT")) {
        return null;
      }
      return originalPrepare(entry);
    });

    await withClient(rig.hostCtx, () => broadcastCoopWaveResolved("win"));
    await retireDuoInitialCommandForBoundaryTest(rig);
    await withClient(rig.hostCtx, () => broadcastCoopWaveEndState(true));

    const parked = rig.hostRuntime.v2DeferredHostBoundary;
    expect(parked).not.toBeNull();
    if (parked == null) {
      logs.flush();
      return;
    }
    expect(parked).toMatchObject({
      kind: "wave",
      wave: 3,
      transition: { outcome: "win", wave: 3 },
      compatibility: { kind: "wave-end" },
    });
    expect(parked.authoritativeState).toBeDefined();
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).not.toHaveBeenCalled();

    const parkedState = parked.authoritativeState;
    rig.hostScene.currentBattle.turn += 1;
    await withClient(rig.hostCtx, () => {
      broadcastCoopWaveResolved("win");
      broadcastCoopWaveEndState(true);
    });
    expect(rig.hostRuntime.v2DeferredHostBoundary).toBe(parked);
    expect(rig.hostRuntime.v2DeferredHostBoundary?.authoritativeState).toBe(parkedState);
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).not.toHaveBeenCalled();

    expect(Object.isFrozen(parked)).toBe(true);
    expect(Object.isFrozen(parked.entry)).toBe(true);
    expect(Object.isFrozen(parked.entry.context)).toBe(true);
    expect(Object.isFrozen(parked.entry.material)).toBe(true);
    expect(Object.isFrozen(parked.entry.subsumes)).toBe(true);

    const hostShadow = await withClient(rig.hostCtx, () => getCoopV2Shadow(rig.hostRuntime));
    const guestShadow = await withClient(rig.guestCtx, () => getCoopV2Shadow(rig.guestRuntime));
    expect(hostShadow).not.toBeNull();
    expect(guestShadow).not.toBeNull();
    if (hostShadow == null || guestShadow == null) {
      logs.flush();
      return;
    }
    const hostContext = hostShadow.authenticatedFrameContext;
    const guestContext = guestShadow.authenticatedFrameContext;
    expect(hostContext.connectionGeneration).toBe(hostGenerationAtBoot);
    expect(guestContext.connectionGeneration).toBe(guestGenerationAtBoot);
    const { context: staleAuthorityContext, ...staleAuthorityBody } = parked.entry;
    const staleAuthorityFrame: CoopFrameV2 = {
      v: 2,
      t: "authorityEntry",
      ctx: staleAuthorityContext,
      body: staleAuthorityBody,
    };
    const staleAuthorityWire = encodeFrameV2(staleAuthorityFrame);
    expect(staleAuthorityFrame.ctx).toBe(parked.entry.context);
    expect(staleAuthorityFrame.ctx).toEqual(hostContext);
    const parkedImage = structuredClone(parked);
    const parkedRevision = parked.revision;
    const expectedGuestCompatibilityMessages = JSON.parse(
      JSON.stringify([{ t: "waveEndState", wave: 3, state: parked.authoritativeState }]),
    ) as CoopMessage[];
    const hostMembershipBeforeRejoin = rig.hostRuntime.membership.snapshot();
    const guestMembershipBeforeRejoin = rig.guestRuntime.membership.snapshot();
    const timersBeforeRejoin = hostShadow.diagnostics().pendingTimers;
    expect(timersBeforeRejoin, "the parked wave owns no retry timer before proof").toBe(0);
    const guestDurability = rig.guestRuntime.durability;
    expect(guestDurability).not.toBeNull();
    if (guestDurability == null) {
      unsubscribeGuestCompatibility();
      logs.flush();
      return;
    }
    const guestDurabilityReconnect = vi.spyOn(guestDurability, "reconnect");
    let releaseHostRejoin!: () => void;
    let releaseGuestRejoin!: () => void;
    const hostRejoinGate = new Promise<void>(resolve => {
      releaseHostRejoin = resolve;
    });
    const guestRejoinGate = new Promise<void>(resolve => {
      releaseGuestRejoin = resolve;
    });
    let replacementCount = 0;
    rig.hostRuntime.rejoinDriver = async (): Promise<boolean> => {
      await hostRejoinGate;
      if (replacementCount === 0) {
        rejoinPair.replaceChannels();
        replacementCount++;
      }
      return true;
    };
    rig.guestRuntime.rejoinDriver = async (): Promise<boolean> => {
      await guestRejoinGate;
      return true;
    };

    let hostRecoveringMembership = hostMembershipBeforeRejoin;
    let guestRecoveringMembership = guestMembershipBeforeRejoin;
    withClientSync(rig.hostCtx, () => {
      rejoinPair.initialWires.host.close();
      hostRecoveringMembership = rig.hostRuntime.membership.snapshot();
      guestRecoveringMembership = rig.guestRuntime.membership.snapshot();
    });
    expect(hostRecoveringMembership, "the host runtime marks only its guest peer absent on carrier loss").toEqual({
      ...hostMembershipBeforeRejoin,
      state: "recovering",
      revision: hostMembershipBeforeRejoin.revision + 1,
      members: [
        { ...hostMembershipBeforeRejoin.members[0], present: true },
        { ...hostMembershipBeforeRejoin.members[1], present: false },
      ],
    });
    expect(guestRecoveringMembership, "the guest runtime marks only its host peer absent on carrier loss").toEqual({
      ...guestMembershipBeforeRejoin,
      state: "recovering",
      revision: guestMembershipBeforeRejoin.revision + 1,
      members: [
        { ...guestMembershipBeforeRejoin.members[0], present: false },
        { ...guestMembershipBeforeRejoin.members[1], present: true },
      ],
    });

    await withClient(rig.hostCtx, async () => {
      releaseHostRejoin();
      for (let turn = 0; turn < 12 && rig.hostRuntime.membership.snapshot().state !== "active"; turn++) {
        await Promise.resolve();
      }
    });
    expect(replacementCount).toBe(1);
    expect(rejoinPair.initialWires.host.readyState).toBe("closed");
    expect(rejoinPair.initialWires.guest.readyState).toBe("closed");
    expect(rejoinPair.host.state).toBe("connected");
    expect(rejoinPair.guest.state).toBe("connected");
    expect(rejoinPair.host.connectionGeneration()).toBe(hostGenerationAtBoot + 1);
    expect(rejoinPair.guest.connectionGeneration()).toBe(guestGenerationAtBoot + 1);
    expect(rig.hostRuntime.membership.snapshot()).toEqual({
      ...hostRecoveringMembership,
      state: "active",
      revision: hostRecoveringMembership.revision + 1,
      connectionGeneration: rejoinPair.host.connectionGeneration(),
      members: [
        { ...hostRecoveringMembership.members[0], present: true },
        { ...hostRecoveringMembership.members[1], present: true },
      ],
    });
    expect(
      rig.guestRuntime.membership.snapshot(),
      "the unresolved guest driver cannot borrow the host's active completion context",
    ).toEqual(guestRecoveringMembership);

    const reboundHostShadow = await withClient(rig.hostCtx, () => getCoopV2Shadow(rig.hostRuntime));
    const reboundCutover = await withClient(rig.hostCtx, () => getActiveCoopV2WaveCutover());
    expect(reboundHostShadow).toBe(hostShadow);
    expect(reboundHostShadow?.authenticatedFrameContext).toEqual({
      ...hostContext,
      connectionGeneration: hostContext.connectionGeneration + 1,
    });
    expect(reboundCutover?.authenticatedFrameContext).toEqual(reboundHostShadow?.authenticatedFrameContext);
    expect(hostShadow.diagnostics().pendingTimers).toBe(timersBeforeRejoin);

    await withClient(rig.guestCtx, async () => {
      releaseGuestRejoin();
      for (let turn = 0; turn < 12 && rig.guestRuntime.membership.snapshot().state !== "active"; turn++) {
        await Promise.resolve();
      }
    });
    expect(rig.guestRuntime.membership.snapshot()).toEqual({
      ...guestRecoveringMembership,
      state: "active",
      revision: guestRecoveringMembership.revision + 1,
      connectionGeneration: rejoinPair.guest.connectionGeneration(),
      members: [
        { ...guestRecoveringMembership.members[0], present: true },
        { ...guestRecoveringMembership.members[1], present: true },
      ],
    });
    expect(
      guestDurabilityReconnect,
      "guest completion runs its production durability resync exactly once",
    ).toHaveBeenCalledOnce();
    expect(
      guestShadow.authenticatedFrameContext,
      "the guest completion rebound the retained shadow before this test queried the public accessor again",
    ).toEqual({
      ...guestContext,
      connectionGeneration: guestContext.connectionGeneration + 1,
    });
    const reboundGuestShadow = await withClient(rig.guestCtx, () => getCoopV2Shadow(rig.guestRuntime));
    expect(reboundGuestShadow).toBe(guestShadow);
    expect(rig.hostRuntime.v2DeferredHostBoundary).toBe(parked);
    expect(rig.hostRuntime.v2DeferredHostBoundary?.entry).toBe(parked.entry);
    expect(rig.hostRuntime.v2DeferredHostBoundary).toEqual(parkedImage);
    expect(parked.revision).toBe(parkedRevision);
    expect(parked.entry.context).toEqual(hostContext);
    expect(parked.entry.context).not.toEqual(reboundHostShadow?.authenticatedFrameContext);
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).not.toHaveBeenCalled();

    blockBoundary = false;
    const staleDeliveriesBefore = rejoinPair.guest.observedV2Frames().filter(frame => {
      return (
        frame.t === "authorityEntry"
        && frame.body.operationId === parked.operationId
        && frame.ctx.membershipRevision === hostContext.membershipRevision
        && frame.ctx.connectionGeneration === hostContext.connectionGeneration
      );
    }).length;
    withClientSync(rig.guestCtx, () => {
      rejoinPair.initialWires.guest.injectRaw(staleAuthorityWire);
      rejoinPair.initialWires.guest.fireOpen();
    });
    expect(
      rejoinPair.guest.observedV2Frames().filter(frame => {
        return (
          frame.t === "authorityEntry"
          && frame.body.operationId === parked.operationId
          && frame.ctx.membershipRevision === hostContext.membershipRevision
          && frame.ctx.connectionGeneration === hostContext.connectionGeneration
        );
      }),
      "the superseded guest wire cannot deliver the old-context authority entry to the live transport",
    ).toHaveLength(staleDeliveriesBefore);
    expect(rejoinPair.guest.state).toBe("connected");
    expect(
      rig.hostRuntime.v2DeferredHostBoundary,
      "the exact old authority entry on the superseded guest receive path cannot release the parked boundary",
    ).toBe(parked);
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).not.toHaveBeenCalled();
    expect(guestCompatibilityMessages).toEqual([]);

    const guestFramesBeforeRedrive = rejoinPair.guest.observedV2Frames().length;
    await withClient(rig.hostCtx, async () => {
      isCoopV2InteractionHumanInputFrozen(rig.hostRuntime);
      await Promise.resolve();
    });
    expect(rig.hostRuntime.v2DeferredHostBoundary).toBeNull();
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).toHaveBeenCalledOnce();
    expect(rawEndState).toHaveBeenCalledWith(3, parked.authoritativeState);
    const committedWaveFrames = rejoinPair.guest
      .observedV2Frames()
      .slice(guestFramesBeforeRedrive)
      .filter(frame => {
        return (
          frame.t === "authorityEntry"
          && frame.body.operationId === parked.operationId
          && frame.body.revision === parkedRevision
        );
      });
    expect(committedWaveFrames.length).toBeGreaterThanOrEqual(1);
    expect(
      committedWaveFrames.every(frame => frame.ctx.connectionGeneration === hostContext.connectionGeneration + 1),
    ).toBe(true);
    expect(
      committedWaveFrames.every(frame => JSON.stringify(frame.body) === JSON.stringify(staleAuthorityBody)),
      "hot rejoin changed only the authority envelope context, never its frozen body",
    ).toBe(true);
    expect(
      guestCompatibilityMessages,
      "raw compatibility remains queued until the guest replacement-carrier inbox is pumped",
    ).toEqual([]);

    await withClient(rig.hostCtx, async () => {
      isCoopV2InteractionHumanInputFrozen(rig.hostRuntime);
      advanceCoopActiveTime(1_000);
      await Promise.resolve();
    });
    const legalWindowDeliveries = rejoinPair.guest.observedV2Frames().filter(frame => {
      return (
        frame.t === "authorityEntry"
        && frame.body.operationId === parked.operationId
        && frame.body.revision === parkedRevision
      );
    });
    expect(legalWindowDeliveries.length, "the retained entry was redelivered before its exact receipt").toBeGreaterThan(
      1,
    );
    expect(
      new Set(legalWindowDeliveries.map(frame => encodeFrameV2(frame))).size,
      "every legal-window retry preserves the exact readdressed authority frame",
    ).toBe(1);
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).toHaveBeenCalledOnce();

    await withClient(rig.guestCtx, () => drainLoopback());
    expect(guestCompatibilityMessages).toEqual(expectedGuestCompatibilityMessages);
    expect(
      guestShadow.authorityFrontier(),
      "the guest admitted the exact readdressed wave entry from the replacement carrier",
    ).toMatchObject({ revision: parkedRevision, operationId: parked.operationId });
    expect(await withClient(rig.guestCtx, () => getCoopWaveBoundaryStatus(3, rig.guestRuntime))).toBeNull();
    await withClient(rig.hostCtx, () => drainLoopback());
    expect(hostShadow.diagnostics()).toMatchObject({ retained: 0, pendingTimers: timersBeforeRejoin });

    await withClient(rig.hostCtx, async () => {
      isCoopV2InteractionHumanInputFrozen(rig.hostRuntime);
      await Promise.resolve();
    });
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).toHaveBeenCalledOnce();
    await withClient(rig.guestCtx, () => drainLoopback());
    expect(guestCompatibilityMessages).toEqual(expectedGuestCompatibilityMessages);
    const liveDeliveriesBeforeFinalStale = rejoinPair.guest.observedV2Frames().filter(frame => {
      return frame.t === "authorityEntry" && frame.body.operationId === parked.operationId;
    }).length;
    withClientSync(rig.guestCtx, () => {
      rejoinPair.initialWires.guest.injectRaw(staleAuthorityWire);
      rejoinPair.initialWires.guest.fireOpen();
    });
    expect(
      rejoinPair.guest.observedV2Frames().filter(frame => {
        return frame.t === "authorityEntry" && frame.body.operationId === parked.operationId;
      }),
    ).toHaveLength(liveDeliveriesBeforeFinalStale);
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).toHaveBeenCalledOnce();
    expect(isCoopSharedTerminalFrozen(rig.hostRuntime)).toBe(false);
    expect(isCoopSharedTerminalFrozen(rig.guestRuntime)).toBe(false);
    unsubscribeGuestCompatibility();
    disposeDuoRig(rig);
    expect(hostShadow.diagnostics()).toMatchObject({ disposed: true, retained: 0, pendingTimers: 0 });
    expect(guestShadow.diagnostics()).toMatchObject({ disposed: true, retained: 0, pendingTimers: 0 });
    logs.flush();
  }, 300_000);

  it("completes authenticated P33 hot-rejoin recovery on the live replacement carrier", async () => {
    installCoopSchedulerActiveTimeClock();
    const donor = await bootDuo({ preserveProductionWaveSink: true, startingWave: 3 });
    disposeDuoRig(donor);

    const fixture = await buildAuthenticatedWaveRuntimeRig(donor);
    const { rig, pair } = fixture;
    detachedAuthenticatedRig = rig;
    const hostShadow = await withClient(rig.hostCtx, () => getCoopV2Shadow(rig.hostRuntime));
    const guestShadow = await withClient(rig.guestCtx, () => getCoopV2Shadow(rig.guestRuntime));
    expect(hostShadow).not.toBeNull();
    expect(guestShadow).not.toBeNull();
    if (hostShadow == null || guestShadow == null) {
      throw new Error("authenticated wave recovery did not install both V2 shadows");
    }
    const guestDurability = rig.guestRuntime.durability;
    if (guestDurability == null) {
      throw new Error("authenticated wave recovery requires the production durability binding");
    }
    const guestDurabilityReconnect = vi.spyOn(guestDurability, "reconnect");
    expect(rig.hostRuntime.controller.p33MembershipSnapshot()).toMatchObject({ revision: 1, state: "active" });
    expect(rig.guestRuntime.controller.p33MembershipSnapshot()).toMatchObject({ revision: 1, state: "active" });

    // Enter the actual disconnect with one already-authenticated retained-binding rotation in history.
    // P33 revisions count accepted carrier generations; the runtime membership counts loss + recovery.
    // That calibrated history makes both independently monotonic models converge at revision 3 after the
    // production disconnect/rejoin below, so recovery proves the live identity instead of a compatibility one.
    await rotateAuthenticatedWaveCarrier(fixture, 1);
    expect(await withClient(rig.hostCtx, () => getCoopV2Shadow(rig.hostRuntime))).toBe(hostShadow);
    expect(await withClient(rig.guestCtx, () => getCoopV2Shadow(rig.guestRuntime))).toBe(guestShadow);
    expect(hostShadow.authenticatedFrameContext).toMatchObject({ membershipRevision: 2, connectionGeneration: 1 });
    expect(guestShadow.authenticatedFrameContext).toMatchObject({ membershipRevision: 2, connectionGeneration: 1 });

    const hostMoney = rig.hostScene.money;
    await withClient(rig.guestCtx, () => {
      rig.guestScene.money = hostMoney + 42_424;
    });
    expect(rig.guestScene.money).not.toBe(hostMoney);

    const next = authenticatedP33Contexts(2);
    let releaseHostStart!: () => void;
    let releaseGuestStart!: () => void;
    let releaseHostFinish!: () => void;
    let releaseGuestFinish!: () => void;
    let markHostAdopted!: () => void;
    let markGuestAdopted!: () => void;
    const hostStart = new Promise<void>(resolve => {
      releaseHostStart = resolve;
    });
    const guestStart = new Promise<void>(resolve => {
      releaseGuestStart = resolve;
    });
    const hostFinish = new Promise<void>(resolve => {
      releaseHostFinish = resolve;
    });
    const guestFinish = new Promise<void>(resolve => {
      releaseGuestFinish = resolve;
    });
    const hostAdopted = new Promise<void>(resolve => {
      markHostAdopted = resolve;
    });
    const guestAdopted = new Promise<void>(resolve => {
      markGuestAdopted = resolve;
    });
    let replacementCount = 0;
    rig.hostRuntime.rejoinDriver = async (): Promise<boolean> => {
      await hostStart;
      if (!rig.hostRuntime.controller.adoptP33Rejoin(next.host)) {
        throw new Error("host refused authenticated P33 generation 2");
      }
      if (replacementCount === 0) {
        pair.replaceChannels();
        replacementCount++;
      }
      markHostAdopted();
      await hostFinish;
      return true;
    };
    rig.guestRuntime.rejoinDriver = async (): Promise<boolean> => {
      await guestStart;
      if (!rig.guestRuntime.controller.adoptP33Rejoin(next.guest)) {
        throw new Error("guest refused authenticated P33 generation 2");
      }
      markGuestAdopted();
      await guestFinish;
      return true;
    };

    const hostMembershipBeforeLoss = rig.hostRuntime.membership.snapshot();
    const guestMembershipBeforeLoss = rig.guestRuntime.membership.snapshot();
    const lostWires = pair.currentWires();
    withClientSync(rig.hostCtx, () => lostWires.host.close());
    const hostRecoveringMembership = rig.hostRuntime.membership.snapshot();
    const guestRecoveringMembership = rig.guestRuntime.membership.snapshot();
    expect(hostRecoveringMembership).toMatchObject({
      state: "recovering",
      revision: hostMembershipBeforeLoss.revision + 1,
      members: [{ present: true }, { present: false }],
    });
    expect(guestRecoveringMembership).toMatchObject({
      state: "recovering",
      revision: guestMembershipBeforeLoss.revision + 1,
      members: [{ present: false }, { present: true }],
    });

    await withClient(rig.hostCtx, async () => {
      releaseHostStart();
      await hostAdopted;
    });
    await withClient(rig.guestCtx, async () => {
      releaseGuestStart();
      await guestAdopted;
    });
    expect(replacementCount).toBe(1);
    expect(lostWires.host.readyState).toBe("closed");
    expect(lostWires.guest.readyState).toBe("closed");
    withClientSync(rig.hostCtx, () => rig.hostRuntime.controller.resyncLobbyState());
    withClientSync(rig.guestCtx, () => rig.guestRuntime.controller.resyncLobbyState());
    await pumpAuthenticatedPairUntil(pair, rig.hostCtx, rig.guestCtx, "coop", "rejoined P33 binding", () => {
      return (
        rig.hostRuntime.controller.p33MembershipSnapshot()?.revision === 3
        && rig.guestRuntime.controller.p33MembershipSnapshot()?.revision === 3
      );
    });

    await withClient(rig.hostCtx, async () => {
      releaseHostFinish();
      for (let turn = 0; turn < 20 && rig.hostRuntime.membership.snapshot().state !== "active"; turn++) {
        await Promise.resolve();
      }
    });
    expect(rig.guestRuntime.membership.snapshot()).toEqual(guestRecoveringMembership);
    await withClient(rig.guestCtx, async () => {
      releaseGuestFinish();
      for (let turn = 0; turn < 20 && rig.guestRuntime.membership.snapshot().state !== "active"; turn++) {
        await Promise.resolve();
      }
    });
    expect(guestDurabilityReconnect, "guest recovery completion ran under the guest runtime").toHaveBeenCalledOnce();

    const hostMembership = rig.hostRuntime.membership.snapshot();
    const guestMembership = rig.guestRuntime.membership.snapshot();
    const hostP33Membership = rig.hostRuntime.controller.p33MembershipSnapshot();
    const guestP33Membership = rig.guestRuntime.controller.p33MembershipSnapshot();
    expect(hostMembership).toMatchObject({
      state: "active",
      revision: hostRecoveringMembership.revision + 1,
      connectionGeneration: pair.host.connectionGeneration(),
      members: [{ present: true }, { present: true }],
    });
    expect(guestMembership).toMatchObject({
      state: "active",
      revision: guestRecoveringMembership.revision + 1,
      connectionGeneration: pair.guest.connectionGeneration(),
      members: [{ present: true }, { present: true }],
    });
    expect(hostP33Membership).toMatchObject({
      revision: hostMembership.revision,
      state: "active",
      members: [{ connectionGeneration: pair.host.connectionGeneration() }, { connectionGeneration: 2 }],
    });
    expect(guestP33Membership).toMatchObject({
      revision: guestMembership.revision,
      state: "active",
      members: [{ connectionGeneration: 2 }, { connectionGeneration: pair.guest.connectionGeneration() }],
    });
    expect(hostShadow.authenticatedFrameContext).toMatchObject({
      membershipRevision: hostMembership.revision,
      connectionGeneration: pair.host.connectionGeneration(),
      senderSeatId: 0,
    });
    expect(guestShadow.authenticatedFrameContext).toMatchObject({
      membershipRevision: guestMembership.revision,
      connectionGeneration: pair.guest.connectionGeneration(),
      senderSeatId: 1,
    });

    let activeRecoveryRequest: string | null = null;
    await withClient(rig.guestCtx, async () => {
      for (let turn = 0; turn < 20 && activeRecoveryRequest == null; turn++) {
        activeRecoveryRequest = guestShadow.diagnostics().recovery?.activeReplicaRequest ?? null;
        await Promise.resolve();
      }
    });
    expect(activeRecoveryRequest).toMatch(/^REC\/e\d+\/m3\/s1\/g2\/q1$/u);
    if (activeRecoveryRequest == null) {
      throw new Error("authenticated guest did not open a correlated recovery request");
    }
    expect(guestShadow.diagnostics().recovery).toMatchObject({
      fenceState: "held",
      activeReplicaRequest: activeRecoveryRequest,
      completedReplicaProofs: 0,
    });
    expect(isCoopSharedTerminalFrozen(rig.hostRuntime)).toBe(false);
    expect(isCoopSharedTerminalFrozen(rig.guestRuntime)).toBe(false);

    const hostFrameStart = pair.host.observedV2Frames().length;
    const guestFrameStart = pair.guest.observedV2Frames().length;
    await pumpAuthenticatedPairUntil(pair, rig.hostCtx, rig.guestCtx, "v2", "correlated P33 recovery", () => {
      return (
        guestShadow.diagnostics().recovery?.fenceState === "open"
        && guestShadow.diagnostics().recovery?.activeReplicaRequest == null
        && guestShadow.diagnostics().recovery?.completedReplicaProofs === 1
        && hostShadow.diagnostics().recovery?.activeAuthorityResponses === 0
      );
    });

    const hostRecoveryFrames = pair.host.observedV2Frames().slice(hostFrameStart);
    const guestRecoveryFrames = pair.guest.observedV2Frames().slice(guestFrameStart);
    const requests = hostRecoveryFrames.filter(
      (frame): frame is Extract<CoopFrameV2, { t: "recoveryRequest" }> => frame.t === "recoveryRequest",
    );
    const applied = hostRecoveryFrames.filter(
      (frame): frame is Extract<CoopFrameV2, { t: "recoveryApplied" }> => frame.t === "recoveryApplied",
    );
    const bundles = guestRecoveryFrames.filter(
      (frame): frame is Extract<CoopFrameV2, { t: "recoveryBundle" }> => frame.t === "recoveryBundle",
    );
    expect(new Set(requests.map(frame => frame.body.requestId))).toEqual(new Set([activeRecoveryRequest]));
    expect(new Set(bundles.map(frame => frame.body.requestId))).toEqual(new Set([activeRecoveryRequest]));
    expect(new Set(applied.map(frame => frame.body.requestId))).toEqual(new Set([activeRecoveryRequest]));
    expect(requests.every(frame => frame.ctx.membershipRevision === 3 && frame.ctx.connectionGeneration === 2)).toBe(
      true,
    );
    expect(bundles.every(frame => frame.ctx.membershipRevision === 3 && frame.ctx.connectionGeneration === 2)).toBe(
      true,
    );
    expect(applied.every(frame => frame.ctx.membershipRevision === 3 && frame.ctx.connectionGeneration === 2)).toBe(
      true,
    );
    expect(guestShadow.diagnostics().recovery).toMatchObject({
      fenceState: "open",
      activeReplicaRequest: null,
      completedReplicaProofs: 1,
    });
    expect(hostShadow.diagnostics().recovery).toMatchObject({ activeAuthorityResponses: 0 });
    expect(rig.guestScene.money, "authenticated recovery applied the host material image").toBe(hostMoney);
    expect(rig.guestRuntime.v2ControlLedger.activeControl, "frontier zero has no control to project").toBeNull();
    expect(isCoopSharedTerminalFrozen(rig.hostRuntime)).toBe(false);
    expect(isCoopSharedTerminalFrozen(rig.guestRuntime)).toBe(false);

    disposeDuoRig(rig);
    detachedAuthenticatedRig = null;
    expect(hostShadow.diagnostics()).toMatchObject({ disposed: true, retained: 0, pendingTimers: 0 });
    expect(guestShadow.diagnostics()).toMatchObject({ disposed: true, retained: 0, pendingTimers: 0 });
    logs.flush();
  }, 300_000);

  it("enters the shared terminal when deferred redrive returns a changed entry/context, without compatibility", async () => {
    const rig = await bootDuo({ startingWave: 3 });
    const rawResolved = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved");
    const rawEndState = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveEndState");
    const originalPrepare = rig.hostRuntime.v2ControlLedger.prepareAuthorityEntry.bind(rig.hostRuntime.v2ControlLedger);
    vi.spyOn(rig.hostRuntime.v2ControlLedger, "prepareAuthorityEntry").mockImplementation(entry => {
      if (entry.kind === "WAVE_ADVANCE" || entry.kind === "TERMINAL_COMMIT") {
        return null;
      }
      return originalPrepare(entry);
    });

    await withClient(rig.hostCtx, () => broadcastCoopWaveResolved("win"));
    await retireDuoInitialCommandForBoundaryTest(rig);
    await withClient(rig.hostCtx, () => broadcastCoopWaveEndState(true));

    const parked = rig.hostRuntime.v2DeferredHostBoundary;
    const cutover = await withClient(rig.hostCtx, () => getActiveCoopV2WaveCutover());
    expect(parked).not.toBeNull();
    expect(cutover).not.toBeNull();
    if (parked == null || cutover == null) {
      logs.flush();
      return;
    }
    const changedEntry: CoopAuthorityEntry = {
      ...parked.entry,
      context: {
        ...parked.entry.context,
        connectionGeneration: parked.entry.context.connectionGeneration + 1,
      },
      subsumes: [...parked.entry.subsumes, parked.entry.revision],
    };
    vi.spyOn(cutover, "retryDeferredHostBoundaryDetailed").mockReturnValue({
      kind: "committed",
      entry: changedEntry,
    });

    await withClient(rig.hostCtx, async () => {
      isCoopV2InteractionHumanInputFrozen(rig.hostRuntime);
      await Promise.resolve();
    });
    expect(isCoopSharedTerminalFrozen(rig.hostRuntime)).toBe(true);
    expect(rig.hostRuntime.v2DeferredHostBoundary).toBeNull();
    expect(rawResolved).not.toHaveBeenCalled();
    expect(rawEndState).not.toHaveBeenCalled();
    logs.flush();
  }, 300_000);

  it("runs automatic victory through BattleEnd and child phases before parking the owned victory seal", async () => {
    const rig = await bootDuo({ startingWave: 3 });
    const rawResolved = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved");
    const rawEndState = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveEndState");
    const addBattleScore = vi.spyOn(rig.hostScene.currentBattle, "addBattleScore");
    const scoreBeforeBattleEnd = rig.hostScene.score;
    let blockBoundary = true;
    const originalPrepare = rig.hostRuntime.v2ControlLedger.prepareAuthorityEntry.bind(rig.hostRuntime.v2ControlLedger);
    vi.spyOn(rig.hostRuntime.v2ControlLedger, "prepareAuthorityEntry").mockImplementation(entry => {
      if (blockBoundary && (entry.kind === "WAVE_ADVANCE" || entry.kind === "TERMINAL_COMMIT")) {
        return null;
      }
      return originalPrepare(entry);
    });

    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) =>
      withClientSync(rig.guestCtx, () => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.TACKLE,
        targets: [BattlerIndex.ENEMY_2],
      })),
    );

    game.phaseInterceptor.clearLogs();
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    await withClient(rig.guestCtx, () => drainLoopback());

    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CoopVictorySealPhase");
    });

    const phaseLog = game.phaseInterceptor.log;
    const battleEndIndex = phaseLog.indexOf("BattleEndPhase");
    const eggLapseIndex = phaseLog.indexOf("EggLapsePhase");
    const victorySealIndex = phaseLog.indexOf("CoopVictorySealPhase");
    expect(battleEndIndex).toBeGreaterThanOrEqual(0);
    expect(eggLapseIndex).toBeGreaterThan(battleEndIndex);
    expect(victorySealIndex).toBeGreaterThan(eggLapseIndex);
    expect(addBattleScore).toHaveBeenCalledOnce();
    expect(rig.hostScene.score).not.toBe(scoreBeforeBattleEnd);

    const parked = rig.hostRuntime.v2DeferredHostBoundary;
    expect(parked).toMatchObject({
      kind: "wave",
      wave: 3,
      transition: { outcome: "win", wave: 3 },
      compatibility: { kind: "wave-end" },
    });
    expect(parked?.authoritativeState.score).toBe(rig.hostScene.score);
    expect(parked?.authoritativeState.turn).toBe(rig.hostScene.currentBattle.turn);
    expect(parked?.authoritativeState.tick).toBeGreaterThan(0);
    expect(parked?.authoritativeState.field.filter(seat => seat.side === "enemy")).not.toHaveLength(0);
    expect(
      parked?.authoritativeState.field.filter(seat => seat.side === "enemy").every(seat => seat.presented === false),
    ).toBe(true);
    expect(rawResolved).toHaveBeenCalledOnce();
    expect(rawEndState).not.toHaveBeenCalled();

    blockBoundary = false;
    await withClient(rig.hostCtx, async () => {
      isCoopV2InteractionHumanInputFrozen(rig.hostRuntime);
      await Promise.resolve();
    });
    expect(rig.hostRuntime.v2DeferredHostBoundary).toBeNull();
    expect(rawResolved).toHaveBeenCalledOnce();
    expect(rawEndState).toHaveBeenCalledOnce();
    await withClient(rig.hostCtx, async () => {
      isCoopV2InteractionHumanInputFrozen(rig.hostRuntime);
      await Promise.resolve();
    });
    expect(rawEndState).toHaveBeenCalledOnce();
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // CLASS 1 - WILD WIN: VictoryPhase tail, NO trainer, next phase WAVE_VICTORY.
  // ===========================================================================================
  it("WILD win: the committed WAVE_ADVANCE states outcome=win victoryKind=wild next=WAVE_VICTORY, adopted by the guest", async () => {
    const rig = await bootDuo({ startingWave: 3 });
    const payload = await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 3 });

    expect(payload, "the host committed a WAVE_ADVANCE op").toBeDefined();
    expect(payload!.outcome).toBe("win");
    expect(payload!.victoryKind, "a WILD win states victoryKind=wild (no TrainerVictoryPhase)").toBe("wild");
    expect(payload!.nextLogicalPhase, "logicalPhase is host-authoritative for the transition").toBe("WAVE_VICTORY");
    expect(payload!.settledStateTick, "the committed destination is bound to the settled DATA tick").toBeGreaterThan(0);

    // Two-engine: the guest routed the SAME host-stated op into its live materializer.
    expect(routed.length, "the guest routed the committed op into its live-mutation sink").toBeGreaterThan(0);
    expect(routed.at(-1)!.outcome).toBe("win");
    expect(routed.at(-1)!.victoryKind).toBe("wild");
    // The op sanctions the wild-win boundary tails (NO TrainerVictoryPhase).
    const tails = waveOp.coopWaveAdvanceSanctionedTails(payload!);
    expect(tails).toContain("VictoryPhase");
    expect(tails).not.toContain("TrainerVictoryPhase");
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // CLASS 2 - TRAINER VICTORY: VictoryPhase cascade PLUS TrainerVictoryPhase, next phase WAVE_VICTORY.
  // ===========================================================================================
  it("TRAINER victory: the committed WAVE_ADVANCE states victoryKind=trainer, sanctioning TrainerVictoryPhase", async () => {
    const rig = await bootDuo({ startingWave: 5 });
    const payload = await commitAndDeliver(rig, "win", { battleType: BattleType.TRAINER, waveIndex: 5 });

    expect(payload!.outcome).toBe("win");
    expect(payload!.victoryKind, "a TRAINER win states victoryKind=trainer (#867 battleType verdict)").toBe("trainer");
    expect(payload!.nextLogicalPhase).toBe("WAVE_VICTORY");

    expect(routed.at(-1)!.victoryKind, "the guest received the trainer verdict").toBe("trainer");
    const tails = waveOp.coopWaveAdvanceSanctionedTails(payload!);
    expect(tails).toContain("VictoryPhase");
    expect(tails).toContain("TrainerVictoryPhase");
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // CLASS 3 - BIOME BOUNDARY @ wave 10: the transition crosses a biome boundary; biomeChange is host-stated.
  // ===========================================================================================
  it("BIOME boundary @10: the committed WAVE_ADVANCE states biomeChange faithfully, and the guest receives the SAME verdict", async () => {
    const rig = await bootDuo({ startingWave: 10 });
    vi.spyOn(rig.hostScene, "isNewBiome").mockReturnValue(true);
    const guestDerive = vi.spyOn(rig.guestScene, "isNewBiome").mockReturnValue(false);
    const payload = await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 10 });

    // The host states its OWN biome verdict; assert the payload carries exactly what the host computed
    // (hasRandomBiomes || isNewBiome) at the wave-10 boundary - the host-authoritative biome-change bit.
    const hostVerdict = rig.hostScene.gameMode.hasRandomBiomes || rig.hostScene.isNewBiome();
    expect(payload!.biomeChange, "the payload carries the host's biome-boundary verdict at wave 10").toBe(hostVerdict);
    expect(routed.at(-1)!.biomeChange, "the guest received the SAME host-stated biome verdict").toBe(
      payload!.biomeChange,
    );
    expect(
      guestDerive,
      "the retained transaction never consulted the contradictory guest biome verdict",
    ).not.toHaveBeenCalled();
    if (payload!.biomeChange) {
      const tails = waveOp.coopWaveAdvanceSanctionedTails(payload!);
      expect(tails, "WAVE_ADVANCE sanctions entry into the addressed choice boundary").toContain("SelectBiomePhase");
      expect(tails, "the later BIOME_PICK must authorize the concrete destination").not.toContain("SwitchBiomePhase");
      expect(tails).not.toContain("NewBiomeEncounterPhase");
    }
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // CLASS 4 - ME BOUNDARY: a standard wave-advance states meBoundary="none". An ME-spawned battle victory
  // routes its OWN tail via the Wave-2c ME_TERMINAL op (queueCoopMeBattleVictoryTail), NOT WAVE_ADVANCE
  // (§8.7 residual) - so WAVE_ADVANCE must NEVER claim an ME boundary for an ordinary wave.
  // ===========================================================================================
  it("ME boundary: a standard wave-advance states meBoundary='none' (ME-battle victory stays on the Wave-2c op)", async () => {
    const rig = await bootDuo({ startingWave: 12 });
    const payload = await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 12 });

    expect(payload!.meBoundary, "a standard wave-advance never claims an ME boundary (that is the ME op's job)").toBe(
      "none",
    );
    expect(routed.at(-1)!.meBoundary).toBe("none");
    // The sanctioned tails for a non-ME win do NOT include the ME reward/battle companions.
    const tails = waveOp.coopWaveAdvanceSanctionedTails(payload!);
    expect(tails).not.toContain("MysteryEncounterRewardsPhase");
    expect(tails).not.toContain("MysteryEncounterBattlePhase");
    logs.flush();
  }, 300_000);

  it("ME BattleEnd never synthesizes a normal WAVE_ADVANCE when the ME transaction owns the terminal", async () => {
    const rig = await bootDuo();
    const commitSpy = vi.spyOn(waveOp, "commitWaveAdvanceOwnerIntent");
    vi.spyOn(rig.hostScene.currentBattle, "isBattleMysteryEncounter").mockReturnValue(true);

    await withClient(rig.hostCtx, () => broadcastCoopWaveEndState(true));
    await withClient(rig.guestCtx, () => drainLoopback());

    expect(
      commitSpy,
      "an ME-spawned battle has its own retained terminal and must not be reclassified as an ordinary win",
    ).not.toHaveBeenCalled();
    expect(routed).toEqual([]);

    const release = vi.fn();
    vi.spyOn(rig.guestScene.currentBattle, "isBattleMysteryEncounter").mockReturnValue(true);
    let heldByWaveTransaction = true;
    await withClient(rig.guestCtx, () => {
      heldByWaveTransaction = awaitCoopSettledWaveAdvanceAtBattleEnd(release);
    });
    expect(
      heldByWaveTransaction,
      "the guest ME BattleEnd remains owned by the retained ME terminal instead of waiting for WAVE_ADVANCE",
    ).toBe(false);
    expect(
      release,
      "the wave boundary did not steal or prematurely execute the ME continuation",
    ).not.toHaveBeenCalled();
    logs.flush();
  }, 300_000);

  it("retained ordinary BattleEnd ignores a speculative next-wave Mystery battle and skips local settlement", async () => {
    const rig = await bootDuo({ startingWave: 11 });
    // Keep DATA unresolved until the real BattleEnd boundary. This mirrors production and ensures the
    // phase constructor captures the exact wave-11 transaction instead of mutable ambient battle state.
    registerCoopOperationLiveSink("op:wave", envelope => {
      routed.push(envelope.pendingOperation?.payload as CoopWaveAdvancePayload);
      return true;
    });
    await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 11 });

    await withClient(rig.guestCtx, () => {
      const phase = new BattleEndPhase(true);
      // Make the phase the real active boundary before ambient state speculates ahead. V2 deliberately
      // rejects a detached BattleEnd instance: merely calling start() on an object that the phase manager
      // does not own is not a state either browser can reach.
      rig.guestScene.phaseManager.clearPhaseQueue();
      rig.guestScene.phaseManager.unshiftPhase(phase);
      rig.guestScene.phaseManager.shiftPhase();
      expect(rig.guestScene.phaseManager.getCurrentPhase()).toBe(phase);
      // The next battle has speculated ahead to an ME. The addressed retained source is still wave 11.
      rig.guestScene.currentBattle.waveIndex = 12;
      rig.guestScene.currentBattle.battleType = BattleType.MYSTERY_ENCOUNTER;
      vi.spyOn(rig.guestScene.currentBattle, "isBattleMysteryEncounter").mockReturnValue(true);
      const addBattleScoreSpy = vi.spyOn(rig.guestScene.currentBattle, "addBattleScore");
      const clearEnemyHeldItemsSpy = vi.spyOn(rig.guestScene, "clearEnemyHeldItemModifiers");
      const rawPublisherSpy = vi.spyOn(rig.guestRuntime.battleStream, "sendWaveEndState");
      const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});
      phase.start();

      expect(endSpy, "the exact retained wave-11 image releases BattleEnd").toHaveBeenCalledOnce();
      expect(addBattleScoreSpy, "the guest does not dual-run victory settlement").not.toHaveBeenCalled();
      expect(clearEnemyHeldItemsSpy, "the guest does not dual-run shared BattleEnd cleanup").not.toHaveBeenCalled();
      expect(rawPublisherSpy, "the guest does not fall back to the raw wave-end carrier").not.toHaveBeenCalled();
    });
    logs.flush();
  }, 300_000);

  it("retained ordinary Victory ignores speculative Mystery classification with no encounter payload", async () => {
    const rig = await bootDuo({ preserveProductionWaveSink: true, startingWave: 11 });
    // The retained journal's production sink bootstraps only at its addressed source wave. Mirror that exact
    // pre-delivery boundary first, then let the renderer speculate to wave 12 after the immutable operation
    // has landed. Starting this fixture at the boot wave (1) would correctly reject a wave-11 transaction.
    await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 11 });

    await withClient(rig.guestCtx, () => {
      rig.guestScene.currentBattle.waveIndex = 12;
      rig.guestScene.currentBattle.battleType = BattleType.MYSTERY_ENCOUNTER;
      rig.guestScene.currentBattle.mysteryEncounter = undefined;
      vi.spyOn(rig.guestScene.currentBattle, "isBattleMysteryEncounter").mockReturnValue(true);
      const pushNewSpy = vi.spyOn(rig.guestScene.phaseManager, "pushNew");

      // Enter the actual production tail in its real order. The retained materializer first consumes the
      // operation and sanctions Victory/BattleEnd, then Victory creates the source-addressed BattleEnd.
      // Constructing BattleEnd before that consume is deliberately rejected by strict tails and would test
      // an impossible production order rather than the retained DATA-admission seam.
      rig.guestScene.phaseManager.clearPhaseQueue();
      expect(
        () => CoopFinalizeTurnPhase.runPendingWaveAdvanceTail(),
        "the retained operation must materialize without reading speculative Mystery state",
      ).not.toThrow();
      expect(
        pushNewSpy.mock.calls.find(call => call[0] === "VictoryPhase")?.slice(2),
        "the retained materializer queues the ordinary wave-11 Victory tail",
      ).toEqual([false, 11, 1]);

      // PhaseInterceptor disables automatic starts. Shift into the manager-created Victory and start it
      // exactly once; its normal end() shifts to the sanctioned, source-addressed BattleEnd boundary.
      rig.guestScene.phaseManager.shiftPhase();
      const retainedVictory = rig.guestScene.phaseManager.getCurrentPhase();
      expect(retainedVictory.phaseName).toBe("VictoryPhase");
      retainedVictory.start();
      const retainedBoundary = rig.guestScene.phaseManager.getCurrentPhase();
      expect(retainedBoundary, "the exact production BattleEnd boundary is current").toBeInstanceOf(BattleEndPhase);
      expect(
        () => retainedBoundary.start(),
        "the real retained BattleEnd bootstrap must admit DATA without dereferencing wave-12 Mystery state",
      ).not.toThrow();
    });
    logs.flush();
  }, 300_000);

  it("FINAL VICTORY: retains Victory -> BattleEnd -> GameOver and suppresses the later duplicate terminal echo", async () => {
    // Use an ordinary playable command frontier and make it final through the same game-mode predicate
    // consumed by the boundary. Booting the test harness directly at wave 200 starts its synthetic guest
    // on LoginPhase, so it cannot prove the required COMMAND -> TURN_COMMIT predecessor at all.
    const rig = await bootDuo({ startingWave: 7 });
    vi.spyOn(rig.hostScene.gameMode, "isWaveFinal").mockReturnValue(true);
    const payload = await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 7 });

    expect(payload?.nextWave, "a final victory cannot invent a following wave").toBe(7);
    expect(payload?.biomeChange).toBe(false);
    expect(payload?.eggLapse).toBe(false);
    expect(waveOp.coopWaveAdvanceSanctionedTails(payload!)).toEqual([
      "VictoryPhase",
      "BattleEndPhase",
      "CoopVictorySealPhase",
      "GameOverPhase",
    ]);

    const routedBeforeGameOverEcho = routed.length;
    await withClient(rig.hostCtx, () => broadcastCoopWaveResolved("gameOver"));
    await withClient(rig.guestCtx, () => drainLoopback());
    expect(
      routed,
      "GameOverPhase cannot commit a conflicting second WAVE_ADVANCE for the already-settled final win",
    ).toHaveLength(routedBeforeGameOverEcho);
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // CLASS 5 - GAME OVER: the run ended; next phase GAME_OVER, next wave == wave (no advance), only GameOverPhase.
  // ===========================================================================================
  it("GAME OVER: the committed WAVE_ADVANCE states outcome=gameOver next=GAME_OVER, sanctioning only GameOverPhase", async () => {
    const rig = await bootDuo({ startingWave: 7 });
    const payload = await commitAndDeliver(rig, "gameOver", { battleType: BattleType.WILD, waveIndex: 7 });

    expect(payload!.outcome).toBe("gameOver");
    expect(payload!.nextLogicalPhase, "a lost run transitions to GAME_OVER").toBe("GAME_OVER");
    expect(payload!.nextWave, "game-over does NOT advance the wave").toBe(7);
    expect(payload!.victoryKind, "game-over has no victory kind").toBeUndefined();

    expect(routed.at(-1)!.outcome, "the guest received the game-over statement").toBe("gameOver");
    expect(waveOp.coopWaveAdvanceSanctionedTails(payload!), "game-over sanctions only GameOverPhase").toEqual([
      "GameOverPhase",
    ]);
    logs.flush();
  }, 300_000);

  it("GAME OVER: a retained terminal dissolves a phantom next-turn replay and both peers reach GameOver", async () => {
    const rig = await bootDuo({ preserveProductionWaveSink: true, startingWave: 7 });
    await retireDuoInitialCommandForBoundaryTest(rig);
    const hostTerminal = new GameOverPhase(false);
    const hostTerminalHandler = vi.spyOn(hostTerminal, "handleGameOver").mockImplementation(() => {});
    const retainedBefore = getCoopV2Shadow(rig.hostRuntime)?.diagnostics().retained ?? 0;
    vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved").mockImplementation(() => {
      throw new Error("drop raw game-over carrier; retained WAVE_ADVANCE must recover");
    });

    await withClient(rig.guestCtx, async () => {
      rig.guestScene.currentBattle.waveIndex = 7;
      rig.guestScene.currentBattle.turn = 1;
      // Turn 1 was already consumed into the ordered successor wait above. The adversarial local replay is
      // therefore the genuinely phantom NEXT turn; reopening turn 1 would correctly be rejected as stale.
      const replay = new CoopReplayTurnPhase(2);
      rig.guestScene.phaseManager.clearPhaseQueue();
      rig.guestScene.phaseManager.unshiftPhase(replay);
      rig.guestScene.phaseManager.shiftPhase();
      expect(rig.guestScene.phaseManager.getCurrentPhase()).toBe(replay);
      replay.start();
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(replay.isAwaitingAuthority(), "the guest has opened the phantom next-turn waiter").toBe(true);
      expect(
        replay.abortIfRetainedTerminalSuperseded(2, "a future terminal must not abort an earlier replay (test)"),
        "a terminal from a later settled turn cannot truncate this replay",
      ).toBe(false);
      expect(replay.isAwaitingAuthority()).toBe(true);
    });

    await withClient(rig.hostCtx, () => {
      rig.hostScene.currentBattle.waveIndex = 7;
      rig.hostScene.currentBattle.turn = 1;
      hostTerminal.start();
    });
    expect(hostTerminalHandler, "the authority opened its real GameOver continuation").toHaveBeenCalledOnce();
    expect(
      getCoopV2Shadow(rig.hostRuntime)?.diagnostics().retained,
      "host V2 terminal remains retained until the guest opens its terminal",
    ).toBe(retainedBefore + 1);

    await withClient(rig.guestCtx, async () => {
      await drainLoopback();
      await new Promise(resolve => setTimeout(resolve, 10));
      const boundary = rig.guestScene.phaseManager.getCurrentPhase();
      expect(boundary, "the retained terminal unparks replay into the appended safe boundary").toBeInstanceOf(
        CoopWaveAdvanceBoundaryPhase,
      );
      expect(
        coopRetainedGameOverSupersedesReplay(7, 1),
        "the same-turn replay is terminal-superseded once ordered live events have drained",
      ).toBe(true);
      expect(coopRetainedGameOverSupersedesReplay(7, 2), "a queued phantom next turn is also superseded").toBe(true);
      expect(coopRetainedGameOverSupersedesReplay(6, 1), "a replay from another wave is unrelated").toBe(false);
      expect(coopRetainedGameOverSupersedesReplay(7, 0), "a replay before the settled turn is unrelated").toBe(false);
      boundary.start();
      const guestTerminal = rig.guestScene.phaseManager.getCurrentPhase();
      expect(guestTerminal, "terminal DATA application exposes the guest GameOver continuation").toBeInstanceOf(
        GameOverPhase,
      );
      vi.spyOn(guestTerminal as GameOverPhase, "handleGameOver").mockImplementation(() => {});
      guestTerminal.start();
      expect(
        getCoopWaveBoundaryStatus(7, rig.guestRuntime),
        "the guest terminal proves V2 DATA applied plus continuation ready",
      ).toMatchObject({ authority: "v2", dataApplied: true, continuationReady: true });
    });

    await withClient(rig.hostCtx, () => drainLoopback());
    expect(
      getCoopV2Shadow(rig.hostRuntime)?.diagnostics().retained,
      "the shared terminal proof releases retained V2 authority",
    ).toBe(retainedBefore);
    logs.flush();
  }, 300_000);
});
