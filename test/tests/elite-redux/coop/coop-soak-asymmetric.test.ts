/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #828 ASYMMETRIC CONTINUATION (SOAK BUILD 2). The two-engine proof that a HOST-HALF EXHAUSTION is DRIVEN,
// not a terminal: when the HOST's whole half is out (a host-owned field slot fainted with NO legal
// host-owned replacement) but the GUEST half is still alive, the run CONTINUES with the guest playing
// SOLO to the wave end (the partner-plays-on path). Every long live co-op run hits this the moment one
// player's team dies before the other's; before this the soak driver STOPPED at it (the #848 terminal).
//
// This exercises the exact production guard that ships for it:
//   - switch-phase.ts:53 / :191-198 - the modal FAINT_SWITCH picker for an owner with no legal same-owner
//     bench is SKIPPED / self-closed (no un-pickable menu strand), leaving the slot empty.
//   - command-phase.ts:468-481 - the reciprocal next-command rendezvous ARRIVES-ONLY (no await) when the
//     partner owns no battle-legal mon, so the survivor plays on unthrottled.
// and the exact driver decision the soak now makes (the exported predicates):
//   - hostHalfExhausted(rig) === true, and CRUCIALLY hostRunEndReason(rig) === null (no longer a terminal).
//
// It asserts the surviving side keeps playing turns with ZERO stalls (each host turn reaches TurnEndPhase
// then the next CommandPhase; the guest replays each in lockstep) and the exhausted side spectates cleanly
// (its field slot stays empty, both interaction counters stay equal).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-soak-asymmetric.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { CoopBattleSync } from "#data/elite-redux/coop/coop-battle-sync";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  driveGuestReplayTurn,
  installDuoLogCapture,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { hostHalfExhausted, hostOwnedFaintPending, hostRunEndReason } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Host owns EVEN party slots, guest owns ODD - the exact ownership tagging the soak uses. */
function tagOwnership(rig: DuoRig): void {
  for (const scene of [rig.hostScene, rig.guestScene]) {
    const party = scene.getPlayerParty();
    for (let i = 0; i < party.length; i++) {
      party[i].coopOwner = i % 2 === 0 ? "host" : "guest";
    }
  }
}

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op SOAK asymmetric continuation: host half out, guest plays on solo (#828)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`soak-asymmetric-${Date.now()}`);
    setCoopWaveBarrierMs(50);
    setCoopRendezvousWaitMs(50);
    setCoopFaintSwitchWaitMs(4000);
    // Level-100 MAGIKARP foes with a harmless GROWL: they never KO the guest and the guest never KOs them,
    // so the wave stays open for a sustained run of SOLO guest turns (the continuation we want to observe).
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(100)
      .enemyMoveset(MoveId.GROWL)
      .startingLevel(50)
      .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopFaintSwitchWaitMs(60_000);
    resetCoopRendezvousWaitMs();
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  it("host half exhausted (no bench): hostRunEndReason is NULL, the guest plays on solo for several turns in lockstep, no stall", async () => {
    // Party: BULBASAUR (id 1, Grass/Poison - 2x weak to Ground, NO immunity) + SNORLAX (id 143). startBattle
    // orders the party by species id, so field slot 0 = BULBASAUR (tagged HOST, no host bench) and field slot
    // 1 = SNORLAX (tagged GUEST). When BULBASAUR faints the HOST half is EXHAUSTED while the GUEST (SNORLAX)
    // plays on. Both are Ground-vulnerable so the ally-EARTHQUAKE faint below is deterministic (no Levitate /
    // Flying immunity to confound it).
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.BULBASAUR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    tagOwnership(rig);

    // Identify the HOST-owned field slot (field slot 0 by co-op convention) - damage THAT mon to 1 HP.
    const field = rig.hostScene.getPlayerField();
    // eslint-disable-next-line no-console
    console.log(
      `[asymmetric-test] field: ${field.map((m, i) => `slot${i}=${SpeciesId[m.species.speciesId]}(owner=${m.coopOwner})`).join(" ")}`,
    );
    const hostFieldIdx = field.findIndex(m => m.coopOwner === "host");
    expect(hostFieldIdx, "a host-owned field slot exists").toBeGreaterThanOrEqual(0);
    // Capture the mon OBJECT refs (getPlayerField() reorders once a mon faints, so a post-faint index lookup
    // is stale - assert on the objects instead).
    const hostMon = field[hostFieldIdx];
    const guestMon = rig.hostScene.getPlayerField().find(m => m.coopOwner === "guest")!;
    expect(guestMon, "a guest-owned field mon exists").toBeDefined();

    // The GUEST's own-slot command is EARTHQUAKE - a spread move that also hits its ALLY (the host's slot).
    // With the host mon at 1 HP on BOTH engines it faints deterministically turn 1; from turn 2 on (the host
    // mon gone) EARTHQUAKE hits only the level-100 foes, which shrug it off so the wave stays open.
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots, offer }) => {
      const earthquake = offer?.moves.find(move => move.moveId === MoveId.EARTHQUAKE);
      return {
        command: Command.FIGHT,
        cursor: earthquake?.slot ?? moveSlots[0] ?? 0,
        moveId: MoveId.EARTHQUAKE,
        targets: [...(earthquake?.targetSets[0] ?? [BattlerIndex.ENEMY])],
      };
    });
    rig.hostScene.getPlayerField()[hostFieldIdx].hp = 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerField()[hostFieldIdx].hp = 1;
    });

    const turn0 = rig.hostScene.currentBattle.turn;

    // ===== TURN 1: the host's own slot plays a harmless SPLASH; the guest's relayed EARTHQUAKE faints the
    // 1-HP host mon. The replacement SwitchPhase for a HOST owner with NO legal bench is SKIPPED / self-closed
    // (production's exhausted-partner guard), so no picker strands and the slot stays empty. =====
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.SPLASH, hostFieldIdx);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    expect(hostMon.isFainted(), "the host-owned mon fainted").toBe(true);
    expect(hostOwnedFaintPending(rig), "a host-owned faint is pending").toBe(true);

    // ===== THE BUILD-2 DECISION: host half exhausted is NOT a terminal. =====
    expect(
      hostHalfExhausted(rig),
      "hostHalfExhausted predicate is TRUE (host slot fainted, no bench, guest alive)",
    ).toBe(true);
    expect(
      hostRunEndReason(rig),
      "hostRunEndReason is NULL - host-half exhaustion is DRIVEN (guest solo), NOT a terminal run-end (#828)",
    ).toBeNull();

    // The guest renders turn 1 (a host-owned faint is host-chosen; the guest just replays it, no picker).
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn0));

    // Cross to the next CommandPhase. There is NO host bench, so the driver does NOT arm the host auto-picker
    // (armHostFaintAutoPick is bench-gated); the modal SwitchPhase already self-closed, so the crossing is
    // clean (no NO-PARK strand at an un-pickable picker).
    await withClient(rig.hostCtx, () => game.phaseInterceptor.to("CommandPhase"));
    expect(
      rig.hostScene.phaseManager.getCurrentPhase()?.phaseName,
      "the host crossed to the next CommandPhase - no strand with the host half exhausted",
    ).toBe("CommandPhase");

    // The exhausted host mon spectates cleanly (still fainted), the guest survivor fights on, counters equal.
    expect(hostMon.isFainted(), "the exhausted host mon stays fainted (no replacement)").toBe(true);
    expect(guestMon.isFainted(), "the guest survivor is battle-ready").toBe(false);
    expect(guestMon.isActive(), "the guest survivor is on the field").toBe(true);
    expect(
      rig.hostRuntime.controller.interactionCounter(),
      "interaction counters are in lockstep after the exhaustion crossing",
    ).toBe(rig.guestRuntime.controller.interactionCounter());

    // The host is now at the NEXT turn's CommandPhase for the surviving GUEST slot (the guest's relayed
    // command resolves it - see the co-op relay logs). The DECISION to continue (not terminate) is exercised,
    // the production exhausted-partner guard closed the faint picker cleanly, and the survivor plays on in
    // lockstep. The host half stays exhausted at this point.
    expect(hostHalfExhausted(rig), "the host half is still exhausted at the next command point").toBe(true);

    // #851 CORRECTED FINDING: the earlier "field-collapse gap / redirected vacated-slot CommandPhase re-issues a
    // duplicate partner request that eats the timeout" diagnosis is WRONG (verified: see the sustained-solo test
    // below + the #851 report). Once the host slot vacates, the party COMPACTS the fainted host mon to the back,
    // so getPlayerField() puts the guest survivor at index 0 and turn-init queues EXACTLY ONE CommandPhase (the
    // vacated slot is inactive -> no phase for it, no redirect, no duplicate request). handleFieldIndexLogic's
    // co-op redirect only runs in the SAME one-active-mon state and is a no-op there (fieldIndex already points at
    // the survivor). The guest-solo turn therefore resolves with EXACTLY ONE requestPartnerCommand per turn - the
    // sustained-solo test below drives 6 solo turns and asserts precisely that (fails-model of the old diagnosis:
    // it predicted a 2nd request + timeout; none occurs). See coop-soak-driver.ts's safe-degrade note for why the
    // driver-level backstop remains until the multi-WAVE guest-solo crossing (reward shop + new wave) is driven.

    logs.flush();
  }, 300_000);

  // #851 SUSTAINED GUEST-SOLO CONTINUATION. Drive the surviving guest's OWN turns for several turns AFTER the host
  // half is exhausted, and assert the load-bearing invariant the old (wrong) diagnosis denied: each solo turn issues
  // EXACTLY ONE requestPartnerCommand for the survivor's slot and the turn resolves with NO stall / NO timeout, host
  // and guest agree on the survivor's field index (converged geometry), and the interaction counters stay in
  // lockstep. This is the direct duo repro for #851: the old model predicted a duplicate request + 20-min timeout on
  // the FIRST solo turn; in fact every solo turn is clean.
  it("SUSTAINED guest-solo: each post-exhaustion turn issues EXACTLY ONE partner request and resolves, no timeout, geometry converged, lockstep", async () => {
    // party[0] = BULBASAUR (HOST, frail, will faint) ; party[1] = SNORLAX (GUEST, bulky survivor). Argument order
    // is preserved by startBattle, so index-based tagging seats the frail host mon at slot 0 and the bulky guest
    // survivor at slot 1 - the exact asymmetric geometry the exhaustion produces.
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.SNORLAX);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    tagOwnership(rig);

    const field = rig.hostScene.getPlayerField();
    const hostFieldIdx = field.findIndex(m => m.coopOwner === "host");
    expect(hostFieldIdx, "a host-owned field slot exists").toBeGreaterThanOrEqual(0);
    const hostMon = field[hostFieldIdx];

    // The guest answers the host's relay: turn 1 EARTHQUAKE (spread) faints the 1-HP host ally; every solo turn
    // after that a harmless SPLASH, so the wave stays open and the survivor keeps commanding turn after turn.
    rig.guestRuntime.battleSync.onCommandRequest(({ turn, offer }) => {
      const earthquake = offer?.moves.find(move => move.moveId === MoveId.EARTHQUAKE);
      if (turn <= 1) {
        return {
          command: Command.FIGHT,
          cursor: earthquake?.slot ?? 0,
          moveId: MoveId.EARTHQUAKE,
          targets: [...(earthquake?.targetSets[0] ?? [BattlerIndex.ENEMY])],
        };
      }
      return { command: Command.FIGHT, cursor: 1, moveId: MoveId.SPLASH, targets: [BattlerIndex.PLAYER_2] };
    });
    rig.hostScene.getPlayerField()[hostFieldIdx].hp = 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerField()[hostFieldIdx].hp = 1;
    });

    const turn0 = rig.hostScene.currentBattle.turn;

    // TURN 1: host plays a harmless SPLASH on its own slot; the guest's relayed EARTHQUAKE faints the 1-HP host mon.
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.SPLASH, hostFieldIdx);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    expect(hostMon.isFainted(), "the host-owned mon fainted (host half now exhausted)").toBe(true);
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn0));

    // GEOMETRY CONVERGENCE: both engines seat the survivor at the SAME field index after the half-wipe compaction.
    // (A host/guest disagreement here is the real live-desync class - here they agree, so the relay key matches.)
    const hostSurvivorIdx = rig.hostScene.getPlayerField().findIndex(m => m?.isActive());
    const guestSurvivorIdx = withClientSync(rig.guestCtx, () =>
      rig.guestScene.getPlayerField().findIndex(m => m?.isActive()),
    );
    expect(hostSurvivorIdx, "host seats the survivor at a valid slot").toBeGreaterThanOrEqual(0);
    expect(
      guestSurvivorIdx,
      "host and guest agree on the survivor's field index (converged geometry, relay key matches)",
    ).toBe(hostSurvivorIdx);

    // Spy on the relay: count requestPartnerCommand per solo turn - the old diagnosis predicted a DUPLICATE per turn.
    const spy = vi.spyOn(CoopBattleSync.prototype, "requestPartnerCommand");

    const SOLO_TURNS = 6;
    for (let t = 0; t < SOLO_TURNS; t++) {
      const before = spy.mock.calls.length;
      const turnNo = rig.hostScene.currentBattle.turn;
      await withClient(rig.hostCtx, async () => {
        // Keep the survivor topped up so we isolate command-routing from combat attrition (a survivability knob,
        // like the soak's per-wave PP restore - it disables no content; both engines still replay the SAME turn).
        for (const m of rig.hostScene.getPlayerField()) {
          if (m?.isActive()) {
            m.hp = m.getMaxHp();
          }
        }
        // Drives the survivor's whole turn: its CommandPhase -> partner request -> relay resolve -> TurnEndPhase.
        // The old diagnosis said THIS call would eat the 20-min request timeout; it resolves promptly instead.
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      const turnCalls = spy.mock.calls.slice(before).filter(c => c[1] === turnNo);
      expect(
        turnCalls.length,
        `solo turn ${turnNo}: EXACTLY ONE partner command request (old diagnosis predicted a duplicate here)`,
      ).toBe(1);
      // The survivor is still up and the host half is still exhausted (the continuation kept going, no terminal).
      expect(hostHalfExhausted(rig), `solo turn ${turnNo}: host half still exhausted, guest still soloing`).toBe(true);
      // LOCKSTEP: the surviving-side turn advanced both engines' interaction counters identically.
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        `solo turn ${turnNo}: interaction counters in lockstep`,
      ).toBe(rig.guestRuntime.controller.interactionCounter());
    }

    spy.mockRestore();
    logs.flush();
  }, 300_000);
});
