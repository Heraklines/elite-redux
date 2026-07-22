/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE MID-WAVE own-faint replacement command-open release (campaign SURFACE deadlock,
// public run 29944796250 wave 2). Sibling of coop-duo-won-wave-replacement.test.ts: there the wave
// is WON the same turn the guest slot faints (the guest must SUPPRESS a phantom command); HERE the
// wave CONTINUES (surviving enemies), so the guest CORRECTLY opens its refilled slot's next-turn
// CommandPhase - and that command MUST receive its ordered command-open and start.
//
// THE BUG (host + guest browser traces, wave 2): the guest's slot 1 faints turn 1, its own-faint
// picker fills slot 1, and CoopReplayTurnPhase opens the guest's own turn-2 CommandPhase (correct -
// the wave continues). That CommandPhase PARKS on `enterCoopV2CommandControlBoundary` until its
// ordered command-open. The REPLACEMENT_COMMIT states the turn-2 COMMAND_FRONTIER and stamps it
// materialApplied DIRECTLY (bypassing the projectControl proof gate a standalone CONTROL_COMMIT
// command-open rides), so its ONLY release edge is the one-shot releaseCoopV2DeferredCommandStarts
// fired at that materialApplied instant. When the refilled slot's CommandPhase parks on a LATER pump
// (the dissolve -> replay -> finalize chain), that one-shot edge already fired with nothing parked,
// and the park's own proof-retry cannot recover it (the frontier entry is already applied/retired).
// The guest's turn-2 command never starts -> its turn-2 material stays deferred forever -> the guest
// never reaches its wave-2 reward -> never advances its interactionCounter -> the host (which cleared
// the wave and advanced) parks on CoopPartnerSyncPhase awaiting the guest's counter -> hangs.
//
// THE FIX (coop-runtime.ts scheduleCoopV2CommandProofRetry): the park-scheduled proof-retry microtask
// re-fires releaseCoopV2DeferredCommandStarts against the already-materialApplied COMMAND_FRONTIER, so
// a park that missed the one-shot edge is released. It does NOT sign the proof (the released
// CommandPhase still crosses its address-exact V2 boundary + records recordCoopV2CommandControlStarted).
//
// RED before the fix: the guest's turn-2 CommandPhase stays PARKED (never opens command input); the
// parked-command-open log has no following release. GREEN after: the command starts + opens input.
//
// HOW TO RUN (gated ER_SCENARIO=1 + the four V2 CONTROL surfaces on):
//   ER_SCENARIO=1 COOP_AUTHORITY_V2_TURN=on COOP_AUTHORITY_V2_REPLACEMENT=on COOP_AUTHORITY_V2_WAVE=on \
//     COOP_AUTHORITY_V2_INTERACTION=on \
//     npx vitest run test/tests/elite-redux/coop/coop-duo-midwave-replacement-command-open.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  installDuoLogCapture,
  settleDuoPromise,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// The command-open chokepoint only exists when the Authority V2 CONTROL cutover is active, which
// requires the four V2 surfaces enabled at process start (module-level flags read at import).
const V2_CONTROL_ENABLED = ["TURN", "WAVE", "REPLACEMENT", "INTERACTION"].every(
  surface => process.env[`COOP_AUTHORITY_V2_${surface}`] === "on",
);

/** The guest picks party slot 3 (CHARIZARD) as its own faint replacement (a guest-owned bench mon). */
const GUEST_PICK_SLOT = 3;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN || !V2_CONTROL_ENABLED)(
  "co-op DUO mid-wave replacement: the guest's refilled slot receives its ordered command-open and starts (SURFACE deadlock)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      setCoopWaveBarrierMs(50);
      setCoopRendezvousWaitMs(50);
      setCoopFaintSwitchWaitMs(4000);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`midwave-replacement-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(1)
        // TANKY foes: the host lead's spread EARTHQUAKE faints the 1-HP guest ally but the lvl-100
        // Magikarp SURVIVE - the wave CONTINUES, so the guest's refilled slot opens a real turn-2
        // command (the mid-wave branch), unlike the won-wave sibling.
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(100)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(50)
        .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH])
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopFaintSwitchWaitMs(60_000);
      setCoopWaveBarrierMs(60_000);
      resetCoopRendezvousWaitMs();
      logs.dispose();
      clearCoopRuntime();
      initGlobalScene(game.scene);
    });

    /** The guest's own-slot command answer (the genuine production CoopBattleSync relay). */
    function wireGuestCommand(rig: DuoRig): void {
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.SPLASH,
        targets: [BattlerIndex.ENEMY],
      }));
    }

    it("opens the refilled slot's ordered turn-2 command instead of parking it forever", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Guest-owned bench (LAPRAS + CHARIZARD): the guest's faint has an own bench to replace from; the
      // host lead (SNORLAX, slot 0) is the sole host mon and survives (no host faint / auto-pick).
      for (const scene of [rig.hostScene, rig.guestScene]) {
        scene.getPlayerParty()[2].coopOwner = "guest";
        scene.getPlayerParty()[3].coopOwner = "guest";
      }
      rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      });

      const turn = rig.hostScene.currentBattle.turn;

      // TURN 1 (host): SNORLAX EARTHQUAKE (spread) faints the 1-HP guest GENGAR; the lvl-100 Magikarp
      // survive (the wave continues). The guest slot's relayed SPLASH is moot.
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.EARTHQUAKE, COOP_HOST_FIELD_INDEX);
        game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      expect(
        rig.hostScene.getEnemyParty().some(e => e != null && !e.isFainted()),
        "the wave CONTINUES: at least one lvl-100 foe survived EARTHQUAKE (mid-wave, not won-wave)",
      ).toBe(true);
      expect(
        rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX]?.isFainted() ?? true,
        "the guest-owned field slot was vacated by the faint on the host",
      ).toBe(true);

      // GUEST renders turn 1: the faint opens the guest's OWN picker (CoopGuestFaintSwitchPhase). Stub
      // the ONE PARTY open to pick CHARIZARD (slot 3); the relay send + seq keying stay fully real. The
      // pump then reaches the "opening own CommandPhase" mid-wave pivot for the refilled slot.
      await withClient(rig.guestCtx, async () => {
        const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
        const realSetMode = ui.setMode.bind(ui);
        ui.setMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.PARTY) {
            ui.setMode = realSetMode; // one-shot
            const opened = realSetMode(...args);
            Promise.resolve(opened).then(
              () => {
                queueMicrotask(() => (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0));
              },
              () => undefined,
            );
            return opened;
          }
          if (args[0] === UiMode.MESSAGE) {
            return; // the picker's close transition - a no-op headlessly
          }
          return realSetMode(...args);
        };
        try {
          await driveGuestReplayTurn(rig.guestScene, turn, { sealRetainedWaveBoundary: false });
        } finally {
          ui.setMode = realSetMode;
        }
      });

      // HOST: cross into its OWN turn-2 CommandPhase (summon the guest's pick, push the out-of-band
      // replacement checkpoint, author the turn-2 COMMAND_FRONTIER successor). Stop before it starts.
      let hostAdvance: Promise<void> | undefined;
      await withClient(rig.hostCtx, async () => {
        hostAdvance = game.phaseInterceptor.to("CommandPhase", false);
        await drainLoopback();
      });
      expect(hostAdvance, "the host turn-2 crossing was started").toBeDefined();
      await settleDuoPromise(rig, hostAdvance!, "mid-wave replacement host crossing");
      await withClient(rig.hostCtx, () => drainLoopback());
      expect(
        rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX]?.species.speciesId,
        "the HOST summoned the guest's replacement (CHARIZARD)",
      ).toBe(SpeciesId.CHARIZARD);

      // GUEST: drive the turn-2 replay that consumes the retained replacement checkpoint. On a CONTINUING
      // wave the pivot opens the guest's OWN turn-2 CommandPhase for the refilled slot, then parks it until
      // its ordered command-open. Let the natural pump reach + START that command (no manual queue drive),
      // then pump BOTH engines: the command MUST receive its ordered command-open and OPEN input.
      await withClient(rig.guestCtx, async () => {
        rig.guestScene.currentBattle.turn = turn + 1;
        await driveGuestReplayTurn(rig.guestScene, turn + 1);
        const command = rig.guestScene.phaseManager.getCurrentPhase();
        expect(command?.phaseName, "the guest's next boundary is its refilled-slot CommandPhase").toBe("CommandPhase");
        expect(
          (command as unknown as { getFieldIndex(): number }).getFieldIndex(),
          "the parked command is for the guest's own refilled field slot",
        ).toBe(COOP_GUEST_FIELD_INDEX);

        // START the parked command once (the phase-manager shift a browser performs automatically;
        // PhaseInterceptor suppresses it in engine tests) and pump BOTH engines. The refilled slot's
        // command MUST receive its ordered command-open, LEAVE its V2 command-open park, and reach its OWN
        // reciprocal next-command boundary cmd:<wave>:2 - the first thing it does once the park releases.
        //
        // NOTE ON COVERAGE (the won-wave sibling documents this exact class): the synchronous two-engine
        // harness applies the REPLACEMENT_COMMIT's embedded COMMAND_FRONTIER through the park-triggered
        // proof-retry, so its EXISTING release edge fires here and this asserts the release path is intact
        // end-to-end. The production SURFACE deadlock is the async orphan variant - the frontier's ONE-SHOT
        // release edge fires (finalize-driven redelivery) BEFORE the phase-manager shift that starts this
        // command, stranding the park; that ordering is real-browser-timing only (campaign run 29944796250
        // is the RED), and the Item 1 fix adds the park-scheduled re-release edge that recovers it. This
        // duo repro is the natural-path regression guard for that release mechanism.
        command!.start();
        for (let i = 0; i < 80; i++) {
          await drainLoopback();
          await withClient(rig.hostCtx, () => drainLoopback());
          await drainLoopback();
          if (logs.guest.some(l => /rendezvous\] ARRIVE point=cmd:\d+:2 /.test(l))) {
            break;
          }
          await new Promise<void>(resolve => setTimeout(resolve, 5));
        }
      });

      // The guest opened its own turn-2 CommandPhase for the refilled slot (the mid-wave pivot ran).
      expect(
        logs.guest.some(l => /replacement filled OUR slot .* -> opening own CommandPhase/.test(l)),
        "the guest opened its refilled slot's own turn-2 CommandPhase (mid-wave replacement pivot)",
      ).toBe(true);

      // THE CORE INVARIANT (Item 1 fix): the guest's refilled-slot command LEFT its V2 command-open park
      // and reached its OWN reciprocal command boundary (cmd:<wave>:2). RED before the fix: the ordered
      // command-open never releases the park, so the command never reaches this boundary and the guest
      // stalls forever (its turn-2 material stays deferred, its interactionCounter never advances, and the
      // host hangs on CoopPartnerSyncPhase awaiting a counter the guest can no longer reach).
      expect(
        logs.guest.some(l => /rendezvous\] ARRIVE point=cmd:\d+:2 /.test(l)),
        "the guest's refilled-slot command received its ordered command-open, released the V2 park, and "
          + "reached its own turn-2 command boundary (the SURFACE deadlock is cleared)",
      ).toBe(true);

      logs.flush();
    }, 240_000);
  },
);
