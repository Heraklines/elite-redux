import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
import { MOODY_EFFECT_FLYOUT_POLICY } from "#data/elite-redux/moody/moody-effect-flyout";
import { generateMoodyEnemyBoonLoadout } from "#data/elite-redux/moody/moody-enemy";
import {
  addMoodyCurse,
  commitMoodyBoonOffer,
  commitMoodyCurseOffer,
  createMoodyModeState,
  getMoodyBoonBudget,
  getMoodyBoonOffers,
  getMoodyCurseDreadWeights,
  getMoodyCurseOffers,
  getMoodyModeSaveData,
  initializeMoodyModeState,
  isMoodyBoonRewardWave,
  resetMoodyModeState,
  restoreMoodyModeState,
  rollAndCommitMoodyCurse,
  rollMoodyBoonDefinition,
} from "#data/elite-redux/moody/moody-state";
import type { MoodyBoonOffer } from "#data/elite-redux/moody/moody-types";
import { buildPressureValveBoonTarget } from "#ui/moody/moody-operation";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => resetMoodyModeState());

describe("Moody Mode catalog", () => {
  it("contains the complete normalized specification", () => {
    expect(MOODY_BOONS).toHaveLength(100);
    expect(MOODY_CURSES).toHaveLength(30);
    expect(new Set(MOODY_BOONS.map(boon => boon.id)).size).toBe(100);
    expect(new Set(MOODY_CURSES.map(curse => curse.id)).size).toBe(30);
    expect(MOODY_BOONS.every(boon => boon.base.length > 0 && boon.rankTwo.length > 0)).toBe(true);
    expect(MOODY_BOONS.every(boon => boon.evolutions.length > 0 && boon.evolutions.length <= 2)).toBe(true);
    expect(MOODY_BOONS.find(boon => boon.id === "weather-wake")?.evolutions.map(branch => branch.id)).toEqual([
      "lingering-wake",
    ]);
    expect(
      MOODY_BOONS.every(
        boon =>
          !boon.fullDescription.includes("\n---")
          && !boon.evolutions.some(evolution => /(^|\n)#{1,6}\s/.test(evolution.description)),
      ),
    ).toBe(true);
    expect(MOODY_CURSES.every(curse => !curse.description.includes("\n---"))).toBe(true);
    const playerFacingText = [
      ...MOODY_BOONS.flatMap(boon => [
        boon.base,
        boon.rankTwo,
        boon.fullDescription,
        ...boon.evolutions.map(evolution => evolution.description),
      ]),
      ...MOODY_CURSES.map(curse => curse.description),
    ].join("\n");
    for (const editorialPhrase of [
      "does not disappear when",
      "not above +3",
      "discarded Usurer",
      "deliberately extremely rare",
      "screenshot wording",
      "This version",
    ]) {
      expect(playerFacingText).not.toContain(editorialPhrase);
    }
    const setCollector = MOODY_BOONS.find(boon => boon.id === "set-collector");
    expect(
      setCollector != null
        && (!("implementationStatus" in setCollector) || setCollector.implementationStatus !== "blocked"),
    ).toBe(true);
  });

  it("classifies every boon and curse for trainer-effect flyouts", () => {
    const catalogIds = [...MOODY_BOONS, ...MOODY_CURSES].map(definition => definition.id).sort();
    expect(Object.keys(MOODY_EFFECT_FLYOUT_POLICY).sort()).toEqual(catalogIds);
    expect(new Set(Object.values(MOODY_EFFECT_FLYOUT_POLICY))).toEqual(new Set(["flyout", "drawer-only"]));
    expect(MOODY_EFFECT_FLYOUT_POLICY.mithridatism).toBe("flyout");
    expect(MOODY_EFFECT_FLYOUT_POLICY["compound-interest"]).toBe("drawer-only");
    expect(MOODY_EFFECT_FLYOUT_POLICY["reverse-snowball"]).toBe("flyout");
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

  it("commits and restores the selected Pressure Valve target and conversion", () => {
    let offer: MoodyBoonOffer | undefined;
    for (let seed = 0; seed < 10_000 && offer == null; seed++) {
      initializeMoodyModeState(seed);
      offer = getMoodyBoonOffers(10).find(candidate => candidate.boonId === "pressure-valve");
    }
    expect(offer).toBeDefined();
    const target = buildPressureValveBoonTarget(87, 4, ["pp"]);
    expect(target).not.toBeNull();
    const committed = commitMoodyBoonOffer(offer!, 10, target!);
    expect(committed.target).toEqual({ pokemonIds: [87], partySlots: [4], option: "pp" });

    const saved = getMoodyModeSaveData();
    resetMoodyModeState();
    expect(restoreMoodyModeState(saved)).toBe(true);
    expect(getMoodyModeSaveData()?.boons).toContainEqual(committed);
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

  it("attaches a deterministic Dread I curse after the opening boon and scales later dread pressure", () => {
    initializeMoodyModeState("automatic-curse");
    const opening = rollAndCommitMoodyCurse(0, [11, 22, 33]);
    expect(opening).not.toBeNull();
    expect(MOODY_CURSES.find(curse => curse.id === opening?.curseId)?.dread).toBe(1);
    expect(opening?.acquiredAtWave).toBe(0);

    initializeMoodyModeState("automatic-curse");
    expect(rollAndCommitMoodyCurse(0, [11, 22, 33])).toEqual(opening);
    expect(getMoodyModeSaveData()?.curses).toHaveLength(1);

    expect(getMoodyCurseDreadWeights(0)).toEqual({ 1: 100, 2: 0, 3: 0 });
    expect(getMoodyCurseDreadWeights(100)[1]).toBeLessThan(getMoodyCurseDreadWeights(10)[1]);
    expect(getMoodyCurseDreadWeights(100)[3]).toBeGreaterThan(0);
  });

  it("adds one non-repeating random curse after successive ten-wave drafts", () => {
    initializeMoodyModeState("curse-cadence");
    for (const wave of [0, 10, 20, 30, 40, 50]) {
      expect(rollAndCommitMoodyCurse(wave, [101, 202])).not.toBeNull();
    }
    const curses = getMoodyModeSaveData()?.curses ?? [];
    expect(curses).toHaveLength(6);
    expect(new Set(curses.map(curse => curse.curseId)).size).toBe(6);
    expect(curses.map(curse => curse.acquiredAtWave)).toEqual([0, 10, 20, 30, 40, 50]);
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

  it("spends every player acquisition point on the current enemy loadout", () => {
    const saved = createMoodyModeState("enemy-parity");
    saved.acquisitionRolls = 18;
    expect(restoreMoodyModeState(saved)).toBe(true);
    const enemy = generateMoodyEnemyBoonLoadout([], 80, 1);
    expect(enemy.boons.reduce((total, boon) => total + boon.rank, 0)).toBe(saved.acquisitionRolls);
    expect(enemy.boons.every(boon => boon.rank <= 3)).toBe(true);
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
