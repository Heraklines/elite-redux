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
import type { GhostTrainerProfile } from "#data/elite-redux/er-ghost-profile";
import { normalizeErShinyLabSavedLook } from "#data/elite-redux/er-shiny-lab-effects";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import { MEGA_STONE_ITEM, type ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
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
  opponentProfile: GhostTrainerProfile | null = null,
): Promise<void> {
  await game.runToTitle();
  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
    beginShowdownBattle(own, opponent, null, opponentProfile);
    const starters = generateStarters(game.scene, playerSpecies);
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    const selectStarterPhase = new SelectStarterPhase();
    selectStarterPhase.initBattle(starters);
  });
  // Bootstrap assertions do not need to accept command input. Stop at the exact boundary so this
  // single-engine fixture does not impersonate a production versus session without its runtime.
  await game.phaseInterceptor.to("CommandPhase", false);
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

  it("attaches each OWN mon's manifest held item to the PLAYER party (B7 item 6)", async () => {
    const opponent: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.CHARIZARD, rootSpeciesId: SpeciesId.CHARMANDER, item: "LEFTOVERS" }),
    ];
    // Own team: distinct item CLASSES per mon (Leftovers vs Shell Bell) so a per-mon assertion
    // proves the manifest item - not a shared default - lands on the right PlayerPokemon.
    const own: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.VENUSAUR, rootSpeciesId: SpeciesId.BULBASAUR, item: "LEFTOVERS" }),
      mon({ speciesId: SpeciesId.SNORLAX, rootSpeciesId: SpeciesId.SNORLAX, item: "SHELL_BELL" }),
    ];

    await runToShowdownCommand(game, own, opponent, [SpeciesId.VENUSAUR, SpeciesId.SNORLAX]);

    const playerParty = game.scene.getPlayerParty();
    expect(playerParty.length).toBe(2);
    const heldOn = (id: number) =>
      game.scene.findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === id, true);
    const lead = heldOn(playerParty[0].id);
    const bench = heldOn(playerParty[1].id);
    // Exactly one held item per own mon, and the two are distinct classes (Leftovers vs Shell Bell),
    // proving each mon's OWN manifest item is applied to the PLAYER side (was previously unapplied).
    expect(lead).toHaveLength(1);
    expect(bench).toHaveLength(1);
    expect(lead[0].constructor.name).not.toBe(bench[0].constructor.name);
    // The type id is pinned to the registry key so the modifier round-trips to the guest.
    expect(lead[0].type.id).toBe("LEFTOVERS");
    expect(bench[0].type.id).toBe("SHELL_BELL");
  });

  it("bootstraps a 1v1 SINGLE-mon versus match (B7 item 10 short party)", async () => {
    // A team may now field as few as 1 mon. A 1-vs-1 single-mon match must build its one-mon
    // player + enemy parties and reach CommandPhase (the enemy build + battle handle short parties).
    const opponent: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.CHARIZARD, rootSpeciesId: SpeciesId.CHARMANDER, item: "LEFTOVERS" }),
    ];
    const own: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.SNORLAX, rootSpeciesId: SpeciesId.SNORLAX, item: "SHELL_BELL" }),
    ];

    await runToShowdownCommand(game, own, opponent, [SpeciesId.SNORLAX]);

    expect(game.scene.getPlayerParty().length).toBe(1);
    expect(game.scene.getEnemyParty().length).toBe(1);
    expect(game.scene.currentBattle.battleType).toBe(BattleType.TRAINER);
    expect(game.scene.gameMode.isWaveFinal(1)).toBe(true);
    // The lone own mon still carries its manifest held item (item 6 works for a 1-mon party too).
    const heldOnPlayer = game.scene.findModifiers(
      m => m instanceof PokemonHeldItemModifier && m.pokemonId === game.scene.getPlayerParty()[0].id,
      true,
    );
    expect(heldOnPlayer).toHaveLength(1);
  });

  it("attaches NO runtime modifier for a mega mon's locked (MEGA_STONE) item slot (B7 item 6)", async () => {
    const opponent: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.CHARIZARD, rootSpeciesId: SpeciesId.CHARMANDER, item: "LEFTOVERS" }),
    ];
    // Charizard fielded as its Mega X form (formIndex 1): item slot is the MEGA_STONE sentinel,
    // which maps to NO runtime modifier (permamega - the form carries the stats).
    const own: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.CHARIZARD, rootSpeciesId: SpeciesId.CHARMANDER, formIndex: 1, item: MEGA_STONE_ITEM }),
    ];

    await runToShowdownCommand(game, own, opponent, [SpeciesId.CHARIZARD]);

    const playerParty = game.scene.getPlayerParty();
    const held = game.scene.findModifiers(
      m => m instanceof PokemonHeldItemModifier && m.pokemonId === playerParty[0].id,
      true,
    );
    expect(held).toHaveLength(0);
  });

  it("applies the opponent's ghost-trainer profile to the enemy trainer + shiny-lab look to the mon (C7)", async () => {
    // A 14-number encoded SavedLook whose first (loadout) byte is non-zero, so it decodes to a
    // real look (normalizeErShinyLabSavedLook keeps it) and lands on the enemy mon's customPokemonData.
    const look = [1, 2, 3, 200, 150, 100, 96, 0, 0, 0, 0, 0, 128, 128];
    const opponent: ShowdownMonManifest[] = [
      mon({ speciesId: SpeciesId.CHARIZARD, rootSpeciesId: SpeciesId.CHARMANDER, shiny: true, erShinyLab: look }),
      mon({ speciesId: SpeciesId.BLASTOISE, rootSpeciesId: SpeciesId.SQUIRTLE, shiny: false }),
    ];
    const own: ShowdownMonManifest[] = [mon({ speciesId: SpeciesId.VENUSAUR, rootSpeciesId: SpeciesId.BULBASAUR })];

    // The opponent authored an ACE_TRAINER sprite, a name + title, and the three dialogue lines
    // (no placeholder tokens, so the lines assert literally).
    const profile: GhostTrainerProfile = {
      trainerType: TrainerType.ACE_TRAINER,
      displayName: "Nightshade",
      title: "The Undying",
      dialogue: { intro: "Face me!", defeated: "You bested me.", defeatPlayer: "You never stood a chance." },
    };

    await runToShowdownCommand(game, own, opponent, [SpeciesId.VENUSAUR], profile);

    const trainer = game.scene.currentBattle.trainer!;
    // Sprite/class from the profile.
    expect(trainer.config.trainerType).toBe(TrainerType.ACE_TRAINER);
    // Name + title plate.
    expect(trainer.name).toBe("Nightshade");
    expect(trainer.getName(TrainerSlot.TRAINER, true)).toBe("The Undying Nightshade");
    // The three dialogue arrays mapped from the profile (intro/defeated/defeatPlayer).
    expect(trainer.getEncounterMessages()).toEqual(["Face me!"]);
    expect(trainer.getVictoryMessages()).toEqual(["You bested me."]);
    expect(trainer.getDefeatMessages()).toEqual(["You never stood a chance."]);

    // The shiny mon's Shiny Lab look landed on its customPokemonData (suppress-local on, look restored);
    // the non-shiny mon carries no look.
    const enemyParty = game.scene.getEnemyParty();
    expect(enemyParty[0].customPokemonData.erShinyLabSuppressLocal).toBe(true);
    expect(enemyParty[0].customPokemonData.erShinyLab).toEqual(normalizeErShinyLabSavedLook(look));
    expect(enemyParty[1].customPokemonData.erShinyLab).toBeUndefined();
  });
});
