import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * ER turn-interception primitives:
 *  - 228 Pursuit + 305 Dreamcatcher / 859 Dreamscape: strike a switching-out foe
 *  - 289 Snatch: steal the target's next self-targeting move
 *  - 382 Me First: copy the target's queued attacking move at x1.5
 */
describe("ER — Pursuit / Snatch / Me First / Dreamcatcher", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let plainTackleDamage = 0;

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
      .ability(AbilityId.BALL_FETCH);
  });

  // ---------------------------------------------------------------------------
  // Snatch (289)
  // ---------------------------------------------------------------------------
  it("Snatch (289) — steals the foe's Swords Dance: player gets +2 Atk, foe gets 0", async () => {
    game.override.moveset([MoveId.SNATCH]).enemySpecies(SpeciesId.SNORLAX).enemyMoveset([MoveId.SWORDS_DANCE]);
    await game.classicMode.startBattle(SpeciesId.REGIROCK);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    game.move.select(MoveId.SNATCH);
    await game.toEndOfTurn();

    expect(player.getStatStage(Stat.ATK)).toBe(2);
    expect(enemy.getStatStage(Stat.ATK)).toBe(0);
  });

  it("Snatch (289) — steals the foe's Recover: player heals, foe stays hurt", async () => {
    game.override.moveset([MoveId.SNATCH]).enemySpecies(SpeciesId.SNORLAX).enemyMoveset([MoveId.RECOVER]);
    await game.classicMode.startBattle(SpeciesId.REGIROCK);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2);
    enemy.hp = Math.floor(enemy.getMaxHp() / 2);
    const playerHpBefore = player.hp;
    const enemyHpBefore = enemy.hp;

    game.move.select(MoveId.SNATCH);
    await game.toEndOfTurn();

    expect(player.hp).toBeGreaterThan(playerHpBefore);
    // The foe's Recover was stolen, so it does not heal (it may take chip elsewhere, but never heals up).
    expect(enemy.hp).toBeLessThanOrEqual(enemyHpBefore);
  });

  // ---------------------------------------------------------------------------
  // Me First (382)
  // ---------------------------------------------------------------------------
  it("Me First (382) — copies the foe's attacking move and uses it first", async () => {
    game.override
      .moveset([MoveId.ME_FIRST])
      .enemySpecies(SpeciesId.SHUCKLE) // slow, so the player moves first
      .enemyMoveset([MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.REGIELEKI); // very fast

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const enemyHpBefore = enemy.hp;

    game.move.select(MoveId.ME_FIRST);
    await game.move.selectEnemyMove(MoveId.TACKLE);
    await game.toEndOfTurn();

    // The player copied Tackle and damaged the foe.
    expect(enemy.hp).toBeLessThan(enemyHpBefore);
    const playerHistory = player.getMoveHistory().map(m => m.move);
    expect(playerHistory).toContain(MoveId.TACKLE);
  });

  // Cross-test baseline: the plain-Tackle damage recorded below is compared against
  // the Me First (copied Tackle) damage in the following test to prove the x1.5 boost.
  it("Me First (382) — baseline: records plain Tackle damage", async () => {
    game.override.moveset([MoveId.TACKLE]).enemySpecies(SpeciesId.SHUCKLE).enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.REGIELEKI);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.select(MoveId.TACKLE);
    await game.move.selectEnemyMove(MoveId.SPLASH);
    await game.toEndOfTurn();
    plainTackleDamage = hpBefore - enemy.hp;
    expect(plainTackleDamage).toBeGreaterThan(0);
  });

  it("Me First (382) — copied move is boosted x1.5", async () => {
    game.override.moveset([MoveId.ME_FIRST]).enemySpecies(SpeciesId.SHUCKLE).enemyMoveset([MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.REGIELEKI);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.select(MoveId.ME_FIRST);
    await game.move.selectEnemyMove(MoveId.TACKLE);
    await game.toEndOfTurn();
    const meFirstDamage = hpBefore - enemy.hp;

    expect(plainTackleDamage).toBeGreaterThan(0);
    // ~1.5x (allow rounding / roll slack).
    expect(meFirstDamage).toBeGreaterThan(plainTackleDamage * 1.35);
    expect(meFirstDamage).toBeLessThan(plainTackleDamage * 1.65);
  });

  it("Me First (382) — fails against a queued status move", async () => {
    game.override.moveset([MoveId.ME_FIRST]).enemySpecies(SpeciesId.SHUCKLE).enemyMoveset([MoveId.SWORDS_DANCE]);
    await game.classicMode.startBattle(SpeciesId.REGIELEKI);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const enemyHpBefore = enemy.hp;

    game.move.select(MoveId.ME_FIRST);
    await game.move.selectEnemyMove(MoveId.SWORDS_DANCE);
    await game.toEndOfTurn();

    // Me First fails on a status move: nothing is copied, so the player deals no
    // damage and the foe carries out its own Swords Dance (+2 Atk) uncontested.
    expect(enemy.hp).toBe(enemyHpBefore);
    expect(player.getMoveHistory().map(m => m.move)).not.toContain(MoveId.SWORDS_DANCE);
    expect(enemy.getStatStage(Stat.ATK)).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Pursuit (228) — strike a switching-out foe
  // ---------------------------------------------------------------------------
  it("Pursuit (228) — hits a menu-switching foe BEFORE it leaves, at ~2x", async () => {
    game.override
      .moveset([MoveId.PURSUIT])
      .battleType(BattleType.TRAINER)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.REGIROCK);

    const enemy0 = game.scene.getEnemyParty()[0];
    // Baseline: Pursuit vs a NON-switching foe.
    game.move.select(MoveId.PURSUIT);
    await game.move.selectEnemyMove(MoveId.SPLASH);
    await game.toEndOfTurn();
    const baseline = enemy0.getInverseHp();
    expect(baseline).toBeGreaterThan(0);
    enemy0.hp = enemy0.getMaxHp();

    // Now Pursuit vs the SAME foe as it switches out.
    game.move.select(MoveId.PURSUIT);
    game.forceEnemyToSwitch();
    await game.toEndOfTurn();

    expect(game.phaseInterceptor.log).toContain("SwitchSummonPhase");
    const pursuitDamage = enemy0.getInverseHp();
    // The outgoing mon (party slot 0) took the hit — at roughly double.
    expect(pursuitDamage).toBeGreaterThan(baseline * 1.7);
    expect(enemy0.isFainted()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Dreamcatcher (305) — strike a sleeping switching-out foe
  // ---------------------------------------------------------------------------
  it("Dreamcatcher (305) — strikes a SLEEPING foe as it switches out", async () => {
    const dreamcatcher = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP.abilities[305] as AbilityId;
    game.override
      .moveset([MoveId.TACKLE])
      .ability(dreamcatcher)
      .battleType(BattleType.TRAINER)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.REGIROCK);

    const enemy0 = game.scene.getEnemyParty()[0];
    enemy0.trySetStatus(StatusEffect.SLEEP, undefined, 3);
    enemy0.hp = enemy0.getMaxHp();
    const hpBefore = enemy0.hp;

    game.move.select(MoveId.TACKLE);
    game.forceEnemyToSwitch();
    await game.toEndOfTurn();

    expect(game.phaseInterceptor.log).toContain("SwitchSummonPhase");
    // The sleeping outgoing mon was struck before leaving.
    expect(enemy0.getInverseHp()).toBeGreaterThan(0);
    expect(hpBefore - enemy0.hp).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Regression: normal switching untouched (no interceptor present)
  // ---------------------------------------------------------------------------
  it("regression — a normal switch (no Pursuit/Dreamcatcher) is unaffected", async () => {
    game.override
      .moveset([MoveId.SPLASH])
      .battleType(BattleType.TRAINER)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.REGIROCK);

    const enemy0 = game.scene.getEnemyParty()[0];
    const hpBefore = enemy0.hp;

    game.move.select(MoveId.SPLASH);
    game.forceEnemyToSwitch();
    await game.toEndOfTurn();

    expect(game.phaseInterceptor.log).toContain("SwitchSummonPhase");
    // Splash did nothing and no interceptor fired: the outgoing mon is untouched.
    expect(enemy0.hp).toBe(hpBefore);
    expect(enemy0.getTag(BattlerTagType.SNATCH)).toBeUndefined();
  });
});
