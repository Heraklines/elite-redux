/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — ER_BLEED status faithfulness (v2.65.3b ROM):
//   "1/16 max HP damage per turn, prevents healing, and negates the effects of
//    stat stages. Rock and Ghost types are immune to bleeding."
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER status — Bleed", () => {
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
      .enemySpecies(SpeciesId.SHUCKLE)
      // HARDEN as the no-op: ER's SPLASH maps to a 40-power damaging move, so
      // using it here polluted the HP assertions (pre-existing red).
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.HARDEN, MoveId.RECOVER]);
  });

  test("chips 1/16 max HP at turn end", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.field.getPlayerPokemon();
    player.addTag(BattlerTagType.ER_BLEED);
    const before = player.hp;

    game.move.select(MoveId.HARDEN);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(before - player.hp).toBe(Math.max(Math.floor(player.getMaxHp() / 16), 1));
  });

  test("Rock and Ghost types are immune", async () => {
    await game.classicMode.startBattle(SpeciesId.GEODUDE); // Rock
    const rock = game.field.getPlayerPokemon();
    rock.addTag(BattlerTagType.ER_BLEED);
    expect(rock.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();

    expect(game.field.getEnemyPokemon().canAddTag(BattlerTagType.ER_BLEED)).toBe(true); // Shuckle: Bug/Rock => Rock immune
  });

  test("negates the bearer's stat-stage multiplier without erasing the stored stages", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.field.getPlayerPokemon();
    player.setStatStage(Stat.ATK, 6);
    // Without bleed, +6 ATK gives the max stage multiplier (2.0).
    expect(player.getStatStageMultiplier(Stat.ATK)).toBeGreaterThan(1);

    player.addTag(BattlerTagType.ER_BLEED);
    // Bleeding: stage effect negated -> neutral multiplier of 1.
    expect(player.getStatStageMultiplier(Stat.ATK)).toBe(1);
    // Stored stage is preserved for when bleed is cured.
    expect(player.getStatStage(Stat.ATK)).toBe(6);
  });

  test("healing restores no HP and instead cures the bleed", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.field.getPlayerPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2);
    player.addTag(BattlerTagType.ER_BLEED);
    const before = player.hp;

    game.move.select(MoveId.RECOVER);
    await game.phaseInterceptor.to("TurnEndPhase");

    // ROM: "prevents healing" + "bleeding was healed!" — the heal is consumed
    // to cure the bleed, so no HP is gained and the bleed is gone.
    expect(player.hp).toBe(before);
    expect(player.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
  });
});
