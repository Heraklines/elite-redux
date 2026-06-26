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

import { getGameMode } from "#app/game-mode";
import { applyCoopExpDeltas, captureCoopExpDeltas } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import type { CoopExpDelta, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
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
