/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbBuilder } from "#abilities/ability";
import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import {
  ER_DEMODULATOR_ABILITY_ID,
  ER_ELECTRODYNAMICS_ABILITY_ID,
  ER_MODULATOR_ABILITY_ID,
  ER_PSIONIC_ABILITY_ID,
  ER_SURGES_UP_ABILITY_ID,
} from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import {
  ElectrodynamicsGalvanizeAbAttr,
  ElectrodynamicsPositionAbAttr,
  installElectrodynamicsPosition,
  isElectrodynamicsPosition,
  isRaichuTerrainActiveForMove,
  isRaichuTerrainGrounded,
  isRaichuTerrainMoveCancelled,
  partnerHasRaichuBoostCondition,
  RaichuAllTerrainSurgeSurferAbAttr,
  RaichuAllyStatMultiplierAbAttr,
  RaichuTerrainStatMultiplierAbAttr,
  recordMagneticFluxRecipient,
  wireRaichuPitchAbility,
} from "#data/elite-redux/abilities/fakemon-pitch-raichu";
import { PokemonSummonData } from "#data/pokemon-data";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { describe, expect, it } from "vitest";

function makeMove(type = PokemonType.NORMAL): Move {
  return {
    id: MoveId.TACKLE,
    type,
    category: MoveCategory.PHYSICAL,
    target: MoveTarget.NEAR_ENEMY,
    getPriority: () => 1,
  } as unknown as Move;
}

type StubPokemonOptions = {
  id?: number;
  battlerIndex?: number;
  abilities?: AbilityId[];
  magnetRise?: boolean;
  magneticFlux?: boolean;
  magneticFluxTarget?: number;
  grounded?: boolean;
  summonData?: object;
};

function makePokemon(options: StubPokemonOptions = {}): Pokemon {
  const abilities = new Set(options.abilities ?? []);
  return {
    id: options.id ?? 1,
    getBattlerIndex: () => options.battlerIndex ?? 0,
    hasAbility: (ability: AbilityId) => abilities.has(ability),
    getTag: (tagType: BattlerTagType) =>
      tagType === BattlerTagType.FLOATING && options.magnetRise ? { sourceMove: MoveId.MAGNET_RISE } : undefined,
    getMoveHistory: () =>
      options.magneticFlux
        ? [{ move: MoveId.MAGNETIC_FLUX, targets: [options.magneticFluxTarget ?? options.battlerIndex ?? 0] }]
        : [],
    isGrounded: () => options.grounded ?? true,
    summonData: options.summonData ?? {},
  } as unknown as Pokemon;
}

function setScene(terrainType: TerrainType, battlerCount = 1, field: Pokemon[] = []): void {
  const terrain = terrainType === TerrainType.NONE ? null : { terrainType };
  const positionalTagManager = {
    tags: [] as Array<{ tagType: string; targetIndex: number }>,
    canAddTag: () => true,
    addTag: (tag: { tagType: string; targetIndex: number }) => positionalTagManager.tags.push(tag),
  };
  initGlobalScene({
    arena: { terrainType, terrain, positionalTagManager },
    currentBattle: { getBattlerCount: () => battlerCount },
    getField: () => field,
  } as unknown as BattleScene);
}

describe("Mega Alolan Raichu source-backed ability registry", () => {
  it("resolves and wires all five stable IDs", () => {
    expect([
      ER_DEMODULATOR_ABILITY_ID,
      ER_MODULATOR_ABILITY_ID,
      ER_SURGES_UP_ABILITY_ID,
      ER_ELECTRODYNAMICS_ABILITY_ID,
      ER_PSIONIC_ABILITY_ID,
    ]).toEqual([6059, 6060, 6061, 6062, 6063]);
    for (const id of [
      ER_DEMODULATOR_ABILITY_ID,
      ER_MODULATOR_ABILITY_ID,
      ER_SURGES_UP_ABILITY_ID,
      ER_ELECTRODYNAMICS_ABILITY_ID,
      ER_PSIONIC_ABILITY_ID,
    ]) {
      const builder = new AbBuilder(id as AbilityId, 9);
      wireRaichuPitchAbility(builder, id);
      expect(builder.attrs.length).toBeGreaterThan(0);
    }
  });
});

describe("Demodulator and Modulator terrain stat multipliers", () => {
  it("applies holder base-stat multipliers only during Electric Terrain", () => {
    setScene(TerrainType.ELECTRIC);
    const holder = makePokemon();
    const attr = new RaichuTerrainStatMultiplierAbAttr(Stat.ATK, 1.5, TerrainType.ELECTRIC);
    expect(attr.canApply({ pokemon: holder, move: makeMove(), stat: Stat.ATK } as never)).toBe(true);
    setScene(TerrainType.PSYCHIC);
    expect(attr.canApply({ pokemon: holder, move: makeMove(), stat: Stat.ATK } as never)).toBe(false);
  });
  it("uses normal 1.5x partner scaling and 2x for Magnet Rise, Flux, Plus, or Minus", () => {
    const holder = makePokemon({ id: 1 });
    const normal = makePokemon({ id: 2, battlerIndex: 1 });
    const magnet = makePokemon({ id: 3, battlerIndex: 1, magnetRise: true });
    const fluxSource = makePokemon({ id: 4, battlerIndex: 0, magneticFlux: true, magneticFluxTarget: 1 });
    const flux = makePokemon({ id: 5, battlerIndex: 1 });
    const plus = makePokemon({ id: 6, battlerIndex: 1, abilities: [AbilityId.PLUS] });
    const minus = makePokemon({ id: 7, battlerIndex: 1, abilities: [AbilityId.MINUS] });
    setScene(TerrainType.ELECTRIC, 2, [fluxSource, flux]);
    expect(partnerHasRaichuBoostCondition(normal)).toBe(false);
    expect(partnerHasRaichuBoostCondition(magnet)).toBe(true);
    recordMagneticFluxRecipient(fluxSource, flux);
    expect(partnerHasRaichuBoostCondition(flux)).toBe(true);
    flux.summonData = new PokemonSummonData();
    expect(partnerHasRaichuBoostCondition(flux)).toBe(false);
    expect(partnerHasRaichuBoostCondition(plus)).toBe(true);
    expect(partnerHasRaichuBoostCondition(minus)).toBe(true);
    const attr = new RaichuAllyStatMultiplierAbAttr(Stat.ATK, TerrainType.ELECTRIC);
    const ordinaryStat = { value: 100 };
    attr.apply({ pokemon: holder, target: normal, statVal: ordinaryStat } as never);
    expect(ordinaryStat.value).toBe(150);
    const boostedStat = { value: 100 };
    attr.apply({ pokemon: holder, target: magnet, statVal: boostedStat } as never);
    expect(boostedStat.value).toBe(200);
  });

  it("does not grant partner scaling in singles", () => {
    setScene(TerrainType.ELECTRIC, 1);
    const attr = new RaichuAllyStatMultiplierAbAttr(Stat.DEF, TerrainType.ELECTRIC);
    expect(
      attr.canApply({
        pokemon: makePokemon(),
        target: makePokemon({ battlerIndex: 1 }),
        stat: Stat.DEF,
        ignoreAbility: false,
      } as never),
    ).toBe(false);
  });
});

describe("Surges Up", () => {
  it("doubles holder Speed under any active terrain", () => {
    setScene(TerrainType.PSYCHIC);
    const attr = new RaichuAllTerrainSurgeSurferAbAttr();
    expect(attr.canApply({ pokemon: makePokemon(), stat: Stat.SPD, move: makeMove() } as never)).toBe(true);
    setScene(TerrainType.NONE);
    expect(attr.canApply({ pokemon: makePokemon(), stat: Stat.SPD, move: makeMove() } as never)).toBe(false);
    const builder = new AbBuilder(ER_SURGES_UP_ABILITY_ID as AbilityId, 9);
    wireRaichuPitchAbility(builder, ER_SURGES_UP_ABILITY_ID);
    expect(builder.attrs.some(attr => attr.constructor.name === "RaichuAllTerrainSurgeSurferAbAttr")).toBe(true);
  });
});

describe("Electrodynamics field-position persistence", () => {
  it("leaves Magnet Rise on the field slot for a replacement occupant", () => {
    setScene(TerrainType.ELECTRIC);
    const original = makePokemon({ id: 10, battlerIndex: 0 });
    const replacement = makePokemon({ id: 11, battlerIndex: 0, grounded: false });
    expect(isElectrodynamicsPosition(original)).toBe(false);
    installElectrodynamicsPosition(original);
    expect(isElectrodynamicsPosition(replacement)).toBe(true);
    expect(isRaichuTerrainGrounded(replacement, TerrainType.ELECTRIC)).toBe(true);
    expect(new ElectrodynamicsPositionAbAttr()).toBeDefined();
    setScene(TerrainType.ELECTRIC);
    expect(isElectrodynamicsPosition(replacement)).toBe(false);
  });
});

describe("Psionic terrain-as-active move semantics", () => {
  it("treats Electric and Psychic moves as their matching terrains for a Psionic holder", () => {
    setScene(TerrainType.NONE);
    const holder = makePokemon({ abilities: [ER_PSIONIC_ABILITY_ID as AbilityId] });
    expect(isRaichuTerrainActiveForMove(holder, PokemonType.ELECTRIC)).toBe(true);
    expect(isRaichuTerrainActiveForMove(holder, PokemonType.PSYCHIC)).toBe(true);
    expect(isRaichuTerrainActiveForMove(makePokemon(), PokemonType.FIRE)).toBe(false);
  });

  it("blocks incoming priority attacks against the grounded Psionic holder", () => {
    const target = makePokemon({ abilities: [ER_PSIONIC_ABILITY_ID as AbilityId], battlerIndex: 1, grounded: true });
    const attacker = makePokemon({ battlerIndex: 0 });
    setScene(TerrainType.NONE, 2, [attacker, target]);
    expect(isRaichuTerrainMoveCancelled(attacker, [1], makeMove())).toBe(true);
  });
});

describe("Electrodynamics Galvanize precedence", () => {
  it("converts Normal moves but yields to another -ate ability", () => {
    const attr = new ElectrodynamicsGalvanizeAbAttr();
    expect(attr.canApply({ pokemon: makePokemon(), opponent: null, move: makeMove() } as never)).toBe(true);
    expect(
      attr.canApply({
        pokemon: makePokemon({ abilities: [AbilityId.AERILATE] }),
        opponent: null,
        move: makeMove(),
      } as never),
    ).toBe(false);
  });
});
