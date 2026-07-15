import { allMoves } from "#data/data-lists";
import { ER_RELATIVITY_ABILITY_ID } from "#data/elite-redux/abilities/relativity";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const RELATIVITY = ER_RELATIVITY_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Relativity (5911)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).startingLevel(100).enemyLevel(100).ability(RELATIVITY);
  });

  it("acting FIRST: damaging moves use Speed instead of Attack (bigger hit than the Atk baseline)", async () => {
    // Ninjask: high Speed (160), lower Attack (90) — so a Speed substitution
    // clearly increases Tackle's damage. Ninjask (fast) acts before Snorlax.
    game.override
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.CELEBRATE)
      .moveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.NINJASK);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(holder.getEffectiveStat(Stat.SPD)).toBeGreaterThan(holder.getEffectiveStat(Stat.ATK));

    // Pre-turn baseline (turn order empty → Attack-based, no substitution).
    const atkBaseline = enemy.getAttackDamage({ source: holder, move: allMoves[MoveId.TACKLE] }).damage;

    game.move.select(MoveId.TACKLE);
    await game.toEndOfTurn();

    const actualLoss = enemy.getInverseHp();
    expect(actualLoss).toBeGreaterThan(atkBaseline);
  });

  it("acting AFTER: takes 25% less damage from that attacker", async () => {
    // Snorlax (slow) holder vs Ninjask (fast) attacker — Ninjask moves first,
    // so the holder acts AFTER it and the reduction applies to the hit received.
    game.override
      .enemySpecies(SpeciesId.NINJASK)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.BODY_SLAM)
      .moveset(MoveId.CELEBRATE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Pre-turn baseline (turn order empty → no reduction).
    const fullDamage = holder.getAttackDamage({ source: enemy, move: allMoves[MoveId.BODY_SLAM] }).damage;
    expect(fullDamage).toBeGreaterThan(0);

    game.move.select(MoveId.CELEBRATE);
    await game.toEndOfTurn();

    const actualLoss = holder.getInverseHp();
    expect(actualLoss).toBeLessThan(fullDamage);
    // ~25% reduction (allow rounding slack).
    expect(actualLoss / fullDamage).toBeGreaterThan(0.7);
    expect(actualLoss / fullDamage).toBeLessThan(0.8);
  });

  it("Trick Room flips the order: a normally-first holder now acts AFTER, so the Speed offense is NOT used", async () => {
    game.override
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.CELEBRATE)
      .moveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.NINJASK);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Trick Room: slow-first ordering, so fast Ninjask now moves LAST.
    game.scene.arena.addTag(ArenaTagType.TRICK_ROOM, 5, MoveId.TRICK_ROOM, holder.id, ArenaTagSide.BOTH);

    const atkBaseline = enemy.getAttackDamage({ source: holder, move: allMoves[MoveId.TACKLE] }).damage;

    game.move.select(MoveId.TACKLE);
    await game.toEndOfTurn();

    // Under Trick Room the holder acted AFTER Snorlax → no Speed substitution →
    // damage matches the ordinary Attack baseline (not the boosted Speed hit).
    const actualLoss = enemy.getInverseHp();
    expect(actualLoss).toBe(atkBaseline);
  });
});
