import {
  applyMoodyRuntimeStateDeltas,
  MOODY_RUNTIME_BLOCKED_IDS,
  MOODY_RUNTIME_BOON_IDS,
  MOODY_RUNTIME_CURSE_IDS,
  MOODY_RUNTIME_EFFECTS,
  MOODY_RUNTIME_NONCOMBAT_CURSE_IDS,
  MOODY_RUNTIME_PROGRESSION_CURSE_IDS,
  type MoodyRuntimeEffectMeta,
  type MoodyRuntimeEvent,
  type MoodyRuntimeState,
  type MoodyRuntimeValue,
  resolveMoodyRuntimeEffect,
} from "#data/elite-redux/moody/moody-runtime-meta";
import { describe, expect, it } from "vitest";

const expectedBoonIds = [
  "compound-interest",
  "warranty",
  "recycler",
  "set-collector",
  "blood-market",
  "bounty-board",
  "recruiter-s-eye",
  "contraband-slot",
  "diversity-charter",
  "monotype-oath",
  "underdog-dividend",
  "growth-ring",
  "flawless-ledger",
  "hunter-s-mark",
  "pair-bond",
  "bench-academy",
  "bossbreaker",
  "legacy-slot",
  "time-loop",
  "recapitulation",
  "pocket-turn",
  "ability-carousel",
  "mirror-theft",
  "phase-shift",
  "apex-plunder",
  "inversion-window",
  "borrowed-future",
  "pressure-valve",
  "negative-space",
] as const;

const expectedNoncombatCurseIds = [
  "frayed-supplies",
  "thin-wallet",
  "jealous-relics",
  "no-takebacks",
  "mortal-wounds",
  "cursed-inventory",
  "elite-pursuit",
  "hollow-victory",
  "the-long-night",
] as const;

const expectedProgressionCurseIds = [
  "public-enemy",
  "mood-swing",
  "nemesis-protocol",
  "blood-moon",
  "reverse-snowball",
  "cursed-draft",
  "entropy",
  "feedback-loop",
] as const;

const samples: Readonly<Record<string, MoodyRuntimeValue>> = {
  money: 1000,
  capRemaining: 500,
  patientRate: 0.025,
  itemStackId: "leftovers:1",
  activationIndex: 1,
  isSelectedStack: true,
  roll: 0,
  extendedChance: 0.5,
  destroyedIndices: [0],
  remainingIndices: [1, 2],
  originalRarities: [1, 2, 3],
  destroyedCategory: "healing",
  ownedDistinctItemIds: ["LEFTOVERS", "SHELL_BELL", "HEALING_CHARM"],
  chosenSetId: "restoration-kit",
  itemTier: 3,
  debtRate: 0.2,
  usageRanking: ["101", "202"],
  maxHpByPokemon: { "101": 200, "202": 100 },
  feasibleContractIds: ["no-faint", "five-types", "turn-limit"],
  contractId: "no-faint",
  missingTraits: ["ability:2", "nature:timid", "egg-move:7"],
  traitRarity: { "ability:2": 0.2, "nature:timid": 0.8, "egg-move:7": 0.1 },
  uniqueTypeCount: 12,
  firstDamagingMove: true,
  firstSuperEffectiveHit: true,
  matchingContributors: 6,
  consciousCount: 6,
  allConsciousMatch: true,
  moveMatchesType: true,
  incomingMatchesType: true,
  levelGap: 8,
  fullyEvolved: false,
  enemyAboveLevel: true,
  caughtUp: true,
  pokemonId: "101",
  alliedFaintCount: 0,
  biomeFailureShieldAvailable: true,
  slotCount: 3,
  matchesMarkedType: true,
  bossSegments: 2,
  choice: "damageBonus",
  amount: 0.05,
  bothConscious: true,
  fallenPokemonId: "101",
  survivorPokemonId: "202",
  eligibleMoveIds: ["7", "9"],
  isLowest: true,
  isSecondLowest: true,
  eligibleImprints: ["chosen-one:glory", "bossbreaker:segments"],
  partySlot: 0,
  boundPartySlot: 0,
  isBossBattle: true,
  segmentUses: 0,
  turnSnapshotId: "turn:4",
  enemyActionIds: ["enemy:move:1"],
  action: { actionId: "player:move:1", pokemonId: "101", moveId: "53", offensiveStat: 140 },
  reason: "miss",
  actionId: "player:move:2",
  targetActionId: "enemy:move:2",
  occupiedParty: ["101", "202"],
  compatibleAbilityIdsByPokemon: { "101": ["7", "9"], "202": ["12"] },
  compatibleAbilityIds: ["7", "9"],
  effectKind: "weather",
  effectData: { weather: "rain", turns: 5 },
  targetPokemonId: "101",
  turn: 5,
  direction: "outgoing",
  effectiveness: 0.5,
  enemyRoster: ["enemy:1", "enemy:2"],
  enemyLead: "enemy:1",
  committedActions: [{ actionId: "enemy:move:1", moveId: "89", target: "player:lead" }],
  visibleLeadData: { moves: ["89"], abilities: ["22"], items: ["leftovers"] },
  overflowStages: 3,
  selectedValve: "barrier",
  mostUsefulValve: "healing",
  moveId: "53",
  isFirstUsableMove: true,
  sealedMoveIds: ["53"],
  price: 100,
  copyIndex: 2,
  effectValue: 1,
  duplicateScale: 0.5,
  operation: "recycle",
  baseCost: 2,
  baseSacrifices: 1,
  eligibleStacksByPokemon: { "101": ["vitamin:atk"], "202": [] },
  isActive: true,
  waveIndex: 50,
  isBossWave: false,
  isHealingItem: true,
  isEligibleTrainer: true,
  isBossTrainer: true,
  baseRosterSize: 6,
  maxRosterSize: 8,
  activeBoonInstanceIds: ["boon:a", "boon:b", "boon:c"],
  baseCounterWeight: 0.1,
  isBoss: true,
  topThreatPokemonId: "101",
  pokemonIds: ["enemy:1", "enemy:2"],
  partySize: 6,
  offerIds: ["offer:a", "offer:b", "offer:c"],
  partyMoves: { "101": ["53"], "202": ["89"] },
  eligibleReplacementsByMove: { "53": ["58", "59"], "89": ["90"] },
  maxHp: 200,
  currentHp: 150,
  triggeredBoonIds: ["a", "b", "c", "d"],
};

function eventFor(meta: MoodyRuntimeEffectMeta, eventIndex: number): MoodyRuntimeEvent {
  const contract = meta.events[eventIndex];
  const data = Object.fromEntries(contract.requiredInputs.map(key => [key, samples[key]]));
  for (const optional of ["roll", "extendedChance", "sealedMoveIds", "safetyCap", "completionistCatchMultiplier"]) {
    if (samples[optional] !== undefined) {
      data[optional] = samples[optional];
    }
  }
  return { kind: contract.kind, seed: 0x5eed + eventIndex, data };
}

function outputsFor(meta: MoodyRuntimeEffectMeta, stage: string, state: MoodyRuntimeState = {}) {
  return meta.events.map((_, index) => resolveMoodyRuntimeEffect(meta.id, stage, eventFor(meta, index), state));
}

describe("Moody runtime meta exact coverage", () => {
  it("covers exactly boon lines 72-100", () => {
    expect(MOODY_RUNTIME_BOON_IDS).toEqual(expectedBoonIds);
    expect(MOODY_RUNTIME_EFFECTS.filter(effect => effect.source === "boon").map(effect => effect.number)).toEqual(
      Array.from({ length: 29 }, (_, index) => index + 72),
    );
  });

  it("covers exactly the requested noncombat and Dread III progression curses", () => {
    expect(MOODY_RUNTIME_NONCOMBAT_CURSE_IDS).toEqual(expectedNoncombatCurseIds);
    expect(MOODY_RUNTIME_PROGRESSION_CURSE_IDS).toEqual(expectedProgressionCurseIds);
    expect(MOODY_RUNTIME_CURSE_IDS).toEqual([...expectedNoncombatCurseIds, ...expectedProgressionCurseIds]);
    expect(MOODY_RUNTIME_EFFECTS.filter(effect => effect.source === "curse").map(effect => effect.number)).toEqual([
      1, 2, 5, 8, 11, 17, 18, 19, 21, 23, 24, 25, 26, 27, 28, 29, 30,
    ]);
  });

  it("has no blocked effects and executes every catalog effect", () => {
    expect(MOODY_RUNTIME_BLOCKED_IDS).toEqual([]);
    expect(MOODY_RUNTIME_EFFECTS.filter(effect => effect.status === "blocked")).toEqual([]);
    for (const meta of MOODY_RUNTIME_EFFECTS.filter(effect => effect.status === "ready")) {
      expect(meta.events.length, meta.id).toBeGreaterThan(0);
      expect(
        outputsFor(meta, "base").some(output => output.commands.length + output.stateDeltas.length > 0),
        meta.id,
      ).toBe(true);
    }
  });

  it("publishes and executes every boon rank and evolution branch deterministically", () => {
    for (const meta of MOODY_RUNTIME_EFFECTS.filter(effect => effect.source === "boon" && effect.status === "ready")) {
      expect(meta.base.length, `${meta.id}:base`).toBeGreaterThan(0);
      expect(meta.rankTwo?.length, `${meta.id}:rank-two`).toBeGreaterThan(0);
      expect(meta.evolutions.length, meta.id).toBeGreaterThanOrEqual(1);
      expect(meta.evolutions.length, meta.id).toBeLessThanOrEqual(2);
      for (const stage of ["base", "rank-two", ...meta.evolutions.map(evolution => evolution.id)]) {
        const state: MoodyRuntimeState = {
          counters: { ledgerMarks: 6, hunterProgress: 7, tempo: 3 },
          flags: { secondActAvailable: true, stablePhasePendingHit: true },
          values: { apexSegments: [0.25], cursedInventoryPokemonId: "101", cursedInventoryStackId: "leftovers:1" },
        };
        const before = structuredClone(state);
        const first = outputsFor(meta, stage, state);
        const second = outputsFor(meta, stage, state);
        expect(first, `${meta.id}:${stage}`).toEqual(second);
        expect(state, `${meta.id}:${stage}:input mutation`).toEqual(before);
        expect(
          first.some(output => output.commands.length + output.stateDeltas.length > 0),
          `${meta.id}:${stage}`,
        ).toBe(true);
      }
    }
  });

  it("rejects missing required event fields", () => {
    expect(() =>
      resolveMoodyRuntimeEffect("compound-interest", "base", {
        kind: "boss-defeated",
        seed: 1,
        data: { money: 100 },
      }),
    ).toThrow("compound-interest:boss-defeated missing inputs: capRemaining");
  });
});

describe("Moody runtime meta progression", () => {
  it("advances Flawless Ledger with the authored escalating pair cadence", () => {
    let state: MoodyRuntimeState = {};
    const requirements: number[] = [];
    for (let mark = 0; mark < 6; mark++) {
      let waves = 0;
      do {
        const output = resolveMoodyRuntimeEffect(
          "flawless-ledger",
          "base",
          {
            kind: "wave-completed",
            seed: 1,
            data: { alliedFaintCount: 0, biomeFailureShieldAvailable: false },
          },
          state,
        );
        state = applyMoodyRuntimeStateDeltas(state, output.stateDeltas);
        waves++;
      } while ((state.counters?.ledgerMarks ?? 0) === mark);
      requirements.push(waves);
    }
    expect(requirements).toEqual([2, 2, 3, 3, 4, 4]);
  });

  it("queues Hunter's Mark choices at base and ranked thresholds", () => {
    const base = resolveMoodyRuntimeEffect(
      "hunter-s-mark",
      "base",
      {
        kind: "typed-enemy-defeated",
        seed: 1,
        data: { matchesMarkedType: true, bossSegments: 0 },
      },
      { counters: { hunterProgress: 9 } },
    );
    const ranked = resolveMoodyRuntimeEffect(
      "hunter-s-mark",
      "rank-two",
      {
        kind: "typed-enemy-defeated",
        seed: 1,
        data: { matchesMarkedType: true, bossSegments: 0 },
      },
      { counters: { hunterProgress: 7 } },
    );
    expect(base.commands[0]?.kind).toBe("queue-post-battle-hunter-choice");
    expect(ranked.commands[0]?.kind).toBe("queue-post-battle-hunter-choice");
  });

  it("stores each Hunter's Mark choice as an exact 15% bonus", () => {
    const resolved = resolveMoodyRuntimeEffect("hunter-s-mark", "base", {
      kind: "hunter-choice-resolved",
      seed: 1,
      data: { choice: "damageBonus", amount: 0.15 },
    });
    expect(resolved.stateDeltas).toContainEqual(expect.objectContaining({ path: "counters.damageBonus", value: 0.15 }));
  });

  it("makes Cursed Inventory and Entropy deterministic for a seed", () => {
    const cursedEvent = {
      kind: "biome-transition",
      seed: 77,
      data: { usageRanking: ["101", "202"], eligibleStacksByPokemon: { "101": ["a", "b"], "202": ["c"] } },
    } as const;
    expect(resolveMoodyRuntimeEffect("cursed-inventory", "base", cursedEvent)).toEqual(
      resolveMoodyRuntimeEffect("cursed-inventory", "base", cursedEvent),
    );

    const entropyEvent = {
      kind: "biome-transition",
      seed: 77,
      data: {
        partyMoves: { "101": ["53"], "202": ["89"] },
        eligibleReplacementsByMove: { "53": ["58", "59"], "89": ["90"] },
      },
    } as const;
    expect(resolveMoodyRuntimeEffect("entropy", "base", entropyEvent)).toEqual(
      resolveMoodyRuntimeEffect("entropy", "base", entropyEvent),
    );
  });

  it("caps Feedback Loop damage at current HP minus one", () => {
    const output = resolveMoodyRuntimeEffect("feedback-loop", "base", {
      kind: "action-boons-resolved",
      seed: 1,
      data: { pokemonId: "101", maxHp: 1000, currentHp: 20, triggeredBoonIds: ["a", "b", "c", "d"] },
    });
    expect(output.commands[0]).toEqual({
      kind: "deal-nonlethal-feedback-damage",
      data: { pokemonId: "101", damage: 19, triggeredBoonCount: 4 },
    });
  });

  it("applies state deltas without mutating the source snapshot", () => {
    const source: MoodyRuntimeState = { counters: { one: 1 }, flags: { ready: true }, values: { name: "before" } };
    const before = structuredClone(source);
    const next = applyMoodyRuntimeStateDeltas(source, [
      { op: "increment", path: "counters.one", value: 2 },
      { op: "set", path: "flags.ready", value: false },
      { op: "set", path: "values.name", value: "after" },
    ]);
    expect(source).toEqual(before);
    expect(next).toEqual({ counters: { one: 3 }, flags: { ready: false }, values: { name: "after" } });
  });
});
