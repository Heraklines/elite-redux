/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// The ER → PokeRogue trainer held-item resolver: flat items, type boosters
// (gems/plates), species items, recreated ER-only items, and mega stones.
import {
  ER_ITEM_CONVERT_CHANCE,
  ER_ITEM_TO_MODIFIER_KEY,
  isErMegaStone,
  resolveErTrainerItem,
} from "#data/elite-redux/er-trainer-item-map";
import { getModifierTypeFuncById } from "#modifiers/modifier-type";
import { describe, expect, it } from "vitest";

describe("ER trainer held-item resolver", () => {
  it("every flat-mapped key is a real PokeRogue modifier type", () => {
    for (const [erId, key] of Object.entries(ER_ITEM_TO_MODIFIER_KEY)) {
      expect(getModifierTypeFuncById(key), `ER ${erId} → "${key}"`).toBeTruthy();
    }
  });

  it("resolves each category to a buildable modifier", () => {
    // Each `make()` must construct a ModifierType without throwing.
    const cases: [string, number][] = [
      ["flat: Leftovers", 273],
      ["type: Dragon Gem", 334],
      ["type: Dragon Plate", 360],
      ["species: Thick Club", 380],
      ["recreate: Life Orb", 301],
      ["recreate: Assault Vest", 323],
      ["recreate: Rocky Helmet", 312],
    ];
    for (const [label, id] of cases) {
      const res = resolveErTrainerItem(id);
      expect(res, label).not.toBeNull();
      expect(res!.kind, label).toBe("modifier");
      if (res!.kind === "modifier") {
        expect(res!.make(), label).toBeTruthy();
      }
    }
  });

  it("mega stones resolve to the force-mega action", () => {
    expect(resolveErTrainerItem(748)).toEqual({ kind: "mega" });
    expect(resolveErTrainerItem(861)).toEqual({ kind: "mega" });
    expect(isErMegaStone(310)).toBe(false); // Eviolite
    expect(isErMegaStone(661)).toBe(false); // Meteorite
  });

  it("balls / no-item / unmapped resolve to null (baseline roll stands)", () => {
    expect(resolveErTrainerItem(0)).toBeNull(); // none
    expect(resolveErTrainerItem(7)).toBeNull(); // Dive Ball
    expect(resolveErTrainerItem(118)).toBeNull(); // Haban Berry
  });

  it("convert chance is a sane probability", () => {
    expect(ER_ITEM_CONVERT_CHANCE).toBeGreaterThan(0);
    expect(ER_ITEM_CONVERT_CHANCE).toBeLessThanOrEqual(1);
  });
});
