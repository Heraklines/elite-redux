/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Tier-4 dex-fidelity ability fixes (regression):
//   - Relic Stone (ER 866): while the holder is on field, every OTHER battler
//     loses its STAB bonus (typing AND ability). The holder keeps its own STAB.
//   - Toxic Boost (137): self-poisons in Toxic Terrain regardless of grounding,
//     both on switch-in and when the terrain becomes Toxic.
//   - Desert Cloak (412): sand secondary-effect immunity is SIDE-WIDE — an ally
//     of the holder is immune too (distinct from holder-only Shield Dust).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { TerrainType } from "#data/terrain";
import type { AbilityId } from "#enums/ability-id";
import { AbilityId as Ability } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const RELIC_STONE = ErAbilityId.RELIC_STONE as unknown as AbilityId;
const DESERT_CLOAK = ErAbilityId.DESERT_CLOAK as unknown as AbilityId;

describe.skipIf(!RUN)("ER tier-4 ability fixes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(Ability.BALL_FETCH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  // ---- Relic Stone (866) ---------------------------------------------------
  // Snorlax (Normal) using Tackle (Normal) is a STAB attack; calculateStabMultiplier
  // is deterministic under `simulated = true`. It is called on the DEFENDER with the
  // attacker as `source`, so `enemy.calculateStabMultiplier(player, move, false, true)`.
  describe("Relic Stone strips STAB from every OTHER battler", () => {
    it("player keeps STAB (1.5x) when no Relic Stone is on the field", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      expect(enemy.calculateStabMultiplier(player, allMoves[MoveId.TACKLE], false, true)).toBeCloseTo(1.5);
    });

    it("player LOSES STAB (1.0x) while an ENEMY Relic Stone holder is on field", async () => {
      game.override.enemyAbility(RELIC_STONE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      expect(enemy.calculateStabMultiplier(player, allMoves[MoveId.TACKLE], false, true)).toBeCloseTo(1.0);
    });

    it("the Relic Stone holder itself KEEPS its own STAB (no other holder present)", async () => {
      game.override.ability(RELIC_STONE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      expect(enemy.calculateStabMultiplier(player, allMoves[MoveId.TACKLE], false, true)).toBeCloseTo(1.5);
    });
  });

  // ---- Toxic Boost (137) ---------------------------------------------------
  describe("Toxic Boost self-poisons in Toxic Terrain", () => {
    it("poisons the holder on switch-in when Toxic Terrain is already active", async () => {
      game.override.ability(Ability.TOXIC_BOOST).startingTerrain(TerrainType.TOXIC);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerField()[0];
      expect(player.status?.effect).toBe(StatusEffect.POISON);
    });

    it("poisons the holder when the terrain BECOMES Toxic mid-battle", async () => {
      game.override.ability(Ability.TOXIC_BOOST);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerField()[0];
      expect(player.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
      expect(player.turnData.pendingStatus ?? StatusEffect.NONE).toBe(StatusEffect.NONE);

      game.scene.arena.trySetTerrain(TerrainType.TOXIC, true, player);
      // trySetStatus queues an ObtainStatusEffectPhase; the terrain-change hook
      // has fired and the poison passed immunity checks (pendingStatus is set
      // synchronously right after canSetStatus succeeds).
      expect(player.turnData.pendingStatus).toBe(StatusEffect.POISON);
    });
  });

  // ---- Desert Cloak (412) --------------------------------------------------
  // The dex requires ALLIES to be immune to secondary effects in sand, not just the
  // holder. Acid Spray is a damaging move with a 100% secondary -2 SpDef drop; in
  // sand a Desert Cloak holder must protect its ALLY from that drop, not just itself.
  describe("Desert Cloak secondary-effect immunity is SIDE-WIDE", () => {
    beforeEach(() => {
      game.override
        .battleStyle("double")
        .ability(DESERT_CLOAK)
        .weather(WeatherType.SANDSTORM)
        .moveset(MoveId.SPLASH)
        .enemyMoveset(MoveId.ACID_SPRAY);
    });

    it("nullifies a move's secondary effect on the holder's ALLY while sand is up", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.BLISSEY);
      const ally = game.scene.getPlayerField()[1];
      expect(ally.getStatStage(Stat.SPDEF)).toBe(0);

      game.move.select(MoveId.SPLASH, 0);
      game.move.select(MoveId.SPLASH, 1);
      await game.move.forceEnemyMove(MoveId.ACID_SPRAY, BattlerIndex.PLAYER_2);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      await game.toEndOfTurn();

      // Ally took Acid Spray but its SpDef was NOT dropped (side-wide immunity).
      expect(ally.getStatStage(Stat.SPDEF)).toBe(0);
    });

    it("protection is the LEAD's side-wide aura, not the ally's own copy (ally ability suppressed)", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.BLISSEY);
      const ally = game.scene.getPlayerField()[1];
      // Suppress the ally's OWN Desert Cloak — only the lead's side-wide aura remains.
      ally.summonData.abilitySuppressed = true;

      game.move.select(MoveId.SPLASH, 0);
      game.move.select(MoveId.SPLASH, 1);
      await game.move.forceEnemyMove(MoveId.ACID_SPRAY, BattlerIndex.PLAYER_2);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      await game.toEndOfTurn();

      expect(ally.getStatStage(Stat.SPDEF)).toBe(0);
    });

    it("control: WITHOUT sand, the ally DOES suffer the secondary effect", async () => {
      game.override.weather(WeatherType.NONE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.BLISSEY);
      const ally = game.scene.getPlayerField()[1];

      game.move.select(MoveId.SPLASH, 0);
      game.move.select(MoveId.SPLASH, 1);
      await game.move.forceEnemyMove(MoveId.ACID_SPRAY, BattlerIndex.PLAYER_2);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      await game.toEndOfTurn();

      expect(ally.getStatStage(Stat.SPDEF)).toBe(-2);
    });
  });
});
