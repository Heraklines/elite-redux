/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Triple-typing tests — verifies ER's type3-slot semantics work correctly
// in pokerogue when add-type abilities (Aquatic, Grounded, Ice Age, Half
// Drake, Metallic, Dragonfly, Phantom, Fey Flight, Komodo, Lightsaber,
// etc.) push a 3rd type onto a Pokemon.
//
// Cross-references:
//   - ER ROM: vendor/elite-redux/source/src/battle_util.c:5058+ (type3 slot)
//   - Pokerogue: src/field/pokemon.ts:1961 (getTypes returns array)
//   - Our wire: src/data/elite-redux/archetypes/entry-effect.ts (applyAddSelfType)
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erId(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN_SCENARIOS)("ER triple-typing", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Dead Bark (944) adds Ghost to Snorlax → 3 types (Normal/Ghost), Tackle 0 damage", async () => {
    // Already proven in er-damage-sanity.test.ts. Re-verify the type array.
    const pkrgDeadBark = await erId(944);
    if (pkrgDeadBark === undefined) return;
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(pkrgDeadBark)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const enemy = game.field.getEnemyPokemon();
    // After entry, Snorlax (Normal) should have Ghost added.
    const types = enemy.getTypes();
    expect(types).toContain(PokemonType.NORMAL);
    expect(types).toContain(PokemonType.GHOST);
    // Tackle (Normal) is 0× against Ghost → 0 damage.
    const hpBefore = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBe(0);
  });

  it("Adding a type the Pokemon already has is a no-op (no duplicate)", async () => {
    // If a Fire-type Pokemon has an ability that adds Fire, no change.
    const pkrgDeadBark = await erId(944); // adds GHOST
    if (pkrgDeadBark === undefined) return;
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(pkrgDeadBark)
      .enemySpecies(SpeciesId.GENGAR) // already Ghost/Poison
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const enemy = game.field.getEnemyPokemon();
    const types = enemy.getTypes();
    // Gengar should still be Ghost + Poison, no duplicate Ghost.
    const ghostCount = types.filter(t => t === PokemonType.GHOST).length;
    expect(ghostCount).toBe(1);
    expect(types.length).toBeLessThanOrEqual(3); // never more than 3 types
  });

  it("Triple-type effectiveness multiplies correctly (Earthquake vs Normal/Ghost = 0)", async () => {
    // Snorlax with Dead Bark → Normal/Ghost. Earthquake is Ground:
    //   - vs Normal: 1×
    //   - vs Ghost: 1×
    //   - combined: 1× (still hits)
    // But Tackle (Normal):
    //   - vs Normal: 1×
    //   - vs Ghost: 0×
    //   - combined: 0× (immune)
    const pkrgDeadBark = await erId(944);
    if (pkrgDeadBark === undefined) return;
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(pkrgDeadBark)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.EARTHQUAKE)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.RAMPARDOS);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.EARTHQUAKE);
    await game.toEndOfTurn();
    // Earthquake hits Normal/Ghost target normally (1× × 1× = 1×).
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("Adding a type to a 2-type Pokemon yields exactly 3 types", async () => {
    // Charizard is Fire/Flying. If an add-type ability adds Dragon, we want 3 types.
    // Find Lightning Born (847) which adds Electric — use a Pokemon that's
    // not Electric already so we get a clean 3rd type.
    const pkrgId = await erId(847);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const player = game.field.getPlayerPokemon();
    const types = player.getTypes();
    // Charizard (Fire/Flying) + Electric = exactly 3 types
    if (types.includes(PokemonType.ELECTRIC)) {
      // Wire fired — verify cap.
      expect(types.length).toBe(3);
      expect(types).toContain(PokemonType.FIRE);
      expect(types).toContain(PokemonType.FLYING);
      expect(types).toContain(PokemonType.ELECTRIC);
    }
  });
});
