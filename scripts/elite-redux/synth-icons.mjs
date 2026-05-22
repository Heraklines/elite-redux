/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Elite Redux Phase B closer: synthesise box-icon sprites for species the
 * upstream repos never shipped icons for.
 *
 * Background: `fetch-sprites` mirrors `icon.png` straight from upstream
 * `Elite-Redux/eliteredux` for the ~1100 vanilla species it carries. The
 * ~778 species we backfilled from `ForwardFeed/ER-nextdex` (Hisuian forms,
 * Paldean forms, ER-original *_REDUX species, custom megas) have valid
 * front + back PNGs but NO `icon.png` — pokerogue's storage box and party
 * menu would 404 on those slugs.
 *
 * Solution: down-sample the existing `front.png` (or `back.png` fallback)
 * to 32×32 with nearest-neighbour and stack two copies vertically to
 * produce the canonical 32×64 two-frame ER icon sprite-sheet format.
 *
 * Output details:
 *   - Format: 8-bit/channel RGBA PNG (color type 6).
 *     The upstream icons are 4-bit indexed; we don't preserve that —
 *     Phaser loads either format identically, and the encoder cost of
 *     a fresh palette per species is not worth the byte savings.
 *   - Dimensions: 32×64 (two stacked 32×32 frames). Phaser sprite-sheets
 *     for icons expect this layout — both frames identical for now, which
 *     gives a "single-frame animation" that the runtime treats as a static
 *     icon. If we ever want flap/idle frames, the encoder can stack two
 *     different downsampled sources.
 *   - Sampling: nearest-neighbour from the 64×64 source. Pixel-art faithful
 *     for the 2× downscale ratio; no blurring, no edge bleeding.
 *
 * Idempotent: existing icon.png files are skipped (their bytes left
 * untouched). Re-runs only synthesise newly-added gaps.
 *
 * Exit codes:
 *   0 — at least one icon was synthesised (or already present); manifest
 *       coverage improved.
 *   1 — manifest empty, no source PNGs found, or every synthesis failed.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./audit-sprites.mjs";
import { decodePngToRgba, downsampleNearest, encodeRgbaToPng, stackVertical } from "./lib/png-rgba.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

/** Target icon dimensions (32×32 per frame, two frames stacked vertically). */
const ICON_FRAME_SIZE = 32;
const ICON_FRAMES = 2;

/**
 * Per-species synth result. The reason field is informational — it shows
 * which source was used (front vs back) and any warnings (e.g. source
 * wasn't square, downsample ratio non-integer).
 *
 * @typedef {Object} SynthResult
 * @property {string} slug
 * @property {"synthesised" | "skipped_existing" | "missing_source" | "decode_failed" | "encode_failed"} status
 * @property {string | undefined} source path of source PNG used (relative to ROOT)
 * @property {string | undefined} note
 */

/**
 * Synthesise the icon PNG for one manifest entry. Pure function with
 * injected I/O so tests can exercise the resample/encode logic without
 * touching disk.
 *
 * @param {{ slug: string, paths: { icon: string, front: string, back: string } }} entry
 * @returns {Promise<SynthResult>}
 */
export async function synthIconFor(entry) {
  const iconAbs = resolve(ROOT, entry.paths.icon);
  if (existsSync(iconAbs)) {
    return { slug: entry.slug, status: "skipped_existing", source: undefined, note: undefined };
  }

  // Prefer front (icon-facing direction is closer to a frontal mug shot);
  // back is the documented fallback.
  const frontAbs = resolve(ROOT, entry.paths.front);
  const backAbs = resolve(ROOT, entry.paths.back);
  /** @type {string | undefined} */
  let sourceAbs;
  /** @type {string | undefined} */
  let sourceRel;
  if (existsSync(frontAbs)) {
    sourceAbs = frontAbs;
    sourceRel = entry.paths.front;
  } else if (existsSync(backAbs)) {
    sourceAbs = backAbs;
    sourceRel = entry.paths.back;
  } else {
    return { slug: entry.slug, status: "missing_source", source: undefined, note: "no front.png or back.png" };
  }

  /** @type {ReturnType<typeof decodePngToRgba>} */
  let srcImg;
  try {
    const buf = await readFile(sourceAbs);
    srcImg = decodePngToRgba(buf);
  } catch (err) {
    return {
      slug: entry.slug,
      status: "decode_failed",
      source: sourceRel,
      note: err instanceof Error ? err.message : String(err),
    };
  }

  // Anim sheets (e.g. anim_front 64×128) shouldn't be the source. front.png
  // is canonically 64×64, but if a future asset is something else we still
  // try — downsampleNearest handles any aspect ratio. Just log it.
  const aspectNote = srcImg.width === srcImg.height ? undefined : `non-square source ${srcImg.width}x${srcImg.height}`;

  const small = downsampleNearest(srcImg, ICON_FRAME_SIZE, ICON_FRAME_SIZE);
  // ICON_FRAMES is currently 2 — duplicate the single frame to satisfy the
  // sprite-sheet shape pokerogue expects. If we generalise to true 2-frame
  // animation later, replace `small`+`small` with two distinct downsamples.
  let stacked = small;
  for (let f = 1; f < ICON_FRAMES; f++) {
    stacked = stackVertical(stacked, small);
  }

  /** @type {Buffer} */
  let png;
  try {
    png = encodeRgbaToPng(stacked);
  } catch (err) {
    return {
      slug: entry.slug,
      status: "encode_failed",
      source: sourceRel,
      note: err instanceof Error ? err.message : String(err),
    };
  }

  await mkdir(dirname(iconAbs), { recursive: true });
  await writeFile(iconAbs, png);
  return { slug: entry.slug, status: "synthesised", source: sourceRel, note: aspectNote };
}

/**
 * Walk the manifest and synthesise icon.png for every entry that lacks one.
 *
 * @param {Awaited<ReturnType<typeof loadManifest>>} manifest
 * @param {{ verbose?: boolean, limit?: number, slugFilter?: string }} [opts]
 */
export async function synthAll(manifest, opts = {}) {
  let entries = manifest;
  if (opts.slugFilter) {
    entries = entries.filter(e => e.slug === opts.slugFilter);
  }
  if (typeof opts.limit === "number" && opts.limit > 0) {
    entries = entries.slice(0, opts.limit);
  }

  /** @type {Record<SynthResult["status"], number>} */
  const counts = {
    synthesised: 0,
    skipped_existing: 0,
    missing_source: 0,
    decode_failed: 0,
    encode_failed: 0,
  };
  /** @type {SynthResult[]} */
  const issues = [];

  let processed = 0;
  for (const entry of entries) {
    const result = await synthIconFor(entry);
    counts[result.status]++;
    if (result.status === "synthesised" && opts.verbose) {
      console.log(
        `[er:synth-icons] ${entry.slug.padEnd(40)} ← ${result.source}${result.note ? ` (${result.note})` : ""}`,
      );
    }
    if (result.status !== "synthesised" && result.status !== "skipped_existing") {
      issues.push(result);
    }
    processed++;
    if (processed % 200 === 0) {
      console.log(`[er:synth-icons] progress: ${processed}/${entries.length} entries…`);
    }
  }

  return { counts, issues, processed };
}

/**
 * Parse CLI flags.
 *   --verbose       per-species log lines
 *   --limit=N       cap entries (smoke test)
 *   --slug=NAME     restrict to one species
 *
 * @param {string[]} argv
 */
export function parseFlags(argv) {
  /** @type {{ verbose?: boolean, limit?: number, slugFilter?: string }} */
  const out = {};
  for (const arg of argv) {
    if (arg === "--verbose") {
      out.verbose = true;
      continue;
    }
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
  const flags = parseFlags(process.argv.slice(2));

  console.log("[er:synth-icons] loading manifest…");
  const manifest = await loadManifest();
  console.log(`[er:synth-icons] ${manifest.length} entries`);
  if (flags.limit) {
    console.log(`[er:synth-icons] limit=${flags.limit}`);
  }
  if (flags.slugFilter) {
    console.log(`[er:synth-icons] slug=${flags.slugFilter}`);
  }

  const { counts, issues, processed } = await synthAll(manifest, flags);

  const elapsedMs = Date.now() - t0;
  console.log("[er:synth-icons] done.");
  console.log(`[er:synth-icons]   processed:         ${processed}`);
  console.log(`[er:synth-icons]   synthesised:       ${counts.synthesised}`);
  console.log(`[er:synth-icons]   skipped (existed): ${counts.skipped_existing}`);
  console.log(`[er:synth-icons]   missing source:    ${counts.missing_source}`);
  console.log(`[er:synth-icons]   decode failed:     ${counts.decode_failed}`);
  console.log(`[er:synth-icons]   encode failed:     ${counts.encode_failed}`);
  console.log(`[er:synth-icons]   elapsed:           ${(elapsedMs / 1000).toFixed(1)}s`);

  if (issues.length > 0) {
    const showLimit = Math.min(issues.length, 20);
    console.warn(`[er:synth-icons] issues (${issues.length} total, showing ${showLimit}):`);
    for (const issue of issues.slice(0, showLimit)) {
      console.warn(`  - ${issue.slug.padEnd(40)} ${issue.status}: ${issue.note ?? "?"}`);
    }
  }

  // Exit 1 only if nothing was synthesised AND nothing was already present —
  // i.e. the pipeline didn't make progress AND wasn't already complete.
  // Pure skipped_existing runs (re-runs) should still exit 0.
  const productive = counts.synthesised + counts.skipped_existing;
  process.exit(productive > 0 ? 0 : 1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(2);
  });
}
