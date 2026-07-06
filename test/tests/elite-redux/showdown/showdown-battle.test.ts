/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 versus BATTLE BOOTSTRAP (C3v2b), ER_SCENARIO-gated / GameManager-driven.
// The host fields the OPPONENT's manifest team as a TRAINER, built verbatim (no BST swap /
// devolve at wave 1, megas kept, exactly the whitelist held items). Asserts: enemy party
// matches the manifest (species / level / item), the battle reaches CommandPhase, and the
// mode is single-wave (wave 1 is final -> victory routes to the result flow, no shop).
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
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

/** Drive a showdown battle from the title to the first CommandPhase, stashing both teams. */
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
    const selectStarterPhase = new SelectStarterPhase();
    selectStarterPhase.initBattle(starters);
  });
  await game.phaseInterceptor.to("CommandPhase");
}

describe.skipIf(!RUN)("Showdown versus battle bootstrap (C3v2b)", () => {
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

  it("fields the opponent manifest as a TRAINER enemy party, verbatim, and reaches CommandPhase", async () => {
    const opponent: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.CHARIZARD, rootSpeciesId: SpeciesId.CHARMANDER, item: "LEFTOVERS" }),
      mon({ speciesId: SpeciesId.BLASTOISE, rootSpeciesId: SpeciesId.SQUIRTLE, item: "FOCUS_BAND" }),
    ];
    const own: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.VENUSAUR, rootSpeciesId: SpeciesId.BULBASAUR, item: "LEFTOVERS" }),
      mon({ speciesId: SpeciesId.SNORLAX, rootSpeciesId: SpeciesId.SNORLAX, item: "SHELL_BELL" }),
    ];

    await runToShowdownCommand(game, own, opponent, [SpeciesId.VENUSAUR, SpeciesId.SNORLAX]);

    // A showdown battle is a TRAINER battle (6-mon party, switching, no catch, win-on-wipe).
    expect(game.scene.currentBattle.battleType).toBe(BattleType.TRAINER);

    // The enemy party is the opponent manifest, built VERBATIM (species + level; no BST swap).
    const enemyParty = game.scene.getEnemyParty();
    expect(enemyParty.length).toBe(2);
    expect(enemyParty[0].species.speciesId).toBe(SpeciesId.CHARIZARD);
    expect(enemyParty[1].species.speciesId).toBe(SpeciesId.BLASTOISE);
    expect(enemyParty[0].level).toBe(100);
    expect(enemyParty[1].level).toBe(100);

    // EXACTLY the whitelist held items (no random trainer/per-mon extras - generateEnemyModifiers
    // is suppressed for showdown): one item per mon, and the lead's differs from the bench's
    // (LEFTOVERS vs FOCUS_BAND -> distinct modifier classes), proving the manifest item is applied.
    const heldOn = (id: number) =>
      game.scene.findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === id, false);
    const lead = heldOn(enemyParty[0].id);
    const bench = heldOn(enemyParty[1].id);
    expect(lead).toHaveLength(1);
    expect(bench).toHaveLength(1);
    expect(lead[0].constructor.name).not.toBe(bench[0].constructor.name);

    // Single-arena duel: wave 1 is the only (final) wave -> victory routes to the result flow.
    expect(game.scene.gameMode.isShowdown).toBe(true);
    expect(game.scene.gameMode.isWaveFinal(1)).toBe(true);
    expect(game.scene.currentBattle.waveIndex).toBe(1);
  });
});
