/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Fetch the non-combat asset categories from upstream Elite-Redux/eliteredux:
 *   - graphics/items/           item icons (held items, mega stones, key items, berries, ...)
 *   - graphics/trainers/        trainer portraits (front + back sprites)
 *   - graphics/interface/       generic menu chrome (bag, party menu, money icon, ...)
 *   - graphics/battle_interface/ in-battle UI (HP bars, status icons, ...)
 *   - graphics/types/           type chips (fire.png, water.png, ...)
 *   - graphics/pokemon_storage/ PC box wallpapers + storage UI
 *
 * Shares the vendor clone with fetch-sprites.mjs by appending to the existing
 * sparse-checkout patterns. Idempotent — pass --force to re-sync.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const VENDOR = resolve(ROOT, "vendor/elite-redux/sprites");
const ASSET_ROOT = resolve(ROOT, "assets/images/elite-redux");
const MARKER = resolve(VENDOR, ".fetched-non-combat");

// Public sprite repo — same upstream we already use for combat sprites.
const SPRITE_REPO = "https://github.com/Elite-Redux/eliteredux.git";
const SPRITE_BRANCH = "master";

/**
 * Asset categories we mirror locally. Each entry maps a sparse-checkout pattern
 * onto a sub-dir of assets/images/elite-redux/. Keep these in sync with the
 * `CATEGORIES` constant in audit-non-combat-assets.mjs.
 *
 * @type {ReadonlyArray<{ sparse: string, src: string, dst: string }>}
 */
const CATEGORIES = [
  { sparse: "graphics/items/", src: "graphics/items", dst: "items" },
  { sparse: "graphics/trainers/", src: "graphics/trainers", dst: "trainers" },
  { sparse: "graphics/interface/", src: "graphics/interface", dst: "interface" },
  { sparse: "graphics/battle_interface/", src: "graphics/battle_interface", dst: "battle_interface" },
  { sparse: "graphics/types/", src: "graphics/types", dst: "types" },
  { sparse: "graphics/pokemon_storage/", src: "graphics/pokemon_storage", dst: "pokemon_storage" },
];

// Existing pattern from fetch-sprites.mjs — keep it so the combat clone stays usable.
const POKEMON_SPARSE_PATH = "graphics/pokemon/";

/**
 * Run a command, inheriting stdio. Throws on non-zero exit.
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

/**
 * Ensure the vendor clone exists and has the sparse-checkout patterns we need.
 * Re-uses the clone produced by fetch-sprites.mjs if present.
 */
async function ensureCloneWithPatterns() {
  const sparseConfigPath = resolve(VENDOR, ".git/info/sparse-checkout");

  if (!existsSync(VENDOR) || !existsSync(resolve(VENDOR, ".git"))) {
    console.log(`[er:fetch-non-combat-assets] no existing clone — initializing ${VENDOR}`);
    await mkdir(VENDOR, { recursive: true });
    run("git", ["init"], { cwd: VENDOR });
    run("git", ["remote", "add", "origin", SPRITE_REPO], { cwd: VENDOR });
    run("git", ["config", "core.sparseCheckout", "true"], { cwd: VENDOR });
  }

  // Build the full sparse-checkout pattern set: combat sprites + non-combat categories.
  const patterns = [POKEMON_SPARSE_PATH, ...CATEGORIES.map(c => c.sparse)];
  await writeFile(sparseConfigPath, `${patterns.join("\n")}\n`);

  console.log("[er:fetch-non-combat-assets] sparse-checkout patterns:");
  for (const p of patterns) {
    console.log(`  - ${p}`);
  }

  // Pull. Fall back to "main" if "master" is gone (defensive — same as fetch-sprites).
  try {
    run("git", ["pull", "--depth=1", "origin", SPRITE_BRANCH], { cwd: VENDOR });
  } catch (err) {
    console.warn(
      `[er:fetch-non-combat-assets] branch "${SPRITE_BRANCH}" failed (${err instanceof Error ? err.message : String(err)}); trying "main"...`,
    );
    run("git", ["pull", "--depth=1", "origin", "main"], { cwd: VENDOR });
  }

  // Force git to re-apply the new sparse patterns to the working tree —
  // `git pull` only respects sparse-checkout on the initial checkout, not on
  // subsequent runs when the pattern set widens.
  run("git", ["read-tree", "-mu", "HEAD"], { cwd: VENDOR });
}

async function main() {
  const force = process.argv.includes("--force");

  if (existsSync(MARKER) && !force) {
    const since = await readFile(MARKER, "utf8");
    console.log(`[er:fetch-non-combat-assets] cache hit (fetched ${since.trim()}) — pass --force to re-sync`);
    return;
  }

  await ensureCloneWithPatterns();

  // Mirror each category's PNGs to its destination under assets/images/elite-redux/.
  /** @type {Array<{ category: string, copiedCount: number, skippedCount: number }>} */
  const summary = [];
  for (const cat of CATEGORIES) {
    const srcDir = resolve(VENDOR, cat.src);
    const dstDir = resolve(ASSET_ROOT, cat.dst);
    if (!existsSync(srcDir)) {
      console.warn(`[er:fetch-non-combat-assets] expected ${cat.src} in clone — not found, skipping ${cat.dst}`);
      summary.push({ category: cat.dst, copiedCount: 0, skippedCount: 0 });
      continue;
    }
    console.log(`[er:fetch-non-combat-assets] mirroring ${cat.src} → assets/images/elite-redux/${cat.dst}/...`);
    const result = await mirrorPngs(srcDir, dstDir);
    summary.push({ category: cat.dst, ...result });
    console.log(
      `[er:fetch-non-combat-assets]   ${result.copiedCount} PNGs copied (${result.skippedCount} non-PNG skipped)`,
    );
  }

  console.log("\n[er:fetch-non-combat-assets] summary:");
  for (const s of summary) {
    console.log(`  ${s.category.padEnd(20)} ${String(s.copiedCount).padStart(5)} PNGs`);
  }
  const totalCopied = summary.reduce((a, b) => a + b.copiedCount, 0);
  console.log(`  ${"TOTAL".padEnd(20)} ${String(totalCopied).padStart(5)} PNGs`);

  await writeFile(MARKER, new Date().toISOString());
  console.log("[er:fetch-non-combat-assets] done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
