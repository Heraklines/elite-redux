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

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import {
  clearCoopResumeMarker,
  readCoopResumeMarker,
  recordCoopResumeMarker,
} from "#data/elite-redux/coop/coop-resume-marker";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, installDuoLogCapture, withClient } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Serialize the host's coherent session EXACTLY as a real RESUME load broadcasts it. */
function serializeHostLaunchSnapshot(hostScene: BattleScene): string {
  return JSON.stringify(hostScene.gameData.getSessionSaveData(), (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** Flush the loopback's microtask delivery (a sent message reaches the peer's handler). */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe.skipIf(!RUN)("co-op DUO lobby RESUME flow (#810)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`resume-${Date.now()}`);
    clearCoopResumeMarker();
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
    clearCoopResumeMarker();
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
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

    // IDENTITY GATE (test 3): a marker recorded for THIS pair is found for the exact pair, but
    // NOT for a different partner - so a saved run is never offered/loaded with the wrong player.
    recordCoopResumeMarker(2, host.localName(), host.partnerName!, 7);
    expect(readCoopResumeMarker(host.localName(), host.partnerName)?.slot, "exact pair matches").toBe(2);
    expect(readCoopResumeMarker(host.localName(), "SomebodyElse"), "different partner -> no offer").toBeNull();

    // HOST: serialize the saved session it would load on RESUME + capture its wave-start checksum.
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
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
    guest.armResumeOfferHandler(wave => {
      offeredWave = wave;
    });
    const offer = host.offerResume(7);
    await flush();
    expect(offeredWave, "the guest's resume offer surfaced on ACCEPT").toBe(7);
    guest.replyResume(true);
    await flush();
    await expect(offer, "host sees the guest ACCEPT").resolves.toBe(true);
    expect(host.sessionEpoch, "cold resume minted a fresh host epoch").toBeGreaterThan(preResumeEpoch);
    expect(guest.sessionEpoch, "guest adopted the cold-resume epoch before snapshot boot").toBe(host.sessionEpoch);

    // RESUME BOOT: the guest boots from the host's saved snapshot (the coopGuestResumeBoot core)...
    const booted = await withClient(rig.guestCtx, () => rig.guestScene.gameData.applyCoopLaunchSession(hostJson));
    expect(booted, "the guest booted from the resumed session snapshot").toBe(true);

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
    host.sendResumeStartNew();
    await flush();
    expect(released, "the guest wait barrier was released by resumeStartNew").toBe(1);
    expect(offered, "no resume offer was surfaced on the New Game path").toBe(0);

    // The guest applied NO snapshot - its (perturbed) state is unchanged (a new run starts fresh).
    const guestAfter = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestAfter, "guest state untouched on the New Game path (no boot)").toBe(guestBefore);

    logs.flush();
  }, 300_000);
});
