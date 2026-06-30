import {
  decodeErShinyLabParams,
  decodeErShinyLabPreset,
  ER_SHINY_LAB_DEFAULT_PARAMS,
  encodeErShinyLabParams,
  encodeErShinyLabPreset,
  normalizeErShinyLabPresets,
  normalizeErShinyLabSavedLook,
  sanitizeErShinyLabPresetName,
} from "#data/elite-redux/er-shiny-lab-effects";
import { describe, expect, it } from "vitest";

/**
 * Covers the 0.0.5.6 Shiny Lab tuning additions: the new speed + aura-size params (with
 * backward-compatible decode of pre-tuning saves) and nameable presets / the name prefix.
 */
describe("ER Shiny Lab tuning params + nameable presets", () => {
  it("round-trips speed + auraSize through encode/decode (within byte quantization)", () => {
    const params = { ...ER_SHINY_LAB_DEFAULT_PARAMS, speed: 2.5, auraSize: 1.75 };
    const decoded = decodeErShinyLabParams(encodeErShinyLabParams(params));
    expect(decoded.speed).toBeCloseTo(2.5, 1);
    expect(decoded.auraSize).toBeCloseTo(1.75, 1);
  });

  it("defaults speed + auraSize to 1 when a pre-tuning (9-param) save lacks them", () => {
    // Old saves stored 9 params; the trailing speed/auraSize bytes are absent.
    const legacy = encodeErShinyLabParams(ER_SHINY_LAB_DEFAULT_PARAMS).slice(0, 9);
    const decoded = decodeErShinyLabParams(legacy);
    expect(decoded.speed).toBeCloseTo(1, 2);
    expect(decoded.auraSize).toBeCloseTo(1, 2);
  });

  it("normalizes a legacy 12-entry saved look up to the 14-entry tuple", () => {
    const legacy = [1, 0, 0, 255, 255, 255, 96, 0, 0, 0, 0, 0];
    const normalized = normalizeErShinyLabSavedLook(legacy);
    expect(normalized).toHaveLength(14);
    // The decoded look still resolves cleanly (speed/auraSize default to ~1).
    const preset = decodeErShinyLabPreset(normalized);
    expect(preset?.params.speed).toBeCloseTo(1, 2);
    expect(preset?.params.auraSize).toBeCloseTo(1, 2);
  });

  it("carries preset names through normalize, and survives an encode/decode of the look", () => {
    const tuple = encodeErShinyLabPreset({
      loadout: { palette: null, surface: null, around: null },
      params: { ...ER_SHINY_LAB_DEFAULT_PARAMS },
      name: "Glittering",
    });
    const presets = normalizeErShinyLabPresets([tuple], ["Glittering"]);
    expect(presets[0]?.name).toBe("Glittering");
    // A null name slot yields no name.
    expect(normalizeErShinyLabPresets([tuple], [null])[0]?.name).toBeUndefined();
  });

  it("sanitizes a preset name: trims, strips control chars, caps length", () => {
    expect(sanitizeErShinyLabPresetName("  Glittering  ")).toBe("Glittering");
    expect(sanitizeErShinyLabPresetName("Bad\nName\tHere")).toBe("BadNameHere");
    expect(sanitizeErShinyLabPresetName("x".repeat(40))).toHaveLength(16);
    expect(sanitizeErShinyLabPresetName(null)).toBe("");
    expect(sanitizeErShinyLabPresetName(undefined)).toBe("");
  });
});
