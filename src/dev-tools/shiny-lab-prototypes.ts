/**
 * DEV-ONLY Phase B prototypes for the exotic Shiny Lab work.
 *
 * Every prototype here renders through the REAL production compositor (see
 * `shiny-lab-lab.ts`, which re-implements renderErShinyLabLook verbatim and
 * keeps the PALETTE / AURA / AROUND tables open under `lab:` ids). Nothing in
 * this file is an approximate preview renderer.
 *
 * The 12 mechanisms come from the Phase A inventory in
 * docs/plans/2026-07-20-shiny-lab-exotic-fx-catalog.md. Each entry names the
 * catalog mechanism it implements and the extension fields it needs, so the
 * Phase C cull can map survivors back to the inventory.
 *
 * Importing this module registers the prototypes (side effect). The game never
 * imports it; only the dev harness (scripts/shiny-lab-lab.mjs) and lab tests
 * do.
 */

import { registerLabPrototype } from "#app/dev-tools/shiny-lab-lab";
import {
  clamp,
  fract,
  h2,
  hsv2rgb,
  hx,
  luma,
  mix,
  mix3,
  ramp,
  rgb2hsv,
  smooth,
  vnoise,
} from "#data/elite-redux/er-shiny-lab-fx";

// Local gradient ramps (the fx table's own `G` is module-private).
const G_INFERNO = ["000000", "350000", "a01200", "ff5a00", "ffd000", "fff6c0"].map(hx);
const G_COPPER = ["170a05", "5e2a16", "b5642e", "f0a85a", "ffe6b0"].map(hx);

// 22 px inside-distance is treated as "deep body" for normalizing depth (a
// typical mon silhouette is ~70 px across, so the deepest core sits ~10-20 px
// in from the rim).
const DEEP = 22;

/** topo index for the CURRENT source pixel (ctx.px/py are set per pixel). */
function topoAt(c, field) {
  const i = c.py * c.W + c.px;
  return c.topo[field][i];
}

// ---------------------------------------------------------------------------
// 1. Internal Core (catalog #1) - subdermal ember. sdf + pixId.
// ---------------------------------------------------------------------------
registerLabPrototype({
  id: "core",
  category: "surface",
  label: "LAB: Internal Core",
  mechanism:
    "depth-normalized glow living DEEP inside the body, seen through translucent skin near the rim (sdf + pixId)",
  fn: (r, g, b, x, y, t, c) => {
    if (!c.topo) {
      return [r, g, b, 1];
    }
    const d = Math.min(topoAt(c, "sdf"), DEEP) / DEEP;
    const n = vnoise(x * 3.1 + t * 0.13, y * 3.1 - t * 0.09);
    const breathe = 0.72 + 0.28 * Math.sin(t * 0.9 + topoAt(c, "pixId") * 0.6);
    const fire = Math.pow(d, 1.8) * (0.55 + 0.75 * n) * breathe;
    const hot = ramp(G_INFERNO, clamp(fire * 1.15));
    // Rim pixels keep the body's own shading ("skin"); the core replaces it.
    const m = Math.pow(d, 2.1) * 0.85;
    const skin = mix3([r * 0.8, g * 0.8, b * 0.8], hot, m);
    return [skin[0], skin[1], skin[2], 1];
  },
});

// ---------------------------------------------------------------------------
// 2. Medial Filigree (catalog #2) - gold wire on the skeleton. voro + sdf.
// ---------------------------------------------------------------------------
const FILIGREE_GOLD = ["1a0e02", "7a4d16", "e8b34a", "ffe9a8"].map(hx);
registerLabPrototype({
  id: "filigree",
  category: "surface",
  label: "LAB: Medial Filigree",
  mechanism:
    "engraved tracery following the mon's true midline skeleton (voro midlines), fading to lacquer near the rim",
  fn: (r, g, b, _x, _y, t, c) => {
    if (!c.topo) {
      return [r, g, b, 1];
    }
    const v = topoAt(c, "voro");
    const d = Math.min(topoAt(c, "sdf"), DEEP) / DEEP;
    // Wire sits on the midline; a faint second echo at half strength gives the
    // inlay a chased double-line look. Slight shimmer travels along depth.
    const wire = smooth(0.45, 0.95, v);
    const echo = smooth(0.2, 0.5, v) * 0.35;
    const shimmer = 0.75 + 0.25 * Math.sin(d * 9 - t * 1.4);
    const gold = ramp(FILIGREE_GOLD, clamp(wire * shimmer + echo));
    // Base: darkened lacquer of the source color so the wire pops.
    const lacq = [r * 0.5, g * 0.48, b * 0.52];
    const m = clamp(wire * (0.4 + 0.6 * d) + echo * d);
    return [mix(lacq[0], gold[0], m), mix(lacq[1], gold[1], m), mix(lacq[2], gold[2], m), 1];
  },
});

// ---------------------------------------------------------------------------
// 3. Matcap Relief (catalog #3) - re-lit 3D relief. matcapZ + nx/ny.
// ---------------------------------------------------------------------------
registerLabPrototype({
  id: "relief",
  category: "surface",
  label: "LAB: Matcap Relief",
  mechanism:
    "per-normal lighting of a fake relief sphere (matcapZ from sdf) - carved gem / cast metal from flat pixels",
  fn: (r, g, b, _x, _y, _t, c) => {
    if (!c.topo) {
      return [r, g, b, 1];
    }
    const nx = topoAt(c, "nx");
    const ny = topoAt(c, "ny");
    const z = topoAt(c, "matcapZ");
    // Fixed key light from upper-left + cool rim from lower-right.
    const key = clamp(0.5 + 0.55 * (-nx * 0.7 - ny * 0.7) * z + 0.35 * z);
    const rim = Math.pow(1 - z, 2.5) * 0.35;
    const [h, s, v] = rgb2hsv(r, g, b);
    const lit = hsv2rgb(h, s, clamp(v * (0.35 + 0.85 * key)));
    return [clamp(lit[0] + rim * 0.6), clamp(lit[1] + rim * 0.75), clamp(lit[2] + rim), 1];
  },
});

// ---------------------------------------------------------------------------
// 4. Temporal Echo (catalog #4) - real previous/next frames. frameSample.
// ---------------------------------------------------------------------------
registerLabPrototype({
  id: "echo",
  category: "surface",
  label: "LAB: Temporal Echo",
  mechanism:
    "the actual previous/next animation frames ghosted through the current one - a slow shutter on real motion",
  fn: (r, g, b, x, y, _t, c) => {
    if (!c.frameCount || c.frameCount < 2) {
      return [r, g, b, 1];
    }
    const prev = c.frameSample(c.frameIndex - 1, x, y);
    const next = c.frameSample(c.frameIndex + 1, x, y);
    // Ghosts only show where they DIFFER from the live frame (motion smear);
    // identical pixels keep the live color untouched.
    const same = (s, cr, cg, cb) =>
      s[3] > 0.02 && Math.abs(s[0] - cr) + Math.abs(s[1] - cg) + Math.abs(s[2] - cb) < 0.12;
    const ghostP = same(prev, r, g, b) ? 0 : prev[3] * 0.5;
    const ghostN = same(next, r, g, b) ? 0 : next[3] * 0.5;
    let col = [r, g, b];
    // Past = cool blue, future = warm amber.
    col = mix3(col, [prev[0] * 0.35 + 0.1, prev[1] * 0.4 + 0.3, prev[2] * 0.5 + 0.5], clamp(ghostP));
    col = mix3(col, [next[0] * 0.5 + 0.5, next[1] * 0.4 + 0.28, next[2] * 0.35 + 0.12], clamp(ghostN));
    return [col[0], col[1], col[2], 1];
  },
});

// ---------------------------------------------------------------------------
// 5. Frozen Shutter (catalog #5) - specimen pose under glass. frameSample(0).
// ---------------------------------------------------------------------------
registerLabPrototype({
  id: "shutter",
  category: "surface",
  label: "LAB: Frozen Shutter",
  mechanism: "frame 0 of the animation suspended faintly INSIDE the live silhouette - a museum specimen under glass",
  fn: (r, g, b, x, y, t, c) => {
    if (!c.frameCount || c.frameCount < 2) {
      return [r, g, b, 1];
    }
    const f0 = c.frameSample(0, x, y);
    // Only where the frozen pose DISAGREES with the live one: a ghost of the
    // specimen, not a wash over the whole body.
    const diff = f0[3] > 0.02 && Math.abs(f0[0] - r) + Math.abs(f0[1] - g) + Math.abs(f0[2] - b) >= 0.12;
    if (!diff) {
      return [r, g, b, 1];
    }
    const glass = 0.5 + 0.08 * Math.sin(t * 0.6);
    const [, s, v] = rgb2hsv(f0[0], f0[1], f0[2]);
    const mono = hsv2rgb(0.6, s * 0.4 + 0.1, clamp(v * 0.55 + 0.2));
    const m = clamp(f0[3] * glass);
    return [mix(r, mono[0], m), mix(g, mono[1], m), mix(b, mono[2], m), 1];
  },
});

// ---------------------------------------------------------------------------
// 6. Through-Body Refraction (catalog #6) - the body as a lens. sdf + nx/ny.
// ---------------------------------------------------------------------------
registerLabPrototype({
  id: "lens",
  category: "surface",
  label: "LAB: Through-Body Lens",
  mechanism:
    "each body pixel resampled along the inward normal proportional to depth - the mon bends its own image like glass",
  fn: (r, g, b, x, y, _t, c) => {
    if (!c.topo) {
      return [r, g, b, 1];
    }
    const d = Math.min(topoAt(c, "sdf"), DEEP) / DEEP;
    const nx = topoAt(c, "nx");
    const ny = topoAt(c, "ny");
    // March INTO the body along the negative normal; deeper pixels bend more.
    const bend = d * 0.16;
    const sx = x - nx * bend;
    const sy = y - ny * bend;
    // Chromatic dispersion: each channel refracts a different amount.
    const rr = c.sa(sx - nx * 0.012 * d, sy - ny * 0.012 * d);
    const gg = c.sa(sx, sy);
    const bb = c.sa(sx + nx * 0.012 * d, sy + ny * 0.012 * d);
    if (gg[3] <= 0.02) {
      return [r, g, b, 1];
    }
    // Slight brightening toward the core = light gathering in the lens.
    const gather = 1 + 0.35 * Math.pow(d, 2);
    return [clamp(rr[0] * gather), clamp(gg[1] * gather), clamp(bb[2] * gather), 1];
  },
});

// ---------------------------------------------------------------------------
// 7. Droste Window (catalog #7) - recursive chest portal. sa + stable anchor.
// ---------------------------------------------------------------------------
registerLabPrototype({
  id: "droste",
  category: "surface",
  label: "LAB: Droste Window",
  mechanism: "a bounded window near the chest contains a recursively scaled copy of the whole sprite, 2 levels deep",
  fn: (r, g, b, x, y, t, c) => {
    const a = c.anchors;
    if (!a) {
      return [r, g, b, 1];
    }
    // The window tracks the BODY (frame anchors), not the stable landmark: a
    // portrait pinned to the chest moves with the chest. Level-2 recursion
    // anchors to the stable center so the innermost miniature never wobbles.
    const wx = a.frameCx;
    const wy = a.frameCy * 0.92;
    const dx = x - wx;
    const dy = y - wy;
    const rad = Math.hypot(dx, dy);
    const R = 0.2;
    if (rad >= R) {
      return [r, g, b, 1];
    }
    // The mini is a dim GHOSTLY PLAQUE, not a mirror of the skin: the live
    // pixel stays partially present so the window never reads as a hole.
    const ghostify = s => {
      const [h, sat, val] = rgb2hsv(s[0], s[1], s[2]);
      return hsv2rgb(mix(h, 0.62, 0.75), clamp(sat * 0.5 + 0.1), clamp(val * 0.55 + 0.28));
    };
    // Map window space onto the FULL sprite, centered on the stable anchor
    // (so the mini frames the mon's own chest/face, not empty padding).
    const span = 0.62;
    const map = (u, v) => [
      clamp(wx + (u - 0.5) * span, 0.005, 0.995),
      clamp(wy + (v - 0.5) * span * (c.H / Math.max(c.W, 1)), 0.005, 0.995),
    ];
    const u = (dx / R) * 0.5 + 0.5;
    const v = (dy / R) * 0.5 + 0.5;
    let [mu, mv] = map(u, v);
    let s = c.sa(mu, mv);
    if (rad < R * 0.48) {
      const u2 = (dx / (R * 0.48)) * 0.5 + 0.5;
      const v2 = (dy / (R * 0.48)) * 0.5 + 0.5;
      [mu, mv] = map(u2, v2);
      const s2 = c.sa(mu, mv);
      if (s2[3] > 0.02) {
        s = s2;
      }
    }
    const pulse = 0.92 + 0.08 * Math.sin(t * 1.1);
    if (s[3] <= 0.02) {
      // Empty window: smoked glass over the live pixel.
      return [r * 0.55 + 0.04, g * 0.55 + 0.05, b * 0.6 + 0.09, 1];
    }
    const gh = ghostify(s);
    const m = 0.82 * pulse;
    return [mix(r, gh[0] * pulse, m), mix(g, gh[1] * pulse, m), mix(b, gh[2] * pulse, m), 1];
  },
});

// ---------------------------------------------------------------------------
// 9. Per-Region Clockwork (catalog #9) - escapement cells. voro + pixId.
// ---------------------------------------------------------------------------
registerLabPrototype({
  id: "clockwork",
  category: "surface",
  label: "LAB: Per-Region Clockwork",
  mechanism:
    "escapement windows cut THROUGH the body at voro-cell positions, each ticking a brass gear-face at its own phase; the rest stays plumage",
  fn: (r, g, b, _x, _y, t, c) => {
    if (!c.topo) {
      return [r, g, b, 1];
    }
    const v = topoAt(c, "voro");
    const d = Math.min(topoAt(c, "sdf"), DEEP) / DEEP;
    // Window: deep-body pixels only, gated per coarse cell so some regions
    // stay feathered and others open onto machinery.
    const cell = h2(Math.floor(c.px / 9) * 3.7 + 0.31, Math.floor(c.py / 9) * 5.1 + 0.17);
    const open = smooth(0.55, 0.8, d) * (cell > 0.35 ? 1 : 0);
    if (open <= 0.01) {
      return [r, g, b, 1];
    }
    // Gear face: radial teeth around the cell center, ticking in discrete
    // steps (escapement), brass-lit.
    const cxr = fract(c.px / 9) - 0.5;
    const cyr = fract(c.py / 9) - 0.5;
    const ang = Math.atan2(cyr, cxr);
    const radc = Math.hypot(cxr, cyr) * 2;
    const tick = Math.floor(fract(t * 0.3 + cell) * 6) / 6;
    const teeth = 0.5 + 0.5 * Math.sin(ang * 9 + tick * Math.PI * 2);
    const face = clamp(0.35 + 0.5 * teeth * (1 - radc) + 0.25 * (1 - radc));
    const brass = ramp(G_COPPER, face);
    // Seams: midline borders read as plate joints over everything.
    const seam = 1 - smooth(0.3, 0.8, v) * 0.45;
    const col = mix3([r, g, b], [brass[0] * seam, brass[1] * seam, brass[2] * seam], clamp(open));
    return [col[0], col[1], col[2], 1];
  },
});

// ---------------------------------------------------------------------------
// 10. Opal Fire (catalog #10) - real thin-film interference. nx/ny + sdf.
// ---------------------------------------------------------------------------
registerLabPrototype({
  id: "opalfire",
  category: "surface",
  label: "LAB: Opal Fire",
  mechanism:
    "thin-film interference hue from incidence angle (normals) + optical depth (sdf); flashes move when the pose changes",
  fn: (r, g, b, x, y, t, c) => {
    if (!c.topo) {
      return [r, g, b, 1];
    }
    const d = Math.min(topoAt(c, "sdf"), DEEP) / DEEP;
    const nx = topoAt(c, "nx");
    const ny = topoAt(c, "ny");
    // Incidence term: how edge-on the local surface sits to the viewer.
    const incidence = Math.abs(nx * 0.6 + ny * 0.8);
    // Optical path difference: film thickness grows with body depth.
    const opd = d * 2.2 + incidence * 1.1 + vnoise(x * 2.3, y * 2.3) * 0.5;
    // Interference: constructive wavelength cycles with the path difference.
    const hue = fract(opd * 0.9 + t * 0.02);
    const film = hsv2rgb(hue, 0.4, 1.0);
    // Fire strength peaks at mid depth + grazing angle, like real opal, and
    // the flash INTENSITY (not just hue) rides the interference so patches
    // ignite and die as the pose changes.
    const wave = 0.5 + 0.5 * Math.sin(opd * 6.2832);
    const fire = Math.pow(d, 0.7) * (0.35 + 0.65 * incidence) * wave;
    const [h, s, v] = rgb2hsv(r, g, b);
    const body = hsv2rgb(h, clamp(s * 0.35 + 0.1), clamp(v * 0.7 + 0.14));
    const m = clamp(fire * 1.15);
    return [mix(body[0], film[0], m), mix(body[1], film[1], m), mix(body[2], film[2], m), 1];
  },
});

// ---------------------------------------------------------------------------
// 12. Event Horizon Lens (catalog #12) - pixel-bending black hole. Around.
// ---------------------------------------------------------------------------
registerLabPrototype({
  id: "bendlens",
  category: "around",
  label: "LAB: Event Horizon Lens",
  mechanism:
    "pad pixels near a small orbiting mass sample the SPRITE pulled toward it - space (and the mon's own image) visibly bends",
  overlay: false,
  fn: (nx, ny, _df, t, c) => {
    // Mass position: slow orbit at the mon's shoulder, anchored to the STABLE
    // centroid so it never wobbles with the pose.
    const ang = t * 0.35;
    const mxp = c.stableCx + Math.cos(ang) * 0.16;
    const myp = c.stableCy * 0.75 + Math.sin(ang) * 0.1;
    const dx = nx - mxp;
    const dy = ny - myp;
    const r = Math.hypot(dx, dy);
    const horizon = 0.045;
    const reach = 0.24;
    if (r > reach) {
      return [0, 0, 0, 0];
    }
    if (r < horizon) {
      // Inside the horizon: solid near-black disc with a violet accretion rim.
      const rimGlow = smooth(horizon * 0.6, horizon, r);
      return [0.02 + rimGlow * 0.14, 0.0, 0.05 + rimGlow * 0.22, 1];
    }
    // Outside: pull the sample point toward the mass (lensed copy of the mon).
    const pull = (reach - r) / (reach - horizon);
    const bend = pull * pull * 0.55;
    const s = c.spr(nx - dx * bend, ny - dy * bend);
    const fade = 1 - smooth(horizon, reach, r);
    const glow = smooth(horizon, horizon * 1.6, r) * (1 - smooth(horizon * 1.6, reach * 0.7, r));
    if (s[3] > 0.02) {
      const lum = luma(s[0], s[1], s[2]);
      return [
        s[0] * 0.85 + glow * 0.25,
        s[1] * 0.8 + glow * 0.18,
        clamp(s[2] * 0.9 + glow * 0.4 + lum * 0.05),
        s[3] * (0.3 + 0.6 * fade),
      ];
    }
    return [glow * 0.3, glow * 0.2, glow * 0.5, glow * 0.6 * fade];
  },
});

// ---------------------------------------------------------------------------
// 18. Tornado Paper (catalog #18) - interior polar churn. sa + sdf + anchor.
// ---------------------------------------------------------------------------
registerLabPrototype({
  id: "maelstrom",
  category: "surface",
  label: "LAB: Maelstrom Core",
  mechanism:
    "the interior resampled through a slow polar swirl centered on the stable anchor, amplitude weighted by sdf so the rim never moves",
  fn: (r, g, b, x, y, t, c) => {
    const a = c.anchors;
    if (!c.topo || !a) {
      return [r, g, b, 1];
    }
    const d = Math.min(topoAt(c, "sdf"), DEEP) / DEEP;
    const cxn = a.stableCx;
    const cyn = a.stableCy;
    const dx = x - cxn;
    const dy = (y - cyn) * (c.H / Math.max(c.W, 1));
    const rad = Math.hypot(dx, dy) + 1e-5;
    // Swirl angle peaks at the core, zero at the rim (weight = sdf).
    const twist = (d * d * (2.6 * Math.sin(t * 0.45) + 3.4)) / (1 + rad * 6);
    const cs = Math.cos(twist);
    const sn = Math.sin(twist);
    const sx = cxn + dx * cs - dy * sn;
    const sy = cyn + (dx * sn + dy * cs) / (c.H / Math.max(c.W, 1));
    const s = c.sa(sx, sy);
    if (s[3] <= 0.02) {
      return [r, g, b, 1];
    }
    // Slight cool drag in the churn so motion reads.
    const drag = 1 - d * 0.18;
    return [s[0] * drag, s[1] * drag, clamp(s[2] * (drag + 0.08)), 1];
  },
});

// ---------------------------------------------------------------------------
// 19. Amber Inclusion (catalog #19) - fossil amber + trapped pose. sdf +
// frameSample + pixId.
// ---------------------------------------------------------------------------
const AMBER = ["1d0d02", "6b3208", "c47a1a", "f2b544", "ffe6a8"].map(hx);
registerLabPrototype({
  id: "amber",
  category: "surface",
  label: "LAB: Amber Inclusion",
  mechanism:
    "warm depth-graded fossil amber transmission with a tiny dark inclusion sampled from a scaled-down OTHER animation frame",
  fn: (r, g, b, x, y, _t, c) => {
    if (!c.topo) {
      return [r, g, b, 1];
    }
    const d = Math.min(topoAt(c, "sdf"), DEEP) / DEEP;
    // Transmission: light path length through amber grows with depth.
    const path = Math.pow(d, 1.35);
    let col = ramp(AMBER, clamp(0.15 + path * 0.8 + luma(r, g, b) * 0.12));
    // Inclusion: one stable blob position (seeded), containing the silhouette
    // of a far-away frame scaled down 3x - a trapped past pose.
    if (c.frameCount > 4) {
      const seed = h2(7.31, 2.17);
      const ix = 0.38 + seed * 0.24;
      const iy = 0.42 + h2(3.77, 9.51) * 0.16;
      const dx = (x - ix) * 3;
      const dy = (y - iy) * 3;
      if (Math.abs(dx) < 0.42 && Math.abs(dy) < 0.42) {
        const far = c.frameSample(Math.floor(c.frameCount / 2), dx + 0.5, dy + 0.5);
        if (far[3] > 0.02) {
          // Show the trapped pose's own shading, crushed toward umber, instead
          // of a flat black blob: it reads as a thing IN the amber, not a hole.
          const [fh, fs, fv] = rgb2hsv(far[0], far[1], far[2]);
          const trapped = hsv2rgb(fh, clamp(fs * 0.7 + 0.25), clamp(fv * 0.45));
          const m = far[3] * 0.85;
          col = [mix(col[0], trapped[0], m), mix(col[1], trapped[1], m), mix(col[2], trapped[2], m)];
        }
      }
    }
    // Rim: fresnel-ish brightening where the "amber" is thin.
    const fres = Math.pow(1 - d, 3) * 0.4;
    return [clamp(col[0] + fres * 0.9), clamp(col[1] + fres * 0.7), clamp(col[2] + fres * 0.35), 1];
  },
});
