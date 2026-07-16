/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Gale Bloom (5944 = Air Blower + Harukaze) — Tailwind side scoping (#194).
//
// Live bug: Gale Bloom set Tailwind on BOTH sides, so the enemy also got the
// Speed buff. Root cause: the Harukaze constituent's PostSummonStackSetEffects
// applied its Tailwind arena tag with a LITERAL `side: 0`, which is
// ArenaTagSide.BOTH (not "player" as the comment claimed) - and the attr never
// resolved the side relative to the holder. (The composite CLONE was fine: it
// preserves the constituent's options by reference; Air Blower's own targetsSelf
// Tailwind was already holder-scoped. The leak was Harukaze's static side, which
// standalone Harukaze shared.)
//
// Fix: the tag side is now HOLDER-RELATIVE - PLAYER means the holder's own side,
// resolved at apply time. This asserts Tailwind lands on the holder's side ONLY,
// from both a player holder and an enemy holder (sides flipped).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_GALE_BLOOM_ABILITY_ID } from "#data/elite-redux/abilities/composite-newcomers";
import type { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const GALE_BLOOM = ER_GALE_BLOOM_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Gale Bloom Tailwind side scoping (5944)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
  });

  it("a PLAYER holder gets Tailwind on the PLAYER side only (never the enemy side)", async () => {
    game.override.ability(GALE_BLOOM);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const arena = game.scene.arena;
    expect(arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER), "Tailwind on holder side").toBeDefined();
    expect(
      arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.ENEMY),
      "Tailwind must NOT leak to the enemy side",
    ).toBeUndefined();
  });

  it("an ENEMY holder gets Tailwind on the ENEMY side only (sides flipped)", async () => {
    game.override.enemyAbility(GALE_BLOOM);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const arena = game.scene.arena;
    expect(
      arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.ENEMY),
      "Tailwind on the enemy holder's side",
    ).toBeDefined();
    expect(
      arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER),
      "Tailwind must NOT leak to the player side",
    ).toBeUndefined();
  });
});
