/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Vengeful Spirit (ability 565): "Curses the attacker when KO'd by a direct
// hit (GHOST-type attackers are IMMUNE to the curse). Boosts Ghost moves by
// 30%, or by 50% at <=1/3 HP."
//
// Reclassified from the Haunted-Spirit+Vengeance composite (whose Ghost boost
// was 1.2x and whose curse cursed even Ghost attackers) to bespoke:
//   - Ghost move power x1.3 (x1.5 at <=1/3 HP).
//   - Curse-on-faint excludes GHOST-type attackers.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const VENGEFUL_SPIRIT = ErAbilityId.VENGEFUL_SPIRIT as unknown as AbilityId;

describe.skipIf(!RUN)("ER Vengeful Spirit — Ghost boost + Ghost-immune curse", () => {
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
      .ability(VENGEFUL_SPIRIT)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(50)
      .startingLevel(50);
  });

  it("boosts Ghost move power x1.3, and x1.5 at <=1/3 HP", async () => {
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const shadowBall = allMoves[MoveId.SHADOW_BALL];

    const power = (ignoreAb: boolean) => shadowBall.calculateBattlePower(player, enemy, true, ignoreAb);
    const base = power(true); // ability ignored — unboosted power

    // Full HP: x1.3.
    expect(power(false) / base).toBeCloseTo(1.3, 2);

    // <= 1/3 HP: x1.5.
    player.hp = Math.floor(player.getMaxHp() / 4);
    expect(power(false) / base).toBeCloseTo(1.5, 2);
  });

  it("curses a NON-Ghost attacker that KOs the holder", async () => {
    // Put Vengeful Spirit on the ENEMY (the KO'd holder); the PLAYER attacker
    // KOs it with a real move so the faint records the attacker (Aftermath
    // pattern). Player Snorlax is Normal (not Ghost) — it should be cursed.
    game.override.ability(AbilityId.BALL_FETCH).enemyAbility(VENGEFUL_SPIRIT).moveset([MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.setStat(Stat.SPD, 999, false); // move first, KO the holder
    enemy.hp = 15; // Tackle one-shots

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(enemy.isFainted()).toBe(true);
    expect(player.getTag(BattlerTagType.CURSED), "non-Ghost attacker is cursed").toBeDefined();
  });

  it("does NOT curse a GHOST-type attacker that KOs the holder", async () => {
    // Attacker Gengar (Ghost) KOs the Vengeful Spirit holder with Sludge Bomb
    // (Poison — connects vs Normal). The Ghost-type attacker is immune.
    game.override.ability(AbilityId.BALL_FETCH).enemyAbility(VENGEFUL_SPIRIT).moveset([MoveId.SLUDGE_BOMB]);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.setStat(Stat.SPD, 999, false);
    enemy.hp = 15;

    game.move.use(MoveId.SLUDGE_BOMB);
    await game.toEndOfTurn();

    expect(enemy.isFainted()).toBe(true);
    expect(player.getTag(BattlerTagType.CURSED), "Ghost attacker is immune to the curse").toBeUndefined();
  });
});
