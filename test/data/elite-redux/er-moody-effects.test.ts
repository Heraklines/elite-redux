import {
  MOODY_PASSIVE_EFFECT_COVERAGE,
  MOODY_PASSIVE_SUPPORTED_BOON_IDS,
  MOODY_PASSIVE_SUPPORTED_CURSE_IDS,
  type MoodyPassivePokemonContext,
  type MoodyPassiveQueryContext,
  type MoodyPassiveState,
  queryMoodyPassiveEffects,
} from "#data/elite-redux/moody/moody-effects";
import type { MoodyBoonInstance, MoodyCurseInstance } from "#data/elite-redux/moody/moody-types";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

const actor: MoodyPassivePokemonContext = {
  id: 101,
  partySlot: 0,
  types: [PokemonType.FIRE],
  level: 40,
  currentHp: 80,
  maxHp: 100,
  fainted: false,
  fullyEvolved: true,
};

const target: MoodyPassivePokemonContext = {
  id: 202,
  partySlot: 0,
  types: [PokemonType.GRASS],
  level: 42,
  currentHp: 100,
  maxHp: 100,
  fainted: false,
  fullyEvolved: true,
};

function boon(boonId: string, options: Partial<MoodyBoonInstance> = {}): MoodyBoonInstance {
  return {
    instanceId: `${boonId}:test`,
    boonId,
    rank: 1,
    acquiredAtWave: 10,
    ...options,
  };
}

function curse(curseId: string, options: Partial<MoodyCurseInstance> = {}): MoodyCurseInstance {
  return { curseId, acquiredAtWave: 10, ...options };
}

function state(boons: MoodyBoonInstance[] = [], curses: MoodyCurseInstance[] = []): MoodyPassiveState {
  return { boons, curses };
}

function context(overrides: Partial<MoodyPassiveQueryContext> = {}): MoodyPassiveQueryContext {
  return {
    effectOwnerSide: "player",
    actorSide: "player",
    targetSide: "enemy",
    actor,
    target,
    move: {
      id: MoveId.FLAMETHROWER,
      type: PokemonType.FIRE,
      category: MoveCategory.SPECIAL,
      priority: 0,
      currentPp: 10,
      maxPp: 15,
      useNumber: 1,
      consecutiveUses: 1,
      isStab: true,
      isDamaging: true,
    },
    party: {
      slots: [actor, null, null, null, null, null],
      averageLevel: 40,
      uniqueTypeCount: 1,
    },
    battle: { waveIndex: 20, turn: 1, isBoss: false },
    ...overrides,
  };
}

describe("Moody passive effect coverage", () => {
  it("publishes supported and unsupported IDs without claiming full event coverage", () => {
    expect(MOODY_PASSIVE_SUPPORTED_BOON_IDS.has("empty-throne")).toBe(true);
    expect(MOODY_PASSIVE_SUPPORTED_CURSE_IDS.has("frayed-supplies")).toBe(true);
    expect(MOODY_PASSIVE_EFFECT_COVERAGE.partialBoonIds).toContain("chosen-one");
    expect(MOODY_PASSIVE_EFFECT_COVERAGE.unsupportedBoonIds).toContain("time-loop");
    expect(MOODY_PASSIVE_EFFECT_COVERAGE.unsupportedCurseIds).toContain("entropy");
  });
});

describe("Moody passive combat queries", () => {
  it("composes outgoing bonuses and penalties deterministically", () => {
    const effects = queryMoodyPassiveEffects(
      state(
        [
          boon("off-brand-genius", { rank: 2, target: { pokemonIds: [actor.id] } }),
          boon("specialist-s-focus", { target: { pokemonIds: [actor.id], pokemonType: PokemonType.WATER } }),
        ],
        [curse("accumulated-fatigue")],
      ),
      context({
        flags: { fatigued: true },
        move: {
          ...context().move!,
          type: PokemonType.ELECTRIC,
          isStab: false,
        },
      }),
    );

    expect(effects.outgoingDamageMultiplier).toBeCloseTo(1.3 * 0.95 * 0.85);
    expect(effects.applications.map(application => application.effectId)).toEqual([
      "off-brand-genius",
      "specialist-s-focus",
      "accumulated-fatigue",
    ]);
  });

  it("keeps targeted effects off unrelated Pokemon and sides", () => {
    const effects = queryMoodyPassiveEffects(
      state([boon("negative-space", { target: { pokemonIds: [999], moveIds: [MoveId.TACKLE] } })]),
      context(),
    );
    expect(effects.outgoingDamageMultiplier).toBe(1);
    expect(effects.incomingDamageMultiplier).toBe(1);
  });

  it("queries turn rhythm, priority, and guaranteed accuracy from explicit flags", () => {
    const effects = queryMoodyPassiveEffects(
      state([
        boon("turntable", { rank: 3, evolutionId: "syncopation" }),
        boon("countermelody", { target: { pokemonIds: [actor.id] } }),
      ]),
      context({ flags: { firstMoveOnCurrentBeat: true, countermelodyReady: true } }),
    );
    expect(effects.outgoingDamageMultiplier).toBeCloseTo(1.2 * 1.2);
    expect(effects.priorityDelta).toBe(2);
    expect(effects.alwaysHits).toBe(true);
  });

  it("computes PP conservation, free-use, and escalating cost independently", () => {
    const effects = queryMoodyPassiveEffects(
      state(
        [
          boon("signature-technique", { target: { pokemonIds: [actor.id], moveIds: [MoveId.FLAMETHROWER] } }),
          boon("refrain", {
            rank: 3,
            evolutionId: "efficient-refrain",
            target: { pokemonIds: [actor.id], moveIds: [MoveId.FLAMETHROWER] },
          }),
          boon("deep-reservoir", { rank: 2, target: { moveIds: [MoveId.FLAMETHROWER] } }),
        ],
        [curse("withering-pp")],
      ),
      context({
        move: {
          ...context().move!,
          useNumber: 12,
          consecutiveUses: 4,
        },
      }),
    );
    expect(effects.ppCostMultiplier).toBe(0);
    expect(effects.ppCostFlatDelta).toBe(3);
    expect(effects.maxPpFlatDelta).toBe(5);
  });

  it("handles incoming reductions, caps, and deferred damage without mutating input", () => {
    const input = state([
      boon("damage-ceiling", { rank: 2, target: { partySlots: [0] } }),
      boon("layered-armor", { target: { pokemonIds: [actor.id] } }),
      boon("deferred-pain", { target: { pokemonIds: [actor.id] } }),
    ]);
    const snapshot = structuredClone(input);
    const effects = queryMoodyPassiveEffects(
      input,
      context({
        actorSide: "enemy",
        targetSide: "player",
        actor: target,
        target: actor,
        flags: { firstDirectHitReceived: true },
        battle: { waveIndex: 20, turn: 1, isBoss: false, sameSequenceHitIndex: 3 },
      }),
    );
    expect(effects.incomingDamageMultiplier).toBeCloseTo(0.8 ** 2);
    expect(effects.incomingDamageCapMaxHpFraction).toBe(0.5);
    expect(effects.immediateDamageFraction).toBe(0.65);
    expect(effects.deferredDamageFraction).toBe(0.35);
    expect(input).toEqual(snapshot);
  });
});

describe("Moody passive progression and economy queries", () => {
  it("calculates Empty Throne and Diversity Charter from explicit party composition", () => {
    const effects = queryMoodyPassiveEffects(
      state([
        boon("empty-throne", { rank: 3, evolutionId: "solitary-kingdom" }),
        boon("diversity-charter", { rank: 2 }),
      ]),
      context({
        party: {
          slots: [actor, { ...target, id: 303, partySlot: 1, fainted: true }, null, null, null, null],
          averageLevel: 40,
          uniqueTypeCount: 12,
        },
      }),
    );
    expect(effects.maxHpMultiplier).toBeCloseTo((1 + 4 * 0.12 + 0.08) * 1.05);
    expect(effects.speedMultiplier).toBeCloseTo((1 + 4 * 0.05) * 1.1);
    expect(effects.outgoingDamageMultiplier).toBeCloseTo((1 + 4 * 0.12 + 0.08) * 1.1);
  });

  it("applies underdog EXP and stat compensation with the unevolved multiplier", () => {
    const underdog = { ...actor, level: 30, fullyEvolved: false };
    const effects = queryMoodyPassiveEffects(
      state([boon("underdog-dividend", { rank: 2, target: { pokemonIds: [actor.id] } })]),
      context({
        actor: underdog,
        party: { slots: [underdog], averageLevel: 40, uniqueTypeCount: 1 },
      }),
    );
    expect(effects.nonHpStatMultiplier).toBeCloseTo(1.25);
    expect(effects.speedMultiplier).toBeCloseTo(1.25);
    expect(effects.experienceMultiplier).toBeCloseTo(1.9375);
  });

  it("queries money, prices, healing, and reward rarity separately", () => {
    const runState = state(
      [boon("compound-interest", { rank: 2 }), boon("flawless-ledger", { progress: { counters: { ledgerMarks: 6 } } })],
      [
        curse("frayed-supplies"),
        curse("thin-wallet"),
        curse("the-long-night"),
        curse("hollow-victory", { progress: { counters: { rewardRarityPenalty: 1 } } }),
      ],
    );
    const effects = queryMoodyPassiveEffects(
      runState,
      context({
        economy: { event: "boss-interest", isHealingPurchase: true },
        reward: { slotIndex: 0, slotCount: 3 },
      }),
    );
    expect(effects.moneyGainMultiplier).toBeCloseTo(1.075);
    expect(effects.shopPriceMultiplier).toBeCloseTo(1.3);
    expect(effects.healingMultiplier).toBeCloseTo(0.75);
    expect(effects.rewardRarityOffset).toBe(0);

    const healingPurchase = queryMoodyPassiveEffects(
      runState,
      context({ economy: { event: "market-purchase", isHealingPurchase: true } }),
    );
    expect(healingPurchase.shopPriceMultiplier).toBeCloseTo(1.3 * 2);
  });

  it("applies Reverse Snowball only to the opposing side", () => {
    const runState = state([], [curse("reverse-snowball", { progress: { counters: { flawlessWinStreak: 4 } } })]);
    const enemyEffects = queryMoodyPassiveEffects(
      runState,
      context({ actorSide: "enemy", targetSide: "player", actor: target, target: actor }),
    );
    const playerEffects = queryMoodyPassiveEffects(runState, context());
    expect(enemyEffects.maxHpMultiplier).toBeCloseTo(1.12);
    expect(enemyEffects.speedMultiplier).toBeCloseTo(1.12);
    expect(playerEffects.maxHpMultiplier).toBe(1);
  });

  it("uses Hunter's Mark's stored choice values without inventing progression amounts", () => {
    const effects = queryMoodyPassiveEffects(
      state([
        boon("hunter-s-mark", {
          target: { pokemonType: PokemonType.GRASS },
          progress: { values: { damageBonus: 0.12, resistanceBonus: 0.08, captureBonus: 0.2 } },
        }),
      ]),
      context(),
    );
    expect(effects.outgoingDamageMultiplier).toBeCloseTo(1.12);
    expect(effects.captureMultiplier).toBeCloseTo(1.2);

    const defense = queryMoodyPassiveEffects(
      state([
        boon("hunter-s-mark", {
          target: { pokemonType: PokemonType.FIRE },
          progress: { values: { resistanceBonus: 0.08 } },
        }),
      ]),
      context({ actorSide: "enemy", targetSide: "player", actor: target, target: actor }),
    );
    expect(defense.incomingDamageMultiplier).toBeCloseTo(0.92);
  });
});
