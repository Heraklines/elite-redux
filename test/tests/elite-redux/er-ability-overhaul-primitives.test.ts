/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbAttr } from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import * as Archetypes from "#data/elite-redux/archetypes/index";
import { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/common";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

type AttrFactory = () => AbAttr;
type MutableAbility = Ability & { attrs: AbAttr[] };

type UpgradeExports = {
  appendAbilityAttrsOnce?: (ability: Ability, patchKey: string, factories: readonly AttrFactory[]) => boolean;
  replaceAbilityAttrsOnce?: (ability: Ability, patchKey: string, factories: readonly AttrFactory[]) => boolean;
  FirstTurnDirectDamageMultiplierAbAttr?: new (
    multiplier: number,
  ) => AbAttr & {
    canApply(params: unknown): boolean;
    apply(params: unknown): void;
    getMultiplier(): number;
  };
  FirstEntryPartyHealAbAttr?: new (options: {
    key: string;
    healFraction: number;
  }) => AbAttr & {
    canApply(params: unknown): boolean;
    apply(params: unknown): void;
  };
  HolderAndAlliesRecoveryAbAttr?: new (
    healFraction: number,
  ) => AbAttr & {
    canApply(params: unknown): boolean;
    apply(params: unknown): void;
  };
  suppressInnateSlotUntilSwitch?: (pokemon: Pokemon, slot: 0 | 1 | 2) => void;
  isInnateSlotSuppressed?: (pokemon: Pokemon, slot: 0 | 1 | 2) => boolean;
  BiomeRevealBonusAbAttr?: new (count?: number) => AbAttr & { getCount(): number };
  EncounterTypeWeightAbAttr?: new (
    type: PokemonType,
    multiplier: number,
  ) => AbAttr & {
    getType(): PokemonType;
    getMultiplier(): number;
  };
  ExperienceGainMultiplierAbAttr?: new (multiplier: number) => AbAttr & { getMultiplier(): number };
  MoneyGainMultiplierAbAttr?: new (multiplier: number) => AbAttr & { getMultiplier(): number };
  BallRecoveryAbAttr?: new (
    recoverable: readonly PokeballType[],
  ) => AbAttr & {
    getRecoverableBalls(): readonly PokeballType[];
  };
};

const upgrades = Archetypes as unknown as UpgradeExports;

class TestAttr extends AbAttr {}

function makeAbility(...attrs: AbAttr[]): MutableAbility {
  const builder = new AbBuilder(AbilityId.STENCH, 3);
  for (const attr of attrs) {
    builder.attrs.push(attr);
  }
  return builder.build() as MutableAbility;
}

function requireExport<K extends keyof UpgradeExports>(key: K): NonNullable<UpgradeExports[K]> | undefined {
  const value = upgrades[key];
  expect(value, `${String(key)} must be exported by the shared archetype surface`).toBeTypeOf("function");
  return value ?? undefined;
}

function mockScene(options: { playerParty?: Pokemon[]; enemyParty?: Pokemon[] } = {}): Mock {
  const unshiftNew = vi.fn();
  initGlobalScene({
    phaseManager: { unshiftNew },
    getPlayerParty: () => options.playerParty ?? [],
    getEnemyParty: () => options.enemyParty ?? [],
  } as unknown as BattleScene);
  return unshiftNew;
}

function stubPokemon(options: {
  index: number;
  maxHp?: number;
  hp?: number;
  player?: boolean;
  onField?: boolean;
  adjacentAllies?: Pokemon[];
  waveTurnCount?: number;
  waveData?: { entryEffectsFired: Set<string> };
  summonData?: object;
}): Pokemon {
  const maxHp = options.maxHp ?? 100;
  const hp = options.hp ?? Math.floor(maxHp / 2);
  return {
    hp,
    tempSummonData: { waveTurnCount: options.waveTurnCount ?? 1 },
    waveData: options.waveData ?? { entryEffectsFired: new Set<string>() },
    summonData: options.summonData ?? {},
    getBattlerIndex: () => options.index,
    getMaxHp: () => maxHp,
    isPlayer: () => options.player ?? true,
    isOnField: () => options.onField ?? true,
    isActive: () => hp > 0,
    isFainted: () => hp <= 0,
    isFullHp: () => hp >= maxHp,
    getAdjacentAllies: () => options.adjacentAllies ?? [],
    heal: vi.fn(),
    updateInfo: vi.fn(),
  } as unknown as Pokemon;
}

describe("ability-upgrade idempotent patch helpers", () => {
  it("appends and replaces a keyed patch exactly once", () => {
    const append = requireExport("appendAbilityAttrsOnce");
    const replace = requireExport("replaceAbilityAttrsOnce");
    if (!append || !replace) {
      return;
    }

    const original = new TestAttr();
    const ability = makeAbility(original);
    const appendFactory = vi.fn(() => new TestAttr());

    expect(append(ability, "upgrade:test:add", [appendFactory])).toBe(true);
    expect(append(ability, "upgrade:test:add", [appendFactory])).toBe(false);
    expect(appendFactory).toHaveBeenCalledTimes(1);
    expect(ability.attrs).toHaveLength(2);
    expect(ability.attrs[0]).toBe(original);

    const replacementFactory = vi.fn(() => new TestAttr());
    expect(replace(ability, "upgrade:test:replace", [replacementFactory])).toBe(true);
    expect(replace(ability, "upgrade:test:replace", [replacementFactory])).toBe(false);
    expect(replacementFactory).toHaveBeenCalledTimes(1);
    expect(ability.attrs).toHaveLength(1);
    expect(ability.attrs[0]).not.toBe(original);
  });
});

describe("FirstTurnDirectDamageMultiplierAbAttr", () => {
  it("multiplies direct damage only on the holder's first turn without changing stats", () => {
    const Attr = requireExport("FirstTurnDirectDamageMultiplierAbAttr");
    if (!Attr) {
      return;
    }

    const attr = new Attr(2);
    const firstTurn = stubPokemon({ index: 0, waveTurnCount: 1 });
    const laterTurn = stubPokemon({ index: 0, waveTurnCount: 2 });
    const move = { category: MoveCategory.PHYSICAL } as Move;
    const firstPower = new NumberHolder(80);
    const params = { pokemon: firstTurn, opponent: stubPokemon({ index: 1 }), move, power: firstPower };

    expect(attr.getMultiplier()).toBe(2);
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(firstPower.value).toBe(160);
    expect(attr.canApply({ ...params, pokemon: laterTurn, power: new NumberHolder(80) })).toBe(false);
    expect(attr.canApply({ ...params, move: { category: MoveCategory.STATUS } as Move })).toBe(false);
  });
});

describe("FirstEntryPartyHealAbAttr", () => {
  it("heals the whole living party once per battle, including the bench", () => {
    const Attr = requireExport("FirstEntryPartyHealAbAttr");
    if (!Attr) {
      return;
    }

    const holderWaveData = { entryEffectsFired: new Set<string>() };
    const holder = stubPokemon({ index: 0, maxHp: 100, hp: 50, waveData: holderWaveData });
    const ally = stubPokemon({ index: 1, maxHp: 200, hp: 100 });
    const bench = stubPokemon({ index: 4, maxHp: 80, hp: 40, onField: false });
    const fainted = stubPokemon({ index: 5, maxHp: 120, hp: 0, onField: false });
    const unshiftNew = mockScene({ playerParty: [holder, ally, bench, fainted] });
    const attr = new Attr({ key: "sweet-veil", healFraction: 0.1 });
    const params = { pokemon: holder, simulated: false };

    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(unshiftNew).toHaveBeenCalledWith("PokemonHealPhase", 0, 10, null, true);
    expect(unshiftNew).toHaveBeenCalledWith("PokemonHealPhase", 1, 20, null, true);
    expect(bench.heal).toHaveBeenCalledWith(8);
    expect(bench.updateInfo).toHaveBeenCalledTimes(1);
    expect(fainted.heal).not.toHaveBeenCalled();
    expect(attr.canApply(params)).toBe(false);

    attr.apply(params);
    expect(unshiftNew).toHaveBeenCalledTimes(2);
    expect(bench.heal).toHaveBeenCalledTimes(1);
  });
});

describe("HolderAndAlliesRecoveryAbAttr", () => {
  it("heals the holder and each damaged adjacent ally at turn end", () => {
    const Attr = requireExport("HolderAndAlliesRecoveryAbAttr");
    if (!Attr) {
      return;
    }

    const damagedAlly = stubPokemon({ index: 1, maxHp: 160, hp: 80 });
    const fullAlly = stubPokemon({ index: 2, maxHp: 160, hp: 160 });
    const holder = stubPokemon({ index: 0, maxHp: 96, hp: 48, adjacentAllies: [damagedAlly, fullAlly] });
    const unshiftNew = mockScene();
    const attr = new Attr(1 / 16);
    const params = { pokemon: holder, simulated: false };

    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(unshiftNew).toHaveBeenCalledWith("PokemonHealPhase", 0, 6, null, true);
    expect(unshiftNew).toHaveBeenCalledWith("PokemonHealPhase", 1, 10, null, true);
    expect(unshiftNew).toHaveBeenCalledTimes(2);
  });
});

describe("temporary innate-slot suppression", () => {
  it("tracks exact slots on summon data and resets when the Pokemon switches", () => {
    const suppress = requireExport("suppressInnateSlotUntilSwitch");
    const isSuppressed = requireExport("isInnateSlotSuppressed");
    if (!suppress || !isSuppressed) {
      return;
    }

    const pokemon = stubPokemon({ index: 0, summonData: {} });
    expect(isSuppressed(pokemon, 0)).toBe(false);
    suppress(pokemon, 0);
    expect(isSuppressed(pokemon, 0)).toBe(true);
    expect(isSuppressed(pokemon, 1)).toBe(false);

    pokemon.summonData = {} as Pokemon["summonData"];
    expect(isSuppressed(pokemon, 0)).toBe(false);
  });
});

describe("meta ability markers", () => {
  beforeEach(() => {
    mockScene();
  });

  it("exposes typed biome, encounter, reward, and ball-recovery metadata", () => {
    const BiomeReveal = requireExport("BiomeRevealBonusAbAttr");
    const EncounterWeight = requireExport("EncounterTypeWeightAbAttr");
    const Experience = requireExport("ExperienceGainMultiplierAbAttr");
    const Money = requireExport("MoneyGainMultiplierAbAttr");
    const BallRecovery = requireExport("BallRecoveryAbAttr");
    if (!BiomeReveal || !EncounterWeight || !Experience || !Money || !BallRecovery) {
      return;
    }

    expect(new BiomeReveal(1).getCount()).toBe(1);
    const fairyWeight = new EncounterWeight(PokemonType.FAIRY, 2);
    expect(fairyWeight.getType()).toBe(PokemonType.FAIRY);
    expect(fairyWeight.getMultiplier()).toBe(2);
    expect(new Experience(1.2).getMultiplier()).toBe(1.2);
    expect(new Money(1.2).getMultiplier()).toBe(1.2);
    expect(new BallRecovery([PokeballType.POKEBALL, PokeballType.GREAT_BALL]).getRecoverableBalls()).toEqual([
      PokeballType.POKEBALL,
      PokeballType.GREAT_BALL,
    ]);
  });
});
