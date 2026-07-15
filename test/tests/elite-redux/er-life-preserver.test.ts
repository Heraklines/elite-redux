import { ER_LIFE_PRESERVER_ABILITY_ID } from "#data/elite-redux/abilities/life-preserver";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const LIFE_PRESERVER = ER_LIFE_PRESERVER_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Life Preserver (5916)", () => {
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
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.HARDEN)
      .ability(LIFE_PRESERVER)
      .moveset(MoveId.HARDEN);
  });

  it("saves the ally at 1 HP from a lethal DIRECT hit and Drenches the (non-Water) attacker", async () => {
    await game.classicMode.startBattle(SpeciesId.BLASTOISE, SpeciesId.SNORLAX);
    const [, ally] = game.scene.getPlayerField();
    const attacker = game.scene.getEnemyField()[0];

    ally.damageAndUpdate(ally.getMaxHp(), { result: HitResult.EFFECTIVE, source: attacker });

    expect(ally.isFainted()).toBe(false);
    expect(ally.hp).toBe(1);
    expect(attacker.getTag(BattlerTagType.ER_DRENCHED)).toBeDefined();
  });

  it("fires only once per battle — a second lethal direct hit lets the ally faint", async () => {
    await game.classicMode.startBattle(SpeciesId.BLASTOISE, SpeciesId.SNORLAX);
    const [, ally] = game.scene.getPlayerField();
    const attacker = game.scene.getEnemyField()[0];

    ally.damageAndUpdate(ally.getMaxHp(), { result: HitResult.EFFECTIVE, source: attacker });
    expect(ally.hp).toBe(1);

    // Heal and take a second lethal direct hit in the same battle.
    ally.hp = ally.getMaxHp();
    ally.damageAndUpdate(ally.getMaxHp(), { result: HitResult.EFFECTIVE, source: attacker });
    expect(ally.isFainted()).toBe(true);
  });

  it("does NOT Drench a Water-type attacker (immune), but still saves the ally", async () => {
    game.override.enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.BLASTOISE, SpeciesId.SNORLAX);
    const [, ally] = game.scene.getPlayerField();
    const attacker = game.scene.getEnemyField()[0];
    expect(attacker.isOfType(PokemonType.WATER)).toBe(true);

    ally.damageAndUpdate(ally.getMaxHp(), { result: HitResult.EFFECTIVE, source: attacker });

    expect(ally.hp).toBe(1);
    expect(attacker.getTag(BattlerTagType.ER_DRENCHED)).toBeUndefined();
  });

  it("does NOT trigger on INDIRECT lethal damage — the ally faints", async () => {
    await game.classicMode.startBattle(SpeciesId.BLASTOISE, SpeciesId.SNORLAX);
    const [, ally] = game.scene.getPlayerField();
    const attacker = game.scene.getEnemyField()[0];

    ally.damageAndUpdate(ally.getMaxHp(), { result: HitResult.INDIRECT, source: attacker });
    expect(ally.isFainted()).toBe(true);
  });
});
