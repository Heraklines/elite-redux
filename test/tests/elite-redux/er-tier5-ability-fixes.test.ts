/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Tier-5 dex-fidelity ability fixes (regression):
//   - Tectonize (308): Normal moves -> Ground; a non-Ground holder gains Ground
//     STAB; a Ground-type holder is IMMUNE to Stealth Rock and Spikes.
//   - Draconize (413): Normal moves -> Dragon; a non-Dragon holder gains Dragon
//     STAB; a Dragon-type holder's Dragon moves deal NEUTRAL (1x) vs Fairy while
//     a non-Dragon holder's converted Dragon move stays 0x vs Fairy (gated).
//   - Pure Love (508) / global ER infatuation: an INFATUATED target has its Atk
//     and Sp. Atk halved (Pokemon.getEffectiveStat).
//   - Big Leaves (374): in sun, the HIGHEST attacking stat (Atk or Sp.Atk) x1.5
//     - a physical attacker gets the boost on Atk (not Sp.Atk-only).
//   - Noise Cancel (595): sound moves "don't affect" the holder OR its ally.
//   - Mycelium Might (510): the holder's STATUS moves bypass TYPE immunities
//     (Thunder Wave vs Ground, powder vs Grass) and status-application type
//     immunities (Toxic vs Steel, Will-O-Wisp vs Fire); damaging moves do NOT.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allAbilities, allMoves } from "#data/data-lists";
import { Gender } from "#data/gender";
import type { AbilityId } from "#enums/ability-id";
import { AbilityId as Ability } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const TECTONIZE = ErAbilityId.TECTONIZE as unknown as AbilityId;
const DRACONIZE = ErAbilityId.DRACONIZE as unknown as AbilityId;
const BIG_LEAVES = ErAbilityId.BIG_LEAVES as unknown as AbilityId;
const NOISE_CANCEL = ErAbilityId.NOISE_CANCEL as unknown as AbilityId;

/** Constructor-name scan (the ER "registration-free" attrs aren't in AbilityAttrs). */
function attrNames(id: AbilityId): string[] {
  return allAbilities[id].attrs.map(a => a.constructor.name);
}

describe.skipIf(!RUN)("ER tier-5 ability fixes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemyAbility(Ability.BALL_FETCH)
      .enemyLevel(50)
      .startingLevel(50)
      .criticalHits(false);
  });

  // ---- Tectonize (308) -----------------------------------------------------
  describe("Tectonize — Normal->Ground + conditional Ground STAB / hazard immunity", () => {
    it("a non-Ground holder's Normal move becomes Ground (super-effective vs Electric)", async () => {
      game.override.ability(TECTONIZE).enemySpecies(SpeciesId.VOLTORB);
      await game.classicMode.startBattle(SpeciesId.RATTATA); // Normal, non-Ground
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      const tackle = allMoves[MoveId.TACKLE];
      expect(player.getMoveType(tackle)).toBe(PokemonType.GROUND);
      // Ground vs pure Electric = 2x (proves the conversion took).
      expect(enemy.getMoveEffectiveness(player, tackle)).toBe(2);
    });

    it("carries the type conversion, Ground STAB rider, and Ground-type hazard immunity", () => {
      const names = attrNames(TECTONIZE);
      expect(names).toContain("TypeConversionAbAttr");
      expect(names).toContain("StabAddAbAttr");
      expect(names).toContain("GroundEntryHazardImmunityAbAttr");
    });
  });

  // ---- Draconize (413) -----------------------------------------------------
  describe("Draconize — Normal->Dragon + Dragon-type-gated Dragon-vs-Fairy neutrality", () => {
    it("a DRAGON-type holder's Dragon move is NEUTRAL (1x) vs Fairy (immunity pierced)", async () => {
      game.override.ability(DRACONIZE).enemySpecies(SpeciesId.SNUBBULL); // Fairy
      await game.classicMode.startBattle(SpeciesId.DRATINI); // pure Dragon
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      expect(enemy.getMoveEffectiveness(player, allMoves[MoveId.DRAGON_CLAW])).toBe(1);
    });

    it("a NON-Dragon holder's converted Dragon move stays 0x vs Fairy (gate respected)", async () => {
      game.override.ability(DRACONIZE).enemySpecies(SpeciesId.SNUBBULL);
      await game.classicMode.startBattle(SpeciesId.RATTATA); // Normal, non-Dragon
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      const tackle = allMoves[MoveId.TACKLE];
      expect(player.getMoveType(tackle)).toBe(PokemonType.DRAGON); // converted
      expect(enemy.getMoveEffectiveness(player, tackle)).toBe(0); // still Fairy-immune
    });
  });

  // ---- Pure Love (508) / global ER infatuation -----------------------------
  describe("Infatuation halves the target's Atk and Sp. Atk", () => {
    it("an INFATUATED target's Atk and Sp. Atk are ~halved", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      // Opposite genders so the infatuation actually attaches.
      player.gender = Gender.MALE;
      enemy.gender = Gender.FEMALE;

      const atkBefore = enemy.getEffectiveStat(Stat.ATK);
      const spatkBefore = enemy.getEffectiveStat(Stat.SPATK);

      enemy.addTag(BattlerTagType.INFATUATED, 5, MoveId.ATTRACT, player.id);
      expect(enemy.getTag(BattlerTagType.INFATUATED)).toBeDefined();

      const atkAfter = enemy.getEffectiveStat(Stat.ATK);
      const spatkAfter = enemy.getEffectiveStat(Stat.SPATK);

      expect(atkAfter).toBeLessThan(atkBefore * 0.6);
      expect(atkAfter).toBeGreaterThan(atkBefore * 0.4);
      expect(spatkAfter).toBeLessThan(spatkBefore * 0.6);
      expect(spatkAfter).toBeGreaterThan(spatkBefore * 0.4);
    });
  });

  // ---- Big Leaves (374) ----------------------------------------------------
  describe("Big Leaves — highest attacking stat x1.5 in sun", () => {
    it("boosts a PHYSICAL attacker's Atk by 1.5x in sun (not Sp.Atk-only)", async () => {
      game.override.ability(BIG_LEAVES).weather(WeatherType.SUNNY);
      await game.classicMode.startBattle(SpeciesId.MACHOP); // Atk (80) >> Sp.Atk (35)
      const player = game.scene.getPlayerField()[0];
      // getEffectiveStat with ignoreAbility=true strips the ability multiplier.
      const atkNoAbility = player.getEffectiveStat(Stat.ATK, undefined, undefined, true);
      const atkWithAbility = player.getEffectiveStat(Stat.ATK);
      expect(atkWithAbility).toBeGreaterThan(atkNoAbility * 1.4);
      expect(atkWithAbility).toBeLessThan(atkNoAbility * 1.6);
    });

    it("swapped the Sp.Atk-only multiplier for the highest-stat one", () => {
      const names = attrNames(BIG_LEAVES);
      expect(names).toContain("SelfHighestStatMultiplierAbAttr");
      // The Solar-Power-derived plain StatMultiplierAbAttr on Sp.Atk was removed.
      const hasSpAtkStatMult = allAbilities[BIG_LEAVES].attrs.some(
        a => a.constructor.name === "StatMultiplierAbAttr" && (a as unknown as { stat: number }).stat === Stat.SPATK,
      );
      expect(hasSpAtkStatMult).toBe(false);
    });
  });

  // ---- Noise Cancel (595) --------------------------------------------------
  describe("Noise Cancel — sound moves don't affect the holder or its ally", () => {
    it("a damaging sound move (Snarl) is blocked (0x) against the holder", async () => {
      game.override.ability(NOISE_CANCEL).enemySpecies(SpeciesId.ZUBAT);
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      expect(player.getMoveEffectiveness(enemy, allMoves[MoveId.SNARL])).toBe(0);
    });

    it("a STATUS sound move (Growl) is blocked too; a non-sound move is unaffected", async () => {
      game.override.ability(NOISE_CANCEL).enemySpecies(SpeciesId.ZUBAT);
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      expect(player.getMoveEffectiveness(enemy, allMoves[MoveId.GROWL])).toBe(0);
      // A non-sound physical move still connects normally.
      expect(player.getMoveEffectiveness(enemy, allMoves[MoveId.TACKLE])).toBeGreaterThan(0);
    });

    it("protects an ALLY that does NOT itself have the ability (side-wide)", async () => {
      game.override.battleStyle("double").ability(NOISE_CANCEL).enemySpecies(SpeciesId.ZUBAT);
      await game.classicMode.startBattle(SpeciesId.RATTATA, SpeciesId.PIDGEY);
      const ally = game.scene.getPlayerField()[1];
      const enemy = game.scene.getEnemyField()[0];
      // Suppress the ally's OWN Noise Cancel — only the lead's side-wide copy remains.
      ally.summonData.abilitySuppressed = true;
      expect(ally.getMoveEffectiveness(enemy, allMoves[MoveId.SNARL])).toBe(0);
    });
  });

  // ---- Mycelium Might (510) ------------------------------------------------
  describe("Mycelium Might — status moves bypass type immunities", () => {
    it("Thunder Wave is no longer 0x against a Ground type (type-chart bypass)", async () => {
      game.override.ability(Ability.MYCELIUM_MIGHT).enemySpecies(SpeciesId.SANDSHREW); // Ground
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      expect(enemy.getMoveEffectiveness(player, allMoves[MoveId.THUNDER_WAVE])).toBeGreaterThan(0);
    });

    it("a powder move (Spore) is no longer 0x against a Grass type", async () => {
      game.override.ability(Ability.MYCELIUM_MIGHT).enemySpecies(SpeciesId.ODDISH); // Grass
      await game.classicMode.startBattle(SpeciesId.PARAS);
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      expect(enemy.getMoveEffectiveness(player, allMoves[MoveId.SPORE])).toBeGreaterThan(0);
    });

    it("Toxic can poison a Steel type (status-application immunity bypass)", async () => {
      game.override.ability(Ability.MYCELIUM_MIGHT).enemySpecies(SpeciesId.MAGNEMITE); // Steel
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      expect(enemy.canSetStatus(StatusEffect.TOXIC, true, false, player)).toBe(true);
    });

    it("Will-O-Wisp can burn a Fire type", async () => {
      game.override.ability(Ability.MYCELIUM_MIGHT).enemySpecies(SpeciesId.VULPIX); // Fire
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      expect(enemy.canSetStatus(StatusEffect.BURN, true, false, player)).toBe(true);
    });

    it("a DAMAGING move does NOT bypass a type immunity (status-category gate)", async () => {
      game.override.ability(Ability.MYCELIUM_MIGHT).enemySpecies(SpeciesId.SANDSHREW); // Ground
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      const player = game.scene.getPlayerField()[0];
      const enemy = game.scene.getEnemyField()[0];
      // Thunderbolt is SPECIAL: Ground stays immune (only STATUS moves bypass).
      expect(enemy.getMoveEffectiveness(player, allMoves[MoveId.THUNDERBOLT])).toBe(0);
    });
  });
});
