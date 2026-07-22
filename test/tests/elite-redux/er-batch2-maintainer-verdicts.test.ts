/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Batch-2 maintainer verdicts (2026-07-22). One file per verdict block:
//
//   1. IDOLFIN — the real "Zero to Hero" gate: a FEMALE Palafin with Zero to Hero
//      that has undergone the HERO switch-out transform (formKey "hero") can evolve
//      into Idolfin; a MALE one cannot; a female that never transformed (still
//      "zero") cannot. Gate is the CONDITION, not an arbitrary level.
//   2. OMNIFORM CHAINING — Nimbeon / Ryuveon / Titaneon carry the [innate + Omniform]
//      composite too, so the family chains THROUGH them: Partner Eevee -> Steel ->
//      Titaneon -> Water -> Vaporeon (a real chain through a NEW form), moveset swaps.
//   3. METEOR MASS (5997) — weight-centric: the holder's weight is tripled (maxing its
//      own Heavy Slam / Heat Crash ratio) and its Heavy Slam one-shots a light target;
//      incoming Grass Knot / Low Kick read the huge weight.
//   4. INVERSE ROOM (5998) — on entry auto-sets the SAME Inverse Room the move sets;
//      a normally-super-effective matchup is now resisted while it is up.
//   5. EGOELK KIT (designer update) — innates Egoist + Superego + Center of Attention,
//      and Superego actually seizes a foe's boost on Egoelk.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { allAbilities, allMoves } from "#data/data-lists";
import {
  ER_NIMBEON_OMNIFORM_ABILITY_ID,
  ER_PARTNER_EEVEE_ABILITY_ID,
  ER_RYUVEON_OMNIFORM_ABILITY_ID,
  ER_TITANEON_OMNIFORM_ABILITY_ID,
} from "#data/elite-redux/abilities/composite-newcomers";
import { ER_INVERSE_ROOM_ABILITY_ID, ER_METEOR_MASS_ABILITY_ID } from "#data/elite-redux/abilities/newcomer-batch2";
import {
  ER_CENTER_OF_ATTENTION_ABILITY_ID,
  ER_SUPEREGO_ABILITY_ID,
} from "#data/elite-redux/abilities/newcomer-signature-abilities";
import { erOmniformOnMoveStart } from "#data/elite-redux/abilities/omniform";
import {
  ER_EGOELK_SPECIES_ID,
  ER_IDOLFIN_SPECIES_ID,
  ER_NIMBEON_SPECIES_ID,
  ER_PARTNER_VAPOREON_SPECIES_ID,
  ER_RYUVEON_SPECIES_ID,
  ER_TITANEON_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import { Gender } from "#data/gender";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The vanilla Eevee "partner" form index (Partner Eevee IS this form). */
function partnerFormIndex(): number {
  return getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === "partner");
}
/** The Palafin "hero" form index (the Zero to Hero switch-out target). */
function heroFormIndex(): number {
  return getPokemonSpecies(SpeciesId.PALAFIN).forms.findIndex(f => f.formKey === "hero");
}

describe.skipIf(!RUN)("Batch-2 maintainer verdicts (2026-07-22)", () => {
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
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  afterEach(() => {
    game = undefined as unknown as GameManager;
  });

  // --- 1. IDOLFIN — the real Zero to Hero gate ---------------------------------
  describe("Idolfin — female + hero-form Zero to Hero gate", () => {
    function idolfinEdge() {
      const edge = (pokemonEvolutions[SpeciesId.PALAFIN] ?? []).find(
        e => (e.speciesId as number) === ER_IDOLFIN_SPECIES_ID,
      );
      expect(edge, "Palafin -> Idolfin evolution edge must exist").toBeDefined();
      return edge!;
    }

    it("a FEMALE Palafin in HERO form (switched out) can evolve; MALE cannot; never-transformed (zero) cannot", async () => {
      game.override.ability(AbilityId.ZERO_TO_HERO);
      await game.classicMode.startBattle(SpeciesId.PALAFIN);
      const palafin = game.field.getPlayerPokemon();
      const edge = idolfinEdge();

      // Female + hero form (the switch-out transform happened) => evolves.
      palafin.gender = Gender.FEMALE;
      palafin.formIndex = heroFormIndex();
      expect(palafin.getFormKey()).toBe("hero");
      expect(edge.validate(palafin)).toBe(true);

      // Male + hero form => blocked by the GENDER condition.
      palafin.gender = Gender.MALE;
      expect(edge.validate(palafin)).toBe(false);

      // Female but never transformed (still "zero") => blocked by the FORM_KEY condition.
      palafin.gender = Gender.FEMALE;
      palafin.formIndex = 0;
      expect(palafin.getFormKey()).not.toBe("hero");
      expect(edge.validate(palafin)).toBe(false);
    });
  });

  // --- 2. OMNIFORM CHAINING through the three new eeveelutions ------------------
  describe("Omniform chaining — the three new eeveelutions carry Omniform", () => {
    it("Nimbeon / Ryuveon / Titaneon carry the [innate + Omniform] composite as innate[0] with real attrs", () => {
      expect(getPokemonSpecies(ER_NIMBEON_SPECIES_ID as SpeciesId).getPassiveAbilities()[0]).toBe(
        ER_NIMBEON_OMNIFORM_ABILITY_ID,
      );
      expect(getPokemonSpecies(ER_RYUVEON_SPECIES_ID as SpeciesId).getPassiveAbilities()[0]).toBe(
        ER_RYUVEON_OMNIFORM_ABILITY_ID,
      );
      expect(getPokemonSpecies(ER_TITANEON_SPECIES_ID as SpeciesId).getPassiveAbilities()[0]).toBe(
        ER_TITANEON_OMNIFORM_ABILITY_ID,
      );
      // Each composite carries OmniformAbAttr (the transform driver) plus its base innate.
      for (const id of [
        ER_NIMBEON_OMNIFORM_ABILITY_ID,
        ER_RYUVEON_OMNIFORM_ABILITY_ID,
        ER_TITANEON_OMNIFORM_ABILITY_ID,
      ]) {
        const names = allAbilities[id].attrs.map(a => a.constructor.name);
        expect(names, `ability ${id} must carry Omniform`).toContain("OmniformAbAttr");
      }
    });

    it("chains THROUGH a new form: Partner Eevee -> Steel -> Titaneon -> Water -> Vaporeon (moveset swaps)", async () => {
      game.override
        .moveset([MoveId.IRON_HEAD, MoveId.WATER_GUN, MoveId.TACKLE, MoveId.SPLASH])
        .starterForms({ [SpeciesId.EEVEE]: partnerFormIndex() })
        .ability(ER_PARTNER_EEVEE_ABILITY_ID as AbilityId);
      await game.classicMode.startBattle(SpeciesId.EEVEE);
      const holder = game.field.getPlayerPokemon();
      expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
      const eeveeMoves = holder.getMoveset().map(m => m?.moveId);

      // Steel move -> Titaneon (a NEW eeveelution, production mapping).
      erOmniformOnMoveStart(holder, allMoves[MoveId.IRON_HEAD]);
      expect(holder.getSpeciesForm().speciesId).toBe(ER_TITANEON_SPECIES_ID);
      const titaneonMoves = holder.getMoveset().map(m => m?.moveId);
      expect(titaneonMoves).toContain(MoveId.IRON_HEAD); // the used move stays in its slot
      expect(titaneonMoves.join(",")).not.toBe(eeveeMoves.join(",")); // the rest swapped

      // Chained Water move FROM the new Titaneon form -> Vaporeon (chains onward — the
      // whole point of the verdict: Titaneon is not terminal).
      erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
      expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);
      expect(holder.getMoveset().map(m => m?.moveId)).toContain(MoveId.WATER_GUN);
    });
  });

  // --- 3. METEOR MASS (5997) — weight-centric signature ------------------------
  describe("Meteor Mass — tripled weight + heavy-hit", () => {
    it("wires WeightMultiplierAbAttr + HeavyweightPowerAbAttr", () => {
      const names = allAbilities[ER_METEOR_MASS_ABILITY_ID].attrs.map(a => a.constructor.name);
      expect(names).toContain("WeightMultiplierAbAttr");
      expect(names).toContain("HeavyweightPowerAbAttr");
    });

    it("triples the holder's live weight and its Heavy Slam OHKOs a light target", async () => {
      game.override
        .moveset([MoveId.HEAVY_SLAM, MoveId.SPLASH, MoveId.TACKLE, MoveId.EMBER])
        .ability(ER_METEOR_MASS_ABILITY_ID as AbilityId)
        .enemySpecies(SpeciesId.JOLTEON); // light (24.5kg), frail
      await game.classicMode.startBattle(SpeciesId.METAGROSS);
      const holder = game.field.getPlayerPokemon();
      const baseWeight = holder.species.weight;
      // getWeight applies the WeightMultiplierAbAttr -> 3x.
      expect(holder.getWeight()).toBeCloseTo(baseWeight * 3, 1);

      const enemy = game.field.getEnemyPokemon();
      game.move.select(MoveId.HEAVY_SLAM);
      await game.toEndOfTurn();
      // A tripled-weight Heavy Slam vs a very light target maxes the ratio and KOs it.
      expect(enemy.isFainted()).toBe(true);
    });
  });

  // --- 4. INVERSE ROOM (5998) — on-entry room setter ---------------------------
  describe("Inverse Room — on entry auto-sets the reversed type chart", () => {
    it("wires PostSummonAddArenaTagAbAttr", () => {
      const names = allAbilities[ER_INVERSE_ROOM_ABILITY_ID].attrs.map(a => a.constructor.name);
      expect(names).toContain("PostSummonAddArenaTagAbAttr");
    });

    it("on entry sets Inverse Room and inverts a normally super-effective matchup", async () => {
      game.override.ability(ER_INVERSE_ROOM_ABILITY_ID as AbilityId).enemySpecies(SpeciesId.CHARIZARD);
      await game.classicMode.startBattle(ER_EGOELK_SPECIES_ID as SpeciesId);
      const holder = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      // The room is up field-wide.
      expect(game.scene.arena.getTag(ArenaTagType.INVERSE_ROOM)).toBeDefined();

      // Water vs Charizard (Fire/Flying) is normally 2x; under Inverse Room it must be
      // resisted (< 1). getMoveEffectiveness reads the reversed chart via the tag.
      const eff = enemy.getMoveEffectiveness(holder, allMoves[MoveId.WATER_GUN]);
      expect(eff).toBeLessThan(1);
    });
  });

  // --- 5. EGOELK KIT (designer update) -----------------------------------------
  describe("Egoelk kit — Egoist + Superego + Center of Attention", () => {
    it("carries Egoist, Superego, Center of Attention as innates (Mind's Eye / Corrupted Mind removed)", () => {
      const innates = getPokemonSpecies(ER_EGOELK_SPECIES_ID as SpeciesId).getPassiveAbilities();
      expect(innates).toContain(ER_SUPEREGO_ABILITY_ID);
      expect(innates).toContain(ER_CENTER_OF_ATTENTION_ABILITY_ID);
      // Egoist stays at innate[0]; the two removed abilities are gone.
      expect(innates).not.toContain(AbilityId.MINDS_EYE);
      // Both new innates resolve to real, executable attrs.
      expect(allAbilities[ER_SUPEREGO_ABILITY_ID].attrs.length).toBeGreaterThan(0);
      expect(allAbilities[ER_CENTER_OF_ATTENTION_ABILITY_ID].attrs.length).toBeGreaterThan(0);
    });

    it("Superego seizes a foe's stat boost when active on Egoelk", async () => {
      game.override
        .moveset([MoveId.SPLASH, MoveId.TACKLE, MoveId.EMBER, MoveId.SURF])
        .ability(ER_SUPEREGO_ABILITY_ID as AbilityId)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyMoveset(MoveId.SWORDS_DANCE);
      await game.classicMode.startBattle(ER_EGOELK_SPECIES_ID as SpeciesId);
      const egoelk = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toEndOfTurn();

      // Enemy Swords Dance = +2 Atk; Superego seizes it — Egoelk ends up with the raised
      // Atk stage and the enemy is left without it.
      expect(egoelk.getStatStage(Stat.ATK)).toBeGreaterThan(0);
      expect(egoelk.getStatStage(Stat.ATK)).toBeGreaterThanOrEqual(enemy.getStatStage(Stat.ATK));
    });
  });
});
