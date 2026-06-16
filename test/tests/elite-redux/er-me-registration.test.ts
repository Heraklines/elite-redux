import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { allMysteryEncounters, initMysteryEncounters } from "#mystery-encounters/mystery-encounters";
import { describe, expect, it } from "vitest";

// ER #498/#499 regression: a module-load error in ANY encounter file (e.g. a bad
// import in graves-of-the-fallen) would make initMysteryEncounters throw and
// register NO encounters, so MYSTERY_ENCOUNTER_OVERRIDE would silently fall
// through to a normal battle. Guard the registration of the ER events we touched.
describe("ER mystery-encounter registration", () => {
  it("registers the ER events without throwing", () => {
    expect(() => initMysteryEncounters()).not.toThrow();

    for (const type of [
      MysteryEncounterType.ER_TRACKS_IN_THE_SNOW,
      MysteryEncounterType.ER_GRAVES_OF_THE_FALLEN,
      MysteryEncounterType.ER_AURORA,
      MysteryEncounterType.ER_FROZEN_SHAPES,
    ]) {
      expect(allMysteryEncounters[type], `${MysteryEncounterType[type]} should be registered`).toBeDefined();
    }
  });
});
