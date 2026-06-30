/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Pure (no GameManager / no Phaser scene) ground-truth for the animated Name-FX frame CACHE
// builder: the pre-rendered loop must produce N DISTINCT frame cache keys per (name + look), an
// unchanged (name + glyph + look) must yield the SAME state key (so an update is a no-op), and a
// changed name / palette / surface must yield a DIFFERENT key (so the FX rebuilds + the per-frame
// texture cache reuses across surfaces only when the pixels truly match). The shader/render path
// itself is exercised by the scene-driven tests; here we only assert the cache identity logic.

import { ER_SHINY_LAB_DEFAULT_PARAMS } from "#data/elite-redux/er-shiny-lab-effects";
import {
  ER_SHINY_LAB_NAME_FX_FRAME_COUNT,
  erShinyLabNameFxFrameKeys,
  erShinyLabNameFxStateKey,
  shouldAnimateErShinyLabName,
} from "#sprites/er-shiny-lab-name-fx";
import type { ErShinyLabSpriteFxLook } from "#sprites/er-shiny-lab-sprite-fx";
import { describe, expect, it } from "vitest";

function look(overrides?: Partial<ErShinyLabSpriteFxLook["loadout"]>, nameFx = true): ErShinyLabSpriteFxLook {
  return {
    loadout: { palette: "duoneon", surface: "holofoil", around: null, ...overrides },
    params: { ...ER_SHINY_LAB_DEFAULT_PARAMS, nameFx },
  };
}

const GLYPH = "120x24|96px|emerald";

describe("ER Shiny Lab animated Name FX - frame cache builder (pure)", () => {
  it(`produces exactly ${ER_SHINY_LAB_NAME_FX_FRAME_COUNT} DISTINCT frame cache keys per build`, () => {
    const stateKey = erShinyLabNameFxStateKey("Pikachu", GLYPH, look());
    const keys = erShinyLabNameFxFrameKeys(stateKey);
    expect(keys).toHaveLength(ER_SHINY_LAB_NAME_FX_FRAME_COUNT);
    expect(new Set(keys).size).toBe(ER_SHINY_LAB_NAME_FX_FRAME_COUNT);
    // Every frame key namespaces under the shared state key (so a teardown releases the whole loop).
    for (const key of keys) {
      expect(key.startsWith(stateKey)).toBe(true);
    }
  });

  it("an UNCHANGED (name + glyph + look) is a no-op: identical state key", () => {
    expect(erShinyLabNameFxStateKey("Pikachu", GLYPH, look())).toBe(erShinyLabNameFxStateKey("Pikachu", GLYPH, look()));
  });

  it("a changed name / palette / surface / glyph geometry yields a DIFFERENT state key (rebuild)", () => {
    const base = erShinyLabNameFxStateKey("Pikachu", GLYPH, look());
    expect(erShinyLabNameFxStateKey("Raichu", GLYPH, look())).not.toBe(base);
    expect(erShinyLabNameFxStateKey("Pikachu", GLYPH, look({ palette: "duomint" }))).not.toBe(base);
    expect(erShinyLabNameFxStateKey("Pikachu", GLYPH, look({ surface: "galaxy" }))).not.toBe(base);
    // Same name + look at a different render size (e.g. Summary vs Party) must NOT collide.
    expect(erShinyLabNameFxStateKey("Pikachu", "60x16|44px|emerald", look())).not.toBe(base);
  });

  it("gates the animated path on Name FX ON + a surface equipped (else the flat colour path)", () => {
    expect(shouldAnimateErShinyLabName(look())).toBe(true);
    expect(shouldAnimateErShinyLabName(look({ surface: null }))).toBe(false); // palette-only -> flat
    expect(shouldAnimateErShinyLabName(look(undefined, false))).toBe(false); // Name FX off -> default
    expect(shouldAnimateErShinyLabName(null)).toBe(false);
    expect(shouldAnimateErShinyLabName(undefined)).toBe(false);
  });
});
