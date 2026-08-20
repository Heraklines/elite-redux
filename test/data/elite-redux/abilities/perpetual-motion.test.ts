import { allMoves } from "#data/data-lists";
import { ER_PERPETUAL_MOTION_ABILITY_ID } from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("ER Ability - Perpetual Motion", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .ability(ER_PERPETUAL_MOTION_ABILITY_ID as unknown as AbilityId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.BIDOOF)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .moveset([MoveId.SPLASH, MoveId.ROLLOUT, MoveId.DEFENSE_CURL]);
  });

  const prepareBattle = async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    vi.spyOn(player, "stats", "get").mockReturnValue([500000, 1, 1, 1, 1, 1]);
    vi.spyOn(enemy, "stats", "get").mockReturnValue([500000, 1, 1, 1, 1, 1]);
    vi.spyOn(enemy, "getHeldItems").mockReturnValue([]);
    enemy.hp = enemy.getMaxHp();
    return { player, enemy };
  };

  const runTurn = async (moveId: MoveId, enemy: Pokemon, previousHp: number) => {
    game.move.select(moveId);
    await game.toNextTurn();
    return previousHp - enemy.hp;
  };

  it("advances only its own successful end-of-turn hits: 20, 40, 80, 160, then reset", async () => {
    vi.spyOn(allMoves[MoveId.ROLLOUT], "accuracy", "get").mockReturnValue(100);
    const { player, enemy } = await prepareBattle();
    const damages: number[] = [];
    let previousHp = enemy.hp;

    for (let i = 0; i < 5; i++) {
      const damage = await runTurn(MoveId.SPLASH, enemy, previousHp);
      damages.push(damage);
      previousHp = enemy.hp;
      expect(player.summonData.erPerpetualMotionPending).toBe(false);
    }

    const [first, second, third, fourth, reset] = damages;
    const variance = 5;
    expect(second).toBeGreaterThanOrEqual(first * 2 - variance);
    expect(second).toBeLessThanOrEqual(first * 2 + variance);
    expect(third).toBeGreaterThanOrEqual(second * 2 - variance);
    expect(third).toBeLessThanOrEqual(second * 2 + variance);
    expect(fourth).toBeGreaterThanOrEqual(third * 2 - variance);
    expect(fourth).toBeLessThanOrEqual(third * 2 + variance);
    expect(reset).toBeGreaterThanOrEqual(first - variance);
    expect(reset).toBeLessThanOrEqual(first + variance);
    expect(player.summonData.erPerpetualMotionStreak).toBe(1);
  });

  it.each([
    MoveId.ROLLOUT,
    MoveId.DEFENSE_CURL,
  ])("does not count manual %s history toward the automatic sequence", async manualMove => {
    vi.spyOn(allMoves[MoveId.ROLLOUT], "accuracy", "get").mockReturnValue(100);
    const { player, enemy } = await prepareBattle();
    let previousHp = enemy.hp;

    await runTurn(MoveId.SPLASH, enemy, previousHp);
    expect(player.summonData.erPerpetualMotionStreak).toBe(1);
    previousHp = enemy.hp;
    await runTurn(manualMove, enemy, previousHp);

    expect(player.summonData.erPerpetualMotionPending).toBe(false);
    expect(player.summonData.erPerpetualMotionStreak).toBe(2);
  });

  it("resets after an automatic miss before the next automatic hit", async () => {
    vi.spyOn(allMoves[MoveId.ROLLOUT], "accuracy", "get")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(0)
      .mockReturnValue(100);
    const { player, enemy } = await prepareBattle();
    let previousHp = enemy.hp;

    const first = await runTurn(MoveId.SPLASH, enemy, previousHp);
    expect(player.summonData.erPerpetualMotionStreak).toBe(1);
    previousHp = enemy.hp;
    await runTurn(MoveId.SPLASH, enemy, previousHp);
    expect(player.summonData.erPerpetualMotionPending).toBe(false);
    expect(player.summonData.erPerpetualMotionStreak).toBe(0);
    previousHp = enemy.hp;
    const reset = await runTurn(MoveId.SPLASH, enemy, previousHp);

    expect(reset).toBeGreaterThanOrEqual(first - 5);
    expect(reset).toBeLessThanOrEqual(first + 5);
    expect(player.summonData.erPerpetualMotionPending).toBe(false);
    expect(player.summonData.erPerpetualMotionStreak).toBe(1);
  });

  it("resets after an automatic failed hit before the next automatic hit", async () => {
    vi.spyOn(allMoves[MoveId.ROLLOUT], "accuracy", "get").mockReturnValue(100);
    const { player, enemy } = await prepareBattle();
    let previousHp = enemy.hp;

    const first = await runTurn(MoveId.SPLASH, enemy, previousHp);
    expect(player.summonData.erPerpetualMotionStreak).toBe(1);
    previousHp = enemy.hp;
    enemy.summonData.types = [PokemonType.GHOST];
    await runTurn(MoveId.SPLASH, enemy, previousHp);
    expect(player.summonData.erPerpetualMotionPending).toBe(false);
    expect(player.summonData.erPerpetualMotionStreak).toBe(0);
    previousHp = enemy.hp;
    enemy.summonData.types = [PokemonType.NORMAL];
    const reset = await runTurn(MoveId.SPLASH, enemy, previousHp);

    expect(reset).toBeGreaterThanOrEqual(first - 5);
    expect(reset).toBeLessThanOrEqual(first + 5);
    expect(player.summonData.erPerpetualMotionStreak).toBe(1);
  });
});
