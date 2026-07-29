/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// FEASIBILITY SPIKE (#633): TWO REAL co-op engines in one process.
//
// Every existing co-op test is SINGLE-ENGINE - one globalScene, the local client plays
// the GUEST, and the HOST is FAKED with hand-authored turnResolution messages injected
// over partnerTransport. That is exactly why a real host-vs-guest divergence (the TM-
// reward-shop orphan softlock) slipped through. This spike boots BOTH a HOST and a GUEST
// BattleScene as REAL engines over createLoopbackPair (the same framing the real WebRTC
// path uses), starts a deterministic co-op double, and plays one full battle to victory
// with the guest replaying the host's streamed turns, then reaches the post-battle reward
// shop. Gated ER_SCENARIO=1 like the other ER engine tests.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import {
  coopPresentationOutcome,
  createCoopPresentationOutcomeToken,
} from "#data/elite-redux/coop/coop-presentation-outcome";
import {
  clearCoopRuntime,
  coopSessionGeneration,
  getCoopBattleStreamer,
  getCoopRuntime,
  getCoopV2Shadow,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { type CoopMessage, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  buildGuestScene,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveDuoGuestTackleThroughPublicUi,
  driveGuestReplayTurn as driveHarnessGuestReplayTurn,
  installDuoLogCapture,
  reachInterceptedRewardShop,
  shiftQueuedGuestBootTail,
  withClient,
} from "#test/tools/coop-duo-harness";
import { installHeadlessCoopSemanticProjectionOracle } from "#test/tools/coop-semantic-presentation";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const V2_TURN_CUTOVER = process.env.COOP_AUTHORITY_V2_TURN === "on";

function deferred<T = void>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe.skipIf(!RUN)("co-op DUO: two real engines over loopback (#633 feasibility spike)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let restoreProjection: (() => void) | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    restoreProjection = installHeadlessCoopSemanticProjectionOracle(game.scene);
    logs = installDuoLogCapture(`spike-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]);
  });

  afterEach(() => {
    restoreProjection?.();
    restoreProjection = undefined;
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: buildGuestScene() constructs a 2nd BattleScene (the guest), whose
    // ctor steals globalScene via initGlobalScene(this). Restore the host GameManager scene so the
    // NEXT ER_SCENARIO file's GameManager reuses a valid host scene, not the stripped-down guest one.
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  it("headless boot-tail bridge skips only recognized synthetic boot prefixes", () => {
    const makeScene = (currentName: string, queuedNames: string[]) => {
      let current = { phaseName: currentName };
      const queued = [...queuedNames];
      const scene = {
        phaseManager: {
          getCurrentPhase: () => current,
          getQueuedPhaseNames: () => [...queued],
          shiftPhase: () => {
            const next = queued.shift();
            if (next != null) {
              current = { phaseName: next };
            }
          },
        },
      } as unknown as BattleScene;
      return { scene, currentName: () => current.phaseName };
    };

    const delayedBoot = makeScene("SelectGenderPhase", ["TitlePhase", "CoopFinalizeTurnPhase"]);
    expect(shiftQueuedGuestBootTail(delayedBoot.scene)).toBe(true);
    expect(delayedBoot.currentName()).toBe("TitlePhase");
    expect(shiftQueuedGuestBootTail(delayedBoot.scene)).toBe(true);
    expect(delayedBoot.currentName()).toBe("CoopFinalizeTurnPhase");
    expect(shiftQueuedGuestBootTail(delayedBoot.scene), "the authoritative tail is never skipped").toBe(false);

    const gameplayAhead = makeScene("TitlePhase", ["SelectModifierPhase", "CoopFinalizeTurnPhase"]);
    expect(
      shiftQueuedGuestBootTail(gameplayAhead.scene),
      "an intervening gameplay/UI phase keeps the bridge fail-closed",
    ).toBe(false);
    expect(gameplayAhead.currentName()).toBe("TitlePhase");
  });

  // The retired one-engine host/spoof smoke could emit cosmetic turnResolution without establishing the
  // V2 CONTROL predecessor. The exact DUO journey below now owns this coverage through both public command
  // surfaces and proves TURN_COMMIT material, replica application, presentation, and the next control.

  it("GUEST scene boots: a 2nd real BattleScene constructs + injects mocks without re-seeding RND", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const hostScene = game.scene;
    const rndBefore = Phaser.Math.RND.state();

    const guestScene: BattleScene = buildGuestScene(game);

    // The guest scene is a DISTINCT object with its own phaseManager + gameData.
    expect(guestScene).not.toBe(hostScene);
    expect(guestScene.phaseManager).not.toBe(hostScene.phaseManager);
    // buildGuestScene must restore the RND cursor it perturbed (no bleed).
    expect(Phaser.Math.RND.state(), "RND cursor restored after guest-scene build").toBe(rndBefore);
    // globalScene was stolen by the guest ctor; re-point it to the host for the rest of the run.
    expect(globalScene).toBe(guestScene);
    logs.flush();
  }, 120_000);

  it("a guest form preimage continuation queues only on its captured engine while the host stays ambient", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, scene => {
      scene.gameMode = getGameMode(GameModes.COOP);
    });
    const load = deferred();
    const token = createCoopPresentationOutcomeToken();
    let queuedChild: { retire(): void } | null = null;
    let guestQueue!: ReturnType<typeof vi.spyOn>;
    const hostQueue = vi.spyOn(rig.hostScene.phaseManager, "unshiftPhase");

    await withClient(rig.guestCtx, () => {
      const pokemon = rig.guestScene.getPlayerField()[0];
      const formChange = pokemonFormChanges[pokemon.species.speciesId]?.find(candidate => !candidate.quiet);
      expect(formChange).toBeDefined();
      const targetFormIndex = pokemon.species.forms.findIndex(form => form.formKey === formChange!.formKey);
      const detached = rig.guestScene.addPlayerPokemon(
        pokemon.species,
        pokemon.level,
        pokemon.abilityIndex,
        pokemon.formIndex,
        pokemon.gender,
        pokemon.shiny,
        pokemon.variant,
        pokemon.ivs,
        pokemon.nature,
        pokemon,
      );
      vi.spyOn(detached, "loadAssets").mockReturnValue(load.promise);
      vi.spyOn(rig.guestScene, "addPlayerPokemon").mockReturnValueOnce(detached);
      guestQueue = vi.spyOn(rig.guestScene.phaseManager, "unshiftPhase").mockImplementation(phase => {
        queuedChild = phase;
      });
      rig.guestScene.moveAnimations = true;
      const phase = rig.guestScene.phaseManager.create(
        "CoopFormChangeReplayPhase",
        {
          k: "formChange",
          bi: pokemon.getBattlerIndex(),
          actor: { side: "player", pokemonId: pokemon.id },
          speciesId: pokemon.species.speciesId,
          preFormIndex: pokemon.formIndex,
          formIndex: targetFormIndex,
          presentation: "evolution",
          animate: true,
        },
        token,
      );
      expect(getCoopRuntime()).toBe(rig.guestRuntime);
      expect(getCoopBattleStreamer()).toBe(rig.guestRuntime.battleStream);
      expect(coopSessionGeneration()).toBeGreaterThanOrEqual(0);
      phase.start();
    });

    // Resolve the guest-owned promise while the host browser remains process-global. The continuation must
    // re-enter through the captured guest scheduler instead of borrowing the host scene/phase queue.
    await withClient(rig.hostCtx, async () => {
      load.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(globalScene).toBe(rig.hostScene);
      expect(getCoopRuntime()).toBe(rig.hostRuntime);
    });
    await vi.waitFor(() => expect(guestQueue).toHaveBeenCalledOnce(), { timeout: 2_000 });

    expect(hostQueue, "ambient host ownership is never consulted by the guest promise tail").not.toHaveBeenCalled();
    expect(queuedChild).not.toBeNull();
    expect(coopPresentationOutcome(token), "queuing the cutscene is not a rendered receipt").toBeUndefined();
    await withClient(rig.guestCtx, () => queuedChild?.retire());
  }, 120_000);

  it("guest form appearance continuations re-enter their captured engine after inner asset waits", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, scene => {
      scene.gameMode = getGameMode(GameModes.COOP);
    });
    const fieldLoad = deferred();
    const fieldInfo = deferred();
    const childLoad = deferred();
    const childInfo = deferred();
    const fieldToken = createCoopPresentationOutcomeToken();
    let fieldPlayCount = 0;
    let fieldInfoCount = 0;
    let childPlayCount = 0;
    let childInfoCount = 0;
    let childInstall!: Promise<boolean>;
    let childPhase: { retire(): void } | null = null;

    await withClient(rig.guestCtx, () => {
      const pokemon = rig.guestScene.getPlayerField()[0];
      const formChange = pokemonFormChanges[pokemon.species.speciesId]?.find(candidate => !candidate.quiet);
      expect(formChange).toBeDefined();
      const preFormIndex = pokemon.formIndex;
      const targetFormIndex = pokemon.species.forms.findIndex(form => form.formKey === formChange!.formKey);
      vi.spyOn(pokemon, "loadAssets").mockReturnValueOnce(fieldLoad.promise).mockReturnValueOnce(childLoad.promise);
      vi.spyOn(pokemon, "playAnim").mockImplementation(() => {
        expect(globalScene).toBe(rig.guestScene);
        expect(getCoopRuntime()).toBe(rig.guestRuntime);
        if (fieldPlayCount === 0) {
          fieldPlayCount++;
        } else {
          childPlayCount++;
        }
      });
      vi.spyOn(pokemon, "updateInfo").mockImplementation(() => {
        expect(globalScene).toBe(rig.guestScene);
        expect(getCoopRuntime()).toBe(rig.guestRuntime);
        if (fieldInfoCount === 0) {
          fieldInfoCount++;
          return fieldInfo.promise;
        }
        childInfoCount++;
        return childInfo.promise;
      });
      rig.guestScene.moveAnimations = false;
      rig.guestScene.phaseManager
        .create(
          "CoopFormChangeReplayPhase",
          {
            k: "formChange",
            bi: pokemon.getBattlerIndex(),
            actor: { side: "player", pokemonId: pokemon.id },
            speciesId: pokemon.species.speciesId,
            preFormIndex,
            formIndex: targetFormIndex,
            presentation: "field",
            animate: false,
          },
          fieldToken,
        )
        .start();
    });

    await withClient(rig.hostCtx, async () => {
      fieldLoad.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(globalScene).toBe(rig.hostScene);
    });
    await vi.waitFor(() => expect(fieldPlayCount).toBe(1), { timeout: 2_000 });
    expect(fieldInfoCount).toBe(1);
    await withClient(rig.hostCtx, async () => {
      fieldInfo.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(
      () => expect(coopPresentationOutcome(fieldToken)).toMatchObject({ kind: "intentionally-skipped" }),
      { timeout: 2_000 },
    );

    await withClient(rig.guestCtx, () => {
      const pokemon = rig.guestScene.getPlayerField()[0];
      const formChange = pokemonFormChanges[pokemon.species.speciesId]?.find(candidate => !candidate.quiet);
      if (formChange == null) {
        throw new Error("the Snorlax fixture needs an ordinary form-change edge");
      }
      const targetFormIndex = pokemon.species.forms.findIndex(form => form.formKey === formChange.formKey);
      const detached = rig.guestScene.addPlayerPokemon(
        pokemon.species,
        pokemon.level,
        pokemon.abilityIndex,
        pokemon.formIndex,
        pokemon.gender,
        pokemon.shiny,
        pokemon.variant,
        pokemon.ivs,
        pokemon.nature,
        pokemon,
      );
      vi.spyOn(rig.guestScene, "updateFieldScale").mockImplementation(() => {
        expect(globalScene).toBe(rig.guestScene);
        expect(getCoopRuntime()).toBe(rig.guestRuntime);
        return Promise.resolve();
      });
      const phase = rig.guestScene.phaseManager.create("CoopFormChangeCutsceneReplayPhase", detached, formChange, {
        authorityPokemon: pokemon,
        preFormIndex: pokemon.formIndex,
        targetFormIndex,
        outcomeToken: createCoopPresentationOutcomeToken(),
        actorFingerprint: `player:p${pokemon.id}:inner-load-context`,
        runtime: {
          scene: rig.guestScene,
          phaseManager: rig.guestScene.phaseManager,
          runtime: rig.guestRuntime,
          streamer: rig.guestRuntime.battleStream,
          generation: coopSessionGeneration(),
        },
      });
      childPhase = phase;
      childInstall = (
        phase as unknown as {
          installCoopReplayResult(): Promise<boolean>;
        }
      ).installCoopReplayResult();
    });

    await withClient(rig.hostCtx, async () => {
      childLoad.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(globalScene).toBe(rig.hostScene);
    });
    await vi.waitFor(() => expect(childPlayCount).toBe(1), { timeout: 2_000 });
    expect(childInfoCount).toBe(1);
    await withClient(rig.hostCtx, async () => {
      childInfo.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await expect(childInstall).resolves.toBe(true);
    await withClient(rig.guestCtx, () => childPhase?.retire());
  }, 120_000);

  it("DUO: host plays a turn, the REAL guest engine RECVs+RESOLVEs+applies the checkpoint over loopback", async () => {
    // Build the same paired two-engine boundary as the maintained journeys. The original feasibility
    // spike assembled runtimes by hand and injected both commands into the host engine, so it never
    // established the V2 CONTROL_COMMIT predecessor that now authorizes TURN_COMMIT.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, scene => {
      scene.gameMode = getGameMode(GameModes.COOP);
    });

    // Track the exact carrier the guest received. Legacy applies the numeric checkpoint directly; Authority
    // V2 intentionally bypasses that function and proves the immutable carrier reached its material boundary.
    const applyCheckpointSpy = vi.spyOn(coopEngine, "applyCoopCheckpoint");
    let guestTurnResolution: Extract<CoopMessage, { t: "turnResolution" }> | null = null;
    const guestV2MaterialBefore = getCoopV2Shadow(rig.guestRuntime)?.diagnostics().appliedThrough ?? 0;
    pair.guest.onMessage(msg => {
      if (msg.t === "turnResolution") {
        guestTurnResolution = msg;
      }
    });

    // Drive both seats exclusively through their real COMMAND/FIGHT/TARGET handlers. This proves the
    // guest relay and installs the exact V2 command control before the host authors the turn.
    const turn = rig.hostScene.currentBattle.turn;
    await driveDuoGuestTackleThroughPublicUi(game, rig, {
      restartAlreadyOpenHost: false,
      submitHostTackle: true,
      guestTarget: BattlerIndex.ENEMY_2,
    });
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    await withClient(rig.guestCtx, () => drainLoopback());

    // Current V2 intentionally keeps one unretained raw turnResolution twin as cosmetic compatibility
    // telemetry; the global V2 entry remains the sole retained/applied correctness carrier. Prove the twin
    // was observable without mistaking its presence for legacy authority, then prove V2 material below.
    expect(guestTurnResolution, "the guest observed the one-shot cosmetic turnResolution twin").not.toBeNull();

    // Finish the real host BattleEnd seam and its retained automatic-victory seal so the COMPLETE
    // post-victory WAVE_ADVANCE transaction exists
    // before the winning guest replay consumes it. Stopping at BattleEnd alone is intentionally insufficient:
    // trainer money, automatic modifiers, and biome/x0 state settle between BattleEnd and the seal.
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CoopVictorySealPhase");
    });
    await withClient(rig.guestCtx, () => drainLoopback());

    // ===== Pump the GUEST: run its REAL CoopReplayTurnPhase for the host's turn. The host won the
    // wave (it broadcast waveResolved "win"), so the guest's ordered WAVE_ADVANCE entry owns the
    // VictoryPhase tail - the guest's path to the SAME post-battle reward shop the host reaches.
    // We assert the real phase queue reaches that tail (no infinite TurnInit loop).
    let guestVictoryPhase = "";
    await withClient(rig.guestCtx, async () => {
      await driveHarnessGuestReplayTurn(rig.guestScene, turn);
      // A null TURN successor deliberately cannot manufacture this tail. The following ordered
      // WAVE_ADVANCE entry owns it, first through CoopWaveAdvanceBoundaryPhase and then VictoryPhase.
      const victory = await driveClientPhaseQueueTo(rig.guestScene, "VictoryPhase");
      guestVictoryPhase = victory.phaseName;
    });

    // The guest RESOLVEd + applied the host's authoritative material (rendered the host's outcome). The
    // assertion follows the negotiated implementation instead of demanding an obsolete legacy helper call.
    if (V2_TURN_CUTOVER) {
      expect(
        getCoopV2Shadow(rig.guestRuntime)?.diagnostics().appliedThrough ?? 0,
        "the Authority V2 entry completed the guest's live material/finalize boundary",
      ).toBeGreaterThan(guestV2MaterialBefore);
    } else {
      expect(applyCheckpointSpy, "the guest applied the host's streamed legacy checkpoint").toHaveBeenCalled();
    }
    // The guest engine's enemies converged to the host's KO'd state (the frail Magikarps fainted) -
    // the guest computed nothing, it rendered the host's authoritative outcome.
    const guestEnemiesFainted = rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted());
    expect(guestEnemiesFainted, "the guest's enemies converged to the host-KOd state").toBe(true);
    // PHASE PROGRESS / no hang: the guest's finalize queued its OWN turn-end (the run loops) AND the
    // VictoryPhase tail (the wave advances toward the post-battle reward shop). This is the exact path
    // that softlocked in the field before #698/#697 - here it surfaces organically across two engines.
    expect(guestVictoryPhase, "the ordered WAVE_ADVANCE exposed the guest's VictoryPhase path to the shop").toBe(
      "VictoryPhase",
    );

    // ===== HOST reaches the post-battle REWARD SHOP. Continue driving the host past VictoryPhase to
    // its SelectModifierPhase (the reward shop) - proving the won battle traverses to the shop on the
    // sole authoritative engine, which is where the guest (replaying the host's stream) follows. =====
    await withClient(rig.hostCtx, () => reachInterceptedRewardShop(game, rig.hostScene));
    expect(
      rig.hostScene.phaseManager.getCurrentPhase().is("SelectModifierPhase"),
      "the host reached the post-battle reward shop (SelectModifierPhase)",
    ).toBe(true);

    logs.flush();
  }, 180_000);
});
