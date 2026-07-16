/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE "a player runs out of Pokemon" faint-replacement CLOSE (live seed
// 5ncYiLOw1a4JQZ0MAzWA1izj wave 3, both parties down to ~2 live mons). When a player's ENTIRE half is
// fainted (no legal same-owner replacement) and that player's field slot faints, the owner's forced
// FAINT_SWITCH picker opens with NO selectable option - every non-fainted party mon is either fainted
// (blocked by FilterNonFainted) or the PARTNER's (blocked by coopSwitchFilter) - and the modal cannot be
// cancelled, so the owner is STUCK FOREVER in the choose menu ("when your partner runs out of pokemon the
// game waits forever"). The host's own SwitchPhase never resolves and the turn crossing hangs.
//
// THE FIX (switch-phase.ts OWNER branch): detect no-legal-same-owner replacement (coopAutoPickReplacement()
// < 0) BEFORE opening the modal picker; relay a NO-PICK sentinel + CLOSE the phase, leaving the slot empty
// so the battle continues with the surviving partner (asymmetric field, #828). If BOTH halves are wiped the
// pre-existing modal-impossibility guard ends without a picker and the faint flow reaches game-over.
//
// This repro drives the HOST's real SwitchPhase for its OWN slot with the host's whole half wiped: pre-fix
// it hangs on to("CommandPhase") (the modal picker never resolves); post-fix the host crosses to the next
// CommandPhase with slot 0 left EMPTY and the guest's surviving lead still on-field, ZERO forced resyncs.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-half-wiped.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type CoopResyncProbe,
  type DuoRig,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  presentedFieldMon,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO half-wiped: a player out of Pokemon closes the faint picker (no stuck-in-menu stall)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;
    let accuracySpy: MockInstance | undefined;
    let resyncProbe: CoopResyncProbe | undefined;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      // Force-hit so the enemy's ROCK_SLIDE (90% acc) reliably KOs the 1-HP host lead (the framework
      // clamps the accuracy roll to a guaranteed miss for any sub-100 move). A determinism knob.
      accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
      setCoopWaveBarrierMs(50);
      // Bounded host wait so a genuine STRAND surfaces as a to("CommandPhase") hang rather than sitting 60s.
      setCoopFaintSwitchWaitMs(4000);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`half-wiped-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(1)
        // A SLOW tanky foe so the host lead moves first (harmless SPLASH) then the foe's ROCK_SLIDE KOs it.
        .enemySpecies(SpeciesId.SHUCKLE)
        .enemyLevel(100)
        .enemyMoveset(MoveId.ROCK_SLIDE)
        .startingLevel(50)
        .moveset([MoveId.SPLASH, MoveId.EARTHQUAKE])
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopWaveBarrierMs(60_000);
      setCoopFaintSwitchWaitMs(60_000);
      accuracySpy?.mockRestore();
      accuracySpy = undefined;
      resyncProbe?.restore();
      resyncProbe = undefined;
      logs.dispose();
      clearCoopRuntime();
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    /** The guest's own-slot command answer (harmless SPLASH; the foe's ROCK_SLIDE does the KOing). */
    function wireGuestCommand(rig: DuoRig): void {
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.SPLASH,
        targets: [COOP_HOST_FIELD_INDEX + 2],
      }));
    }

    it("host's whole half wiped: its own faint closes the picker, run continues with the guest (no stall, no resync)", async () => {
      // A full SIX-mon party, host EVEN slots / guest ODD (the soak's 3-per-player ownership).
      await game.classicMode.startBattle(
        SpeciesId.GENGAR, // 0 host  (FRAIL lead at 1 HP; the foe KOs it - host is then OUT)
        SpeciesId.SNORLAX, // 1 guest (BULKY lead; SURVIVES the spread ROCK_SLIDE - the guest fights on)
        SpeciesId.LAPRAS, // 2 host  (bench - pre-fainted)
        SpeciesId.CHARIZARD, // 3 guest (bench - alive)
        SpeciesId.BLASTOISE, // 4 host  (bench - pre-fainted)
        SpeciesId.VENUSAUR, // 5 guest (bench - alive)
      );
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Tag party-slot ownership on BOTH engines (host EVEN, guest ODD).
      for (const scene of [rig.hostScene, rig.guestScene]) {
        const party = scene.getPlayerParty();
        for (let i = 0; i < party.length; i++) {
          party[i].coopOwner = i % 2 === 0 ? "host" : "guest";
        }
      }

      // WIPE the HOST's whole bench (slots 2 + 4) on BOTH engines, and put the host lead (slot 0) at 1 HP,
      // so when the foe KOs it the host has NO legal same-owner replacement (its half is entirely fainted).
      for (const scene of [rig.hostScene, rig.guestScene]) {
        for (const benchSlot of [2, 4]) {
          const mon = scene.getPlayerParty()[benchSlot];
          mon.hp = 0;
          // FaintPhase-free KO: mirror the fainted-bench state the two engines are set up to reconcile.
          mon.status = null;
        }
      }
      rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
      });

      const turn = rig.hostScene.currentBattle.turn;
      resyncProbe = installCoopResyncProbe(rig.guestRuntime);

      // TURN 1 on the HOST: the host lead SPLASHes (harmless); the foe's spread ROCK_SLIDE KOs the 1-HP host
      // lead (the guest lead, full HP, shrugs it off). Drive to TurnEndPhase - the host-owned replacement
      // SwitchPhase opens after, with the host's whole half wiped (no legal same-owner bench).
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.SPLASH, COOP_HOST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      const hostLead = rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
      expect(hostLead == null || hostLead.isFainted(), "the HOST-owned lead fainted this turn").toBe(true);
      const guestLead = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(guestLead != null && !guestLead.isFainted(), "the GUEST-owned lead survived (the run continues)").toBe(
        true,
      );

      // THE PATH UNDER TEST: cross to the next CommandPhase. The host-owned SwitchPhase opens with NO legal
      // same-owner replacement. PRE-FIX it opens the modal FAINT_SWITCH picker whose only mons are fainted or
      // partner-owned (all blocked) and NEVER resolves -> this to() TIMES OUT (the stuck-in-menu stall).
      // POST-FIX the phase closes itself (relays a no-pick + super.end()), so the host crosses cleanly.
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("CommandPhase");
      });
      // The host reached the next turn's command flow (with slot 0 now empty the host has no own mon to
      // command, so EnemyCommandPhase is a legal stop) - what matters is it is NOT parked on SwitchPhase /
      // the modal party picker. PRE-FIX this to() TIMES OUT (the picker never resolves).
      expect(
        ["CommandPhase", "EnemyCommandPhase"].includes(rig.hostScene.phaseManager.getCurrentPhase()?.phaseName ?? ""),
        "the host crossed into the next turn's command flow - the wiped-half faint picker CLOSED (no stuck-in-menu stall)",
      ).toBe(true);

      // The host slot (0) got NO replacement (the fainted mon stays at party[0], off-field, no summon); the
      // guest's lead still holds slot 1.
      const hostSlot0 = presentedFieldMon(rig.hostScene, COOP_HOST_FIELD_INDEX);
      expect(
        hostSlot0 == null || hostSlot0.fainted,
        "the wiped host slot got no replacement (that player is out) - it holds the fainted mon, not a fresh summon",
      ).toBe(true);
      expect(
        presentedFieldMon(rig.hostScene, COOP_GUEST_FIELD_INDEX)?.speciesId,
        "the guest's lead still occupies its slot - the battle continues asymmetric (#828)",
      ).toBe(SpeciesId.SNORLAX);

      // GUEST replays turn 1 + converges: its lead survives on slot 1, the host slot is empty on the guest too.
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });
      withClientSync(rig.guestCtx, () => {
        expect(
          presentedFieldMon(rig.guestScene, COOP_GUEST_FIELD_INDEX)?.speciesId,
          "the guest sees its own lead still on-field",
        ).toBe(SpeciesId.SNORLAX);
        const hostSlot = presentedFieldMon(rig.guestScene, COOP_HOST_FIELD_INDEX);
        expect(
          hostSlot == null || hostSlot.fainted,
          "the guest sees the wiped host slot as empty/fainted (converged with the host)",
        ).toBe(true);
      });

      // ZERO forced resyncs across the wiped-half faint crossing (a resync is a player-facing divergence).
      expect(resyncProbe.count(), "the wiped-half faint close forced NO resync").toBe(0);

      logs.flush();
    }, 240_000);
  },
);
