// SPDX-FileCopyrightText: 2024-2026 Pagefault Games
// SPDX-License-Identifier: AGPL-3.0-only
//
// ER #498 - bundle Pokemon FOOTPRINT sprites for the "Tracks in the Snow" quiz.
//
// Footprint art exists only for the decomp roster (Gen 1-5 canon + whatever the
// pokeemerald-expansion base shipped); it was NEVER pulled into the er-assets CDN
// (which only has front/back/icon/shiny), and the deployed site redirects ALL of
// /images/* to that CDN - so footprints can't live under /images/. Instead we copy
// the decomp PNGs into public/footprints/<speciesId>.png (a path no redirect rule
// touches, served straight from the build) and emit the id list the quiz pool uses.
//
// Run: node scripts/elite-redux/copy-footprints.mjs   (re-run if the manifest or the
// decomp graphics change). Source of truth for slug<->id is the sprite manifest.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MANIFEST = path.join(ROOT, "src/data/elite-redux/er-sprite-manifest.ts");
const DECOMP = path.join(ROOT, "vendor/elite-redux/source/graphics/pokemon");
const OUT_DIR = path.join(ROOT, "public/footprints");
const ID_LIST = path.join(ROOT, "src/data/elite-redux/er-footprint-species.json");

const manifest = fs.readFileSync(MANIFEST, "utf8");
// Each manifest object opens: "speciesId": N, "speciesConst": "...", "slug": "x"
const re = /"speciesId":\s*(\d+),\s*"speciesConst":\s*"[^"]+",\s*"slug":\s*"([^"]+)"/g;

fs.mkdirSync(OUT_DIR, { recursive: true });
// Clear stale outputs so a re-run is deterministic.
for (const f of fs.readdirSync(OUT_DIR)) {
  if (f.endsWith(".png")) {
    fs.rmSync(path.join(OUT_DIR, f));
  }
}

const ids = [];
const seen = new Set();
for (const match of manifest.matchAll(re)) {
  const id = Number(match[1]);
  const slug = match[2];
  if (seen.has(id)) {
    continue;
  }
  const src = path.join(DECOMP, slug, "footprint.png");
  if (fs.existsSync(src) && fs.statSync(src).size > 0) {
    fs.copyFileSync(src, path.join(OUT_DIR, `${id}.png`));
    ids.push(id);
    seen.add(id);
  }
}

ids.sort((a, b) => a - b);
fs.writeFileSync(ID_LIST, `${JSON.stringify(ids)}\n`);
console.log(`copied ${ids.length} footprints -> public/footprints/ + er-footprint-species.json`);
