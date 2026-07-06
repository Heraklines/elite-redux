import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { ShopCursorTarget } from "#enums/shop-cursor-target";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Regression for #853 ("Page freezes completely after shop" / "Evil Nugget
 * corrupts game").
 *
 * When the player's "Shop cursor target" setting is `Shop`, the reward screen
 * auto-moves the cursor onto the shop row when it opens. On a wave whose shop row
 * is EMPTY while the mode still has a shop enabled (a x10 boss wave, or a biome
 * whose rule suppresses the heal row), `shopOptionsRows` is empty, so
 * `setRowCursor(SHOP)` -> `getRowItems(SHOP)` dereferences `shopOptionsRows.at(-1)`
 * (undefined) and throws. The throw happens inside the `show()` `.then()` chain, so
 * it surfaces as an unhandled rejection (NO console error) and `awaitingActionInput`
 * is never set: the reward screen renders but never accepts input -> silent
 * soft-lock ("the page froze"), with the last console line being the shop-option
 * generation. The report's item (nugget / big golden-ball shop) is incidental.
 */
describe("Reward shop - Shop cursor target with an empty shop row (#853)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      // WASTELAND's biome rule suppresses the vanilla reward heal row (`shopNoHeal`),
      // so on this ordinary (non-x10) wave the SelectModifierPhase opens with an EMPTY
      // shop row while `getShopStatus()` is still true -> hasShop true but
      // shopOptionsRows empty, the exact trigger (a x10 wave instead opens the ER biome
      // market, a different handler).
      .startingBiome(BiomeId.WASTELAND)
      .startingWave(7)
      .startingLevel(200)
      .enemySpecies(SpeciesId.VOLTORB)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
  });

  it("stays interactive (no soft-lock) when Shop is the cursor target but the wave has no shop items", async () => {
    // Reproduce the exact user setting that triggers the freeze.
    game.scene.shopCursorTarget = ShopCursorTarget.SHOP;

    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();

    // Before the fix this hangs: the reward screen never sets awaitingActionInput,
    // so the queued CANCEL never fires and the phase never advances (times out).
    await game.toNextWave();

    // Reaching here at all proves the reward screen became interactive and advanced.
    expect(game.scene.currentBattle.waveIndex).toBe(8);

    const handler = game.scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
    // The shop row really was empty on that wave (the trigger condition held).
    expect(handler.shopOptionsRows.length).toBe(0);
  });
});
