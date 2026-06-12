/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Editor-managed trainer tuning (er-trainer-tuning.json → trainer cadence,
// factory-team chance, factory set membership). Tests inject a tuning table
// via setErTrainerTuningForTesting and assert the live behavior changes,
// absence = defaults unchanged.
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-trainer-tuning.test.ts
import { erForcesTrainerWave } from "#data/elite-redux/er-battle-frequency";
import { ER_FACTORY_SETS } from "#data/elite-redux/er-factory-sets";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { resetErFactoryPoolForTesting, resolvedFactorySets } from "#data/elite-redux/er-trainer-runtime-hook";
import {
  erTunedFactoryTeamPct,
  erTunedTrainerCadence,
  setErTrainerTuningForTesting,
} from "#data/elite-redux/er-trainer-tuning";
import { afterEach, describe, expect, it } from "vitest";

describe("ER trainer tuning (er-trainer-tuning.json loader)", () => {
  afterEach(() => {
    setErTrainerTuningForTesting(); // restore the committed JSON ({} in tests)
    resetErFactoryPoolForTesting();
    resetErDifficulty();
  });

  it("overrides the per-difficulty trainer cadence", () => {
    setErDifficulty("elite");
    // Default Elite cadence is 4 → wave 16 forces a trainer.
    expect(erForcesTrainerWave(16)).toBe(true);
    setErTrainerTuningForTesting({ frequency: { elite: { trainerCadence: 7 } } });
    expect(erForcesTrainerWave(16)).toBe(false);
    expect(erForcesTrainerWave(14)).toBe(true); // 14 % 7 === 0, not a rival wave
  });

  it("absent difficulty keeps the default cadence", () => {
    setErDifficulty("hell");
    setErTrainerTuningForTesting({ frequency: { elite: { trainerCadence: 7 } } });
    // Hell default cadence is 2 → untouched by an elite-only override.
    expect(erTunedTrainerCadence("hell")).toBeUndefined();
    expect(erForcesTrainerWave(14)).toBe(true);
  });

  it("exposes the per-difficulty factory-team chance override", () => {
    expect(erTunedFactoryTeamPct("elite")).toBeUndefined();
    setErTrainerTuningForTesting({ frequency: { elite: { factoryTeamPct: 40 } } });
    expect(erTunedFactoryTeamPct("elite")).toBe(40);
    expect(erTunedFactoryTeamPct("hell")).toBeUndefined();
  });

  it("removes excluded species' factory sets from the resolved pool", () => {
    // Pick a factory-set species that resolves to a live pokerogue species and
    // whose pokerogue id is not shared by any OTHER draft id in the set list
    // (so "absent from the pool" is unambiguous).
    const draftIds = [...new Set(ER_FACTORY_SETS.map(([id]) => id))];
    const erDraftId = draftIds.find(
      id =>
        ER_ID_MAP.species[id] !== undefined
        && !draftIds.some(other => other !== id && ER_ID_MAP.species[other] === ER_ID_MAP.species[id]),
    );
    expect(erDraftId).toBeDefined();
    const speciesConst = ER_SPECIES.find(d => d.id === erDraftId)?.speciesConst;
    expect(speciesConst).toBeDefined();
    const pkrgId = ER_ID_MAP.species[erDraftId as number];

    resetErFactoryPoolForTesting();
    const before = resolvedFactorySets();
    expect(before.some(s => s.speciesId === pkrgId)).toBe(true);

    setErTrainerTuningForTesting({ sets: { factoryExcludeSpecies: [speciesConst as string] } });
    resetErFactoryPoolForTesting();
    const after = resolvedFactorySets();
    expect(after.some(s => s.speciesId === pkrgId)).toBe(false);
    // The rest of the pool is untouched.
    expect(after.length).toBe(before.length - before.filter(s => s.speciesId === pkrgId).length);
  });
});
