import { allMoves } from "#data/data-lists";
import { ER_CROSSCUT_ABILITY_ID } from "#data/elite-redux/abilities/crosscut";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const CROSSCUT = ER_CROSSCUT_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Crosscut (5908)", () => {
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
      .enemyMoveset(MoveId.CELEBRATE)
      .ability(CROSSCUT);
  });

  it("a slicing move strikes TWICE — each at 70% power, first native then opposite category", async () => {
    game.override.moveset(MoveId.X_SCISSOR);
    // Scizor: high Attack, low Sp. Atk → the physical and special strikes differ
    // clearly, proving the second strike swapped category.
    await game.classicMode.startBattle(SpeciesId.SCIZOR);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = allMoves[MoveId.X_SCISSOR];

    // Strike 1: default strike index 0 → native (physical) category, 70% power.
    holder.turnData.hitCount = 1;
    holder.turnData.hitsLeft = 1;
    const strike1 = enemy.getAttackDamage({ source: holder, move }).damage;
    // Full-power physical reference (ignoreSourceAbility skips Crosscut's power cut).
    const fullPhys = enemy.getAttackDamage({ source: holder, move, ignoreSourceAbility: true }).damage;

    // Strike 2: force strike index 1 → opposite (special) category, 70% power.
    holder.turnData.hitCount = 2;
    holder.turnData.hitsLeft = 1;
    const strike2 = enemy.getAttackDamage({ source: holder, move }).damage;

    // Reset the twiddled counters before running the real turn.
    holder.turnData.hitsLeft = -1;

    expect(strike1).toBeGreaterThan(0);
    expect(strike2).toBeGreaterThan(0);
    // 70% power on the first (physical) strike (vs the full-power reference).
    expect(strike1 / fullPhys).toBeGreaterThan(0.66);
    expect(strike1 / fullPhys).toBeLessThan(0.74);
    // Category flip: a physical attacker's special strike is much weaker.
    expect(strike2).toBeLessThan(strike1);

    game.move.select(MoveId.X_SCISSOR);
    await game.toEndOfTurn();

    // The move struck exactly twice: total damage == strike1 (physical) + strike2 (special).
    expect(enemy.getInverseHp()).toBe(strike1 + strike2);
  });

  it("a pulse move is also eligible and strikes twice", async () => {
    game.override.moveset(MoveId.WATER_PULSE);
    await game.classicMode.startBattle(SpeciesId.SCIZOR);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = allMoves[MoveId.WATER_PULSE];

    holder.turnData.hitCount = 1;
    holder.turnData.hitsLeft = 1;
    const strike1 = enemy.getAttackDamage({ source: holder, move }).damage;
    holder.turnData.hitCount = 2;
    holder.turnData.hitsLeft = 1;
    const strike2 = enemy.getAttackDamage({ source: holder, move }).damage;
    holder.turnData.hitsLeft = -1;

    game.move.select(MoveId.WATER_PULSE);
    await game.toEndOfTurn();

    expect(enemy.getInverseHp()).toBe(strike1 + strike2);
  });

  it("a non-slicing / non-pulse move is NOT doubled (strikes once at full power)", async () => {
    game.override.moveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.SCIZOR);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Crosscut inactive → normal single full-power hit.
    const single = enemy.getAttackDamage({ source: holder, move: allMoves[MoveId.TACKLE] }).damage;

    game.move.select(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(enemy.getInverseHp()).toBe(single);
  });
});
