/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Extracts the full in-game ability descriptions from the Elite Redux v2.65.3b
// ROM source (`src/data/text/abilities.h`) and emits
// `src/data/elite-redux/er-ability-rom-descriptions.ts` as a canonical-name →
// description map. Keyed by canonical name (lowercased, alphanumerics only) so
// it is immune to id drift and to apostrophe/spacing differences between the C
// `ABILITY_*` constants and the in-game ability names (e.g. "Angel's Wrath" ↔
// ABILITY_ANGELS_WRATH both canonicalize to "angelswrath").
//
// Run: node scripts/elite-redux/builders/ability-rom-descriptions.mjs

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "../../..");
const SRC = resolve(ROOT, "vendor/elite-redux/source/src/data/text/abilities.h");

/** Lowercase, alphanumerics-only canonical key (matches dispatcher's canonicalizeAbilityName). */
function canonical(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Builder entrypoint (compatible with build-pokerogue-data.mjs orchestrator).
 * Reads the ER ROM ability-text source directly (not the JSON dump), so the
 * `dump` argument is ignored.
 * @param {{ outDir: string }} opts
 */
export async function build({ outDir }) {
  const OUT = resolve(outDir, "er-ability-rom-descriptions.ts");
  const txt = await readFile(SRC, "utf8");

  // symbol -> description literal:  static const u8 sXxxDescription[] = _("...");
  const sym2desc = new Map();
  for (const m of txt.matchAll(/static const u8 (s\w+Description)\[\]\s*=\s*_\("((?:[^"\\]|\\.)*)"\)\s*;/g)) {
    sym2desc.set(m[1], m[2]);
  }

  // table:  [ABILITY_XXX] = sYyyDescription,
  const out = {};
  let count = 0;
  for (const m of txt.matchAll(/\[ABILITY_(\w+)\]\s*=\s*(s\w+Description)\s*,/g)) {
    const constName = m[1];
    const desc = sym2desc.get(m[2]);
    if (desc === undefined) {
      continue;
    }
    // Skip the empty/placeholder NONE slot.
    if (constName === "NONE") {
      continue;
    }
    // The C literal escapes newlines as `\n`; keep them as real newlines so the
    // detail view can render the two-line ROM layout. Other escapes (rare) pass
    // through JSON.stringify unchanged.
    const text = desc.replace(/\\n/g, "\n");
    const key = canonical(constName);
    if (!(key in out)) {
      out[key] = text;
      count++;
    }
  }

  const body = `// =============================================================================
// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Source: vendor/elite-redux/source/src/data/text/abilities.h (v2.65.3b ROM)
// Regenerate: node scripts/elite-redux/builders/ability-rom-descriptions.mjs
//
// Full in-game ability descriptions extracted from the ER ROM, keyed by
// canonical ability name (lowercased alphanumerics). Look these up at runtime
// via the same canonicalization of an ability's display name. Covers the ${count}
// abilities defined in the v2.65.3b ROM (vanilla rebalanced + customs through
// Furnace); JSON-only beta abilities beyond the ROM keep their short desc.
// =============================================================================

export const ER_ABILITY_ROM_DESCRIPTIONS: Readonly<Record<string, string>> = ${JSON.stringify(out, null, 2)};
`;

  await writeFile(OUT, body, "utf8");
  console.log(`[er:ability-rom-desc] wrote ${count} descriptions → ${OUT}`);
}

// Allow standalone invocation: node scripts/elite-redux/builders/ability-rom-descriptions.mjs
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build({ outDir: resolve(ROOT, "src/data/elite-redux") }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
