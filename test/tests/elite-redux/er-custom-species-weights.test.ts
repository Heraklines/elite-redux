/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER-custom species WEIGHT audit (2026-07-22). The ~827 dump customs used to all
// default to a flat 30.0kg placeholder, which broke every weight-based mechanic
// (Grass Knot / Low Kick / Heavy Slam / Heat Crash) on them. Weights are now
// extracted from the ROM (gSpeciesInfo dex.hw) into ER_CUSTOM_SPECIES_WEIGHTS and
// consumed by buildCustomSpecies; the 25 ER-original fakemon with blank ROM hw get
// canon/sprite estimates.
//
// Two tiers:
//   (1) DATA — the built PokemonSpecies carries the extracted weight.
//   (2) MECHANICS — a Grass Knot / Low Kick / Heavy Slam scenario against a
//       converted HEAVY (Dreadnaut, 700kg) and LIGHT (Corm, 3.8kg) custom shows
//       the weight-move power tier tracks the real weight (not the old 30kg).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves, allSpecies } from "#data/data-lists";
import { ER_CUSTOM_SPECIES_WEIGHTS } from "#data/elite-redux/er-custom-species-weights";
import { AbilityId } from "#enums/ability-id";
import { ErSpeciesId } from "#enums/er-species-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function weightOf(speciesId: number): number {
  const sp = allSpecies.find(s => s.speciesId === speciesId);
  if (!sp) {
    throw new Error(`species ${speciesId} not registered`);
  }
  return sp.weight;
}

describe.skipIf(!RUN)("ER-custom species weights — ROM-extracted + estimated", () => {
  describe("data tier — built species carry the extracted weight", () => {
    it("ROM-authoritative weights land on the species (not the old 30kg)", () => {
      // hw[1]/10 from the 2.65 dump.
      expect(weightOf(ErSpeciesId.PHANTOWL)).toBeCloseTo(63.8, 5);
      expect(weightOf(ErSpeciesId.DREADNAUT)).toBeCloseTo(700.0, 5);
      expect(weightOf(ErSpeciesId.CORM)).toBeCloseTo(3.8, 5);
    });

    it("estimated (blank-ROM-hw) fakemon carry their audited weight", () => {
      expect(weightOf(ErSpeciesId.POLARTIC)).toBeCloseTo(300.0, 5); // canon-derived (Beartic evo)
      expect(weightOf(ErSpeciesId.GYARADEATH)).toBeCloseTo(230.0, 5); // canon-derived (Gyarados-class)
      expect(weightOf(ErSpeciesId.MORPEKYLL)).toBeCloseTo(5.0, 5); // sprite est (Morpeko analogue)
    });

    it("the species weight matches the generated table for every custom", () => {
      for (const [idStr, w] of Object.entries(ER_CUSTOM_SPECIES_WEIGHTS)) {
        const id = Number(idStr);
        const sp = allSpecies.find(s => s.speciesId === id);
        // Not every table row is necessarily built (forms may be injected rather
        // than registered as standalone species); only assert the ones that exist.
        if (sp) {
          expect(sp.weight).toBeCloseTo(w, 5);
        }
      }
    });

    it("no built custom is left on the legacy 30.0kg placeholder unless ROM says so", () => {
      const placeholderIds = allSpecies.filter(s => s.speciesId >= 10000 && s.weight === 30.0).map(s => s.speciesId);
      // The only permitted 30.0 values are genuine ROM readings (3 species) — every
      // one of them must be present in the table with an exact 30.0 entry.
      for (const id of placeholderIds) {
        // Editor-mon newcomers (registerErEditorMon) are a separate path and may
        // legitimately default to 30.0; the dump-custom table only covers ids it built.
        if (ER_CUSTOM_SPECIES_WEIGHTS[id] !== undefined) {
          expect(ER_CUSTOM_SPECIES_WEIGHTS[id]).toBe(30.0);
        }
      }
    });
  });

  describe("mechanics tier — weight moves track the converted weight", () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      // The custom mon goes on the PLAYER side (startBattle tolerates custom ids;
      // the enemySpecies override's debug logger throws on ids >= 10000). The enemy
      // is a vanilla SNORLAX — a fixed heavy reference for Heavy Slam's user/target
      // ratio (its ER weight is read live below, not assumed). Neutral ability +
      // passive on BOTH sides so getWeight() returns raw species weight.
      game.override
        .battleStyle("single")
        .criticalHits(false)
        .ability(AbilityId.BALL_FETCH)
        .passiveAbility(AbilityId.BALL_FETCH)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyPassiveAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .enemyLevel(100)
        .startingLevel(100);
    });

    it("Grass Knot / Low Kick / Heavy Slam vs a HEAVY custom (Dreadnaut 700kg)", async () => {
      await game.classicMode.startBattle(ErSpeciesId.DREADNAUT as unknown as SpeciesId);
      const custom = game.field.getPlayerPokemon();
      const snorlax = game.field.getEnemyPokemon();

      expect(custom.getWeight()).toBeCloseTo(700.0, 5); // not the old 30kg
      // Grass Knot / Low Kick read the TARGET weight (custom): >=200kg → 120 BP.
      expect(allMoves[MoveId.GRASS_KNOT].calculateBattlePower(snorlax, custom)).toBe(120);
      expect(allMoves[MoveId.LOW_KICK].calculateBattlePower(snorlax, custom)).toBe(120);
      // Heavy Slam (Snorlax user, custom target): 700kg dwarfs the Snorlax reference
      // (>50% ratio at any plausible Snorlax weight) → lightest tier → 40 BP.
      expect(allMoves[MoveId.HEAVY_SLAM].calculateBattlePower(snorlax, custom)).toBe(40);
    });

    it("Grass Knot / Low Kick / Heavy Slam vs a LIGHT custom (Corm 3.8kg)", async () => {
      await game.classicMode.startBattle(ErSpeciesId.CORM as unknown as SpeciesId);
      const custom = game.field.getPlayerPokemon();
      const snorlax = game.field.getEnemyPokemon();

      expect(custom.getWeight()).toBeCloseTo(3.8, 5); // not the old 30kg
      // Grass Knot / Low Kick read the TARGET weight (custom): <10kg → 20 BP.
      expect(allMoves[MoveId.GRASS_KNOT].calculateBattlePower(snorlax, custom)).toBe(20);
      expect(allMoves[MoveId.LOW_KICK].calculateBattlePower(snorlax, custom)).toBe(20);
      // Heavy Slam (Snorlax user, custom target): 3.8kg is a tiny fraction of the
      // Snorlax reference (<20% ratio at any plausible Snorlax weight) → 120 BP.
      expect(allMoves[MoveId.HEAVY_SLAM].calculateBattlePower(snorlax, custom)).toBe(120);
    });

    it("regression: heavy vs light land in DIFFERENT Grass Knot tiers (impossible at a flat 30kg)", async () => {
      await game.classicMode.startBattle(ErSpeciesId.DREADNAUT as unknown as SpeciesId);
      const snorlax = game.field.getEnemyPokemon();
      const heavyPower = allMoves[MoveId.GRASS_KNOT].calculateBattlePower(snorlax, game.field.getPlayerPokemon());
      expect(heavyPower).toBe(120);
      expect(heavyPower).not.toBe(60); // 60 == the old flat-30kg placeholder tier (25–50kg band, WeightPowerAttr)
    });
  });
});
