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
import type { Phase } from "#app/phase";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, getCoopV2Shadow, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { SpoofGuest } from "#data/elite-redux/coop/coop-spoof-guest";
import { type CoopMessage, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  buildGuestScene,
  buildRuntime,
  type ClientCtx,
  drainLoopback,
  driveClientPhaseQueueTo,
  emptyGhostSnapshot,
  installDuoLogCapture,
  installHeadlessPlayerAtlasCompletionModel,
  mirrorHostBattleToGuest,
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
    // ===== HOST engine =====
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const hostScene = game.scene;
    const pair = createLoopbackPair();
    // Assemble BOTH runtimes over the ONE loopback pair (assembleCoopRuntime does NOT clear/close,
    // so building the guest does not disconnect the host - the inventory's "assemble once" rule).
    const hostRuntime = buildRuntime(pair.host, "Host", "authoritative");
    const guestRuntime = buildRuntime(pair.guest, "Guest", "authoritative");
    hostRuntime.controller.role = "host";
    guestRuntime.controller.role = "guest";

    hostScene.gameMode = getGameMode(GameModes.COOP);
    const hostField = hostScene.getPlayerField();
    hostField[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    hostField[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    const hostCtx: ClientCtx = {
      label: "host",
      scene: hostScene,
      runtime: hostRuntime,
      rndState: Phaser.Math.RND.state(),
      ghost: emptyGhostSnapshot(),
    };

    // ===== GUEST engine (a 2nd real BattleScene) =====
    const guestScene = buildGuestScene(game);
    const guestCtx: ClientCtx = {
      label: "guest",
      scene: guestScene,
      runtime: guestRuntime,
      rndState: Phaser.Math.RND.state(),
      ghost: emptyGhostSnapshot(),
    };
    await withClient(guestCtx, () => {
      mirrorHostBattleToGuest(hostScene, guestScene);
      // This older hand-assembled spike bypasses buildDuo, so wire the same HEADLESS-only Phaser cache/live
      // key completion model explicitly. The production projection path below remains otherwise unchanged.
      installHeadlessPlayerAtlasCompletionModel(guestScene);
      const gf = guestScene.getPlayerField();
      gf[COOP_HOST_FIELD_INDEX].coopOwner = "host";
      gf[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    });

    // Connect both controllers (exchange hello / dataFingerprint over the live loopback).
    setCoopRuntime(hostRuntime);
    hostRuntime.controller.connect();
    setCoopRuntime(guestRuntime);
    guestRuntime.controller.connect();
    await drainLoopback();

    // The REAL guest engine answers the host's commandRequest for ITS OWN slot via the
    // production CoopBattleSync relay (the guest's transport endpoint), picking move 0. This is
    // the genuine guest-side command channel - not a hand-authored turnResolution.
    guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));

    // Track the exact carrier the guest received. Legacy applies the numeric checkpoint directly; Authority
    // V2 intentionally bypasses that function and proves the immutable carrier reached its material boundary.
    const applyCheckpointSpy = vi.spyOn(coopEngine, "applyCoopCheckpoint");
    let guestTurnResolution: Extract<CoopMessage, { t: "turnResolution" }> | null = null;
    const guestV2AppliedBefore = getCoopV2Shadow(guestRuntime)?.diagnostics().applied ?? 0;
    pair.guest.onMessage(msg => {
      if (msg.t === "turnResolution") {
        guestTurnResolution = msg;
      }
    });

    // ===== Drive ONE host turn to completion (both player slots FIGHT). =====
    await withClient(hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    await drainLoopback();

    // V2 owns the mechanical carrier, so its legacy turnResolution twin must be absent. A legacy fallback
    // keeps the original assertion. The real material proof happens after the guest replay below.
    if (V2_TURN_CUTOVER) {
      expect(guestTurnResolution, "Authority V2 suppresses the raw turnResolution correctness carrier").toBeNull();
    } else {
      expect(guestTurnResolution, "the legacy guest received the host's turnResolution").not.toBeNull();
    }

    // The spike predates buildDuo's sequential-boundary bridge. Finish the real host BattleEnd seam and its
    // retained automatic-victory seal now so the COMPLETE post-victory WAVE_ADVANCE transaction exists
    // before the winning guest replay consumes it. Stopping at BattleEnd alone is intentionally insufficient:
    // trainer money, automatic modifiers, and biome/x0 state settle between BattleEnd and the seal.
    await withClient(hostCtx, async () => {
      await game.phaseInterceptor.to("CoopVictorySealPhase");
    });
    await withClient(guestCtx, () => drainLoopback());

    // ===== Pump the GUEST: run its REAL CoopReplayTurnPhase for the host's turn. The host won the
    // wave (it broadcast waveResolved "win"), so the guest's ordered WAVE_ADVANCE entry owns the
    // VictoryPhase tail - the guest's path to the SAME post-battle reward shop the host reaches.
    // We assert the real phase queue reaches that tail (no infinite TurnInit loop).
    let guestVictoryPhase = "";
    await withClient(guestCtx, async () => {
      const turn = guestScene.currentBattle.turn;
      await driveGuestReplayTurn(guestScene, turn);
      // A null TURN successor deliberately cannot manufacture this tail. The following ordered
      // WAVE_ADVANCE entry owns it, first through CoopWaveAdvanceBoundaryPhase and then VictoryPhase.
      const victory = await driveClientPhaseQueueTo(guestScene, "VictoryPhase");
      guestVictoryPhase = victory.phaseName;
    });

    // The guest RESOLVEd + applied the host's authoritative material (rendered the host's outcome). The
    // assertion follows the negotiated implementation instead of demanding an obsolete legacy helper call.
    if (V2_TURN_CUTOVER) {
      expect(
        getCoopV2Shadow(guestRuntime)?.diagnostics().applied ?? 0,
        "the Authority V2 entry completed the guest's live material/finalize boundary",
      ).toBeGreaterThan(guestV2AppliedBefore);
    } else {
      expect(applyCheckpointSpy, "the guest applied the host's streamed legacy checkpoint").toHaveBeenCalled();
    }
    // The guest engine's enemies converged to the host's KO'd state (the frail Magikarps fainted) -
    // the guest computed nothing, it rendered the host's authoritative outcome.
    const guestEnemiesFainted = guestScene.currentBattle.enemyParty.every(e => e.isFainted());
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
    await withClient(hostCtx, () => reachInterceptedRewardShop(game, hostScene));
    expect(
      hostScene.phaseManager.getCurrentPhase().is("SelectModifierPhase"),
      "the host reached the post-battle reward shop (SelectModifierPhase)",
    ).toBe(true);

    logs.flush();
  }, 180_000);
});

/**
 * Pump a guest scene's phase queue to completion (it has no PhaseInterceptor; the harness made
 * startCurrentPhase inert). Runs each current phase, drains loopback between, until the queue is
 * empty or a no-progress hang is detected (which FAILS the spike with both logs already captured).
 */
/**
 * The presentation phases {@linkcode CoopReplayTurnPhase} unshifts (anim pump + deferred finalize),
 * plus the MessagePhase a `message` event queues. The checkpoint + wave-advance run in the deferred
 * {@linkcode CoopFinalizeTurnPhase} (LAST on the tree level), so we drain these to observe the
 * checkpoint applied. (Mirrors the single-engine guest test's REPLAY_DRAIN_PHASES.)
 */
const REPLAY_DRAIN_PHASES = new Set([
  "MessagePhase",
  "CoopMoveAnimReplayPhase",
  "CoopHpDrainReplayPhase",
  "CoopStatStageReplayPhase",
  "CoopStatusReplayPhase",
  "CoopFaintReplayPhase",
  "CoopFinalizeTurnPhase",
]);

/**
 * Start a guest {@linkcode CoopReplayTurnPhase} for `turn` and drain the presentation phases it
 * unshifts PLUS the deferred {@linkcode CoopFinalizeTurnPhase} (which applies the host's checkpoint,
 * verifies the checksum, queues turn-end + the wave-advance tail). Throws on a no-progress hang so
 * the spike FAILS loudly (with both clients' logs already captured). The drain runs each phase to
 * completion; the anim/tween work is force-ended headlessly.
 */
async function driveGuestReplayTurn(
  guestScene: { phaseManager: { create: (n: "CoopReplayTurnPhase", t: number) => Phase; getCurrentPhase(): Phase } },
  turn: number,
): Promise<void> {
  const replay = guestScene.phaseManager.create("CoopReplayTurnPhase", turn);
  replay.start();
  await drainLoopback();
  let lastName = "";
  let stall = 0;
  for (let i = 0; i < 64; i++) {
    const cur = guestScene.phaseManager.getCurrentPhase();
    if (cur == null || !REPLAY_DRAIN_PHASES.has(cur.phaseName)) {
      return;
    }
    if (cur.phaseName === lastName) {
      if (++stall > 16) {
        throw new Error(`guest replay HANG: stuck on ${cur.phaseName} - see dev-logs/coop-duo/`);
      }
    } else {
      stall = 0;
    }
    lastName = cur.phaseName;
    const wasFinalize = cur.phaseName === "CoopFinalizeTurnPhase";
    cur.start();
    await drainLoopback();
    if (wasFinalize) {
      return;
    }
  }
}
