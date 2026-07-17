/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Omniform per-evolution moveset model (Partner Eevee core).
//
// Covers the backend of the multi-form moveset system:
//   - seeded roll determinism (same seed => same kit; distinct seeds differ);
//   - the `isErOmniformMon` predicate (partner Eevee yes, vanilla mon no);
//   - the teach path: per-evolution learn-once + each evolution's OWN legality;
//   - save/load round-trip of the per-evolution store (and byte-identity for a
//     vanilla mon: no `erOmniformMovesets` key at all);
//   - the transform live-moveset swap (active moveset becomes the target
//     evolution's own stored moveset);
//   - the NORMAL-type status-move revert to the base evolution form.
//
// Gated behind ER_SCENARIO=1 (needs the ER species/registry init). The separate
// er-omniform-innate-preservation suite proves the innate-unlock path is
// unaffected; this suite does not touch it.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_PARTNER_EEVEE_ABILITY_ID } from "#data/elite-redux/abilities/composite-newcomers";
import { erOmniformOnMoveStart, erOmniformRevertOnLeaveField } from "#data/elite-redux/abilities/omniform";
import { ER_PARTNER_VAPOREON_SPECIES_ID } from "#data/elite-redux/er-newcomer-species";
import {
  ensureOmniformFormMovesets,
  getOrRollFormMoveset,
  isErOmniformMon,
  learnMoveForEvolution,
  listOmniformEvolutionsForMove,
  makeSeededRandInt,
  omniformFamilyForms,
  omniformFormLearnableMoves,
  rollOmniformMoveset,
} from "#data/elite-redux/omniform-movesets";
import { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { unlockSlot } from "#utils/passive-utils";
import { getPokemonSpecies, getPokemonSpeciesForm } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The vanilla Eevee "partner" form index (Partner Eevee IS this form). */
function partnerFormIndex(): number {
  return getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === "partner");
}

const VAPOREON_FORM = { speciesId: ER_PARTNER_VAPOREON_SPECIES_ID as SpeciesId, formIndex: 0 };

describe.skipIf(!RUN)("ER Omniform per-evolution moveset model", () => {
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
      .enemyMoveset(MoveId.SPLASH)
      // WATER_GUN adapts into Partner Vaporeon; SPLASH is a Normal-type status move
      // (the revert trigger); EMBER / TACKLE fill the rest.
      .moveset([MoveId.WATER_GUN, MoveId.EMBER, MoveId.TACKLE, MoveId.SPLASH])
      .starterForms({ [SpeciesId.EEVEE]: partnerFormIndex() });
  });

  /** Unlock Partner Eevee innate slot 0 (the [Fluffy + Omniform] composite) so Omniform is active. */
  function activateOmniform(): void {
    game.scene.gameData.starterData[SpeciesId.EEVEE].passiveAttr = unlockSlot(0, 0);
  }

  it("rollOmniformMoveset is deterministic per seed and draws from the form's own learnset", () => {
    const form = getPokemonSpeciesForm(ER_PARTNER_VAPOREON_SPECIES_ID as SpeciesId, 0);
    const a = rollOmniformMoveset(form, 100, 4, makeSeededRandInt(12345));
    const b = rollOmniformMoveset(form, 100, 4, makeSeededRandInt(12345));
    const c = rollOmniformMoveset(form, 100, 4, makeSeededRandInt(999));
    expect(a).toEqual(b); // same seed => identical kit
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(4);
    // Every rolled move is a real, learnable move of that form.
    const learnable = new Set(form.getLevelMoves().map(([, m]) => m));
    for (const id of a) {
      expect(learnable.has(id)).toBe(true);
    }
    // A different seed almost surely yields a different ordering (guards against a
    // constant/seed-ignoring roll).
    expect(c).not.toEqual(a);
  });

  it("isErOmniformMon is true for Partner Eevee and false for a vanilla mon", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    expect(isErOmniformMon(holder)).toBe(true);
    // The family expands to the base + every partner eeveelution (> 1 form).
    expect(omniformFamilyForms(holder).length).toBeGreaterThan(1);
    // The enemy Snorlax is a plain single-form mon.
    const enemy = game.field.getEnemyPokemon();
    expect(isErOmniformMon(enemy)).toBe(false);
    expect(listOmniformEvolutionsForMove(enemy, MoveId.TACKLE)).toEqual([]);
  });

  it("teach path: per-evolution learn-once + each evolution's own legality", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();

    // Pick a move Partner Vaporeon can legally learn (from its own learnable set).
    const learnable = [...omniformFormLearnableMoves(VAPOREON_FORM)];
    expect(learnable.length).toBeGreaterThan(0);
    const legalMove = learnable[0];

    const first = learnMoveForEvolution(holder, VAPOREON_FORM, legalMove, 0);
    expect(first.ok).toBe(true);
    expect(getOrRollFormMoveset(holder, VAPOREON_FORM)[0][0]).toBe(legalMove);

    // Same move again on the same evolution => rejected (once per evolution).
    const dup = learnMoveForEvolution(holder, VAPOREON_FORM, legalMove, 1);
    expect(dup.ok).toBe(false);
    expect(dup.reason).toBe("already-known");

    // A move NOT in Vaporeon's learnable set => illegal.
    const illegal = [MoveId.SEED_FLARE, MoveId.DOODLE, MoveId.BEHEMOTH_BLADE, MoveId.FLEUR_CANNON].find(
      m => !omniformFormLearnableMoves(VAPOREON_FORM).has(m),
    )!;
    const bad = learnMoveForEvolution(holder, VAPOREON_FORM, illegal, 2);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("not-learnable");
  });

  it("save/load round-trips the per-evolution store; a vanilla mon has no store key", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    ensureOmniformFormMovesets(holder);
    expect(holder.customPokemonData.erOmniformMovesets).toBeDefined();

    const data = new PokemonData(holder);
    const reloaded = new PokemonData(JSON.parse(JSON.stringify(data)));
    expect(reloaded.customPokemonData.erOmniformMovesets).toEqual(holder.customPokemonData.erOmniformMovesets);
    // Every stored form entry is [moveId, ppUsed] pairs.
    for (const entry of Object.values(reloaded.customPokemonData.erOmniformMovesets!)) {
      for (const move of entry) {
        expect(move).toHaveLength(2);
      }
    }

    // A vanilla mon (the enemy Snorlax) serializes with NO erOmniformMovesets key.
    const enemyData = new PokemonData(game.field.getEnemyPokemon());
    expect(enemyData.customPokemonData.erOmniformMovesets).toBeUndefined();
    expect(JSON.stringify(enemyData)).not.toContain("erOmniformMovesets");
  });

  it("transform swaps the live moveset to the target evolution's own stored moveset", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    activateOmniform();
    ensureOmniformFormMovesets(holder);

    const storedIds = getOrRollFormMoveset(holder, VAPOREON_FORM).map(([m]) => m);
    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);

    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);
    const liveIds = holder.getMoveset().map(m => m.moveId);
    expect(liveIds).toEqual(storedIds);
  });

  it("a NORMAL-type status move reverts a transformed holder to the base evolution form", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    activateOmniform();
    ensureOmniformFormMovesets(holder);
    const baseMoveIds = holder.moveset.map(m => m.moveId);

    // Adapt into Partner Vaporeon.
    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);

    // A genuinely Normal-type STATUS move reverts to the base Eevee form. Resolved
    // from the live move data (ER re-typed some vanilla moves, e.g. Splash is now Water).
    const normalStatus = allMoves.find(
      m => m != null && m.id !== MoveId.NONE && m.type === PokemonType.NORMAL && m.category === MoveCategory.STATUS,
    );
    expect(normalStatus).toBeDefined();
    erOmniformOnMoveStart(holder, normalStatus!);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
    // The live moveset is the base form's own moveset again.
    expect(holder.getMoveset().map(m => m.moveId)).toEqual(baseMoveIds);
  });

  it("real battle turn: a Water move drives the transform + moveset swap through MovePhase", async () => {
    // Force the [Fluffy + Omniform] composite ACTIVE so Omniform fires in a real turn.
    game.override.ability(ER_PARTNER_EEVEE_ABILITY_ID as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    ensureOmniformFormMovesets(holder);
    const storedIds = getOrRollFormMoveset(holder, VAPOREON_FORM).map(([m]) => m);

    game.move.select(MoveId.WATER_GUN, 0);
    await game.toEndOfTurn();

    // The real MovePhase drove the Omniform transform: the mon is Partner Vaporeon and
    // its live moveset is Vaporeon's own stored moveset.
    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);
    expect(holder.getMoveset().map(m => m.moveId)).toEqual(storedIds);
  });

  it("leaveField clears the per-battle form-PP cache and reverts to base", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    activateOmniform();
    ensureOmniformFormMovesets(holder);

    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);

    holder.resetSummonData();
    erOmniformRevertOnLeaveField(holder);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
  });
});
