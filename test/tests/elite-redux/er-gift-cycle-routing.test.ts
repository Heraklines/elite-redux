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
import { applyErBlackShinyKit, isErBlackShiny, isErGiftCycleAllowed } from "#data/elite-redux/er-black-shinies";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { SummaryUiHandler } from "#ui/summary-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Page.ABILITIES is module-local (value 1) in summary-ui-handler. */
const SUMMARY_PAGE_ABILITIES = 1;
/** Three distinct gift choices so the pinned gift slot is deterministic. */
const GIFT_CHOICES: [AbilityId, AbilityId, AbilityId] = [AbilityId.STURDY, AbilityId.LEVITATE, AbilityId.INTIMIDATE];

/**
 * Whitebox view of the summary handler's gift-badge state under test. We drive
 * `populatePageContainer(..., Page.ABILITIES)` directly (the proven pattern from
 * summary-ui-3-passive-slots.test.ts) rather than the full show() transition, so
 * the ABILITIES render runs deterministically against our bound mon.
 */
type SummaryGiftBadgeInternals = {
  pokemon: unknown;
  giftCycleBadge: Phaser.GameObjects.Sprite | null;
  abilitiesRows: { ability: { id: AbilityId; name: string } }[];
  summaryPageContainer: Phaser.GameObjects.Container;
  populatePageContainer(pageContainer: Phaser.GameObjects.Container, page?: number): void;
};

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

  // ER (#349 follow-up): the "R" key-badge sprite (keyboard atlas, same idiom as the
  // Omniform F badge) must be drawn on the GIFT row so keyboard players SEE the binding.
  // It is gated on the conditional UI being present: a player-owned black shiny's gift
  // row. A normal mon has no gift row, so no badge.
  it("draws the R gift-cycle key-badge for a player black shiny's gift row", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon();
    expect(mon).toBeDefined();
    applyErBlackShinyKit(mon!);
    mon!.customPokemonData.erBlackShiny = true;
    mon!.customPokemonData.erGiftAbilities = [...GIFT_CHOICES];
    mon!.customPokemonData.erGiftIndex = 0;

    expect(isErBlackShiny(mon), "setup must flag the lead as a black shiny").toBe(true);

    const summary = game.scene.ui.handlers[UiMode.SUMMARY] as unknown as SummaryGiftBadgeInternals;
    summary.pokemon = mon;
    summary.populatePageContainer(summary.summaryPageContainer, SUMMARY_PAGE_ABILITIES);

    // The gift row is the extra 5th slot beyond the main ability + innates.
    expect(summary.abilitiesRows.length, "a gift row must be present for a black shiny").toBeGreaterThanOrEqual(2);
    // The R key-badge is only ever created inside the player gift-row branch, so a
    // non-null badge is proof the conditional gift-cycle prompt rendered.
    expect(summary.giftCycleBadge, "the R key-badge must be drawn for a player black shiny").not.toBeNull();
  });

  it("draws NO gift-cycle badge for a normal (non-black-shiny) mon", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon();
    expect(mon).toBeDefined();

    const summary = game.scene.ui.handlers[UiMode.SUMMARY] as unknown as SummaryGiftBadgeInternals;
    summary.pokemon = mon;
    summary.populatePageContainer(summary.summaryPageContainer, SUMMARY_PAGE_ABILITIES);

    // No gift row for a normal mon, so the badge is absent.
    expect(summary.giftCycleBadge, "a normal mon must have no gift-cycle badge").toBeNull();
  });
});
