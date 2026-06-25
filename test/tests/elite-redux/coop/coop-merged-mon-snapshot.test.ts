/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op owner-snapshot for merged mons (#633 Fix #3). A merged co-op party gates a SHARED
// mon's active innates + total luck by EACH client's own per-account candy / dex unlocks -
// a divergent per-account state the checkpoint never carried. Fix: snapshot the OWNER's
// per-slot innate passiveAttr + canonical luck onto the per-mon customPokemonData (which
// round-trips through serialization), and read the innate gate + getLuck from that snapshot
// in co-op. Here we verify (1) the snapshot survives a serialize round-trip and (2) in a
// live co-op battle getLuck + innateSlotPassiveAttr read the snapshot, not local account data.

import { getGameMode } from "#app/game-mode";
import { CustomPokemonData } from "#data/pokemon/pokemon-data";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { startLocalCoopSession, clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("co-op merged-mon owner snapshot (#633 Fix #3) - serialize round-trip", () => {
  it("CustomPokemonData carries coopPassiveAttr + coopLuck through a (de)serialize round-trip", () => {
    const original = new CustomPokemonData();
    original.coopPassiveAttr = [3, 1, 0];
    original.coopLuck = 7;

    // The session save serializes via JSON; reconstruct from the plain object (the
    // constructor's Partial<CustomPokemonData> path - exactly how a loaded save rebuilds it).
    const round = new CustomPokemonData(JSON.parse(JSON.stringify(original)));
    expect(round.coopPassiveAttr).toEqual([3, 1, 0]);
    expect(round.coopLuck).toBe(7);
  });

  it("defaults to undefined for a non-co-op mon (solo / all other modes untouched)", () => {
    const fresh = new CustomPokemonData();
    expect(fresh.coopPassiveAttr).toBeUndefined();
    expect(fresh.coopLuck).toBeUndefined();
  });
});

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op merged-mon owner snapshot (#633 Fix #3) - live gate", () => {
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

  it("getLuck reads the owner's snapshot in co-op (not the local dex-derived luck)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);

    const mon = game.scene.getPlayerParty()[0];
    // A divergent local luck (e.g. this client never unlocked the shiny) would read here;
    // the snapshot pins the OWNER's canonical luck instead.
    mon.customPokemonData.coopLuck = 9;
    expect(mon.getLuck()).toBe(9);

    // Outside co-op the snapshot is ignored - the derivation wins (proves the gate).
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    expect(mon.getLuck()).not.toBe(9);
  });

  it("innateSlotPassiveAttr reads the owner's per-slot snapshot in co-op", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);

    const mon = game.scene.getPlayerParty()[0];
    mon.customPokemonData.coopPassiveAttr = [5, 2, 1];
    expect(mon.innateSlotPassiveAttr(0)).toBe(5);
    expect(mon.innateSlotPassiveAttr(1)).toBe(2);
    expect(mon.innateSlotPassiveAttr(2)).toBe(1);
  });
});
