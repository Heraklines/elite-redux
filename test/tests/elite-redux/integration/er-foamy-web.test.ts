/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Foamy Web 949 — "Casts an unremovable Sticky Web on entry. Lasts 5 turns."
//
// The dedicated FOAMY_WEB entry hazard behaves like Sticky Web (−1 Speed to
// grounded switch-ins) but with two ER twists:
//   - it lasts only 5 turns (standard hazards are permanent), and
//   - it is absent from the Rapid Spin / Defog removal lists, so it cannot be
//     cleared (it only expires on its own).
//
// Verifies (a) the FOAMY_WEB tag is created with a 5-turn duration and counts
// down via lapseTags, (b) it lowers the Speed of a grounded switch-in by one
// stage, and (c) the ability lays it on the FOE's side on entry.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { getArenaTag } from "#data/arena-tag";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
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

describe.skipIf(!RUN)("ER Foamy Web (949)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("the FOAMY_WEB tag is created with a 5-turn duration and expires after 5 lapses", () => {
    const tag = getArenaTag(ArenaTagType.FOAMY_WEB, 0, undefined, 1, ArenaTagSide.ENEMY);
    expect(tag).not.toBeNull();
    expect(tag!.tagType).toBe(ArenaTagType.FOAMY_WEB);
    expect(tag!.turnCount).toBe(5);
    // Base ArenaTag.lapse counts down turnCount, returning false on the turn it
    // should be removed. Four lapses keep it alive; the fifth removes it.
    expect(tag!.lapse()).toBe(true); // 5 -> 4
    expect(tag!.lapse()).toBe(true); // 4 -> 3
    expect(tag!.lapse()).toBe(true); // 3 -> 2
    expect(tag!.lapse()).toBe(true); // 2 -> 1
    expect(tag!.lapse()).toBe(false); // 1 -> 0 (removed)
  });

  it("lowers the Speed of a grounded Pokemon switching in by one stage", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA) // Normal — grounded
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    // Pre-lay the trap on the enemy side, then start so the enemy send-in triggers it.
    game.scene.arena.addTag(ArenaTagType.FOAMY_WEB, 0, undefined, 0, ArenaTagSide.ENEMY);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);

    expect(game.field.getEnemyPokemon().getStatStage(Stat.SPD)).toBe(-1);
  });

  it("the Foamy Web ability lays a foe-side FOAMY_WEB hazard on entry", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[949] as AbilityId) // Foamy Web
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);

    // The holder lays the hazard on the FOE's side (5-turn tag present there),
    // never on its own side, and the grounded foe present had its Speed lowered.
    const foeTag = game.scene.arena.getTagOnSide(ArenaTagType.FOAMY_WEB, ArenaTagSide.ENEMY);
    expect(foeTag).toBeDefined();
    expect(foeTag!.turnCount).toBe(5);
    expect(game.scene.arena.getTagOnSide(ArenaTagType.FOAMY_WEB, ArenaTagSide.PLAYER)).toBeUndefined();
    expect(game.field.getEnemyPokemon().getStatStage(Stat.SPD)).toBe(-1);
  });
});
