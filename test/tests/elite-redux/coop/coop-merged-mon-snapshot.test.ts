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
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { ER_SHINY_LAB_DEFAULT_PARAMS, encodeErShinyLabPreset } from "#data/elite-redux/er-shiny-lab-effects";
import { CustomPokemonData } from "#data/pokemon/pokemon-data";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { getErShinyLabSpriteFxLookForPokemon } from "#sprites/er-shiny-lab-sprite-fx";
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

// =============================================================================
// Co-op Shiny Lab look sync (#785): each pick carries its OWNER'S equipped look in
// `customPokemonData.erShinyLab` (stamped from the roster starter blob at merge), so the
// partner's client renders the custom shiny effects instead of the default shiny. These pin
// the two substrate guarantees the sync rides on: the look survives the (de)serialize
// round-trip, and the FX lookup PREFERS a carried look / honors the suppress flag.
// =============================================================================
describe("co-op Shiny Lab look sync (#785) - carry + precedence", () => {
  const carriedLook = encodeErShinyLabPreset({
    loadout: { palette: "duoneon", surface: "starmap", around: null },
    params: { ...ER_SHINY_LAB_DEFAULT_PARAMS },
  });

  it("CustomPokemonData carries erShinyLab + name + suppressLocal through a (de)serialize round-trip", () => {
    const original = new CustomPokemonData();
    original.erShinyLab = carriedLook;
    original.erShinyLabName = "Glittering";
    original.erShinyLabSuppressLocal = true;

    const round = new CustomPokemonData(JSON.parse(JSON.stringify(original)));
    expect(round.erShinyLab, "the carried look survives the save/wire round-trip").toEqual(carriedLook);
    expect(round.erShinyLabName).toBe("Glittering");
    expect(round.erShinyLabSuppressLocal).toBe(true);
  });

  it("the FX lookup PREFERS a carried look (the partner's mon renders ITS owner's effects)", () => {
    const look = getErShinyLabSpriteFxLookForPokemon({
      species: { speciesId: 1 },
      shiny: true,
      customPokemonData: { erShinyLab: carriedLook },
    });
    expect(look, "a carried look resolves without any local starter-data").not.toBeNull();
    expect(look?.loadout.palette).toBe("duoneon");
    expect(look?.loadout.surface).toBe("starmap");
  });

  it("suppressLocal blocks the LOCAL per-species lookup on a partner's bare shiny", () => {
    const look = getErShinyLabSpriteFxLookForPokemon({
      species: { speciesId: 1 },
      shiny: true,
      customPokemonData: { erShinyLabSuppressLocal: true },
    });
    expect(look, "no carried look + suppressLocal -> default shiny (never this client's preset)").toBeNull();
  });
});

describe.skipIf(!RUN)("co-op Shiny Lab look sync (#785) - serialize-side lookup (live gate)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    // no per-test teardown needed (shared GameManager pattern in this file's live gate)
  });

  it("getErShinyLabSavedLookForSpecies returns the equipped look from starterData (the roster-carry source)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const { getErShinyLabSavedLookForSpecies } = await import("#sprites/er-shiny-lab-sprite-fx");
    const { grantErShinyLabSavedLookToSave, encodeErShinyLabLoadout } = await import(
      "#data/elite-redux/er-shiny-lab-effects"
    );
    const carried = encodeErShinyLabPreset({
      loadout: { palette: "duoneon", surface: "starmap", around: null },
      params: { ...ER_SHINY_LAB_DEFAULT_PARAMS },
    });
    const entry = game.scene.gameData.getStarterDataEntry(SpeciesId.SNORLAX);
    entry.erShinyLab = {};
    grantErShinyLabSavedLookToSave(entry.erShinyLab, carried);
    entry.erShinyLab.l = encodeErShinyLabLoadout({ palette: "duoneon", surface: "starmap", around: null });

    const look = getErShinyLabSavedLookForSpecies(SpeciesId.SNORLAX, true);
    expect(look, "the serialize-side lookup finds the equipped look (roster carry has a source)").toBeDefined();
  });
});
