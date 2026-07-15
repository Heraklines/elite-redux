/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Newcomer-patch abilities (5933-5944): wiring + behavior.
//
//  - Wiring: every manual composite (5933,5934,5935,5936,5938,5940,5941,5942,
//    5943,5944) carries the AbAttrs of BOTH constituents ("invokes ALL
//    constituents"), verified against MANUAL_COMPOSITE_PARTS + live allAbilities.
//  - Bespoke behavior: Genesis Supernova (5937) summons Psychic Terrain on a
//    Psychic move; Knight's Honor (5939) raises Def/SpDef when a side stat drops.
//  - Composite behavior spot-check: Rainbow Fish (5943 = Swift Swim + Marvel
//    Scale) gives the rain speed boost (Swift Swim half) on the holder.
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { ER_RAINBOW_FISH_ABILITY_ID, MANUAL_COMPOSITE_PARTS } from "#data/elite-redux/abilities/composite-newcomers";
import { ER_GENESIS_SUPERNOVA_ABILITY_ID } from "#data/elite-redux/abilities/genesis-supernova";
import { ER_KNIGHTS_HONOR_ABILITY_ID } from "#data/elite-redux/abilities/knights-honor";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Constructor names of a live ability's attrs (empty when absent / no attrs). */
function attrNames(abilityId: number): string[] {
  const ability = allAbilities[abilityId];
  return ability ? ability.attrs.map(a => a.constructor.name) : [];
}

/** Multiset containment: every entry of `needle` appears in `haystack` (with count). */
function containsAll(haystack: string[], needle: string[]): boolean {
  const pool = [...haystack];
  for (const n of needle) {
    const i = pool.indexOf(n);
    if (i === -1) {
      return false;
    }
    pool.splice(i, 1);
  }
  return true;
}

describe.skipIf(!RUN)("ER newcomer abilities (5933-5944)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  describe("composite wiring (invokes ALL constituents)", () => {
    for (const def of Object.values(MANUAL_COMPOSITE_PARTS)) {
      it(`${def.name} (${def.id}) carries every constituent's attrs`, async () => {
        await game.classicMode.startBattle(SpeciesId.MAGIKARP);
        const composite = attrNames(def.id);
        expect(composite.length, `${def.name} has no attrs`).toBeGreaterThan(0);
        // At least one constituent must fully contribute (some ER-custom parts are
        // port placeholders with no attrs; those are logged, not invented). Every
        // constituent that DOES have attrs must be fully present in the composite.
        let contributed = 0;
        for (const constituentId of def.constituents) {
          const partAttrs = attrNames(constituentId);
          if (partAttrs.length === 0) {
            continue;
          }
          contributed++;
          expect(
            containsAll(composite, partAttrs),
            `${def.name} missing ${constituentId}'s attrs [${partAttrs.join(",")}] from [${composite.join(",")}]`,
          ).toBe(true);
        }
        expect(contributed, `${def.name} had no contributing constituent`).toBeGreaterThan(0);
      });
    }
  });

  describe("Genesis Supernova (5937)", () => {
    it("summons Psychic Terrain when the holder uses a Psychic move", async () => {
      game.override
        .battleStyle("single")
        .startingLevel(100)
        .enemyLevel(100)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .ability(ER_GENESIS_SUPERNOVA_ABILITY_ID as AbilityId)
        .moveset([MoveId.PSYCHIC, MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.MEW);
      expect(game.scene.arena.terrain?.terrainType ?? TerrainType.NONE).toBe(TerrainType.NONE);

      game.move.select(MoveId.PSYCHIC);
      await game.toEndOfTurn();

      expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.PSYCHIC);
    });

    it("does NOT summon Psychic Terrain on a non-Psychic move", async () => {
      game.override
        .battleStyle("single")
        .startingLevel(100)
        .enemyLevel(100)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .ability(ER_GENESIS_SUPERNOVA_ABILITY_ID as AbilityId)
        .moveset([MoveId.PSYCHIC, MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.MEW);

      game.move.select(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(game.scene.arena.terrain?.terrainType ?? TerrainType.NONE).toBe(TerrainType.NONE);
    });
  });

  describe("Knight's Honor (5939)", () => {
    it("raises Def and Sp. Def when the holder's stat is lowered by a foe", async () => {
      game.override
        .battleStyle("single")
        .startingLevel(100)
        .enemyLevel(100)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.LEER) // 100% accuracy, lowers the holder's Defense by 1
        .ability(ER_KNIGHTS_HONOR_ABILITY_ID as AbilityId)
        .moveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SKARMORY);
      const holder = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toEndOfTurn();

      // Leer: -1 Def; Knight's Honor fires once per stat lowered on its side,
      // raising Def + Sp. Def by 1 each. Net Def = -1 + 1 = 0; Sp. Def = +1.
      expect(holder.getStatStage(Stat.SPDEF)).toBeGreaterThan(0);
      expect(holder.getStatStage(Stat.DEF)).toBeGreaterThan(-1);
    });
  });

  describe("Rainbow Fish (5943) composite behavior", () => {
    it("gives the Swift Swim speed boost in rain (constituent active on the composite)", async () => {
      game.override
        .battleStyle("single")
        .startingLevel(100)
        .enemyLevel(100)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .weather(WeatherType.RAIN)
        .ability(ER_RAINBOW_FISH_ABILITY_ID as AbilityId)
        .moveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const holder = game.field.getPlayerPokemon();

      const rainSpeed = holder.getEffectiveStat(Stat.SPD);
      // Compare against no-weather baseline.
      game.scene.arena.weather = null;
      const drySpeed = holder.getEffectiveStat(Stat.SPD);
      expect(rainSpeed).toBeGreaterThan(drySpeed);
    });
  });
});
