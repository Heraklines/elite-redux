/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Elite Redux Phase B Task B9: backfill missing front/back/shiny sprites from
 * the ForwardFeed/ER-nextdex repo.
 *
 * `pnpm run er:fetch-sprites` mirrors PNGs from upstream `Elite-Redux/eliteredux`,
 * but that repo only ships sprites for vanilla Gen1-9 species. The Phase B audit
 * shows ~778 species completely missing and ~410 partially missing — the
 * ER-custom species (`*_REDUX`, custom megas) and several Gen8/9 forms that
 * the upstream ROM-hack repo never sources.
 *
 * ForwardFeed/ER-nextdex is the community Pokédex web app for Elite Redux. It
 * mirrors a flat collection of 7K+ PNGs at `static/sprites/<SLUG>.png` with
 * four variants per species:
 *
 *   `<SLUG>.png`              base front
 *   `<SLUG>_BACK.png`         back
 *   `<SLUG>_SHINY.png`        shiny front
 *   `<SLUG>_BACK_SHINY.png`   shiny back
 *
 * The slug is the uppercased manifest slug (e.g. `ninetales_alolan` →
 * `NINETALES_ALOLAN`). Slug ordering matches ours since both pipelines flatten
 * nested form-dirs the same way.
 *
 * Strategy:
 *   1. Load the manifest (same `loadManifest` helper as the audit).
 *   2. For each entry, fetch any of the four ER-nextdex variants that aren't
 *      yet on disk. Save to `assets/images/pokemon/elite-redux/<slug>/` under
 *      the manifest-canonical names (`front.png`, `back.png`, `shiny.png`,
 *      `shiny-back.png`).
 *   3. Idempotent: existing files are NEVER overwritten — so the eliteredux
 *      PNGs that ARE present stay authoritative and the dex is a fallback.
 *   4. Rate-limit aware: 50ms inter-request delay, on 429 we sleep and retry.
 *
 * The dex does NOT ship `icon.png`, `anim_front.png`, `footprint.png`, or the
 * tier-2/tier-3 shiny variants — those gaps remain accepted Phase B carryovers.
 *
 * Cache marker: `vendor/elite-redux/sprites/.fetched-dex` records the last
 * successful run timestamp. Pass `--force` to refetch ALL variants, or
 * `--limit <n>` to cap the number of species processed (useful for debugging).
 */

import { existsSync } from "node:fs";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./audit-sprites.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ASSET_DIR = resolve(ROOT, "assets/images/pokemon/elite-redux");
const VENDOR_DIR = resolve(ROOT, "vendor/elite-redux/sprites");
const MARKER = resolve(VENDOR_DIR, ".fetched-dex");

const DEX_BASE_URL = "https://raw.githubusercontent.com/ForwardFeed/ER-nextdex/main/static/sprites";

/**
 * The four ER-nextdex variants we backfill. `srcSuffix` is appended to the
 * uppercased slug to form the upstream filename; `dstFilename` is the
 * manifest-canonical local filename.
 *
 * @type {ReadonlyArray<{ srcSuffix: string, dstFilename: string }>}
 */
const VARIANT_MAP = [
  { srcSuffix: "", dstFilename: "front.png" },
  { srcSuffix: "_BACK", dstFilename: "back.png" },
  { srcSuffix: "_SHINY", dstFilename: "shiny.png" },
  { srcSuffix: "_BACK_SHINY", dstFilename: "shiny-back.png" },
];

/** Inter-request delay in ms. Keeps us well under GitHub raw's rate limit. */
const REQUEST_DELAY_MS = 50;

/** Sanity threshold: anything under this is likely an HTML error page, not a PNG. */
const MIN_PNG_BYTES = 100;

/** On HTTP 429, sleep this long before continuing. */
const RATE_LIMIT_BACKOFF_MS = 30_000;

/** Max consecutive network errors before bailing out. */
const MAX_CONSECUTIVE_ERRORS = 10;

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch a single variant. Returns one of:
 *   - "fetched"      — wrote a new file
 *   - "exists"       — already on disk; skipped
 *   - "missing"      — 404 on upstream
 *   - "rate-limited" — 429; caller should back off
 *   - "error"        — network/other failure
 *
 * @param {string} url
 * @param {string} dstPath
 * @param {boolean} force
 * @returns {Promise<"fetched" | "exists" | "missing" | "rate-limited" | "error">}
 */
async function fetchVariant(url, dstPath, force) {
  if (!force && (await fileExists(dstPath))) {
    return "exists";
  }
  let res;
  try {
    res = await fetch(url);
  } catch {
    return "error";
  }
  if (res.status === 404) {
    return "missing";
  }
  if (res.status === 429) {
    return "rate-limited";
  }
  if (!res.ok) {
    return "error";
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_PNG_BYTES) {
    // Likely an empty/error response masquerading as 200.
    return "error";
  }
  // PNG signature is 89 50 4E 47 0D 0A 1A 0A.
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    // Not a PNG — most likely an HTML error page returned with 200.
    return "error";
  }
  await mkdir(dirname(dstPath), { recursive: true });
  await writeFile(dstPath, buf);
  return "fetched";
}

/**
 * @typedef {{ fetched: number, missing: number, errors: number, hitRateLimit: boolean }} SpeciesResult
 */

/**
 * Try to fetch all four variants for one species. Counts each variant's
 * outcome and propagates a rate-limit signal to the caller so we can back off.
 *
 * @param {string} slug
 * @param {boolean} force
 * @returns {Promise<SpeciesResult>}
 */
async function fetchSpecies(slug, force) {
  const nameUpper = slug.toUpperCase();
  const speciesDir = resolve(ASSET_DIR, slug);
  /** @type {SpeciesResult} */
  const result = { fetched: 0, missing: 0, errors: 0, hitRateLimit: false };

  for (const { srcSuffix, dstFilename } of VARIANT_MAP) {
    const url = `${DEX_BASE_URL}/${nameUpper}${srcSuffix}.png`;
    const dstPath = resolve(speciesDir, dstFilename);
    const outcome = await fetchVariant(url, dstPath, force);
    if (outcome === "fetched") {
      result.fetched++;
    } else if (outcome === "missing") {
      result.missing++;
    } else if (outcome === "error") {
      result.errors++;
    } else if (outcome === "rate-limited") {
      result.hitRateLimit = true;
      // Stop probing further variants for this species — caller will back off.
      break;
    }
    // Politely space out our HTTP calls.
    await sleep(REQUEST_DELAY_MS);
  }
  return result;
}

/**
 * Sum bytes of every PNG written to `dir` (used for end-of-run reporting).
 * Best-effort — silently ignores files we can't stat.
 *
 * @param {string} dir
 */
async function approximateNewBytes(dir) {
  // Cheap proxy: we count NEW bytes by tallying writes during the run; this
  // helper exists for the optional total-tree-size figure. Returns the size
  // of the asset tree at this moment so the caller can diff before/after.
  let total = 0;
  /** @param {string} d */
  async function walk(d) {
    let entries;
    try {
      entries = await (await import("node:fs/promises")).readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = resolve(d, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".png")) {
        try {
          const s = await stat(p);
          total += s.size;
        } catch {
          // ignore
        }
      }
    }
  }
  if (existsSync(dir)) {
    await walk(dir);
  }
  return total;
}

async function main() {
  const force = process.argv.includes("--force");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Number.POSITIVE_INFINITY;
  if (limitArg > -1 && (!Number.isFinite(limit) || limit < 1)) {
    console.error("[er:fetch-dex-sprites] --limit requires a positive integer");
    process.exit(2);
  }

  const manifest = await loadManifest();
  console.log(`[er:fetch-dex-sprites] loaded ${manifest.length} manifest entries`);

  const beforeBytes = await approximateNewBytes(ASSET_DIR);

  let processed = 0;
  let speciesWithFetch = 0;
  let totalFetched = 0;
  let totalMissing = 0;
  let totalErrors = 0;
  let totalSkipped = 0;
  let consecutiveErrors = 0;
  let rateLimited = false;

  for (const entry of manifest) {
    if (processed >= limit) {
      break;
    }

    // Fast-path: if the upstream eliteredux clone already provided front+back+
    // shiny+shiny-back, this species doesn't need the dex fallback.
    const slug = entry.slug;
    const speciesDir = resolve(ASSET_DIR, slug);
    let alreadyHaveAll = !force;
    if (alreadyHaveAll) {
      for (const { dstFilename } of VARIANT_MAP) {
        if (!(await fileExists(resolve(speciesDir, dstFilename)))) {
          alreadyHaveAll = false;
          break;
        }
      }
    }
    if (alreadyHaveAll) {
      totalSkipped += VARIANT_MAP.length;
      processed++;
      continue;
    }

    const result = await fetchSpecies(slug, force);
    if (result.fetched > 0) {
      speciesWithFetch++;
    }
    totalFetched += result.fetched;
    totalMissing += result.missing;
    totalErrors += result.errors;
    processed++;

    if (result.hitRateLimit) {
      rateLimited = true;
      console.warn(
        `[er:fetch-dex-sprites] 429 from GitHub at ${slug} — sleeping ${RATE_LIMIT_BACKOFF_MS / 1000}s and retrying...`,
      );
      await sleep(RATE_LIMIT_BACKOFF_MS);
      // Retry this species once after the backoff.
      const retry = await fetchSpecies(slug, force);
      if (retry.fetched > 0) {
        speciesWithFetch++;
      }
      totalFetched += retry.fetched;
      totalMissing += retry.missing;
      totalErrors += retry.errors;
      if (retry.hitRateLimit) {
        console.error("[er:fetch-dex-sprites] rate-limited again after backoff — aborting.");
        break;
      }
    }

    if (result.errors > 0 && result.fetched === 0) {
      consecutiveErrors++;
    } else {
      consecutiveErrors = 0;
    }
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(
        `[er:fetch-dex-sprites] aborting — ${consecutiveErrors} consecutive species with errors and no fetches.`,
      );
      break;
    }

    if (processed % 50 === 0) {
      console.log(
        `[er:fetch-dex-sprites] processed ${processed}/${manifest.length} | fetched ${totalFetched} PNGs across ${speciesWithFetch} species | missing-on-dex ${totalMissing} | errors ${totalErrors}`,
      );
    }
  }

  const afterBytes = await approximateNewBytes(ASSET_DIR);
  const growthMb = ((afterBytes - beforeBytes) / 1024 / 1024).toFixed(2);

  console.log("\n[er:fetch-dex-sprites] DONE");
  console.log(`  species processed:           ${processed}`);
  console.log(`  species with new PNGs:       ${speciesWithFetch}`);
  console.log(`  new PNGs written:            ${totalFetched}`);
  console.log(`  variants 404 on dex:         ${totalMissing}`);
  console.log(`  variants skipped (existed):  ${totalSkipped}`);
  console.log(`  network/parse errors:        ${totalErrors}`);
  console.log(`  rate-limit incidents:        ${rateLimited ? "yes (backed off and continued)" : "none"}`);
  console.log(`  asset-tree growth:           ${growthMb} MB`);

  if (totalFetched > 0) {
    await mkdir(VENDOR_DIR, { recursive: true });
    await writeFile(MARKER, `${new Date().toISOString()}\nfetched=${totalFetched}\n`);
  }
}

// Only run main() when invoked as a script (not when imported by tests).
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
