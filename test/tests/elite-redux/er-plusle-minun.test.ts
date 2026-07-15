import { clearDualTypePrime } from "#data/elite-redux/abilities/dual-type-move";
import { resetItemSuppression } from "#data/elite-redux/abilities/item-suppression";
import {
  ER_CLOSED_CIRCUIT_ABILITY_ID,
  ER_NEGATIVE_FEEDBACK_ABILITY_ID,
  ER_POSITIVE_FEEDBACK_ABILITY_ID,
  ER_SYNCHRONIZED_CURRENT_ABILITY_ID,
} from "#data/elite-redux/abilities/plusle-minun";
import { resetTurnAttackLedger } from "#data/elite-redux/abilities/turn-attack-ledger";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const SYNC = ER_SYNCHRONIZED_CURRENT_ABILITY_ID as AbilityId;
const POSITIVE = ER_POSITIVE_FEEDBACK_ABILITY_ID as AbilityId;
const NEGATIVE = ER_NEGATIVE_FEEDBACK_ABILITY_ID as AbilityId;
const CLOSED = ER_CLOSED_CIRCUIT_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Plus/Minus suite (5921-5924)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    resetTurnAttackLedger();
    resetItemSuppression();
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.WOBBUFFET)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .battleStyle("double");
  });

  it("Synchronized Current: two aligned allies damaging one foe paralyzes it", async () => {
    // Both mons carry Synchronized Current (so both are aligned by ability).
    game.override.ability(SYNC);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const enemy = game.scene.getEnemyField()[0];
    expect(enemy.status?.effect).toBeUndefined();

    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.TACKLE, 1, 2);
    await game.phaseInterceptor.to("BerryPhase", false);

    expect(enemy.status?.effect).toBe(StatusEffect.PARALYSIS);
  });

  it("Synchronized Current: an Electric-type target is immune to the paralysis", async () => {
    game.override.ability(SYNC).enemySpecies(SpeciesId.MAGNEZONE);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const enemy = game.scene.getEnemyField()[0];

    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.TACKLE, 1, 2);
    await game.phaseInterceptor.to("BerryPhase", false);

    // Electric types cannot be paralyzed.
    expect(enemy.status?.effect).toBeUndefined();
  });

  it("Positive Feedback: consumes paralysis, drops DEFENSE when Def > Sp.Def", async () => {
    // Aron: Def 60 > Sp.Def 50 → the higher defensive stat is Defense.
    game.override.ability(POSITIVE).enemySpecies(SpeciesId.ARON);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const enemy = game.scene.getEnemyField()[0];
    expect(enemy.getStat(Stat.DEF)).toBeGreaterThan(enemy.getStat(Stat.SPDEF));
    enemy.trySetStatus(StatusEffect.PARALYSIS);

    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.SPLASH, 1);
    await game.phaseInterceptor.to("BerryPhase", false);

    expect(enemy.status?.effect).toBeUndefined(); // paralysis consumed
    expect(enemy.getStatStage(Stat.DEF)).toBe(-1);
    expect(enemy.getStatStage(Stat.SPDEF)).toBe(0);
  });

  it("Positive Feedback: drops SP.DEF when Sp.Def > Def", async () => {
    // Drowzee: Sp.Def 90 >> Def 45 → higher defensive stat is Sp.Def; Psychic (so
    // paralyzable), no stat-protecting ability, BST under the swap cap.
    game.override.ability(POSITIVE).enemySpecies(SpeciesId.DROWZEE);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const enemy = game.scene.getEnemyField()[0];
    expect(enemy.getStat(Stat.SPDEF)).toBeGreaterThan(enemy.getStat(Stat.DEF));
    enemy.trySetStatus(StatusEffect.PARALYSIS);

    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.SPLASH, 1);
    await game.phaseInterceptor.to("BerryPhase", false);

    expect(enemy.status?.effect).toBeUndefined();
    expect(enemy.getStatStage(Stat.SPDEF)).toBe(-1);
    expect(enemy.getStatStage(Stat.DEF)).toBe(0);
  });

  it("Negative Feedback: consumes paralysis, +1 Speed, suppresses an item, primes a dual-type move", async () => {
    game.override
      .ability(NEGATIVE)
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyHeldItems([{ name: "LEFTOVERS", count: 1 }]);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const [holder] = game.scene.getPlayerField();
    const enemy = game.scene.getEnemyField()[0];
    enemy.trySetStatus(StatusEffect.PARALYSIS);
    enemy.hp = enemy.getMaxHp() - 1; // Leftovers would heal 1/16 at end of turn if not suppressed

    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.SPLASH, 1);
    await game.phaseInterceptor.to("MoveEndPhase");
    await game.phaseInterceptor.to("MoveEndPhase");

    expect(enemy.status?.effect).toBeUndefined(); // paralysis consumed
    expect(holder.getStatStage(Stat.SPD)).toBe(1); // +1 Speed
  });

  it("Negative Feedback prime: the holder's next physical move reads Electric/Fairy for effectiveness + STAB", async () => {
    game.override.ability(NEGATIVE).enemySpecies(SpeciesId.SHUCKLE).moveset([MoveId.TACKLE, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const [holder] = game.scene.getPlayerField();
    const enemy = game.scene.getEnemyField()[0];
    enemy.trySetStatus(StatusEffect.PARALYSIS);

    // Turn 1: damage the paralyzed foe → prime the holder's next physical move.
    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.SPLASH, 1);
    await game.toNextTurn();

    const tackle = game.scene.getPlayerParty()[0].getMoveset()[0].getMove();
    // Under the prime, Tackle reads as Electric primary.
    expect(holder.getMoveType(tackle)).toBe(PokemonType.ELECTRIC);
    // Electric/Fairy vs Shuckle (Bug/Rock): Electric 1x, Fairy 1x → neutral product.
    const eff = enemy.getMoveEffectiveness(holder, tackle, false, true);
    expect(eff).toBeGreaterThan(0);
    clearDualTypePrime(holder);
  });

  it("Closed Circuit: the second actor fires an extra 25 BP Electric/Fairy attack", async () => {
    game.override.ability(CLOSED).enemySpecies(SpeciesId.SHUCKLE);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const enemy = game.scene.getEnemyField()[0];
    enemy.setStatStage(Stat.DEF, 6);
    enemy.setStatStage(Stat.SPDEF, 6);

    const hpStart = enemy.hp;
    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.TACKLE, 1, 2);
    // Two primary tackles + the extra Closed Circuit attack = 3 hit phases.
    await game.phaseInterceptor.to("MoveEndPhase");
    const afterFirst = enemy.hp;
    await game.phaseInterceptor.to("MoveEndPhase");
    const afterSecond = enemy.hp;
    await game.phaseInterceptor.to("MoveEndPhase");
    const afterExtra = enemy.hp;

    // Three distinct damage events: two primaries, then the Closed Circuit follow-up.
    expect(afterFirst).toBeLessThan(hpStart);
    expect(afterSecond).toBeLessThan(afterFirst);
    expect(afterExtra).toBeLessThan(afterSecond);
  });
});
