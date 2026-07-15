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
// already left for the reward shop. Each client then waited at a DIFFERENT rendezvous point (host at
// `shop:W:C`, guest at `cmd:W:C+1`) and both ate the full 60s anti-hang -> the frozen "neither player
// can pick the rewards" report.
//
// TWO fixes, both asserted here across two REAL engines over the loopback:
//   (1) CROSS-POINT rendezvous release: while awaiting P, the partner's arrival for a DIFFERENT point Q
//       (that we have not reached) cross-releases P immediately (INFO, not the timeout WARN) - so the
//       cross-barrier wait can never eat the 60s anti-hang.
//   (2) PHANTOM-TURN suppression: the guest detects the ME-battle WIN directly
//       (`coopMeHandoffBattleWon`: spawned ME battle + all enemies fainted per the host's authoritative
//       checkpoint) and runs the ME victory tail (`queueCoopMeBattleVictoryTail` -> VictoryPhase ->
//       reward shop) INSTEAD of opening a phantom next command.
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
  clearCoopRuntime,
  coopMeHandoffBattleWon,
  coopMeInProgress,
  getCoopRendezvous,
  setCoopMeBattleInteractionCounter,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopBattleCheckpoint } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { CoopFinalizeTurnPhase } from "#phases/coop-replay-phases";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuoForMe,
  drainLoopback,
  driveGuestMeReplay,
  installDuoLogCapture,
  withClient,
  withClientSync,
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
    logs = installDuoLogCapture(`me-battle-reward-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(ME_WAVE)
      .mysteryEncounterChance(100)
      .startingLevel(50)
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

  it("FAILS-BEFORE / PASSES-AFTER: guest suppresses the phantom turn (ME victory tail) + the cross-barrier wait releases with NO timeout", async () => {
    // A warn spy so we can assert the anti-hang RENDEZVOUS TIMEOUT WARN never fires (the deadlock's tell).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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
    });

    // ===== GUEST: run its REAL CoopReplayMePhase + all guest-side assertions in ONE live-ctx block. The
    // ME-handoff-STARTED flag (`coopMeHandoffBattleStarted`) is process-global module state the harness's
    // per-client ctx swap-back does NOT carry, so it must be read while the guest ctx is still live (a
    // harness state-management detail, not a production concern - production has one process per client).
    //
    // The retained ME_TERMINAL applies the host's exact state before CoopReplayMePhase finishesWithoutLeaving:
    // it does NOT leave/advance, marks the handoff battle STARTED, and boots the declared battle surface. =====
    const queued = await withClient(rig.guestCtx, async () => {
      const guestReplay = await driveGuestMeReplay(rig.guestScene);
      expect(guestReplay.settled, "guest CoopReplayMePhase settled at the battle-handoff").toBe(true);
      expect(coopMeInProgress(), "guest ME pin still set through the spawned battle").toBe(true);
      expect(coopMeHandoffBattleStarted(), "guest marked the ME handoff battle STARTED (#817)").toBe(true);

      // Production presentation handoff: drive the ACTUAL guest MysteryEncounterBattlePhase that
      // finishWithoutLeaving queued. Its authoritative branch must materialize the already-adopted objects
      // without constructing the blocked Summon/Return/InitEncounter resolution tail.
      const guestBattleBoot = rig.guestScene.phaseManager.getCurrentPhase();
      expect(guestBattleBoot?.phaseName, "guest reached its real ME battle boot").toBe("MysteryEncounterBattlePhase");
      guestBattleBoot.start();
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

      // Apply the host's WIN: KO every enemy - what the host's authoritative post-turn checkpoint does on
      // the guest (a pure renderer). A fully-fainted party is the host's REAL win (read from the checkpoint,
      // not locally-chipped), so the guest must now run the ME victory tail instead of a phantom turn.
      for (const e of enemies) {
        e.hp = 0;
      }
      expect(
        coopMeHandoffBattleWon(),
        "guest detects the ME battle WON directly (spawned ME battle + all enemies fainted) (#847)",
      ).toBe(true);

      // Exercise the REAL guest finalize DECISION after an authoritative commit:
      // with the ME battle won it must run the ME victory tail (pushNew VictoryPhase), mirror the host's
      // settled numeric turn, and NOT queue a phantom command. `end()` is stubbed so the branch decision
      // runs without the phase's queue-shift side effects (we assert the decision, not the downstream VictoryPhase). Reverting the #847 branch
      // flips this to an increment without VictoryPhase - the compile-safe FAILS-BEFORE.
      const pushNewSpy = vi.spyOn(rig.guestScene.phaseManager, "pushNew");
      const turnBefore = rig.guestScene.currentBattle.turn;
      const finalize = new CoopFinalizeTurnPhase(turnBefore, {} as CoopBattleCheckpoint, "test-checksum");
      vi.spyOn(finalize, "end").mockImplementation(() => {});
      (finalize as unknown as { finishTurn(): void }).finishTurn();
      const names = pushNewSpy.mock.calls.map(c => c[0] as string);
      pushNewSpy.mockRestore();
      return { names, turnBefore, turnAfter: rig.guestScene.currentBattle.turn };
    });
    expect(
      queued.names,
      "guest queued the ME VICTORY tail (path to the reward shop), NOT a phantom turn (#847)",
    ).toContain("VictoryPhase");
    expect(queued.names, "guest did NOT open a phantom next-command (no CommandPhase queued) (#847)").not.toContain(
      "CommandPhase",
    );
    expect(queued.turnAfter, "the ME renderer mirrors the host's settled turn without queuing CommandPhase").toBe(
      queued.turnBefore + 1,
    );

    // ===== DEFECT (1) CROSS-BARRIER RELEASE over the REAL runtime rendezvous: reproduce the exact deadlock
    // shape - the host (reward owner) parks at `shop:W:C` while the guest diverged to a phantom `cmd:W:C+1`.
    // The host's shop await must CROSS-POINT release on the guest's foreign arrival (INFO, no 60s timeout),
    // not sit through the anti-hang. A generous explicit timeout proves the RELEASE wins, not the timer. =====
    const shopPoint = `shop:${ME_WAVE}:${ME_COUNTER}`;
    const phantomCmdPoint = `cmd:${ME_WAVE}:${ME_COUNTER + 1}`;
    const hostBarrier = withClientSync(rig.hostCtx, () => {
      const rv = getCoopRendezvous();
      expect(rv, "host runtime has a live rendezvous").not.toBeNull();
      return rv!.rendezvous(shopPoint, 30_000);
    });
    // The guest arrives at the DIFFERENT (phantom) command point - proving it is at another sync point.
    withClientSync(rig.guestCtx, () => getCoopRendezvous()!.arrive(phantomCmdPoint));
    await drainLoopback();
    const hostRes = await hostBarrier;
    expect(hostRes.timedOut, "the host shop barrier did NOT eat the anti-hang timeout").toBe(false);
    expect(hostRes.crossPoint, "the host shop barrier CROSS-POINT released on the guest's foreign arrival").toBe(
      phantomCmdPoint,
    );

    // The BUFFERED direction (the exact live ordering: the partner's foreign arrival is buffered BEFORE the
    // await opens): the guest opens its OWN barrier at the phantom command point with the host's shop arrival
    // already buffered -> it cross-releases at await-START.
    const guestRes = await withClient(rig.guestCtx, () => getCoopRendezvous()!.awaitPartner(phantomCmdPoint, 30_000));
    expect(guestRes.timedOut, "the guest command barrier did NOT eat the anti-hang timeout").toBe(false);
    expect(guestRes.crossPoint, "the guest command barrier CROSS-POINT released on the buffered shop arrival").toBe(
      shopPoint,
    );

    // ===== THE DEADLOCK'S TELL: the anti-hang RENDEZVOUS TIMEOUT WARN must NEVER fire - neither barrier sat
    // through the 60s. (Pre-fix BOTH sides emitted it after the full anti-hang.) =====
    expect(
      warnSpy.mock.calls.some(c => String(c[0]).includes("RENDEZVOUS TIMEOUT")),
      "NO barrier ate the anti-hang timeout (the berry-bush freeze is gone)",
    ).toBe(false);

    warnSpy.mockRestore();
    logs.flush();
  }, 300_000);
});
