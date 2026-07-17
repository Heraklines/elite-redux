/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// PROBE #809 (matrix probe 2): in-battle FORM-CHANGE convergence across two engines.
//
// MEGA half - UNREACHABLE (by ER design, not a harness gap). ER megas are PERMANENT, evolution-like
// forms: a mon spawns straight INTO its mega form (formIndex "mega") and it sticks at summon - there is NO
// in-battle "mega-evolve" toggle (no stone/bracelet activation, no Command.MEGA in the command enum, no
// MegaEvolutionPhase). See the ER project notes ("Megas are permanent here ... no stone/bracelet/manual-
// evolve") + the Command enum (FIGHT/BALL/POKEMON/RUN/TERA/SHIFT - no MEGA). So "a stone-carrier mon
// mega-evolves IN battle" is not a state a co-op run can reach: the form is fixed at summon and already
// carried by the launch mirror (adoptCoopHostRunConfig) + the per-turn checkpoint's speciesId/form hash.
// There is nothing in-battle to converge. This probe therefore covers the REACHABLE sibling:
//
// TERA half - the in-battle form change ER DOES support. A Command.TERA flips the mon's Terastallized
// state + tera type mid-turn (the coop command broadcast carries the TERA flag, #633 Fix #4a; the checksum
// hashes isTerastallized + teraType, #633 GAP 7). This probe teras the HOST-OWNED lead in battle and
// asserts the GUEST (pure renderer) mirrors the form change - isTerastallized + teraType byte-identical -
// and the two engines' post-turn checksum states CONVERGE, with the forced-resync count bounded (the
// broadcast + checkpoint carry the tera state, so no resync storm).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-tera-convergence.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { checksumState } from "#data/elite-redux/coop/coop-battle-checksum";
import { captureCoopChecksumState } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type CoopResyncProbe,
  type DuoRig,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO in-battle TERA: the guest mirrors the host lead's terastallization, byte-identical, bounded resync (#809)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;
    let resyncProbe: CoopResyncProbe | undefined;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`tera-convergence-${Date.now()}`);
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
      resyncProbe?.restore();
      resyncProbe = undefined;
      logs.dispose();
      clearCoopRuntime();
      // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    /** Wire the guest's OWN-slot command answer (the genuine production CoopBattleSync relay). */
    function wireGuestCommand(rig: DuoRig): void {
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.TACKLE,
        targets: [BattlerIndex.ENEMY_2],
      }));
    }

    it("the host lead terastallizes in battle; the guest mirrors isTerastallized + teraType and converges", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Baseline: neither engine's host lead is terastallized before the turn.
      expect(rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX].isTerastallized, "host lead not tera pre-turn").toBe(
        false,
      );
      withClientSync(rig.guestCtx, () => {
        expect(
          rig.guestScene.getPlayerField()[COOP_HOST_FIELD_INDEX].isTerastallized,
          "guest's mirror of the host lead not tera pre-turn",
        ).toBe(false);
      });

      resyncProbe = installCoopResyncProbe(rig.guestRuntime);
      const turn = rig.hostScene.currentBattle.turn;

      // HOST plays the turn: the HOST-OWNED lead (field 0) TERASTALLIZES as it attacks (Command.TERA, which
      // the coop command broadcast carries to the watcher); the guest-owned slot TACKLEs via the relay.
      await withClient(rig.hostCtx, async () => {
        game.move.selectWithTera(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
        game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });

      // The host lead DID terastallize (the form change actually happened - not a vacuous green).
      const hostLead = rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
      expect(hostLead.isTerastallized, "host: the lead terastallized in battle").toBe(true);
      const hostTeraType = hostLead.teraType;

      // GUEST replays the turn (applies the host checkpoint, which carries the field tera state).
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      // CONVERGENCE: the guest's mirror of the host lead is terastallized to the SAME tera type - the form
      // change was mirrored, not lost.
      withClientSync(rig.guestCtx, () => {
        const guestLead = rig.guestScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
        expect(guestLead.isTerastallized, "guest: mirrored the host lead's terastallization").toBe(true);
        expect(guestLead.teraType, "guest: mirrored the SAME tera type").toBe(hostTeraType);
      });

      // BYTE-LEVEL CONVERGENCE: the two engines' post-turn checksum states (isTerastallized + teraType are
      // hashed, #633 GAP 7) are identical.
      const hostState = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestState = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      expect(checksumState(guestState), "post-turn: the two engines' checksums converge after the tera").toBe(
        checksumState(hostState),
      );

      // BOUNDED RESYNC: the command broadcast + checkpoint carry the tera state, so the guest converges
      // WITHOUT a resync storm (a converged single-turn tera should force at most one).
      expect(
        resyncProbe.count(),
        `the in-battle tera converged with a bounded resync count (got ${resyncProbe.count()})`,
      ).toBeLessThanOrEqual(1);

      logs.flush();
    }, 300_000);
  },
);
