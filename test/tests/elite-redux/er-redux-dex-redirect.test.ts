/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Redux dex redirect (#410): catching a vanilla mon wearing the REDUX form
// must register the RDX custom species ("Spearow Redux"), NOT stamp the
// vanilla species' gen slot (the live "Spearow Redux replaced gen 1 Spearow"
// hijack). Already-hijacked saves are migrated on load: the redux unlock moves
// to the RDX entry, the vanilla slot reverts, candies follow when redux was
// the only caught form. Gated behind ER_SCENARIO=1.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { getErReduxCounterpartId, migrateErReduxDexHijack } from "#data/elite-redux/er-redux-dex-redirect";
import { AbilityId } from "#enums/ability-id";
import { DexAttr } from "#enums/dex-attr";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER redux-form dex redirect (#410)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  const spearowReduxId = () => allSpecies.find(sp => sp.speciesId >= 10000 && sp.name === "Spearow Redux")!.speciesId;
  const spearowReduxFormIndex = () => getPokemonSpecies(SpeciesId.SPEAROW).forms.findIndex(f => f.formKey === "redux");

  it("maps vanilla+redux-form to the RDX counterpart, and nothing else", () => {
    expect(spearowReduxFormIndex()).toBeGreaterThan(0);
    expect(getErReduxCounterpartId(SpeciesId.SPEAROW, "redux")).toBe(spearowReduxId());
    // The vanilla DEFAULT form and species without a redux line never redirect.
    expect(getErReduxCounterpartId(SpeciesId.SPEAROW, "")).toBeUndefined();
    expect(getErReduxCounterpartId(SpeciesId.MEW, "redux")).toBeUndefined();
  });

  it("catching a redux-form Spearow registers Spearow Redux, NOT vanilla Spearow", async () => {
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const gameData = game.scene.gameData;
    const customId = spearowReduxId();
    gameData.dexData[SpeciesId.SPEAROW].caughtAttr = 0n;
    gameData.dexData[customId].caughtAttr = 0n;

    // Retarget the live battle mon to a redux-form Spearow (constructing or
    // starter-loading a fresh Spearow hangs headless on its asset chain).
    const mon = game.scene.getPlayerPokemon()!;
    mon.species = getPokemonSpecies(SpeciesId.SPEAROW);
    mon.formIndex = spearowReduxFormIndex();
    await gameData.setPokemonCaught(mon, true, false, false);

    expect(gameData.dexData[customId].caughtAttr).not.toBe(0n);
    expect(gameData.dexData[customId].caughtAttr & DexAttr.DEFAULT_FORM).toBe(DexAttr.DEFAULT_FORM);
    expect(gameData.dexData[SpeciesId.SPEAROW].caughtAttr).toBe(0n);
  });

  it("migrates an already-hijacked save: redux-only vanilla entry reverts, RDX entry + candies take over", () => {
    const gameData = game.scene.gameData;
    const customId = spearowReduxId();
    const reduxBit = DexAttr.DEFAULT_FORM << BigInt(spearowReduxFormIndex());

    // Hijacked state: ONLY the redux form caught on vanilla Spearow, red shiny.
    gameData.dexData[SpeciesId.SPEAROW].caughtAttr = DexAttr.MALE | DexAttr.SHINY | DexAttr.VARIANT_3 | reduxBit;
    gameData.dexData[SpeciesId.SPEAROW].seenAttr = gameData.dexData[SpeciesId.SPEAROW].caughtAttr;
    gameData.dexData[customId].caughtAttr = 0n;
    gameData.starterData[SpeciesId.SPEAROW].candyCount = 9;
    gameData.starterData[customId].candyCount = 0;

    migrateErReduxDexHijack(gameData);

    // The RDX entry absorbed the red shiny + candies...
    const dest = gameData.dexData[customId];
    expect(dest.caughtAttr & DexAttr.SHINY).toBe(DexAttr.SHINY);
    expect(dest.caughtAttr & DexAttr.VARIANT_3).toBe(DexAttr.VARIANT_3);
    expect(gameData.starterData[customId].candyCount).toBe(9);
    // ...and the vanilla gen slot reverted to uncaught.
    expect(gameData.dexData[SpeciesId.SPEAROW].caughtAttr).toBe(0n);
    expect(gameData.starterData[SpeciesId.SPEAROW].candyCount).toBe(0);

    // Re-running is a no-op (keyed on the removed redux bit).
    migrateErReduxDexHijack(gameData);
    expect(gameData.starterData[customId].candyCount).toBe(9);
  });

  it("a save that caught BOTH forms keeps the vanilla slot and only sheds the redux bit", () => {
    const gameData = game.scene.gameData;
    const customId = spearowReduxId();
    const reduxBit = DexAttr.DEFAULT_FORM << BigInt(spearowReduxFormIndex());

    gameData.dexData[SpeciesId.SPEAROW].caughtAttr =
      DexAttr.MALE | DexAttr.NON_SHINY | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM | reduxBit;
    gameData.dexData[customId].caughtAttr = 0n;
    gameData.starterData[SpeciesId.SPEAROW].candyCount = 5;
    gameData.starterData[customId].candyCount = 0;

    migrateErReduxDexHijack(gameData);

    // Vanilla keeps its genuine catch (default form), candies stay put.
    const vanilla = gameData.dexData[SpeciesId.SPEAROW];
    expect(vanilla.caughtAttr & DexAttr.DEFAULT_FORM).toBe(DexAttr.DEFAULT_FORM);
    expect(vanilla.caughtAttr & reduxBit).toBe(0n);
    expect(gameData.starterData[SpeciesId.SPEAROW].candyCount).toBe(5);
    // The RDX entry still gains the unlock.
    expect(gameData.dexData[customId].caughtAttr).not.toBe(0n);
  });
});
