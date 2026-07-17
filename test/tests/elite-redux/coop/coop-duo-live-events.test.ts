/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op LIVE per-event stream (#633 bounded-scope #3, animation layer). The duo harness used to
// exercise ONLY the turn-end BATCH path: the host's live-event emitter (setCoopLiveEmitter) is a
// PROCESS-GLOBAL that whichever runtime wired LAST owns, and in the harness that is the GUEST runtime, whose
// emitter self-gates to a no-op (role != host) - so no `battleEvent` ever streamed and only the turn-end
// `turnResolution` batch was tested.
//
// setCoopHarnessLiveEvents(true) makes the per-client swap install the ACTIVE runtime's role-gated live
// emitter (installCoopRuntimeLiveEmitter), so during a HOST pump the HOST's emitter is live -> each visible
// event (moveUsed / hp / faint) is streamed the INSTANT the host records it, over the REAL loopback (the
// same `battleEvent` framing the WebRTC path uses), with a per-turn monotonic seq. The guest's streamer
// buffers them by (turn, seq) and its CoopReplayTurnPhase CONSUMES them (merged + de-duped against the batch)
// at the turn boundary. This test drives that real path and asserts: the host EMITTED per-event HP updates
// mid-turn, the GUEST SAW them live, the guest CONSUMED them in its replay, and both engines CONVERGED.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-live-events.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";
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
  setCoopHarnessLiveEvents,
  withClient,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO live events: host emits per-event, guest applies + converges (#633)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`live-events-${Date.now()}`);
    // Turn ON the LIVE per-event stream for this file's duo swaps (default OFF).
    setCoopHarnessLiveEvents(true);
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
    // Restore the default (OFF) so the live stream never leaks into other coop/ files (isolate:false).
    setCoopHarnessLiveEvents(false);
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

  it("host streams per-event HP/move/faint LIVE mid-turn; the guest buffers, consumes + converges", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // HOST side: spy on the wire emit (each visible event streamed the instant it is recorded).
    const emitSpy = vi.spyOn(CoopBattleStreamer.prototype, "emitEvent");
    // GUEST side: collect every LIVE `battleEvent` the guest RECEIVES (fires the instant one lands, before
    // the turn-end batch) - proof the per-event stream reached the guest over the real loopback.
    const guestLiveSeen: { turn: number; seq: number; kind: CoopBattleEvent["k"] }[] = [];
    rig.guestRuntime.battleStream.onLiveEvent((evtTurn, evtSeq, event) => {
      guestLiveSeen.push({ turn: evtTurn, seq: evtSeq, kind: event.k });
    });
    // GUEST side: spy on the turn-boundary CONSUME so we can assert the replay drained the buffered live
    // events (merged + de-duped against the batch) - proof the guest APPLIED the live stream, not just the batch.
    const consumeSpy = vi.spyOn(CoopBattleStreamer.prototype, "consumeLiveEvents");

    // Host plays the wave to a win: the host records moveUsed + hp (drain) + faint events and, because the
    // HOST live emitter is now installed during the host pump, EMITs each over the loopback the instant it
    // is recorded (mid-turn), BEFORE the turn-end `turnResolution` batch.
    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    // (1) HOST EMITTED per-event LIVE: at least one HP update + a move were streamed as `battleEvent`s.
    const emittedKinds = emitSpy.mock.calls.map(c => c[4].k);
    expect(emitSpy.mock.calls.length, "host emitted live battle events over the loopback").toBeGreaterThan(0);
    expect(emittedKinds, "host streamed per-event HP updates mid-turn (the animation layer)").toContain("hp");
    expect(emittedKinds, "host streamed the move-used event mid-turn").toContain("moveUsed");

    // (2) GUEST SAW them LIVE (buffered by the streamer as they arrived over the real loopback).
    expect(guestLiveSeen.length, "guest received the host's live battle events").toBeGreaterThan(0);
    expect(
      guestLiveSeen.map(e => e.kind),
      "guest saw the per-event HP updates live (mid-turn), not only the turn-end batch",
    ).toContain("hp");
    // Live seqs are per-turn monotonic (0,1,2,...) - the ordering the guest replays + de-dupes against.
    const seqsForTurn = guestLiveSeen.filter(e => e.turn === turn).map(e => e.seq);
    expect(seqsForTurn.length, "the guest buffered live events for this turn").toBeGreaterThan(0);
    expect(Math.min(...seqsForTurn), "live seqs start at 0 (per-turn monotonic)").toBe(0);

    // (3) GUEST APPLIED the live stream: its CoopReplayTurnPhase consumed the buffered live events for
    // the turn. Since the #782 INSTANT-STREAMING pump, the primary consumption path is the INCREMENTAL
    // `consumeLiveEventsFrom` (events present the moment they arrive, BEFORE the resolution); the
    // turn-boundary `consumeLiveEvents` only mops up whatever the increments had not drained. Count
    // consumption through EITHER path - what matters is the stream was applied, not just the batch.
    const consumeFromSpy = vi.spyOn(CoopBattleStreamer.prototype, "consumeLiveEventsFrom");
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });
    const consumedBatched = consumeSpy.mock.results
      .map(r => (r.type === "return" ? (r.value as { seq: number }[]) : []))
      .filter(list => list.length > 0);
    const consumedLive = consumeFromSpy.mock.results
      .map(r => (r.type === "return" ? (r.value as unknown[]) : []))
      .filter(list => list.length > 0);
    expect(
      consumedBatched.length + consumedLive.length,
      "the guest's replay consumed the buffered live events (applied the stream, not just the batch)",
    ).toBeGreaterThan(0);

    // (4) CONVERGED: the guest ended on the host-authoritative KOd state (the live stream + checkpoint agree).
    expect(
      rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted()),
      "the guest converged to the host-KOd state after applying the live stream + checkpoint",
    ).toBe(true);

    logs.flush();
  }, 240_000);
});
