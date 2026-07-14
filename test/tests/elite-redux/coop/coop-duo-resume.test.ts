/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op LOBBY RESUME flow (#810, maintainer directive). Proves the
// reconnect decision end-to-end over the real loopback with BOTH engines live:
//
//   RESUME  - the host offers, the guest ACCEPTS, and the guest BOOTS from the
//             host's saved-session snapshot (the `coopGuestResumeBoot` core,
//             `applyCoopLaunchSession`) and CONVERGES byte-equal to the host -
//             reusing #807's / M4's convergence proof shape.
//   NEW GAME - the host relays `resumeStartNew`; the guest's wait BARRIER is
//             released and NO boot happens (the guest keeps its own state).
//   IDENTITY GATE - a saved run is offered ONLY for the exact (self, partner)
//             account pair; a different partner yields no marker -> no offer.
//
// The offer/reply + start-new PROTOCOL primitives and the marker identity gate
// are also pinned engine-free (fast, no boot) in coop-webrtc-transport.test.ts
// ("#810: resume offer/reply protocol + marker"), incl. the 60s no-reply TIMEOUT
// fallback. This file adds the two-engine CONVERGENCE + barrier proof.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-resume.test.ts
// =============================================================================

import { pokerogueApi } from "#api/api";
import { getSessionDataLocalStorageKey, loggedInUser, updateUserInfo } from "#app/account";
import type { BattleScene } from "#app/battle-scene";
import { saveKey } from "#app/constants";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setBypassLoginForTesting } from "#constants/app-constants";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import type { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { enqueueSessionCloudMutation } from "#data/elite-redux/coop/coop-cloud-save-tail";
import {
  clearCoopResumeMarker,
  deriveCoopResumeCommitment,
  findCoopResumeCandidate,
  readCoopResumeMarker,
  recordCoopResumeMarker,
} from "#data/elite-redux/coop/coop-resume-marker";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameDataType } from "#enums/game-data-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { setCoopPersistenceClockForTesting } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo as buildDuoHarness,
  buildRuntime,
  type ClientCtx,
  type DuoRig,
  drainLoopback,
  installDuoLogCapture,
  withClient as withClientHarness,
} from "#test/tools/coop-duo-harness";
import { decrypt, encrypt } from "#utils/data";
import { AES } from "crypto-js";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const coopCasMissing = () => ({
  ok: false as const,
  status: 404,
  error: "Session not found.",
  failureKind: "missing" as const,
});

const coopCasFound = (rawSavedata: string) => ({ ok: true as const, status: 200, rawSavedata });

/** Serialize the host's coherent session EXACTLY as a real RESUME load broadcasts it. */
function serializeHostLaunchSnapshot(hostScene: BattleScene): string {
  return JSON.stringify(hostScene.gameData.getSessionSaveData(), (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

let activeResumeRig: DuoRig | null = null;
let resumeCheckpointSentSeq = 0;
let resumeCheckpointAckSeq = 0;

/** Deliver every frame only while its destination's complete browser-equivalent context is installed. */
async function pumpResumeDestinations(rig: DuoRig, rounds = 2): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await withClientHarness(rig.hostCtx, () => drainLoopback());
    await withClientHarness(rig.guestCtx, () => drainLoopback());
  }
}

/**
 * Authenticated persistence may await a peer checkpoint ACK. Keep alternating the two isolated client
 * contexts while that operation is pending, just as two browsers continue servicing their own event loops.
 */
async function withClient<T>(ctx: ClientCtx, fn: () => T | Promise<T>): Promise<T> {
  return withClientHarness(ctx, fn);
}

/**
 * Run a transaction that is expected to wait for the other browser. Ordinary persistence calls use
 * {@linkcode withClient} so their async account/runtime fences can never resume under the peer context.
 */
async function withPeerPumpingClient<T>(ctx: ClientCtx, fn: () => T | Promise<T>): Promise<T> {
  const sentAtEntry = resumeCheckpointSentSeq;
  const ackAtEntry = resumeCheckpointAckSeq;
  const operation = withClientHarness(ctx, fn);
  const rig = activeResumeRig;
  if (rig == null) {
    return operation;
  }
  let settled = false;
  void operation.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  // Keep the initiating browser installed until it either finishes without a peer or reaches the exact
  // retained-checkpoint rendezvous. In one process, switching accounts during the owner's digest/CAS awaits
  // creates a state real independent browsers cannot have and correctly trips the production account fence.
  for (let round = 0; round < 256 && !settled && resumeCheckpointSentSeq === sentAtEntry; round++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (settled) {
    return operation;
  }
  if (resumeCheckpointSentSeq === sentAtEntry) {
    throw new Error("resume fixture did not reach its peer-checkpoint rendezvous");
  }

  // The owner is now parked solely on guest durability. Keep the guest browser context installed across
  // all of its async decrypt/digest/cloud work; leave only after it has emitted the exact ACK/NACK frame.
  await withClientHarness(rig.guestCtx, async () => {
    for (let round = 0; round < 256 && !settled && resumeCheckpointAckSeq === ackAtEntry; round++) {
      await drainLoopback();
      if (resumeCheckpointAckSeq !== ackAtEntry || settled) {
        break;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  });
  if (!settled && resumeCheckpointAckSeq === ackAtEntry) {
    throw new Error("resume fixture guest did not emit its checkpoint ACK/NACK");
  }

  // Deliver the retained result while the host browser is installed. The outer initiating context is restored
  // by withClientHarness afterward; host save continuations therefore resume under their original account.
  await withClientHarness(rig.hostCtx, () => drainLoopback());
  for (let round = 0; round < 64 && !settled; round++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return operation;
}

/** Flush controller transactions through both browser-equivalent event loops. */
async function flush(): Promise<void> {
  if (activeResumeRig != null) {
    await pumpResumeDestinations(activeResumeRig, 2);
    return;
  }
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

/**
 * Launch aborts are retained control-plane results and should arrive immediately in
 * these loopback tests.  Bound that proof independently of the production streamer's
 * long reconnect budget so a missing terminal cannot consume a five-minute test cap.
 */
function awaitRetainedLaunchAbort(stream: { awaitLaunchSnapshot: CoopBattleStreamer["awaitLaunchSnapshot"] }) {
  return stream.awaitLaunchSnapshot(1, 2_000, { retryIntervalMs: 100, maxRetries: 5 });
}

/** Deterministic zero-wall-clock expiry for persistence lock/network timeout paths. */
function installImmediateCoopPersistenceTimeouts(): void {
  const cancelled = new WeakSet<object>();
  setCoopPersistenceClockForTesting({
    lockAcquireTimeoutMs: 1,
    networkTimeoutMs: 1,
    schedule(callback) {
      const handle = {};
      queueMicrotask(() => {
        if (!cancelled.has(handle)) {
          callback();
        }
      });
      return handle;
    },
    cancel(handle) {
      if (typeof handle === "object" && handle != null) {
        cancelled.add(handle);
      }
    },
  });
}

/**
 * Give each engine the account identity its controller advertises. Real browsers
 * have independent account modules; the in-process duo harness must swap that
 * module-global identity alongside the scene and runtime for authenticated saves.
 */
async function buildDuo(...args: Parameters<typeof buildDuoHarness>) {
  const rig = await buildDuoHarness(...args);
  rig.hostCtx.accountIdentity = rig.hostRuntime.controller.localName();
  rig.guestCtx.accountIdentity = rig.guestRuntime.controller.localName();
  rig.pair.setDestinationContextDelivery?.(true);
  const sendResumeCheckpointDetailed = rig.hostRuntime.controller.sendResumeCheckpointDetailed.bind(
    rig.hostRuntime.controller,
  );
  vi.spyOn(rig.hostRuntime.controller, "sendResumeCheckpointDetailed").mockImplementation((...checkpointArgs) => {
    resumeCheckpointSentSeq++;
    return sendResumeCheckpointDetailed(...checkpointArgs);
  });
  const guestSend = rig.guestRuntime.localTransport.send.bind(rig.guestRuntime.localTransport);
  vi.spyOn(rig.guestRuntime.localTransport, "send").mockImplementation(message => {
    guestSend(message);
    if (message.t === "resumeCheckpointAck") {
      resumeCheckpointAckSeq++;
    }
  });
  activeResumeRig = rig;
  return rig;
}

describe.skipIf(!RUN)("co-op DUO lobby RESUME flow (#810)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let priorLocksDescriptor: PropertyDescriptor | undefined;
  let priorLocalStorage = new Map<string, string>();

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    resumeCheckpointSentSeq = 0;
    resumeCheckpointAckSeq = 0;
    // This file now exercises the real authenticated persistence path. Preserve the runner's incoming
    // browser storage exactly, but give every transaction scenario a fresh browser account substrate;
    // otherwise a successful checkpoint in one test becomes an unrelated cloud/local parent in the next.
    priorLocalStorage = new Map<string, string>();
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key != null) {
        const value = localStorage.getItem(key);
        if (value != null) {
          priorLocalStorage.set(key, value);
        }
      }
    }
    localStorage.clear();
    // Keep fixture boot local/deterministic. The wrapper below disables bypass immediately after each
    // battle starts, so every save/reconcile assertion still exercises authenticated AES + cloud CAS.
    setBypassLoginForTesting(true);
    priorLocksDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, "locks");
    Object.defineProperty(globalThis.navigator, "locks", {
      configurable: true,
      value: {
        request: async <T>(_name: string, _options: { mode: "exclusive" }, callback: () => Promise<T>) => callback(),
      },
    });
    // Do not install GameManager's permanent bypass getter: persistence must follow the real mutable seam.
    game = new GameManager(phaserGame, false);
    // GameManager's ReloadHelper replaces saveAll with an in-memory reload shortcut for ordinary engine
    // tests. This suite verifies the real authenticated local/cloud transaction and must restore it before
    // any fresh-slot CAS, checkpoint, rollback, or account-fence assertion can be meaningful.
    vi.mocked(game.scene.gameData.saveAll).mockRestore();
    const startBattle = game.classicMode.startBattle.bind(game.classicMode);
    vi.spyOn(game.classicMode, "startBattle").mockImplementation(async (...args) => {
      setBypassLoginForTesting(true);
      try {
        const result = await startBattle(...args);
        const [accountReady] = await updateUserInfo();
        if (!accountReady || loggedInUser == null) {
          throw new Error("resume fixture could not initialize its pre-pair browser account");
        }
        return result;
      } finally {
        setBypassLoginForTesting(false);
      }
    });
    setBypassLoginForTesting(false);
    logs = installDuoLogCapture(`resume-${Date.now()}`);
    clearCoopResumeMarker();
    vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue(coopCasMissing());
    vi.spyOn(pokerogueApi.savedata.session, "getCoopRunStatus").mockImplementation(async request => ({
      ok: true,
      status: 200,
      value: { state: "missing", runId: request.coopRunId },
    }));
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
    activeResumeRig = null;
    setBypassLoginForTesting(null);
    setCoopPersistenceClockForTesting(null);
    clearCoopResumeMarker();
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
    vi.restoreAllMocks();
    localStorage.clear();
    for (const [key, value] of priorLocalStorage) {
      localStorage.setItem(key, value);
    }
    if (priorLocksDescriptor == null) {
      Reflect.deleteProperty(globalThis.navigator, "locks");
    } else {
      Object.defineProperty(globalThis.navigator, "locks", priorLocksDescriptor);
    }
  });

  it("RESUME: host offers -> guest ACCEPTS -> guest boots from the host snapshot and CONVERGES (+ identity gate)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    const host = rig.hostRuntime.controller;
    const guest = rig.guestRuntime.controller;
    const preResumeEpoch = host.sessionEpoch;
    expect(guest.sessionEpoch).toBe(preResumeEpoch);

    // The handshake exchanged account identities: each side knows the other's name.
    expect(host.partnerName, "host knows the guest identity").toBe(guest.localName());
    expect(guest.partnerName, "guest knows the host identity").toBe(host.localName());

    // Save-backed discovery metadata is canonical, so host and guest persist the same pair
    // representation even though each sees self/partner from the opposite perspective.
    const hostParticipants = await withClient(
      rig.hostCtx,
      () => rig.hostScene.gameData.getSessionSaveData().coopParticipants,
    );
    const guestParticipants = await withClient(
      rig.guestCtx,
      () => rig.guestScene.gameData.getSessionSaveData().coopParticipants,
    );
    expect(hostParticipants, "host save embeds the connected account pair").toBeDefined();
    expect(guestParticipants, "guest save embeds the connected account pair").toEqual(hostParticipants);

    // HOST: serialize the saved session it would load on RESUME + capture its wave-start checksum.
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    // Parse these exact frozen bytes: asking GameData for a second snapshot may mint a different timestamp and
    // would make the fixture test a commitment that was never paired with the payload sent to the guest.
    const hostSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(hostJson));
    const commitment = await deriveCoopResumeCommitment(hostJson, hostSession);
    expect(commitment, "the frozen save produces an immutable resume discriminator").not.toBeNull();
    const guestCloudWrite = vi.spyOn(pokerogueApi.savedata.session, "updateCoopCas").mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      failureKind: null,
    });
    // IDENTITY GATE: the pointer binds the exact run + checkpoint, not merely a partner pair/wave.
    recordCoopResumeMarker(
      2,
      host.localName(),
      host.partnerName!,
      commitment!.wave,
      commitment!.runId,
      commitment!.checkpointRevision,
    );
    expect(readCoopResumeMarker(host.localName(), host.partnerName)?.slot, "exact pair matches").toBe(2);
    expect(readCoopResumeMarker(host.localName(), "SomebodyElse"), "different partner -> no offer").toBeNull();
    const hostChecksum = await withClient(rig.hostCtx, () => captureCoopChecksum());

    // PERTURB the guest so its state DIVERGES from the host - makes the convergence meaningful.
    await withClient(rig.guestCtx, () => {
      rig.guestScene.money += 999_999;
    });
    const guestBefore = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestBefore, "the perturbed guest DIVERGES from the host before resuming").not.toBe(hostChecksum);

    // OFFER/ACCEPT protocol: the host offers to resume, the guest's armed handler receives the
    // wave, and it ACCEPTS - the host's offer promise resolves true (both proceed to resume).
    let offeredWave = -1;
    guest.armResumeOfferHandler(offered => {
      offeredWave = offered.wave;
    });
    const offer = host.offerResume(commitment!);
    await flush();
    expect(offeredWave, "the guest's resume offer surfaced on ACCEPT").toBe(commitment!.wave);
    const guestCommit = guest.replyResume(true);
    await flush();
    await expect(offer, "host sees the guest ACCEPT").resolves.toBe(true);
    await expect(guestCommit, "guest starts boot only after host commits the exact ACCEPT").resolves.toBe(true);
    expect(host.sessionEpoch, "cold resume minted a fresh host epoch").toBeGreaterThan(preResumeEpoch);
    expect(guest.sessionEpoch, "guest adopted the cold-resume epoch before snapshot boot").toBe(host.sessionEpoch);

    // RESUME BOOT: the guest boots from the host's saved snapshot (the coopGuestResumeBoot core)...
    await withClient(rig.guestCtx, () => rig.guestScene.gameData.armCoopResumeCheckpointPersistence());
    const booted = await withClient(rig.guestCtx, () =>
      rig.guestScene.gameData.applyCoopLaunchSession(hostJson, commitment!),
    );
    expect(booted, "the guest booted from the resumed session snapshot").toBe(true);
    const persisted = await withClient(rig.guestCtx, () =>
      rig.guestScene.gameData.persistCurrentCoopResumeCheckpoint(hostJson, commitment!, true),
    );
    expect(persisted.success, "cold resume durably persists the exact candidate before reporting scene readiness").toBe(
      true,
    );
    expect(
      guestCloudWrite,
      "cold resume mirrors the accepted checkpoint into the guest account",
    ).toHaveBeenCalledOnce();
    const hostApplyBarrier = host.awaitResumeApplied(1_000);
    const delivered = guest.reportResumeApplied(booted);
    await flush();
    await expect(hostApplyBarrier, "host leaves the lobby only after guest snapshot materialization").resolves.toBe(
      true,
    );
    await expect(delivered, "guest observes the host's apply ACK").resolves.toBe(true);

    // ...and CONVERGES byte-equal to the host (the resumed run cannot diverge at boot).
    const guestAfter = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestAfter, "guest full-state checksum EQUALS the host's after resuming (converged)").toBe(hostChecksum);

    logs.flush();
  }, 300_000);

  it("NEW GAME: host relays resumeStartNew -> guest wait barrier releases, NO boot happens", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    const host = rig.hostRuntime.controller;
    const guest = rig.guestRuntime.controller;

    // The guest arms its wait-barrier handlers (mirrors title-phase onConnected): it must not
    // advance until it gets EITHER an offer or the start-new release.
    let released = 0;
    let offered = 0;
    guest.armResumeStartNewHandler(() => {
      released++;
    });
    guest.armResumeOfferHandler(() => {
      offered++;
    });

    // Perturb the guest so we can prove NO resume boot mutated its state.
    await withClient(rig.guestCtx, () => {
      rig.guestScene.money += 12_345;
    });
    const guestBefore = await withClient(rig.guestCtx, () => captureCoopChecksum());

    // HOST chose New Game (or had no matching save): it relays the barrier release.
    await host.sendResumeStartNew();
    await flush();
    expect(released, "the guest wait barrier was released by resumeStartNew").toBe(1);
    expect(offered, "no resume offer was surfaced on the New Game path").toBe(0);

    // The guest applied NO snapshot - its (perturbed) state is unchanged (a new run starts fresh).
    const guestAfter = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestAfter, "guest state untouched on the New Game path (no boot)").toBe(guestBefore);

    logs.flush();
  }, 300_000);

  it("rejects a local-ahead checkpoint when another device advanced the frozen cloud parent", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const slot = rig.hostScene.sessionSlotId;
    const baseJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const baseSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(baseJson));
    const baseCommitment = await deriveCoopResumeCommitment(baseJson, baseSession);
    expect(baseCommitment).not.toBeNull();
    const checkpoint = async (revision: number) => {
      const json = JSON.stringify({
        ...(JSON.parse(baseJson) as Record<string, unknown>),
        waveIndex: baseCommitment!.wave + revision,
        timestamp: baseCommitment!.timestamp + revision,
        coopRun: {
          version: 1,
          runId: baseCommitment!.runId,
          checkpointRevision: baseCommitment!.checkpointRevision + revision,
        },
      });
      const session = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(json));
      const commitment = await deriveCoopResumeCommitment(json, session);
      expect(commitment).not.toBeNull();
      return { json, commitment: commitment! };
    };
    const cloud = await checkpoint(1);
    const local = await checkpoint(2);
    const account = await withClient(rig.hostCtx, () => loggedInUser!.username);
    const localKey = await withClient(rig.hostCtx, () => getSessionDataLocalStorageKey(slot));
    const headKey = `er-coop-cloud-head:${account.normalize("NFKC").toLowerCase()}:${slot}`;
    const priorLocal = localStorage.getItem(localKey);
    const priorHead = localStorage.getItem(headKey);

    try {
      setBypassLoginForTesting(false);
      localStorage.setItem(localKey, encrypt(local.json, false));
      localStorage.setItem(
        headKey,
        JSON.stringify({
          version: 1,
          runId: baseCommitment!.runId,
          checkpointRevision: baseCommitment!.checkpointRevision,
          digest: baseCommitment!.digest,
        }),
      );
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockImplementation(async request =>
        request.slot === slot ? coopCasFound(cloud.json) : coopCasMissing(),
      );
      vi.spyOn(pokerogueApi.savedata.session, "getCoopRunStatus").mockResolvedValue({
        ok: true,
        status: 200,
        value: {
          state: "active",
          runId: cloud.commitment.runId,
          slot,
          checkpointRevision: cloud.commitment.checkpointRevision,
          digest: cloud.commitment.digest,
        },
      });

      await expect(
        withClient(rig.hostCtx, () => rig.hostScene.gameData.getSessionForCoopResume(slot)),
        "a stale device cannot adopt another device's cloud head and then publish its unrelated local branch",
      ).rejects.toThrow(/has no (?:proof it descends from the observed cloud head|unique active cloud checkpoint)/);
      expect(
        JSON.parse(localStorage.getItem(headKey) ?? "null"),
        "the competing cloud head was not adopted",
      ).toMatchObject({
        checkpointRevision: baseCommitment!.checkpointRevision,
        digest: baseCommitment!.digest,
      });
    } finally {
      priorLocal == null ? localStorage.removeItem(localKey) : localStorage.setItem(localKey, priorLocal);
      priorHead == null ? localStorage.removeItem(headKey) : localStorage.setItem(headKey, priorHead);
    }
    logs.flush();
  }, 300_000);

  it("mirrors exact host checkpoint bytes into the guest's own resume slot before reversed reconnect", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const host = rig.hostRuntime.controller;
    const guest = rig.guestRuntime.controller;
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const hostSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(hostJson));
    const commitment = await deriveCoopResumeCommitment(hostJson, hostSession);
    expect(commitment).not.toBeNull();
    const priorGameplaySlot = rig.guestScene.sessionSlotId;

    setBypassLoginForTesting(false);
    // An ordinary non-cloud cadence checkpoint may advance only an already cloud-backed replica.
    // Fresh launch/resume establishes this exact guest-account parent before later lightweight mirrors.
    let cloudSlot = 0;
    let cloudRaw: string | null = hostJson;
    const cloudRead = vi
      .spyOn(pokerogueApi.savedata.session, "getCoopCas")
      .mockImplementation(async request =>
        request.slot === cloudSlot && cloudRaw != null ? coopCasFound(cloudRaw) : coopCasMissing(),
      );
    const requestedCloudBytes: string[] = [];
    const completedCloudBytes: string[] = [];
    let releaseFirstCloud!: () => void;
    const firstCloudGate = new Promise<void>(resolve => {
      releaseFirstCloud = resolve;
    });
    const cloudUpdate = vi
      .spyOn(pokerogueApi.savedata.session, "updateCoopCas")
      .mockImplementation(async (request, raw) => {
        requestedCloudBytes.push(raw);
        if (requestedCloudBytes.length === 1) {
          await firstCloudGate;
        }
        cloudSlot = request.slot;
        cloudRaw = raw;
        completedCloudBytes.push(raw);
        return { ok: true, status: 200, error: "", failureKind: null };
      });

    await withClient(rig.guestCtx, () => {
      rig.guestScene.gameData.armCoopResumeCheckpointPersistence();
    });
    const persisted = await withPeerPumpingClient(rig.guestCtx, () => host.sendResumeCheckpoint(hostJson, commitment!));
    expect(persisted, "guest ACKs only after exact bytes + its own marker are durable locally").toBe(true);
    const marker = readCoopResumeMarker(guest.localName(), host.localName());
    expect(marker, "former guest has its own resume pointer").toMatchObject({ wave: commitment!.wave });
    const replicated = await withClient(rig.guestCtx, () => rig.guestScene.gameData.getSession(marker!.slot));
    expect(replicated?.coopParticipants, "replica retains stable authority seats").toEqual(
      hostSession.coopParticipants,
    );
    expect(
      rig.guestScene.sessionSlotId,
      "background co-op replication cannot displace the ordinary title Continue/gameplay slot pointer",
    ).toBe(priorGameplaySlot);
    expect(requestedCloudBytes, "ordinary per-wave local replicas do not bypass the cloud throttle").toEqual([]);

    const newerRaw = JSON.parse(hostJson) as Record<string, unknown>;
    const newerJson = JSON.stringify({
      ...newerRaw,
      waveIndex: commitment!.wave + 1,
      timestamp: commitment!.timestamp - 1,
      coopControlPlane: { interactionCounter: commitment!.revision + 1, journalHighWater: {} },
      coopRun: {
        version: 1,
        runId: commitment!.runId,
        checkpointRevision: commitment!.checkpointRevision + 1,
      },
    });
    const newerSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(newerJson));
    const newerCommitment = await deriveCoopResumeCommitment(newerJson, newerSession);
    expect(newerCommitment).not.toBeNull();
    const newerCloudDurable = withPeerPumpingClient(rig.guestCtx, () =>
      host.sendResumeCheckpoint(newerJson, newerCommitment!, 30_000, true),
    );
    await vi.waitFor(
      () => expect(requestedCloudBytes, "the cloud transaction reached its ordered mutation tail").toHaveLength(1),
      { timeout: 2_000, interval: 10 },
    );
    expect(requestedCloudBytes, "a host-cadence checkpoint starts one ordered guest cloud mirror").toEqual([newerJson]);

    const newestJson = JSON.stringify({
      ...newerRaw,
      waveIndex: commitment!.wave + 1,
      timestamp: commitment!.timestamp - 2,
      coopControlPlane: { interactionCounter: commitment!.revision + 2, journalHighWater: {} },
      coopRun: {
        version: 1,
        runId: commitment!.runId,
        checkpointRevision: commitment!.checkpointRevision + 2,
      },
    });
    const newestSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(newestJson));
    const newestCommitment = await deriveCoopResumeCommitment(newestJson, newestSession);
    expect(newestCommitment).not.toBeNull();
    releaseFirstCloud();
    await expect(
      newerCloudDurable,
      "a cloud-cadence checkpoint ACKs only after both guest local and guest cloud durability",
    ).resolves.toBe(true);
    await expect(
      withPeerPumpingClient(rig.guestCtx, () => host.sendResumeCheckpoint(newestJson, newestCommitment!, 30_000, true)),
      "the next cloud checkpoint follows the prior mutation in account-wide order",
    ).resolves.toBe(true);
    expect(requestedCloudBytes, "serialized cloud requests preserve causal request order").toEqual([
      newerJson,
      newestJson,
    ]);
    expect(completedCloudBytes, "serialized cloud requests also preserve completion/application order").toEqual([
      newerJson,
      newestJson,
    ]);

    const cloudAheadJson = JSON.stringify({
      ...newerRaw,
      waveIndex: newestCommitment!.wave,
      timestamp: commitment!.timestamp - 3,
      coopControlPlane: { interactionCounter: commitment!.revision + 3, journalHighWater: {} },
      coopRun: {
        version: 1,
        runId: commitment!.runId,
        checkpointRevision: commitment!.checkpointRevision + 3,
      },
    });
    const cloudAheadSession = await withClient(rig.hostCtx, () =>
      rig.hostScene.gameData.parseSessionData(cloudAheadJson),
    );
    const cloudAheadCommitment = await deriveCoopResumeCommitment(cloudAheadJson, cloudAheadSession);
    expect(cloudAheadCommitment).not.toBeNull();
    const replicaKey = await withClient(rig.guestCtx, () => getSessionDataLocalStorageKey(marker!.slot));
    const localBeforeFailedCloud = localStorage.getItem(replicaKey);
    const markerBeforeFailedCloud = readCoopResumeMarker(guest.localName(), host.localName());
    cloudUpdate.mockImplementationOnce(async () => ({
      ok: false,
      status: null,
      error: "Cloud temporarily unavailable.",
      failureKind: "transient",
    }));
    await expect(
      withPeerPumpingClient(rig.guestCtx, () =>
        host.sendResumeCheckpoint(cloudAheadJson, cloudAheadCommitment!, 30_000, true),
      ),
      "a failed cloud CAS NACKs instead of exposing a local-only checkpoint as durable",
    ).resolves.toBe(false);
    expect(localStorage.getItem(replicaKey), "cloud failure restores the exact prior encrypted local bytes").toBe(
      localBeforeFailedCloud,
    );
    expect(
      readCoopResumeMarker(guest.localName(), host.localName()),
      "cloud failure restores the prior resume marker/revision",
    ).toMatchObject(markerBeforeFailedCloud!);

    // A concurrent device can legitimately put N+1 in cloud while this browser still has N.
    // Receiving that exact host checkpoint must rewrite local before ACKing; merely seeing it in
    // cloud is not local durability.
    cloudRead.mockImplementation(async request =>
      request.slot === marker!.slot ? coopCasFound(cloudAheadJson) : coopCasMissing(),
    );
    await expect(
      withPeerPumpingClient(rig.guestCtx, () =>
        host.sendResumeCheckpoint(cloudAheadJson, cloudAheadCommitment!, 30_000, true),
      ),
      "cloud-ahead same-checkpoint receipt converges the stale local replica before ACK",
    ).resolves.toBe(true);
    const convergedLocal = await withClient(rig.guestCtx, () => rig.guestScene.gameData.getSession(marker!.slot));
    expect(convergedLocal?.coopRun, "local replica adopts the cloud-ahead checkpoint").toEqual(
      cloudAheadSession.coopRun,
    );

    const conflictJson = JSON.stringify({
      ...JSON.parse(newestJson),
      money: Number((JSON.parse(newestJson) as { money?: number }).money ?? 0) + 1,
      timestamp: newestCommitment!.timestamp + 1,
    });
    const conflictSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(conflictJson));
    const conflictCommitment = await deriveCoopResumeCommitment(conflictJson, conflictSession);
    expect(conflictCommitment).not.toBeNull();
    await expect(
      withPeerPumpingClient(rig.guestCtx, () => host.sendResumeCheckpoint(conflictJson, conflictCommitment!)),
      "different exact bytes at the same wave/control revision fail closed",
    ).resolves.toBe(false);

    await expect(
      withPeerPumpingClient(rig.guestCtx, () => host.sendResumeCheckpoint(hostJson, commitment!)),
      "reordered old checkpoint is rejected without rollback",
    ).resolves.toBe(false);
    const finalReplica = await withClient(rig.guestCtx, () => rig.guestScene.gameData.getSession(marker!.slot));
    expect(finalReplica?.waveIndex, "delayed old checkpoint cannot roll the guest resume copy backward").toBe(
      newestCommitment!.wave,
    );

    const reversed = await findCoopResumeCandidate(guest.localName(), host.localName(), "host", async slot =>
      slot === marker!.slot && finalReplica != null
        ? { session: finalReplica, sessionJson: JSON.stringify(finalReplica) }
        : undefined,
    );
    expect(
      reversed,
      "former guest accepting/hosting is explicitly blocked instead of silently offered New Game",
    ).toMatchObject({ kind: "unsafe-role-reversal", slot: marker!.slot, wave: newestCommitment!.wave });
    logs.flush();
  }, 300_000);

  it("records an explicit blocker when all guest slots are occupied instead of later offering New Game", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const host = rig.hostRuntime.controller;
    const guest = rig.guestRuntime.controller;
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const hostSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(hostJson));
    const commitment = await deriveCoopResumeCommitment(hostJson, hostSession);
    expect(commitment).not.toBeNull();
    const keys = await withClient(rig.guestCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));

    try {
      clearCoopResumeMarker();
      keys.forEach((key, slot) => localStorage.setItem(key, `unrelated-save-${slot}`));
      await withClient(rig.guestCtx, () => rig.guestScene.gameData.armCoopResumeCheckpointPersistence());
      await expect(
        withPeerPumpingClient(rig.guestCtx, () => host.sendResumeCheckpoint(hostJson, commitment!)),
      ).resolves.toBe(false);
      await expect(
        findCoopResumeCandidate(guest.localName(), host.localName(), "host", async () => undefined),
        "the former guest accepting a later lobby sees known-save evidence, never no-save/New Game",
      ).resolves.toMatchObject({
        kind: "replica-unavailable",
        wave: commitment!.wave,
        seats: commitment!.seats,
      });
    } finally {
      keys.forEach((key, slot) => {
        const value = prior[slot];
        if (value == null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, value);
        }
      });
    }
    logs.flush();
  }, 300_000);

  it("never overwrites cloud-only occupied slots that are absent from the browser cache", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const host = rig.hostRuntime.controller;
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const hostSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(hostJson));
    const commitment = await deriveCoopResumeCommitment(hostJson, hostSession);
    expect(commitment).not.toBeNull();
    const keys = await withClient(rig.guestCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));
    const unrelatedCloudJson = JSON.stringify({
      ...JSON.parse(hostJson),
      coopParticipants: {
        version: 1,
        players: ["Other", "Player"],
        seats: { host: "Other", guest: "Player" },
      },
    });

    try {
      clearCoopResumeMarker();
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      const cloudRead = vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockImplementation(async request =>
        coopCasFound(
          JSON.stringify({
            ...JSON.parse(unrelatedCloudJson),
            coopRun: {
              version: 1,
              runId: `unrelated-cloud-${request.slot}-${"x".repeat(16)}`,
              checkpointRevision: 0,
            },
          }),
        ),
      );
      const cloudWrite = vi.spyOn(pokerogueApi.savedata.session, "updateCoopCas").mockResolvedValue({
        ok: true,
        status: 200,
        error: "",
        failureKind: null,
      });
      await withClient(rig.guestCtx, () => rig.guestScene.gameData.armCoopResumeCheckpointPersistence());
      await expect(
        withPeerPumpingClient(rig.guestCtx, () => host.sendResumeCheckpoint(hostJson, commitment!, 5_000, true)),
        "cloud-only unrelated saves make every candidate slot unsafe",
      ).resolves.toBe(false);
      expect(cloudRead, "every locally absent slot was resolved against cloud state").toHaveBeenCalledTimes(5);
      expect(cloudWrite, "the replica never overwrites an unrelated cloud run").not.toHaveBeenCalled();
      keys.forEach(key => expect(localStorage.getItem(key), `${key} remains locally untouched`).toBeNull());
    } finally {
      keys.forEach((key, slot) => {
        const value = prior[slot];
        if (value == null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, value);
        }
      });
    }
    logs.flush();
  }, 300_000);

  it("refuses to replay a cached co-op row outside a live immutable checkpoint transaction", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const slot = rig.hostScene.sessionSlotId;
    const key = await withClient(rig.hostCtx, () => getSessionDataLocalStorageKey(slot));
    const prior = localStorage.getItem(key);
    const sessionJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const encrypted = encrypt(sessionJson, false);

    try {
      localStorage.setItem(key, encrypted);
      const updateAll = vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue("");
      await expect(
        withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, true, false, true)),
        "cached co-op bytes cannot bypass runtime/controller/generation fencing",
      ).resolves.toBe(false);
      expect(localStorage.getItem(key), "the protected cached row remains byte-identical").toBe(encrypted);
      expect(updateAll, "no legacy cloud mutation is attempted").not.toHaveBeenCalled();
    } finally {
      prior == null ? localStorage.removeItem(key) : localStorage.setItem(key, prior);
    }
    logs.flush();
  }, 300_000);

  it("blocks a malformed ancestry head and reuses an exact tombstoned local slot", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const account = await withClient(rig.hostCtx, () => loggedInUser!.username);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const headKey = (slot: number) => `er-coop-cloud-head:${account.normalize("NFKC").toLowerCase()}:${slot}`;
    const tracked = [...keys, headKey(0), headKey(1), "er-coop-deleted-runs", "er-coop-resume"].map(
      key => [key, localStorage.getItem(key)] as const,
    );
    const baseJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const oldRunId = `old-tombstoned-${"x".repeat(20)}`;
    const oldJson = JSON.stringify({
      ...(JSON.parse(baseJson) as Record<string, unknown>),
      coopRun: { version: 1, runId: oldRunId, checkpointRevision: 4 },
    });
    const oldSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(oldJson));
    const oldCommitment = await deriveCoopResumeCommitment(oldJson, oldSession);
    expect(oldCommitment).not.toBeNull();

    try {
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      localStorage.setItem(headKey(0), "{malformed");
      expect(
        await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot()),
        "malformed slot-0 lineage cannot collapse to absent",
      ).toBe(1);
      await withClient(rig.hostCtx, () => rig.hostScene.gameData.cancelPendingFreshCoopSessionSlot());

      localStorage.setItem(
        headKey(0),
        JSON.stringify({
          version: 1,
          runId: oldCommitment!.runId,
          checkpointRevision: oldCommitment!.checkpointRevision,
          digest: oldCommitment!.digest,
        }),
      );
      expect(
        await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot()),
        "an orphan head without tombstone proof is not treated as an empty slot",
      ).toBe(1);
      await withClient(rig.hostCtx, () => rig.hostScene.gameData.cancelPendingFreshCoopSessionSlot());

      localStorage.setItem(keys[0], encrypt(oldJson, false));
      vi.spyOn(pokerogueApi.savedata.session, "getCoopRunStatus").mockImplementation(async request =>
        request.coopRunId === oldRunId
          ? {
              ok: true,
              status: 200,
              value: {
                state: "tombstoned",
                runId: oldRunId,
                slot: 0,
                checkpointRevision: oldCommitment!.checkpointRevision,
                digest: oldCommitment!.digest,
              },
            }
          : { ok: true, status: 200, value: { state: "missing", runId: request.coopRunId } },
      );
      const deletedEvidenceBeforeFailedCleanup = localStorage.getItem("er-coop-deleted-runs");
      localStorage.setItem("er-coop-resume", "{}");
      expect(
        await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot()),
        "tombstone adoption fails closed when lineage cleanup cannot be proven",
      ).toBe(1);
      expect(localStorage.getItem(keys[0])).not.toBeNull();
      expect(
        localStorage.getItem("er-coop-deleted-runs"),
        "failed cleanup rolls back its deletion fence instead of partially suppressing the protected row",
      ).toBe(deletedEvidenceBeforeFailedCleanup);
      await withClient(rig.hostCtx, () => rig.hostScene.gameData.cancelPendingFreshCoopSessionSlot());
      localStorage.removeItem("er-coop-resume");
      expect(
        await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot()),
        "status-proven tombstone retires exact local/head lineage and permits reuse",
      ).toBe(0);
      expect(localStorage.getItem(keys[0])).toBeNull();
      expect(localStorage.getItem(headKey(0))).toBeNull();
    } finally {
      tracked.forEach(([key, value]) => {
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("converges exact same-lineage duplicate cloud rows and rejects an equal-revision fork", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const account = await withClient(rig.hostCtx, () => loggedInUser!.username);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const headKeys = [0, 1].map(slot => `er-coop-cloud-head:${account.normalize("NFKC").toLowerCase()}:${slot}`);
    const tracked = [...keys, ...headKeys].map(key => [key, localStorage.getItem(key)] as const);
    const baseJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const base = JSON.parse(baseJson) as Record<string, unknown>;
    const checkpoint = async (revision: number, moneyDelta = 0) => {
      const json = JSON.stringify({
        ...base,
        money: Number(base.money ?? 0) + moneyDelta,
        waveIndex: Number(base.waveIndex ?? 1) + revision,
        timestamp: Number(base.timestamp ?? 1) + revision,
        coopRun: {
          version: 1,
          runId: (base.coopRun as { runId: string }).runId,
          checkpointRevision: revision,
        },
      });
      const session = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(json));
      const commitment = await deriveCoopResumeCommitment(json, session);
      expect(commitment).not.toBeNull();
      return { json, commitment: commitment! };
    };
    const older = await checkpoint(1);
    const survivor = await checkpoint(2);
    const cloud = new Map<number, string>([
      [0, older.json],
      [1, survivor.json],
    ]);

    try {
      keys.forEach(key => localStorage.removeItem(key));
      headKeys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockImplementation(async request => {
        const raw = cloud.get(request.slot);
        return raw == null ? coopCasMissing() : coopCasFound(raw);
      });
      const duplicateDelete = vi
        .spyOn(pokerogueApi.savedata.session, "deleteCoopDuplicateExact")
        .mockImplementation(async request => {
          expect(request.slot).toBe(0);
          expect(request.survivorSlot).toBe(1);
          cloud.delete(request.slot);
          return { ok: true, status: 200, error: "", failureKind: null };
        });
      vi.spyOn(pokerogueApi.savedata.session, "getCoopRunStatus").mockResolvedValue({
        ok: true,
        status: 200,
        value: {
          state: "active",
          runId: survivor.commitment.runId,
          slot: 1,
          checkpointRevision: survivor.commitment.checkpointRevision,
          digest: survivor.commitment.digest,
        },
      });

      const sessions = await withClient(rig.hostCtx, () => rig.hostScene.gameData.getSessionsForCoopResume());
      expect(duplicateDelete).toHaveBeenCalledOnce();
      expect(sessions.get(0)).toBeUndefined();
      expect(sessions.get(1)?.sessionJson).toBe(survivor.json);

      keys.forEach(key => localStorage.removeItem(key));
      headKeys.forEach(key => localStorage.removeItem(key));
      const fork = await checkpoint(2, 1);
      cloud.set(0, survivor.json);
      cloud.set(1, fork.json);
      duplicateDelete.mockClear();
      await expect(
        withClient(rig.hostCtx, () => rig.hostScene.gameData.getSessionsForCoopResume()),
        "equal revisions with different exact digests never pick a winner",
      ).rejects.toThrow("equal-revision fork");
      expect(duplicateDelete).not.toHaveBeenCalled();
    } finally {
      tracked.forEach(([key, value]) => {
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("finishes duplicate loser cleanup after a crash cut between cloud delete and local cleanup", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const account = await withClient(rig.hostCtx, () => loggedInUser!.username);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const headKey = `er-coop-cloud-head:${account.normalize("NFKC").toLowerCase()}:0`;
    const survivorHeadKey = `er-coop-cloud-head:${account.normalize("NFKC").toLowerCase()}:1`;
    const debtKey = `er-coop-duplicate-debt:${account.normalize("NFKC").toLowerCase()}:0`;
    const trackedKeys = [...keys, headKey, survivorHeadKey, debtKey];
    const tracked = trackedKeys.map(key => [key, localStorage.getItem(key)] as const);
    const base = JSON.parse(await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene))) as Record<
      string,
      unknown
    >;
    const checkpoint = async (revision: number) => {
      const json = JSON.stringify({
        ...base,
        waveIndex: Number(base.waveIndex ?? 1) + revision,
        timestamp: Number(base.timestamp ?? 1) + revision,
        coopRun: {
          ...(base.coopRun as object),
          checkpointRevision: revision,
        },
      });
      const session = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(json));
      const commitment = await deriveCoopResumeCommitment(json, session);
      expect(commitment).not.toBeNull();
      return { json, commitment: commitment! };
    };
    const loser = await checkpoint(1);
    const survivor = await checkpoint(2);
    const cloud = new Map<number, string>([
      [0, loser.json],
      [1, survivor.json],
    ]);
    let crashCut: { mockRestore(): void } | null = null;

    try {
      trackedKeys.forEach(key => localStorage.removeItem(key));
      localStorage.setItem(keys[0], encrypt(loser.json, false));
      localStorage.setItem(
        headKey,
        JSON.stringify({
          version: 1,
          runId: loser.commitment.runId,
          checkpointRevision: loser.commitment.checkpointRevision,
          digest: loser.commitment.digest,
        }),
      );
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockImplementation(async request => {
        const raw = cloud.get(request.slot);
        return raw == null ? coopCasMissing() : coopCasFound(raw);
      });
      const duplicateDelete = vi
        .spyOn(pokerogueApi.savedata.session, "deleteCoopDuplicateExact")
        .mockImplementation(async request => {
          cloud.delete(request.slot);
          return { ok: true, status: 200, error: "", failureKind: null };
        });
      vi.mocked(pokerogueApi.savedata.session.getCoopRunStatus).mockResolvedValue({
        ok: true,
        status: 200,
        value: {
          state: "active",
          runId: survivor.commitment.runId,
          slot: 1,
          checkpointRevision: survivor.commitment.checkpointRevision,
          digest: survivor.commitment.digest,
        },
      });
      const originalRemove = localStorage.removeItem;
      crashCut = vi.spyOn(localStorage, "removeItem").mockImplementation(function (this: Storage, key: string) {
        if (key === keys[0]) {
          throw new DOMException("simulated crash cut", "InvalidStateError");
        }
        return originalRemove.call(this, key);
      });

      await expect(
        withClient(rig.hostCtx, () => rig.hostScene.gameData.getSessionsForCoopResume()),
        "the first scan fails closed after the cloud delete instead of hiding incomplete local cleanup",
      ).rejects.toThrow("local lineage could not converge");
      expect(cloud.has(0), "the exact cloud loser was deleted").toBe(false);
      expect(localStorage.getItem(keys[0]), "the simulated crash leaves the local loser intact").not.toBeNull();
      expect(localStorage.getItem(debtKey), "durable convergence intent survives the crash cut").not.toBeNull();
      crashCut.mockRestore();

      const recovered = await withClient(rig.hostCtx, () => rig.hostScene.gameData.getSessionsForCoopResume());
      expect(recovered.get(0), "the absent loser is not rediscovered").toBeUndefined();
      expect(recovered.get(1)?.sessionJson, "the exact survivor remains authoritative").toBe(survivor.json);
      expect(
        duplicateDelete,
        "recovery does not issue a second destructive request for an absent loser",
      ).toHaveBeenCalledOnce();
      expect(localStorage.getItem(keys[0]), "recovery retires the dominated local loser").toBeNull();
      expect(localStorage.getItem(headKey), "recovery clears the loser ancestry head").toBeNull();
      expect(localStorage.getItem(debtKey), "intent clears only after all cleanup proofs pass").toBeNull();
    } finally {
      crashCut?.mockRestore();
      tracked.forEach(([key, value]) => {
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("serializes duplicate repair and rechecks the account immediately before destructive delete", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const account = await withClient(rig.hostCtx, () => loggedInUser!.username);
    const priorUsername = loggedInUser?.username;
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const headKeys = [0, 1].map(slot => `er-coop-cloud-head:${account.normalize("NFKC").toLowerCase()}:${slot}`);
    const debtKeys = [0, 1].map(slot => `er-coop-duplicate-debt:${account.normalize("NFKC").toLowerCase()}:${slot}`);
    const trackedKeys = [...keys, ...headKeys, ...debtKeys];
    const tracked = trackedKeys.map(key => [key, localStorage.getItem(key)] as const);
    const baseJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const base = JSON.parse(baseJson) as Record<string, unknown>;
    const checkpoint = async (revision: number) => {
      const json = JSON.stringify({
        ...base,
        waveIndex: Number(base.waveIndex ?? 1) + revision,
        timestamp: Number(base.timestamp ?? 1) + revision,
        coopRun: {
          version: 1,
          runId: (base.coopRun as { runId: string }).runId,
          checkpointRevision: revision,
        },
      });
      const session = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(json));
      const commitment = await deriveCoopResumeCommitment(json, session);
      expect(commitment).not.toBeNull();
      return { json, commitment: commitment! };
    };
    const loser = await checkpoint(1);
    const survivor = await checkpoint(2);
    const cloud = new Map<number, string>();

    try {
      trackedKeys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      const cloudRead = vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockImplementation(async request => {
        const raw = cloud.get(request.slot);
        return raw == null ? coopCasMissing() : coopCasFound(raw);
      });
      const duplicateDelete = vi
        .spyOn(pokerogueApi.savedata.session, "deleteCoopDuplicateExact")
        .mockImplementation(async request => {
          cloud.delete(request.slot);
          return { ok: true, status: 200, error: "", failureKind: null };
        });
      vi.spyOn(pokerogueApi.savedata.session, "getCoopRunStatus").mockResolvedValue({
        ok: true,
        status: 200,
        value: {
          state: "active",
          runId: survivor.commitment.runId,
          slot: 1,
          checkpointRevision: survivor.commitment.checkpointRevision,
          digest: survivor.commitment.digest,
        },
      });

      const runWithBlockedQueue = async (switchAccount: boolean) => {
        cloud.clear();
        cloud.set(0, loser.json);
        cloud.set(1, survivor.json);
        cloudRead.mockClear();
        duplicateDelete.mockClear();
        let releaseBlocker!: () => void;
        let blockerStarted!: () => void;
        const started = new Promise<void>(resolve => {
          blockerStarted = resolve;
        });
        const gate = new Promise<void>(resolve => {
          releaseBlocker = resolve;
        });
        const blocker = enqueueSessionCloudMutation(account, async () => {
          blockerStarted();
          await gate;
        });
        await started;
        const scan = withClient(rig.hostCtx, () => rig.hostScene.gameData.getSessionsForCoopResume());
        await vi.waitFor(() => expect(cloudRead.mock.calls.length).toBeGreaterThanOrEqual(5));
        await flush();
        expect(duplicateDelete, "repair cannot bypass the account mutation tail").not.toHaveBeenCalled();
        if (switchAccount && loggedInUser != null) {
          loggedInUser.username = `${account}-changed`;
        }
        releaseBlocker();
        await blocker;
        if (switchAccount) {
          await expect(scan).rejects.toThrow(/account|runtime/iu);
          expect(duplicateDelete, "stale account never issues the destructive request").not.toHaveBeenCalled();
        } else {
          await expect(scan).resolves.toBeInstanceOf(Map);
          expect(duplicateDelete).toHaveBeenCalledOnce();
        }
      };

      await runWithBlockedQueue(false);
      await runWithBlockedQueue(true);
    } finally {
      if (loggedInUser != null && priorUsername != null) {
        loggedInUser.username = priorUsername;
      }
      tracked.forEach(([key, value]) => {
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("imports over an exact tombstone with empty CAS and swaps ancestry only after success", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const account = await withClient(rig.hostCtx, () => loggedInUser!.username);
    const slot = 0;
    const localKey = await withClient(rig.hostCtx, () => getSessionDataLocalStorageKey(slot));
    const headKey = `er-coop-cloud-head:${account.normalize("NFKC").toLowerCase()}:${slot}`;
    const trackedKeys = [localKey, headKey, "er-coop-deleted-runs", `data_${account}`];
    const tracked = trackedKeys.map(key => [key, localStorage.getItem(key)] as const);
    const incomingJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const incomingSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(incomingJson));
    const incoming = await deriveCoopResumeCommitment(incomingJson, incomingSession);
    expect(incoming).not.toBeNull();
    const oldRunId = `old-import-${"z".repeat(22)}`;
    const oldJson = JSON.stringify({
      ...(JSON.parse(incomingJson) as Record<string, unknown>),
      coopRun: { version: 1, runId: oldRunId, checkpointRevision: 9 },
    });
    const oldSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(oldJson));
    const old = await deriveCoopResumeCommitment(oldJson, oldSession);
    expect(old).not.toBeNull();
    const systemJson = await withClient(rig.hostCtx, () =>
      JSON.stringify(rig.hostScene.gameData.getSystemSaveData(), (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    );

    try {
      setBypassLoginForTesting(false);
      localStorage.setItem(localKey, encrypt(oldJson, false));
      localStorage.setItem(
        headKey,
        JSON.stringify({
          version: 1,
          runId: old!.runId,
          checkpointRevision: old!.checkpointRevision,
          digest: old!.digest,
        }),
      );
      vi.spyOn(pokerogueApi.savedata.system, "update").mockResolvedValue("");
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue(coopCasMissing());
      vi.spyOn(pokerogueApi.savedata.session, "getCoopRunStatus").mockImplementation(async request =>
        request.coopRunId === oldRunId
          ? {
              ok: true,
              status: 200,
              value: {
                state: "tombstoned",
                runId: oldRunId,
                slot,
                checkpointRevision: old!.checkpointRevision,
                digest: old!.digest,
              },
            }
          : { ok: true, status: 200, value: { state: "missing", runId: request.coopRunId } },
      );
      const cloudWrite = vi.spyOn(pokerogueApi.savedata.session, "updateCoopCas").mockResolvedValue({
        ok: false,
        status: 409,
        error: "conflict",
        failureKind: "conflict",
      });
      const bundle = { system: systemJson, sessions: [{ slot, data: incomingJson }] };

      await expect(
        withClient(rig.hostCtx, () => rig.hostScene.gameData.importLocalSaveBundle(bundle)),
        "failed empty CAS preserves exact old local/head bytes",
      ).resolves.toBe(false);
      expect(decrypt(localStorage.getItem(localKey)!, false)).toBe(oldJson);
      expect(JSON.parse(localStorage.getItem(headKey) ?? "null")).toMatchObject({ runId: oldRunId });

      cloudWrite.mockResolvedValue({ ok: true, status: 200, error: "", failureKind: null });
      await expect(withClient(rig.hostCtx, () => rig.hostScene.gameData.importLocalSaveBundle(bundle))).resolves.toBe(
        true,
      );
      expect(cloudWrite.mock.calls.at(-1)?.[0].coopCasMode).toBe("empty");
      expect(decrypt(localStorage.getItem(localKey)!, false)).toBe(incomingJson);
      expect(JSON.parse(localStorage.getItem(headKey) ?? "null")).toMatchObject({
        runId: incoming!.runId,
        checkpointRevision: incoming!.checkpointRevision,
        digest: incoming!.digest,
      });

      const incomingShape = JSON.parse(incomingJson) as Record<string, unknown>;
      const participants = incomingShape.coopParticipants as {
        version: 1;
        players: [string, string];
        seats: { host: string; guest: string };
      };
      const swappedJson = JSON.stringify({
        ...incomingShape,
        timestamp: incoming!.timestamp + 1,
        coopRun: {
          version: 1,
          runId: incoming!.runId,
          checkpointRevision: incoming!.checkpointRevision + 1,
        },
        coopParticipants: {
          ...participants,
          seats: { host: participants.seats.guest, guest: participants.seats.host },
        },
      });
      vi.spyOn(pokerogueApi.savedata.session, "getCoopRunStatus").mockResolvedValue({
        ok: true,
        status: 200,
        value: {
          state: "active",
          runId: incoming!.runId,
          slot,
          checkpointRevision: incoming!.checkpointRevision,
          digest: incoming!.digest,
        },
      });
      cloudWrite.mockClear();
      await expect(
        withClient(rig.hostCtx, () =>
          rig.hostScene.gameData.importLocalSaveBundle({
            system: systemJson,
            sessions: [{ slot, data: swappedJson }],
          }),
        ),
        "same-run import cannot change the exact authority seat map",
      ).resolves.toBe(false);
      expect(cloudWrite).not.toHaveBeenCalled();
      expect(decrypt(localStorage.getItem(localKey)!, false)).toBe(incomingJson);
    } finally {
      tracked.forEach(([key, value]) => {
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("recovers cloud-new/local-tombstoned state after a protected import local write fails", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const account = await withClient(rig.hostCtx, () => loggedInUser!.username);
    const slot = 0;
    const localKey = await withClient(rig.hostCtx, () => getSessionDataLocalStorageKey(slot));
    const headKey = `er-coop-cloud-head:${account.normalize("NFKC").toLowerCase()}:${slot}`;
    const trackedKeys = [localKey, headKey, "er-coop-deleted-runs", "er-coop-resume", `data_${account}`];
    const tracked = trackedKeys.map(key => [key, localStorage.getItem(key)] as const);
    const incomingJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const incomingSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(incomingJson));
    const incoming = await deriveCoopResumeCommitment(incomingJson, incomingSession);
    expect(incoming).not.toBeNull();
    const oldRunId = `failed-import-${"o".repeat(24)}`;
    const oldJson = JSON.stringify({
      ...(JSON.parse(incomingJson) as Record<string, unknown>),
      coopRun: { version: 1, runId: oldRunId, checkpointRevision: 8 },
    });
    const oldSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(oldJson));
    const old = await deriveCoopResumeCommitment(oldJson, oldSession);
    expect(old).not.toBeNull();
    const systemJson = await withClient(rig.hostCtx, () =>
      JSON.stringify(rig.hostScene.gameData.getSystemSaveData(), (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    );
    let cloudRaw: string | null = null;
    const originalSetItem = localStorage.setItem;
    let failIncomingLocalWrite = true;
    let storageWrite: ReturnType<typeof vi.spyOn> | null = null;

    try {
      setBypassLoginForTesting(false);
      localStorage.setItem(localKey, encrypt(oldJson, false));
      localStorage.setItem(
        headKey,
        JSON.stringify({
          version: 1,
          runId: old!.runId,
          checkpointRevision: old!.checkpointRevision,
          digest: old!.digest,
        }),
      );
      vi.spyOn(pokerogueApi.savedata.system, "update").mockResolvedValue("");
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockImplementation(async request =>
        request.slot === slot && cloudRaw != null ? coopCasFound(cloudRaw) : coopCasMissing(),
      );
      vi.spyOn(pokerogueApi.savedata.session, "getCoopRunStatus").mockImplementation(async request => {
        if (request.coopRunId === oldRunId) {
          return {
            ok: true,
            status: 200,
            value: {
              state: "tombstoned",
              runId: oldRunId,
              slot,
              checkpointRevision: old!.checkpointRevision,
              digest: old!.digest,
            },
          };
        }
        if (cloudRaw === incomingJson && request.coopRunId === incoming!.runId) {
          return {
            ok: true,
            status: 200,
            value: {
              state: "active",
              runId: incoming!.runId,
              slot,
              checkpointRevision: incoming!.checkpointRevision,
              digest: incoming!.digest,
            },
          };
        }
        return { ok: true, status: 200, value: { state: "missing", runId: request.coopRunId } };
      });
      vi.spyOn(pokerogueApi.savedata.session, "updateCoopCas").mockImplementation(async (_request, raw) => {
        cloudRaw = raw;
        return { ok: true, status: 200, error: "", failureKind: null };
      });
      storageWrite = vi.spyOn(localStorage, "setItem").mockImplementation(function (
        this: Storage,
        key: string,
        value: string,
      ) {
        if (failIncomingLocalWrite && key === localKey) {
          try {
            if (decrypt(value, false) === incomingJson) {
              failIncomingLocalWrite = false;
              throw new DOMException("quota", "QuotaExceededError");
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === "QuotaExceededError") {
              throw error;
            }
            // A non-save write is not the exact incoming checkpoint targeted by this fault.
          }
        }
        return originalSetItem.call(this, key, value);
      });

      await expect(
        withClient(rig.hostCtx, () =>
          rig.hostScene.gameData.importLocalSaveBundle({
            system: systemJson,
            sessions: [{ slot, data: incomingJson }],
          }),
        ),
        "post-CAS storage failure is a false result, never an unhandled rejection",
      ).resolves.toBe(false);
      expect(cloudRaw, "the backend exact checkpoint remains committed").toBe(incomingJson);
      expect(decrypt(localStorage.getItem(localKey)!, false), "old exact local bytes remain intact").toBe(oldJson);
      expect(JSON.parse(localStorage.getItem(headKey) ?? "null")).toMatchObject({ runId: incoming!.runId });

      const sessions = await withClient(rig.hostCtx, () => rig.hostScene.gameData.getSessionsForCoopResume());
      expect(sessions.get(slot)?.sessionJson, "next discovery retires old tombstoned local and adopts cloud").toBe(
        incomingJson,
      );
      expect(decrypt(localStorage.getItem(localKey)!, false)).toBe(incomingJson);
    } finally {
      storageWrite?.mockRestore();
      tracked.forEach(([key, value]) => {
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("never lets a solo cloud replica hide legacy co-op local bytes", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const slot = 0;
    const key = await withClient(rig.hostCtx, () => getSessionDataLocalStorageKey(slot));
    const prior = localStorage.getItem(key);
    const account = await withClient(rig.hostCtx, () => loggedInUser!.username);
    const systemKey = `data_${account}`;
    const priorSystem = localStorage.getItem(systemKey);
    const base = JSON.parse(await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene))) as Record<
      string,
      unknown
    >;
    const legacyJson = JSON.stringify({ ...base, coopRun: undefined });
    const { coopRun: _run, coopParticipants: _participants, coopControlPlane: _control, ...soloShape } = base;
    const soloJson = JSON.stringify({ ...soloShape, gameMode: GameModes.CLASSIC });

    try {
      setBypassLoginForTesting(false);
      localStorage.setItem(key, encrypt(legacyJson, false));
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockImplementation(async request =>
        request.slot === slot ? coopCasFound(soloJson) : coopCasMissing(),
      );
      await expect(
        withClient(rig.hostCtx, () => rig.hostScene.gameData.getSessionsForCoopResume()),
        "legacy/unknown protection is explicit and cannot collapse into local-first solo",
      ).rejects.toThrow("conflicting protection classes");
      expect(decrypt(localStorage.getItem(key)!, false)).toBe(legacyJson);

      localStorage.setItem(systemKey, "system-before-protected-save");
      rig.hostScene.sessionSlotId = slot;
      const cloudWrite = vi.spyOn(pokerogueApi.savedata.session, "updateCoopCas");
      await expect(
        withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, false, false, true)),
        "local protection is classified before any system/session write",
      ).resolves.toBe(false);
      expect(localStorage.getItem(systemKey)).toBe("system-before-protected-save");
      expect(decrypt(localStorage.getItem(key)!, false)).toBe(legacyJson);
      expect(cloudWrite).not.toHaveBeenCalled();
    } finally {
      prior == null ? localStorage.removeItem(key) : localStorage.setItem(key, prior);
      priorSystem == null ? localStorage.removeItem(systemKey) : localStorage.setItem(systemKey, priorSystem);
    }
    logs.flush();
  }, 300_000);

  it("retires an exact tombstoned local authority before adopting live co-op or solo cloud state", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const slot = 0;
    const account = await withClient(rig.hostCtx, () => loggedInUser!.username);
    const localKey = await withClient(rig.hostCtx, () => getSessionDataLocalStorageKey(slot));
    const headKey = `er-coop-cloud-head:${account.normalize("NFKC").toLowerCase()}:${slot}`;
    const trackedKeys = [localKey, headKey, "er-coop-deleted-runs", "er-coop-resume", "er-coop-resume-unavailable"];
    const tracked = trackedKeys.map(key => [key, localStorage.getItem(key)] as const);
    const base = JSON.parse(await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene))) as Record<
      string,
      unknown
    >;
    const checkpoint = async (runId: string, revision: number, moneyDelta = 0) => {
      const json = JSON.stringify({
        ...base,
        money: Number(base.money ?? 0) + moneyDelta,
        timestamp: Number(base.timestamp ?? 1) + revision + moneyDelta,
        coopRun: { version: 1, runId, checkpointRevision: revision },
      });
      const session = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(json));
      const commitment = await deriveCoopResumeCommitment(json, session);
      expect(commitment).not.toBeNull();
      return { json, commitment: commitment! };
    };
    const soloJson = JSON.stringify(
      Object.fromEntries(
        Object.entries({ ...base, gameMode: GameModes.CLASSIC }).filter(
          ([key]) => !["coopRun", "coopParticipants", "coopControlPlane"].includes(key),
        ),
      ),
    );
    let cloudRaw: string | null = null;
    const statusByRun = new Map<
      string,
      | { state: "missing" }
      | { state: "active" | "tombstoned"; slot: number; checkpointRevision: number; digest: string }
    >();

    try {
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockImplementation(async request =>
        request.slot === slot && cloudRaw != null ? coopCasFound(cloudRaw) : coopCasMissing(),
      );
      vi.spyOn(pokerogueApi.savedata.session, "getCoopRunStatus").mockImplementation(async request => {
        const state = statusByRun.get(request.coopRunId) ?? { state: "missing" as const };
        return state.state === "missing"
          ? { ok: true, status: 200, value: { state: "missing", runId: request.coopRunId } }
          : {
              ok: true,
              status: 200,
              value: { ...state, runId: request.coopRunId },
            };
      });

      const adoptCloud = async (cloudKind: "coop" | "solo", suffix: string) => {
        trackedKeys.forEach(key => localStorage.removeItem(key));
        const local = await checkpoint(`tomb-local-${suffix}-${"a".repeat(18)}`, 3);
        const remote = await checkpoint(`live-cloud-${suffix}-${"b".repeat(18)}`, 4, 1);
        localStorage.setItem(localKey, encrypt(local.json, false));
        localStorage.setItem(
          headKey,
          JSON.stringify({
            version: 1,
            runId: local.commitment.runId,
            checkpointRevision: local.commitment.checkpointRevision,
            digest: local.commitment.digest,
          }),
        );
        cloudRaw = cloudKind === "coop" ? remote.json : soloJson;
        statusByRun.clear();
        statusByRun.set(local.commitment.runId, {
          state: "tombstoned",
          slot,
          checkpointRevision: local.commitment.checkpointRevision,
          digest: local.commitment.digest,
        });
        if (cloudKind === "coop") {
          statusByRun.set(remote.commitment.runId, {
            state: "active",
            slot,
            checkpointRevision: remote.commitment.checkpointRevision,
            digest: remote.commitment.digest,
          });
        }
        const sessions = await withClient(rig.hostCtx, () => rig.hostScene.gameData.getSessionsForCoopResume());
        expect(sessions.get(slot)?.sessionJson).toBe(cloudRaw);
        expect(
          decrypt(localStorage.getItem(localKey)!, false),
          `${cloudKind} cloud becomes the exact local replica`,
        ).toBe(cloudRaw);
        return { local, remote };
      };

      await adoptCloud("coop", "coop");
      await adoptCloud("solo", "solo");

      trackedKeys.forEach(key => localStorage.removeItem(key));
      const local = await checkpoint(`active-local-${"c".repeat(22)}`, 5);
      const remote = await checkpoint(`active-cloud-${"d".repeat(22)}`, 6, 2);
      localStorage.setItem(localKey, encrypt(local.json, false));
      cloudRaw = remote.json;
      statusByRun.clear();
      statusByRun.set(local.commitment.runId, {
        state: "active",
        slot,
        checkpointRevision: local.commitment.checkpointRevision,
        digest: local.commitment.digest,
      });
      statusByRun.set(remote.commitment.runId, {
        state: "active",
        slot,
        checkpointRevision: remote.commitment.checkpointRevision,
        digest: remote.commitment.digest,
      });
      await expect(
        withClient(rig.hostCtx, () => rig.hostScene.gameData.getSessionsForCoopResume()),
        "two non-tombstoned authorities remain an explicit conflict",
      ).rejects.toThrow("distinct non-tombstoned authorities");
      expect(decrypt(localStorage.getItem(localKey)!, false)).toBe(local.json);
    } finally {
      tracked.forEach(([key, value]) => {
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("requires the account Web Lock before ordinary caching of legacy co-op or opaque bytes", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const slot = 0;
    const key = await withClient(rig.hostCtx, () => getSessionDataLocalStorageKey(slot));
    const prior = localStorage.getItem(key);
    const base = JSON.parse(await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene))) as Record<
      string,
      unknown
    >;
    const legacyJson = JSON.stringify({ ...base, coopRun: undefined });

    try {
      setBypassLoginForTesting(false);
      localStorage.removeItem(key);
      const cloudRead = vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue({
        ok: false,
        status: 401,
        error: '{"gameMode":6,"coopRun":{"runId":"looks-like-save"}}',
        failureKind: "unauthorized",
      });
      await expect(
        withClient(rig.hostCtx, () => rig.hostScene.gameData.getSession(slot)),
        "typed error bodies can never masquerade as savedata",
      ).resolves.toBeUndefined();
      expect(localStorage.getItem(key)).toBeNull();

      cloudRead.mockImplementation(async request =>
        request.slot === slot ? coopCasFound(legacyJson) : coopCasMissing(),
      );
      Reflect.deleteProperty(globalThis.navigator, "locks");
      await expect(withClient(rig.hostCtx, () => rig.hostScene.gameData.getSession(slot))).resolves.toBeUndefined();
      expect(localStorage.getItem(key), "unlocked ordinary cache cannot publish protected bytes").toBeNull();
    } finally {
      prior == null ? localStorage.removeItem(key) : localStorage.setItem(key, prior);
    }
    logs.flush();
  }, 300_000);

  it("never ACKs a local-only guest checkpoint over an unresolved different-run cloud head", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const account = await withClient(rig.guestCtx, () => loggedInUser!.username);
    const keys = await withClient(rig.guestCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const headKey = `er-coop-cloud-head:${account.normalize("NFKC").toLowerCase()}:0`;
    const trackedKeys = [...keys, headKey, "er-coop-deleted-runs", "er-coop-resume", "er-coop-resume-unavailable"];
    const tracked = trackedKeys.map(key => [key, localStorage.getItem(key)] as const);
    const incomingJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const incomingSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(incomingJson));
    const incoming = await deriveCoopResumeCommitment(incomingJson, incomingSession);
    expect(incoming).not.toBeNull();
    const displacedRunId = `displaced-head-${"h".repeat(22)}`;
    let displacedState: "active" | "tombstoned" = "active";

    try {
      setBypassLoginForTesting(false);
      keys.forEach(key => localStorage.removeItem(key));
      localStorage.setItem(
        headKey,
        JSON.stringify({
          version: 1,
          runId: displacedRunId,
          checkpointRevision: 9,
          digest: "e".repeat(64),
        }),
      );
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue(coopCasMissing());
      vi.spyOn(pokerogueApi.savedata.session, "getCoopRunStatus").mockImplementation(async request =>
        request.coopRunId === displacedRunId
          ? {
              ok: true,
              status: 200,
              value: {
                state: displacedState,
                runId: displacedRunId,
                slot: 0,
                checkpointRevision: 9,
                digest: "e".repeat(64),
              },
            }
          : { ok: true, status: 200, value: { state: "missing", runId: request.coopRunId } },
      );
      const cloudWrite = vi.spyOn(pokerogueApi.savedata.session, "updateCoopCas").mockResolvedValue({
        ok: true,
        status: 200,
        error: "",
        failureKind: null,
      });
      await withClient(rig.guestCtx, () => rig.guestScene.gameData.armCoopResumeCheckpointPersistence());

      await expect(
        withClient(rig.guestCtx, () =>
          rig.guestScene.gameData.persistCurrentCoopResumeCheckpoint(incomingJson, incoming!, false),
        ),
        "an active different-run lineage cannot be overlaid by transient local debt",
      ).resolves.toEqual({ success: false, reason: "cloud-conflict" });
      expect(localStorage.getItem(keys[0])).toBeNull();
      expect(cloudWrite).not.toHaveBeenCalled();

      displacedState = "tombstoned";
      await expect(
        withClient(rig.guestCtx, () =>
          rig.guestScene.gameData.persistCurrentCoopResumeCheckpoint(incomingJson, incoming!, true),
        ),
        "an exact tombstone permits lineage retirement followed by a new cloud-backed checkpoint",
      ).resolves.toEqual({ success: true });
      expect(decrypt(localStorage.getItem(keys[0])!, false)).toBe(incomingJson);
      expect(cloudWrite, "the new lineage wins an empty-slot cloud CAS before ACK").toHaveBeenCalledOnce();
      expect(
        JSON.parse(localStorage.getItem(headKey) ?? "null"),
        "the displaced head is replaced before ACK",
      ).toMatchObject({
        runId: incoming!.runId,
        checkpointRevision: incoming!.checkpointRevision,
        digest: incoming!.digest,
      });
    } finally {
      tracked.forEach(([key, value]) => {
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("rejects a same-run local orphan and scans for an exact cloud-backed survivor before ACK", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const account = await withClient(rig.guestCtx, () => loggedInUser!.username);
    const keys = await withClient(rig.guestCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const survivorHeadKey = `er-coop-cloud-head:${account.normalize("NFKC").toLowerCase()}:2`;
    const tracked = [...keys, survivorHeadKey].map(key => [key, localStorage.getItem(key)] as const);
    const base = JSON.parse(await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene))) as Record<
      string,
      unknown
    >;
    const checkpoint = async (revision: number) => {
      const json = JSON.stringify({
        ...base,
        waveIndex: Number(base.waveIndex ?? 1) + revision,
        timestamp: Number(base.timestamp ?? 1) + revision,
        coopRun: {
          ...(base.coopRun as object),
          checkpointRevision: revision,
        },
      });
      const session = await withClient(rig.guestCtx, () => rig.guestScene.gameData.parseSessionData(json));
      const commitment = await deriveCoopResumeCommitment(json, session);
      expect(commitment).not.toBeNull();
      return { json, commitment: commitment! };
    };
    const orphan = await checkpoint(1);
    const survivor = await checkpoint(2);
    const incoming = await checkpoint(3);
    const cloud = new Map<number, string>();

    try {
      keys.forEach(key => localStorage.removeItem(key));
      localStorage.removeItem(survivorHeadKey);
      localStorage.setItem(keys[0], encrypt(orphan.json, false));
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockImplementation(async request => {
        const raw = cloud.get(request.slot);
        return raw == null ? coopCasMissing() : coopCasFound(raw);
      });
      await withClient(rig.guestCtx, () => {
        recordCoopResumeMarker(
          0,
          rig.guestRuntime.controller.localName(),
          rig.guestRuntime.controller.partnerName!,
          orphan.commitment.wave,
          orphan.commitment.runId,
          orphan.commitment.checkpointRevision,
        );
        rig.guestScene.gameData.armCoopResumeCheckpointPersistence();
      });

      await expect(
        withClient(rig.guestCtx, () =>
          rig.guestScene.gameData.persistCurrentCoopResumeCheckpoint(incoming.json, incoming.commitment, false),
        ),
        "a marker-local same-run row with no cloud parent cannot become local-only authority",
      ).resolves.toEqual({ success: false, reason: "no-safe-slot" });
      expect(decrypt(localStorage.getItem(keys[0])!, false), "the orphan is retained as explicit recovery debt").toBe(
        orphan.json,
      );

      cloud.set(2, survivor.json);
      await expect(
        withClient(rig.guestCtx, () =>
          rig.guestScene.gameData.persistCurrentCoopResumeCheckpoint(incoming.json, incoming.commitment, false),
        ),
        "the complete scan relocates persistence onto the exact cloud-backed survivor",
      ).resolves.toEqual({ success: true });
      expect(
        decrypt(localStorage.getItem(keys[2])!, false),
        "the survivor slot advances to the incoming checkpoint",
      ).toBe(incoming.json);
      expect(decrypt(localStorage.getItem(keys[0])!, false), "the unproved orphan is never destructively cleaned").toBe(
        orphan.json,
      );
      expect(
        readCoopResumeMarker(rig.guestRuntime.controller.localName(), rig.guestRuntime.controller.partnerName)?.slot,
      ).toBe(2);
    } finally {
      tracked.forEach(([key, value]) => {
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it.each([
    { outcome: "success" as const, expectedSave: true, expectedEvents: ["authority", "guest:true"] },
    { outcome: "transient" as const, expectedSave: true, expectedEvents: ["authority", "guest:false"] },
    { outcome: "transient-diverged" as const, expectedSave: false, expectedEvents: ["authority"] },
    { outcome: "conflict" as const, expectedSave: false, expectedEvents: ["authority"] },
    { outcome: "conflict-rollback-failure" as const, expectedSave: false, expectedEvents: ["authority"] },
  ])("orders an existing authority CAS before guest persistence ($outcome)", async ({
    outcome,
    expectedSave,
    expectedEvents,
  }) => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));
    const cloudBySlot = new Map<number, string>();
    let hostSlot = -1;
    let existingSave = false;
    let authorityOutcome: "success" | "transient" | "transient-diverged" | "conflict" =
      outcome === "conflict-rollback-failure" ? "conflict" : outcome;
    let guestPersisting = false;
    let lastGuestReplicaRaw: string | null = null;
    const events: string[] = [];
    const authorityRequests: Parameters<typeof pokerogueApi.savedata.session.updateCoopCas>[0][] = [];

    try {
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockImplementation(async request =>
        cloudBySlot.has(request.slot) ? coopCasFound(cloudBySlot.get(request.slot)!) : coopCasMissing(),
      );
      vi.mocked(pokerogueApi.savedata.session.getCoopRunStatus).mockImplementation(async request => {
        for (const [slot, raw] of cloudBySlot) {
          const parsed = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(raw));
          const cloudCommitment = await deriveCoopResumeCommitment(raw, parsed);
          if (cloudCommitment?.runId === request.coopRunId) {
            return {
              ok: true,
              status: 200,
              value: {
                state: "active",
                runId: cloudCommitment.runId,
                slot,
                checkpointRevision: cloudCommitment.checkpointRevision,
                digest: cloudCommitment.digest,
              },
            };
          }
        }
        return { ok: true, status: 200, value: { state: "missing", runId: request.coopRunId } };
      });
      vi.spyOn(pokerogueApi.savedata.session, "updateCoopCas").mockImplementation(async (request, raw) => {
        if (!existingSave || guestPersisting) {
          if (!guestPersisting) {
            expect(request.coopCasMode).toBe("empty");
          }
          cloudBySlot.set(request.slot, raw);
          return { ok: true, status: 200, error: "", failureKind: null };
        }
        events.push("authority");
        authorityRequests.push(request);
        if (authorityOutcome === "conflict") {
          return { ok: false, status: 409, error: "conflict", failureKind: "conflict" };
        }
        if (authorityOutcome === "transient-diverged") {
          const diverged = JSON.parse(raw) as Record<string, unknown>;
          const coopRun = diverged.coopRun as { version: 1; runId: string; checkpointRevision: number };
          cloudBySlot.set(
            request.slot,
            JSON.stringify({
              ...diverged,
              money: Number(diverged.money ?? 0) + 777,
              coopRun: { ...coopRun, checkpointRevision: coopRun.checkpointRevision + 1 },
            }),
          );
          return { ok: false, status: null, error: "lost divergent response", failureKind: "transient" };
        }
        if (authorityOutcome === "transient") {
          return { ok: false, status: null, error: "offline", failureKind: "transient" };
        }
        cloudBySlot.set(request.slot, raw);
        return { ok: true, status: 200, error: "", failureKind: null };
      });
      vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue("");
      await withClient(rig.guestCtx, () => rig.guestScene.gameData.armCoopResumeCheckpointPersistence());
      rig.guestRuntime.controller.armResumeCheckpointHandler(async (raw, commitment, mirrorCloud) => {
        if (existingSave) {
          events.push(`guest:${mirrorCloud}`);
        }
        guestPersisting = true;
        try {
          const persisted = await withClient(rig.guestCtx, () =>
            rig.guestScene.gameData.persistCurrentCoopResumeCheckpoint(raw, commitment, mirrorCloud),
          );
          if (persisted.success) {
            lastGuestReplicaRaw = raw;
          }
          return persisted;
        } finally {
          guestPersisting = false;
        }
      });
      const slot = await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot());
      hostSlot = slot!;
      rig.hostScene.sessionSlotId = slot!;
      await expect(
        withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, false, false, true)),
      ).resolves.toBe(true);
      await withClient(rig.hostCtx, () => rig.hostScene.gameData.consumeCommittedFreshCoopLaunchSession(1));

      existingSave = true;
      const sendResumeCheckpoint = vi.spyOn(rig.hostRuntime.controller, "sendResumeCheckpointDetailed");
      // buildDuo already wraps this method to count transport rendezvous. Re-spying returns that same mock,
      // including the fresh-save checkpoint call above; this assertion window begins only now.
      sendResumeCheckpoint.mockClear();
      const localBefore = localStorage.getItem(keys[hostSlot]);
      const cloudBefore = cloudBySlot.get(hostSlot);
      const evidenceKeys = ["er-coop-resume", "er-coop-resume-unavailable"];
      const evidenceBefore = evidenceKeys.map(key => localStorage.getItem(key));
      const cloudBeforeSession = await withClient(rig.hostCtx, () =>
        rig.hostScene.gameData.parseSessionData(cloudBefore!),
      );
      const cloudBeforeCommitment = await deriveCoopResumeCommitment(cloudBefore!, cloudBeforeSession);
      expect(cloudBeforeCommitment).not.toBeNull();
      lastGuestReplicaRaw = null;
      rig.hostScene.money += 1;
      if (outcome === "conflict-rollback-failure") {
        const originalSetItem = localStorage.setItem;
        let rollbackWriteArmed = true;
        vi.spyOn(localStorage, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
          if (rollbackWriteArmed && key === keys[hostSlot] && value === localBefore) {
            rollbackWriteArmed = false;
            throw new DOMException("quota", "QuotaExceededError");
          }
          return originalSetItem.call(this, key, value);
        });
      }
      await expect(
        withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, false, false, true)),
        "rollback storage failure is terminal and never rejects the save promise",
      ).resolves.toBe(expectedSave);
      expect(events, "deterministic conflicts never reach the guest; transient debt mirrors locally").toEqual(
        expectedEvents,
      );
      if (outcome === "conflict" || outcome === "conflict-rollback-failure" || outcome === "transient-diverged") {
        expect(
          sendResumeCheckpoint,
          "a deterministic authority conflict sends no resume checkpoint",
        ).not.toHaveBeenCalled();
        if (outcome === "conflict") {
          expect(localStorage.getItem(keys[hostSlot]), "the host local row rolls back byte-exactly").toBe(localBefore);
          evidenceKeys.forEach((key, index) =>
            expect(localStorage.getItem(key), `${key} rolls back byte-exactly`).toBe(evidenceBefore[index]),
          );
        } else {
          expect(
            localStorage.getItem(keys[hostSlot]),
            "an unsafe/failed rollback retains the exact new local debt instead of deleting it",
          ).not.toBe(localBefore);
          expect(
            localStorage.getItem("er-coop-resume-unavailable"),
            "failed rollback records explicit debt",
          ).not.toBeNull();
        }
        expect(lastGuestReplicaRaw, "the guest never receives the rejected checkpoint").toBeNull();
        if (outcome === "transient-diverged") {
          expect(
            cloudBySlot.get(hostSlot),
            "a proven competing cloud checkpoint is preserved and never relabeled transient debt",
          ).not.toBe(cloudBefore);
        } else {
          expect(cloudBySlot.get(hostSlot), "the frozen authority head remains unchanged").toBe(cloudBefore);
        }
      } else {
        const localAfter = decrypt(localStorage.getItem(keys[hostSlot])!, false);
        expect(lastGuestReplicaRaw, "the guest persists the authority's exact selected bytes").toBe(localAfter);
        expect(sendResumeCheckpoint).toHaveBeenCalledOnce();
        expect(sendResumeCheckpoint.mock.calls[0][3]).toBe(outcome === "success");
      }
      if (outcome === "transient") {
        expect(rig.hostScene.gameData.lastCloudSyncFailed).toBe(true);
        expect(cloudBySlot.get(hostSlot), "transient debt does not invent a new cloud parent").toBe(cloudBefore);

        authorityOutcome = "success";
        events.length = 0;
        sendResumeCheckpoint.mockClear();
        lastGuestReplicaRaw = null;
        await expect(
          withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, false, false, true)),
          "a later retry advances from the previously frozen cloud head",
        ).resolves.toBe(true);
        const retryRequest = authorityRequests.at(-1)!;
        expect(retryRequest).toMatchObject({
          coopCasMode: "existing",
          coopCasRunId: cloudBeforeCommitment!.runId,
          coopCasCheckpointRevision: cloudBeforeCommitment!.checkpointRevision,
          coopCasDigest: cloudBeforeCommitment!.digest,
        });
        const retriedLocal = decrypt(localStorage.getItem(keys[hostSlot])!, false);
        expect(cloudBySlot.get(hostSlot), "the retry publishes the exact new authority bytes").toBe(retriedLocal);
        expect(lastGuestReplicaRaw, "the retry leaves the guest's local replica exact too").toBe(retriedLocal);
        expect(events).toEqual(["authority", "guest:true"]);
      }
    } finally {
      keys.forEach((key, slot) => {
        const value = prior[slot];
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("commits a complete fresh session with empty-slot CAS and releases those exact bytes", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));
    let committedRaw: string | null = null;

    try {
      clearCoopResumeMarker();
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      const cloudRead = vi
        .spyOn(pokerogueApi.savedata.session, "getCoopCas")
        .mockImplementation(async () => (committedRaw == null ? coopCasMissing() : coopCasFound(committedRaw)));
      const firstSave = vi
        .spyOn(pokerogueApi.savedata.session, "updateCoopCas")
        .mockImplementation(async (request, raw) => {
          expect(request.coopCasMode, "first complete backend write is empty-slot CAS").toBe("empty");
          committedRaw = raw;
          // Simulate commit + lost response. Exact read-back must make this idempotently successful.
          return { ok: false, status: null, error: "Unknown Error!", failureKind: "transient" };
        });
      const updateAll = vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue("");
      let guestCheckpointCalls = 0;
      rig.guestRuntime.controller.armResumeCheckpointHandler(async (session, _commitment, mirrorCloud) => {
        guestCheckpointCalls++;
        expect(session, "guest durability receives the exact CAS bytes").toBe(committedRaw);
        expect(mirrorCloud, "fresh launch requires guest cloud durability before release").toBe(true);
        return { success: true };
      });

      const slot = await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot());
      expect(slot).toBe(0);
      expect(
        await withClient(rig.hostCtx, () => rig.hostScene.gameData.confirmPendingFreshCoopSessionSlot(slot!)),
        "the tentative slot is still locally empty immediately before materialization",
      ).toBe(true);
      rig.hostScene.sessionSlotId = slot!;
      await expect(
        withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, false, false, true)),
      ).resolves.toBe(true);

      expect(firstSave).toHaveBeenCalledOnce();
      expect(cloudRead, "five-slot scan plus lost-response readback use typed reads").toHaveBeenCalledTimes(6);
      expect(guestCheckpointCalls).toBe(1);
      expect(updateAll).toHaveBeenCalledOnce();
      expect(updateAll.mock.calls[0][0].session, "updateAll cannot undo the first-save CAS").toBeNull();
      const released = await withClient(rig.hostCtx, () =>
        rig.hostScene.gameData.consumeCommittedFreshCoopLaunchSession(1),
      );
      expect(released.kind).toBe("committed");
      const releasedSession = released.kind === "committed" ? released.sessionJson : "";
      expect(releasedSession, "launch release is byte-identical to the valid backend row").toBe(committedRaw);
      expect(
        JSON.parse(releasedSession).gameMode,
        "normal session GET sees a complete resumable session, not a placeholder",
      ).toBe(GameModes.COOP);
    } finally {
      keys.forEach((key, slot) => {
        const value = prior[slot];
        if (value == null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, value);
        }
      });
    }
    logs.flush();
  }, 300_000);

  it("does not overwrite a row that wins after empty scan and symmetrically aborts launch", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));
    const concurrentRow = JSON.stringify({ gameMode: GameModes.CLASSIC, waveIndex: 88, owner: "other-tab" });
    let scanComplete = false;

    try {
      clearCoopResumeMarker();
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockImplementation(async () => {
        if (!scanComplete) {
          scanComplete = true;
          return coopCasMissing();
        }
        return coopCasFound(concurrentRow);
      });
      let attemptedRaw = "";
      const firstSave = vi
        .spyOn(pokerogueApi.savedata.session, "updateCoopCas")
        .mockImplementation(async (_request, raw) => {
          attemptedRaw = raw;
          return {
            ok: false,
            status: 409,
            error: "Session CAS conflict: expected empty slot.",
            failureKind: "conflict",
          };
        });
      const updateAll = vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue("");
      let guestCheckpointCalls = 0;
      rig.guestRuntime.controller.armResumeCheckpointHandler(async () => {
        guestCheckpointCalls++;
        return { success: true };
      });

      const slot = await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot());
      expect(slot).toBe(0);
      rig.hostScene.sessionSlotId = slot!;
      const guestAbort = awaitRetainedLaunchAbort(rig.guestRuntime.battleStream);
      await expect(
        withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, false, false, true)),
        "different bytes appearing after the scan make first save fail closed",
      ).resolves.toBe(false);
      await expect(guestAbort, "guest receives the same retained launch-abort outcome").resolves.toBeNull();

      expect(firstSave).toHaveBeenCalledOnce();
      expect(attemptedRaw).not.toBe(concurrentRow);
      expect(updateAll, "unconditional updateAll never gets a chance to overwrite the winner").not.toHaveBeenCalled();
      expect(guestCheckpointCalls, "guest persistence is not started for a host slot that lost CAS").toBe(0);
      expect(localStorage.getItem(keys[slot!]), "only our exact tentative local write is rolled back").toBeNull();
      expect(
        readCoopResumeMarker(rig.hostRuntime.controller.localName(), rig.hostRuntime.controller.partnerName),
      ).toBeNull();
    } finally {
      keys.forEach((key, slot) => {
        const value = prior[slot];
        if (value == null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, value);
        }
      });
    }
    logs.flush();
  }, 300_000);

  it("reports quota failure through the actual importData file/UI path without reloading or throwing", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const slot = 4;
    const storageKey = getSessionDataLocalStorageKey(slot);
    const prior = localStorage.getItem(storageKey);
    const sessionJson = JSON.stringify(game.scene.gameData.getSessionSaveData(), (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    const fileBytes = AES.encrypt(sessionJson, saveKey).toString();
    let fileInput: HTMLInputElement | null = null;
    let confirmation: Promise<unknown> | null = null;
    const messages: string[] = [];
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      fileInput = this;
    });
    vi.spyOn(game.scene.ui, "showText").mockImplementation((text, _delay, callback) => {
      messages.push(text);
      callback?.();
    });
    vi.spyOn(game.scene.ui, "setOverlayMode").mockImplementation(async (_mode, ...args: unknown[]) => {
      const confirm = args[0] as (() => unknown) | undefined;
      confirmation = Promise.resolve(confirm?.());
      await confirmation;
    });
    setBypassLoginForTesting(true);
    const originalSetItem = localStorage.setItem;
    const quota = vi.spyOn(localStorage, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === storageKey) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });

    try {
      localStorage.removeItem(storageKey);
      expect(
        () => game.scene.gameData.importData(GameDataType.SESSION, slot),
        "the public importer opens normally",
      ).not.toThrow();
      expect(fileInput, "the real file input was created and clicked").not.toBeNull();
      Object.defineProperty(fileInput!, "files", {
        configurable: true,
        value: [new File([fileBytes], "quota-session.prsv", { type: "text/json" })],
      });
      fileInput!.dispatchEvent(new Event("change"));
      await flush();
      await flush();
      expect(confirmation, "the production confirmation callback was reached").not.toBeNull();
      await expect(confirmation!).resolves.toBeUndefined();
      expect(localStorage.getItem(storageKey), "quota failure never exposes partial imported bytes").toBeNull();
      expect(messages.length, "the importer surfaces its normal confirmation and error UI").toBeGreaterThanOrEqual(2);
    } finally {
      quota.mockRestore();
      click.mockRestore();
      prior == null ? localStorage.removeItem(storageKey) : localStorage.setItem(storageKey, prior);
    }
    logs.flush();
  }, 300_000);

  it("bounds Web Lock acquisition and never runs a protected write after contention expiry", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const sessionJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const session = await withClient(rig.guestCtx, () => rig.guestScene.gameData.parseSessionData(sessionJson));
    const commitment = await deriveCoopResumeCommitment(sessionJson, session);
    expect(commitment).not.toBeNull();
    installImmediateCoopPersistenceTimeouts();
    let lateLockCallback: (() => Promise<unknown>) | null = null;
    Object.defineProperty(globalThis.navigator, "locks", {
      configurable: true,
      value: {
        request: <T>(
          _name: string,
          _options: { mode: "exclusive"; signal?: AbortSignal },
          callback: () => Promise<T>,
        ) => {
          lateLockCallback = callback;
          return new Promise<T>(() => {});
        },
      },
    });
    const cloudRead = vi.mocked(pokerogueApi.savedata.session.getCoopCas);
    cloudRead.mockClear();
    await withClient(rig.guestCtx, () => rig.guestScene.gameData.armCoopResumeCheckpointPersistence());

    await expect(
      withClient(rig.guestCtx, () =>
        rig.guestScene.gameData.persistCurrentCoopResumeCheckpoint(sessionJson, commitment!, false),
      ),
      "lock contention has a deterministic bounded terminal result",
    ).resolves.toEqual({ success: false, reason: "slot-conflict" });
    expect(lateLockCallback).not.toBeNull();
    await expect(lateLockCallback!(), "an ignored AbortSignal cannot revive the expired operation").resolves.toBeNull();
    expect(cloudRead, "the late callback performs no protected cloud/local work").not.toHaveBeenCalled();
    logs.flush();
  }, 300_000);

  it("bounds hung cloud reads during the production fresh-slot scan", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    installImmediateCoopPersistenceTimeouts();
    setBypassLoginForTesting(false);
    const hungRead = vi
      .spyOn(pokerogueApi.savedata.session, "getCoopCas")
      .mockImplementation(() => new Promise<never>(() => {}));

    await expect(
      withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot()),
      "a never-settling fetch cannot hold the lobby forever",
    ).resolves.toBeNull();
    expect(hungRead, "the exhaustive five-slot scan remains intact").toHaveBeenCalledTimes(5);
    logs.flush();
  }, 300_000);

  it("bounds a hung first-checkpoint CAS and releases both peers through the shared abort path", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));

    try {
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      const slot = await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot());
      expect(slot).not.toBeNull();
      rig.hostScene.sessionSlotId = slot!;
      installImmediateCoopPersistenceTimeouts();
      const hungWrite = vi
        .spyOn(pokerogueApi.savedata.session, "updateCoopCas")
        .mockImplementation(() => new Promise<never>(() => {}));
      const guestAbort = awaitRetainedLaunchAbort(rig.guestRuntime.battleStream);

      await expect(
        withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, false, false, true)),
        "a never-settling write resolves through bounded readback and terminal coordination",
      ).resolves.toBe(false);
      await expect(guestAbort, "the guest cannot remain on an unbounded first-save wait").resolves.toBeNull();
      expect(hungWrite).toHaveBeenCalledOnce();
      expect(localStorage.getItem(keys[slot!]), "an unproved first CAS never publishes local launch bytes").toBeNull();
    } finally {
      prior.forEach((value, slot) => {
        value == null ? localStorage.removeItem(keys[slot]) : localStorage.setItem(keys[slot], value);
      });
    }
    logs.flush();
  }, 300_000);

  it("fails closed and retains launch abort when Web Locks are unavailable", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));

    try {
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue(coopCasMissing());
      const firstSave = vi.spyOn(pokerogueApi.savedata.session, "updateCoopCas").mockResolvedValue({
        ok: true,
        status: 200,
        error: "",
        failureKind: null,
      });
      const slot = await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot());
      rig.hostScene.sessionSlotId = slot!;
      Reflect.deleteProperty(globalThis.navigator, "locks");
      const guestAbort = awaitRetainedLaunchAbort(rig.guestRuntime.battleStream);

      await expect(
        withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, false, false, true)),
      ).resolves.toBe(false);
      await expect(guestAbort, "guest observes the retained terminal outcome").resolves.toBeNull();
      expect(
        firstSave,
        "backend may hold a complete recoverable row before local lock rejection",
      ).toHaveBeenCalledOnce();
      expect(localStorage.getItem(keys[slot!]), "unsupported lock safety never writes local bytes").toBeNull();
    } finally {
      keys.forEach((key, slot) => {
        const value = prior[slot];
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("turns an unexpected first-save throw into a retained launch abort", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));

    try {
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue(coopCasMissing());
      const slot = await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot());
      rig.hostScene.sessionSlotId = slot!;
      vi.spyOn(rig.hostScene.gameData, "getSessionSaveData").mockImplementationOnce(() => {
        throw new Error("injected serializer failure");
      });
      const firstAbort = awaitRetainedLaunchAbort(rig.guestRuntime.battleStream);

      await expect(
        withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, false, false, true)),
      ).rejects.toThrow("injected serializer failure");
      await expect(firstAbort).resolves.toBeNull();
      await expect(
        awaitRetainedLaunchAbort(rig.guestRuntime.battleStream),
        "a late/reconnected guest receives the retained abort replay",
      ).resolves.toBeNull();
    } finally {
      keys.forEach((key, slot) => {
        const value = prior[slot];
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("does not recapture live state when exact local bytes change after ACK but before consumption", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));

    try {
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue(coopCasMissing());
      vi.spyOn(pokerogueApi.savedata.session, "updateCoopCas").mockResolvedValue({
        ok: true,
        status: 200,
        error: "",
        failureKind: null,
      });
      vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue("");
      rig.guestRuntime.controller.armResumeCheckpointHandler(async () => ({ success: true }));
      const slot = await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot());
      rig.hostScene.sessionSlotId = slot!;
      await expect(
        withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, false, false, true)),
      ).resolves.toBe(true);
      localStorage.setItem(keys[slot!], "concurrent-post-ack-writer");
      const guestAbort = awaitRetainedLaunchAbort(rig.guestRuntime.battleStream);

      await expect(
        withClient(rig.hostCtx, () => rig.hostScene.gameData.consumeCommittedFreshCoopLaunchSession(1)),
      ).resolves.toEqual({ kind: "invalid" });
      await expect(
        guestAbort,
        "invalid consumption emits a retained abort instead of live recapture",
      ).resolves.toBeNull();
    } finally {
      keys.forEach((key, slot) => {
        const value = prior[slot];
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it("rejects a local slot write that lands after scan but before starter materialization", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));

    try {
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue(coopCasMissing());
      const slot = await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot());
      expect(slot).toBe(0);
      localStorage.setItem(keys[slot!], "concurrent-local-save");
      expect(
        await withClient(rig.hostCtx, () => rig.hostScene.gameData.confirmPendingFreshCoopSessionSlot(slot!)),
      ).toBe(false);
      expect(localStorage.getItem(keys[slot!]), "the concurrent local row is untouched").toBe("concurrent-local-save");
      await withClient(rig.hostCtx, () => rig.hostScene.gameData.cancelPendingFreshCoopSessionSlot());
    } finally {
      keys.forEach((key, slot) => {
        const value = prior[slot];
        if (value == null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, value);
        }
      });
    }
    logs.flush();
  }, 300_000);

  it("never overwrites a local row landing after materialization confirmation but before first save", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));

    try {
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue(coopCasMissing());
      const firstSave = vi.spyOn(pokerogueApi.savedata.session, "updateCoopCas").mockResolvedValue({
        ok: true,
        status: 200,
        error: "",
        failureKind: null,
      });
      const updateAll = vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue("");
      const slot = await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot());
      expect(slot).toBe(0);
      expect(
        await withClient(rig.hostCtx, () => rig.hostScene.gameData.confirmPendingFreshCoopSessionSlot(slot!)),
      ).toBe(true);
      rig.hostScene.sessionSlotId = slot!;
      const originalSnapshot = rig.hostScene.gameData.getSessionSaveData.bind(rig.hostScene.gameData);
      vi.spyOn(rig.hostScene.gameData, "getSessionSaveData").mockImplementationOnce(() => {
        const session = originalSnapshot();
        localStorage.setItem(keys[slot!], "late-concurrent-local-save");
        return session;
      });
      const guestAbort = awaitRetainedLaunchAbort(rig.guestRuntime.battleStream);
      await expect(
        withPeerPumpingClient(rig.hostCtx, () => rig.hostScene.gameData.saveAll(true, true, false, false, true)),
      ).resolves.toBe(false);
      await expect(guestAbort).resolves.toBeNull();
      expect(firstSave, "valid complete cloud CAS may win before final local check").toHaveBeenCalledOnce();
      expect(localStorage.getItem(keys[slot!]), "late local winner is never overwritten").toBe(
        "late-concurrent-local-save",
      );
      expect(updateAll).not.toHaveBeenCalled();
    } finally {
      keys.forEach((key, slot) => {
        const value = prior[slot];
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);

  it.each([
    "runtime-identity",
    "local-bytes",
    "account",
  ] as const)("cannot cache a same-wave launch release from a stale guest persistence ACK after %s changes", async invalidation => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const keys = await withClient(rig.hostCtx, () => [0, 1, 2, 3, 4].map(getSessionDataLocalStorageKey));
    const prior = keys.map(key => localStorage.getItem(key));
    let releaseGuest!: () => void;
    let markGuestStarted!: () => void;
    let guestPersistenceStarted = false;
    const guestStarted = new Promise<void>(resolve => {
      markGuestStarted = resolve;
    });
    const guestGate = new Promise<void>(resolve => {
      releaseGuest = resolve;
    });
    const hostReset = vi.spyOn(rig.hostScene, "reset");
    const replacementRuntime =
      invalidation === "runtime-identity"
        ? buildRuntime(createLoopbackPair().host, "Replacement", "authoritative")
        : null;

    const priorUsername = loggedInUser?.username;
    try {
      keys.forEach(key => localStorage.removeItem(key));
      setBypassLoginForTesting(false);
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue(coopCasMissing());
      vi.spyOn(pokerogueApi.savedata.session, "updateCoopCas").mockResolvedValue({
        ok: true,
        status: 200,
        error: "",
        failureKind: null,
      });
      vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue("");
      rig.guestRuntime.controller.armResumeCheckpointHandler(async () => {
        guestPersistenceStarted = true;
        markGuestStarted();
        await guestGate;
        return { success: true };
      });
      // Apply the invalidation in the authority browser after the guest's ACK resolves but before saveAll
      // consumes that ACK. Mutating process globals while the helper has the guest browser installed is not
      // representative: its context restoration correctly restores the host account/runtime and erases the
      // supposed race before the authority continuation observes it.
      const countedSend = vi.mocked(rig.hostRuntime.controller.sendResumeCheckpointDetailed);
      const sendImplementation = countedSend.getMockImplementation();
      if (sendImplementation == null) {
        throw new Error("resume fixture lost its counted checkpoint sender");
      }
      countedSend.mockImplementation(async (...args) => {
        const delivery = await sendImplementation(...args);
        if (invalidation === "runtime-identity") {
          setCoopRuntime(replacementRuntime!);
        } else if (invalidation === "local-bytes") {
          localStorage.setItem(keys[slot!], "newer-local-writer");
        } else if (loggedInUser != null) {
          loggedInUser.username = `${loggedInUser.username}-changed`;
        }
        return delivery;
      });
      const slot = await withClient(rig.hostCtx, () => rig.hostScene.gameData.findVerifiedEmptyCoopSessionSlot());
      rig.hostScene.sessionSlotId = slot!;
      const saving = withPeerPumpingClient(rig.hostCtx, () =>
        rig.hostScene.gameData.saveAll(true, true, false, false, true),
      );
      await vi.waitFor(() => expect(guestPersistenceStarted, "host reached guest checkpoint persistence").toBe(true), {
        timeout: 2_000,
        interval: 10,
      });
      await guestStarted;
      releaseGuest();
      await expect(saving, "stale ACK cannot authorize launch release").resolves.toBe(false);
      await expect(
        withClient(rig.hostCtx, () => rig.hostScene.gameData.consumeCommittedFreshCoopLaunchSession(1)),
      ).resolves.toEqual({ kind: "not-fresh" });
      if (invalidation === "runtime-identity") {
        expect(
          hostReset,
          "the stale checkpoint completion cannot reset the scene now owned by a replacement runtime",
        ).not.toHaveBeenCalled();
        expect(replacementRuntime!.localTransport.state, "the replacement transport remains usable").toBe("connected");
      }
    } finally {
      releaseGuest?.();
      if (loggedInUser != null && priorUsername != null) {
        loggedInUser.username = priorUsername;
      }
      keys.forEach((key, slot) => {
        const value = prior[slot];
        value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      });
    }
    logs.flush();
  }, 300_000);
});
