/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { validateCustomTrainersDelta } from "../../../../workers/er-editor-api/src/index";

function trainer(trainerClass: string): Record<string, unknown> {
  return {
    id: 70022,
    name: "Volo",
    trainerClass,
    team: [{ species: 1 }],
  };
}

describe("custom trainer Worker validation", () => {
  it("accepts a real TrainerType name", () => {
    expect(validateCustomTrainersDelta({ TRAINER_70022: trainer("CYNTHIA") })).toEqual({ ok: true });
  });

  it("rejects display labels that the game runtime cannot resolve", () => {
    expect(validateCustomTrainersDelta({ TRAINER_70022: trainer("WIELDER") })).toEqual({
      ok: false,
      error: "TRAINER_70022: trainerClass must be a TrainerType NAME",
    });
  });
});
