/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbAttr, ArenaTrapAbAttr, PostAttackApplyBattlerTagAbAttr } from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import * as Archetypes from "#data/elite-redux/archetypes/index";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { HitResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { type BattleStat, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { AddSubstituteAttr, type Move } from "#moves/move";
import { NumberHolder } from "#utils/common";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

type AttrFactory = () => AbAttr;
type MutableAbility = Ability & { attrs: AbAttr[] };

type UpgradeExports = {
  appendAbilityAttrsOnce?: (ability: Ability, patchKey: string, factories: readonly AttrFactory[]) => boolean;
  replaceAbilityAttrsOnce?: (ability: Ability, patchKey: string, factories: readonly AttrFactory[]) => boolean;
  replaceMatchingAbilityAttrOnce?: (
    ability: Ability,
    patchKey: string,
    predicate: (attr: AbAttr) => boolean,
    factory: AttrFactory,
  ) => boolean;
  FirstTurnDirectDamageMultiplierAbAttr?: new (
    multiplier: number,
  ) => AbAttr & {
    canApply(params: unknown): boolean;
    apply(params: unknown): void;
    appliesToFixedDamage(): boolean;
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
  selectHigherOffenseStat?: (pokemon: Pokemon) => Stat.ATK | Stat.SPATK;
  selectHigherDefenseStat?: (pokemon: Pokemon) => Stat.DEF | Stat.SPDEF;
  onSuccessfulStatDrop?: (
    callback: (target: Pokemon, changed: readonly BattleStat[], relativeChanges: readonly number[]) => void,
  ) => (target: Pokemon | null, changed: BattleStat[], relativeChanges: number[]) => void;
  IgnoreOptionalMoveEffectsAbAttr?: new () => AbAttr & {
    canApply(params: unknown): boolean;
    apply(params: unknown): void;
  };
  UserFieldIgnoreOptionalMoveEffectsAbAttr?: new () => AbAttr & {
    canApply(params: unknown): boolean;
    apply(params: unknown): void;
  };
  MoveHpCostModifierAbAttr?: new (moveIds: readonly MoveId[], replacementFraction: number) => AbAttr;
  getMoveHpCostFraction?: (pokemon: Pokemon, move: Move, baseFraction: number) => number;
  ProvenanceBypassSpeedChanceAbAttr?: new (
    chance: number,
    provenanceKey: string,
  ) => AbAttr & {
    apply(params: unknown): void;
  };
  hasCommandAbilityProvenance?: (pokemon: Pokemon, key: string) => boolean;
  canTriggerFollowUpMove?: (pokemon: Pokemon) => boolean;
};

const upgrades = Archetypes as unknown as UpgradeExports;
let previousGlobalScene: BattleScene;

beforeEach(() => {
  previousGlobalScene = globalScene;
});

afterEach(() => {
  initGlobalScene(previousGlobalScene);
});

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
  stats?: Partial<Record<Stat, number>>;
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
    getStat: (stat: Stat) => options.stats?.[stat] ?? 0,
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

  it("replaces one matching attribute without removing the rest", () => {
    const replaceMatching = requireExport("replaceMatchingAbilityAttrOnce");
    if (!replaceMatching) {
      return;
    }

    const matched = new TestAttr();
    const preserved = new TestAttr();
    const ability = makeAbility(matched, preserved);
    const replacementFactory = vi.fn(() => new TestAttr());

    expect(replaceMatching(ability, "upgrade:test:matching", attr => attr === matched, replacementFactory)).toBe(true);
    expect(replaceMatching(ability, "upgrade:test:matching", attr => attr === matched, replacementFactory)).toBe(false);
    expect(replacementFactory).toHaveBeenCalledTimes(1);
    expect(ability.attrs).toHaveLength(2);
    expect(ability.attrs[0]).not.toBe(matched);
    expect(ability.attrs[1]).toBe(preserved);
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
    expect(attr.appliesToFixedDamage()).toBe(true);
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

describe("shared stat selectors", () => {
  it("selects the higher offense and favors Attack on a tie", () => {
    const selectHigherOffense = requireExport("selectHigherOffenseStat");
    if (!selectHigherOffense) {
      return;
    }

    expect(selectHigherOffense(stubPokemon({ index: 0, stats: { [Stat.ATK]: 100, [Stat.SPATK]: 120 } }))).toBe(
      Stat.SPATK,
    );
    expect(selectHigherOffense(stubPokemon({ index: 0, stats: { [Stat.ATK]: 100, [Stat.SPATK]: 100 } }))).toBe(
      Stat.ATK,
    );
  });

  it("selects the higher defense and favors Defense on a tie", () => {
    const selectHigherDefense = requireExport("selectHigherDefenseStat");
    if (!selectHigherDefense) {
      return;
    }

    expect(selectHigherDefense(stubPokemon({ index: 0, stats: { [Stat.DEF]: 90, [Stat.SPDEF]: 110 } }))).toBe(
      Stat.SPDEF,
    );
    expect(selectHigherDefense(stubPokemon({ index: 0, stats: { [Stat.DEF]: 90, [Stat.SPDEF]: 90 } }))).toBe(Stat.DEF);
  });
});

describe("successful stat-drop callbacks", () => {
  it("forwards only stats whose stages actually decreased", () => {
    const onSuccessfulDrop = requireExport("onSuccessfulStatDrop");
    if (!onSuccessfulDrop) {
      return;
    }

    const target = stubPokemon({ index: 1 });
    const callback = vi.fn();
    const onChange = onSuccessfulDrop(callback);

    onChange(target, [Stat.ATK, Stat.DEF, Stat.SPD], [-1, 0, -2]);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(target, [Stat.ATK, Stat.SPD], [-1, -2]);

    onChange(target, [Stat.SPATK, Stat.SPDEF], [0, 1]);
    onChange(null, [Stat.ATK], [-1]);
    expect(callback).toHaveBeenCalledOnce();
  });
});

describe("optional secondary-effect cancellation", () => {
  it.each([
    ["holder", "IgnoreOptionalMoveEffectsAbAttr"],
    ["field", "UserFieldIgnoreOptionalMoveEffectsAbAttr"],
  ] as const)("cancels optional effects for the %s variant but preserves guaranteed effects", (_scope, exportName) => {
    const Attr = requireExport(exportName);
    if (!Attr) {
      return;
    }

    const attr = new Attr();
    const optionalChance = new NumberHolder(30);
    const guaranteedChance = new NumberHolder(100);
    const alwaysApplyChance = new NumberHolder(-1);

    expect(attr.canApply({ chance: optionalChance })).toBe(true);
    attr.apply({ chance: optionalChance });
    expect(optionalChance.value).toBe(0);
    expect(attr.canApply({ chance: guaranteedChance })).toBe(false);
    expect(attr.canApply({ chance: alwaysApplyChance })).toBe(false);
    expect(guaranteedChance.value).toBe(100);
    expect(alwaysApplyChance.value).toBe(-1);
  });
});

describe("adjustable move HP costs", () => {
  it("replaces the HP-cost fraction only for configured moves on an eligible holder", () => {
    const Attr = requireExport("MoveHpCostModifierAbAttr");
    const getCostFraction = requireExport("getMoveHpCostFraction");
    if (!Attr || !getCostFraction) {
      return;
    }

    const attr = new Attr([MoveId.SHED_TAIL], 1 / 3);
    const pokemon = {
      getAllActiveAbilityAttrs: () => [attr],
    } as unknown as Pokemon;

    expect(getCostFraction(pokemon, { id: MoveId.SHED_TAIL } as Move, 1 / 2)).toBe(1 / 3);
    expect(getCostFraction(pokemon, { id: MoveId.SUBSTITUTE } as Move, 1 / 4)).toBe(1 / 4);
  });

  it("uses the adjusted fraction for both eligibility and HP deduction", () => {
    const Attr = requireExport("MoveHpCostModifierAbAttr");
    if (!Attr) {
      return;
    }

    const modifier = new Attr([MoveId.SHED_TAIL], 1 / 3);
    const user = {
      id: 7,
      hp: 31,
      getMaxHp: () => 90,
      getTag: () => undefined,
      getAllActiveAbilityAttrs: () => [modifier],
      isFainted: () => false,
      damageAndUpdate: vi.fn(),
      addTag: vi.fn(),
    } as unknown as Pokemon;
    const move = { id: MoveId.SHED_TAIL } as Move;
    const substitute = new AddSubstituteAttr(1 / 2, true);
    const condition = substitute.getCondition();

    expect(condition(user, user, move)).toBe(true);
    user.hp = 30;
    expect(condition(user, user, move)).toBe(false);

    user.hp = 90;
    expect(substitute.apply(user, user, move, [])).toBe(true);
    expect(user.damageAndUpdate).toHaveBeenCalledWith(30, {
      result: expect.anything(),
      ignoreSegments: true,
      ignoreFaintPhase: true,
    });
  });
});

describe("command-scoped bypass-speed provenance", () => {
  it("records which ability produced a shared bypass-speed tag", () => {
    const Attr = requireExport("ProvenanceBypassSpeedChanceAbAttr");
    const hasProvenance = requireExport("hasCommandAbilityProvenance");
    if (!Attr || !hasProvenance) {
      return;
    }

    const pokemon = {
      turnData: { erAbilityProvenance: [] },
      addTag: vi.fn(),
    } as unknown as Pokemon;
    const attr = new Attr(30, "quick-draw");

    attr.apply({ pokemon });

    expect(pokemon.addTag).toHaveBeenCalledWith(BattlerTagType.BYPASS_SPEED);
    expect(hasProvenance(pokemon, "quick-draw")).toBe(true);
    expect(hasProvenance(pokemon, "quick-claw")).toBe(false);
  });
});

describe("follow-up move recursion guards", () => {
  it("allows one follow-up only for a non-virtual move's final hit", () => {
    const canTrigger = requireExport("canTriggerFollowUpMove");
    if (!canTrigger) {
      return;
    }

    const pokemon = {
      turnData: { hitsLeft: 1 },
      getLastXMoves: () => [{ move: MoveId.TACKLE, targets: [], useMode: MoveUseMode.NORMAL }],
    } as unknown as Pokemon;
    expect(canTrigger(pokemon)).toBe(true);

    pokemon.getLastXMoves = () => [{ move: MoveId.TACKLE, targets: [], useMode: MoveUseMode.INDIRECT }];
    expect(canTrigger(pokemon)).toBe(false);

    pokemon.getLastXMoves = () => [{ move: MoveId.TACKLE, targets: [], useMode: MoveUseMode.NORMAL }];
    pokemon.turnData.hitsLeft = 2;
    expect(canTrigger(pokemon)).toBe(false);
  });
});

describe("generic Run Away capability", () => {
  it("lets any active RunSuccess attribute bypass trapping abilities", () => {
    const attr = new ArenaTrapAbAttr(() => true);
    const opponent = {
      isOfType: () => false,
      hasAbility: () => false,
      hasAbilityWithAttr: (attrType: string) => attrType === "RunSuccessAbAttr",
    } as unknown as Pokemon;

    expect(
      attr.canApply({ pokemon: stubPokemon({ index: 0 }), opponent, trapped: { value: false }, simulated: false }),
    ).toBe(false);
  });
});

describe("source-aware offensive binding", () => {
  it("preserves the triggering move and holder on applied battler tags", () => {
    const attr = new PostAttackApplyBattlerTagAbAttr(false, () => 100, BattlerTagType.BIND);
    const pokemon = { id: 41, randBattleSeedInt: () => 0 } as unknown as Pokemon;
    const opponent = { addTag: vi.fn() } as unknown as Pokemon;
    const move = { id: MoveId.BIND } as Move;

    attr.apply({ pokemon, opponent, move, simulated: false, damage: 0, hitResult: HitResult.EFFECTIVE });

    expect(opponent.addTag).toHaveBeenCalledWith(BattlerTagType.BIND, 0, MoveId.BIND, 41);
  });
});
