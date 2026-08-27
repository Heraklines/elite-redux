import { initGlobalScene } from "#app/global-scene";
import { getMoodyCoordinatorEffectState } from "#data/elite-redux/moody/moody-coordinator-combat-state";
import {
  getMoodyCoordinatorHpDebt,
  notifyMoodyCoordinatorBiomeTransition,
  notifyMoodyCoordinatorMarketPurchase,
} from "#data/elite-redux/moody/moody-runtime-game-adapter";
import {
  createMoodyLiveExecutionTarget,
  resetMoodyCoordinatorLiveCadence,
  runMoodyCoordinatorLive,
} from "#data/elite-redux/moody/moody-runtime-live-adapter";
import { createMoodyModeState, resetMoodyModeState, restoreMoodyModeState } from "#data/elite-redux/moody/moody-state";
import { ModifierTier } from "#enums/modifier-tier";
import type { Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import type { MoodyOperationModel } from "#ui/moody/moody-operation";
import { afterEach, describe, expect, it, vi } from "vitest";

function partyPokemon(id: number, maxHp: number): Pokemon {
  return {
    id,
    hp: maxHp,
    bossSegments: 0,
    getMaxHp: vi.fn(() => maxHp),
    getMoveset: vi.fn(() => []),
    isFainted: vi.fn(() => false),
    updateInfo: vi.fn(async () => undefined),
  } as unknown as Pokemon;
}

function debtAwarePartyPokemon(id: number, baseMaxHp: number): Pokemon {
  const pokemon = partyPokemon(id, baseMaxHp);
  pokemon.getMaxHp = vi.fn(() => Math.max(1, baseMaxHp - getMoodyCoordinatorHpDebt(id)));
  return pokemon;
}

function threat(pokemonId: number, fieldTurns: number, damageDealt: number) {
  return {
    pokemonId,
    fieldTurns,
    damageDealt,
    bossSegmentDamage: 0,
    knockouts: 0,
    itemInvestment: 0,
    repeatedMoveUses: 0,
    physicalBias: 0,
    specialBias: 0,
    speedDependence: 0,
    weatherDependence: 0,
  };
}

function restoreEconomyState(
  boon: "blood-market" | "recycler" | null,
  evolutionId?: string,
  withCursedInventory = false,
): void {
  const state = createMoodyModeState(`economy-${boon}-${evolutionId ?? "base"}`);
  if (boon != null) {
    state.boons.push({
      instanceId: `${boon}:test`,
      boonId: boon,
      rank: evolutionId == null ? 1 : 3,
      ...(evolutionId == null ? {} : { evolutionId }),
      acquiredAtWave: 10,
    });
  }
  if (withCursedInventory) {
    state.curses.push({ curseId: "cursed-inventory", acquiredAtWave: 1 });
  }
  state.recentThreat = [threat(2, 30, 1000), threat(1, 2, 20)];
  expect(restoreMoodyModeState(state)).toBe(true);
}

function heldItem(pokemonId: number, typeId: string): PokemonHeldItemModifier {
  const modifier = Object.create(PokemonHeldItemModifier.prototype) as PokemonHeldItemModifier;
  Object.assign(modifier, { pokemonId, stackCount: 1, type: { id: typeId } });
  return modifier;
}

function installEconomyScene(party: Pokemon[], modifiers: PokemonHeldItemModifier[] = []): void {
  initGlobalScene({
    currentBattle: { waveIndex: 41 },
    money: 1000,
    modifiers,
    addMoney: vi.fn(),
    getPlayerParty: vi.fn(() => party),
    getEnemyParty: vi.fn(() => []),
  } as never);
}

describe("Moody release blocker: usage-ranked debt and inventory", () => {
  afterEach(() => {
    resetMoodyModeState();
    vi.restoreAllMocks();
  });

  it("charges Blood Debt to the most-used Pokemon rather than party slot zero", () => {
    restoreEconomyState("blood-market");
    installEconomyScene([partyPokemon(1, 100), partyPokemon(2, 100)]);

    notifyMoodyCoordinatorMarketPurchase(ModifierTier.ULTRA, "blood");

    expect(getMoodyCoordinatorHpDebt(1)).toBe(0);
    expect(getMoodyCoordinatorHpDebt(2)).toBeGreaterThan(0);
  });

  it("scales Blood Debt upward with the purchased item's tier", () => {
    const debtFor = (tier: ModifierTier): number => {
      resetMoodyModeState();
      restoreEconomyState("blood-market");
      installEconomyScene([partyPokemon(1, 200), partyPokemon(2, 200)]);
      notifyMoodyCoordinatorMarketPurchase(tier, "blood");
      return getMoodyCoordinatorHpDebt(2);
    };

    expect(debtFor(ModifierTier.MASTER)).toBeGreaterThan(debtFor(ModifierTier.GREAT));
  });

  it("keeps Blood Debt through battle/turn cadence and clears it only at a biome transition", () => {
    restoreEconomyState("blood-market");
    installEconomyScene([partyPokemon(1, 200), partyPokemon(2, 200)]);
    notifyMoodyCoordinatorMarketPurchase(ModifierTier.ULTRA, "blood");
    const debt = getMoodyCoordinatorHpDebt(2);

    expect(debt).toBeGreaterThan(0);
    expect(resetMoodyCoordinatorLiveCadence("battle")).toBe(true);
    expect(getMoodyCoordinatorHpDebt(2)).toBe(debt);

    notifyMoodyCoordinatorBiomeTransition();
    expect(getMoodyCoordinatorHpDebt(2)).toBe(0);
  });

  it("clamps current HP to the debt-adjusted maximum exactly once", () => {
    restoreEconomyState("blood-market");
    const debtor = debtAwarePartyPokemon(2, 200);
    installEconomyScene([partyPokemon(1, 200), debtor]);

    notifyMoodyCoordinatorMarketPurchase(ModifierTier.ULTRA, "blood");

    expect(getMoodyCoordinatorHpDebt(2)).toBeGreaterThan(0);
    expect(debtor.hp).toBe(debtor.getMaxHp());
  });

  it("splits a tier-scaled bill between the two most-used Pokemon", () => {
    restoreEconomyState("blood-market", "split-bill");
    const state = createMoodyModeState("split-bill-ranking");
    state.boons.push({
      instanceId: "blood-market:test",
      boonId: "blood-market",
      rank: 3,
      evolutionId: "split-bill",
      acquiredAtWave: 10,
    });
    state.recentThreat = [threat(3, 50, 1500), threat(2, 30, 1000), threat(1, 2, 20)];
    expect(restoreMoodyModeState(state)).toBe(true);
    installEconomyScene([partyPokemon(1, 100), partyPokemon(2, 100), partyPokemon(3, 100)]);

    notifyMoodyCoordinatorMarketPurchase(ModifierTier.ROGUE, "blood");

    expect(getMoodyCoordinatorHpDebt(1)).toBe(0);
    expect(getMoodyCoordinatorHpDebt(2)).toBeGreaterThan(0);
    expect(getMoodyCoordinatorHpDebt(3)).toBeGreaterThan(0);
  });

  it("selects Cursed Inventory from actual usage ranking", () => {
    restoreEconomyState(null, undefined, true);
    const first = partyPokemon(1, 100);
    const second = partyPokemon(2, 100);
    installEconomyScene([first, second], [heldItem(1, "LEFTOVERS"), heldItem(2, "SHELL_BELL")]);

    notifyMoodyCoordinatorBiomeTransition();

    const live = getMoodyCoordinatorEffectState("cursed-inventory");
    expect(live?.values?.cursedInventoryPokemonId).toBe("2");
    expect(live?.values?.cursedInventoryStackId).toBe("2:SHELL_BELL");
  });

  it("falls through a most-used Pokemon with no eligible item stack", () => {
    restoreEconomyState(null, undefined, true);
    const first = partyPokemon(1, 100);
    const second = partyPokemon(2, 100);
    installEconomyScene([first, second], [heldItem(1, "LEFTOVERS")]);

    notifyMoodyCoordinatorBiomeTransition();

    const live = getMoodyCoordinatorEffectState("cursed-inventory");
    expect(live?.values?.cursedInventoryPokemonId).toBe("1");
    expect(live?.values?.cursedInventoryStackId).toBe("1:LEFTOVERS");
  });
});

describe("Moody release blocker: Recycler variants", () => {
  afterEach(() => {
    resetMoodyModeState();
    vi.restoreAllMocks();
  });

  it("requires exactly two destroyed offers for Upcycler", () => {
    restoreEconomyState("recycler", "upcycler");
    let model: MoodyOperationModel | undefined;
    initGlobalScene({
      ui: {
        playError: vi.fn(),
        requestMoodyRecycler: vi.fn((next: MoodyOperationModel) => {
          model = next;
          return new Promise(() => undefined);
        }),
      },
    } as never);
    const phase = Object.create(SelectModifierPhase.prototype) as SelectModifierPhase;
    Object.assign(phase, {
      typeOptions: [
        { type: { name: "A", tier: ModifierTier.GREAT } },
        { type: { name: "B", tier: ModifierTier.ULTRA } },
        { type: { name: "C", tier: ModifierTier.GREAT } },
      ],
    });

    const opened = Reflect.apply(
      Reflect.get(phase as object, "openMoodyRecycler") as (...args: unknown[]) => boolean,
      phase,
      [vi.fn()],
    );

    expect(opened).toBe(true);
    expect(model).toMatchObject({ minSelections: 2, maxSelections: 2 });
  });

  it("passes improved weighting and post-reroll Luck through the live reroll port", () => {
    restoreEconomyState("recycler");
    const reroll = vi.fn();
    const target = createMoodyLiveExecutionTarget();
    target.reward.options.push(
      { id: "destroyed", getTier: () => 1, setTier: vi.fn(), getQuantity: () => 1, setQuantity: vi.fn(), reroll },
      { id: "kept", getTier: () => 1, setTier: vi.fn(), getQuantity: () => 1, setQuantity: vi.fn(), reroll },
    );

    runMoodyCoordinatorLive(
      {
        type: "reward-recycle",
        seed: 7,
        destroyedIndices: [0],
        remainingIndices: [1],
        originalRarities: [1, 1],
        destroyedCategory: "healing",
      },
      target,
    );

    expect(reroll).toHaveBeenCalledWith(
      0,
      null,
      expect.objectContaining({ improvedBaseWeights: true, applyLuckAfterward: true }),
    );
  });

  it("does not re-arm Recycler when the same reward screen reopens from a nested item", () => {
    const continuation = Object.create(SelectModifierPhase.prototype) as SelectModifierPhase;
    Object.assign(continuation, { rerollCount: 0, isCopy: true });
    const initializes = Reflect.get(continuation as object, "initializesRewardScreenLifecycle") as () => boolean;
    expect(Reflect.apply(initializes, continuation, [])).toBe(false);

    const fresh = Object.create(SelectModifierPhase.prototype) as SelectModifierPhase;
    Object.assign(fresh, { rerollCount: 0, isCopy: false });
    expect(Reflect.apply(initializes, fresh, [])).toBe(true);
  });

  it("makes an Upcycler result at least one tier higher than the strongest destroyed offer", () => {
    restoreEconomyState("recycler", "upcycler");
    const reroll = vi.fn();
    const target = createMoodyLiveExecutionTarget();
    target.reward.options.push(
      { id: "great", getTier: () => 1, setTier: vi.fn(), getQuantity: () => 1, setQuantity: vi.fn(), reroll: vi.fn() },
      { id: "rogue", getTier: () => 3, setTier: vi.fn(), getQuantity: () => 1, setQuantity: vi.fn(), reroll: vi.fn() },
      { id: "result", getTier: () => 1, setTier: vi.fn(), getQuantity: () => 1, setQuantity: vi.fn(), reroll },
    );

    runMoodyCoordinatorLive(
      {
        type: "reward-recycle",
        seed: 9,
        destroyedIndices: [0, 1],
        remainingIndices: [2],
        originalRarities: [1, 3, 1],
        destroyedCategory: "healing",
      },
      target,
    );

    expect(reroll).toHaveBeenCalledWith(4, null, expect.objectContaining({ applyLuckAfterward: true }));
  });
});
