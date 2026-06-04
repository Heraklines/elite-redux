/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJascPal, swapPalette } from "./lib/palette.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const VENDOR = resolve(ROOT, "vendor/elite-redux/sprites");
const ASSET_DIR = resolve(ROOT, "assets/images/pokemon/elite-redux");
const MARKER = resolve(VENDOR, ".fetched");

// Public sprite repo. NOT the same as the ER-nextdex JSON data repo.
const SPRITE_REPO = "https://github.com/Elite-Redux/eliteredux.git";
const SPRITE_BRANCH = "master"; // default branch confirmed via GitHub API (2026-05)
const SPARSE_PATH = "graphics/pokemon/";

// Per-view PNGs the renderer + manifest care about. Anything else found in a
// nested form-dir is mirrored anyway (idempotent), but the palette-derive
// fallback for palette-only forms targets exactly this set.
const VIEW_PNGS = ["front.png", "back.png", "anim_front.png", "icon.png", "footprint.png"];

/**
 * Run a command, inheriting stdio for visibility. Throws on non-zero exit.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 */
function run(cmd, args, options = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...options });
}

/**
 * Walk every species directory under `srcRoot` (one level deep) and mirror it
 * into `dstRoot` keyed by SLUG. Slug derivation:
 *
 *   - Top-level dir (`bulbasaur/`)              → slug `bulbasaur`
 *   - Nested form dir (`arceus/bug/`)           → slug `arceus_bug`
 *   - Doubly-nested form (`minior/core/red/`)   → slug `minior_core_red`
 *
 * For each species/form dir we mirror every `.png` plus the `normal.pal` and
 * `shiny.pal` palette files (the shiny renderer downstream needs the latter).
 *
 * Palette-only nested forms (typed Arceus, typed Silvally, etc.) ship NO
 * PNGs upstream — the in-game engine palette-swaps the BASE form's sprites
 * onto the form's `normal.pal`. We replicate this here by sourcing front+back
 * from the parent slug and applying the form's `normal.pal` palette. The
 * shiny renderer then derives the 3 shiny tiers from `shiny.pal` as usual.
 *
 * @param {string} srcRoot absolute path to upstream `graphics/pokemon/`
 * @param {string} dstRoot absolute path to `assets/images/pokemon/elite-redux/`
 */
async function mirrorAllSpeciesDirs(srcRoot, dstRoot) {
  let copiedPngs = 0;
  let derivedPngs = 0;
  let copiedPals = 0;
  let dirsHandled = 0;

  /**
   * Cache of raw PNG buffers keyed by absolute upstream path. Speeds up the
   * palette-derive path: many forms share the same parent species PNG.
   * @type {Map<string, Buffer>}
   */
  const pngCache = new Map();

  /**
   * Mirror one species/form directory's contents (PNGs + .pal) and recurse
   * into any nested form dirs.
   *
   * @param {string} srcDir absolute upstream dir
   * @param {string} slug derived flattened slug
   * @param {string | null} parentSrcDir parent species's upstream dir (for palette-derive fallback)
   */
  async function handleDir(srcDir, slug, parentSrcDir) {
    dirsHandled++;
    const dstDir = join(dstRoot, slug);
    await mkdir(dstDir, { recursive: true });

    const entries = await readdir(srcDir, { withFileTypes: true });
    const ownPngs = new Set();
    const ownPals = new Set();
    /** @type {import("node:fs").Dirent[]} */
    const subDirs = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        subDirs.push(entry);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const lower = entry.name.toLowerCase();
      const srcPath = join(srcDir, entry.name);
      const dstPath = join(dstDir, entry.name);
      if (lower.endsWith(".png")) {
        await cp(srcPath, dstPath);
        ownPngs.add(entry.name);
        copiedPngs++;
      } else if (lower.endsWith(".pal")) {
        await cp(srcPath, dstPath);
        ownPals.add(entry.name);
        copiedPals++;
      }
      // Anything else (e.g. metadata .h) skipped silently.
    }

    // Palette-derive fallback: if this is a NESTED form-dir whose only assets
    // are palette files, source the parent species's view PNGs and apply this
    // form's `normal.pal` to produce the per-form base sprites. Then the
    // shiny renderer picks the same form's `shiny.pal` to derive shinies.
    if (parentSrcDir !== null && ownPals.has("normal.pal")) {
      const normalPalPath = join(srcDir, "normal.pal");
      let normalPal;
      try {
        normalPal = parseJascPal(await readFile(normalPalPath, "utf8"));
      } catch (err) {
        console.warn(
          `[er:fetch-sprites] ${slug}: normal.pal parse failed — skipping derive (${err instanceof Error ? err.message : String(err)})`,
        );
        normalPal = null;
      }
      if (normalPal) {
        for (const view of VIEW_PNGS) {
          if (ownPngs.has(view)) {
            continue; // form ships its own — keep it
          }
          const parentPngPath = join(parentSrcDir, view);
          if (!existsSync(parentPngPath)) {
            continue;
          }
          let parentBuf = pngCache.get(parentPngPath);
          if (!parentBuf) {
            try {
              parentBuf = await readFile(parentPngPath);
              pngCache.set(parentPngPath, parentBuf);
            } catch (err) {
              console.warn(
                `[er:fetch-sprites] ${slug}/${view}: parent read failed — ${err instanceof Error ? err.message : String(err)}`,
              );
              continue;
            }
          }
          // Non-indexed views (e.g. anim_front.png on some species) won't
          // palette-swap; tolerate the failure per-view.
          let derived;
          try {
            derived = swapPalette(parentBuf, normalPal);
          } catch {
            continue;
          }
          await writeFile(join(dstDir, view), derived);
          derivedPngs++;
        }
      }
    }

    // Recurse into sub-dirs (each becomes its own flattened slug).
    for (const sub of subDirs) {
      const subSrcDir = join(srcDir, sub.name);
      const subSlug = `${slug}_${sub.name}`;
      await handleDir(subSrcDir, subSlug, srcDir);
    }
  }

  const topEntries = await readdir(srcRoot, { withFileTypes: true });
  for (const ent of topEntries) {
    if (ent.isDirectory()) {
      await handleDir(join(srcRoot, ent.name), ent.name, null);
    }
  }

  return { copiedPngs, derivedPngs, copiedPals, dirsHandled };
}

async function main() {
  const force = process.argv.includes("--force");
  const skipClone = process.argv.includes("--skip-clone");

  if (existsSync(MARKER) && !force && !skipClone) {
    const since = await readFile(MARKER, "utf8");
    console.log(`[er:fetch-sprites] cache hit (fetched ${since.trim()}) — pass --force to re-clone`);
    return;
  }

  if (force && existsSync(VENDOR)) {
    console.log("[er:fetch-sprites] --force: clearing vendor cache...");
    // Cross-platform recursive removal — handles the sparse-clone repo on Windows too.
    const { rm } = await import("node:fs/promises");
    await rm(VENDOR, { recursive: true, force: true });
  }

  if (skipClone) {
    console.log("[er:fetch-sprites] --skip-clone: re-using existing vendor clone");
  } else {
    console.log(`[er:fetch-sprites] sparse-cloning ${SPRITE_REPO} (${SPARSE_PATH})...`);
    await mkdir(VENDOR, { recursive: true });

    // Sparse-checkout sequence — fetches ONLY graphics/pokemon/ from the
    // upstream ROM-hack repo. depth=1 keeps the clone small.
    run("git", ["init"], { cwd: VENDOR });
    run("git", ["remote", "add", "origin", SPRITE_REPO], { cwd: VENDOR });
    run("git", ["config", "core.sparseCheckout", "true"], { cwd: VENDOR });
    await writeFile(resolve(VENDOR, ".git/info/sparse-checkout"), `${SPARSE_PATH}\n`);
    // Try master first (current default); fall back to main if upstream ever renames.
    try {
      run("git", ["pull", "--depth=1", "origin", SPRITE_BRANCH], { cwd: VENDOR });
    } catch (err) {
      console.warn(
        `[er:fetch-sprites] branch "${SPRITE_BRANCH}" failed (${err instanceof Error ? err.message : String(err)}); trying "main"...`,
      );
      run("git", ["pull", "--depth=1", "origin", "main"], { cwd: VENDOR });
    }
  }

  // Mirror PNGs into asset dir.
  const srcGraphics = resolve(VENDOR, "graphics/pokemon");
  if (!existsSync(srcGraphics)) {
    throw new Error(`[er:fetch-sprites] expected graphics/pokemon/ in clone, not found at ${srcGraphics}`);
  }
  console.log(`[er:fetch-sprites] mirroring (top-level + nested form dirs) to ${ASSET_DIR}...`);
  const result = await mirrorAllSpeciesDirs(srcGraphics, ASSET_DIR);
  console.log(
    `[er:fetch-sprites] handled ${result.dirsHandled} dirs, copied ${result.copiedPngs} PNGs + ${result.copiedPals} palettes, derived ${result.derivedPngs} from palette-only forms`,
  );

  await writeFile(MARKER, new Date().toISOString());
  console.log("[er:fetch-sprites] done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
