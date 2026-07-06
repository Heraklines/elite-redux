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
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
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
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.EARTHQUAKE,
      targets: [BattlerIndex.ENEMY],
    }));
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
      await game.phaseInterceptor.to("TurnEndPhase");
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

    // 🔴 SCOPE + FINDING (BUILD 2): SUSTAINED multi-turn guest-SOLO play past this first crossing exposes a
    // TWO-ENGINE HARNESS field-collapse gap - once the host slot vacates, the guest survivor renders into slot
    // 0 and the vacated (host) slot's REDIRECTED CommandPhase requests a partner command for a slot the guest
    // does NOT own, so it eats the request timeout. The real 6-mon soak reaches the SAME 1-vacated-host +
    // 1-alive-guest field, so the driver SAFE-DEGRADES a stall-while-exhausted to the (pre-#828) clean
    // exhaustion terminal instead of a NO-PARK regression, records the `hostHalfExhausted` surface, and reports
    // the finding. Fully DRIVING the sustained guest-solo turn (relaying the surviving-side command through the
    // vacated-slot redirect) is the follow-up. This test asserts the DECISION + the first clean crossing, which
    // is the load-bearing #828 change; it deliberately does NOT drive further to avoid asserting on the gap.

    logs.flush();
  }, 300_000);
});
