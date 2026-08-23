import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
import {
  MOODY_RUNTIME_FIELD_BOON_IDS,
  MOODY_RUNTIME_FIELD_CURSE_IDS,
  MOODY_RUNTIME_FIELD_VARIANTS,
} from "#data/elite-redux/moody/moody-runtime-field";
import {
  MOODY_FORMATION_BOON_IDS,
  MOODY_FORMATION_RUNTIME_DEFINITIONS,
} from "#data/elite-redux/moody/moody-runtime-formation";
import {
  MOODY_RUNTIME_BOON_IDS,
  MOODY_RUNTIME_CURSE_IDS,
  MOODY_RUNTIME_EFFECT_BY_ID,
} from "#data/elite-redux/moody/moody-runtime-meta";
import { describe, expect, it } from "vitest";

describe("Moody runtime catalog coverage", () => {
  it("owns every boon exactly once across the three runtime lanes", () => {
    const runtimeIds = [...MOODY_FORMATION_BOON_IDS, ...MOODY_RUNTIME_FIELD_BOON_IDS, ...MOODY_RUNTIME_BOON_IDS];
    expect(runtimeIds).toHaveLength(100);
    expect(new Set(runtimeIds).size).toBe(100);
    expect([...runtimeIds].sort()).toEqual(MOODY_BOONS.map(boon => boon.id).sort());
  });

  it("owns every curse in at least one runtime lane", () => {
    const runtimeIds = new Set([...MOODY_RUNTIME_FIELD_CURSE_IDS, ...MOODY_RUNTIME_CURSE_IDS]);
    expect([...runtimeIds].sort()).toEqual(MOODY_CURSES.map(curse => curse.id).sort());
  });

  it("defines base, rank-two, and both evolution branches for every boon", () => {
    for (const boon of MOODY_BOONS) {
      if (MOODY_FORMATION_BOON_IDS.includes(boon.id as (typeof MOODY_FORMATION_BOON_IDS)[number])) {
        const runtime = MOODY_FORMATION_RUNTIME_DEFINITIONS[boon.id as (typeof MOODY_FORMATION_BOON_IDS)[number]];
        expect(runtime.evolutionIds).toEqual(boon.evolutions.map(evolution => evolution.id));
        continue;
      }
      if (MOODY_RUNTIME_FIELD_BOON_IDS.includes(boon.id as (typeof MOODY_RUNTIME_FIELD_BOON_IDS)[number])) {
        expect(MOODY_RUNTIME_FIELD_VARIANTS[boon.id as (typeof MOODY_RUNTIME_FIELD_BOON_IDS)[number]]).toEqual({
          base: true,
          rankTwo: true,
          evolutionIds: boon.evolutions.map(evolution => evolution.id),
        });
        continue;
      }
      const runtime = MOODY_RUNTIME_EFFECT_BY_ID.get(boon.id);
      expect(runtime?.base).toBe(boon.base);
      expect(runtime?.rankTwo).toBe(boon.rankTwo);
      expect(runtime?.evolutions.map(evolution => evolution.id)).toEqual(
        boon.evolutions.map(evolution => evolution.id),
      );
    }
  });
});
