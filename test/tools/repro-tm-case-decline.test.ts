/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// REPRO — live tester report: "Game freezes if you use a TM Case on a Pokemon in
// the shop, and then decide to NOT learn that move."
//
// Flow under test: reward shop -> TM Case -> party (ER_TM_CASE_MODIFIER) -> pick a
// FULL-moveset mon -> pick a TM move -> LearnMovePhase asks to replace -> decline
// ("No" then "Yes, stop teaching") -> the queued shop CONTINUATION copy (#25
// back-out safety) must re-open and the run must continue to the next wave.
// A freeze here surfaces as the phase-interceptor timeout naming the stuck phase.
//
//   ER_SCENARIO=1 npx vitest run test/tools/repro-tm-case-decline.test.ts
// =============================================================================

import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("REPRO: TM Case decline in the reward shop must not freeze", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .startingWave(2)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      // A FULL moveset so the TM learn runs the replace/decline prompt chain.
      .moveset([MoveId.TACKLE, MoveId.SPLASH, MoveId.GROWL, MoveId.TAIL_WHIP])
      .itemRewards([{ name: "TM_CASE" }])
      .disableTrainerWaves();
  });

  it("declining the TM Case move returns to the shop and the run continues", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    let shopOpens = 0;
    let sawPartyList = false;
    let declineConfirms = 0;

    // NB: the prompt-handler queue is strictly FIFO - the battle command must be
    // queued BEFORE the shop prompts, in encounter order.
    game.move.select(MoveId.TACKLE);
    await game.doKillOpponents();

    // 1st shop: pick the forced TM Case (option row 0).
    game.onNextPrompt("SelectModifierPhase", UiMode.MODIFIER_SELECT, () => {
      shopOpens++;
      const handler = game.scene.ui.getHandler() as ModifierSelectUiHandler;
      handler.setCursor(0);
      handler.processInput(Button.ACTION);
    });

    // Party: ACTION on the lead opens its compatible-TM move list; ACTION picks the
    // first move (ER_TM_CASE_MODIFIER sub-menu).
    game.onNextPrompt("SelectModifierPhase", UiMode.PARTY, () => {
      sawPartyList = true;
      const handler = game.scene.ui.getHandler() as PartyUiHandler;
      handler.processInput(Button.ACTION); // select the lead mon -> move list
      handler.processInput(Button.ACTION); // pick the first compatible TM move
    });

    // LearnMovePhase asks "Should a move be forgotten?" -> NO (CANCEL).
    game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
      declineConfirms++;
      game.scene.ui.getHandler().processInput(Button.CANCEL);
    });
    // "Stop trying to teach?" -> YES (ACTION, cursor defaults to Yes).
    game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
      declineConfirms++;
      game.scene.ui.getHandler().processInput(Button.ACTION);
    });

    // The #25 continuation copy re-opens the shop: take nothing and continue.
    game.onNextPrompt("SelectModifierPhase", UiMode.MODIFIER_SELECT, () => {
      shopOpens++;
      const handler = game.scene.ui.getHandler() as ModifierSelectUiHandler;
      handler.processInput(Button.CANCEL); // -> "skip items?" confirm
    });
    // Confirm the skip (leave the shop) -> advance to the next wave.
    game.onNextPrompt("SelectModifierPhase", UiMode.CONFIRM, () => {
      game.scene.ui.getHandler().processInput(Button.ACTION);
    });

    // A freeze anywhere in the chain times out here with the stuck phase + UI mode
    // named by the interceptor.
    await game.phaseInterceptor.to("SelectModifierPhase");
    await game.phaseInterceptor.to("CommandPhase");

    expect(sawPartyList, "the TM Case opened the party move list").toBe(true);
    expect(declineConfirms, "both decline confirms were driven").toBeGreaterThanOrEqual(2);
    expect(shopOpens, "the shop re-opened after the decline (#25 continuation)").toBeGreaterThanOrEqual(2);
    expect(game.scene.currentBattle.waveIndex, "the run advanced to the next wave").toBe(3);
  }, 120000);
});
