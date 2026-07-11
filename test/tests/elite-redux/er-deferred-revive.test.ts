/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — TRUE deferred revive (629 Shallow Grave + 899 Backup Power).
//
// DEX (2.65):
//   - Shallow Grave (629): "After fainting while fog is active, the user revives
//     at 25% max HP when sending out your next party member. This still
//     activates when the user faints on the last turn of fog."
//   - Backup Power (899): "Revives at 25% HP once after fainting in Electric
//     Terrain."
//
// The prior wiring CLAMPED the lethal hit to 1 HP and healed the same turn, so
// the mon never actually fainted / left the field. Both now use the TRUE
// deferred revive: the holder ACTUALLY faints (leaves field, fires faint
// interactions), is flagged, and is restored to 25% max HP as a living bench
// reserve when its side next sends out a party member.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { PostFaintDeferredReviveAbAttr } from "#data/elite-redux/archetypes/post-faint-deferred-revive";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("ER Shallow Grave / Backup Power — TRUE deferred revive", () => {
  it("629 Shallow Grave wires PostFaintDeferredReviveAbAttr (25%)", () => {
    const attrs = dispatchArchetype("bespoke", null, 629).attrs;
    const revive = attrs.find(a => a instanceof PostFaintDeferredReviveAbAttr) as
      | PostFaintDeferredReviveAbAttr
      | undefined;
    expect(revive).toBeDefined();
    expect(revive?.getHpFraction()).toBe(0.25);
  });

  it("899 Backup Power wires PostFaintDeferredReviveAbAttr (25%)", () => {
    const attrs = dispatchArchetype("bespoke", null, 899).attrs;
    expect(attrs.some(a => a instanceof PostFaintDeferredReviveAbAttr)).toBe(true);
  });

  describe.skipIf(!RUN)("behavior", () => {
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
        .moveset(MoveId.SPLASH)
        .statusEffect(StatusEffect.POISON) // the holder chips itself to a non-damaging KO
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .enemyLevel(100)
        .startingLevel(100);
    });

    it("629 Shallow Grave: the holder faints under fog, then revives to ~25% at the next send-out", async () => {
      game.override.ability(ErAbilityId.SHALLOW_GRAVE as unknown as AbilityId).weather(WeatherType.FOG);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);
      const holder = game.field.getPlayerPokemon();
      const maxHp = holder.getMaxHp();
      holder.hp = 1; // poison chip KOs it at end of turn

      game.move.select(MoveId.SPLASH);
      game.doSelectPartyPokemon(1); // send out the next party member after the faint
      await game.toNextTurn();

      // The holder ACTUALLY fainted and left the field, then was revived off-field.
      expect(game.field.getPlayerPokemon().species.speciesId, "the bench mon took the field").toBe(SpeciesId.MAGIKARP);
      expect(holder.isFainted(), "the fainted holder was revived (no longer fainted)").toBe(false);
      expect(holder.hp, "revived to ~25% max HP").toBe(Math.max(1, Math.floor(maxHp * 0.25)));
    }, 40000);

    it("899 Backup Power: the holder faints in Electric Terrain, then revives to ~25%", async () => {
      game.override.ability(ErAbilityId.BACKUP_POWER as unknown as AbilityId);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);
      game.scene.arena.trySetTerrain(TerrainType.ELECTRIC, true);
      const holder = game.field.getPlayerPokemon();
      const maxHp = holder.getMaxHp();
      holder.hp = 1;

      game.move.select(MoveId.SPLASH);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();

      expect(holder.isFainted()).toBe(false);
      expect(holder.hp).toBe(Math.max(1, Math.floor(maxHp * 0.25)));
    }, 40000);
  });
});
