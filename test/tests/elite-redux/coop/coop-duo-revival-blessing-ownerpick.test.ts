/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// PROBE #809 (matrix probe 1): REVIVAL BLESSING owner-pick across two engines. When a GUEST-OWNED mon
// uses Revival Blessing IN BATTLE, the fainted-target PICK belongs to the mon's OWNER (the guest), NOT the
// authoritative host. The host's RevivalBlessingPhase (startCoopPartnerPick) sends a `revivalPrompt`, the
// guest's runtime queues a CoopGuestRevivalPhase which opens the real REVIVAL_BLESSING party picker and
// relays the pick under the REVIVAL seq band (COOP_REVIVAL_SEQ_BASE + fieldIndex, #799 carries species
// identity), and the host applies the revive at the relayed slot (identity-resolved). The revive then
// materializes on the guest via the normal per-turn checkpoint (relay-only on the renderer).
//
// This probe proves the OWNER'S pick DROVE the revive (not the host's AI fallback) by fainting TWO
// guest-owned bench mons and having the guest pick the SECOND one: the host's fallback would revive the
// FIRST fainted (slot 2), so a revived slot-3 (BLASTOISE) with slot-2 (CHARIZARD) still fainted is only
// explicable by the relayed owner pick. It then asserts the revived mon lands IDENTICALLY on both engines
// (hp = 50% maxHp, fainted=false, correct bench slot, correct species) with NO phantom summon (a bench
// revive with a living ally must not put the mon on the field) and the two engines CONVERGE.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-revival-blessing-ownerpick.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { checksumState } from "#data/elite-redux/coop/coop-battle-checksum";
import { captureCoopChecksumState } from "#data/elite-redux/coop/coop-battle-engine";
import {
  clearCoopRuntime,
  isCoopV2InteractionHumanInputFrozen,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type CoopResyncProbe,
  drainLoopback,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  pumpDuoDestinations,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The two FAINTED guest-owned bench slots. The guest OWNER picks the SECOND (slot 3), so a revived
 *  slot 3 with slot 2 still fainted proves the relayed pick drove it (the host fallback picks slot 2). */
const FIRST_FAINTED_SLOT = 2; // CHARIZARD - the host AI-fallback target
const OWNER_PICK_SLOT = 3; // BLASTOISE - the guest owner's actual pick

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO Revival Blessing: the mon OWNER picks the revive target, relayed + converged on both engines (#809)",
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
      logs = installDuoLogCapture(`revival-blessing-ownerpick-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(1)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(1)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(50)
        // The guest lead (field 1) uses REVIVAL_BLESSING; the host lead (field 0) TACKLEs.
        .moveset([MoveId.REVIVAL_BLESSING, MoveId.TACKLE, MoveId.SPLASH])
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

    it("a guest-owned mon's Revival Blessing revives the OWNER-PICKED fainted mon identically on both engines", async () => {
      await game.classicMode.startBattle(
        SpeciesId.SNORLAX, // 0 host lead
        SpeciesId.GENGAR, // 1 guest lead (uses Revival Blessing)
        SpeciesId.CHARIZARD, // 2 guest bench (FAINTED - the host fallback target)
        SpeciesId.BLASTOISE, // 3 guest bench (FAINTED - the OWNER'S pick)
      );
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

      // Wire the guest's OWN-slot command answer (the genuine production CoopBattleSync relay). This is the
      // ONLY driver for the guest slot (field 1) - the host resolves it via requestPartnerCommand, NOT the
      // local move.select UI. Revival Blessing is a USER-target move, so the self-target (PLAYER_2, the
      // guest lead's own battler index) must be relayed or the move fizzles (empty targets -> no effect).
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.REVIVAL_BLESSING,
        targets: [BattlerIndex.PLAYER_2],
      }));

      // FAINT both guest-owned bench mons (slots 2 + 3) on BOTH engines + tag them guest-owned.
      for (const scene of [rig.hostScene, rig.guestScene]) {
        for (const slot of [FIRST_FAINTED_SLOT, OWNER_PICK_SLOT]) {
          const mon = scene.getPlayerParty()[slot];
          mon.hp = 0;
          mon.status = null;
          mon.coopOwner = "guest";
        }
      }
      const guestBlastoise = rig.hostScene.getPlayerParty()[OWNER_PICK_SLOT];
      expect(guestBlastoise.species.speciesId, "slot 3 is BLASTOISE").toBe(SpeciesId.BLASTOISE);
      expect(rig.hostScene.getPlayerParty()[FIRST_FAINTED_SLOT].isFainted(), "slot 2 starts fainted").toBe(true);
      expect(rig.hostScene.getPlayerParty()[OWNER_PICK_SLOT].isFainted(), "slot 3 starts fainted").toBe(true);

      resyncProbe = installCoopResyncProbe(rig.guestRuntime);

      const turn = rig.hostScene.currentBattle.turn;

      // ===== (A) HOST: select moves + advance until the RevivalBlessingPhase is CURRENT (not yet run). =====
      // The guest lead's Revival Blessing (a triage move) unshifts RevivalBlessingPhase; we stop BEFORE it
      // so we can start it under controlled cross-ctx conditions (its start() sends the prompt + parks the
      // await; running it via the interceptor would need the guest to answer synchronously).
      await withClient(rig.hostCtx, async () => {
        // ONLY the host slot (field 0) is driven via the local move.select UI; the guest slot (field 1) is
        // resolved by requestPartnerCommand -> onCommandRequest above. A field-1 move.select would leak its
        // queued prompt onto a LATER command phase (found the hard way: it fired on turn 2's host slot).
        game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
        await game.phaseInterceptor.to("RevivalBlessingPhase", false);
      });

      // ===== (B) HOST (SYNC, no microtask flush): start the RevivalBlessingPhase. On the host with a
      // guest-owned user it DIVERTS to startCoopPartnerPick: it sends `revivalPrompt` (queued on the
      // loopback) + registers the await on COOP_REVIVAL_SEQ_BASE+1. We do NOT drain here - draining under
      // the host ctx would deliver the prompt while the HOST runtime is active, and the guest's
      // onRevivalPrompt no-ops unless the GUEST runtime is the live one. =====
      const hostRbp = withClientSync(rig.hostCtx, () => rig.hostScene.phaseManager.getCurrentPhase());
      expect(hostRbp.phaseName, "host stopped at RevivalBlessingPhase").toBe("RevivalBlessingPhase");
      withClientSync(rig.hostCtx, () => {
        hostRbp.start();
      });

      // ===== (C) GUEST: raw revivalPrompt is suppressed after the V2 cutover. Alternate both destination
      // runtimes until the immutable REVIVAL prompt has projected a real current CoopGuestRevivalPhase,
      // completed PARTY setup, and installed the guest owner's physical-input lease. The retired fixture
      // replaced setMode and called its private callback before any of those production boundaries existed.
      // Drive the second fainted bench mon exclusively through ordinary PARTY keyboard input. =====
      let projectedGuestPicker: { phaseName: string; coopV2ControlOperationId?: string | null } | undefined;
      let guestPickerReady = false;
      for (let attempt = 0; attempt < 100 && !guestPickerReady; attempt++) {
        await pumpDuoDestinations(rig, 1);
        guestPickerReady = withClientSync(rig.guestCtx, () => {
          const phase = rig.guestScene.phaseManager.getCurrentPhase() as {
            phaseName: string;
            coopV2ControlOperationId?: string | null;
          };
          const handler = rig.guestScene.ui.getHandler() as unknown as {
            active?: boolean;
            isCoopV2InputActionable?: () => boolean;
          };
          projectedGuestPicker = phase;
          return (
            phase.phaseName === "CoopGuestRevivalPhase"
            && rig.guestScene.ui.getMode() === UiMode.PARTY
            && handler.active === true
            && handler.isCoopV2InputActionable?.() === true
            && !isCoopV2InteractionHumanInputFrozen(rig.guestRuntime)
          );
        });
        if (!guestPickerReady) {
          await withClient(rig.guestCtx, () => new Promise<void>(resolve => setTimeout(resolve, 10)));
        }
      }
      expect(guestPickerReady, "the V2 prompt installed the actionable guest revival picker").toBe(true);
      expect(projectedGuestPicker?.phaseName, "the V2 prompt projected the real guest revival picker").toBe(
        "CoopGuestRevivalPhase",
      );
      expect(
        projectedGuestPicker?.coopV2ControlOperationId,
        "the projected picker is bound to the immutable V2 operation",
      ).toMatch(/^\d+:\d+:REVIVAL:/u);
      withClientSync(rig.guestCtx, () => {
        for (let slot = 0; slot < OWNER_PICK_SLOT; slot++) {
          expect(rig.guestScene.ui.processInput(Button.DOWN), `guest navigates PARTY to slot ${slot + 1}`).toBe(true);
        }
        expect(rig.guestScene.ui.processInput(Button.ACTION), "guest opens the selected mon's PARTY options").toBe(
          true,
        );
        expect(rig.guestScene.ui.processInput(Button.ACTION), "guest chooses Revive through the public PARTY UI").toBe(
          true,
        );
      });

      // ===== (E) HOST: drain so the relayed pick is delivered while the HOST runtime is live -> the host's
      // awaitInteractionChoice resolves UNDER the host ctx -> applyRevive on the HOST scene + end(). Then run
      // the rest of the turn to TurnEndPhase (host lead's tackle, enemy moves, checkpoint emit). =====
      await withClient(rig.hostCtx, async () => {
        for (let i = 0; i < 8; i++) {
          await drainLoopback();
        }
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });

      // ===== (F) GUEST: replay the turn. The ordinary authoritative checkpoint must carry the mutated
      // bench HP/status directly; requiring a checksum mismatch + heavy stateSync here would expose a visible
      // transient desync after every bench revive and make recovery—not convergence—the normal path. =====
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      // ----- ASSERTIONS -----

      // (1) OWNER PICK DROVE IT (not the host AI fallback): the host revived slot 3 (BLASTOISE, the guest's
      // relayed pick) at 50% maxHp; slot 2 (CHARIZARD, the fallback target) is STILL fainted. This is only
      // explicable by the relayed owner pick arriving over the revival seq band - the whole point of #809.
      const hostPicked = rig.hostScene.getPlayerParty()[OWNER_PICK_SLOT];
      const hostFallback = rig.hostScene.getPlayerParty()[FIRST_FAINTED_SLOT];
      const expectedHp = Math.min(Math.floor(0.5 * hostPicked.getMaxHp()), hostPicked.getMaxHp());
      expect(hostPicked.species.speciesId, "host: the revived mon is the OWNER-picked BLASTOISE").toBe(
        SpeciesId.BLASTOISE,
      );
      expect(hostPicked.hp > 0 && !hostPicked.isFainted(), "host: the owner-picked mon is alive").toBe(true);
      expect(hostPicked.hp, "host: the revived mon is at 50% maxHp").toBe(expectedHp);
      expect(
        hostFallback.isFainted(),
        "host: the host-fallback mon (slot 2) is STILL fainted - the relayed OWNER pick, not the fallback, drove the revive",
      ).toBe(true);

      // NO PHANTOM SUMMON on the host: a bench revive (slot > 1) with a LIVING ally must not summon the mon.
      const hostField = rig.hostScene.getPlayerField();
      expect(
        hostField.some(m => m.species.speciesId === SpeciesId.BLASTOISE),
        "host: the revived bench mon was NOT summoned onto the field (no phantom summon)",
      ).toBe(false);

      // (2) DATA-PLANE CONVERGENCE: the revived bench mon is already identical immediately after the normal
      // turn replay—no full snapshot, no heal-masked bug, and no phantom summon.
      withClientSync(rig.guestCtx, () => {
        const guestPicked = rig.guestScene.getPlayerParty()[OWNER_PICK_SLOT];
        const guestFallback = rig.guestScene.getPlayerParty()[FIRST_FAINTED_SLOT];
        expect(guestPicked.species.speciesId, "guest: the revived mon is BLASTOISE (same species, same slot)").toBe(
          SpeciesId.BLASTOISE,
        );
        expect(guestPicked.hp > 0 && !guestPicked.isFainted(), "guest: the owner-picked mon is already alive").toBe(
          true,
        );
        expect(guestPicked.hp, "guest: both engines agree on the revived mon's HP").toBe(hostPicked.hp);
        expect(guestFallback.isFainted(), "guest: the fallback mon (slot 2) is still fainted, same as host").toBe(true);
        const guestField = rig.guestScene.getPlayerField();
        expect(guestField.length, "guest: still a two-slot field (no extra summon)").toBe(2);
        expect(
          guestField.some(m => m.species.speciesId === SpeciesId.BLASTOISE),
          "guest: the revived bench mon was NOT summoned onto the field (no phantom summon)",
        ).toBe(false);
      });

      // BYTE-LEVEL CONVERGENCE: the ordinary checkpoint leaves the checksum states matched immediately.
      const hostState2 = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestState2 = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      expect(guestState2.benchHp, "checkpoint: both engines agree on the full bench hp/fainted vector").toEqual(
        hostState2.benchHp,
      );
      expect(checksumState(guestState2), "checkpoint: the two engines' checksums converge").toBe(
        checksumState(hostState2),
      );
      expect(resyncProbe.count(), "a normal bench revive requires zero forced full-state resyncs").toBe(0);

      logs.flush();
    }, 300_000);
  },
);
