/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER "Enrage" mechanic — reuses the vanilla TAUNT tag. (Per ER's TM12/Taunt
// text: "Enrages the foe so it can only use attack moves.")
//
// Covers the two ends of the subsystem:
//   - APPLY: Berserk DNA 529 enrages ITSELF on entry → the holder gains the
//     TAUNT tag (and the sharp highest-attacking-stat boost).
//   - READ:  Cosmic Daze 534 deals 2× to an enraged (TAUNT'd) foe.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Enrage (TAUNT-based)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Berserk DNA 529 enrages the holder on entry (gains TAUNT) and sharply boosts its highest attacking stat", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[529] as AbilityId) // Berserk DNA
      .moveset([MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.MACHAMP]);

    const user = game.field.getPlayerPokemon();
    // Enraged on entry === carries the TAUNT tag.
    expect(user.getTag(BattlerTagType.TAUNT)).toBeDefined();
    // Sharply (+2) boosted its highest attacking stat (Machamp = physical → ATK).
    expect(user.getStatStage(Stat.ATK)).toBe(2);
  });

  it("Cosmic Daze 534 deals ~2× to an enraged (TAUNT'd) foe vs a normal foe", async () => {
    // Single battle, two measurements (resetting the foe's HP between) — one
    // GameManager per test, since a second GameManager in the same `it` crashes
    // the prompt handler.
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[534] as AbilityId) // Cosmic Daze
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.SNORLAX) // bulky → survives both Tackles
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.REGIROCK]);

    const enemy = game.field.getEnemyPokemon();

    // Turn 1 — foe is NOT enraged.
    enemy.hp = enemy.getMaxHp();
    game.move.use(MoveId.TACKLE);
    await game.move.forceHit();
    await game.toEndOfTurn();
    const normalDamage = enemy.getMaxHp() - enemy.hp;

    // Turn 2 — same attacker/move, but the foe IS enraged (TAUNT).
    enemy.hp = enemy.getMaxHp();
    enemy.addTag(BattlerTagType.TAUNT, 4, MoveId.NONE, enemy.id);
    expect(enemy.getTag(BattlerTagType.TAUNT)).toBeDefined();
    game.move.use(MoveId.TACKLE);
    await game.move.forceHit();
    await game.toEndOfTurn();
    const enragedDamage = enemy.getMaxHp() - enemy.hp;

    expect(normalDamage).toBeGreaterThan(0);
    expect(enragedDamage).toBeGreaterThan(normalDamage * 1.5);
  });
});
