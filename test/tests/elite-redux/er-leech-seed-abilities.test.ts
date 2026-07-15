import { ER_COMMON_ROOT_ABILITY_ID } from "#data/elite-redux/abilities/common-root";
import { ER_TANGLED_SEED_ABILITY_ID } from "#data/elite-redux/abilities/tangled-seed";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const COMMON_ROOT = ER_COMMON_ROOT_ABILITY_ID as AbilityId;
const TANGLED_SEED = ER_TANGLED_SEED_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Common Root (5904)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.HARDEN)
      .ability(COMMON_ROOT);
  });

  it("heals EVERY active ally on the seeder's side, not just the seeder", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MUNCHLAX);

    const seeder = game.scene.getPlayerField()[0];
    const ally = game.scene.getPlayerField()[1];
    const enemy = game.scene.getEnemyField()[0];
    // Pre-damage both allies so the heal is observable (not HP-capped).
    seeder.hp = Math.floor(seeder.getMaxHp() / 2);
    ally.hp = Math.floor(ally.getMaxHp() / 2);
    const seederBefore = seeder.hp;
    const allyBefore = ally.hp;

    game.move.use(MoveId.LEECH_SEED, 0, enemy.getBattlerIndex());
    game.move.use(MoveId.HARDEN, 1);
    await game.move.forceHit();
    // Advance past turn-end so the deferred Leech Seed / Common Root heal phases run.
    await game.toNextTurn();

    expect(enemy.getTag(BattlerTagType.SEEDED)).toBeDefined();
    // The seeder heals from the seed; Common Root additionally heals the ally.
    expect(seeder.hp).toBeGreaterThan(seederBefore);
    expect(ally.hp).toBeGreaterThan(allyBefore);
  });
});

describe.skipIf(!RUN)("ER Tangled Seed (5903)", () => {
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
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(TANGLED_SEED)
      .enemyMoveset([MoveId.LEECH_SEED, MoveId.ROAR])
      .ability(AbilityId.BALL_FETCH)
      .moveset(MoveId.HARDEN);
  });

  it("blocks the seeded target's voluntary switch, but a forced switch still works", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MUNCHLAX);

    const trapped = game.field.getPlayerPokemon();

    // Turn 1: the Tangled-Seed foe seeds our lead → it is trapped (voluntary block).
    game.move.use(MoveId.HARDEN);
    await game.move.forceEnemyMove(MoveId.LEECH_SEED);
    await game.move.forceHit();
    await game.toNextTurn();

    expect(trapped.getTag(BattlerTagType.SEEDED)).toBeDefined();
    expect(trapped.getTag(BattlerTagType.TRAPPED)).toBeDefined();
    expect(trapped.isTrapped()).toBe(true);

    // Turn 2: a FORCED switch (Roar) still drags the trapped lead out.
    game.move.use(MoveId.HARDEN);
    await game.move.forceEnemyMove(MoveId.ROAR);
    await game.toEndOfTurn();

    // The trapped lead was forced off the field despite the voluntary-switch block.
    expect(game.field.getPlayerPokemon().species.speciesId).not.toBe(trapped.species.speciesId);
  });
});
