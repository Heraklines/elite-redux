/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op WAVE-END authoritative capture (#838). In authoritative co-op the HOST is the sole battle
// engine; the GUEST is a pure renderer whose own `applyPartyExp` (victory-phase.ts) is gated OFF.
// Previously the guest COMPUTED exp itself, so it independently rolled a DIVERGENT exp -> a different
// level / evolution path -> the host's relayed LEARN-MOVE (keyed by party slot) hit a DIFFERENT mon on
// the guest (the live learn-move-on-the-wrong-mon desync). The host now captures the COMPLETE post-exp
// battle state (whole party as PokemonData, in its BattleEndPhase AFTER the exp/level/evolution chain
// drained) and streams it on a `waveEndState` message; the GUEST adopts it via ONE id-based full-state
// apply (applyCoopAuthoritativeBattleState), so its levels / exp / learned moves / evolved species
// converge in the SHOP WINDOW off the same wire the live turns use. (The legacy per-slot `expResolved`
// exp-delta relay this superseded - and its unit tests - have been removed.)
//
// This is the GUARD the soak CANNOT be (the soak driver re-mirrors the guest at each wave START, which
// false-greens any between-wave exp gap). Here TWO real engines run over the loopback: the host plays a
// wave, the guest replays it, then we assert the guest's STALE (pure-renderer, exp gated off) level / exp
// / moveset CONVERGE to the host's the moment the wave-end snapshot is applied - during the shop window,
// BEFORE any wave-start re-mirror.

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { applyCoopAuthoritativeBattleState } from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import {
  broadcastCoopWaveEndState,
  clearCoopRuntime,
  consumeCoopPendingWaveEndState,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  resetCoopWaveAdvanceOperationFlag,
  setCoopWaveAdvanceOperationEnabled,
} from "#data/elite-redux/coop/coop-wave-operation";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { PokemonMove } from "#moves/pokemon-move";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  drainLoopback,
  driveGuestReplayTurn,
  installDuoLogCapture,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op WAVE-END authoritative capture (#838) - guest converges in the shop window", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // This file pins the explicitly negotiated legacy raw compatibility arm. P33 production correctness is
    // covered by the retained wave-transaction suites and deliberately ignores waveEndState.
    setCoopWaveAdvanceOperationEnabled(false);
    setCoopWaveBarrierMs(50);
    setCoopRendezvousWaitMs(50);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`waveend-${Date.now()}`);
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
    resetCoopWaveAdvanceOperationFlag();
    setCoopWaveBarrierMs(60_000);
    resetCoopRendezvousWaitMs();
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: buildDuo builds a 2nd BattleScene (the guest) which steals globalScene.
    initGlobalScene(game.scene);
  });

  it("the host's WAVE-END snapshot converges the guest's stale level / exp / learned move (no exp-delta relay)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    // Wire the guest's OWN-slot command answer (the genuine production CoopBattleSync relay).
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));

    // ===== Host plays wave 1 to a win; the guest replays it (both now on the just-won field = shop window). =====
    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("TurnEndPhase");
    });
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));

    // ===== Stage the host lead's SETTLED post-exp state, exactly as the exp/level chain would leave it =====
    // BEFORE the host's BattleEndPhase emits: a level-up, credited exp, and a level-up MOVE the guest (which
    // runs no LevelUpPhase) would never learn on its own.
    const hostLead = rig.hostScene.getPlayerParty()[0];
    const learnedMoveId = MoveId.HYPER_BEAM; // not in the starting [TACKLE, SPLASH] moveset
    withClientSync(rig.hostCtx, () => {
      hostLead.level = 60;
      hostLead.exp = 300_000;
      hostLead.moveset = [new PokemonMove(MoveId.TACKLE), new PokemonMove(learnedMoveId)];
      hostLead.calculateStats();
    });
    const hostLevel = hostLead.level;
    const hostExp = hostLead.exp;
    const hostMoveIds = hostLead.getMoveset().map(m => m.moveId);

    // The guest holds the SAME mon by Pokemon.id (the mirror is a PokemonData round-trip) but is STALE:
    // still level 50 with no HYPER_BEAM - the exact between-wave divergence a shop window would show.
    const guestLeadBefore = rig.guestScene.getPlayerParty().find(p => p.id === hostLead.id);
    expect(guestLeadBefore, "the guest holds the host lead by Pokemon.id (id-based apply premise)").toBeDefined();
    expect(guestLeadBefore!.level, "guest lead level is STALE before the wave-end apply").toBeLessThan(hostLevel);
    expect(
      guestLeadBefore!.getMoveset().some(m => m.moveId === learnedMoveId),
      "guest lead lacks the host's level-up move before the wave-end apply",
    ).toBe(false);

    // ===== HOST BattleEndPhase emit: stream the WAVE-END authoritative snapshot (post-exp). =====
    await withClient(rig.hostCtx, async () => {
      broadcastCoopWaveEndState();
      await drainLoopback();
    });
    // The two-engine harness now delivers state carriers only while their destination scene is installed,
    // matching separate browser realms. Admit the pending wave-end image under the guest context first.
    await withClient(rig.guestCtx, () => drainLoopback());

    // ===== GUEST BattleEndPhase branch: adopt the wave-end snapshot via the id-based full-state apply. This
    // is the exact production seam (consume the pending wave-end state, then applyCoopAuthoritativeBattleState)
    // - the sole post-battle progression channel. =====
    const applied = withClientSync(rig.guestCtx, () =>
      applyCoopAuthoritativeBattleState(consumeCoopPendingWaveEndState() ?? undefined, true),
    );
    expect(applied, "the guest applied the host's wave-end authoritative snapshot").toBe(true);

    // ===== CONVERGED in the shop window: same mon by id, same level / exp, and the host's level-up move learned. =====
    const guestLeadAfter = rig.guestScene.getPlayerParty().find(p => p.id === hostLead.id);
    expect(
      guestLeadAfter,
      "the guest still holds the host lead by id after the apply (mutated in place)",
    ).toBeDefined();
    expect(guestLeadAfter!.level, "guest lead level converged to the host's post-exp level").toBe(hostLevel);
    expect(guestLeadAfter!.exp, "guest lead exp converged to the host's credited exp").toBe(hostExp);
    expect(
      guestLeadAfter!.getMoveset().map(m => m.moveId),
      "guest lead learned the host's level-up moveset (the move it never ran a LevelUpPhase for)",
    ).toEqual(hostMoveIds);
    logs.flush();
  }, 240_000);
});
