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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const VENDOR = resolve(ROOT, "vendor/elite-redux/sprites");
const ASSET_DIR = resolve(ROOT, "assets/images/pokemon/elite-redux");
const MARKER = resolve(VENDOR, ".fetched");

// Public sprite repo. NOT the same as the ER-nextdex JSON data repo.
const SPRITE_REPO = "https://github.com/Elite-Redux/eliteredux.git";
const SPRITE_BRANCH = "master"; // default branch confirmed via GitHub API (2026-05)
const SPARSE_PATH = "graphics/pokemon/";

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
 * Recursively mirror all .png files from src to dst, preserving directory structure.
 * @param {string} src
 * @param {string} dst
 */
async function mirrorPngs(src, dst) {
  let copiedCount = 0;
  let skippedCount = 0;
  /**
   * @param {string} s
   * @param {string} d
   */
  async function walk(s, d) {
    const entries = await readdir(s, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(s, entry.name);
      const dstPath = join(d, entry.name);
      if (entry.isDirectory()) {
        await mkdir(dstPath, { recursive: true });
        await walk(srcPath, dstPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
        await cp(srcPath, dstPath);
        copiedCount++;
      } else {
        skippedCount++;
      }
    }
  }
  await mkdir(dst, { recursive: true });
  await walk(src, dst);
  return { copiedCount, skippedCount };
}

async function main() {
  const force = process.argv.includes("--force");

  if (existsSync(MARKER) && !force) {
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

  // Mirror PNGs into asset dir.
  const srcGraphics = resolve(VENDOR, "graphics/pokemon");
  if (!existsSync(srcGraphics)) {
    throw new Error(`[er:fetch-sprites] expected graphics/pokemon/ in clone, not found at ${srcGraphics}`);
  }
  console.log(`[er:fetch-sprites] mirroring PNGs to ${ASSET_DIR}...`);
  const result = await mirrorPngs(srcGraphics, ASSET_DIR);
  console.log(`[er:fetch-sprites] copied ${result.copiedCount} PNGs (skipped ${result.skippedCount} non-PNG files)`);

  await writeFile(MARKER, new Date().toISOString());
  console.log("[er:fetch-sprites] done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
