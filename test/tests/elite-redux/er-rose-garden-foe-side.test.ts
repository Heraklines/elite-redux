/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Rose Garden (ability 761): "Lays TWO layers of Toxic Spikes on the
// OPPONENT'S side on entry."
//
// The classifier omitted `side`, so the entry-effect defaulted to "both" and
// laid Toxic Spikes on the HOLDER's own side too — badly-poisoning the holder's
// own grounded switch-ins. Fixed by pinning side:"foe". Proven here: the FOE
// side gets 2 layers; the holder's OWN side stays clean, so its grounded
// switch-in is NOT poisoned.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import type { EntryHazardTag } from "#data/arena-tag";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const ROSE_GARDEN = ER_ID_MAP.abilities[761] as AbilityId; // 5462

describe.skipIf(!RUN)("ER Rose Garden — 2 Toxic Spikes on the FOE side only", () => {
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
      .ability(ROSE_GARDEN)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("lays 2 layers of Toxic Spikes on the FOE side and NONE on its own side", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const arena = game.scene.arena;

    const foeTag = arena.getTagOnSide(ArenaTagType.TOXIC_SPIKES, ArenaTagSide.ENEMY);
    const ownTag = arena.getTagOnSide(ArenaTagType.TOXIC_SPIKES, ArenaTagSide.PLAYER);

    expect(foeTag).toBeDefined();
    expect((foeTag as EntryHazardTag).layers).toBe(2); // 2 layers → bad poison
    expect(ownTag).toBeUndefined(); // holder's own side is clean
  });

  it("the holder's own grounded switch-in is NOT poisoned", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.RATTATA);
    const bench = game.scene.getPlayerParty()[1]; // grounded, would be poisoned if own side had Toxic Spikes
    expect(bench.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);

    game.doSwitchPokemon(1);
    await game.toNextTurn();

    const active = game.scene.getPlayerPokemon()!;
    expect(active.species.speciesId).toBe(SpeciesId.RATTATA);
    // Own side has no Toxic Spikes → the switch-in stays unpoisoned (the bug fixed).
    expect(active.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
  });
});
