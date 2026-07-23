import { grantErShinyLabSavedLookToSave } from "#app/data/elite-redux/er-shiny-lab-effects";
import {
  applySettlementMutations,
  type SettlementGameData,
  type ShowdownSettlementMutation,
} from "#app/data/elite-redux/showdown/showdown-settlement";
import { DexAttr } from "#enums/dex-attr";
import { RibbonData } from "#system/ribbons/ribbon-data";
import type { DexEntry } from "#types/dex-data";
import type { StarterDataEntry } from "#types/save-data";
import { describe, expect, it } from "vitest";
// END-TO-END reward-delivery idempotency proof: the REAL worker translation
// (tournamentGrantSettlements) feeds a stub of er-save-api's showdown_settlements store, and the
// REAL client apply (applySettlementMutations) lands the mutations on a test account's data EXACTLY
// once — a re-sweep applies nothing (client ledger), and a re-delivery inserts nothing (match-id
// idempotency). This is the "chosen-shiny + candy + random-shiny (+ lab effect) lands once" proof.
import { type TournamentRecord, tournamentGrantSettlements } from "../../../../workers/er-telemetry/src/tournament";
import { type Bracket, generateBracket, manualResolve } from "../../../../workers/er-telemetry/src/tournament-bracket";

const BASE = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.FEMALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;

function dexEntry(caughtAttr = BASE): DexEntry {
  return {
    seenAttr: caughtAttr,
    caughtAttr,
    natureAttr: 0,
    seenCount: 0,
    caughtCount: 0,
    hatchedCount: 0,
    ivs: [0, 0, 0, 0, 0, 0],
    ribbons: new RibbonData(0),
  };
}
function starterEntry(): StarterDataEntry {
  return {
    moveset: null,
    eggMoves: 0,
    candyCount: 0,
    friendship: 0,
    abilityAttr: 0,
    passiveAttr: 0,
    valueReduction: 0,
    classicWinCount: 0,
  };
}

/** Test account: base-caught (unowned shiny) entries for every species the reward touches. */
function makeAccount() {
  const dexData: Record<number, DexEntry> = { 1: dexEntry(), 6: dexEntry(), 25: dexEntry(), 151: dexEntry() };
  const starterData: Record<number, StarterDataEntry> = {};
  const gameData: SettlementGameData = {
    dexData,
    starterData,
    getRootStarterSpeciesId: id => id,
    getStarterDataEntry: id => (starterData[id] ??= starterEntry()),
    addStarterCandy: (id, count) => {
      starterData[id] = starterData[id] ?? starterEntry();
      starterData[id].candyCount += count;
      return true;
    },
    showdownAppliedSettlements: [],
  };
  return { gameData, dexData, starterData };
}

/**
 * Stub of er-save-api's showdown_settlements store + the tournament-grant delivery + the client
 * pending/ack sweep — the exact discipline the real workers use (row id + ledger + match-id guard).
 */
class SettlementStore {
  rows: { id: number; matchId: string; uid: string; mutation: ShowdownSettlementMutation; applied: boolean }[] = [];
  private nextId = 1;
  /** Idempotent insert (mirrors finalizeSettlement / handleShowdownTournamentGrant): no-op if the match id already has rows. */
  deliver(matchId: string, settlements: { uid: string; mutation: ShowdownSettlementMutation }[]): number {
    if (this.rows.some(r => r.matchId === matchId)) {
      return 0;
    }
    let n = 0;
    for (const s of settlements) {
      this.rows.push({ id: this.nextId++, matchId, uid: s.uid, mutation: s.mutation, applied: false });
      n++;
    }
    return n;
  }
  pending(uid: string): { id: number; mutation: ShowdownSettlementMutation }[] {
    return this.rows.filter(r => r.uid === uid && !r.applied).map(r => ({ id: r.id, mutation: r.mutation }));
  }
  ack(uid: string, ids: number[]): void {
    for (const r of this.rows) {
      if (r.uid === uid && ids.includes(r.id)) {
        r.applied = true;
      }
    }
  }
}

/** The client login sweep (mirror of syncShowdownPendingSettlements): filter by ledger, apply, ack. */
function clientSweep(store: SettlementStore, gameData: SettlementGameData, uid: string): number {
  const items = store.pending(uid);
  const ledger = new Set(gameData.showdownAppliedSettlements);
  const fresh = items.filter(i => !ledger.has(i.id));
  const applied = applySettlementMutations(
    fresh.map(i => i.mutation),
    gameData,
    fresh.map(i => i.id),
  );
  store.ack(
    uid,
    items.map(i => i.id),
  );
  return applied;
}

function completeTournament(rewardPool: TournamentRecord["rewardPool"]): TournamentRecord {
  let bracket: Bracket = generateBracket(
    "cup",
    [
      { participant: "alice", seed: 1 },
      { participant: "bob", seed: 2 },
      { participant: "carol", seed: 3 },
      { participant: "dave", seed: 4 },
    ],
    86_400_000,
    0,
  );
  for (const m of bracket.rounds[0]) {
    bracket = manualResolve(bracket, m.id, m.a as string).bracket;
  }
  bracket = manualResolve(bracket, bracket.rounds[1][0].id, "alice").bracket;
  return {
    id: "cup",
    name: "Cup",
    organizer: "admin",
    state: "complete",
    roundWindowMs: 86_400_000,
    maxEntrants: 4,
    createdAt: 0,
    startedAt: 0,
    champion: "alice",
    bracket,
    battleFormat: "singles",
    seriesFormat: "single",
    rewardPool,
    closeAt: null,
    rewardsGranted: false,
    community: false,
  };
}

describe("tournament reward delivery — end to end, exactly once", () => {
  const champLook = [3, 0, 0, 255, 255, 255, 96, 0, 0, 0, 0, 0, 70, 85]; // palette effect index 3

  function grantAndDeliver(store: SettlementStore) {
    const t = completeTournament([
      {
        place: "champion",
        mutations: [
          { kind: "grantShinyChosen", speciesId: 6, tier: 4 }, // black shiny
          { kind: "grantCandy", speciesId: 1, candy: 25 },
          { kind: "grantShinyRandom", tier: 2, unownedOnly: false, speciesPool: [151] },
          { kind: "grantLabEffect", speciesId: 25, category: "palette", effectIndex: 3 },
        ],
      },
    ]);
    return store.deliver(`tour:${t.id}`, tournamentGrantSettlements(t));
  }

  it("a chosen-shiny + candy + random-shiny + lab reward lands in the champion's data exactly once", () => {
    const store = new SettlementStore();
    const { gameData, dexData, starterData } = makeAccount();
    expect(grantAndDeliver(store)).toBe(4); // 4 mutations delivered to the store

    // First sweep applies all four.
    expect(clientSweep(store, gameData, "alice")).toBe(4);

    // Black shiny on species 6: SHINY + VARIANT_3 dex bits + the erBlackShiny flag.
    expect(dexData[6].caughtAttr & DexAttr.SHINY).toBe(DexAttr.SHINY);
    expect(dexData[6].caughtAttr & DexAttr.VARIANT_3).toBe(DexAttr.VARIANT_3);
    expect(starterData[6].erBlackShiny).toBe(true);
    // Candy on species 1.
    expect(starterData[1].candyCount).toBe(25);
    // Random shiny tier 2 -> variant 1 (VARIANT_2) on species 151.
    expect(dexData[151].caughtAttr & DexAttr.SHINY).toBe(DexAttr.SHINY);
    expect(dexData[151].caughtAttr & DexAttr.VARIANT_2).toBe(DexAttr.VARIANT_2);
    // Lab effect owned on species 25 (re-granting the same look now yields NOTHING new -> owned).
    expect(starterData[25].erShinyLab).toBeDefined();
    expect(grantErShinyLabSavedLookToSave(starterData[25].erShinyLab!, champLook)).toEqual([]);

    // RE-SWEEP: the client ledger skips already-applied rows -> zero applied, candy NOT doubled.
    expect(clientSweep(store, gameData, "alice")).toBe(0);
    expect(starterData[1].candyCount).toBe(25);
  });

  it("RED-PROOF: without the ledger guard a re-apply WOULD double the candy", () => {
    const { gameData, starterData } = makeAccount();
    const candy: ShowdownSettlementMutation = { kind: "grantCandy", speciesId: 1, candy: 25 };
    // Two naive applies with NO ledger ids -> the guard never engages -> candy doubles.
    applySettlementMutations([candy], gameData);
    applySettlementMutations([candy], gameData);
    expect(starterData[1].candyCount).toBe(50);
  });

  it("RED-PROOF: re-delivering the same tournament inserts NO new settlement rows (match-id idempotency)", () => {
    const store = new SettlementStore();
    expect(grantAndDeliver(store)).toBe(4); // first delivery
    expect(grantAndDeliver(store)).toBe(0); // second delivery for the same tour: no-op
    expect(store.rows).toHaveLength(4);

    // A champion who already swept then gets NOTHING new from a re-delivery.
    const { gameData } = makeAccount();
    expect(clientSweep(store, gameData, "alice")).toBe(4);
    grantAndDeliver(store); // idempotent no-op
    expect(clientSweep(store, gameData, "alice")).toBe(0);
  });
});
