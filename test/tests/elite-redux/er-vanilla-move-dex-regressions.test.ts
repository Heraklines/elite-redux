/*
 * Regression tests for ER vanilla move rows where stale C-source/vanilla data
 * contradicted the ER 2.65 dex.
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-vanilla-move-dex-regressions.test.ts
 */

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER vanilla move dex regressions", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false);
  });

  it("Horn Drill is a regular damaging move even when the user is lower level", async () => {
    game.override
      .battleStyle("single")
      .moveset(MoveId.HORN_DRILL)
      .startingLevel(50)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.WOBBUFFET);
    await game.classicMode.startBattle(SpeciesId.RHYDON);

    const enemy = game.field.getEnemyPokemon();
    game.move.select(MoveId.HORN_DRILL);
    await game.toEndOfTurn();

    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
    expect(enemy.isFainted()).toBe(false);
  });

  it("Dragon Breath burns at 100% per the ER dex", async () => {
    game.override
      .battleStyle("single")
      .moveset(MoveId.DRAGON_BREATH)
      .startingLevel(50)
      .enemyLevel(80)
      .enemySpecies(SpeciesId.WOBBUFFET);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);

    const enemy = game.field.getEnemyPokemon();
    game.move.select(MoveId.DRAGON_BREATH);
    await game.toEndOfTurn();

    expect(enemy.status?.effect).toBe(StatusEffect.BURN);
  });

  it("Confusion confuses at 100% per the ER dex", async () => {
    game.override
      .battleStyle("single")
      .moveset(MoveId.CONFUSION)
      .startingLevel(50)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.WOBBUFFET);
    await game.classicMode.startBattle(SpeciesId.ABRA);

    const enemy = game.field.getEnemyPokemon();
    game.move.select(MoveId.CONFUSION);
    await game.toEndOfTurn();

    expect(enemy.getTag(BattlerTagType.CONFUSED)).toBeDefined();
  });

  it("Synchronoise takes the user's SECOND type on mono/dual/tri-typed users", async () => {
    game.override
      .battleStyle("single")
      .moveset(MoveId.SYNCHRONOISE)
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.WOBBUFFET);
    await game.classicMode.startBattle(SpeciesId.MEW);

    const player = game.field.getPlayerPokemon();
    const synchronoise = allMoves[MoveId.SYNCHRONOISE];

    // Monotype: falls back to the first (only) type.
    player.summonData.types = [PokemonType.FIRE];
    expect(player.getMoveType(synchronoise)).toBe(PokemonType.FIRE);

    // Dual-typed: the SECOND type.
    player.summonData.types = [PokemonType.FIRE, PokemonType.WATER];
    expect(player.getMoveType(synchronoise)).toBe(PokemonType.WATER);

    // Tri-typed: still the SECOND type, NOT the extra (third) type. This is the
    // regression: the old `types.at(-1)` picked the third type here.
    player.summonData.types = [PokemonType.FIRE, PokemonType.WATER, PokemonType.GRASS];
    expect(player.getMoveType(synchronoise)).toBe(PokemonType.WATER);
  });

  it("Double Hit is 45 BP / 100 acc with a raised critical-hit ratio", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW);
    const doubleHit = allMoves[MoveId.DOUBLE_HIT];
    expect(doubleHit.power).toBe(45);
    expect(doubleHit.accuracy).toBe(100);
    expect(doubleHit.hasAttr("HighCritAttr")).toBe(true);
  });

  it("Magic Bounce does NOT reflect the ER damaging Growl", async () => {
    game.override
      .battleStyle("single")
      .moveset(MoveId.GROWL)
      .startingLevel(50)
      .enemyLevel(100)
      .enemyAbility(AbilityId.MAGIC_BOUNCE)
      .enemySpecies(SpeciesId.WOBBUFFET);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    game.move.select(MoveId.GROWL);
    await game.toEndOfTurn();

    // Growl is a SPECIAL damaging move in ER: it lands on the enemy (damage +
    // Atk drop) instead of being bounced back onto the user.
    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
    expect(enemy.getStatStage(Stat.ATK)).toBe(-1);
    // The user was NOT the reflected target: a bounced Growl would have dropped
    // the user's OWN Atk to -1. It stays at 0, proving Magic Bounce did not fire.
    expect(player.getStatStage(Stat.ATK)).toBe(0);
  });

  it("Ominous Wind hits both opposing Pokemon in doubles", async () => {
    game.override
      .battleStyle("double")
      .moveset([MoveId.OMINOUS_WIND, MoveId.SPLASH])
      .startingLevel(60)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.WOBBUFFET);
    await game.classicMode.startBattle(SpeciesId.GENGAR, SpeciesId.SNORLAX);

    const enemies = game.scene.getEnemyField();
    expect(enemies).toHaveLength(2);
    const [left, right] = enemies;

    game.move.select(MoveId.OMINOUS_WIND, BattlerIndex.PLAYER);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);
    await game.toEndOfTurn();

    expect(left.hp).toBeLessThan(left.getMaxHp());
    expect(right.hp).toBeLessThan(right.getMaxHp());
  });
});
