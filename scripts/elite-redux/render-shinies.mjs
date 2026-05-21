/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Elite Redux Phase B Task B7: render 3-tier shiny variants per species.
 *
 * Pokerogue ships 3 shiny tiers (regular, shiny+, shiny++). Upstream
 * Elite-Redux only has ONE shiny.pal per species, so we derive +/++ by
 * hue-rotating the shiny palette by ~120°/~240°. Results land alongside
 * the existing PNGs in `assets/images/pokemon/elite-redux/<slug>/`.
 *
 * Inputs (per species directory under `vendor/elite-redux/sprites/graphics/pokemon/<slug>/`):
 *   - front.png + back.png — 4-bit indexed-colour PNGs (16-colour palette)
 *   - normal.pal           — JASC-PAL matching the PNG's embedded palette
 *   - shiny.pal            — JASC-PAL for the in-game shiny form
 *
 * Outputs (per species in `assets/images/pokemon/elite-redux/<slug>/`):
 *   - shiny.png        / shiny-back.png        — tier 1 (regular)
 *   - shiny-2.png      / shiny-back-2.png      — tier 2 (shiny+, hue +120°)
 *   - shiny-3.png      / shiny-back-3.png      — tier 3 (shiny++, hue +240°)
 *
 * The renderer is content-based idempotent: existing outputs that match the
 * regenerated buffer byte-for-byte are skipped so re-runs don't churn mtimes.
 *
 * Failure mode: per-species errors (e.g. missing palette, mismatched colour
 * count) are logged and counted; the script continues. Exits 0 if at least
 * one species rendered successfully, else exits 1.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJascPal, rotateHue, swapPalette } from "./lib/palette.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const VENDOR_ROOT = resolve(ROOT, "vendor/elite-redux/sprites/graphics/pokemon");
const ASSET_ROOT = resolve(ROOT, "assets/images/pokemon/elite-redux");

const TIER_2_HUE = 120;
const TIER_3_HUE = 240;

/**
 * @typedef {Object} TierSpec
 * @property {string} suffix output file suffix (e.g. "" for tier 1, "-2" for tier 2)
 * @property {number} hueShift degrees to rotate shiny.pal by
 */

/** @type {TierSpec[]} */
const TIERS = [
  { suffix: "", hueShift: 0 }, // tier 1: exact shiny.pal
  { suffix: "-2", hueShift: TIER_2_HUE }, // tier 2: shiny+
  { suffix: "-3", hueShift: TIER_3_HUE }, // tier 3: shiny++
];

/** @type {Array<{ src: "front.png" | "back.png", outPrefix: "shiny" | "shiny-back" }>} */
const VIEWS = [
  { src: "front.png", outPrefix: "shiny" },
  { src: "back.png", outPrefix: "shiny-back" },
];

/**
 * Render every shiny variant for a single species directory.
 *
 * @param {string} slug
 * @param {string} vendorDir absolute path to the species' vendor dir (used for `shiny.pal`)
 * @param {string} outDir absolute path to the species' output dir
 * @param {{ pngSource?: string }} [opts] override PNG source dir (defaults to `vendorDir`).
 *   Palette-only forms have their `front.png`/`back.png` palette-derived
 *   into the OUTPUT dir by `fetch-sprites.mjs`, not the vendor dir.
 * @returns {Promise<{ written: number, skipped: number, missingPalettes: string[], errors: string[] }>}
 */
export async function renderSpecies(slug, vendorDir, outDir, opts = {}) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const missingPalettes = [];
  let written = 0;
  let skipped = 0;
  const pngSource = opts.pngSource ?? vendorDir;

  // Load shiny palette (one per species — applies to both front + back).
  const shinyPalPath = join(vendorDir, "shiny.pal");
  if (!existsSync(shinyPalPath)) {
    missingPalettes.push(`${slug}/shiny.pal`);
    return { written, skipped, missingPalettes, errors };
  }
  /** @type {Array<{ r: number, g: number, b: number }>} */
  let shinyPal;
  try {
    shinyPal = parseJascPal(await readFile(shinyPalPath, "utf8"));
  } catch (err) {
    errors.push(`${slug}: shiny.pal parse failed — ${err instanceof Error ? err.message : String(err)}`);
    return { written, skipped, missingPalettes, errors };
  }

  // Precompute the 3 derived palettes once — same for front + back.
  const palettesByTier = TIERS.map(t => (t.hueShift === 0 ? shinyPal : rotateHue(shinyPal, t.hueShift)));

  for (const view of VIEWS) {
    const srcPath = join(pngSource, view.src);
    if (!existsSync(srcPath)) {
      // Not all species have back sprites; skip silently — the manifest's
      // audit pass tracks missing PNGs, not this renderer.
      continue;
    }
    let srcBuf;
    try {
      srcBuf = await readFile(srcPath);
    } catch (err) {
      errors.push(`${slug}/${view.src}: read failed — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (let t = 0; t < TIERS.length; t++) {
      const tier = TIERS[t];
      const palette = palettesByTier[t];
      const outName = `${view.outPrefix}${tier.suffix}.png`;
      const outPath = join(outDir, outName);
      /** @type {Buffer} */
      let rendered;
      try {
        rendered = swapPalette(srcBuf, palette);
      } catch (err) {
        errors.push(`${slug}/${outName}: swapPalette failed — ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      // Idempotency: skip if existing file is byte-identical.
      if (existsSync(outPath)) {
        try {
          const existing = await readFile(outPath);
          if (existing.equals(rendered)) {
            skipped++;
            continue;
          }
        } catch {
          // fall through — re-write below
        }
      }
      await mkdir(outDir, { recursive: true });
      await writeFile(outPath, rendered);
      written++;
    }
  }

  return { written, skipped, missingPalettes, errors };
}

/**
 * Walk every species directory under `vendor/.../graphics/pokemon/` and
 * collect a flattened (slug → vendorDir) map of every renderable species and
 * form sub-directory. Slug derivation mirrors `fetch-sprites.mjs`:
 *
 *   `bulbasaur/`            → slug `bulbasaur`
 *   `arceus/bug/`           → slug `arceus_bug`
 *   `minior/core/red/`      → slug `minior_core_red`
 *
 * The slug must match the manifest builder's output (lower_snake_case derived
 * from the upstream dir path) so `audit-sprites` can verify each entry.
 *
 * @param {string} root
 * @returns {Promise<Map<string, string>>}
 */
async function collectSpeciesDirs(root) {
  /** @type {Map<string, string>} */
  const out = new Map();
  /**
   * @param {string} dir
   * @param {string} slug
   */
  async function walk(dir, slug) {
    out.set(slug, dir);
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        await walk(join(dir, ent.name), `${slug}_${ent.name}`);
      }
    }
  }
  const top = await readdir(root, { withFileTypes: true });
  for (const ent of top) {
    if (ent.isDirectory()) {
      await walk(join(root, ent.name), ent.name);
    }
  }
  return out;
}

/**
 * Iterate every species + form directory under `vendor/.../graphics/pokemon/`
 * and render shinies into the matching `assets/.../<slug>/` directory.
 *
 * Form sub-directories are flattened into the slug (e.g. `arceus/bug/` →
 * `arceus_bug/`). Palette-only forms work the same way: fetch-sprites.mjs
 * has already palette-derived `front.png` + `back.png` for them, so the
 * renderer just has to apply `shiny.pal` from the form dir.
 *
 * @param {{ limit?: number, slugFilter?: string }} [opts]
 */
export async function renderAll(opts = {}) {
  if (!existsSync(VENDOR_ROOT)) {
    throw new Error(`vendor sprite tree missing: ${VENDOR_ROOT}\nRun 'pnpm run er:fetch-sprites' first.`);
  }
  const allDirs = await collectSpeciesDirs(VENDOR_ROOT);
  let slugs = [...allDirs.keys()].sort();
  if (opts.slugFilter) {
    slugs = slugs.filter(s => s === opts.slugFilter);
  }
  if (typeof opts.limit === "number" && opts.limit > 0) {
    slugs = slugs.slice(0, opts.limit);
  }

  let speciesProcessed = 0;
  let speciesSucceeded = 0;
  let totalWritten = 0;
  let totalSkipped = 0;
  /** @type {string[]} */
  const allMissingPalettes = [];
  /** @type {string[]} */
  const allErrors = [];

  for (const slug of slugs) {
    speciesProcessed++;
    const vendorDir = /** @type {string} */ (allDirs.get(slug));
    const outDir = join(ASSET_ROOT, slug);
    // Palette-only forms: the form's shiny.pal applies to the form-derived
    // PNGs that fetch-sprites.mjs wrote, which live in ASSET_ROOT — NOT in
    // the vendor dir. Pass ASSET_ROOT as the PNG source via `pngSource`.
    const result = await renderSpecies(slug, vendorDir, outDir, { pngSource: outDir });
    totalWritten += result.written;
    totalSkipped += result.skipped;
    allMissingPalettes.push(...result.missingPalettes);
    allErrors.push(...result.errors);
    if (result.written > 0 || result.skipped > 0) {
      speciesSucceeded++;
    }
    if (speciesProcessed % 200 === 0) {
      console.log(`[er:render-shinies] progressed ${speciesProcessed}/${slugs.length} species…`);
    }
  }

  return {
    speciesProcessed,
    speciesSucceeded,
    totalWritten,
    totalSkipped,
    missingPalettes: allMissingPalettes,
    errors: allErrors,
  };
}

/**
 * Parse CLI flags. Supports:
 *   --limit=N        process at most N species (smoke testing)
 *   --slug=NAME      process exactly one species
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
  console.log(`[er:render-shinies] scanning ${VENDOR_ROOT}`);
  if (flags.limit) {
    console.log(`[er:render-shinies] limit=${flags.limit}`);
  }
  if (flags.slugFilter) {
    console.log(`[er:render-shinies] slug=${flags.slugFilter}`);
  }
  const result = await renderAll(flags);
  const elapsedMs = Date.now() - t0;
  console.log("[er:render-shinies] done.");
  console.log(`[er:render-shinies]   species processed:  ${result.speciesProcessed}`);
  console.log(`[er:render-shinies]   species with output: ${result.speciesSucceeded}`);
  console.log(`[er:render-shinies]   PNGs written:        ${result.totalWritten}`);
  console.log(`[er:render-shinies]   PNGs skipped (same): ${result.totalSkipped}`);
  console.log(`[er:render-shinies]   missing palettes:    ${result.missingPalettes.length}`);
  console.log(`[er:render-shinies]   errors:              ${result.errors.length}`);
  console.log(`[er:render-shinies]   elapsed:             ${(elapsedMs / 1000).toFixed(1)}s`);
  if (result.errors.length > 0) {
    console.warn("[er:render-shinies] first errors:");
    for (const e of result.errors.slice(0, 5)) {
      console.warn(`  - ${e}`);
    }
  }
  if (result.speciesSucceeded === 0) {
    console.error("[er:render-shinies] no species rendered — bailing");
    process.exit(1);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
