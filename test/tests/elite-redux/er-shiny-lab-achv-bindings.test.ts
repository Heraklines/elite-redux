import { achvs } from "#system/achv";
import {
  ER_SHINY_LAB_EFFECT_ACHV,
  ER_SHINY_LAB_EFFECT_INDEX,
  ER_SHINY_LAB_EFFECTS_BY_CATEGORY,
  getErShinyLabDiscountedEffects,
  getErShinyLabEffectsForAchv,
} from "#data/elite-redux/er-shiny-lab-effects";
import { describe, expect, it } from "vitest";

/**
 * Pure-data integrity checks for the Shiny Lab <-> achievement gate. The failure
 * mode we care about: a typo'd effect id or achievement key would silently create a
 * cosmetic that can NEVER unlock (or a gate that never gates). These tests make that
 * impossible to ship.
 */
describe("ER Shiny Lab achievement bindings", () => {
  it("every bound effect id is a real registry effect", () => {
    for (const effectId of Object.keys(ER_SHINY_LAB_EFFECT_ACHV)) {
      expect(ER_SHINY_LAB_EFFECT_INDEX.has(effectId), `unknown effect id "${effectId}"`).toBe(true);
    }
  });

  it("every bound achievement key exists in achvs (no permanently-locked cosmetics)", () => {
    const achvKeys = new Set(Object.keys(achvs));
    for (const [effectId, achvId] of Object.entries(ER_SHINY_LAB_EFFECT_ACHV)) {
      expect(achvKeys.has(achvId), `effect "${effectId}" -> unknown achievement "${achvId}"`).toBe(true);
    }
  });

  it("every bound effect carries a lockHint so it actually gates", () => {
    const defs = new Map(
      [
        ...ER_SHINY_LAB_EFFECTS_BY_CATEGORY.palette,
        ...ER_SHINY_LAB_EFFECTS_BY_CATEGORY.surface,
        ...ER_SHINY_LAB_EFFECTS_BY_CATEGORY.around,
      ].map(d => [d.id, d]),
    );
    for (const effectId of Object.keys(ER_SHINY_LAB_EFFECT_ACHV)) {
      expect(defs.get(effectId)?.lockHint, `"${effectId}" has no lockHint`).toBeTruthy();
    }
  });

  it("the 4 new Elemental Apex achievements each unlock a real aura", () => {
    for (const achvId of ["SCORCHED_EARTH", "ABSOLUTE_ZERO", "ENDLESS_NIGHT", "TEMPEST"]) {
      expect(Object.keys(achvs)).toContain(achvId);
      expect(getErShinyLabEffectsForAchv(achvId).length, `${achvId} unlocks no effect`).toBeGreaterThan(0);
    }
  });

  it("the random cheap assortment never includes an achievement-locked effect", () => {
    const bound = new Set(Object.keys(ER_SHINY_LAB_EFFECT_ACHV));
    for (const speciesId of [1, 25, 133, 384, 700]) {
      for (const category of ["palette", "surface", "around"] as const) {
        for (const id of getErShinyLabDiscountedEffects(speciesId, category)) {
          expect(bound.has(id), `discounted "${id}" is achievement-locked`).toBe(false);
        }
      }
    }
  });

  it("keeps coverage near the agreed ~50% of the 154-effect catalog", () => {
    const total =
      ER_SHINY_LAB_EFFECTS_BY_CATEGORY.palette.length
      + ER_SHINY_LAB_EFFECTS_BY_CATEGORY.surface.length
      + ER_SHINY_LAB_EFFECTS_BY_CATEGORY.around.length;
    const bound = Object.keys(ER_SHINY_LAB_EFFECT_ACHV).length;
    const ratio = bound / total;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });
});
