import { allMoves } from "#data/data-lists";
import { ER_PERPETUAL_MOTION_ABILITY_ID } from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import {
  PerpetualMotionPowerAbAttr,
  PerpetualMotionProgressAbAttr,
} from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { Move } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
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
      .moveset([MoveId.TACKLE, MoveId.PROTECT, MoveId.ROLLOUT, MoveId.DEFENSE_CURL]);
  });

  const prepareBattle = async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    vi.spyOn(player, "stats", "get").mockReturnValue([500000, 1000, 1, 1000, 1, 1000]);
    vi.spyOn(enemy, "stats", "get").mockReturnValue([500000, 1, 1, 1, 1, 1]);
    vi.spyOn(player, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    player.hp = player.getMaxHp();
    vi.spyOn(enemy, "getHeldItems").mockReturnValue([]);
    enemy.hp = enemy.getMaxHp();
    return { player, enemy };
  };

  const runTurn = async (moveId: MoveId, enemy: Pokemon, previousHp: number) => {
    game.move.select(moveId);
    await game.toNextTurn();
    return previousHp - enemy.hp;
  };

  it("triggers only after a successful damaging hit and has no four-hit reset", async () => {
    vi.spyOn(allMoves[MoveId.ROLLOUT], "accuracy", "get").mockReturnValue(100);
    const { player, enemy } = await prepareBattle();

    await runTurn(MoveId.PROTECT, enemy, enemy.hp);
    expect(player.summonData.erPerpetualMotionStreak).toBe(0);

    for (let expectedStreak = 1; expectedStreak <= 5; expectedStreak++) {
      await runTurn(MoveId.TACKLE, enemy, enemy.hp);
      expect(player.summonData.erPerpetualMotionPending).toBe(false);
      expect(player.summonData.erPerpetualMotionStreak).toBe(expectedStreak);
    }
  }, 45_000);

  it("boosts only the automatic Rollout by 10% per consecutive successful hit", async () => {
    const { player, enemy } = await prepareBattle();
    const attr = new PerpetualMotionPowerAbAttr();
    const automaticRollout = scriptedPokemonMove(MoveId.ROLLOUT, 20, { marker: "perpetual-motion" }).getMove();
    const automaticPower = new NumberHolder(20);
    player.summonData.erPerpetualMotionPending = true;
    player.summonData.erPerpetualMotionStreak = 3;

    expect(attr.canApply({ pokemon: player, opponent: enemy, move: automaticRollout, power: automaticPower })).toBe(
      true,
    );
    attr.apply({ pokemon: player, opponent: enemy, move: automaticRollout, power: automaticPower });
    expect(automaticPower.value).toBeCloseTo(26);

    const manualPower = new NumberHolder(20);
    expect(
      attr.canApply({ pokemon: player, opponent: enemy, move: allMoves[MoveId.ROLLOUT], power: manualPower }),
    ).toBe(false);
  });

  it("does not count a manually selected Rollout toward the automatic streak", async () => {
    vi.spyOn(allMoves[MoveId.ROLLOUT], "accuracy", "get").mockReturnValue(100);
    const { player, enemy } = await prepareBattle();

    await runTurn(MoveId.TACKLE, enemy, enemy.hp);
    expect(player.summonData.erPerpetualMotionStreak).toBe(1);
    await runTurn(MoveId.ROLLOUT, enemy, enemy.hp);

    expect(player.summonData.erPerpetualMotionPending).toBe(false);
    expect(player.summonData.erPerpetualMotionStreak).toBe(2);
  });

  it("resets after an automatic miss before the next automatic hit", async () => {
    const calculateBattleAccuracy = Move.prototype.calculateBattleAccuracy;
    let forceRolloutMiss = false;
    vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockImplementation(function (
      this: Move,
      user,
      target,
      simulated,
    ) {
      if (this.id === MoveId.ROLLOUT) {
        return forceRolloutMiss ? 0 : -1;
      }
      return calculateBattleAccuracy.call(this, user, target, simulated);
    });
    const { player, enemy } = await prepareBattle();

    await runTurn(MoveId.TACKLE, enemy, enemy.hp);
    expect(player.summonData.erPerpetualMotionStreak).toBe(1);
    forceRolloutMiss = true;
    await runTurn(MoveId.TACKLE, enemy, enemy.hp);
    expect(player.summonData.erPerpetualMotionPending).toBe(false);
    expect(player.summonData.erPerpetualMotionStreak).toBe(0);
    forceRolloutMiss = false;
    await runTurn(MoveId.TACKLE, enemy, enemy.hp);
    expect(player.summonData.erPerpetualMotionStreak).toBe(1);
  });

  it("resets the streak when an automatic Rollout has no effect or is immune", async () => {
    const { player, enemy } = await prepareBattle();
    const attr = new PerpetualMotionProgressAbAttr();
    const automaticRollout = scriptedPokemonMove(MoveId.ROLLOUT, 20, { marker: "perpetual-motion" }).getMove();

    for (const hitResult of [HitResult.NO_EFFECT, HitResult.IMMUNE]) {
      const params = {
        pokemon: player,
        opponent: enemy,
        move: automaticRollout,
        hitResult,
        damage: 0,
      };
      player.summonData.erPerpetualMotionPending = true;
      player.summonData.erPerpetualMotionStreak = 2;

      expect(attr.canApply(params)).toBe(true);
      attr.apply(params);

      expect(player.summonData.erPerpetualMotionPending).toBe(false);
      expect(player.summonData.erPerpetualMotionStreak).toBe(0);
    }
  });
});
