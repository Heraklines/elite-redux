/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// FRONTIER 4 - the LAGGED guest's parked CommandPhase strands a late REPLACEMENT_COMMIT checkpoint
// (journey run 29870821425, ref ci/coop/fix-frontier3, faint-replacement two-browser journey).
//
// THE LIVE BUG (guest seat public-ui-trace.jsonl): the guest's OWN mon faints turn 1; it picks its
// replacement and RELAYS the choice. Its local engine then races ahead through TurnInit -> CommandPhase
// and PARKS that command on its V2 command frontier ("parked local CommandPhase until ordered
// command-open") BEFORE the host's authoritative REPLACEMENT_COMMIT arrives. TurnInit's pre-command
// replacement probe (pendingAuthoritativeReplacementTurn) therefore saw NOTHING pending and let the
// command open. ~18s later the host's REPLACEMENT_COMMIT (rev=3, reason=replacement checkpoint for the
// post-summon turn) finally lands: it is buffered ONCE and then stays "materialDeferred ... awaiting live
// completion" FOREVER, because there is NO consumer for it - no CoopReplayTurnPhase pump is parked, and
// the parked CommandPhase had subscribed to nothing. The command-open that would release the parked
// command is ordered AFTER rev=3 and so can never admit. Pure hang: the guest never reaches turn 2, the
// host waits at the turn-2 rendezvous 155s+, the journey fails "turn-2-first-move: timed out".
//
// THE FIX (command-phase.ts + coop-runtime.ts): while an authoritative-guest CommandPhase is PARKED it
// subscribes to CoopBattleStreamer.onCheckpointEnvelope. When a retained REPLACEMENT carrier for this turn
// lands, the parked command dissolves itself into the SAME CoopReplayTurnPhase route TurnInit's
// pre-command deferral would have taken (pendingCoopAuthoritativeReplacementReplayTurn) - retracting its
// stale deferred-command entry first - and that replay applies + checksum-verifies + finalizes the
// replacement, unblocking the deferred authority revision and opening the real command.
//
// WHAT THIS TEST PINS (and why not the full phase dissolve): it drives two REAL engines to the exact
// stranded state - the host's OWN faint (slot 0) summons LAPRAS and admits its retained REPLACEMENT_COMMIT,
// which the LAGGED guest BUFFERS but has no consumer for while its own alive slot-1 command would park -
// then asserts the fix's single decision signal: pendingCoopAuthoritativeReplacementReplayTurn() (the one
// source of truth TurnInit's pre-command deferral AND command-phase.ts's parked-command re-trigger both
// consult) routes that buffered carrier into a replay turn. The parked-command PHASE dissolve cannot be
// stepped in-harness because the two-engine harness drives the V2 replacement through the shadow WITHOUT
// negotiating the V2 REPLACEMENT cutover, so isCoopV2ReplacementCutoverActive() (the gate that path shares)
// is off - which is EXACTLY why this class slips the harness. The end-to-end RED->GREEN is the public-UI
// journey (journey=faint-replacement): pre-fix the guest hangs at "material revision N is awaiting live
// completion"; post-fix the guest trace shows "guest parked command dissolves into retained replacement
// replay" -> ACK materialApplied -> the guest advances off the strand (verified on run 29878928360).
//
// HOW TO RUN (gated ER_SCENARIO=1 + COOP_AUTHORITY_V2_REPLACEMENT=on, like the live journey build):
//   ER_SCENARIO=1 COOP_AUTHORITY_V2_REPLACEMENT=on npx vitest run \
//     test/tests/elite-redux/coop/coop-duo-frontier4.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import {
  CoopV2ReplacementCutover,
  isCoopV2ReplacementCutoverActive,
  setActiveCoopV2ReplacementCutover,
} from "#data/elite-redux/coop/authority-v2/cutover-replacement";
import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { setCoopFaintSwitchWaitMs } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  clearCoopRuntime,
  getCoopBattleStreamer,
  getCoopController,
  getCoopV2Shadow,
  pendingCoopAuthoritativeReplacementReplayTurn,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
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
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The host auto-picks party slot 2 (LAPRAS, the first legal host bench) as its own faint replacement. */
const HOST_PICK_SLOT = 2;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO Frontier 4: a parked guest CommandPhase must not strand a late REPLACEMENT_COMMIT checkpoint",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`frontier4-${Date.now()}`);
      setCoopFaintSwitchWaitMs(4000);
      game.override
        .battleStyle("double")
        .startingWave(1)
        // The lvl-100 foes' spread EARTHQUAKE faints the 1-HP HOST lead (SNORLAX, slot 0) but is a hard 0
        // against the guest's Fire/FLYING lead (CHARIZARD, slot 1 - Ground-immune), so the guest keeps an
        // ALIVE own-slot mon whose turn-2 command PARKS while the host's slot-0 replacement is the late
        // carrier. The foes themselves survive the players' harmless SPLASH -> a continuing wave.
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(100)
        .enemyMoveset(MoveId.EARTHQUAKE)
        .startingLevel(50)
        .moveset([MoveId.SPLASH])
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopFaintSwitchWaitMs(60_000);
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

    it("routes a stranded late replacement checkpoint into a replay turn (the parked-command dissolve signal)", async () => {
      // Party: SNORLAX (slot 0 = HOST lead), CHARIZARD (slot 1 = GUEST lead, Fire/FLYING = Ground-immune),
      // LAPRAS + GENGAR = the HOST's bench (buildDuo tags slots >=2 host-owned). The host summons LAPRAS.
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.CHARIZARD, SpeciesId.LAPRAS, SpeciesId.GENGAR);
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Pin explicit slot ownership on BOTH engines: slot 0 (SNORLAX) + the bench (LAPRAS/GENGAR) are the
      // HOST's (so its own faint takes the OWNER PARTY-picker path the auto-pick drives, and LAPRAS is a
      // legal host bench); slot 1 (CHARIZARD) is the GUEST's alive own command.
      for (const scene of [rig.hostScene, rig.guestScene]) {
        scene.getPlayerParty()[0].coopOwner = "host";
        scene.getPlayerParty()[1].coopOwner = "guest";
        scene.getPlayerParty()[2].coopOwner = "host";
        scene.getPlayerParty()[3].coopOwner = "host";
      }

      // Only the HOST lead is fragile; the guest's Ground-immune CHARIZARD stays alive on the field.
      rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
      });

      const turn = rig.hostScene.currentBattle.turn;

      // TURN 1 (host): both leads SPLASH (harmless); the foes' EARTHQUAKE faints the 1-HP SNORLAX (slot 0)
      // and is a hard 0 vs the Ground-immune CHARIZARD (slot 1). Stop at CoopTurnCommitPhase - BEFORE the
      // post-turn faint crossing summons the host's replacement - so no REPLACEMENT_COMMIT exists yet.
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.SPLASH, COOP_HOST_FIELD_INDEX);
        game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      const hostLead = rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
      expect(hostLead == null || hostLead.isFainted(), "the HOST lead (slot 0) fainted to the foes' EARTHQUAKE").toBe(
        true,
      );
      expect(
        rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX]?.isFainted(),
        "the GUEST lead (Ground-immune CHARIZARD, slot 1) is ALIVE - its turn-2 own command will park",
      ).toBe(false);

      // GUEST renders turn 1 (no own-faint picker - the HOST's mon fainted, not the guest's) and advances to
      // its next TurnInitPhase (turn 2), CHARIZARD still alive on slot 1.
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn, { sealRetainedWaveBoundary: false });
      });

      // HOST runs the post-turn faint crossing: auto-picks LAPRAS, summons it into slot 0, and admits the
      // retained REPLACEMENT_COMMIT (rev bumped, reason=replacement checkpoint). The loopback drain delivers
      // that authority to the guest, so the guest's control frontier is now the REPLACEMENT (NOT a
      // command-open) and the checkpoint material is buffered but not yet consumed - the exact live state in
      // which the guest's next command must PARK (its ordered command-open cannot admit until the
      // replacement finalizes). PhaseInterceptor keeps the guest's own queue un-started, so the checkpoint
      // stays buffered rather than being drained by the guest's TurnInit deferral.
      await withClient(rig.hostCtx, async () => {
        // The HOST's own faint opens its OWNER picker (UiMode.PARTY on the host); stub the ONE PARTY open to
        // pick LAPRAS (party slot 2, the first legal host bench) so the crossing summons it + ships the
        // retained REPLACEMENT_COMMIT (the same faithful setMode-stub the guest picker tests use). Drive the
        // host only as far as its turn-2 TurnInitPhase: AFTER the summon + checkpoint but BEFORE the host's
        // turn-2 CommandPhase rendezvous barrier (which would await the guest we deliberately leave parked).
        const ui = rig.hostScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
        const realSetMode = ui.setMode.bind(ui);
        ui.setMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.PARTY) {
            ui.setMode = realSetMode; // one-shot
            const opened = realSetMode(...args);
            Promise.resolve(opened).then(
              () => {
                queueMicrotask(() => (args[3] as (slotIndex: number, option: number) => void)(HOST_PICK_SLOT, 0));
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
          await game.phaseInterceptor.to("TurnInitPhase");
          await drainLoopback();
        } finally {
          ui.setMode = realSetMode;
        }
      });
      // Deliver the retained authority to the guest: alternate both contexts so the loopback fully flushes
      // the summon + REPLACEMENT_COMMIT frames into the guest's streamer.
      for (let i = 0; i < 4; i++) {
        await withClient(rig.guestCtx, () => drainLoopback());
        await withClient(rig.hostCtx, () => drainLoopback());
      }
      expect(
        rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX]?.species.speciesId,
        "the HOST summoned its bench replacement (LAPRAS) into slot 0 and admitted its replacement authority",
      ).toBe(SpeciesId.LAPRAS);

      // The guest has BUFFERED the replacement checkpoint but not consumed it: a stranded checkpoint whose
      // ONLY consumer boundary is the guest's next command. This is the exact deadlock precondition.
      const bufferedState = withClientSync(rig.guestCtx, () => {
        const bt = rig.guestScene.currentBattle.turn;
        const cp = getCoopBattleStreamer()?.peekCheckpointForTurn(bt);
        return {
          buffered: cp != null,
          checkpointReason: cp?.reason,
          cpEpoch: cp?.epoch,
          ctrlEpoch: getCoopController()?.sessionEpoch,
          battleTurn: bt,
        };
      });
      expect(bufferedState.buffered, "the guest buffered the host's retained REPLACEMENT_COMMIT checkpoint").toBe(true);
      expect(bufferedState.checkpointReason, "the stranded carrier is a replacement checkpoint").toBe("replacement");
      expect(bufferedState.cpEpoch, "the buffered carrier is addressed to the guest's own session").toBe(
        bufferedState.ctrlEpoch,
      );

      // THE FIX'S EXACT DECISION SIGNAL. A parked guest CommandPhase dissolves into a replacement replay iff
      // pendingCoopAuthoritativeReplacementReplayTurn() (the single source of truth TurnInit's pre-command
      // deferral and command-phase.ts's parked-command re-trigger both consult) reports this turn. Assert it
      // does for the exact stranded carrier just buffered.
      //
      // Why the parked-command PHASE dissolve itself isn't driven here: production negotiates the V2
      // REPLACEMENT cutover, but the two-engine harness drives the V2 replacement through the shadow WITHOUT
      // that negotiation, so isCoopV2ReplacementCutoverActive() - the gate BOTH the deferral AND the fix share
      // - is off in-harness (precisely why the harness structurally MASKS this class, as the brief notes). We
      // arm the exact production gate over the SAME shadow that admitted rev=3 (the gate only checks the
      // cutover's presence) and assert the shared probe fires. The full parked-command -> dissolve -> replay
      // -> finalize -> command-open path is the public-UI journey's RED->GREEN (journey=faint-replacement):
      // pre-fix the guest stalls forever at "material revision N is awaiting live completion"; post-fix the
      // trace shows "guest parked command dissolves into retained replacement replay" -> materialApplied ->
      // the guest advances.
      const probe = withClientSync(rig.guestCtx, () => {
        const shadow = getCoopV2Shadow(rig.guestRuntime);
        if (shadow != null) {
          setActiveCoopV2ReplacementCutover(new CoopV2ReplacementCutover(shadow));
        }
        return {
          gateArmed: isCoopV2ReplacementCutoverActive() && isCoopAuthoritativeGuestGated(),
          replayTurn: pendingCoopAuthoritativeReplacementReplayTurn(),
          battleTurn: rig.guestScene.currentBattle.turn,
        };
      });
      expect(
        probe.gateArmed,
        "the exact production gate (replacement cutover + authoritative guest) is armed for the seam",
      ).toBe(true);
      expect(
        probe.replayTurn,
        "the shared replacement-replay probe routes the parked command into a replay for the guest's turn",
      ).toBe(probe.battleTurn);

      logs.flush();
    }, 240_000);
  },
);
