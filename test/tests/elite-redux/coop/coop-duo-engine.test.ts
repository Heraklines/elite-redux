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
import { clearCoopRuntime, getCoopV2Shadow, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { SpoofGuest } from "#data/elite-redux/coop/coop-spoof-guest";
import { type CoopMessage, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  buildGuestScene,
  buildRuntime,
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

  it("HOST smoke: a real authoritative-host co-op double EMITs a turnResolution over the loopback", async () => {
    // --- Boot the host engine into a real battle. ---
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const hostScene = game.scene;

    // --- Pair over the loopback; the HOST runtime sits on the `host` endpoint. ---
    const pair = createLoopbackPair();
    const hostRuntime = buildRuntime(pair.host, "Host", "authoritative");
    hostRuntime.spoof = new SpoofGuest(pair.guest);
    hostRuntime.spoof.connect();
    setCoopRuntime(hostRuntime);
    hostRuntime.controller.connect();
    expect(
      await hostRuntime.controller.awaitPartnerCompatibility(),
      "the engine fixture negotiates a complete same-build peer before gameplay",
    ).not.toBeNull();
    // Flip into co-op + tag field ownership, host role.
    hostScene.gameMode = getGameMode(GameModes.COOP);
    const field = hostScene.getPlayerField();
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    hostRuntime.controller.role = "host";

    // Observe the OTHER endpoint. SpoofGuest is the representative negotiated local peer and
    // answers the partner command through the production CoopBattleSync request path.
    const guestEnd = pair.guest;
    let emittedTurnResolution = false;
    let emittedAuthoritativeState: Record<string, unknown> | undefined;
    guestEnd.onMessage(msg => {
      if (msg.t === "turnResolution") {
        emittedTurnResolution = true;
        emittedAuthoritativeState = msg.authoritativeState as unknown as Record<string, unknown> | undefined;
      }
    });

    // --- Drive the host turn: both player slots FIGHT move 0 at the frail enemies. ---
    game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
    game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);

    await game.phaseInterceptor.to("CoopTurnCommitPhase");
    await drainLoopback();

    expect(emittedTurnResolution, "host emitted a turnResolution over the loopback").toBe(true);
    expect(emittedAuthoritativeState?.version, "turnResolution carries authoritativeState v1").toBe(1);
    expect(emittedAuthoritativeState?.playerParty, "authoritativeState carries full PokemonData parties").toEqual(
      expect.arrayContaining([expect.objectContaining({ summonData: expect.any(Object) })]),
    );
    const emittedField = emittedAuthoritativeState?.field as Record<string, unknown>[] | undefined;
    expect(emittedField, "authoritativeState carries seating").toEqual(expect.any(Array));
    expect(
      emittedField?.every(seat => !("tags" in seat) && !("statStages" in seat) && !("transform" in seat)),
      "authoritativeState.field is seating-only; live state rides PokemonData.summonData",
    ).toBe(true);
    logs.flush();
  }, 120_000);

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
    const guestV2AppliedBefore = getCoopV2Shadow(rig.guestRuntime)?.diagnostics().applied ?? 0;
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

    // V2 owns the mechanical carrier, so its legacy turnResolution twin must be absent. A legacy fallback
    // keeps the original assertion. The real material proof happens after the guest replay below.
    if (V2_TURN_CUTOVER) {
      expect(guestTurnResolution, "Authority V2 suppresses the raw turnResolution correctness carrier").toBeNull();
    } else {
      expect(guestTurnResolution, "the legacy guest received the host's turnResolution").not.toBeNull();
    }

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
        getCoopV2Shadow(rig.guestRuntime)?.diagnostics().applied ?? 0,
        "the Authority V2 entry completed the guest's live material/finalize boundary",
      ).toBeGreaterThan(guestV2AppliedBefore);
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
