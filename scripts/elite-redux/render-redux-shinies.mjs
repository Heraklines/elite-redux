/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Algorithmic tier-2 / tier-3 shiny generation for ER REDUX (and other dex-
 * backfilled) species that ship a single `shiny.png` but no `shiny.pal`.
 *
 * Background — why this exists alongside render-shinies.mjs:
 *
 *   render-shinies.mjs handles species where the upstream Elite-Redux repo
 *   ships JASC `normal.pal` + `shiny.pal` files. It does an indexed-palette
 *   swap on the PNG, then hue-rotates the palette by 120°/240° to derive
 *   tier-2/tier-3. Trivially correct, ~$0 compute.
 *
 *   The ER-nextdex backfill (B9 dex fetch) covers ~778 species — the
 *   `*_REDUX` customs and ER-only forms that upstream never shipped sprites
 *   for. They land as 8-bit RGBA `shiny.png` files with no palette file
 *   alongside. The palette-swap path can't touch them. Today these species
 *   have no tier-2/tier-3 at all.
 *
 * This script's contract: for each species with `front.png` + `shiny.png`
 * but no `shiny-2.png`, derive a tier-2 / tier-3 shiny IN PIXEL SPACE by:
 *
 *   1. Decoding both PNGs to RGBA buffers.
 *   2. Identifying the "shiny delta" — pixels that differ between front and
 *      shiny by more than a small per-channel epsilon. Those are the pixels
 *      the upstream shiny artist re-coloured. Everything else (line art,
 *      shading anchors, the bits where shiny ≈ front) we treat as part of
 *      the species' base look and leave untouched.
 *   3. For each delta pixel, convert the SHINY colour to HSL, rotate hue by
 *      +120° (tier-2) / +240° (tier-3) while preserving saturation and
 *      lightness, then write the rotated colour into the output buffer.
 *
 * Color-theory guardrails (against the "everything goes black" failure
 * mode that naïve recolouring would hit):
 *
 *   - **Preserve S and L**: only hue rotates. A dark navy stays dark, a
 *     pale yellow stays pale; only the dominant hue family swings.
 *   - **Skip near-grayscale pixels** (S < 0.1): hue rotation on a near-grey
 *     pixel is a no-op anyway, but explicit pass-through avoids any rounding
 *     drift around white/black/eye-glints.
 *   - **Skip unchanged pixels** (|front - shiny| < epsilon per channel):
 *     these are body parts the shiny didn't recolour; rotating them would
 *     introduce hue noise in regions the artist intentionally left alone.
 *   - **HSL not HSV**: HSL's L preserves perceived brightness symmetrically
 *     across the colour wheel — important for not blowing out tier-2 of a
 *     deep red into a muddy green of a different perceptual weight.
 *
 * Choosing +120° / +240° (triadic rotation):
 *
 *   On a 5-species smoke test (abra_redux, gible_redux, abomasnow_mega,
 *   absol_mega, garchomp_mega_redux), triadic rotation produced cleaner
 *   visual tiers than 180°/60° (complement/analogous). Triadic guarantees
 *   the three tiers form a balanced triangle on the colour wheel — no two
 *   tiers ever read as the "same colour family", which is the whole point
 *   of having three shiny rarities.
 *
 * Idempotent: any species already carrying `shiny-2.png` is skipped (the
 * existence check is per-file, so partial states recover gracefully).
 *
 * Usage:
 *
 *   pnpm run er:render-redux-shinies
 *   pnpm run er:render-redux-shinies -- --limit=50
 *   pnpm run er:render-redux-shinies -- --slug=abra_redux
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePngToRgba, encodeRgbaToPng } from "./lib/png-rgba.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ASSET_ROOT = resolve(ROOT, "assets/images/pokemon/elite-redux");

/** Hue offsets (degrees) for the two derived tiers. Triadic rotation. */
export const TIER_2_HUE_SHIFT = 120;
export const TIER_3_HUE_SHIFT = 240;

/**
 * Per-channel delta threshold (0-255 scale) for treating a (front, shiny)
 * pixel pair as "the same colour". Empirically chosen: the dex backfill
 * PNGs sometimes carry 1-2 LSB of noise between front and shiny on
 * unchanged regions (artefacts of upstream's PNG re-encoding), so a flat
 * 5/256 floor avoids classifying that noise as "shiny recolour".
 */
export const DELTA_EPSILON = 5;

/**
 * Minimum HSL saturation (0-1) to bother rotating. Below this, the pixel
 * is effectively grayscale — eye glints, line-art black, white highlights
 * — and a hue rotation is either a no-op or a perceptual nightmare.
 */
export const SATURATION_FLOOR = 0.1;

/**
 * Pixel view pairs we transform. Each shiny variant has a front + back
 * counterpart; the existence check is independent per pair so we still
 * generate tier-2 front even if back is missing.
 *
 * @type {Array<{ src: "shiny.png", base: "front.png", outPrefix: "shiny" } | { src: "shiny-back.png", base: "back.png", outPrefix: "shiny-back" }>}
 */
const VIEWS = [
  { src: "shiny.png", base: "front.png", outPrefix: "shiny" },
  { src: "shiny-back.png", base: "back.png", outPrefix: "shiny-back" },
];

// =============================================================================
// Colour-space math (HSL ↔ RGB)
// =============================================================================

/**
 * Convert sRGB (0-255 ints) → HSL.
 *
 *   h ∈ [0, 360)  (degrees; 0 = red, 120 = green, 240 = blue)
 *   s ∈ [0, 1]
 *   l ∈ [0, 1]
 *
 * Standard formula (Smith, 1978 — same one CSS uses). Achromatic pixels
 * report h=0, s=0 — the SATURATION_FLOOR check downstream pre-empts them
 * before any rotation runs.
 *
 * Why HSL not HSV: we need to preserve PERCEIVED brightness. A pure-red
 * pixel and a pure-yellow pixel have v=1 in HSV, but visually yellow reads
 * much brighter; HSL puts both at l=0.5, matching their (rough) perceptual
 * weight. After a +120° hue rotation, red→green: HSL keeps the same l so
 * the result reads with similar perceived brightness. HSV would have
 * produced a darker green relative to the original red.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{ h: number, s: number, l: number }}
 */
export function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const delta = max - min;
  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === rn) {
      h = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      h = (bn - rn) / delta + 2;
    } else {
      h = (rn - gn) / delta + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  return { h, s, l };
}

/**
 * HSL → sRGB (0-255 ints), clamped + rounded.
 *
 * @param {number} h hue degrees (any sign; will be normalised)
 * @param {number} s saturation 0-1
 * @param {number} l lightness 0-1
 * @returns {{ r: number, g: number, b: number }}
 */
export function hslToRgb(h, s, l) {
  // Normalise hue into [0, 360).
  let hh = h % 360;
  if (hh < 0) {
    hh += 360;
  }
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let rp;
  let gp;
  let bp;
  if (hh < 60) {
    [rp, gp, bp] = [c, x, 0];
  } else if (hh < 120) {
    [rp, gp, bp] = [x, c, 0];
  } else if (hh < 180) {
    [rp, gp, bp] = [0, c, x];
  } else if (hh < 240) {
    [rp, gp, bp] = [0, x, c];
  } else if (hh < 300) {
    [rp, gp, bp] = [x, 0, c];
  } else {
    [rp, gp, bp] = [c, 0, x];
  }
  return {
    r: Math.max(0, Math.min(255, Math.round((rp + m) * 255))),
    g: Math.max(0, Math.min(255, Math.round((gp + m) * 255))),
    b: Math.max(0, Math.min(255, Math.round((bp + m) * 255))),
  };
}

// =============================================================================
// Pixel transform
// =============================================================================

/**
 * Whether a (front, shiny) pixel pair counts as "shiny-recoloured" — i.e.
 * the upstream shiny artist actually changed this pixel's colour, vs left
 * it identical to the base sprite.
 *
 * Uses the L∞ (max-per-channel) distance with DELTA_EPSILON as the floor.
 * Alpha is ignored: transparent pixels stay transparent either way, and
 * partial transparency we treat as "if RGB differs, it's a recolour".
 *
 * @param {number} fr
 * @param {number} fg
 * @param {number} fb
 * @param {number} sr
 * @param {number} sg
 * @param {number} sb
 */
export function isShinyDelta(fr, fg, fb, sr, sg, sb) {
  const dr = Math.abs(fr - sr);
  const dg = Math.abs(fg - sg);
  const db = Math.abs(fb - sb);
  return Math.max(dr, dg, db) >= DELTA_EPSILON;
}

/**
 * Compute a single output pixel by rotating the shiny pixel's hue by
 * `hueShift` IFF (a) the shiny pixel differs from the base and (b) the
 * shiny pixel has enough saturation to rotate meaningfully. Otherwise
 * copies the shiny pixel through unchanged.
 *
 * Pure function — exported so the unit test can hit it without spinning
 * up file I/O.
 *
 * @param {number} fr base R
 * @param {number} fg base G
 * @param {number} fb base B
 * @param {number} sr shiny R
 * @param {number} sg shiny G
 * @param {number} sb shiny B
 * @param {number} sa shiny A (passed through unchanged)
 * @param {number} hueShift degrees to rotate, e.g. 120 for tier-2
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
export function rotatePixel(fr, fg, fb, sr, sg, sb, sa, hueShift) {
  // Fully-transparent pixels: nothing to rotate.
  if (sa === 0) {
    return { r: sr, g: sg, b: sb, a: sa };
  }
  // Pixel unchanged between front and shiny: not a "shiny-recoloured"
  // pixel — preserve the body's base look.
  if (!isShinyDelta(fr, fg, fb, sr, sg, sb)) {
    return { r: sr, g: sg, b: sb, a: sa };
  }
  const { h, s, l } = rgbToHsl(sr, sg, sb);
  // Near-grayscale: rotation is meaningless / would round-trip noise.
  if (s < SATURATION_FLOOR) {
    return { r: sr, g: sg, b: sb, a: sa };
  }
  const out = hslToRgb(h + hueShift, s, l);
  return { r: out.r, g: out.g, b: out.b, a: sa };
}

/**
 * Render one tier (front OR back, tier-2 OR tier-3) given the decoded
 * base + shiny buffers.
 *
 * @param {{ width: number, height: number, pixels: Buffer }} baseImg
 * @param {{ width: number, height: number, pixels: Buffer }} shinyImg
 * @param {number} hueShift
 * @returns {{ width: number, height: number, pixels: Buffer }}
 */
export function renderTier(baseImg, shinyImg, hueShift) {
  if (baseImg.width !== shinyImg.width || baseImg.height !== shinyImg.height) {
    throw new Error(
      `dimension mismatch: base=${baseImg.width}x${baseImg.height} vs shiny=${shinyImg.width}x${shinyImg.height}`,
    );
  }
  const { width, height } = shinyImg;
  const out = Buffer.alloc(width * height * 4);
  const pxCount = width * height;
  for (let i = 0; i < pxCount; i++) {
    const o = i * 4;
    const result = rotatePixel(
      baseImg.pixels[o + 0],
      baseImg.pixels[o + 1],
      baseImg.pixels[o + 2],
      shinyImg.pixels[o + 0],
      shinyImg.pixels[o + 1],
      shinyImg.pixels[o + 2],
      shinyImg.pixels[o + 3],
      hueShift,
    );
    out[o + 0] = result.r;
    out[o + 1] = result.g;
    out[o + 2] = result.b;
    out[o + 3] = result.a;
  }
  return { width, height, pixels: out };
}

// =============================================================================
// Per-species driver
// =============================================================================

/**
 * Per-species result.
 *
 * @typedef {Object} SpeciesResult
 * @property {string} slug
 * @property {number} written  count of new PNGs written
 * @property {number} skipped  count of files already present (idempotent skip)
 * @property {string | undefined} note  "missing_shiny", "missing_base", "decode_failed", "size_mismatch", or undefined on success
 */

/**
 * Render tier-2 + tier-3 for one species directory.
 *
 * @param {string} slug
 * @param {string} dir absolute path to the species' asset dir
 * @returns {Promise<SpeciesResult>}
 */
export async function renderSpeciesRedux(slug, dir) {
  let written = 0;
  let skipped = 0;
  /** @type {string | undefined} */
  let note;

  for (const view of VIEWS) {
    const basePath = join(dir, view.base);
    const shinyPath = join(dir, view.src);
    const out2Path = join(dir, `${view.outPrefix}-2.png`);
    const out3Path = join(dir, `${view.outPrefix}-3.png`);

    // Skip silently if no shiny — that's the per-pair contract.
    if (!existsSync(shinyPath)) {
      continue;
    }
    // Both tier targets already present → fully idempotent skip.
    const have2 = existsSync(out2Path);
    const have3 = existsSync(out3Path);
    if (have2 && have3) {
      skipped += 2;
      continue;
    }
    if (!existsSync(basePath)) {
      // Shiny present, base absent: no delta to compute. Document & skip.
      note = note ?? "missing_base";
      continue;
    }

    /** @type {{ width: number, height: number, pixels: Buffer }} */
    let baseImg;
    /** @type {{ width: number, height: number, pixels: Buffer }} */
    let shinyImg;
    try {
      const [baseBuf, shinyBuf] = await Promise.all([readFile(basePath), readFile(shinyPath)]);
      baseImg = decodePngToRgba(baseBuf);
      shinyImg = decodePngToRgba(shinyBuf);
    } catch {
      note = note ?? "decode_failed";
      continue;
    }
    if (baseImg.width !== shinyImg.width || baseImg.height !== shinyImg.height) {
      note = note ?? "size_mismatch";
      continue;
    }

    await mkdir(dir, { recursive: true });

    if (have2) {
      skipped++;
    } else {
      const tier2 = renderTier(baseImg, shinyImg, TIER_2_HUE_SHIFT);
      const png2 = encodeRgbaToPng(tier2);
      await writeFile(out2Path, png2);
      written++;
    }
    if (have3) {
      skipped++;
    } else {
      const tier3 = renderTier(baseImg, shinyImg, TIER_3_HUE_SHIFT);
      const png3 = encodeRgbaToPng(tier3);
      await writeFile(out3Path, png3);
      written++;
    }
  }

  return { slug, written, skipped, note };
}

/**
 * Drive renderSpeciesRedux over every species directory under ASSET_ROOT.
 *
 * @param {{ limit?: number, slugFilter?: string }} [opts]
 */
export async function renderAllRedux(opts = {}) {
  if (!existsSync(ASSET_ROOT)) {
    throw new Error(`asset root missing: ${ASSET_ROOT}`);
  }
  const entries = await readdir(ASSET_ROOT, { withFileTypes: true });
  let slugs = entries.filter(e => e.isDirectory()).map(e => e.name);
  slugs.sort();
  if (opts.slugFilter) {
    slugs = slugs.filter(s => s === opts.slugFilter);
  }
  if (typeof opts.limit === "number" && opts.limit > 0) {
    slugs = slugs.slice(0, opts.limit);
  }

  let processed = 0;
  let totalWritten = 0;
  let totalSkipped = 0;
  /** @type {Record<string, number>} */
  const noteCounts = {};
  /** @type {string[]} */
  const sampleErrors = [];

  for (const slug of slugs) {
    processed++;
    const dir = join(ASSET_ROOT, slug);
    const result = await renderSpeciesRedux(slug, dir);
    totalWritten += result.written;
    totalSkipped += result.skipped;
    if (result.note) {
      noteCounts[result.note] = (noteCounts[result.note] ?? 0) + 1;
      if (sampleErrors.length < 5) {
        sampleErrors.push(`${slug}: ${result.note}`);
      }
    }
    if (processed % 200 === 0) {
      console.log(`[er:render-redux-shinies] progressed ${processed}/${slugs.length}…`);
    }
  }

  return {
    speciesProcessed: processed,
    totalWritten,
    totalSkipped,
    noteCounts,
    sampleErrors,
  };
}

/**
 * Parse CLI flags. Supports:
 *   --limit=N      process at most N species
 *   --slug=NAME    process exactly one species
 *
 * @param {string[]} argv
 */
export function parseRenderFlags(argv) {
  /** @type {{ limit?: number, slugFilter?: string }} */
  const out = {};
  for (const arg of argv) {
    const limit = arg.match(/^--limit=(\d+)$/);
    if (limit) {
      out.limit = Number(limit[1]);
      continue;
    }
    const slug = arg.match(/^--slug=(.+)$/);
    if (slug) {
      out.slugFilter = slug[1];
    }
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const flags = parseRenderFlags(process.argv.slice(2));
  console.log(`[er:render-redux-shinies] scanning ${ASSET_ROOT}`);
  if (flags.limit) {
    console.log(`[er:render-redux-shinies] limit=${flags.limit}`);
  }
  if (flags.slugFilter) {
    console.log(`[er:render-redux-shinies] slug=${flags.slugFilter}`);
  }
  const result = await renderAllRedux(flags);
  const elapsedMs = Date.now() - t0;
  console.log("[er:render-redux-shinies] done.");
  console.log(`[er:render-redux-shinies]   species processed:  ${result.speciesProcessed}`);
  console.log(`[er:render-redux-shinies]   PNGs written:       ${result.totalWritten}`);
  console.log(`[er:render-redux-shinies]   PNGs skipped (idem): ${result.totalSkipped}`);
  console.log(`[er:render-redux-shinies]   elapsed:            ${(elapsedMs / 1000).toFixed(1)}s`);
  if (Object.keys(result.noteCounts).length > 0) {
    console.log("[er:render-redux-shinies]   notes:");
    for (const [note, count] of Object.entries(result.noteCounts)) {
      console.log(`     ${note}: ${count}`);
    }
  }
  if (result.sampleErrors.length > 0) {
    console.log("[er:render-redux-shinies]   sample issues:");
    for (const e of result.sampleErrors) {
      console.log(`     - ${e}`);
    }
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
