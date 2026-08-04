/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op ME BATTLE-HANDOFF -> REWARD SHOP deadlock (#847, the maintainer's "berry bush"
// P0). A mystery encounter whose option SPAWNS a battle hands off to the host-authoritative battle
// path (#693/#816). When the host WINS that ME battle it transitions to the ME reward shop - but
// `VictoryPhase` takes the `isMysteryEncounter` branch BEFORE `broadcastCoopWaveResolved("win")`, so
// the host NEVER streams a wave-advance for the ME battle. The guest (a pure renderer that never runs
// its own FaintPhase/VictoryPhase) then had NO signal to stop looping the won battle: it finalized the
// winning turn with no pending wave-advance and opened a PHANTOM turn N+1 command for a battle the host
// already left for the reward shop. Authority V2 now orders the reward presentation directly after the
// committed battle result, so an obsolete local command frontier cannot become a correctness owner.
//
// This regression asserts across two REAL engines over the loopback that the guest detects the ME-battle
// WIN directly
//       (`coopMeHandoffBattleWon`: spawned ME battle + all enemies fainted per the host's authoritative
//       checkpoint) and runs the ME victory tail (`queueCoopMeBattleVictoryTail` -> VictoryPhase ->
//       reward shop) INSTEAD of opening a phantom next command. The retired cross-point-rendezvous section
//       described a legacy escape hatch and is intentionally not part of the V2 correctness contract.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-me-battle-reward.test.ts
//   (PowerShell: $env:ER_SCENARIO="1"; npx vitest run <path>)
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { coopMeHandoffBattleStarted, setCoopMeInteractionStart } from "#data/elite-redux/coop/coop-me-pin-state";
import {
  getCoopRendererNeutralizedLog,
  resetCoopRendererNeutralizedLog,
} from "#data/elite-redux/coop/coop-renderer-gate";
import {
  clearCoopRuntime,
  coopMeHandoffBattleWon,
  coopMeInProgress,
  setCoopMeBattleInteractionCounter,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuoForMe,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveDuoGuestMeReplay,
  driveDuoGuestTackleThroughPublicUi,
  driveGuestReplayTurn,
  installDuoLogCapture,
  withClient,
} from "#test/tools/coop-duo-harness";
import { runSelectMysteryEncounterOption } from "#test/utils/encounter-test-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A valid ME wave: WILD, non-boss, in [10,180], waveIndex % 10 != 1 (see isMysteryEncounterValidForWave). */
const ME_WAVE = 12;
/** The ME interaction counter the FIGHT_OR_FLIGHT ME opens on (host owns even -> counter 0). */
const ME_COUNTER = 0;
/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO ME battle-handoff -> reward shop deadlock (#847 berry bush)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    resetCoopRendererNeutralizedLog();
    logs = installDuoLogCapture(`me-battle-reward-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(ME_WAVE)
      .mysteryEncounterChance(100)
      .startingLevel(50)
      .moveset([MoveId.TACKLE])
      .disableTrainerWaves();
  });

  afterEach(() => {
    logs.dispose();
    clearCoopRuntime();
    // #847 harness citizenship (vitest isolate:false): this test drives a battle HANDOFF (finishWithout
    // Leaving) but NOT the ME terminal, so the process-global ME/handoff module state stays SET. The
    // ClientCtx swap only carries coopMeInteractionStart / coopMeBattleInteractionCounter (per the harness
    // header), NOT the handoff flag/wave - so force the FULL ME family back to idle here, or a later
    // ER_SCENARIO file (e.g. coop-guest-faint-no-local-victory) inherits a latched handoff state.
    // (clearCoopRuntime already resets these via setCoopMeInteractionStart(-1); this is the explicit,
    // self-documenting belt-and-suspenders the citizenship rule asks for.)
    setCoopMeInteractionStart(-1); // clears the pin + coopMeHandoffBattle + coopMeHandoffBattleWave (#847)
    setCoopMeBattleInteractionCounter(-1); // clears the runtime ME counter (coopMeHandoffActive gate)
    // #710 harness-citizenship: buildDuoForMe()/buildGuestScene() constructs a 2nd BattleScene (the
    // guest), whose ctor steals globalScene. Restore the host GameManager scene for the next file.
    initGlobalScene(game.scene);
  });

  it("FAILS-BEFORE / PASSES-AFTER: the committed ME victory tail suppresses a phantom next turn", async () => {
    // ===== REACH: park the HOST on a real FIGHT_OR_FLIGHT ME wave (option 1 SPAWNS a battle), then stand
    // up the two-engine rig. Host owns the ME at counter 0 (even). Same reach as coop-duo-mystery IT #3. =====
    await game.runToMysteryEncounter(MysteryEncounterType.FIGHT_OR_FLIGHT, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    expect(hostScene.currentBattle.mysteryEncounter?.encounterType, "the forced ME is FIGHT_OR_FLIGHT").toBe(
      MysteryEncounterType.FIGHT_OR_FLIGHT,
    );

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    expect(rig.hostRuntime.controller.interactionCounter(), "the ME opens on interaction counter 0").toBe(ME_COUNTER);

    // ===== HANDOFF: drive the host through option 1 (the BATTLE option) to MysteryEncounterBattlePhase -
    // AFTER initBattleWithEnemyConfig committed the complete retained battle state + destination. =====
    await withClient(rig.hostCtx, async () => {
      await runSelectMysteryEncounterOption(game, 1);
      await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
      expect(
        hostScene.phaseManager.getCurrentPhase()?.phaseName,
        "host spawned the ME battle (reached MysteryEncounterBattlePhase)",
      ).toBe("MysteryEncounterBattlePhase");
      hostScene.phaseManager.getCurrentPhase().start();
      await driveClientPhaseQueueTo(hostScene, "TurnInitPhase");
    });

    // ===== GUEST: run its REAL CoopReplayMePhase + all guest-side assertions in ONE live-ctx block. The
    // ME-handoff-STARTED flag (`coopMeHandoffBattleStarted`) is process-global module state the harness's
    // per-client ctx swap-back does NOT carry, so it must be read while the guest ctx is still live (a
    // harness state-management detail, not a production concern - production has one process per client).
    //
    // The retained ME_TERMINAL applies the host's exact state before CoopReplayMePhase finishesWithoutLeaving:
    // it does NOT leave/advance, marks the handoff battle STARTED, and boots the declared battle surface. =====
    const guestReplay = await driveDuoGuestMeReplay(rig);
    await withClient(rig.guestCtx, async () => {
      expect(guestReplay.settled, "guest CoopReplayMePhase settled at the battle-handoff").toBe(true);
      expect(coopMeInProgress(), "guest ME pin still set through the spawned battle").toBe(true);
      expect(coopMeHandoffBattleStarted(), "guest marked the ME handoff battle STARTED (#817)").toBe(true);

      // Production presentation handoff: drive the ACTUAL guest MysteryEncounterBattlePhase that
      // finishWithoutLeaving queued. Its authoritative branch must materialize the already-adopted objects
      // without constructing the blocked Summon/Return/InitEncounter resolution tail.
      const guestBattleBoot = rig.guestScene.phaseManager.getCurrentPhase();
      expect(guestBattleBoot?.phaseName, "guest reached its real ME battle boot").toBe("MysteryEncounterBattlePhase");
      guestBattleBoot.start();
      // The authoritative renderer intentionally releases this phase only after every reconstructed
      // player/enemy atlas is live. That readiness proof is asynchronous even when Phaser HEADLESS has
      // already seen the species, so assert the presentation at the real actionable successor instead of
      // sampling the first microtask after start(). A browser likewise cannot open Command before this
      // TurnInit boundary.
      await driveClientPhaseQueueTo(rig.guestScene, "TurnInitPhase");
      const playerSeats = rig.guestScene
        .getPlayerParty()
        .slice(0, rig.guestScene.currentBattle.arrangement.playerCapacity);
      const enemySeats = rig.guestScene
        .getEnemyParty()
        .slice(0, rig.guestScene.currentBattle.arrangement.enemyCapacity);
      for (const mon of [...playerSeats, ...enemySeats]) {
        expect(mon.isOnField(), `${mon.name} is seated by the ME presentation handoff`).toBe(true);
        expect(mon.visible, `${mon.name} container is visible at the ME command boundary`).toBe(true);
        expect(mon.getSprite().visible, `${mon.name} sprite is visible at the ME command boundary`).toBe(true);
        expect(mon.getBattleInfo().visible, `${mon.name} info bar is visible at the ME command boundary`).toBe(true);
      }
      expect(
        rig.guestScene.phaseManager.getCurrentPhase()?.phaseName,
        "ME presentation boot falls into the normal turn loop without a blocked structural tail",
      ).toBe("TurnInitPhase");

      // DEFECT (2): the guest adopted the host's ME-battle enemies. While they are ALIVE the ME battle is
      // NOT won (a legit turn would play - no premature victory, the BUG1 hazard the normal path guards).
      const enemies = rig.guestScene.getEnemyParty();
      expect(enemies.length, "guest adopted the host's ME-battle enemy party at the handoff (#819)").toBeGreaterThan(0);
      expect(
        coopMeHandoffBattleWon(),
        "ME battle NOT won while enemies live (guest plays the turn, no premature victory)",
      ).toBe(false);
    });

    // Play the spawned battle through the same public Command/Fight/Target handlers as two browsers. Reaching
    // those handlers now also proves the embedded battle consumed the sealed entry-presentation prefix from
    // its exact turn-one CONTROL_COMMIT; there is intentionally no synthetic ordinary-wave carrier here.
    // The former fixture jumped both scenes directly from the turn-1 handoff to a synthetic turn-3 BattleEnd,
    // omitting the intervening Authority V2 turn entry that legally owns that successor. That manufactured
    // an impossible global-log gap. One-HP enemies keep this production journey fast while the real turn
    // records both faints, applies the checkpoint, and authors the ME victory tail.
    await withClient(rig.hostCtx, async () => {
      for (const enemy of hostScene.getEnemyParty()) {
        enemy.hp = 1;
      }
    });
    const turn = rig.hostScene.currentBattle.turn;
    await driveDuoGuestTackleThroughPublicUi(game, rig, {
      restartAlreadyOpenHost: false,
      submitHostTackle: true,
      hostMoveId: MoveId.TACKLE,
      guestMoveId: MoveId.TACKLE,
      hostTarget: BattlerIndex.ENEMY,
      guestTarget: BattlerIndex.ENEMY_2,
    });
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
      expect(
        hostScene.getEnemyParty().every(enemy => enemy.isFainted()),
        "the public authoritative turn fainted the complete ME enemy field",
      ).toBe(true);
    });

    const queued = await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn, { sealRetainedWaveBoundary: false });
      expect(
        coopMeHandoffBattleWon(),
        "guest detects the ME battle WON from the authoritative turn checkpoint (#847)",
      ).toBe(true);

      // Execute the Victory queued by the production replay finalizer. Strict-tail gating must preserve its
      // real BattleEnd rather than substituting CoopInert or opening a phantom command.
      const turnBefore = rig.guestScene.currentBattle.turn;
      const victory = await driveClientPhaseQueueTo(rig.guestScene, "VictoryPhase");
      victory.start();
      const currentAfterVictory = rig.guestScene.phaseManager.getCurrentPhase();
      const queuedAfterVictory = rig.guestScene.phaseManager.getQueuedPhaseNames();
      expect(
        [currentAfterVictory?.phaseName, ...queuedAfterVictory],
        "Victory constructed and entered its real retained BattleEnd",
      ).toContain("BattleEndPhase");
      expect(currentAfterVictory?.phaseName, "guest parks on exact ME BattleEnd").toBe("BattleEndPhase");
      const guestBattleEnd = currentAfterVictory!;
      expect(
        rig.guestScene.phaseManager.getCurrentPhase(),
        "the exact BattleEnd remains current before settlement",
      ).toBe(guestBattleEnd);
      const heldEnd = vi.spyOn(guestBattleEnd, "end");
      const scoreBeforeHold = rig.guestScene.score;
      guestBattleEnd.start();
      expect(heldEnd, "guest BattleEnd does not release before the retained settlement").not.toHaveBeenCalled();
      expect(rig.guestScene.phaseManager.getCurrentPhase(), "the exact BattleEnd remains current while held").toBe(
        guestBattleEnd,
      );
      expect(rig.guestScene.score, "renderer ran no shared BattleEnd score mutation while held").toBe(scoreBeforeHold);
      return { heldEnd, queuedAfterVictory, turnBefore, turnAfter: rig.guestScene.currentBattle.turn };
    });
    expect(
      queued.queuedAfterVictory,
      "guest did NOT open a phantom next-command after the won ME battle",
    ).not.toContain("CommandPhase");
    expect(queued.turnAfter, "renderer did not manufacture another turn while parking BattleEnd").toBe(
      queued.turnBefore,
    );

    // Drive the production host wiring rather than invoking the settlement seam: real Victory calls
    // handleMysteryEncounterVictory queues BattleEnd and the reward phase with one immutable plan. BattleEnd
    // keeps the guest parked; the reward phase commits only after its automatic preparation boundary.
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("BattleEndPhase", false);
      expect(hostScene.phaseManager.getCurrentPhase()?.phaseName, "host reached the exact planned BattleEnd").toBe(
        "BattleEndPhase",
      );
      hostScene.phaseManager.getCurrentPhase().start();
      expect(
        [hostScene.phaseManager.getCurrentPhase()?.phaseName, ...hostScene.phaseManager.getQueuedPhaseNames()],
        "real BattleEnd released the host toward its ME rewards",
      ).toContain("MysteryEncounterRewardsPhase");
      const rewards = hostScene.phaseManager.getCurrentPhase();
      expect(rewards?.phaseName, "host reached the post-prepare settlement owner").toBe("MysteryEncounterRewardsPhase");
      rewards.start();
      // Reward preparation is intentionally async. Keep this browser's complete scene/runtime context
      // installed until that continuation captures the settlement and ends the phase; otherwise the
      // one-process fixture restores the guest global between `start()` and its Promise continuation and
      // silently fails the phase-identity guard. Separate browsers cannot suffer that ambient-context swap.
      await vi.waitFor(
        () =>
          expect(
            hostScene.phaseManager.getCurrentPhase(),
            "host retained its post-preparation ME settlement before yielding browser context",
          ).not.toBe(rewards),
        { timeout: 2_000, interval: 10 },
      );
      await drainLoopback();
    });
    await withClient(rig.guestCtx, async () => {
      // Production clients never share a scene. Pump the retained envelope only after the guest's complete
      // scene/runtime context is installed; this is the exact scheduler edge two independent browsers get
      // automatically and avoids relying on durability to repair a single-process harness misdelivery.
      await drainLoopback();
      await vi.waitFor(
        () =>
          expect(queued.heldEnd, "the exact held BattleEnd releases once after settlement").toHaveBeenCalledTimes(1),
        { timeout: 2_000, interval: 25 },
      );
      const currentName = rig.guestScene.phaseManager.getCurrentPhase()?.phaseName;
      const rewardQueue = rig.guestScene.phaseManager.getQueuedPhaseNames();
      expect([currentName, ...rewardQueue], "settlement releases into real reward presentation").toContain(
        "MysteryEncounterRewardsPhase",
      );
      expect([currentName, ...rewardQueue], "egg lapse remains ordered behind the reward phase").toContain(
        "EggLapsePhase",
      );
      expect([currentName, ...rewardQueue], "settlement release cannot manufacture a command").not.toContain(
        "CommandPhase",
      );
      expect(
        getCoopRendererNeutralizedLog(),
        "Victory, BattleEnd, reward, and egg constructors all passed their exact retained sanctions",
      ).toEqual([]);
    });

    logs.flush();
  }, 300_000);
});
