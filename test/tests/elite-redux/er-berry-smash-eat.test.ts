/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (#342): "Berry Smash" (ER move id 830) — "Deals damage. User eats
// their berry." — never consumed a berry. The auto-classifier only tagged it
// HAMMER_BASED (a flag-tagged-move) and missed the berry-eat clause, so no
// EatBerryAttr was ever attached. The per-id correction in
// init-elite-redux-custom-moves.ts now adds EatBerryAttr(selfTarget=true),
// mirroring Concoction (id 1022). EatBerryAttr already picks a RANDOM held berry
// when the user holds several (the user's "multiple berries" case), so no extra
// logic is needed for that.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allMoves, modifierTypes } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { BerryType } from "#enums/berry-type";
import { SpeciesId } from "#enums/species-id";
import { BerryModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Berry Smash makes the user eat one of its berries (#342/#398)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("#398: the USER gains the berry effect - never the move's target", () => {
    const user = game.scene.getPlayerPokemon()!;
    const target = game.scene.getEnemyPokemon()!;
    // Give the user a Liechi Berry (+1 Atk when eaten).
    const berry = modifierTypes.BERRY().generateType([], [BerryType.LIECHI])!.newModifier(user) as BerryModifier;
    globalScene.addModifier(berry, true);

    const move = allMoves[ER_ID_MAP.moves[830]];
    const eatBerry = move.attrs.find(a => a.constructor.name === "EatBerryAttr") as {
      apply: (user: unknown, target: unknown, move: unknown, args: unknown[]) => boolean;
    };
    expect(eatBerry.apply(user, target, move, [])).toBe(true);

    // The USER is the one recorded as having eaten the berry (the effect
    // function and Harvest tracking run on the consumer), the target is
    // untouched, and the berry is gone from the user.
    expect(user.battleData.berriesEaten).toContain(BerryType.LIECHI);
    expect(target.battleData.berriesEaten).not.toContain(BerryType.LIECHI);
    expect(target.battleData.hasEatenBerry).toBe(false);
    expect(globalScene.findModifiers(m => m instanceof BerryModifier && m.pokemonId === user.id, true).length).toBe(0);
  });

  it("the built move carries EatBerryAttr (self-target)", () => {
    const move = allMoves[ER_ID_MAP.moves[830]];
    expect(move).toBeDefined();
    const eatBerry = move.attrs.find(a => a.constructor.name === "EatBerryAttr");
    expect(eatBerry, "Berry Smash must carry EatBerryAttr").toBeDefined();
    // selfTarget = the USER eats its OWN berry (not the target's).
    expect((eatBerry as { selfTarget?: boolean }).selfTarget).toBe(true);
  });
});
