import { ER_MYCELIAL_NETWORK_ABILITY_ID } from "#data/elite-redux/abilities/mycelial-network";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const MYCELIAL_NETWORK = ER_MYCELIAL_NETWORK_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Mycelial Network (5905)", () => {
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
      .enemyMoveset(MoveId.HARDEN)
      .ability(MYCELIAL_NETWORK)
      .moveset(MoveId.HARDEN);
  });

  it("heals the holder by half the HP an opposing foe loses to Infestation", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Pre-damage the holder so the heal is observable; enemy stays at full HP so its
    // Infestation tick is exactly maxHp/8.
    player.hp = Math.floor(player.getMaxHp() / 2);
    enemy.hp = enemy.getMaxHp();
    const playerBefore = player.hp;

    enemy.addTag(BattlerTagType.INFESTATION, 5, MoveId.INFESTATION, player.id);
    expect(enemy.getTag(BattlerTagType.INFESTATION)).toBeDefined();

    game.move.use(MoveId.HARDEN);
    await game.toNextTurn();

    const enemyLoss = enemy.getInverseHp();
    expect(enemyLoss).toBeGreaterThan(0);
    // The holder recovered exactly half of the foe's Infestation loss.
    expect(player.hp - playerBefore).toBe(Math.floor(enemyLoss / 2));
  });
});
