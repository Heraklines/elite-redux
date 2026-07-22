/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Omniform — pooled level-up learn union (Partner Eevee family).
//
// Partner Eevee switches between eeveelution forms via Omniform and can be in ANY
// form when it levels up, so EVERY family member (base Partner Eevee + all 8 partner
// eeveelutions) must be able to learn, on level-up, the UNION of every level-up move
// that ANY eeveelution learns — "so he doesn't have to be a Jolteon to learn a move
// that only Jolteon learns at level 30". This suite proves:
//   (a) the union is COMPLETE — a Jolteon-only Electric level-up move is pooled at
//       Jolteon's level and offered/learnable to the base form (not a Jolteon);
//   (b) SCOPING — the union NEVER leaks into vanilla Eevee/Jolteon: their level-up
//       tables stay byte-identical and their learnable sets gain nothing;
//   (c) representative form-specific moves of DIFFERENT types (Water / Electric /
//       Fire) are present in EVERY family member's offer + learnable set.
//
// Gated behind ER_SCENARIO=1 (needs the ER species/registry init).
// =============================================================================

import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { allMoves } from "#data/data-lists";
import {
  ER_NIMBEON_SPECIES_ID,
  ER_PARTNER_FLAREON_SPECIES_ID,
  ER_PARTNER_JOLTEON_SPECIES_ID,
  ER_PARTNER_VAPOREON_SPECIES_ID,
  ER_RYUVEON_SPECIES_ID,
  ER_TITANEON_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import {
  canFormLearnMove,
  isErOmniformMon,
  listOmniformEvolutionsForMove,
  omniformFamilyForms,
  omniformFormLearnableMoves,
  omniformUnionLevelMoves,
} from "#data/elite-redux/omniform-movesets";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { LevelUpPhase } from "#phases/level-up-phase";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies, getPokemonSpeciesForm } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The vanilla Eevee "partner" form index (Partner Eevee IS this form). */
function partnerFormIndex(): number {
  return getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === "partner");
}

/** The level-up move ids of a `(speciesId, formIndex)` form. */
function levelMoveIds(speciesId: number, formIndex: number): Set<MoveId> {
  return new Set(
    getPokemonSpeciesForm(speciesId as SpeciesId, formIndex)
      .getLevelMoves()
      .map(([, m]) => m),
  );
}

/**
 * Find a level-up move of `partnerId` (an eeveelution) of the given type that base
 * Eevee (the partner head) does NOT learn — a genuinely "form-specific" move.
 */
function formSpecificMove(partnerId: number, type: PokemonType): { move: MoveId; level: number } {
  const eeveeMoves = levelMoveIds(SpeciesId.EEVEE, partnerFormIndex());
  const found = getPokemonSpeciesForm(partnerId as SpeciesId, 0)
    .getLevelMoves()
    .find(([, m]) => m !== MoveId.NONE && allMoves[m]?.type === type && !eeveeMoves.has(m));
  expect(found, `expected a ${PokemonType[type]} level-up move unique to species ${partnerId}`).toBeDefined();
  return { move: found![1], level: found![0] };
}

describe.skipIf(!RUN)("ER Omniform pooled level-up learn union (Partner Eevee family)", () => {
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
      .starterForms({ [SpeciesId.EEVEE]: partnerFormIndex() });
  });

  it("(a) pools a Jolteon-only Electric level-up move at Jolteon's level, offered/learnable to the base form", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();

    const { move: jolteonMove, level } = formSpecificMove(ER_PARTNER_JOLTEON_SPECIES_ID, PokemonType.ELECTRIC);

    // The union pools the move at Jolteon's OWN level (min across the family — no other
    // eeveelution learns it, and base Eevee does not).
    const union = omniformUnionLevelMoves(holder);
    const entry = union.find(([, m]) => m === jolteonMove);
    expect(entry, "the Jolteon-only Electric move is in the family union").toBeDefined();
    expect(entry![0]).toBe(level);

    // "At the right level" — filtering the union to that level band offers the move.
    const offeredAtLevel = union.filter(([lvl]) => lvl === level).map(([, m]) => m);
    expect(offeredAtLevel).toContain(jolteonMove);

    // The BASE form (Partner Eevee — NOT a Jolteon) can learn it, and it appears as a
    // learnable per-evolution offer for the base form.
    const headForm = { speciesId: SpeciesId.EEVEE as SpeciesId, formIndex: partnerFormIndex() };
    expect(canFormLearnMove(headForm, jolteonMove)).toBe(true);

    const offers = listOmniformEvolutionsForMove(holder, jolteonMove);
    const baseOffer = offers.find(o => o.form.speciesId === SpeciesId.EEVEE);
    expect(baseOffer, "base Eevee appears in the per-evolution offers").toBeDefined();
    expect(baseOffer!.learnable).toBe(true);
  });

  it("(b) the union never leaks into vanilla Eevee/Jolteon level-up tables or learnability", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();

    const { move: jolteonMove } = formSpecificMove(ER_PARTNER_JOLTEON_SPECIES_ID, PokemonType.ELECTRIC);
    const { move: vaporeonMove } = formSpecificMove(ER_PARTNER_VAPOREON_SPECIES_ID, PokemonType.WATER);

    // Snapshot the shared vanilla level-up tables BEFORE exercising the union path.
    const vanillaEeveeBefore = JSON.stringify(pokemonSpeciesLevelMoves[SpeciesId.EEVEE]);
    const vanillaJolteonBefore = JSON.stringify(pokemonSpeciesLevelMoves[SpeciesId.JOLTEON]);

    // Exercise every union / learnable code path.
    omniformUnionLevelMoves(holder);
    for (const form of omniformFamilyForms(holder)) {
      omniformFormLearnableMoves(form);
    }
    canFormLearnMove({ speciesId: SpeciesId.JOLTEON, formIndex: 0 }, vaporeonMove);

    // The shared vanilla tables are byte-identical (the union is computed on the fly,
    // never written back into the level-up tables).
    expect(JSON.stringify(pokemonSpeciesLevelMoves[SpeciesId.EEVEE])).toBe(vanillaEeveeBefore);
    expect(JSON.stringify(pokemonSpeciesLevelMoves[SpeciesId.JOLTEON])).toBe(vanillaJolteonBefore);

    // Vanilla Eevee (form 0) does NOT gain the Jolteon-only move; vanilla Jolteon does
    // NOT gain a Vaporeon-only move — no cross-form leak into non-Omniform species.
    expect(levelMoveIds(SpeciesId.EEVEE, 0).has(jolteonMove)).toBe(false);
    expect(canFormLearnMove({ speciesId: SpeciesId.EEVEE, formIndex: 0 }, jolteonMove)).toBe(false);
    expect(canFormLearnMove({ speciesId: SpeciesId.JOLTEON, formIndex: 0 }, vaporeonMove)).toBe(false);

    // A plain vanilla mon has no pooled union at all.
    expect(omniformUnionLevelMoves(game.field.getEnemyPokemon())).toEqual([]);
  });

  it("(c) form-specific moves of different types are in every family member's offer + learnable set", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();

    const reps = [
      formSpecificMove(ER_PARTNER_VAPOREON_SPECIES_ID, PokemonType.WATER),
      formSpecificMove(ER_PARTNER_JOLTEON_SPECIES_ID, PokemonType.ELECTRIC),
      formSpecificMove(ER_PARTNER_FLAREON_SPECIES_ID, PokemonType.FIRE),
    ];

    const union = omniformUnionLevelMoves(holder);
    const unionIds = new Set(union.map(([, m]) => m));
    const family = omniformFamilyForms(holder);
    // Base Eevee + 8 partner eeveelutions + the three new eeveelutions Nimbeon /
    // Ryuveon / Titaneon (which now carry Omniform too — maintainer verdict 2026-07-22).
    expect(family.length).toBe(12);
    const familyIds = new Set(family.map(f => f.speciesId as number));
    for (const id of [ER_NIMBEON_SPECIES_ID, ER_RYUVEON_SPECIES_ID, ER_TITANEON_SPECIES_ID]) {
      expect(familyIds.has(id), `family includes ${id}`).toBe(true);
    }

    for (const { move } of reps) {
      // Present in the pooled union offer set.
      expect(unionIds.has(move)).toBe(true);
      // Learnable by EVERY family member (offer set), not just its owning form.
      for (const form of family) {
        expect(
          omniformFormLearnableMoves(form).has(move),
          `form ${form.speciesId}:${form.formIndex} can learn move ${move}`,
        ).toBe(true);
      }
    }
  });

  it("(d) a real LevelUpPhase hands the pooled union band to the batch panel for a partner mon", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const mon = game.field.getPlayerPokemon();
    expect(isErOmniformMon(mon)).toBe(true);

    // A Jolteon-only Electric move learned at level L (the mon sits at level 100, so
    // any L <= 100 is in range). We level FROM L-1, so the band [L, 100] must offer it.
    const { move: jolteonMove, level } = formSpecificMove(ER_PARTNER_JOLTEON_SPECIES_ID, PokemonType.ELECTRIC);

    // Capture what LevelUpPhase hands the batch panel WITHOUT advancing the real queue.
    const pm = game.scene.phaseManager;
    const captured: { name: string; args: unknown[] }[] = [];
    const origUnshift = pm.unshiftNew;
    const origShift = pm.shiftPhase;
    pm.unshiftNew = ((name: string, ...args: unknown[]) => {
      captured.push({ name, args });
    }) as typeof pm.unshiftNew;
    pm.shiftPhase = (() => {}) as typeof pm.shiftPhase;
    try {
      new LevelUpPhase(0, level - 1, mon.level).end();
    } finally {
      pm.unshiftNew = origUnshift;
      pm.shiftPhase = origShift;
    }

    const batch = captured.find(c => c.name === "LearnMoveBatchPhase");
    expect(batch, "LevelUpPhase unshifted a LearnMoveBatchPhase").toBeDefined();
    // args = (partyMemberIndex, candidateMoveIds) — the pooled union band.
    const candidateMoveIds = batch!.args[1] as MoveId[];
    expect(candidateMoveIds).toContain(jolteonMove);

    // Feeding those exact ids into the REAL batch phase yields a learnable base offer
    // for the Jolteon-only move (the whole point: no need to BE a Jolteon).
    const baseOffer = listOmniformEvolutionsForMove(mon, jolteonMove).find(o => o.form.speciesId === SpeciesId.EEVEE);
    expect(baseOffer?.learnable).toBe(true);
  });
});
