/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Scenario-builder spec (dev test suite, staging only): share-code round trip,
// spec -> DevScenario override mapping, and the custom enemy-party staging.
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-scenario-spec.test.ts
import { consumePendingDevEnemyParty } from "#app/dev-tools/registry";
import { resetDevOverrides } from "#app/dev-tools/test-suite/dev-overrides";
import {
  buildDevScenario,
  decodeScenarioSpec,
  encodeScenarioSpec,
  type ScenarioSpec,
} from "#app/dev-tools/test-suite/scenario-spec";
import Overrides from "#app/overrides";
import { resetErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { afterEach, describe, expect, it } from "vitest";

const SPEC: ScenarioSpec = {
  v: 1,
  name: "Repro 123",
  notes: "do X, expect Y",
  run: { wave: 42, weather: WeatherType.RAIN, level: 50, seed: "devseedrepro1234", difficulty: "elite" },
  party: [{ species: SpeciesId.PIKACHU, moves: [MoveId.THUNDERBOLT], abilitySlot: 1, shiny: true, variant: 1 }],
  enemy: {
    kind: "wild",
    wild: { species: SpeciesId.GARCHOMP, level: 60, moves: [MoveId.EARTHQUAKE], bossSegments: 3 },
  },
  items: { held: [{ name: "LEFTOVERS" }], shop: ["RARE_CANDY"] },
  start: { playerStages: [4, 0, 0, 0, 0, 0, 0], enemyHpPct: 30 },
};

describe("ER scenario builder spec", () => {
  afterEach(() => {
    resetDevOverrides();
    consumePendingDevEnemyParty();
    resetErDifficulty();
  });

  it("share codes round-trip losslessly", () => {
    const code = encodeScenarioSpec(SPEC);
    expect(code.startsWith("ERS1.")).toBe(true);
    const back = decodeScenarioSpec(`  ${code}  `);
    expect(back).toEqual(SPEC);
  });

  it("rejects garbage share codes with a readable error", () => {
    expect("error" in decodeScenarioSpec("hello")).toBe(true);
    expect("error" in decodeScenarioSpec("ERS1.%%%%")).toBe(true);
  });

  it("setup() maps the spec onto the live Overrides and returns the party", () => {
    const { scenario } = buildDevScenario(SPEC);
    const starters = scenario.setup();
    expect(starters).toHaveLength(1);
    expect(starters[0].speciesId).toBe(SpeciesId.PIKACHU);
    expect(starters[0].abilityIndex).toBe(1);
    expect(starters[0].shiny).toBe(true);
    expect(Overrides.STARTING_WAVE_OVERRIDE).toBe(42);
    expect(Overrides.WEATHER_OVERRIDE).toBe(WeatherType.RAIN);
    expect(Overrides.STARTING_LEVEL_OVERRIDE).toBe(50);
    expect(Overrides.SEED_OVERRIDE).toBe("devseedrepro1234");
    expect(Overrides.ENEMY_SPECIES_OVERRIDE).toBe(SpeciesId.GARCHOMP);
    expect(Overrides.ENEMY_LEVEL_OVERRIDE).toBe(60);
    expect(Overrides.ENEMY_HEALTH_SEGMENTS_OVERRIDE).toBe(3);
    expect(Overrides.STARTING_HELD_ITEMS_OVERRIDE).toEqual([{ name: "LEFTOVERS", count: undefined, type: undefined }]);
    expect(scenario.shopItems).toHaveLength(1);
    expect(scenario.label).toContain("Repro 123");
    expect(scenario.description).toContain("ERS1.");
  });

  it("a custom enemy party stages the dev enemy-party channel", () => {
    const spec: ScenarioSpec = {
      ...SPEC,
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.SNORLAX, level: 55, moves: [MoveId.BODY_SLAM], isBoss: true },
          { species: SpeciesId.GENGAR, level: 50 },
        ],
      },
    };
    buildDevScenario(spec).scenario.setup();
    const staged = consumePendingDevEnemyParty();
    expect(staged).toHaveLength(2);
    expect(staged?.[0]).toMatchObject({ speciesId: SpeciesId.SNORLAX, level: 55, isBoss: true });
    expect(staged?.[1].speciesId).toBe(SpeciesId.GENGAR);
    // Consumed = cleared.
    expect(consumePendingDevEnemyParty()).toBeNull();
  });

  it("a trainer-class enemy sets the trainer overrides", () => {
    const spec: ScenarioSpec = { ...SPEC, enemy: { kind: "trainer", trainerType: 5 } };
    buildDevScenario(spec).scenario.setup();
    expect(Overrides.RANDOM_TRAINER_OVERRIDE?.trainerType).toBe(5);
  });
});
