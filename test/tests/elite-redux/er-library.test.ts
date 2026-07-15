import { allMoves } from "#data/data-lists";
import {
  commitLibraryCast,
  ER_LIBRARY_ABILITY_ID,
  erLibraryCastIsSpecial,
  erLibraryRecordFoeMove,
  getLibraryCastPp,
  getRecordedMoves,
  LIBRARY_CAST_PP,
} from "#data/elite-redux/abilities/library";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { LibraryPanel } from "#ui/library-panel";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const LIBRARY = ER_LIBRARY_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Library (5928)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE)
      .ability(LIBRARY)
      .moveset(MoveId.SPLASH);
  });

  it("records the first move each opposing Pokemon uses, keeping the 3 most recent", async () => {
    // Holder is the ENEMY so its opponents (the player party) provide 4 distinct
    // foes to record (bench mons resolve their opponent as the active holder).
    game.override.ability(AbilityId.BALL_FETCH).enemyAbility(LIBRARY);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP, SpeciesId.PIKACHU, SpeciesId.BULBASAUR);
    const holder = game.field.getEnemyPokemon();
    const party = game.scene.getPlayerParty();

    erLibraryRecordFoeMove(party[0], allMoves[MoveId.TACKLE]);
    erLibraryRecordFoeMove(party[1], allMoves[MoveId.EMBER]);
    erLibraryRecordFoeMove(party[2], allMoves[MoveId.WATER_GUN]);
    erLibraryRecordFoeMove(party[3], allMoves[MoveId.VINE_WHIP]);

    // 4 recorded, oldest (Tackle) evicted -> the 3 most recent remain.
    expect(getRecordedMoves(holder)).toEqual([MoveId.EMBER, MoveId.WATER_GUN, MoveId.VINE_WHIP]);
  });

  it("only records a foe's FIRST move (a second use does not overwrite / re-record)", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemyAbility(LIBRARY);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getEnemyPokemon();
    const active = game.field.getPlayerPokemon();

    erLibraryRecordFoeMove(active, allMoves[MoveId.TACKLE]);
    erLibraryRecordFoeMove(active, allMoves[MoveId.EMBER]);

    expect(getRecordedMoves(holder)).toEqual([MoveId.TACKLE]);
  });

  it("a repeated recorded move deals 15% less damage to the holder's side", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();
    const maxHp = holder.getMaxHp();

    game.move.select(MoveId.SPLASH);
    await game.toEndOfTurn();
    const d1 = maxHp - holder.hp;

    const hpBeforeTurn2 = holder.hp;
    game.move.select(MoveId.SPLASH);
    await game.toEndOfTurn();
    const d2 = hpBeforeTurn2 - holder.hp;

    // Turn 1 records Tackle (exempt); turn 2 is the dampened repeat.
    expect(d1).toBeGreaterThan(0);
    expect(d2).toBeGreaterThan(0);
    expect(d2).toBeLessThan(d1);
    expect(d2 / d1).toBeGreaterThan(0.8);
    expect(d2 / d1).toBeLessThan(0.9);
  });

  it("casting is limited to 2 total shared PP per battle", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();

    expect(getLibraryCastPp(holder)).toBe(LIBRARY_CAST_PP);
    expect(commitLibraryCast(holder, MoveId.TACKLE)).toBe(true);
    expect(getLibraryCastPp(holder)).toBe(1);
    expect(commitLibraryCast(holder, MoveId.TACKLE)).toBe(true);
    expect(getLibraryCastPp(holder)).toBe(0);
    // Third cast is blocked (shared pool exhausted).
    expect(commitLibraryCast(holder, MoveId.TACKLE)).toBe(false);
  });

  it("a cast damaging move is computed with the holder's Sp.Atk (special) regardless of native category", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();

    // Snorlax: Atk 110 >> SpA 65; target Def 65 << SpDef 110. So a physical move
    // computed as SPECIAL deals clearly LESS — a proof the category flipped.
    const physicalDamage = target.getAttackDamage({ source: holder, move: allMoves[MoveId.TACKLE] }).damage;
    commitLibraryCast(holder, MoveId.TACKLE);
    expect(erLibraryCastIsSpecial(holder, allMoves[MoveId.TACKLE])).toBe(true);
    const castDamage = target.getAttackDamage({ source: holder, move: allMoves[MoveId.TACKLE] }).damage;

    expect(castDamage).not.toBe(physicalDamage);
    expect(castDamage).toBeLessThan(physicalDamage);
  });

  it("the fight-menu Library panel opens, lists recorded moves, navigates, and spends shared PP on cast", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemyAbility(LIBRARY);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP, SpeciesId.PIKACHU);
    const holder = game.field.getEnemyPokemon();
    const party = game.scene.getPlayerParty();
    erLibraryRecordFoeMove(party[0], allMoves[MoveId.TACKLE]);
    erLibraryRecordFoeMove(party[1], allMoves[MoveId.EMBER]);
    erLibraryRecordFoeMove(party[2], allMoves[MoveId.WATER_GUN]);

    const panel = new LibraryPanel();
    expect(panel.open(holder)).toBe(true);
    expect(panel.isOpen).toBe(true);
    expect(panel.getEntries()).toEqual([MoveId.TACKLE, MoveId.EMBER, MoveId.WATER_GUN]);
    expect(panel.getCursor()).toBe(0);

    panel.handleInput(Button.DOWN);
    expect(panel.getCursor()).toBe(1);

    // ACTION spends one shared cast PP; the panel closes.
    panel.handleInput(Button.ACTION);
    expect(getLibraryCastPp(holder)).toBe(LIBRARY_CAST_PP - 1);
    expect(panel.isOpen).toBe(false);
  });
});
