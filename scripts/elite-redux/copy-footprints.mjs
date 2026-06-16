// SPDX-FileCopyrightText: 2024-2026 Pagefault Games
// SPDX-License-Identifier: AGPL-3.0-only
//
// ER #498 - extract Pokemon FOOTPRINT sprites for the "Tracks in the Snow" quiz.
//
// Footprint art exists only for the decomp roster (Gen 1-5 canon + whatever the
// pokeemerald-expansion base shipped). It was NEVER pulled into the er-assets CDN
// (which only had front/back/icon/shiny). This script extracts the decomp PNGs into
// footprints-out/<speciesId>.png (gitignored staging) and emits the id list the quiz
// pool uses. The PNGs are then hosted on er-assets at images/footprints/<id>.png so
// they serve via the existing /images/* -> jsDelivr redirect (off-Cloudflare, no
// bandwidth-quota cost), exactly like every other sprite - NOT bundled into the app.
//
// Workflow to (re)publish:
//   1. node scripts/elite-redux/copy-footprints.mjs   (re-run if manifest/decomp change)
//   2. copy footprints-out/* into a Heraklines/er-assets checkout at images/footprints/
//   3. commit + push er-assets, then bump the SHA pin in deploy/cloudflare/_redirects
//      to the new er-assets HEAD and redeploy.
// Source of truth for slug<->id is the sprite manifest.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MANIFEST = path.join(ROOT, "src/data/elite-redux/er-sprite-manifest.ts");
const DECOMP = path.join(ROOT, "vendor/elite-redux/source/graphics/pokemon");
const OUT_DIR = path.join(ROOT, "footprints-out");
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
