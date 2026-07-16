/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Pass B capture: composite the REAL `types` atlas badges at the computed
// paired-column positions (via the production geometry) so the layout can be
// eyeballed at 2 / 3 / 6 / 7 types. Writes PNGs under the scratchpad captures dir.
//
// Faithful: uses computeTypeIconStripLayout (the production geometry) + the exact
// badge art the game ships (er-assets/images/types.png). Not gated - a plain
// vitest that just needs @napi-rs/canvas + the er-assets checkout.
// =============================================================================

import { computeTypeIconStripLayout, type TypeIconStripOptions } from "#ui/type-icon-strip";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

const OUT_DIR =
  "C:/Users/Hafida/AppData/Local/Temp/claude/C--Users-Hafida/91d7b1e2-397d-47d4-8fce-1ca7a5d1369d/scratchpad/ntype-ui-captures";
const TYPES_PNG = "../er-assets/images/types.png";
const TYPES_JSON = "../er-assets/images/types.json";

// Frame order in types.json (32x14 each, stacked vertically). Index by PokemonType.
const OPTS: TypeIconStripOptions = { x0: 8, y0: 98, baseScale: 0.5, baseStride: 18, maxWidth: 104 };

// A representative type set for each count (real mons):
//   2 = Water/Ground (any dual), 3 = Tentalect (Water/Poison/Psychic),
//   6/7 = Primal Regigigas (Normal/Rock/Ice/Steel/Electric/Dragon[/Water]).
const SETS: Record<string, string[]> = {
  "2": ["water", "ground"],
  "3": ["water", "poison", "psychic"],
  "6": ["normal", "rock", "ice", "steel", "electric", "dragon"],
  "7": ["normal", "rock", "ice", "steel", "electric", "dragon", "water"],
};

describe("Pass B N-type strip capture", () => {
  it("renders 2/3/6/7-type strips to PNG for visual review", async () => {
    if (!existsSync(TYPES_PNG)) {
      // No local er-assets checkout (CI) - skip the pixel capture, keep it green.
      expect(true).toBe(true);
      return;
    }
    mkdirSync(OUT_DIR, { recursive: true });
    const atlas = JSON.parse(readFileSync(TYPES_JSON, "utf8"));
    const frames = atlas.textures?.[0]?.frames ?? atlas.frames ?? [];
    const frameByName = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const f of frames) {
      frameByName.set(String(f.filename).replace(/\.png$/, ""), f.frame);
    }
    const img = await loadImage(TYPES_PNG);

    for (const [count, typeNames] of Object.entries(SETS)) {
      const { scale, placements } = computeTypeIconStripLayout(typeNames.length, OPTS);
      // Canvas sized to the info-panel strip region (x0..x0+maxWidth, a few rows tall),
      // scaled x4 so the small badges are legible in the review PNG.
      const ZOOM = 4;
      const cw = (OPTS.x0 + OPTS.maxWidth + 8) * ZOOM;
      const ch = 40 * ZOOM;
      const canvas = createCanvas(cw, ch);
      const ctx = canvas.getContext("2d");
      // Panel-ish backdrop so overlaps/edges are visible.
      ctx.fillStyle = "#3a5f4a";
      ctx.fillRect(0, 0, cw, ch);
      for (let i = 0; i < placements.length; i++) {
        const fr = frameByName.get(typeNames[i]);
        if (!fr) {
          continue;
        }
        // Map panel coords -> zoomed canvas: x directly, y with the y0 baseline at 8px.
        const dx = placements[i].x * ZOOM;
        const dy = (placements[i].y - OPTS.y0 + 8) * ZOOM;
        const dw = fr.w * scale * ZOOM;
        const dh = fr.h * scale * ZOOM;
        ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, dx, dy, dw, dh);
      }
      const out = join(OUT_DIR, `type-strip-${count}types.png`);
      writeFileSync(out, canvas.toBuffer("image/png"));
      console.log(`WROTE ${out}  scale=${scale.toFixed(3)} placements=${JSON.stringify(placements)}`);
    }
    expect(existsSync(join(OUT_DIR, "type-strip-7types.png"))).toBe(true);
  });
});
