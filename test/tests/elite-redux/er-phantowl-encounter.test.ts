/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Repro: players reported the game FREEZING whenever they encountered Phantowl
// (ER custom species 1026). A hard freeze on a specific species usually means
// an unhandled throw inside a phase (the phase queue stops advancing) — most
// often an unmapped move/ability id deref during enemy setup, or a hanging
// entry animation.
//
// This first inspects Phantowl's resolved data (every level-up move + ability
// must resolve in allMoves/allAbilities), then drives a real encounter to make
// sure it doesn't hang.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import Overrides from "#app/overrides";
import { allAbilities, allMoves, allSpecies } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Set the enemy species override directly, bypassing OverridesHelper.enemySpecies
 * — its debug log calls getEnumStr(SpeciesId, id), which throws for ER-custom ids
 * (>= 10000, not in the SpeciesId enum). The override itself takes a raw number.
 */
function forceEnemySpecies(id: number): void {
  vi.spyOn(Overrides, "ENEMY_SPECIES_OVERRIDE", "get").mockReturnValue(id as SpeciesId);
}

const RUN = process.env.ER_SCENARIO === "1";

function phantowl() {
  return allSpecies.find(s => s.name === "Phantowl");
}

describe.skipIf(!RUN)("Phantowl encounter does not freeze", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("every Phantowl level-up move resolves in allMoves (no undefined deref)", () => {
    const mon = phantowl();
    expect(mon, "Phantowl species must exist").toBeDefined();
    const bad: { id: number; level: number }[] = [];
    for (const [level, moveId] of mon!.getLevelMoves()) {
      if (!allMoves[moveId] || allMoves[moveId].id !== moveId) {
        bad.push({ id: moveId, level });
      }
    }
    expect(bad, `unmapped level-up move ids: ${JSON.stringify(bad)}`).toHaveLength(0);
  });

  it("every Phantowl ability + innate resolves in allAbilities", () => {
    const mon = phantowl()!;
    const ids = [mon.getAbility(0), mon.getAbility(1), mon.getAbility(2), ...mon.getPassiveAbilities()].filter(
      (x): x is number => x != null && x !== AbilityId.NONE,
    );
    const bad = ids.filter(id => !allAbilities[id]);
    expect(bad, `unmapped ability ids: ${JSON.stringify(bad)}`).toHaveLength(0);
  });

  it("drives a real encounter against Phantowl through one turn without hanging", async () => {
    const mon = phantowl()!;
    forceEnemySpecies(mon.speciesId);
    game.override.battleStyle("single").criticalHits(false).enemyLevel(100).startingLevel(100).moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(game.field.getEnemyPokemon().species.speciesId).toBe(mon.speciesId);
  });

  it("survives the worst case: Phantowl with Low Visibility (Eerie Fog on entry)", async () => {
    const mon = phantowl()!;
    // ER 619 Low Visibility = FOG weather on entry. The weather-set common anim
    // (eerie-fog) must not hang the encounter.
    const lowVisibility = allAbilities.findIndex(a => a?.name === "Low Visibility");
    forceEnemySpecies(mon.speciesId);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .enemyAbility(lowVisibility > 0 ? (lowVisibility as AbilityId) : AbilityId.NONE)
      .enemyLevel(100)
      .startingLevel(100)
      .moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(game.field.getEnemyPokemon()).toBeDefined();
  });
});
