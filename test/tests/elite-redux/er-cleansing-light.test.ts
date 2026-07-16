import { ER_CLEANSING_LIGHT_ABILITY_ID } from "#data/elite-redux/abilities/cleansing-light";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const CLEANSING_LIGHT = ER_CLEANSING_LIGHT_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Cleansing Light (5912)", () => {
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
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      // NB: ER reworks SPLASH into a damaging move, so HARDEN is the safe no-op filler.
      .enemyMoveset(MoveId.HARDEN)
      .ability(CLEANSING_LIGHT)
      // HYPER_VOICE hits ALL_NEAR_ENEMIES only (not the ally); TACKLE is single-target.
      .moveset([MoveId.HYPER_VOICE, MoveId.TACKLE, MoveId.HARDEN]);
  });

  it("a SECOND direct KO in the same turn heals AND cures the lowest-HP ally", async () => {
    await game.classicMode.startBattle(SpeciesId.BLASTOISE, SpeciesId.SNORLAX);
    const [, ally] = game.scene.getPlayerField();
    const [foe1, foe2] = game.scene.getEnemyField();

    // Ally: pre-damaged and poisoned. The 2nd KO cures the poison, so no
    // end-of-turn poison tick confounds the heal.
    ally.hp = Math.floor(ally.getMaxHp() / 2);
    ally.doSetStatus(StatusEffect.POISON);
    const allyBefore = ally.hp;
    foe1.hp = 1;
    foe2.hp = 1;

    game.move.select(MoveId.HYPER_VOICE, 0);
    game.move.select(MoveId.HARDEN, 1);
    await game.toEndOfTurn();

    expect(foe1.isFainted()).toBe(true);
    expect(foe2.isFainted()).toBe(true);
    // 2nd KO cured the status...
    expect(ally.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
    // ...and both KOs healed 10% each with no poison tick to erode it.
    expect(ally.hp).toBeGreaterThan(allyBefore);
  });

  it("a SINGLE direct KO heals the lowest-HP ally by ~10% of its max HP", async () => {
    await game.classicMode.startBattle(SpeciesId.BLASTOISE, SpeciesId.SNORLAX);
    const [, ally] = game.scene.getPlayerField();
    const [foe1, foe2] = game.scene.getEnemyField();

    // No status → the heal is isolated from poison ticks.
    ally.hp = Math.floor(ally.getMaxHp() / 2);
    const allyBefore = ally.hp;
    const expectedHeal = Math.max(1, Math.floor(ally.getMaxHp() * 0.1));
    foe1.hp = 1;

    game.move.select(MoveId.TACKLE, 0, BattlerIndex.ENEMY);
    game.move.select(MoveId.HARDEN, 1);
    await game.toEndOfTurn();

    expect(foe1.isFainted()).toBe(true);
    expect(foe2.isFainted()).toBe(false);
    expect(ally.hp).toBe(allyBefore + expectedHeal);
  });

  it("a SINGLE direct KO does NOT cure the ally's status", async () => {
    await game.classicMode.startBattle(SpeciesId.BLASTOISE, SpeciesId.SNORLAX);
    const [, ally] = game.scene.getPlayerField();
    const [foe1] = game.scene.getEnemyField();

    ally.doSetStatus(StatusEffect.POISON);
    foe1.hp = 1;

    game.move.select(MoveId.TACKLE, 0, BattlerIndex.ENEMY);
    game.move.select(MoveId.HARDEN, 1);
    await game.toEndOfTurn();

    expect(foe1.isFainted()).toBe(true);
    // Only one KO this turn: cure requires a 2nd KO.
    expect(ally.status?.effect).toBe(StatusEffect.POISON);
  });
});
