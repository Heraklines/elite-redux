/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { clearLabGroups, registerLabGroup, renderLabLook } from "#app/dev-tools/shiny-lab-lab";
import { ER_SHINY_LAB_DEFAULT_PARAMS } from "#data/elite-redux/er-shiny-lab-effects";
import { AROUND } from "#data/elite-redux/er-shiny-lab-fx";
import { afterEach, describe, expect, it } from "vitest";

// Stable-anchor regression: an AROUND landmark pinned to stableCx/stableFy must
// land on the SAME output pixel for every frame of an animation whose
// silhouette jumps around. The stock per-frame centroid (dist.cx/cy/fy) wobbles
// with the pose; the group anchor must not. Articuno's real atlas (trimmed
// frames hopping several px between poses) is the motivating case - this test
// builds a synthetic 2-frame animation with a deliberately huge pose shift so
// the frame-local centroid moves by ~15 px while the stable anchor holds.
//
// This is the production-intent contract for the renderer extension: landmark
// geometry (rings, sigils, portals) anchors to stableCx/stableCy/stableFy, and
// frameCx/frameCy/frameFy stay available for body-following effects.

const LAB_ID = "lab:test:anchor-beacon";

/** A frame: an opaque 8x8 block at (ox, oy) inside a 32x32 canvas. */
function blockFrame(ox: number, oy: number) {
  const w = 32;
  const h = 32;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = ((oy + y) * w + (ox + x)) * 4;
      data[i] = 120;
      data[i + 1] = 140;
      data[i + 2] = 200;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function brightBeaconPixels(rendered: { width: number; height: number; data: Uint8ClampedArray }) {
  const pts: [number, number][] = [];
  for (let y = 0; y < rendered.height; y++) {
    for (let x = 0; x < rendered.width; x++) {
      const i = (y * rendered.width + x) * 4;
      // The beacon paints pure white; the body is a dim blue (120,140,200). The
      // ring's antialiased rim lands inside the silhouette where it composites
      // over the body, so detect "white dominating blue" instead of pure white.
      const r = rendered.data[i];
      const g = rendered.data[i + 1];
      const b = rendered.data[i + 2];
      const a = rendered.data[i + 3];
      if (a > 200 && r > 170 && g > 170 && b > 170 && r >= b - 20) {
        pts.push([x, y]);
      }
    }
  }
  return pts;
}

describe("ER Shiny Lab stable animation anchor", () => {
  afterEach(() => {
    delete AROUND[LAB_ID];
    clearLabGroups();
  });

  it("a stable-anchored landmark occupies identical pixels across a jumping animation", () => {
    const frames = [blockFrame(4, 4), blockFrame(20, 12)];
    registerLabGroup("jump", frames);

    // A landmark ring at the STABLE anchor. Radius chosen inside the pad band.
    AROUND[LAB_ID] = (nx: number, ny: number, _df: number, _t: number, c: { stableCx: number; stableFy: number }) => {
      const dx = nx - c.stableCx;
      const dy = ny - c.stableFy;
      const r = Math.hypot(dx, dy);
      const on = Math.abs(r - 0.18) < 0.012 ? 1 : 0;
      return [1, 1, 1, on];
    };
    const slots = { palette: null, surface: null, around: LAB_ID };
    const t = 0.5;

    const r0 = renderLabLook(frames[0], slots, { ...ER_SHINY_LAB_DEFAULT_PARAMS }, t, { pad: 22, fxGroup: "jump" });
    const r1 = renderLabLook(frames[1], slots, { ...ER_SHINY_LAB_DEFAULT_PARAMS }, t, { pad: 22, fxGroup: "jump" });
    expect(r0).not.toBeNull();
    expect(r1).not.toBeNull();

    const ring0 = brightBeaconPixels(r0!);
    const ring1 = brightBeaconPixels(r1!);
    expect(ring0.length).toBeGreaterThan(8);
    expect(ring1.length).toBeGreaterThan(8);
    // Background (non-body) ring pixels must be IDENTICAL across every frame:
    // a stable anchor means landmark geometry never wobbles where nothing
    // occludes it. Pixels that fall inside the moving body legitimately change
    // (they composite over different body pixels), so the contract is checked
    // on the unoccluded ring. With the OLD frame-local anchor this set differs
    // by ~15 px between these two frames.
    // Occlusion-free comparison: keep only ring pixels that lie OUTSIDE BOTH
    // bodies (a pixel inside either frame's body composites differently by
    // construction - the landmark is behind/onto a moving silhouette there).
    const inBody = (body: (typeof frames)[0], pad: number, x: number, y: number) => {
      const sx = x - pad;
      const sy = y - pad;
      return sx >= 0 && sy >= 0 && sx < body.width && sy < body.height && body.data[(sy * body.width + sx) * 4 + 3] > 5;
    };
    const clear = (pts: [number, number][]) =>
      pts.filter(([x, y]) => !inBody(frames[0], 22, x, y) && !inBody(frames[1], 22, x, y));
    const bg0 = clear(ring0);
    const bg1 = clear(ring1);
    expect(bg0.length).toBeGreaterThan(8);
    expect(bg1.length).toBeGreaterThan(8);
    expect(new Set(bg1.map(p => p.join(",")))).toEqual(new Set(bg0.map(p => p.join(","))));
  });

  it("the frame-local anchor visibly moves across the same animation (documents the old wobble)", () => {
    const frames = [blockFrame(4, 4), blockFrame(20, 12)];
    registerLabGroup("jump2", frames);

    AROUND[LAB_ID] = (nx: number, ny: number, _df: number, _t: number, c: { frameCx: number; frameCy: number }) => {
      const dx = nx - c.frameCx;
      const dy = ny - c.frameCy;
      const r = Math.hypot(dx, dy);
      const on = Math.abs(r - 0.18) < 0.012 ? 1 : 0;
      return [1, 1, 1, on];
    };
    const slots = { palette: null, surface: null, around: LAB_ID };

    const r0 = renderLabLook(frames[0], slots, { ...ER_SHINY_LAB_DEFAULT_PARAMS }, 0.5, { pad: 22, fxGroup: "jump2" });
    const r1 = renderLabLook(frames[1], slots, { ...ER_SHINY_LAB_DEFAULT_PARAMS }, 0.5, { pad: 22, fxGroup: "jump2" });
    const ring0 = brightBeaconPixels(r0!);
    const ring1 = brightBeaconPixels(r1!);
    const overlap = ring0.filter(p => ring1.some(q => q[0] === p[0] && q[1] === p[1])).length;
    // The frame-anchored ring follows the jumping body: the two rings are
    // materially different (if this ever overlaps fully, the test animation
    // stopped stressing the anchor and should be widened).
    expect(overlap).toBeLessThan(Math.min(ring0.length, ring1.length) * 0.5);
  });

  it("stable anchors fall back to frame anchors when no group is registered", () => {
    const frame = blockFrame(6, 6);
    let seen: { stableCx: number; frameCx: number } | null = null;
    AROUND[LAB_ID] = (_nx: number, _ny: number, _df: number, _t: number, c: { stableCx: number; frameCx: number }) => {
      seen = { stableCx: c.stableCx, frameCx: c.frameCx };
      return [0, 0, 0, 0];
    };
    renderLabLook(frame, { palette: null, surface: null, around: LAB_ID }, { ...ER_SHINY_LAB_DEFAULT_PARAMS }, 0, {
      pad: 10,
    });
    expect(seen).not.toBeNull();
    expect(seen!.stableCx).toBeCloseTo(seen!.frameCx, 10);
  });
});
