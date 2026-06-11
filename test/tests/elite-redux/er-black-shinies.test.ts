/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#349) — ER Black Shinies (t4 ultra-rare tier):
//  - the kit re-rolls the 3 innate slots from the APPROVED pool and rolls a
//    3-choice GIFT slot (disjoint from the innates);
//  - the active gift flows through getPassiveAbilities (combat + UI);
//  - the gift is SHARED with the on-field ally in doubles, and only there;
//  - gift cycling switches the active choice;
//  - max ONE black shiny per player team (second roll never upgrades);
//  - all state persists through CustomPokemonData round-trips.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import Overrides from "#app/overrides";
import {
  applyErBlackShinyKit,
  cycleErGiftAbility,
  ER_BLACK_SHINY_ABILITY_POOL,
  getErActiveGiftAbilityId,
  getErSharedGiftAbilityIdsFor,
  isErBlackShiny,
  maybeUpgradeToErBlackShiny,
  playerHasErBlackShiny,
} from "#data/elite-redux/er-black-shinies";
import { CustomPokemonData } from "#data/pokemon/pokemon-data";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Black Shinies (#349)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  describe("singles", () => {
    beforeEach(async () => {
      game = new GameManager(phaserGame);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
    });

    it("the approved pool is large and deduped", () => {
      expect(ER_BLACK_SHINY_ABILITY_POOL.length).toBeGreaterThanOrEqual(120);
      expect(new Set(ER_BLACK_SHINY_ABILITY_POOL).size).toBe(ER_BLACK_SHINY_ABILITY_POOL.length);
    });

    it("the kit rolls ONLY the gift (3 distinct pool choices) — innates stay untouched", () => {
      const mon = game.scene.getPlayerPokemon()!;
      const innatesBefore = mon
        .getPassiveAbilities()
        .slice(0, 3)
        .map(a => a?.id);
      const overridesBefore = [
        mon.customPokemonData.passive,
        mon.customPokemonData.passive2,
        mon.customPokemonData.passive3,
      ];

      applyErBlackShinyKit(mon);
      expect(isErBlackShiny(mon)).toBe(true);

      const data = mon.customPokemonData;
      // Maintainer rule: the normal ability + 3 innates are NOT modified.
      expect([data.passive, data.passive2, data.passive3]).toEqual(overridesBefore);
      expect(
        mon
          .getPassiveAbilities()
          .slice(0, 3)
          .map(a => a?.id),
      ).toEqual(innatesBefore);

      // The gift: 3 distinct choices, all from the approved pool.
      expect(data.erGiftAbilities).toHaveLength(3);
      expect(new Set(data.erGiftAbilities).size).toBe(3);
      for (const id of data.erGiftAbilities) {
        expect(ER_BLACK_SHINY_ABILITY_POOL).toContain(id);
      }

      // Idempotent: re-applying must not re-roll.
      const before = [...data.erGiftAbilities];
      applyErBlackShinyKit(mon);
      expect(data.erGiftAbilities).toEqual(before);
    });

    it("the Ability Randomizer can never target the gift slot", () => {
      const mon = game.scene.getPlayerPokemon()!;
      applyErBlackShinyKit(mon);
      const gift = getErActiveGiftAbilityId(mon)!;

      // The gift IS active (in the passive flow)...
      expect(mon.getPassiveAbilities().map(a => a?.id)).toContain(gift);
      // ...but the Randomizer's selectable slots (0-3) never include it.
      const slots = mon.getAbilitySlots();
      expect(slots.length).toBeLessThanOrEqual(4);
      expect(slots.map(s => s.ability.id)).not.toContain(gift);
    });

    it("the ACTIVE gift flows through getPassiveAbilities; cycling switches it", () => {
      const mon = game.scene.getPlayerPokemon()!;
      applyErBlackShinyKit(mon);

      const active = getErActiveGiftAbilityId(mon)!;
      expect(mon.customPokemonData.erGiftAbilities[0]).toBe(active);
      const passiveIds = mon.getPassiveAbilities().map(a => a?.id);
      expect(passiveIds).toContain(active);

      const next = cycleErGiftAbility(mon)!;
      expect(next).toBe(mon.customPokemonData.erGiftAbilities[1]);
      expect(next).not.toBe(active);
      expect(mon.getPassiveAbilities().map(a => a?.id)).toContain(next);
      // Full cycle wraps around.
      cycleErGiftAbility(mon);
      expect(cycleErGiftAbility(mon)).toBe(active);
    });

    it("max ONE black shiny per player team — a second roll never upgrades", () => {
      const mon = game.scene.getPlayerPokemon()!;
      applyErBlackShinyKit(mon);
      expect(playerHasErBlackShiny()).toBe(true);

      const enemy = game.scene.getEnemyPokemon()!;
      // (enemy upgrades are unaffected by the player cap)
      enemy.shiny = true;
      enemy.variant = 2;
      // For a PLAYER mon the cap short-circuits before any RNG:
      const second = game.scene.getPlayerParty()[0]; // same party slot is fine for the guard
      const fresh = Object.create(Object.getPrototypeOf(second)) as typeof second;
      Object.assign(fresh, second, { customPokemonData: new CustomPokemonData() });
      fresh.shiny = true;
      fresh.variant = 2;
      expect(maybeUpgradeToErBlackShiny(fresh)).toBe(false);
      expect(isErBlackShiny(fresh)).toBe(false);
    });

    it("state survives a CustomPokemonData round-trip (save/load channel)", () => {
      const mon = game.scene.getPlayerPokemon()!;
      applyErBlackShinyKit(mon);
      cycleErGiftAbility(mon); // erGiftIndex = 1

      const copy = new CustomPokemonData(mon.customPokemonData);
      expect(copy.erBlackShiny).toBe(true);
      expect(copy.erGiftAbilities).toEqual(mon.customPokemonData.erGiftAbilities);
      expect(copy.erGiftIndex).toBe(1);
      expect(copy.passive).toBe(mon.customPokemonData.passive);
      expect(copy.passive2).toBe(mon.customPokemonData.passive2);
      expect(copy.passive3).toBe(mon.customPokemonData.passive3);
    });
  });

  describe("doubles — gift sharing", () => {
    beforeEach(async () => {
      game = new GameManager(phaserGame);
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.JIGGLYPUFF, SpeciesId.SNORLAX);
    });

    it("the black shiny's active gift is shared with its on-field ally (and only on field)", () => {
      const [puff, lax] = game.scene.getPlayerField();
      applyErBlackShinyKit(puff);
      const gift = getErActiveGiftAbilityId(puff)!;

      // The NON-black ally receives the gift while both are on the field.
      expect(getErSharedGiftAbilityIdsFor(lax)).toContain(gift);
      expect(lax.getPassiveAbilities().map(a => a?.id)).toContain(gift);

      // The black shiny itself has it too, once (no duplicates).
      const ownIds = puff.getPassiveAbilities().map(a => a?.id);
      expect(ownIds.filter(id => id === gift)).toHaveLength(1);

      // Cycling the gift updates what the ally sees.
      const next = cycleErGiftAbility(puff)!;
      expect(getErSharedGiftAbilityIdsFor(lax)).toContain(next);
      expect(getErSharedGiftAbilityIdsFor(lax)).not.toContain(gift);
    });

    it("sharing is ONE-WAY: the non-black ally's abilities never flow to the black shiny", () => {
      const [puff, lax] = game.scene.getPlayerField();
      applyErBlackShinyKit(puff);

      // The black shiny's extra abilities = exactly its own active gift.
      expect(getErSharedGiftAbilityIdsFor(puff)).toEqual([getErActiveGiftAbilityId(puff)]);

      // None of the ally's REAL abilities (active or innates) leak onto the
      // black shiny through the gift channel.
      const laxIds = [
        lax.getAbility().id,
        ...lax
          .getPassiveAbilities()
          .slice(0, 3)
          .map(a => a?.id),
      ].filter(Boolean);
      const puffPassiveIds = puff.getPassiveAbilities().map(a => a?.id);
      const puffOwnBase = [
        puff.getAbility().id,
        ...puff
          .getPassiveAbilities()
          .slice(0, 3)
          .map(a => a?.id),
        getErActiveGiftAbilityId(puff),
      ];
      for (const id of puffPassiveIds) {
        if (id == null) {
          continue;
        }
        if (!puffOwnBase.includes(id)) {
          expect(laxIds).not.toContain(id);
        }
      }

      // And the battle-level check: the ally HAS the gift via the full gating
      // pipeline (hasAbility -> canApplyAbility -> gift slot exemptions).
      const gift = getErActiveGiftAbilityId(puff)!;
      expect(lax.hasAbility(gift as never)).toBe(true);
    });
  });

  describe("generation-time dev override (dev suite spawn-speed fix)", () => {
    type MutableErBlackOverrides = {
      ER_BLACK_SHINY_ENEMY_OVERRIDE: SpeciesId | null;
      ER_BLACK_SHINY_PLAYER_OVERRIDE: SpeciesId | null;
    };
    const O = Overrides as unknown as MutableErBlackOverrides;

    beforeEach(() => {
      game = new GameManager(phaserGame);
    });

    afterEach(() => {
      O.ER_BLACK_SHINY_ENEMY_OVERRIDE = null;
      O.ER_BLACK_SHINY_PLAYER_OVERRIDE = null;
    });

    it("forces the enemy black at GENERATION - black atlas resolves before the first frame", async () => {
      O.ER_BLACK_SHINY_ENEMY_OVERRIDE = SpeciesId.GARDEVOIR;
      game.override.enemySpecies(SpeciesId.GARDEVOIR);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      const enemy = game.scene.getEnemyPokemon()!;
      expect(isErBlackShiny(enemy)).toBe(true);
      expect(enemy.shiny).toBe(true);
      expect(enemy.variant).toBe(2);
      // The black atlas IS the initial atlas (no post-summon swap needed).
      expect(enemy.getSpriteAtlasPath()).toMatch(/^black\//);
      // Only the targeted species/side is affected.
      expect(isErBlackShiny(game.scene.getPlayerPokemon()!)).toBe(false);
    });

    it("#393: a REDUX-FORM black shiny resolves the real black slug atlas, not the tint placeholder", async () => {
      O.ER_BLACK_SHINY_PLAYER_OVERRIDE = SpeciesId.RALTS;
      await game.classicMode.startBattle(SpeciesId.RALTS);

      const player = game.scene.getPlayerPokemon()!;
      expect(isErBlackShiny(player)).toBe(true);
      // Move it onto its Redux form (slug-based sprite scheme).
      const reduxIndex = player.species.forms.findIndex(f => f.formKey === "redux");
      expect(reduxIndex).toBeGreaterThan(-1);
      player.formIndex = reduxIndex;

      // Black shinies are SHINY, so the naive base path is the shiny slug path
      // (elite-redux/ralts_redux/shiny-3) which is NOT a manifest key - the
      // lookup must use the plain front/back path instead. Before the fix this
      // returned the shiny path and the mon rendered with the tint placeholder.
      expect(player.getSpriteAtlasPath()).toBe("black/elite-redux/ralts_redux/front");
      expect(player.getBattleSpriteAtlasPath(true)).toBe("black/elite-redux/ralts_redux/back");
      expect(player.getSpriteKey()).toMatch(/-erblack$/);
    });

    it("forces the player starter black at GENERATION (starters pass shiny explicitly)", async () => {
      O.ER_BLACK_SHINY_PLAYER_OVERRIDE = SpeciesId.SNORLAX;
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      const player = game.scene.getPlayerPokemon()!;
      expect(isErBlackShiny(player)).toBe(true);
      expect(player.shiny).toBe(true);
      expect(player.variant).toBe(2);
      expect(player.getSpriteAtlasPath()).toMatch(/^black\//);
      expect(isErBlackShiny(game.scene.getEnemyPokemon()!)).toBe(false);
    });
  });
});
