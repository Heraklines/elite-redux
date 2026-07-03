/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { erGauntletPickMeType, erGauntletWaveKind } from "#data/elite-redux/er-mystery-gauntlet";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { describe, expect, it } from "vitest";

describe("#814 Mystery Gauntlet schedule (pure)", () => {
  it("cycles 5xME -> ghost -> boss -> bargain from wave 2; wave 1 stays wild", () => {
    expect(erGauntletWaveKind(1)).toBe("wild");
    expect([2, 3, 4, 5, 6].map(erGauntletWaveKind)).toEqual(["me", "me", "me", "me", "me"]);
    expect(erGauntletWaveKind(7)).toBe("ghost");
    expect(erGauntletWaveKind(8)).toBe("boss");
    expect(erGauntletWaveKind(9)).toBe("bargain");
    // The cycle repeats exactly.
    expect([10, 11, 12, 13, 14].map(erGauntletWaveKind)).toEqual(["me", "me", "me", "me", "me"]);
    expect(erGauntletWaveKind(15)).toBe("ghost");
    expect(erGauntletWaveKind(16)).toBe("boss");
    expect(erGauntletWaveKind(17)).toBe("bargain");
  });

  it("ME picks never repeat until the pool exhausts; bargain waves always run Giratina", () => {
    const encountered: MysteryEncounterType[] = [];
    const seen = new Set<MysteryEncounterType>();
    // Walk 40 ME waves: every pick must be fresh while the pool lasts.
    let wave = 2;
    for (let i = 0; i < 40; i++) {
      while (erGauntletWaveKind(wave) !== "me") {
        wave++;
      }
      const pick = erGauntletPickMeType(wave, encountered);
      expect(seen.has(pick), `wave ${wave} repeated ${MysteryEncounterType[pick]}`).toBe(false);
      seen.add(pick);
      encountered.push(pick);
      wave++;
    }
    expect(erGauntletPickMeType(9, encountered)).toBe(MysteryEncounterType.ER_THE_BARGAIN);
    // Synthetic LLM encounter never scheduled.
    expect(seen.has(MysteryEncounterType.LLM_DIRECTED)).toBe(false);
  });

  it("pool exhaustion wraps to repeats instead of failing", () => {
    const all = Object.values(MysteryEncounterType).filter((v): v is MysteryEncounterType => typeof v === "number");
    const pick = erGauntletPickMeType(2, all);
    expect(typeof pick).toBe("number");
  });
});
