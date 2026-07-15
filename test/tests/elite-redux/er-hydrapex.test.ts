import {
  ER_HYDRAPEX_ABILITY_ID,
  HYDRAPEX_SIDE_HEAD_POWER,
  resetHydrapexGuard,
} from "#data/elite-redux/abilities/hydrapex";
import { graftType } from "#data/elite-redux/abilities/type-graft";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const HYDRAPEX = ER_HYDRAPEX_ABILITY_ID as AbilityId;

/** Boost both defensive stages so a frail foe survives the hit and reveals the follow-up. */
function bulkUp(mon: Pokemon): void {
  mon.setStatStage(Stat.DEF, 6);
  mon.setStatStage(Stat.SPDEF, 6);
}

describe.skipIf(!RUN)("ER Hydrapex (5931)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    resetHydrapexGuard();
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .criticalHits(false)
      .startingWave(150) // past the #419 BST devolve ladder so Dragonite stays Dragonite
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.DRAGONITE)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(HYDRAPEX)
      .moveset([MoveId.DRAGON_CLAW, MoveId.SPLASH]);
  });

  it("side head strikes the OTHER Dragon-typed opponent at ~35% power", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);
    const [foe1, foe2] = game.scene.getEnemyField();
    bulkUp(foe1);
    bulkUp(foe2);
    const foe1Before = foe1.hp;
    const foe2Before = foe2.hp;

    game.move.select(MoveId.DRAGON_CLAW, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.toEndOfTurn();

    const primaryDamage = foe1Before - foe1.hp;
    const sideDamage = foe2Before - foe2.hp;

    // Primary landed on foe1; the side head landed on the other Dragon foe2.
    expect(primaryDamage).toBeGreaterThan(0);
    expect(sideDamage).toBeGreaterThan(0);
    // The side head deals ~35% of the same move's power. Damage scales linearly
    // with power, so the ratio tracks HYDRAPEX_SIDE_HEAD_POWER (rounding slack).
    expect(sideDamage / primaryDamage).toBeGreaterThan(HYDRAPEX_SIDE_HEAD_POWER - 0.1);
    expect(sideDamage / primaryDamage).toBeLessThan(HYDRAPEX_SIDE_HEAD_POWER + 0.1);
  });

  it("no side head against a non-Dragon-typed opponent", async () => {
    game.override.enemySpecies(SpeciesId.SNORLAX); // pure Normal foes
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);
    const [foe1, foe2] = game.scene.getEnemyField();
    bulkUp(foe1);
    bulkUp(foe2);
    const foe2Before = foe2.hp;

    game.move.select(MoveId.DRAGON_CLAW, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.toEndOfTurn();

    // foe2 is not Dragon-typed -> never targeted by a side head.
    expect(foe1.hp).toBeLessThan(foe1.getMaxHp());
    expect(foe2.hp).toBe(foe2Before);
  });

  it("Fairy immunity applies: a Dragon/Fairy foe takes no side-head damage from a Dragon move", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);
    const [foe1, foe2] = game.scene.getEnemyField();
    bulkUp(foe1);
    bulkUp(foe2);
    // Make foe2 Dragon/Fairy: still Dragon-typed (so it IS targeted), but Fairy
    // makes the Dragon-type side head deal 0 (Dragon vs Fairy = immune).
    graftType(foe2, PokemonType.FAIRY);
    const foe2Before = foe2.hp;

    game.move.select(MoveId.DRAGON_CLAW, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.toEndOfTurn();

    expect(foe1.hp).toBeLessThan(foe1.getMaxHp());
    expect(foe2.hp).toBe(foe2Before);
  });
});
