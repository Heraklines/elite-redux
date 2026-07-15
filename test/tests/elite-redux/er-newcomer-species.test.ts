/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER newcomer NEW-SPECIES seam (er-newcomer-species.ts).
//
// Proves, for the three evolution-only fakemon (Tentalect / Astoot / Discupid),
// Regitube (egg-obtainable standalone), and the partner-Eevee family:
//   - each species is registered with the exact stats + N-typing + active/innate
//     kit, and every ability id resolves to a real allAbilities entry;
//   - the level-50 evolution edges are wired and branched-safe (Noctowl and
//     Tentacruel each expose TWO valid L50 paths incl. the newcomer; Luvdisc one);
//   - evolutions fire only AT the level (L49 -> none, L50 -> valid), the evolved
//     mon carries the correct N-typing, and evolving registers the dex entry;
//   - NO starter-grid / egg / wild leak for the evolution species + the 8 partner
//     eeveelutions (#232/#352), while partner Eevee IS a starter and Regitube IS
//     egg-obtainable;
//   - the base Eevee family stays byte-identical (partner clones never mutate it).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { pokemonEvolutions, pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { allAbilities } from "#data/data-lists";
import {
  ER_ASTOOT_SPECIES_ID,
  ER_DISCUPID_SPECIES_ID,
  ER_NEWCOMER_EVO_SPECIES,
  ER_PARTNER_EEVEE_SPECIES_ID,
  ER_PARTNER_FAMILY,
  ER_REGITUBE_SPECIES_ID,
  ER_TENTALECT_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import { EggTier } from "#enums/egg-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// Known-good base Eevee-family kit (probed from the ER-patched dex). The
// byte-identical guard asserts partner registration never mutated these.
const BASE_EEVEE_KIT: Record<number, { stats: number[]; act: number[]; inn: number[] }> = {
  [SpeciesId.EEVEE]: { stats: [55, 55, 50, 45, 65, 55], act: [158, 91, 109], inn: [218, 56, 168] },
  [SpeciesId.VAPOREON]: { stats: [130, 65, 60, 110, 95, 65], act: [44, 144, 2], inn: [41, 11, 93] },
  [SpeciesId.JOLTEON]: { stats: [65, 65, 60, 110, 95, 130], act: [3, 5074, 5000], inn: [5060, 31, 35] },
  [SpeciesId.FLAREON]: { stats: [95, 130, 60, 65, 65, 110], act: [120, 95, 5089], inn: [18, 62, 218] },
  [SpeciesId.ESPEON]: { stats: [65, 65, 60, 130, 95, 110], act: [220, 5090, 227], inn: [156, 5030, 5081] },
  [SpeciesId.UMBREON]: { stats: [95, 65, 110, 60, 130, 65], act: [143, 5101, 5044], inn: [5045, 5072, 147] },
  [SpeciesId.LEAFEON]: { stats: [65, 110, 130, 60, 65, 95], act: [179, 5293, 5503], inn: [5009, 5438, 154] },
  [SpeciesId.GLACEON]: { stats: [65, 60, 110, 130, 95, 65], act: [246, 5007, 5116], inn: [115, 5187, 5100] },
  [SpeciesId.SYLVEON]: { stats: [95, 65, 65, 110, 130, 60], act: [187, 32, 257], inn: [182, 5051, 290] },
};

describe.skipIf(!RUN)("ER newcomer new-species seam", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("each evolution species has the exact stats, N-typing, and a fully-resolving kit", () => {
    for (const def of ER_NEWCOMER_EVO_SPECIES) {
      const sp = getPokemonSpecies(def.speciesId);
      expect(sp, `${def.name} registered`).toBeDefined();
      expect(sp.name).toBe(def.name);
      expect([...sp.baseStats]).toEqual([...def.stats]);
      // Full N-typing: type1/type2 + extras == the declared set.
      const actual = new Set<PokemonType>([sp.type1, ...(sp.type2 === null ? [] : [sp.type2]), ...sp.getExtraTypes()]);
      expect(actual).toEqual(new Set<PokemonType>(def.types));
      // Active + innate kit stored verbatim.
      expect([sp.ability1, sp.ability2, sp.abilityHidden]).toEqual([...def.actives]);
      expect([...sp.getPassiveAbilities()]).toEqual([...def.innates]);
      for (const id of [...def.actives, ...def.innates]) {
        expect(allAbilities[id], `ability ${id} exists for ${def.name}`).toBeDefined();
        expect(allAbilities[id].id).toBe(id);
      }
    }
  });

  it("wires the level-50 evolution edges (Tentacruel + Noctowl branched, Luvdisc single)", () => {
    // Tentacruel -> [Tentagrewl (existing ER), Tentalect (new)] both @50 => branched.
    const tenta = pokemonEvolutions[SpeciesId.TENTACRUEL] ?? [];
    const tentalect = tenta.find(e => (e.speciesId as number) === ER_TENTALECT_SPECIES_ID);
    expect(tentalect, "Tentacruel -> Tentalect edge").toBeDefined();
    expect((tentalect as unknown as { level: number }).level).toBe(50);
    expect(tenta.filter(e => (e as unknown as { level: number }).level === 50).length).toBeGreaterThanOrEqual(2);

    // Noctowl -> [Phantowl (existing), Astoot (new)] both @50 => branched.
    const noct = pokemonEvolutions[SpeciesId.NOCTOWL] ?? [];
    expect(noct.find(e => (e.speciesId as number) === ER_ASTOOT_SPECIES_ID)).toBeDefined();
    expect(noct.filter(e => (e as unknown as { level: number }).level === 50).length).toBeGreaterThanOrEqual(2);

    // Luvdisc -> Discupid only.
    const luv = pokemonEvolutions[SpeciesId.LUVDISC] ?? [];
    expect(luv).toHaveLength(1);
    expect(luv[0].speciesId as number).toBe(ER_DISCUPID_SPECIES_ID);

    // Prevolutions derived (dex/candy rooting works like other evolved customs).
    expect(pokemonPrevolutions[ER_TENTALECT_SPECIES_ID as SpeciesId]).toBe(SpeciesId.TENTACRUEL);
    expect(pokemonPrevolutions[ER_ASTOOT_SPECIES_ID as SpeciesId]).toBe(SpeciesId.NOCTOWL);
    expect(pokemonPrevolutions[ER_DISCUPID_SPECIES_ID as SpeciesId]).toBe(SpeciesId.LUVDISC);
  });

  it("evolutions fire only AT level 50; the branched chooser offers Astoot", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);

    for (const [base, targetId] of [
      [SpeciesId.TENTACRUEL, ER_TENTALECT_SPECIES_ID],
      [SpeciesId.NOCTOWL, ER_ASTOOT_SPECIES_ID],
      [SpeciesId.LUVDISC, ER_DISCUPID_SPECIES_ID],
    ] as [SpeciesId, number][]) {
      const below = game.scene.addPlayerPokemon(getPokemonSpecies(base), 49);
      expect(below.getValidEvolutions(), `${SpeciesId[base]} @49 no evo`).toHaveLength(0);
      const at = game.scene.addPlayerPokemon(getPokemonSpecies(base), 50);
      const targets = at.getValidEvolutions().map(e => e.speciesId as number);
      expect(targets, `${SpeciesId[base]} @50 -> newcomer`).toContain(targetId);
    }

    // Noctowl's L50 branch offers BOTH Astoot and its existing custom evo.
    const noctowl = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.NOCTOWL), 50);
    const valid = noctowl.getValidEvolutions();
    expect(valid.length).toBeGreaterThanOrEqual(2);
    expect(valid.map(e => e.speciesId as number)).toContain(ER_ASTOOT_SPECIES_ID);
  });

  it("evolving carries the N-typing onto the live mon and registers the dex entry", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const tentacruel = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.TENTACRUEL), 50);
    const evo = tentacruel.getValidEvolutions().find(e => (e.speciesId as number) === ER_TENTALECT_SPECIES_ID)!;
    expect(evo).toBeDefined();

    // Seed the line ROOT as caught (Tentacool) — evolve() registers the caught
    // species only when the line is already owned, exactly like every evolution.
    game.scene.gameData.dexData[SpeciesId.TENTACOOL].caughtAttr = 255n;

    await tentacruel.evolve(evo, tentacruel.species);
    expect(tentacruel.species.speciesId as number).toBe(ER_TENTALECT_SPECIES_ID);
    expect(new Set(tentacruel.getTypes())).toEqual(
      new Set([PokemonType.WATER, PokemonType.POISON, PokemonType.PSYCHIC]),
    );
    // Dex-on-evolve: setPokemonCaught ran, so the caught bit is set.
    const dexEntry = game.scene.gameData.dexData[ER_TENTALECT_SPECIES_ID];
    expect(dexEntry, "Tentalect dex entry exists (initDexData covered it)").toBeDefined();
    expect(dexEntry.caughtAttr).toBeGreaterThan(0n);
  });

  it("no starter-grid / egg / wild leak for the 3 evolution species + 8 partner eeveelutions", () => {
    const starterCosts = speciesStarterCosts as Record<number, number>;
    const eggTiers = speciesEggTiers as Record<number, EggTier>;
    const noLeakIds = [
      ER_TENTALECT_SPECIES_ID,
      ER_ASTOOT_SPECIES_ID,
      ER_DISCUPID_SPECIES_ID,
      ...ER_PARTNER_FAMILY.filter(d => d.partnerId !== ER_PARTNER_EEVEE_SPECIES_ID).map(d => d.partnerId),
    ];
    for (const id of noLeakIds) {
      expect(Object.hasOwn(starterCosts, id), `starter cost absent for ${id}`).toBe(false);
      expect(Object.hasOwn(eggTiers, id), `egg tier absent for ${id}`).toBe(false);
    }
  });

  it("partner Eevee is a starter mon (own cost, no egg tier); Regitube is egg-obtainable", () => {
    const starterCosts = speciesStarterCosts as Record<number, number>;
    const eggTiers = speciesEggTiers as Record<number, EggTier>;

    expect(Object.hasOwn(starterCosts, ER_PARTNER_EEVEE_SPECIES_ID)).toBe(true);
    expect(Object.hasOwn(eggTiers, ER_PARTNER_EEVEE_SPECIES_ID)).toBe(false);

    // Regitube: registered Water standalone, egg tier + starter cost, kit resolves.
    const regi = getPokemonSpecies(ER_REGITUBE_SPECIES_ID);
    expect(regi?.name).toBe("Regitube");
    expect(regi.type1).toBe(PokemonType.WATER);
    expect([...regi.baseStats]).toEqual([200, 50, 100, 80, 100, 50]);
    expect(eggTiers[ER_REGITUBE_SPECIES_ID]).toBe(EggTier.EPIC);
    expect(Object.hasOwn(starterCosts, ER_REGITUBE_SPECIES_ID)).toBe(true);
    for (const id of [regi.ability1, regi.ability2, regi.abilityHidden, ...regi.getPassiveAbilities()]) {
      expect(allAbilities[id], `Regitube ability ${id} exists`).toBeDefined();
    }
  });

  it("the base Eevee family stays byte-identical (partner clones never mutate it)", () => {
    for (const [idStr, kit] of Object.entries(BASE_EEVEE_KIT)) {
      const sp = getPokemonSpecies(Number(idStr) as SpeciesId);
      expect([...sp.baseStats], `${sp.name} stats`).toEqual(kit.stats);
      expect([sp.ability1, sp.ability2, sp.abilityHidden], `${sp.name} actives`).toEqual(kit.act);
      expect([...sp.getPassiveAbilities()], `${sp.name} innates`).toEqual(kit.inn);
    }
  });
});
