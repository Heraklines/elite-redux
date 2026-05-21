/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Audit the non-combat asset trees mirrored by fetch-non-combat-assets.mjs:
 *
 *   - Walks each category dir under assets/images/elite-redux/
 *   - Counts PNG files (recursively) and totals disk usage
 *   - Spot-checks a handful of well-known assets per category (mega stones,
 *     famous trainers, type chips) to catch silently-empty categories
 *   - Enforces minimum coverage thresholds — exit non-zero if anything is
 *     suspiciously sparse, so CI can catch broken fetches
 *
 * Usage:
 *   pnpm run er:audit-non-combat-assets
 */

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ASSET_ROOT = resolve(ROOT, "assets/images/elite-redux");

/**
 * @typedef {object} CategorySpec
 * @property {string} dir       Sub-dir under assets/images/elite-redux/
 * @property {number} minPngs   Minimum acceptable PNG count (exits non-zero if below)
 * @property {string[]} probes  Relative paths (under `dir`) that MUST exist — spot checks
 *                              prove the mirror landed real content, not just empty subdirs
 */

/** @type {ReadonlyArray<CategorySpec>} */
const CATEGORIES = [
  {
    dir: "items",
    minPngs: 100,
    probes: [
      // Mega stones — distinctive ER content.
      "icons/venusaurite.png",
      "icons/charizardite_x.png",
      // Held items.
      "icons/leftovers.png",
      "icons/choice_band.png",
      // Berries.
      "icons/oran_berry.png",
    ],
  },
  {
    dir: "trainers",
    minPngs: 50,
    probes: [
      // Trainer fronts (subdir per slot).
      "front_pics",
      "back_pics",
    ],
  },
  {
    dir: "interface",
    minPngs: 20,
    probes: ["money.png", "hpbar_anim.png"],
  },
  {
    dir: "battle_interface",
    minPngs: 20,
    probes: [],
  },
  {
    dir: "types",
    minPngs: 15,
    probes: ["fire.png", "water.png", "grass.png", "electric.png", "fairy.png"],
  },
  {
    dir: "pokemon_storage",
    minPngs: 5,
    probes: ["wallpapers"],
  },
];

/**
 * Recursively count PNG files and sum their bytes under `dir`.
 * @param {string} dir
 * @returns {Promise<{ pngCount: number, bytes: number }>}
 */
async function walkCategory(dir) {
  let pngCount = 0;
  let bytes = 0;
  /** @param {string} d */
  async function walk(d) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
        pngCount++;
        const st = await stat(p);
        bytes += st.size;
      }
    }
  }
  if (existsSync(dir)) {
    await walk(dir);
  }
  return { pngCount, bytes };
}

/**
 * Probe spot-check paths. A probe target may be a file or a directory —
 * directories pass if they exist AND contain at least one PNG (recursively).
 * @param {string} categoryDir
 * @param {readonly string[]} probes
 */
async function runProbes(categoryDir, probes) {
  /** @type {Array<{ probe: string, status: "ok" | "missing" | "empty" }>} */
  const results = [];
  for (const probe of probes) {
    const abs = resolve(categoryDir, probe);
    if (!existsSync(abs)) {
      results.push({ probe, status: "missing" });
      continue;
    }
    const st = await stat(abs);
    if (st.isFile()) {
      results.push({ probe, status: "ok" });
    } else if (st.isDirectory()) {
      const { pngCount } = await walkCategory(abs);
      results.push({ probe, status: pngCount > 0 ? "ok" : "empty" });
    } else {
      results.push({ probe, status: "missing" });
    }
  }
  return results;
}

/** @param {number} bytes */
function humanBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

async function main() {
  if (!existsSync(ASSET_ROOT)) {
    console.error(`[er:audit-non-combat-assets] asset root missing: ${ASSET_ROOT}`);
    console.error("[er:audit-non-combat-assets] run `pnpm run er:fetch-non-combat-assets` first.");
    process.exit(2);
  }

  console.log(`[er:audit-non-combat-assets] auditing ${ASSET_ROOT}\n`);

  let totalPngs = 0;
  let totalBytes = 0;
  let failures = 0;

  // Per-category report.
  console.log("Category".padEnd(20) + "PNGs".padStart(8) + "Size".padStart(14) + "  Probes");
  console.log("-".repeat(60));

  for (const cat of CATEGORIES) {
    const dir = resolve(ASSET_ROOT, cat.dir);
    const { pngCount, bytes } = await walkCategory(dir);
    totalPngs += pngCount;
    totalBytes += bytes;

    const probes = await runProbes(dir, cat.probes);
    const failedProbes = probes.filter(p => p.status !== "ok");
    const meetsMin = pngCount >= cat.minPngs;
    const status = meetsMin && failedProbes.length === 0 ? "ok" : "FAIL";
    if (status === "FAIL") {
      failures++;
    }

    const probesSummary = probes.length === 0 ? "—" : `${probes.length - failedProbes.length}/${probes.length}`;
    console.log(
      `${cat.dir.padEnd(20)}${String(pngCount).padStart(8)}${humanBytes(bytes).padStart(14)}  ${probesSummary.padEnd(8)} [${status}]`,
    );

    if (!meetsMin) {
      console.warn(`  ! ${cat.dir}: ${pngCount} PNGs is below the floor of ${cat.minPngs}`);
    }
    for (const fp of failedProbes) {
      console.warn(`  ! ${cat.dir}: probe ${fp.probe} → ${fp.status}`);
    }
  }

  console.log("-".repeat(60));
  console.log(`${"TOTAL".padEnd(20)}${String(totalPngs).padStart(8)}${humanBytes(totalBytes).padStart(14)}\n`);

  if (failures === 0) {
    console.log("[er:audit-non-combat-assets] All categories pass.");
    process.exit(0);
  }
  console.error(`[er:audit-non-combat-assets] ${failures} category/categories failed audit.`);
  process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(3);
});
