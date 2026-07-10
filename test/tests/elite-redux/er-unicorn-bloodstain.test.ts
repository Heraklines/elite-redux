/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Tier-3 fixes:
//
//   * Unicorn (ER ability 647) — "Boosts horn and drill attacks by 30%.
//     Converts Normal-type moves to Fairy-type and Fairy STAB. If the user is
//     Fairy-type its Fairy moves have a 10% infatuate chance." The composite
//     Pixilate part only produced a flat power boost; the type conversion + STAB
//     + infatuate were dropped. Fixed to the full Pixilate package.
//
//   * Blood Stain (ER ability 673) — "...when the user makes contact offensively
//     or defensively with a Pokemon who does not have this ability, it REPLACES
//     their current ability and causes bleeding." The port spread only ER_BLEED,
//     not the ability itself. Fixed with Mummy-style contagion in both
//     directions (PostDefendAbilityGiveAbAttr + the new PostAttackAbilityGiveAbAttr).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const UNICORN = ER_ID_MAP.abilities[647] as AbilityId;
const BLOOD_STAIN = ER_ID_MAP.abilities[673] as AbilityId;

describe.skipIf(!RUN)("ER Unicorn / Blood Stain tier-3 fixes", () => {
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
      .startingLevel(50)
      .enemyLevel(50)
      .enemyAbility(AbilityId.BALL_FETCH);
  });

  test("Unicorn (Pixilate): a Normal move becomes Fairy-type", async () => {
    game.override.ability(UNICORN).moveset([MoveId.TACKLE]).enemySpecies(SpeciesId.SNORLAX).enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.GARDEVOIR);

    const player = game.field.getPlayerPokemon();
    // Tackle is Normal by data; Unicorn's Pixilate half converts it to Fairy.
    expect(allMoves[MoveId.TACKLE].type).toBe(PokemonType.NORMAL);
    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.FAIRY);
  });

  test("Blood Stain: a contact attack spreads the ability AND bleed to the target", async () => {
    game.override
      .ability(BLOOD_STAIN)
      .moveset([MoveId.TACKLE])
      // Wobbuffet is bulky (survives Tackle), Normal-adjacent bleed-eligible, and
      // its Shadow-Tag/Magic-Guard ability is suppressable so it can be replaced.
      .enemySpecies(SpeciesId.WOBBUFFET)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getAbility().id).not.toBe(BLOOD_STAIN);

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("TurnEndPhase");

    // Offensive contagion: the target's ability was replaced with Blood Stain...
    expect(enemy.getAbility().id).toBe(BLOOD_STAIN);
    // ...and it is bleeding.
    expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
  });
});
