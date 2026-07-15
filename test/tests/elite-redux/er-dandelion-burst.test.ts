import { ER_DANDELION_BURST_ABILITY_ID } from "#data/elite-redux/abilities/dandelion-burst";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const DANDELION_BURST = ER_DANDELION_BURST_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Dandelion Burst (5907)", () => {
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
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE)
      .ability(DANDELION_BURST)
      .moveset(MoveId.HARDEN);
  });

  /** Drop the Dandelion Burst holder to just above half, then let the foe's Tackle cross it. */
  async function crossHalfViaEnemyTackle(): Promise<void> {
    const player = game.field.getPlayerPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2) + 5;
    game.move.use(MoveId.HARDEN);
    await game.move.forceEnemyMove(MoveId.TACKLE);
    await game.move.forceHit();
    await game.toNextTurn();
  }

  it("seeds a non-Grass foe and drops its Speed (Cotton Spore) on crossing half, once per battle", async () => {
    game.override.enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const enemy = game.field.getEnemyPokemon();
    await crossHalfViaEnemyTackle();

    expect(enemy.getTag(BattlerTagType.SEEDED)).toBeDefined();
    expect(enemy.getStatStage(Stat.SPD)).toBe(-2);

    // Once per battle: clear the seed, cross half again — it must NOT re-fire.
    enemy.removeTag(BattlerTagType.SEEDED);
    await crossHalfViaEnemyTackle();
    expect(enemy.getTag(BattlerTagType.SEEDED)).toBeUndefined();
  });

  it("respects Leech Seed immunity: a Grass foe is NOT seeded, but Cotton Spore still lands", async () => {
    game.override.enemySpecies(SpeciesId.ODDISH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const enemy = game.field.getEnemyPokemon();
    await crossHalfViaEnemyTackle();

    expect(enemy.getTag(BattlerTagType.SEEDED)).toBeUndefined();
    expect(enemy.getStatStage(Stat.SPD)).toBe(-2);
  });
});
