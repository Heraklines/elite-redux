/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER (#349 follow-up): the R key (Button.CYCLE_SHINY) must reach SummaryUiHandler so
// the Black Shiny GIFT row on the Abilities page can cycle its 3 choices. The handler
// logic + the cycleErGiftAbility data fn already worked; the bug was that ui-inputs.ts
// buttonCycleOption() swallowed R because SummaryUiHandler was missing from its
// whitelist, so the press never reached the handler. This guards that routing.

import type { InputsController } from "#app/inputs-controller";
import { UiInputs } from "#app/ui-inputs";
import { isErGiftCycleAllowed } from "#data/elite-redux/er-black-shinies";
import { Button } from "#enums/buttons";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { SummaryUiHandler } from "#ui/summary-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER R-key gift-cycle routing (#349)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });
  afterAll(() => {
    phaserGame.destroy(true);
  });

  it("forwards R (CYCLE_SHINY) to the active SummaryUiHandler instead of swallowing it", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const summary = game.scene.ui.handlers[UiMode.SUMMARY] as SummaryUiHandler;
    // Pretend the summary is the active screen and capture what the input layer forwards.
    vi.spyOn(game.scene.ui, "getHandler").mockReturnValue(summary);
    const forwarded = vi.spyOn(game.scene.ui, "processInput").mockImplementation(() => true);

    const inputs = new UiInputs({ events: new Phaser.Events.EventEmitter() } as unknown as InputsController);
    inputs.buttonCycleOption(Button.CYCLE_SHINY);

    // With SummaryUiHandler in the buttonCycleOption whitelist, the press is forwarded.
    // Before the fix this was never called (swallowed), so the gift never cycled.
    expect(forwarded).toHaveBeenCalledWith(Button.CYCLE_SHINY);
  });

  it("still does NOT forward CYCLE_SHINY to a non-whitelisted handler (e.g. the message screen)", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const message = game.scene.ui.handlers[UiMode.MESSAGE];
    vi.spyOn(game.scene.ui, "getHandler").mockReturnValue(message);
    const forwarded = vi.spyOn(game.scene.ui, "processInput").mockImplementation(() => true);

    new UiInputs({ events: new Phaser.Events.EventEmitter() } as unknown as InputsController).buttonCycleOption(
      Button.CYCLE_SHINY,
    );

    expect(forwarded).not.toHaveBeenCalled();
  });

  it("the gift may be cycled ONLY out of combat (reward shop), never mid-battle", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const phase = (name: string) =>
      ({ is: (n: string) => n === name }) as unknown as ReturnType<typeof game.scene.phaseManager.getCurrentPhase>;
    const spy = vi.spyOn(game.scene.phaseManager, "getCurrentPhase");

    spy.mockReturnValue(phase("SelectModifierPhase")); // the reward-shop check menu
    expect(isErGiftCycleAllowed()).toBe(true);

    spy.mockReturnValue(phase("CommandPhase")); // mid-combat
    expect(isErGiftCycleAllowed()).toBe(false);
  });
});
