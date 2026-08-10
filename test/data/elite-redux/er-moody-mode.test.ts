import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
import {
  addMoodyCurse,
  commitMoodyCurseOffer,
  createMoodyModeState,
  getMoodyBoonBudget,
  getMoodyBoonOffers,
  getMoodyCurseOffers,
  getMoodyModeSaveData,
  initializeMoodyModeState,
  isMoodyBoonRewardWave,
  resetMoodyModeState,
  restoreMoodyModeState,
  rollMoodyBoonDefinition,
} from "#data/elite-redux/moody/moody-state";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => resetMoodyModeState());

describe("Moody Mode catalog", () => {
  it("contains the complete normalized specification", () => {
    expect(MOODY_BOONS).toHaveLength(100);
    expect(MOODY_CURSES).toHaveLength(30);
    expect(new Set(MOODY_BOONS.map(boon => boon.id)).size).toBe(100);
    expect(new Set(MOODY_CURSES.map(curse => curse.id)).size).toBe(30);
    expect(MOODY_BOONS.every(boon => boon.base.length > 0 && boon.rankTwo.length > 0)).toBe(true);
    expect(MOODY_BOONS.every(boon => boon.evolutions.length === 2)).toBe(true);
    expect(MOODY_BOONS.find(boon => boon.id === "set-collector")?.implementationStatus).toBe("blocked");
  });

  it("preserves the authored Unicode text instead of mojibake", () => {
    expect(MOODY_BOONS.find(boon => boon.id === "relay-seat")?.base).toContain("Pokémon");
    expect(MOODY_BOONS.find(boon => boon.id === "crowned-vanguard")?.base).toContain("occupant’s");
  });
});

describe("Moody Mode run state", () => {
  it("offers one draft at each ten-wave boss boundary", () => {
    expect([1, 9, 11, 99].some(isMoodyBoonRewardWave)).toBe(false);
    expect([10, 20, 50, 190].every(isMoodyBoonRewardWave)).toBe(true);
    expect(isMoodyBoonRewardWave(200)).toBe(false);
  });

  it("rolls rarity before definitions so catalog counts do not skew the advertised weights", () => {
    const counts = { great: 0, ultra: 0, rogue: 0, master: 0 };
    for (let seed = 0; seed < 20_000; seed++) {
      counts[rollMoodyBoonDefinition(seed, 73)!.rarity]++;
    }
    expect(counts.great / 20_000).toBeCloseTo(0.52, 1);
    expect(counts.ultra / 20_000).toBeCloseTo(0.3, 1);
    expect(counts.rogue / 20_000).toBeCloseTo(0.14, 1);
    expect(counts.master / 20_000).toBeCloseTo(0.04, 1);
  });

  it("generates a stable three-card boss draft for one seed and wave", () => {
    initializeMoodyModeState("stable-seed");
    const first = structuredClone(getMoodyBoonOffers(10));
    const repeated = structuredClone(getMoodyBoonOffers(10));
    expect(first).toEqual(repeated);
    expect(first).toHaveLength(3);
    expect(new Set(first.map(offer => offer.boonId)).size).toBe(3);

    initializeMoodyModeState("stable-seed");
    expect(getMoodyBoonOffers(10)).toEqual(first);
  });

  it("generates and commits exactly one deterministic opening curse", () => {
    initializeMoodyModeState("opening-curse");
    const first = structuredClone(getMoodyCurseOffers());
    expect(first).toHaveLength(3);
    expect(new Set(first.map(offer => offer.curseId)).size).toBe(3);

    initializeMoodyModeState("opening-curse");
    expect(getMoodyCurseOffers()).toEqual(first);
    const committed = commitMoodyCurseOffer(first[0], { pokemonIds: [42] });
    expect(committed).toMatchObject({ curseId: first[0].curseId, target: { pokemonIds: [42] } });
    expect(getMoodyCurseOffers()).toEqual([]);
    expect(() => commitMoodyCurseOffer(first[1])).toThrow("active draft");
  });

  it("round-trips boon, curse, and threat state defensively", () => {
    const saved = createMoodyModeState("round-trip");
    saved.acquisitionRolls = 4;
    saved.boons.push({
      instanceId: "crowned-vanguard:1:10",
      boonId: "crowned-vanguard",
      rank: 2,
      target: { partySlots: [0] },
      progress: { counters: { triggers: 3 } },
      acquiredAtWave: 10,
    });
    saved.curses.push({ curseId: "frayed-supplies", acquiredAtWave: 20 });
    expect(restoreMoodyModeState(saved)).toBe(true);
    expect(getMoodyBoonBudget()).toBe(4);
    expect(getMoodyModeSaveData()).toEqual(saved);
  });

  it("rejects malformed state instead of partially trusting it", () => {
    expect(restoreMoodyModeState({ version: 99, seed: 1 })).toBe(false);
    expect(getMoodyModeSaveData()).toBeUndefined();
  });

  it("hides exactly one beneficial offer under Cursed Draft", () => {
    initializeMoodyModeState("cursed-seed");
    expect(addMoodyCurse("cursed-draft", 1)).toBe(true);
    const offers = getMoodyBoonOffers(10);
    expect(offers.filter(offer => offer.hidden)).toHaveLength(1);
    expect(offers.every(offer => MOODY_BOONS.some(boon => boon.id === offer.boonId))).toBe(true);
  });
});
