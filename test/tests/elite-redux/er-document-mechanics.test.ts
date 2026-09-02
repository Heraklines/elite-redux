import { allMoves } from "#data/data-lists";
import { ER_CRANISPHERE_ABILITY_ID } from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe.skipIf(process.env.ER_SCENARIO !== "1")("documented fakemon battle mechanics", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingWave(31)
      .startingLevel(100)
      .enemyLevel(100)
      .ability(AbilityId.BALL_FETCH)
      .passiveAbility(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyPassiveAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false);
  });

  it("Cranisphere skips the first Ivory Impact recharge, but not the second", async () => {
    game.override.ability(ER_CRANISPHERE_ABILITY_ID as AbilityId);
    await game.classicMode.startBattle(SpeciesId.SHUCKLE);
    const player = game.scene.getPlayerPokemon()!;
    game.move.use(MoveId.IVORY_IMPACT);
    await game.toNextTurn();
    expect(player.getTag(BattlerTagType.RECHARGING)).toBeUndefined();
    expect(game.scene.getEnemyPokemon()!.getInverseHp()).toBeGreaterThan(0);
    game.move.use(MoveId.IVORY_IMPACT);
    await game.toNextTurn();
    expect(player.getTag(BattlerTagType.RECHARGING)).toBeDefined();
  });

  it("Skull Bash and Ivory Impact consume the same allowance", async () => {
    game.override.ability(ER_CRANISPHERE_ABILITY_ID as AbilityId);
    await game.classicMode.startBattle(SpeciesId.SHUCKLE);
    game.move.use(MoveId.SKULL_BASH);
    await game.toNextTurn();
    expect(game.scene.getEnemyPokemon()!.getInverseHp()).toBeGreaterThan(0);
    game.move.use(MoveId.IVORY_IMPACT);
    await game.toNextTurn();
    expect(game.scene.getPlayerPokemon()!.getTag(BattlerTagType.RECHARGING)).toBeDefined();
  });

  it("ordinary holders still recharge after Ivory Impact", async () => {
    await game.classicMode.startBattle(SpeciesId.SHUCKLE);
    game.move.use(MoveId.IVORY_IMPACT);
    await game.toNextTurn();
    expect(game.scene.getPlayerPokemon()!.getTag(BattlerTagType.RECHARGING)).toBeDefined();
  });

  it("Cranisphere does not skip unrelated recharge moves", async () => {
    game.override.ability(ER_CRANISPHERE_ABILITY_ID as AbilityId);
    await game.classicMode.startBattle(SpeciesId.SHUCKLE);
    game.move.use(MoveId.HYPER_BEAM);
    await game.move.forceHit();
    await game.toNextTurn();
    expect(game.scene.getPlayerPokemon()!.getTag(BattlerTagType.RECHARGING)).toBeDefined();
  });

  it.each([
    [MoveId.WATER_GUN, MoveId.WATER_PULSE],
    [MoveId.GUST, MoveId.AEROBLAST],
    [MoveId.WATER_PULSE, MoveId.WATER_PULSE],
  ])("Gulp Missile follows %s with exactly one %s, without recursion", async (move, followUp) => {
    game.override.ability(AbilityId.GULP_MISSILE);
    await game.classicMode.startBattle(SpeciesId.SHUCKLE);
    game.move.use(move);
    await game.toNextTurn();
    const history = game.scene
      .getPlayerPokemon()!
      .getLastXMoves(-1)
      .map(entry => entry.move);
    expect(history).toHaveLength(2);
    expect(history).toContain(followUp);
    expect(history.filter(id => id === followUp)).toHaveLength(move === followUp ? 2 : 1);
  });

  it.each([MoveId.TACKLE, MoveId.SPLASH])("Gulp Missile does not follow unrelated move %s", async move => {
    game.override.ability(AbilityId.GULP_MISSILE);
    await game.classicMode.startBattle(SpeciesId.SHUCKLE);
    game.move.use(move);
    await game.toNextTurn();
    expect(
      game.scene
        .getPlayerPokemon()!
        .getLastXMoves(-1)
        .map(entry => entry.move),
    ).toEqual([move]);
  });

  it("Twinkle Horn applies Drowsy and retains its horn classification", async () => {
    await game.classicMode.startBattle(SpeciesId.SHUCKLE);
    const move = allMoves[MoveId.TWINKLE_HORN];
    expect(move.chance).toBe(20);
    expect(move.checkFlag(MoveFlags.HORN_BASED)).toBe(true);
    vi.spyOn(move.getAttrs("AddBattlerTagAttr")[0], "getMoveChance").mockReturnValue(100);
    game.move.use(MoveId.TWINKLE_HORN);
    await game.toEndOfTurn();
    expect(game.scene.getEnemyPokemon()!.getTag(BattlerTagType.DROWSY)).toBeDefined();
  });

  it("Hammer Drill lowers Defense and counts as both a hammer and drill", async () => {
    await game.classicMode.startBattle(SpeciesId.SHUCKLE);
    const move = allMoves[MoveId.HAMMER_DRILL];
    expect(move.chance).toBe(20);
    expect(move.checkFlag(MoveFlags.HAMMER_BASED)).toBe(true);
    expect(move.checkFlag(MoveFlags.DRILL_BASED)).toBe(true);
    vi.spyOn(move.getAttrs("StatStageChangeAttr")[0], "getMoveChance").mockReturnValue(100);
    game.move.use(MoveId.HAMMER_DRILL);
    await game.toNextTurn();
    expect(game.scene.getEnemyPokemon()!.getStatStage(Stat.DEF)).toBe(-1);
  });

  it("Drill Bits sets its existing hazard only on the enemy side", async () => {
    await game.classicMode.startBattle(SpeciesId.SHUCKLE);
    game.move.use(MoveId.DRILL_BITS);
    await game.toNextTurn();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.ER_DRILL_BITS, ArenaTagSide.ENEMY)).toBeDefined();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.ER_DRILL_BITS, ArenaTagSide.PLAYER)).toBeUndefined();
  });
});
