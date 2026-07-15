import { ER_LAST_HOST_ABILITY_ID } from "#data/elite-redux/abilities/last-host";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const LAST_HOST = ER_LAST_HOST_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Last Host (5906)", () => {
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
      .ability(LAST_HOST)
      .moveset(MoveId.HARDEN);
  });

  it("survives a fatal (indirect) hit at 1 HP, consumes the host's Infestation, and 25% CAN faint the host", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    enemy.addTag(BattlerTagType.INFESTATION, 5, MoveId.INFESTATION, player.id);
    // A near-dead host guarantees the 25% max-HP loss faints it.
    enemy.hp = 1;
    expect(enemy.getTag(BattlerTagType.INFESTATION)).toBeDefined();

    // Lethal INDIRECT damage to the holder (covers "direct OR indirect").
    player.damageAndUpdate(player.getMaxHp(), { result: HitResult.INDIRECT });

    expect(player.isFainted()).toBe(false);
    expect(player.hp).toBe(1);
    expect(enemy.getTag(BattlerTagType.INFESTATION)).toBeUndefined();
    expect(enemy.isFainted()).toBe(true);
  });

  it("fires only once per battle, even after the holder heals", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Full-HP host survives the 25% so it can be re-infested for the second hit.
    enemy.hp = enemy.getMaxHp();
    enemy.addTag(BattlerTagType.INFESTATION, 5, MoveId.INFESTATION, player.id);

    // First fatal hit: Last Host saves the holder at 1 HP.
    player.damageAndUpdate(player.getMaxHp(), { result: HitResult.INDIRECT });
    expect(player.hp).toBe(1);
    expect(enemy.isFainted()).toBe(false);

    // Heal the holder and re-apply Infestation to the (still-living) host.
    player.hp = player.getMaxHp();
    enemy.addTag(BattlerTagType.INFESTATION, 5, MoveId.INFESTATION, player.id);
    expect(enemy.getTag(BattlerTagType.INFESTATION)).toBeDefined();

    // Second fatal hit in the SAME battle: Last Host does NOT fire again.
    player.damageAndUpdate(player.getMaxHp(), { result: HitResult.INDIRECT });
    expect(player.isFainted()).toBe(true);
    // The second Infestation was left untouched (the ability never re-triggered).
    expect(enemy.getTag(BattlerTagType.INFESTATION)).toBeDefined();
  });
});
