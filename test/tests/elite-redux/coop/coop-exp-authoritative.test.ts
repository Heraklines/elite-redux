/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op authoritative EXP (#633 B5). In authoritative co-op the HOST is the sole battle engine; the
// GUEST is a pure renderer whose own `applyPartyExp` (victory-phase.ts) is gated OFF. Previously the
// guest COMPUTED exp itself, so it independently rolled a DIVERGENT exp -> a different level / evolution
// path -> the host's relayed LEARN-MOVE (keyed by party slot) hit a DIFFERENT mon on the guest (the
// live learn-move-on-the-wrong-mon desync). The host now captures each slot's SETTLED post-exp
// exp / level / moveset (in its BattleEndPhase, AFTER the exp/level/evolution chain drained) and streams
// it on a NEW `expResolved` message; the guest adopts it verbatim in its own BattleEndPhase. This
// verifies (1) the wire variant round-trips, (2) capture/apply makes a divergent guest party CONVERGE,
// and (3) the per-slot speciesId GUARD skips a host-evolved slot (leaving it for the resync benchParty).

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import {
  applyCoopAuthoritativeBattleState,
  applyCoopExpDeltas,
  captureCoopExpDeltas,
} from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import {
  broadcastCoopWaveEndState,
  clearCoopRuntime,
  consumeCoopPendingWaveEndState,
  setCoopRuntime,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopExpDelta, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
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
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("co-op authoritative EXP (#633 B5) - wire round-trip", () => {
  it("the expResolved message survives a JSON round-trip byte-identical", () => {
    const deltas: CoopExpDelta[] = [
      { slot: 0, speciesId: 143, exp: 12_345, level: 50, moveset: [{ moveId: 33, ppUsed: 2, ppUp: 0 }] },
      { slot: 1, speciesId: 25, exp: 9_000, level: 44, moveset: [] },
    ];
    const msg: CoopMessage = { t: "expResolved", wave: 12, deltas };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });

  it("an empty-deltas expResolved round-trips (the no-participants / read-failure case)", () => {
    const msg: CoopMessage = { t: "expResolved", wave: 3, deltas: [] };
    const round = JSON.parse(JSON.stringify(msg)) as Extract<CoopMessage, { t: "expResolved" }>;
    expect(round.deltas).toEqual([]);
  });
});

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op authoritative EXP (#633 B5) - live capture/apply convergence", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  it("captureCoopExpDeltas reflects the HOST's settled exp/level/moveset (not a stale snapshot)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const scene = game.scene;

    const mon = scene.getPlayerParty()[0];
    // Stand in for the post-exp settled state the host's BattleEndPhase reads.
    mon.level = 41;
    mon.exp = 123_456;
    mon.calculateStats();

    const deltas = captureCoopExpDeltas();
    expect(deltas.length).toBe(scene.getPlayerParty().length);
    expect(deltas[0].slot).toBe(0);
    expect(deltas[0].speciesId).toBe(mon.species.speciesId);
    expect(deltas[0].level).toBe(41);
    expect(deltas[0].exp).toBe(123_456);
    expect(deltas[0].moveset.length).toBe(mon.getMoveset().length);
  });

  it("B5: a DIVERGENT guest party converges exp/level/moveset to the host's deltas (round-trip)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const scene = game.scene;

    // The HOST's authoritative party (lead + a bench mon that levelled via EXP_SHARE off-field).
    const lead = scene.getPlayerParty()[0];
    const bench = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 30);
    scene.getPlayerParty().push(bench);
    lead.level = 55;
    lead.exp = 200_000;
    bench.level = 31;
    bench.exp = 50_000;
    lead.calculateStats();
    bench.calculateStats();

    const deltas = JSON.parse(JSON.stringify(captureCoopExpDeltas())) as CoopExpDelta[];

    // Diverge the LIVE (guest) party away from the captured authoritative values.
    lead.level = 50;
    lead.exp = 100_000;
    bench.level = 30;
    bench.exp = 10_000;
    lead.calculateStats();
    bench.calculateStats();

    applyCoopExpDeltas(deltas);

    expect(scene.getPlayerParty()[0].level).toBe(55);
    expect(scene.getPlayerParty()[0].exp).toBe(200_000);
    expect(scene.getPlayerParty()[1].level).toBe(31);
    expect(scene.getPlayerParty()[1].exp).toBe(50_000);
  });

  it("B5: a guest mon adopts the host's level-up MOVESET (the move the guest never learned)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const scene = game.scene;
    const mon = scene.getPlayerParty()[0];

    // Host's settled moveset (a level-up move the guest, running no LevelUpPhase, would never learn).
    const hostMoveIds = mon.getMoveset().map(m => m.moveId);
    const delta: CoopExpDelta = {
      slot: 0,
      speciesId: mon.species.speciesId,
      exp: mon.exp,
      level: mon.level,
      moveset: [{ moveId: hostMoveIds[0], ppUsed: 3, ppUp: 1 }],
    };

    applyCoopExpDeltas(JSON.parse(JSON.stringify([delta])));

    const after = scene.getPlayerParty()[0].getMoveset();
    expect(after.length).toBe(1);
    expect(after[0]?.moveId).toBe(hostMoveIds[0]);
    expect(after[0]?.ppUsed).toBe(3);
    expect(after[0]?.ppUp).toBe(1);
  });

  it("B5/B6: a slot whose guest species != the host's evolved species is SKIPPED (left for resync)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const scene = game.scene;
    const mon = scene.getPlayerParty()[0];
    mon.level = 30;
    mon.exp = 40_000;
    mon.calculateStats();

    // The host EVOLVED this slot (different species) and credited the evolved exp/level. The guest
    // (which skips evolution, B6) still has the PRE-evolution species at this slot, so the delta's
    // speciesId guard must SKIP it - never write the host's evolved exp onto the pre-evolution mon.
    const evolvedDelta: CoopExpDelta = {
      slot: 0,
      speciesId: SpeciesId.PIKACHU, // a species the guest's slot-0 mon is NOT
      exp: 999_999,
      level: 99,
      moveset: [],
    };

    applyCoopExpDeltas(JSON.parse(JSON.stringify([evolvedDelta])));

    // Untouched: the guard skipped the slot (the resync benchParty heals species+exp+level together).
    expect(scene.getPlayerParty()[0].level).toBe(30);
    expect(scene.getPlayerParty()[0].exp).toBe(40_000);
  });
});

// =============================================================================
// #838 WAVE-END authoritative capture - the SUCCESSOR to the per-slot exp-delta relay above. The host
// streams the COMPLETE post-exp battle state (whole party as PokemonData) in its BattleEndPhase; the
// GUEST adopts it via ONE id-based full-state apply (applyCoopAuthoritativeBattleState), so its levels /
// exp / learned moves / evolved species converge in the SHOP WINDOW off the same wire the live turns use.
//
// This is the GUARD the soak CANNOT be (the soak driver re-mirrors the guest at each wave START, which
// false-greens any between-wave exp gap). Here TWO real engines run over the loopback: the host plays a
// wave, the guest replays it, then we assert the guest's STALE (pure-renderer, exp gated off) level / exp
// / moveset CONVERGE to the host's the moment the wave-end snapshot is applied - during the shop window,
// BEFORE any wave-start re-mirror, and WITHOUT the exp-delta relay (applyCoopExpDeltas is never called).
// =============================================================================
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

    // ===== GUEST BattleEndPhase branch: adopt the wave-end snapshot via the id-based full-state apply. This
    // is the exact production seam (consume the pending wave-end state, then applyCoopAuthoritativeBattleState)
    // - the exp-delta relay (applyCoopExpDeltas) is NEVER called. =====
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
