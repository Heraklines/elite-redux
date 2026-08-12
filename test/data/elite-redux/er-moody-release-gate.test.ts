import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
import {
  createMoodyModeState,
  getMoodyModeSaveData,
  MOODY_BOON_BY_ID,
  resetMoodyModeState,
  restoreMoodyModeState,
} from "#data/elite-redux/moody/moody-state";
import type { MoodyBoonInstance, MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";
import { afterEach, describe, expect, it } from "vitest";

const EDITORIAL_COPY = [
  /\bimplementation(?: status)?\b/i,
  /\bimplemented\b/i,
  /\bcorrection text\b/i,
  /\bscreenshot wording\b/i,
  /\bdesigner note\b/i,
  /\bdeveloper note\b/i,
  /\bplayer-facing\b/i,
  /\bmust be displayed(?: prominently)?\b/i,
  /\bneeds an explicit .* adapter\b/i,
  /\brequires a properly audited\b/i,
  /\bsafer than immediately\b/i,
  /\bmust prove basic feasibility\b/i,
  /\bfunctional, but currently\b/i,
  /\bvalid base line\b/i,
  /\bcontent remains blocked\b/i,
] as const;

function branchInstances(): MoodyBoonInstance[] {
  return MOODY_BOONS.flatMap(boon => [
    {
      instanceId: `${boon.id}:base`,
      boonId: boon.id,
      rank: 1 as const,
      acquiredAtWave: 10,
    },
    {
      instanceId: `${boon.id}:rank-two`,
      boonId: boon.id,
      rank: 2 as const,
      acquiredAtWave: 20,
    },
    ...boon.evolutions.map((evolution, index) => ({
      instanceId: `${boon.id}:${evolution.id}`,
      boonId: boon.id,
      rank: 3 as const,
      evolutionId: evolution.id,
      acquiredAtWave: 30 + index * 10,
    })),
  ]);
}

function roundTripWithBoon(instance: MoodyBoonInstance): MoodyModeSaveData {
  const state = createMoodyModeState(`release:${instance.instanceId}`);
  state.boons = [instance];
  state.curses = MOODY_CURSES.map(curse => ({
    curseId: curse.id,
    acquiredAtWave: curse.number * 10,
    progress: {
      counters: { triggers: curse.number },
      flags: { active: true },
      values: { source: "release-gate" },
    },
  }));
  const wire = JSON.parse(JSON.stringify(state));
  expect(restoreMoodyModeState(wire), instance.instanceId).toBe(true);
  return getMoodyModeSaveData()!;
}

afterEach(() => resetMoodyModeState());

describe("Moody release gate", () => {
  it("enumerates every catalog branch and keeps exactly one explicitly blocked boon", () => {
    const branches = branchInstances();
    const expected = MOODY_BOONS.reduce((count, boon) => count + 2 + boon.evolutions.length, 0);
    expect(branches).toHaveLength(expected);
    expect(new Set(branches.map(branch => branch.instanceId)).size).toBe(expected);
    expect(
      [...MOODY_BOON_BY_ID.values()].filter(boon => boon.implementationStatus === "blocked").map(boon => boon.id),
    ).toEqual(["set-collector"]);
  });

  it("round-trips every base, rank-two, evolution, curse, target, and progress payload", () => {
    for (const branch of branchInstances()) {
      const withPayload: MoodyBoonInstance = {
        ...branch,
        target: {
          pokemonIds: [101],
          partySlots: [0],
          moveIds: [1],
          itemTypeIds: ["LEFTOVERS"],
          option: "release-gate",
        },
        progress: {
          counters: { triggers: 3 },
          flags: { primed: true },
          values: { multiplier: 1.25, source: "release-gate" },
        },
      };
      const restored = roundTripWithBoon(withPayload);
      expect(restored.boons, branch.instanceId).toEqual([withPayload]);
      expect(restored.curses, branch.instanceId).toHaveLength(MOODY_CURSES.length);
      expect(
        restored.curses.map(curse => curse.curseId),
        branch.instanceId,
      ).toEqual(MOODY_CURSES.map(curse => curse.id));
    }
  });

  it("keeps internal instructions and implementation commentary out of all player copy", () => {
    const fields = [
      ...MOODY_BOONS.flatMap(
        boon =>
          [
            [`${boon.id}.base`, boon.base],
            [`${boon.id}.rankTwo`, boon.rankTwo],
            [`${boon.id}.fullDescription`, boon.fullDescription],
            ...boon.evolutions.map(evolution => [`${boon.id}.${evolution.id}`, evolution.description]),
          ] as const,
      ),
      ...MOODY_CURSES.map(curse => [`${curse.id}.description`, curse.description] as const),
    ];

    for (const [field, copy] of fields) {
      expect(copy.trim().length, field).toBeGreaterThan(0);
      for (const forbidden of EDITORIAL_COPY) {
        expect(copy, `${field} contains ${forbidden}`).not.toMatch(forbidden);
      }
    }
  });
});
