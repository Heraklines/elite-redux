import { RibbonData } from "#system/ribbons/ribbon-data";
import type { DexEntry } from "#types/dex-data";
import type { StarterDataEntry } from "#types/save-data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The escrow client reads the session cookie for the Bearer header; stub it so escrowFetch runs
// in a node test env (no document). VITE_SERVER_URL is stubbed per-test so escrowBase() is non-null.
vi.mock("#utils/cookies", () => ({ getCookie: () => "test-token" }));

import { syncShowdownPendingSettlements } from "#app/data/elite-redux/showdown/showdown-escrow-client";
import type { SettlementGameData } from "#app/data/elite-redux/showdown/showdown-settlement";
import { DexAttr } from "#enums/dex-attr";

const BASE = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.FEMALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;

function dexEntry(caughtAttr = 0n): DexEntry {
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

function stubGameData(saveResult: boolean) {
  const dexData: Record<number, DexEntry> = { 1: dexEntry(0n) };
  const starterData: Record<number, StarterDataEntry> = { 1: starterEntry() };
  const saveSystem = vi.fn(() => Promise.resolve(saveResult));
  const gameData: SettlementGameData = {
    dexData,
    starterData,
    getRootStarterSpeciesId: (id: number) => id,
    getStarterDataEntry: (id: number) => (starterData[id] ??= starterEntry()),
    addStarterCandy: () => true,
    showdownAppliedSettlements: [],
    saveSystem,
  };
  return { gameData, dexData, saveSystem };
}

/** A pending row granting species #1 (unowned → sets the base caught bits). */
const pendingItem = (id: number) => ({
  id,
  matchId: "m1",
  mutation: { kind: "grantUnlock", speciesId: 1, shiny: false, variant: 0, erBlackShiny: false, cost: 5 },
});

/** Install a fetch mock: GET /pending returns `items`; POST /pending/ack records the call. */
function mockFetch(items: ReturnType<typeof pendingItem>[]) {
  const ackCalls: number[][] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/showdown/pending")) {
      return Promise.resolve(new Response(JSON.stringify({ items }), { status: 200 }));
    }
    if (url.endsWith("/showdown/pending/ack")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { ids?: number[] };
      ackCalls.push(body.ids ?? []);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, acked: (body.ids ?? []).length }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, ackCalls };
}

describe("syncShowdownPendingSettlements — ledger + ack ordering", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SERVER_URL", "http://escrow.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("applies once, ledgers the id, saves, then acks (happy path)", async () => {
    const { gameData, dexData, saveSystem } = stubGameData(true);
    const { ackCalls } = mockFetch([pendingItem(7)]);
    const applied = await syncShowdownPendingSettlements(gameData);
    expect(applied).toBe(1);
    expect(dexData[1].caughtAttr & BASE).toBe(BASE); // mutation applied
    expect(gameData.showdownAppliedSettlements).toEqual([7]); // ledgered
    expect(saveSystem).toHaveBeenCalledWith(true);
    expect(ackCalls).toEqual([[7]]); // acked after save success
  });

  it("skips re-applying an id already in the ledger (idempotent double-apply)", async () => {
    const { gameData, dexData } = stubGameData(true);
    gameData.showdownAppliedSettlements = [7]; // already applied last time
    mockFetch([pendingItem(7)]);
    const applied = await syncShowdownPendingSettlements(gameData);
    expect(applied).toBe(0); // nothing fresh → no re-mutation
    expect(dexData[1].caughtAttr).toBe(0n); // dex NOT mutated a second time
  });

  it("does NOT ack when the save fails; the ledger still records the apply for the next retry", async () => {
    const { gameData, saveSystem } = stubGameData(false); // save fails
    const { ackCalls } = mockFetch([pendingItem(7)]);
    const applied = await syncShowdownPendingSettlements(gameData);
    expect(applied).toBe(1); // applied locally
    expect(saveSystem).toHaveBeenCalledWith(true);
    expect(ackCalls).toEqual([]); // NOT acked (save failed)
    expect(gameData.showdownAppliedSettlements).toEqual([7]); // ledgered → next sync won't re-mutate
  });

  it("after a save-failure, the next sync re-acks (server-idempotent) without re-mutating", async () => {
    const { gameData, dexData } = stubGameData(true);
    gameData.showdownAppliedSettlements = [7]; // applied but never acked last time
    const { ackCalls } = mockFetch([pendingItem(7)]);
    const applied = await syncShowdownPendingSettlements(gameData);
    expect(applied).toBe(0); // no re-mutation
    expect(dexData[1].caughtAttr).toBe(0n);
    expect(ackCalls).toEqual([[7]]); // re-acked so the row finally clears
  });
});
