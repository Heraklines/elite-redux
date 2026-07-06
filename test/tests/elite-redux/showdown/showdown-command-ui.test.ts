/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 GUEST command menu (C5) - live handler drive, ER_SCENARIO / GameManager.
// Proves the interactive menu reads the guest's OWN team (authoritatively the ENEMY side) and
// SHIPS the confirmed pick as the correct SerializedCommand via the caller's onCommand (the relay
// seam). No engine logic in the handler - the host validates authoritatively (proven separately).
//   - FIGHT: root->Fight->move-slot ships { FIGHT, cursor=slot, moveId=<that move>, target PLAYER }.
//   - SWITCH: root->Switch->benched mon ships { POKEMON, cursor=partyIndex }.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import type { SerializedCommand } from "#data/elite-redux/coop/coop-transport";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { ShowdownCommandUiHandler } from "#ui/showdown-command-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const mon = (over: Partial<ShowdownMonManifest>): ShowdownMonManifest => ({
  speciesId: SpeciesId.CHARIZARD,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset: [MoveId.TACKLE, MoveId.EMBER, MoveId.GROWL, MoveId.LEER],
  item: "LEFTOVERS",
  rootSpeciesId: SpeciesId.CHARMANDER,
  erBlackShiny: false,
  baseCost: 4,
  ...over,
});

async function runToShowdownCommand(
  game: GameManager,
  own: ShowdownMonManifest[],
  opponent: ShowdownMonManifest[],
  playerSpecies: SpeciesId[],
): Promise<void> {
  await game.runToTitle();
  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
    beginShowdownBattle(own, opponent);
    const starters = generateStarters(game.scene, playerSpecies);
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    new SelectStarterPhase().initBattle(starters);
  });
  await game.phaseInterceptor.to("CommandPhase");
}

describe.skipIf(!RUN)("Showdown guest command menu (C5v2c)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    endShowdownBattle();
  });

  /**
   * Open the SHOWDOWN_COMMAND handler over the current battle's ENEMY side (the guest's own team),
   * capturing every shipped command. Returns the handler + the capture array.
   */
  function openMenu(): { handler: ShowdownCommandUiHandler; shipped: SerializedCommand[] } {
    const shipped: SerializedCommand[] = [];
    const handler = game.scene.ui.handlers[UiMode.SHOWDOWN_COMMAND] as ShowdownCommandUiHandler;
    handler.show([{ turn: 1, onCommand: (_turn, command) => shipped.push(command) }]);
    return { handler, shipped };
  }

  it("FIGHT: root -> Fight -> move slot ships the matching move id, targeting PLAYER", async () => {
    // The enemy party (built from the opponent manifest) IS the guest's own team here.
    const own: ShowdownMonManifest[] = [mon({ speciesId: SpeciesId.CHARIZARD })];
    const opponent: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.CHARIZARD, moveset: [MoveId.TACKLE, MoveId.EMBER, MoveId.GROWL, MoveId.LEER] }),
    ];
    await runToShowdownCommand(game, own, opponent, [SpeciesId.CHARIZARD]);

    const activeMoves = game.scene.getEnemyField()[0].getMoveset();
    const { handler, shipped } = openMenu();

    handler.processInput(Button.ACTION); // root: Fight
    handler.processInput(Button.ACTION); // fight: move slot 0

    expect(shipped).toHaveLength(1);
    expect(shipped[0]).toMatchObject({
      command: Command.FIGHT,
      cursor: 0,
      moveId: activeMoves[0].moveId,
      targets: [BattlerIndex.PLAYER],
    });
  });

  it("FIGHT: DOWN navigates to the second move slot before confirming", async () => {
    const own: ShowdownMonManifest[] = [mon({ speciesId: SpeciesId.CHARIZARD })];
    const opponent: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.CHARIZARD, moveset: [MoveId.TACKLE, MoveId.EMBER, MoveId.GROWL, MoveId.LEER] }),
    ];
    await runToShowdownCommand(game, own, opponent, [SpeciesId.CHARIZARD]);

    const activeMoves = game.scene.getEnemyField()[0].getMoveset();
    const { handler, shipped } = openMenu();

    handler.processInput(Button.ACTION); // root: Fight
    handler.processInput(Button.DOWN); // fight: slot 0 -> slot 2 (grid is linear here: next enabled)
    handler.processInput(Button.ACTION);

    expect(shipped).toHaveLength(1);
    // The cursor advanced to a later slot; the shipped moveId matches that slot's move.
    expect(shipped[0].command).toBe(Command.FIGHT);
    expect(shipped[0].moveId).toBe(activeMoves[shipped[0].cursor].moveId);
    expect(shipped[0].cursor).toBeGreaterThan(0);
  });

  it("SWITCH: root -> Switch -> benched mon ships a POKEMON command for that party slot", async () => {
    const own: ShowdownMonManifest[] = [mon({ speciesId: SpeciesId.CHARIZARD })];
    const opponent: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.CHARIZARD }),
      mon({ speciesId: SpeciesId.BLASTOISE, rootSpeciesId: SpeciesId.SQUIRTLE, item: "FOCUS_BAND" }),
    ];
    await runToShowdownCommand(game, own, opponent, [SpeciesId.CHARIZARD]);

    const { handler, shipped } = openMenu();

    handler.processInput(Button.DOWN); // root: Fight -> Switch
    handler.processInput(Button.ACTION); // enter switch level
    handler.processInput(Button.ACTION); // pick the first ENABLED bench mon (party index 1)

    expect(shipped).toHaveLength(1);
    expect(shipped[0]).toMatchObject({ command: Command.POKEMON, cursor: 1, baton: false });
  });

  it("shipped latch: a re-entrant confirm after shipping does NOT double-ship", async () => {
    const own: ShowdownMonManifest[] = [mon({ speciesId: SpeciesId.CHARIZARD })];
    const opponent: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.CHARIZARD, moveset: [MoveId.TACKLE, MoveId.EMBER, MoveId.GROWL, MoveId.LEER] }),
    ];
    await runToShowdownCommand(game, own, opponent, [SpeciesId.CHARIZARD]);

    const { handler, shipped } = openMenu();
    handler.processInput(Button.ACTION); // root: Fight
    handler.processInput(Button.ACTION); // fight: ship slot 0
    // Extra confirms after the command was already shipped must be ignored (latch).
    handler.processInput(Button.ACTION);
    handler.processInput(Button.ACTION);

    expect(shipped).toHaveLength(1);
  });
});
