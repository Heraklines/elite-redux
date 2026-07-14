/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op M4 PUSH-SNAPSHOT LAUNCH (#633 M4; see
// docs/plans/2026-07-02-coop-authoritative-replication-redesign.md section 3.6).
//
// M4 makes launch DESYNC-PROOF BY CONSTRUCTION: the host serializes its coherent session
// (`getSessionSaveData()`) and PUSHES it; the guest BOOTS from that snapshot via the
// production-hardened resume machinery (`applyCoopLaunchSession`) and rolls NO enemy / arena /
// party of its own - so it can never diverge at launch. The old model had the guest re-derive
// its enemy/arena from a pinned seed (a latent desync surface); this replaces that with adopting
// the host's authoritative bytes.
//
// This is the REAL two-engine proof of the design's M4 assertion ("state converges at wave start"):
// a SECOND real engine (the guest BattleScene) that is DELIBERATELY PERTURBED off the host's state
// boots from the host's launch snapshot and its full-state checksum SNAPS BACK to equal the host's -
// proving the boot reconstructs the session, not a vacuous match. The wire half (the launchSnapshot
// round-trip + that the `requestEnemyParty` POLL is deleted) is pinned engine-free in
// coop-battle-stream.test.ts ("launch snapshot + poll deletion (#633 M4)").
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-launch-snapshot.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import { deriveCoopResumeCommitment } from "#data/elite-redux/coop/coop-resume-marker";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { PlayerPokemon } from "#field/pokemon";
import {
  EncounterPhase,
  materializeCoopAdoptedEnemyField,
  materializeCoopLoadedPlayerField,
} from "#phases/encounter-phase";
import { ShowTrainerPhase } from "#phases/show-trainer-phase";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, installDuoLogCapture, withClient } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Serialize the host's coherent session EXACTLY as `EncounterPhase.broadcastCoopLaunchSnapshot` does. */
function serializeHostLaunchSnapshot(hostScene: BattleScene): string {
  return JSON.stringify(hostScene.gameData.getSessionSaveData(), (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

class LaunchPresentationProbePhase extends EncounterPhase {
  public continuationOpened = false;

  protected override completeEncounterEnd(): void {
    this.continuationOpened = true;
  }
}

describe.skipIf(!RUN)("co-op DUO M4 push-snapshot launch: guest boots from the host snapshot (#633 M4)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`launch-snapshot-${Date.now()}`);
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
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
  });

  it("a perturbed guest boots from the host launch snapshot and CONVERGES to the host wave-start state", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    // HOST: serialize its coherent launch session (what broadcastCoopLaunchSnapshot pushes) + its checksum.
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const hostChecksum = await withClient(rig.hostCtx, () => captureCoopChecksum());

    // PERTURB the guest so its state DIVERGES from the host - this makes the convergence assertion
    // MEANINGFUL (not a vacuous pass off buildDuo's initial mirror already matching).
    await withClient(rig.guestCtx, () => {
      rig.guestScene.money += 999_999;
    });
    const guestBefore = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestBefore, "the perturbed guest DIVERGES from the host before the boot").not.toBe(hostChecksum);

    // GUEST: BOOT from the host's launch snapshot (rolls nothing of its own).
    const booted = await withClient(rig.guestCtx, () => rig.guestScene.gameData.applyCoopLaunchSession(hostJson));
    expect(booted, "the guest booted from the host launch snapshot").toBe(true);

    // ... and it must now be BYTE-EQUAL to the host at wave start (the M4 convergence guarantee).
    const guestAfter = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(
      guestAfter,
      "guest full-state checksum EQUALS the host's after booting from the snapshot (converged, generated nothing)",
    ).toBe(hostChecksum);

    // LIVE regression (2026-07-12): the launch snapshot is captured before the host's summon chain.
    // Restore therefore loads the party assets but leaves both co-op leads invisible and off-field. The
    // guest cannot run Summon/PostSummon (those derive shared effects), so its loaded EncounterPhase uses
    // the presentation-only materializer. Exercise that exact seam and require BOTH seats + UI bars.
    await withClient(rig.guestCtx, () => {
      const capacity = rig.guestScene.currentBattle.arrangement.playerCapacity;
      const seats = rig.guestScene.getPlayerParty().slice(0, capacity);
      // A killed Return/ShowTrainer transition can leave this persistent sprite visible or alpha-zero.
      // The presentation seam must hide it now while leaving alpha ready for the next ShowTrainerPhase.
      rig.guestScene.trainer.setVisible(true).setAlpha(0.25);
      const spriteVisible = seats.map(mon => vi.spyOn(mon.getSprite(), "setVisible"));
      const infoVisible = seats.map(mon => vi.spyOn(mon, "showInfo"));
      expect(materializeCoopLoadedPlayerField(), "both launch leads are materialized").toBe(capacity);
      expect(rig.guestScene.trainer.visible, "the stale player-trainer overlay is cleared").toBe(false);
      expect(rig.guestScene.trainer.alpha, "the next ShowTrainerPhase will not inherit alpha zero").toBe(1);
      // Production post-battle regression: ReturnPhase is renderer-blocked, but ShowTrainerPhase is a
      // presentation phase and used to reveal the trainer over those still-fielded Pokemon. Drive the real
      // phase branch and require it to remain an immediate hidden no-op on the authoritative guest.
      rig.guestScene.trainer.setVisible(true).setAlpha(0.25);
      const showTrainer = new ShowTrainerPhase();
      const showTrainerEnd = vi.spyOn(showTrainer, "end").mockImplementation(() => {});
      showTrainer.start();
      expect(showTrainerEnd, "renderer ShowTrainerPhase terminates immediately").toHaveBeenCalledOnce();
      expect(rig.guestScene.trainer.visible, "renderer ShowTrainerPhase cannot restore the stale overlay").toBe(false);
      expect(rig.guestScene.trainer.alpha, "renderer trainer remains ready for a later legitimate entrance").toBe(1);
      const field = rig.guestScene.getPlayerField(true);
      expect(field, "guest renders every active co-op player seat").toHaveLength(capacity);
      for (const [index, mon] of field.entries()) {
        expect(mon.isOnField(), `${mon.name} is seated`).toBe(true);
        expect(mon.visible, `${mon.name} container is visible`).toBe(true);
        expect(spriteVisible[index], `${mon.name} sprite was explicitly shown`).toHaveBeenCalledWith(true);
        expect(infoVisible[index], `${mon.name} battle UI was explicitly shown`).toHaveBeenCalledOnce();
      }
    });
    const guestAfterPlayerMaterialization = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(
      guestAfterPlayerMaterialization,
      "presentation-only launch materialization leaves the authoritative checksum unchanged",
    ).toBe(hostChecksum);

    // TRAINER-wave renderer regression: the real SummonPhase is correctly default-denied on the guest,
    // but its already-adopted enemies still need transitional field containment (seat/sprite/bar). Simulate
    // the pre-summon trainer state and prove the narrow materializer makes every enemy seat visible without
    // constructing a resolution phase. This is not proof of a presentation-only architecture: the helper
    // changes field membership until launch snapshots carry an explicit authoritative seat manifest.
    await withClient(rig.guestCtx, () => {
      const capacity = rig.guestScene.currentBattle.arrangement.enemyCapacity;
      const enemies = rig.guestScene.getEnemyParty().slice(0, capacity);
      // TrainerEncounter shows both party-ball trays before the normal SummonPhase hides them. The guest
      // replaces that mechanics-owning phase with this exact materialization boundary, so require the trays
      // to be gone synchronously here, before any next intro/Command postcondition could conceal the bug.
      rig.guestScene.pbTray.setVisible(true);
      rig.guestScene.pbTray.shown = true;
      rig.guestScene.pbTrayEnemy.setVisible(true);
      rig.guestScene.pbTrayEnemy.shown = true;
      for (const enemy of enemies) {
        rig.guestScene.field.remove(enemy, false);
        enemy.setVisible(false);
        enemy.getSprite().setVisible(false);
      }
      const spriteVisible = enemies.map(enemy => vi.spyOn(enemy.getSprite(), "setVisible"));
      const infoVisible = enemies.map(enemy => vi.spyOn(enemy, "showInfo"));
      expect(materializeCoopAdoptedEnemyField(), "all adopted enemy seats are presentation-materialized").toBe(
        capacity,
      );
      expect(rig.guestScene.pbTray.shown, "player trainer-intro tray is no longer logically shown").toBe(false);
      expect(rig.guestScene.pbTray.visible, "player trainer-intro tray is hidden before command").toBe(false);
      expect(rig.guestScene.pbTrayEnemy.shown, "enemy trainer-intro tray is no longer logically shown").toBe(false);
      expect(rig.guestScene.pbTrayEnemy.visible, "enemy trainer-intro tray is hidden before command").toBe(false);
      const field = rig.guestScene.getEnemyField(true);
      expect(field, "guest renders every authoritative enemy seat").toHaveLength(capacity);
      for (const [index, enemy] of field.entries()) {
        expect(enemy.isOnField(), `${enemy.name} is seated`).toBe(true);
        expect(enemy.visible, `${enemy.name} container is visible`).toBe(true);
        expect(spriteVisible[index], `${enemy.name} sprite was explicitly shown`).toHaveBeenCalledWith(true);
        expect(infoVisible[index], `${enemy.name} battle UI was explicitly shown`).toHaveBeenCalledOnce();
      }
    });

    logs.flush();
  }, 300_000);

  it("keeps the launch continuation closed until both real player atlases finish loading", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    await expect(
      withClient(rig.guestCtx, () => rig.guestScene.gameData.applyCoopLaunchSession(hostJson)),
      "guest boots the exact host launch carrier",
    ).resolves.toBe(true);

    await withClient(rig.guestCtx, async () => {
      // This proof isolates the atlas/surface prerequisite. EncounterPhase still awaits the real tutorial
      // prerequisite in production; disable tutorials here so an unrelated UI callback cannot hide whether
      // the two deferred production loaders are the exact continuation gate under test.
      rig.guestScene.enableTutorials = false;
      const capacity = rig.guestScene.currentBattle.arrangement.playerCapacity;
      const seats = rig.guestScene.getPlayerParty().slice(0, capacity);
      expect(seats, "the production co-op launch has both active player seats").toHaveLength(2);
      for (const pokemon of seats) {
        rig.guestScene.field.remove(pokemon, false);
        pokemon.setVisible(false);
        pokemon.getSprite()?.setVisible(false);
        pokemon.getBattleInfo()?.setVisible(false);
      }

      const phase = new LaunchPresentationProbePhase(true);
      const currentPhase = vi.spyOn(rig.guestScene.phaseManager, "getCurrentPhase").mockReturnValue(phase);
      // buildDuo installs the shared HEADLESS atlas-completion model. This proof delays the two real loaders
      // but must not wrap TextureManager/AnimationManager a second time: stacking a spy around an existing
      // spy makes the captured "original" point back at itself and recurses instead of modeling Phaser.
      const releases: (() => Promise<void>)[] = [];
      const assetLoads = seats.map(pokemon => {
        const original = pokemon.loadAssets.bind(pokemon);
        const key = pokemon.getBattleSpriteKey();
        return vi.spyOn(pokemon, "loadAssets").mockImplementationOnce(
          () =>
            new Promise<void>((resolve, reject) => {
              releases.push(async () => {
                try {
                  await original(false);
                  const sprite = pokemon.getSprite() as unknown as {
                    texture: { key: string };
                    anims: { currentAnim?: { key: string } };
                  };
                  sprite.texture.key = key;
                  sprite.anims.currentAnim = { key };
                  resolve();
                } catch (error) {
                  reject(error);
                  throw error;
                }
              });
            }),
        );
      });

      phase.end();
      await Promise.resolve();
      expect(phase.continuationOpened, "placeholder nodes cannot open an actionable command surface").toBe(false);
      expect(releases, "both active player atlases are part of the same launch gate").toHaveLength(2);

      await releases[0]();
      expect(phase.continuationOpened, "one loaded seat cannot release a two-seat command surface").toBe(false);

      await releases[1]();
      await vi.waitFor(() => {
        expect(phase.continuationOpened, "the encounter shifts only after both real atlases are ready").toBe(true);
      });
      for (const [index, pokemon] of seats.entries()) {
        expect(assetLoads[index], `${pokemon.name} used the production atlas loader`).toHaveBeenCalledWith(false);
        expect(pokemon.isOnField(), `${pokemon.name} is seated before continuation`).toBe(true);
        expect(pokemon.getSprite()?.visible, `${pokemon.name} sprite is visible before continuation`).toBe(true);
        expect(pokemon.getBattleInfo()?.visible, `${pokemon.name} info bar is visible before continuation`).toBe(true);
        const key = pokemon.getBattleSpriteKey();
        expect(rig.guestScene.textures.exists(key), `${pokemon.name} real texture cache is resident`).toBe(true);
        expect(rig.guestScene.anims.exists(key), `${pokemon.name} real animation cache is resident`).toBe(true);
      }
      currentPhase.mockRestore();
    });
    logs.flush();
  }, 300_000);

  it("returns false when a parseable launch snapshot fails during session materialization", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const materializer = vi
      .spyOn(
        rig.guestScene.gameData as unknown as {
          initSessionFromData: (data: unknown) => Promise<void>;
        },
        "initSessionFromData",
      )
      .mockRejectedValueOnce(new Error("asset materialization failed"));

    await expect(
      withClient(rig.guestCtx, () => rig.guestScene.gameData.applyCoopLaunchSession(hostJson)),
      "a post-parse failure becomes an explicit negative resume result",
    ).resolves.toBe(false);
    expect(materializer).toHaveBeenCalledOnce();
    materializer.mockRestore();
    logs.flush();
  }, 300_000);

  it("rejects wrong-mode, wrong-seat, and digest-swapped snapshots before session mutation", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const parsed = await withClient(rig.hostCtx, () => rig.hostScene.gameData.parseSessionData(hostJson));
    const commitment = await deriveCoopResumeCommitment(hostJson, parsed);
    expect(commitment).not.toBeNull();
    const raw = JSON.parse(hostJson) as Record<string, unknown>;

    const wrongMode = JSON.stringify({ ...raw, gameMode: GameModes.CLASSIC });
    await expect(
      withClient(rig.guestCtx, () => rig.guestScene.gameData.applyCoopLaunchSession(wrongMode)),
      "a parseable solo snapshot cannot cross the co-op adoption boundary",
    ).resolves.toBe(false);

    const participants = raw.coopParticipants as {
      version: 1;
      players: [string, string];
      seats: { host: string; guest: string };
    };
    const wrongSeat = JSON.stringify({
      ...raw,
      coopParticipants: { ...participants, seats: { ...participants.seats, guest: "Mallory" } },
    });
    await expect(
      withClient(rig.guestCtx, () => rig.guestScene.gameData.applyCoopLaunchSession(wrongSeat)),
      "the right pair in the wrong authority seats is rejected",
    ).resolves.toBe(false);

    const swappedAfterOffer = JSON.stringify({ ...raw, money: Number(raw.money ?? 0) + 1 });
    await expect(
      withClient(rig.guestCtx, () => rig.guestScene.gameData.applyCoopLaunchSession(swappedAfterOffer, commitment!)),
      "bytes changed after the offer cannot satisfy its digest",
    ).resolves.toBe(false);
    logs.flush();
  }, 300_000);

  it("stages assets without mutating the scene when the exact runtime is replaced mid-load", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const moneyBefore = rig.guestScene.money;
    const partyBefore = rig.guestScene.getPlayerParty().map(pokemon => pokemon.id);
    let releaseLoad!: () => void;
    let markLoadStarted!: () => void;
    const loadStarted = new Promise<void>(resolve => {
      markLoadStarted = resolve;
    });
    const heldLoad = new Promise<void>(resolve => {
      releaseLoad = resolve;
    });
    const loadSpy = vi.spyOn(PlayerPokemon.prototype, "loadAssets").mockImplementationOnce(async () => {
      markLoadStarted();
      await heldLoad;
    });

    const applying = withClient(rig.guestCtx, () => rig.guestScene.gameData.applyCoopLaunchSession(hostJson));
    await loadStarted;
    expect(rig.guestScene.money, "money is not committed before staged assets settle").toBe(moneyBefore);
    expect(
      rig.guestScene.getPlayerParty().map(pokemon => pokemon.id),
      "party is not replaced before staged assets settle",
    ).toEqual(partyBefore);
    setCoopRuntime(rig.hostRuntime);
    releaseLoad();
    await expect(applying, "the stale materialization lease fails closed").resolves.toBe(false);
    expect(rig.guestScene.money, "stale staged bytes never commit money").toBe(moneyBefore);
    expect(
      rig.guestScene.getPlayerParty().map(pokemon => pokemon.id),
      "stale staged bytes never replace party",
    ).toEqual(partyBefore);
    loadSpy.mockRestore();
    logs.flush();
  }, 300_000);
});
