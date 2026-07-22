/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER newcomer patch — FULL integration sweep of every mon this patch added.
//
// Systematic (not spot-check) verification, per the maintainer directive, of:
//   - the 4 slug species (Tentalect 70001, Astoot 70002, Discupid 70003,
//     Regitube 70004),
//   - the 8 partner eeveelutions (70012-70019),
//   - the 12 mega/primal newcomer FORMS (ER_NEWCOMER_FORMS).
//
// For each, as far as is cheaply checkable headlessly:
//   (a) mini icon resolves via the shared UI accessor (save/party/starter/egg all
//       funnel through Pokemon.getIconAtlasKey/getIconId -> species/form override);
//   (b) TM learnset non-empty and a superset of the pre-evo/base; the entire
//       Partner Eevee family shares one unioned TM pool;
//   (c) level-up learnset non-empty;
//   (e) sprite atlas keys resolve front + back + shiny without throwing;
//   (f) cry key resolves without crashing (silent fallback is OK);
//   (g) evolution-only species + partners do NOT leak into starters/eggs;
//   (h) each mega/primal form exists on its base with a fully-resolving kit.
//
// (d) dex-registration-on-acquire and in-battle cry playback are exercised by the
// scenario runner / other suites; noted in the Pass A report table.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { speciesTmMoves } from "#balance/tms";
import { allAbilities } from "#data/data-lists";
import { ER_NEWCOMER_FORMS } from "#data/elite-redux/er-newcomer-forms";
import {
  ER_NEWCOMER_EVO_SPECIES,
  ER_PARTNER_FAMILY,
  ER_REGITUBE_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import { AbilityId } from "#enums/ability-id";
import type { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Plain (non-form-gated) move ids a species carries in the TM/tutor table. */
function plainTmMoves(speciesId: number): number[] {
  const entries = (speciesTmMoves as Record<number, (number | [unknown, number])[]>)[speciesId] ?? [];
  return entries.filter(e => !Array.isArray(e)) as number[];
}

/** Effective TM/tutor ids for one concrete form. */
function formTmMoves(speciesId: number, formKey: string): number[] {
  const entries = (speciesTmMoves as Record<number, (number | [unknown, number])[]>)[speciesId] ?? [];
  return entries.filter(e => !Array.isArray(e) || e[0] === formKey).map(e => (Array.isArray(e) ? e[1] : e));
}

describe.skipIf(!RUN)("ER newcomer patch — full integration sweep", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  // --- Evolution species (Tentalect / Astoot / Discupid) -------------------
  it("evolution species: icon, TM (pre-evo superset), level-up, cry, no starter/egg leak", () => {
    for (const def of ER_NEWCOMER_EVO_SPECIES) {
      const sp = getPokemonSpecies(def.speciesId);
      expect(sp, `${def.name} registered`).toBeDefined();

      // (a) icon via the shared accessor + the reconstructed-Pokemon (party) path.
      expect(sp.getIconAtlasKey(0, false, 0)).toBe(`er_icon__${def.slug}`);
      const mon = game.scene.addPlayerPokemon(sp, 50, undefined, 0);
      expect(mon.getIconAtlasKey()).toBe(`er_icon__${def.slug}`);

      // (b) TM: non-empty AND a superset of the pre-evo's TM set.
      const tm = plainTmMoves(def.speciesId);
      expect(tm.length, `${def.name} has TMs`).toBeGreaterThan(0);
      for (const preTm of plainTmMoves(def.evolvesFrom)) {
        expect(tm, `${def.name} inherits pre-evo TM ${preTm}`).toContain(preTm);
      }

      // (c) level-up learnset non-empty.
      expect((pokemonSpeciesLevelMoves as Record<number, unknown[]>)[def.speciesId]?.length ?? 0).toBeGreaterThan(0);

      // (e) sprite atlas keys resolve front + back + shiny without throwing.
      // getSpriteAtlasPath(female, formIndex, shiny, variant, back).
      expect(() => sp.getSpriteAtlasPath(false, 0, false, 0, false)).not.toThrow();
      expect(sp.getSpriteAtlasPath(false, 0, false, 0, false), "front").toBeTruthy();
      expect(sp.getSpriteAtlasPath(false, 0, false, 0, true), "back").toBeTruthy();
      expect(sp.getSpriteAtlasPath(false, 0, true, 0, false), "shiny").toBeTruthy();

      // (f) cry key resolves (silent fallback allowed) without crashing.
      expect(() => sp.getCryKey(0)).not.toThrow();
      expect(sp.getCryKey(0)).toBeTruthy();

      // (g) evolution-only: NOT a starter, NOT egg-obtainable (omission no-leak).
      expect(speciesStarterCosts[def.speciesId as SpeciesId], `${def.name} not a starter`).toBeUndefined();
      expect(speciesEggTiers[def.speciesId], `${def.name} not egg-obtainable`).toBeUndefined();

      mon.destroy();
    }
  });

  // --- Regitube (egg-obtainable standalone) --------------------------------
  it("Regitube: icon, hand TM set non-empty, level-up, IS egg-obtainable", () => {
    const sp = getPokemonSpecies(ER_REGITUBE_SPECIES_ID as SpeciesId);
    expect(sp).toBeDefined();
    expect(sp.getIconAtlasKey(0, false, 0)).toBe("er_icon__regitube");
    expect(plainTmMoves(ER_REGITUBE_SPECIES_ID).length, "Regitube has TMs").toBeGreaterThan(0);
    expect(
      (pokemonSpeciesLevelMoves as Record<number, unknown[]>)[ER_REGITUBE_SPECIES_ID]?.length ?? 0,
    ).toBeGreaterThan(0);
    // Regitube is egg-obtainable (custom-mons path) — the intended exception.
    expect(speciesEggTiers[ER_REGITUBE_SPECIES_ID], "Regitube IS egg-obtainable").toBeDefined();
  });

  // --- Partner Eevee family (head + 8 transformations) ---------------------
  it("Partner Eevee and all partner eeveelutions share one TM pool without leaking into ordinary Eevee", () => {
    const eevee = getPokemonSpecies(SpeciesId.EEVEE);
    const partnerFormIndex = eevee.forms.findIndex(form => form.formKey === "partner");
    expect(partnerFormIndex).toBeGreaterThanOrEqual(0);

    const partnerHeadTms = new Set(formTmMoves(SpeciesId.EEVEE, "partner"));
    const ordinaryEeveeTms = new Set(formTmMoves(SpeciesId.EEVEE, ""));
    expect(partnerHeadTms.size).toBeGreaterThan(ordinaryEeveeTms.size);

    for (const def of ER_PARTNER_FAMILY) {
      const sp = getPokemonSpecies(def.partnerId as SpeciesId);
      expect(sp, `partner ${def.partnerId} registered`).toBeDefined();

      // (a) icon resolves to a non-empty key (aliased to the base eeveelution art).
      expect(() => sp.getIconAtlasKey(0, false, 0)).not.toThrow();
      expect(sp.getIconAtlasKey(0, false, 0)).toBeTruthy();

      // (b) TM: every partner has the exact same family union, including the
      // corresponding vanilla eeveelution's complete pool.
      const tm = new Set(plainTmMoves(def.partnerId));
      expect(tm, `partner ${def.partnerId} has the family TM union`).toEqual(partnerHeadTms);
      for (const baseTm of plainTmMoves(def.base)) {
        expect(tm.has(baseTm), `partner ${def.partnerId} inherits base TM ${baseTm}`).toBe(true);
      }

      // (c) level-up non-empty.
      expect((pokemonSpeciesLevelMoves as Record<number, unknown[]>)[def.partnerId]?.length ?? 0).toBeGreaterThan(0);

      // (g) partner clones are NOT starters / eggs (they are a form-alias family).
      expect(speciesStarterCosts[def.partnerId as SpeciesId]).toBeUndefined();
      expect(speciesEggTiers[def.partnerId]).toBeUndefined();
    }

    // Exercise the live TM-item path as well as the transposed data table. The
    // partner head and a partner evolution receive identical actual-TM lists;
    // ordinary Eevee does not receive the partner-only additions.
    const ordinary = game.scene.addPlayerPokemon(eevee, 50, undefined, 0);
    const partnerHead = game.scene.addPlayerPokemon(eevee, 50, undefined, partnerFormIndex);
    const partnerEvolutionSpecies = getPokemonSpecies(ER_PARTNER_FAMILY[0].partnerId as SpeciesId);
    const partnerEvolution = game.scene.addPlayerPokemon(partnerEvolutionSpecies, 50, undefined, 0);
    ordinary.generateCompatibleTms();
    partnerHead.generateCompatibleTms();
    partnerEvolution.generateCompatibleTms();

    expect(new Set(partnerHead.compatibleTms)).toEqual(new Set(partnerEvolution.compatibleTms));
    const partnerOnlyTm = partnerHead.compatibleTms.find(moveId => !ordinary.compatibleTms.includes(moveId));
    expect(partnerOnlyTm, "the union contains an actual TM ordinary Eevee cannot learn").toBeDefined();
    expect(ordinary.compatibleTms).not.toContain(partnerOnlyTm as MoveId);

    ordinary.destroy();
    partnerHead.destroy();
    partnerEvolution.destroy();
  });

  // --- Mega / primal newcomer FORMS (12) -----------------------------------
  it("mega/primal forms: exist on base, inherit base TM compat, kit resolves", () => {
    for (const def of ER_NEWCOMER_FORMS) {
      const base = getPokemonSpecies(def.baseSpecies);
      expect(base, `base for ${def.formKey}`).toBeDefined();
      const formIndex = base.forms.findIndex(f => f.formKey === def.formKey);
      expect(formIndex, `${def.baseSpecies}:${def.formKey} form injected`).toBeGreaterThanOrEqual(0);

      // (h) the form's declared N-typing resolves onto the injected form.
      const form = base.forms[formIndex];
      const formTypes = new Set<number>([
        form.type1,
        ...(form.type2 === null ? [] : [form.type2]),
        ...form.getExtraTypes(),
      ]);
      expect(formTypes).toEqual(new Set<number>(def.types));

      // (h) the form's innate kit resolves to real abilities.
      for (const id of def.innates) {
        if (id === AbilityId.NONE) {
          continue;
        }
        expect(allAbilities[id], `form innate ${id} resolves`).toBeDefined();
      }

      // (b) a mon in the mega form inherits the base species' TM compatibility
      // (generateCompatibleTms matches a plain tmSpecies entry to species id
      // regardless of form), so its TM list is non-empty when the base has TMs.
      if (plainTmMoves(def.baseSpecies).length > 0) {
        const mon = game.scene.addPlayerPokemon(base, 50, undefined, formIndex);
        mon.generateCompatibleTms();
        expect(mon.compatibleTms.length, `${def.baseSpecies}:${def.formKey} inherits TMs`).toBeGreaterThan(0);
        mon.destroy();
      }
    }
  });
});
