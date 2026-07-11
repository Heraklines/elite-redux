/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Gleam Eyes (707) — dex: on entry, reveals the opponents' items, PREVENTS
// THEM FROM WORKING FOR 2 TURNS (Embargo-style; Mega Stones excluded), and drops
// all foes' Sp. Atk by one stage. (#54)
//
// Previously the item-lock clause used the As-One PreventItemUse/PreventBerryUse
// primitives — a PERMANENT field lock, not the dex's exact 2-turn window. The
// composite's Frisk part already carries the real turn-limited ER_ITEM_DISABLED
// tag (DisableFoeItemsOnEntryAbAttr), so the As-One rider was dropped. This pins
// that the real 2-turn tag is what Gleam Eyes now applies.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { erIsHeldItemDisabled } from "#data/battler-tags";
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
const GLEAM_EYES = (ER_ID_MAP.abilities[707] ?? 707) as AbilityId;

describe.skipIf(!RUN)("ER Gleam Eyes — real 2-turn Embargo on entry (#54)", () => {
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
      .moveset([MoveId.SPLASH])
      .ability(GLEAM_EYES)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHeldItems([{ name: "LEFTOVERS" }])
      .criticalHits(false);
  });

  it("applies the real turn-limited ER_ITEM_DISABLED tag to the foe on entry (not the old permanent field lock)", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    // The 2-turn item-lock tag is applied on entry (via the Frisk composite part).
    expect(enemy.getTag(BattlerTagType.ER_ITEM_DISABLED), "foe gets the ER_ITEM_DISABLED tag on entry").toBeDefined();
    // The foe's Leftovers is the suppressed item during the window.
    expect(erIsHeldItemDisabled(enemy, "LEFTOVERS"), "the foe's held item is suppressed during the window").toBe(true);

    // Scare part: all foes' Sp. Atk drops one stage.
    expect(enemy.getStatStage(Stat.SPATK), "Scare drops the foe's Sp. Atk by one stage").toBe(-1);

    // The old permanent As-One field lock is gone.
    expect(
      player.hasAbilityWithAttr("PreventItemUseAbAttr"),
      "Gleam Eyes no longer carries the permanent As-One item lock",
    ).toBe(false);
    expect(
      player.hasAbilityWithAttr("PreventBerryUseAbAttr"),
      "Gleam Eyes no longer carries the permanent As-One berry lock",
    ).toBe(false);
  }, 120_000);

  it("does not suppress a foe's Mega Stone (excluded from the item lock)", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const enemy = game.scene.getEnemyPokemon()!;
    // A form-change item id is never the locked target, so it is never suppressed.
    expect(erIsHeldItemDisabled(enemy, "GYARADOSITE"), "a Mega Stone is never suppressed by the tag").toBe(false);
  }, 120_000);
});
