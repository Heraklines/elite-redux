/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Unit tests for the ER Elite/Hell battle-frequency cadence (#216).

import { erExtraRivalTypeForWave, erForcesTrainerWave } from "#data/elite-redux/er-battle-frequency";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { TrainerType } from "#enums/trainer-type";
import { afterEach, describe, expect, it } from "vitest";

describe("ER battle frequency", () => {
  afterEach(() => {
    resetErDifficulty();
  });

  describe("Ace = vanilla (no injection)", () => {
    it("never forces trainers and never injects rivals", () => {
      setErDifficulty("ace");
      for (let w = 2; w <= 199; w++) {
        expect(erForcesTrainerWave(w), `wave ${w}`).toBe(false);
        expect(erExtraRivalTypeForWave(w), `wave ${w}`).toBeNull();
      }
    });
  });

  describe("Elite", () => {
    it("forces a trainer on the every-3rd cadence (excluding extra-rival waves)", () => {
      setErDifficulty("elite");
      expect(erForcesTrainerWave(6)).toBe(true);
      expect(erForcesTrainerWave(9)).toBe(true);
      expect(erForcesTrainerWave(7)).toBe(false);
      // 42 is an extra-rival wave (also % 3 === 0) → excluded from the trainer cadence.
      expect(erForcesTrainerWave(42)).toBe(false);
    });

    it("injects exactly its two extra rivals", () => {
      setErDifficulty("elite");
      expect(erExtraRivalTypeForWave(42)).toBe(TrainerType.RIVAL_2);
      expect(erExtraRivalTypeForWave(122)).toBe(TrainerType.RIVAL_4);
      expect(erExtraRivalTypeForWave(16)).toBeNull();
      expect(erExtraRivalTypeForWave(76)).toBeNull();
    });
  });

  describe("Hell", () => {
    it("forces a trainer on the every-2nd cadence", () => {
      setErDifficulty("hell");
      expect(erForcesTrainerWave(4)).toBe(true);
      expect(erForcesTrainerWave(6)).toBe(true);
      expect(erForcesTrainerWave(7)).toBe(false);
      // 16/76/122/158 are extra-rival waves → excluded even though even.
      expect(erForcesTrainerWave(16)).toBe(false);
    });

    it("injects the full extra-rival ladder", () => {
      setErDifficulty("hell");
      expect(erExtraRivalTypeForWave(16)).toBe(TrainerType.RIVAL);
      expect(erExtraRivalTypeForWave(42)).toBe(TrainerType.RIVAL_2);
      expect(erExtraRivalTypeForWave(76)).toBe(TrainerType.RIVAL_3);
      expect(erExtraRivalTypeForWave(122)).toBe(TrainerType.RIVAL_4);
      expect(erExtraRivalTypeForWave(158)).toBe(TrainerType.RIVAL_5);
    });

    it("never lands an injected rival on a boss / x1 / gym / finale wave", () => {
      setErDifficulty("hell");
      for (const w of [16, 42, 76, 122, 158]) {
        expect(w % 10, `wave ${w} is a boss wave`).not.toBe(0);
        expect(w % 10, `wave ${w} is an x1 wave`).not.toBe(1);
        expect(w % 30, `wave ${w} is a gym wave`).not.toBe(20);
        expect(w, `wave ${w} is the finale`).not.toBe(200);
      }
    });
  });
});
