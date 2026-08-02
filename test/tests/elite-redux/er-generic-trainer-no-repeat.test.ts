/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  getLastGenericTrainerType,
  markGenericTrainerType,
  resetGenericTrainerTracking,
  restoreGenericTrainerTracking,
  withoutImmediateTrainerRepeat,
} from "#data/elite-redux/er-generic-trainer-run-state";
import { TrainerType } from "#enums/trainer-type";
import { afterEach, describe, expect, it } from "vitest";

describe("generic trainer immediate-repeat guard", () => {
  afterEach(() => resetGenericTrainerTracking());

  it("removes the previous trainer class when the tier has alternatives", () => {
    const pool = [TrainerType.MUSICIAN, TrainerType.YOUNGSTER, TrainerType.BREEDER];

    expect(withoutImmediateTrainerRepeat(pool, TrainerType.MUSICIAN)).toEqual([
      TrainerType.YOUNGSTER,
      TrainerType.BREEDER,
    ]);
  });

  it("keeps a one-entry tier usable", () => {
    const pool = [TrainerType.MUSICIAN];

    expect(withoutImmediateTrainerRepeat(pool, TrainerType.MUSICIAN)).toEqual(pool);
  });

  it("round-trips the last generated class and clears invalid legacy data", () => {
    markGenericTrainerType(TrainerType.MUSICIAN);
    expect(getLastGenericTrainerType()).toBe(TrainerType.MUSICIAN);

    resetGenericTrainerTracking();
    expect(getLastGenericTrainerType()).toBeNull();

    restoreGenericTrainerTracking(TrainerType.YOUNGSTER);
    expect(getLastGenericTrainerType()).toBe(TrainerType.YOUNGSTER);

    restoreGenericTrainerTracking(-1 as TrainerType);
    expect(getLastGenericTrainerType()).toBeNull();
    restoreGenericTrainerTracking(undefined);
    expect(getLastGenericTrainerType()).toBeNull();
  });
});
