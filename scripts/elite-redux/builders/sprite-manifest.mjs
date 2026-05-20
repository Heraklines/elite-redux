/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolve } from "node:path";
import { emitModule } from "../lib/emit.mjs";

// Subset of v2.65 fields consumed by this transformer. See
// scripts/elite-redux/fixtures/README.md for the full schema.
/**
 * @typedef {Object} ErSpeciesRaw
 * @property {number} id
 * @property {string} NAME
 */

/**
 * Convert a species const (`SPECIES_FOO_BAR`) to a file-system slug.
 * @param {string} constName
 */
export function speciesConstToSlug(constName) {
  return (constName ?? "").replace(/^SPECIES_/, "").toLowerCase();
}

const SPRITE_ROOT = "assets/images/pokemon/elite-redux";

/**
 * Build the sprite-paths object for a given slug.
 * @param {string} slug
 */
export function buildSpritePaths(slug) {
  return {
    front: `${SPRITE_ROOT}/front/${slug}.png`,
    back: `${SPRITE_ROOT}/back/${slug}.png`,
    shinyFront: `${SPRITE_ROOT}/shiny/front/${slug}.png`,
    shinyBack: `${SPRITE_ROOT}/shiny/back/${slug}.png`,
    icon: `${SPRITE_ROOT}/icons/${slug}.png`,
  };
}

/**
 * Build one sprite-manifest entry from a raw species record.
 * @param {ErSpeciesRaw} raw
 */
export function buildSpriteEntry(raw) {
  if (typeof raw?.NAME !== "string") {
    throw new Error(`species id=${raw?.id}: missing NAME for sprite-slug derivation`);
  }
  const slug = speciesConstToSlug(raw.NAME);
  return {
    speciesId: raw.id,
    speciesConst: raw.NAME,
    slug,
    paths: buildSpritePaths(slug),
  };
}

/** @type {import("../lib/builder-types.mjs").BuildFn} */
export async function build({ dump, outDir, flags }) {
  const raws = /** @type {ErSpeciesRaw[]} */ (dump.species ?? []);
  const entries = raws.map(buildSpriteEntry);

  // Detect duplicate slugs — could happen if two species share NAME (shouldn't,
  // but defensive). Emit a warning if found.
  const slugCounts = new Map();
  for (const e of entries) {
    slugCounts.set(e.slug, (slugCounts.get(e.slug) ?? 0) + 1);
  }
  const dupSlugs = [...slugCounts.entries()].filter(([, c]) => c > 1);
  if (dupSlugs.length > 0) {
    const summary = dupSlugs.map(([s, c]) => `${s} x${c}`).join(", ");
    console.warn(`[er:sprites] WARNING: ${dupSlugs.length} duplicate-slug groups (${summary})`);
  }

  const body = `export interface ErSpritePaths {
  readonly front: string;
  readonly back: string;
  readonly shinyFront: string;
  readonly shinyBack: string;
  readonly icon: string;
}

export interface ErSpriteEntry {
  readonly speciesId: number;
  readonly speciesConst: string;
  readonly slug: string;
  readonly paths: ErSpritePaths;
}

export const ER_SPRITE_MANIFEST: readonly ErSpriteEntry[] = ${JSON.stringify(entries, null, 2)} as const;
`;
  if (flags.dryRun) {
    console.log(`[er:sprites] would emit ${entries.length} sprite manifest entries`);
    return;
  }
  await emitModule(resolve(outDir, "er-sprite-manifest.ts"), body);
  console.log(`[er:sprites] emitted ${entries.length} sprite manifest entries`);
}
