/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Extracts the FULL in-game ability descriptions (the expanded "Detail" text)
// straight from the Elite Redux v2.65.3b ROM binary
// (vendor/elite-redux/rom-extracted/er-v2.65.3b.gba).
//
// The ROM holds a `gAbilitiesInfo`-style struct array (stride 196 bytes); within
// each struct the ability NAME pointer is at offset 140 and the detailed-
// description pointer at offset 148. We auto-locate the array (longest run of
// stride-196 name pointers), then read name + detailed text per entry, decoding
// the GBA charmap (vendor/.../source/charmap.txt). Output is keyed by canonical
// ability name (lowercased alphanumerics) so runtime lookup is id-drift-proof.
//
// Run: node scripts/elite-redux/builders/ability-rom-descriptions.mjs

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "../../..");
const ROM = resolve(ROOT, "vendor/elite-redux/rom-extracted/er-v2.65.3b.gba");
const CHARMAP = resolve(ROOT, "vendor/elite-redux/source/charmap.txt");

const GBA_BASE = 0x08000000;
const STRIDE = 196; // sizeof(struct) in the ability-info array
const NAME_OFF = 140; // name pointer field offset within the struct
const DETAIL_OFF = 148; // detailed-description pointer field offset
const NEWLINE = new Set([0xfe, 0xfb, 0xfa]); // \n, \l (scroll), \p (paragraph)
const TERM = 0xff;

function canonical(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function loadCharmap() {
  const txt = await readFile(CHARMAP, "utf8");
  const cm = new Map(); // first mapping wins (Latin section precedes the Japanese one)
  for (const line of txt.split("\n")) {
    const m = line.match(/^'(.|\\')'\s*=\s*([0-9A-Fa-f]{2})\s*$/);
    if (m) {
      const ch = m[1] === "\\'" ? "'" : m[1];
      const b = Number.parseInt(m[2], 16);
      if (!cm.has(b)) {
        cm.set(b, ch);
      }
    }
  }
  return cm;
}

/** Decode a GBA-charmap string at `off`; returns null on a non-text byte. */
function decode(rom, cm, off, maxLen = 600) {
  const out = [];
  for (let i = off; i < rom.length && i <= off + maxLen; i++) {
    const b = rom[i];
    if (b === TERM) {
      return out.join("");
    }
    if (NEWLINE.has(b)) {
      out.push(" "); // join the ROM's wrapped lines into flowing text
      continue;
    }
    const ch = cm.get(b);
    if (ch === undefined) {
      return null;
    }
    out.push(ch);
  }
  return null;
}

function readPtr(rom, pos) {
  if (pos + 4 > rom.length) {
    return null;
  }
  const v = rom.readUInt32LE(pos);
  return v >= GBA_BASE && v < GBA_BASE + rom.length ? v : null;
}

/** A valid ability NAME: short, Title-case, decodable. */
function nameAt(rom, cm, structBase) {
  const p = readPtr(rom, structBase + NAME_OFF);
  if (p === null) {
    return null;
  }
  const s = decode(rom, cm, p - GBA_BASE, 40);
  if (s && s.length > 0 && s.length <= 40 && s[0] >= "A" && s[0] <= "Z") {
    return s;
  }
  return null;
}

/** Auto-locate the ability-info struct array: the longest stride-196 run of valid name pointers. */
function findArray(rom, cm) {
  // Candidate "name field" positions: 4-aligned words that point to a short Title string.
  const isName = new Uint8Array(Math.floor(rom.length / 4));
  for (let p = 0; p + 4 <= rom.length; p += 4) {
    const b3 = rom[p + 3];
    if ((b3 === 0x08 || b3 === 0x09) && nameAt(rom, cm, p - NAME_OFF) !== null) {
      isName[p >> 2] = 1;
    }
  }
  // Longest run of name-field words spaced exactly STRIDE apart.
  let best = { base: 0, count: 0 };
  for (let p = 0; p + 4 <= rom.length; p += 4) {
    if (!isName[p >> 2]) {
      continue;
    }
    let count = 1;
    let q = p + STRIDE;
    while (q + 4 <= rom.length && isName[q >> 2]) {
      count++;
      q += STRIDE;
    }
    if (count > best.count) {
      best = { base: p - NAME_OFF, count };
    }
  }
  return best;
}

async function build({ outDir }) {
  const OUT = resolve(outDir, "er-ability-rom-descriptions.ts");
  const rom = await readFile(ROM);
  const cm = await loadCharmap();

  const { base, count } = findArray(rom, cm);
  if (count < 200) {
    throw new Error(`[er:ability-rom-desc] ability-info array not found (best run ${count})`);
  }

  const out = {};
  let withDetail = 0;
  for (let i = 0; i < count; i++) {
    const structBase = base + i * STRIDE;
    const name = nameAt(rom, cm, structBase);
    if (!name || name === "-------") {
      continue;
    }
    const dp = readPtr(rom, structBase + DETAIL_OFF);
    const detail = dp === null ? null : decode(rom, cm, dp - GBA_BASE);
    const text = detail?.trim();
    if (text && text.length >= 5) {
      const key = canonical(name);
      if (!(key in out)) {
        out[key] = text;
        withDetail++;
      }
    }
  }

  const body = `// =============================================================================
// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Source: vendor/elite-redux/rom-extracted/er-v2.65.3b.gba (gAbilitiesInfo struct array)
// Regenerate: node scripts/elite-redux/builders/ability-rom-descriptions.mjs
//
// The FULL expanded in-game ability descriptions (the "Detail" view text),
// extracted directly from the ROM binary and keyed by canonical ability name
// (lowercased alphanumerics). Look up at runtime via the same canonicalization
// of an ability's display name. ${withDetail} abilities covered.
// =============================================================================

export const ER_ABILITY_ROM_DESCRIPTIONS: Readonly<Record<string, string>> = ${JSON.stringify(out, null, 2)};
`;
  await writeFile(OUT, body, "utf8");
  console.log(`[er:ability-rom-desc] wrote ${withDetail} detailed descriptions → ${OUT}`);
}

export { build };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build({ outDir: resolve(ROOT, "src/data/elite-redux") }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
