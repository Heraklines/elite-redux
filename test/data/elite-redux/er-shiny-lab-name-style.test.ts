/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Pure (no GameManager) ground-truth for "Name FX doesn't work on all palettes":
// every equipped palette must resolve a name colour that is clearly DISTINCT from the
// default white name (#f8f8f8) - a near-white accent reads as "not adopted".

import { ER_SHINY_LAB_EFFECTS_BY_CATEGORY, getErShinyLabNameStyle } from "#data/elite-redux/er-shiny-lab-effects";
import { describe, expect, it } from "vitest";

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16)];
}

describe("ER Shiny Lab Name FX - palette adoption (pure)", () => {
  it("every palette resolves a non-null name colour", () => {
    for (const p of ER_SHINY_LAB_EFFECTS_BY_CATEGORY.palette) {
      const style = getErShinyLabNameStyle({ palette: p.id, surface: null, around: null });
      expect(style, `palette ${p.id} returned null`).not.toBeNull();
    }
  });

  it("no palette's name colour is near-white (low contrast vs the default name)", () => {
    const offenders: string[] = [];
    for (const p of ER_SHINY_LAB_EFFECTS_BY_CATEGORY.palette) {
      const style = getErShinyLabNameStyle({ palette: p.id, surface: null, around: null })!;
      const [r, g, b] = channels(style.color);
      // Near-white = every channel bright (so it looks ~white against the default name).
      if (Math.min(r, g, b) > 190) {
        offenders.push(`${p.id}=${style.color}`);
      }
    }
    expect(offenders, `near-white (low-contrast) name colours: ${offenders.join(", ")}`).toEqual([]);
  });
});
