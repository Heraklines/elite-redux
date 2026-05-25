#!/usr/bin/env node
// =============================================================================
// Generate Phaser-atlas JSON files for ER custom-species sprites.
//
// ER ships single-frame static PNGs at:
//   assets/images/pokemon/elite-redux/{slug}/front.png
//   assets/images/pokemon/elite-redux/{slug}/back.png
//   ...etc.
//
// Pokerogue's `load.atlas` expects a sibling .json with frame metadata.
// This script walks every ER sprite directory and emits a 1-frame atlas
// JSON for each PNG so the runtime loader can consume them without
// modifying pokerogue's sprite-loading pipeline.
//
// Uses `image-size` to detect each PNG's dimensions.
//
// Usage: node scripts/elite-redux/generate-er-sprite-atlases.mjs
// =============================================================================

import { readdirSync, existsSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ER_SPRITES_DIR = "assets/images/pokemon/elite-redux";

/** Read a PNG header to extract (width, height). PNG dimensions live at bytes 16-24. */
function pngSize(path) {
  const buf = readFileSync(path);
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    return null; // not a PNG
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function makeAtlasJson(pngPath) {
  const size = pngSize(pngPath);
  if (!size) return null;
  const filename = pngPath.split(/[/\\]/).pop();
  // Frame name format pokerogue expects: zero-padded 0001.png ... 9999.png
  // For static single-frame ER sprites, emit one frame.
  return {
    textures: [
      {
        image: filename,
        format: "RGBA8888",
        size,
        scale: 1,
        frames: [
          {
            filename: "0001.png",
            rotated: false,
            trimmed: false,
            sourceSize: size,
            spriteSourceSize: { x: 0, y: 0, w: size.width, h: size.height },
            frame: { x: 0, y: 0, w: size.width, h: size.height },
          },
        ],
      },
    ],
    meta: {
      app: "er-build/generate-er-sprite-atlases",
      version: "1.0",
    },
  };
}

function main() {
  if (!existsSync(ER_SPRITES_DIR)) {
    console.error(`Not found: ${ER_SPRITES_DIR}`);
    process.exit(1);
  }

  const slugs = readdirSync(ER_SPRITES_DIR).filter(d => {
    const p = join(ER_SPRITES_DIR, d);
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  });

  console.log(`Found ${slugs.length} ER sprite directories`);

  let written = 0;
  let skipped = 0;
  for (const slug of slugs) {
    const dir = join(ER_SPRITES_DIR, slug);
    const pngs = readdirSync(dir).filter(f => f.endsWith(".png"));
    for (const png of pngs) {
      const pngPath = join(dir, png);
      const jsonPath = pngPath.replace(/\.png$/, ".json");
      // Skip if already exists (idempotent)
      if (existsSync(jsonPath)) {
        skipped++;
        continue;
      }
      const atlas = makeAtlasJson(pngPath);
      if (!atlas) {
        continue;
      }
      writeFileSync(jsonPath, JSON.stringify(atlas, null, 2));
      written++;
    }
  }

  console.log(`Wrote ${written} atlas JSONs, skipped ${skipped} existing`);
}

main();
