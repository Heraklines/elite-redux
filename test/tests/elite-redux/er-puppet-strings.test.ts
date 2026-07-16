import type { PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { ER_PUPPET_STRINGS_ABILITY_ID, PuppetStringsAbAttr } from "#data/elite-redux/abilities/puppet-strings";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const PUPPET_STRINGS = ER_PUPPET_STRINGS_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Puppet Strings (5901) + Commanded volatile", () => {
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
      .enemyMoveset(MoveId.TACKLE);
  });

  it("Commands a poisoned foe hit by a Psychic move; the foe's damaging move self-redirects (singles)", async () => {
    // Player (fast Electrode) has Puppet Strings; enemy (slow, poisoned Snorlax) is
    // slower, so on turn 1 the player's Psychic Commands it, then the enemy acts
    // Commanded within the same turn.
    game.override.ability(PUPPET_STRINGS).enemySpecies(SpeciesId.SNORLAX).enemyStatusEffect(StatusEffect.POISON);
    await game.classicMode.startBattle(SpeciesId.ELECTRODE);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.status?.effect).toBe(StatusEffect.POISON);

    game.move.use(MoveId.PSYCHIC);
    await game.toEndOfTurn();

    // Puppet Strings fired: the once-per-switch-in flag is latched (set by the tag's onAdd).
    expect(enemy.summonData.erCommandedUsedThisSwitchIn).toBe(true);
    // The Commanded foe's Tackle did NOT reach the player (singles self-redirect).
    expect(player.getInverseHp()).toBe(0);
  });

  it("only Commands once per switch-in; resets on switch-out", async () => {
    game.override.ability(PUPPET_STRINGS).enemySpecies(SpeciesId.SNORLAX).enemyStatusEffect(StatusEffect.POISON);
    await game.classicMode.startBattle(SpeciesId.ELECTRODE);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const attr = new PuppetStringsAbAttr();
    const params: PostMoveInteractionAbAttrParams = {
      pokemon: player,
      opponent: enemy,
      move: allMoves[MoveId.PSYCHIC],
      hitResult: HitResult.EFFECTIVE,
      damage: 40,
      simulated: false,
    };

    // First application is allowed and latches the flag.
    expect(attr.canApply(params)).toBe(true);
    enemy.addTag(BattlerTagType.ER_COMMANDED, 0, MoveId.NONE, player.id);
    expect(enemy.getTag(BattlerTagType.ER_COMMANDED)).toBeDefined();
    expect(enemy.summonData.erCommandedUsedThisSwitchIn).toBe(true);

    // Even after the tag has been removed (expired/consumed), the flag blocks a
    // second Command for the rest of this switch-in.
    enemy.removeTag(BattlerTagType.ER_COMMANDED);
    expect(enemy.getTag(BattlerTagType.ER_COMMANDED)).toBeUndefined();
    expect(attr.canApply(params)).toBe(false);

    // A switch-out (summonData reset) clears the flag, so it can be Commanded again.
    enemy.resetSummonData();
    expect(enemy.summonData.erCommandedUsedThisSwitchIn).toBe(false);
    expect(attr.canApply(params)).toBe(true);
  });

  it("in singles a Commanded Pokemon hits ITSELF for 40% of its move's self-computed damage", async () => {
    // Command the PLAYER so no active innates interfere (player innates are inactive
    // in scenarios) and the ability is a harmless BALL_FETCH override. The player uses
    // Tackle (a damaging move) which the Commanded tag redirects to a 40% self-hit;
    // the enemy uses Harden (a self-buff that never touches the player — note Splash is
    // a DAMAGING move in ER, so it can't be used here).
    game.override.ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.MAGIKARP).enemyMoveset(MoveId.HARDEN);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.hp = player.getMaxHp();

    // Compute the expected self-hit BEFORE the turn using the same call the tag
    // makes (simulated → random multiplier 1.0, no crit → deterministic).
    const expected = toDmgValue(
      player.getAttackDamage({ source: player, move: allMoves[MoveId.TACKLE], isCritical: false, simulated: true })
        .damage * 0.4,
      1,
    );
    expect(expected).toBeGreaterThan(0);

    player.addTag(BattlerTagType.ER_COMMANDED, 0, MoveId.NONE, enemy.id);
    expect(player.getTag(BattlerTagType.ER_COMMANDED)).toBeDefined();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    // The player took exactly 40% of its Tackle's self-computed damage, and the
    // enemy was untouched (the Commanded move never reached it).
    expect(player.getInverseHp()).toBe(expected);
    expect(enemy.getInverseHp()).toBe(0);
    // The Commanded tag is consumed by the action.
    expect(player.getTag(BattlerTagType.ER_COMMANDED)).toBeUndefined();
  });

  it("in doubles a Commanded Pokemon redirects its damaging move to a living ally", async () => {
    game.override
      .battleStyle("double")
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.HARDEN);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MUNCHLAX);

    const attacker = game.scene.getPlayerField()[0];
    const ally = game.scene.getPlayerField()[1];
    const enemies = game.scene.getEnemyField();

    attacker.addTag(BattlerTagType.ER_COMMANDED, 0, MoveId.NONE, enemies[0].id);

    // The Commanded mon targets an enemy, but the tag redirects the strike to its ally.
    game.move.use(MoveId.TACKLE, 0, enemies[0].getBattlerIndex());
    game.move.use(MoveId.HARDEN, 1);
    await game.toEndOfTurn();

    // The ally was struck; neither enemy took the Commanded mon's hit.
    expect(ally.getInverseHp()).toBeGreaterThan(0);
    expect(enemies[0].getInverseHp()).toBe(0);
    expect(attacker.getTag(BattlerTagType.ER_COMMANDED)).toBeUndefined();
  });

  it("a Commanded status move simply fails", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.MAGIKARP).enemyMoveset(MoveId.HARDEN);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    player.addTag(BattlerTagType.ER_COMMANDED, 0, MoveId.NONE, enemy.id);

    // Swords Dance would raise Attack +2; Commanded makes the status move fail.
    game.move.use(MoveId.SWORDS_DANCE);
    await game.toEndOfTurn();

    expect(player.getStatStage(Stat.ATK)).toBe(0);
    expect(player.getTag(BattlerTagType.ER_COMMANDED)).toBeUndefined();
  });
});
