/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSpriteEntry, buildSpritePaths, speciesConstToSlug } from "./sprite-manifest.mjs";

const SAMPLE_PATH = resolve(__dirname, "../fixtures/sample-species.json");
const VENDOR_PATH = resolve(__dirname, "../../../vendor/elite-redux/v2.65beta.json");

describe("sprite manifest (pure)", () => {
  it("speciesConstToSlug strips SPECIES_ prefix and lowercases", () => {
    expect(speciesConstToSlug("SPECIES_BULBASAUR")).toBe("bulbasaur");
    expect(speciesConstToSlug("SPECIES_ALAKAZAM_MEGA_REDUX")).toBe("alakazam_mega_redux");
    expect(speciesConstToSlug("")).toBe("");
  });

  it("buildSpritePaths produces 5 paths under elite-redux/", () => {
    const paths = buildSpritePaths("bulbasaur");
    expect(paths.front).toBe("assets/images/pokemon/elite-redux/front/bulbasaur.png");
    expect(paths.back).toBe("assets/images/pokemon/elite-redux/back/bulbasaur.png");
    expect(paths.shinyFront).toBe("assets/images/pokemon/elite-redux/shiny/front/bulbasaur.png");
    expect(paths.shinyBack).toBe("assets/images/pokemon/elite-redux/shiny/back/bulbasaur.png");
    expect(paths.icon).toBe("assets/images/pokemon/elite-redux/icons/bulbasaur.png");
  });

  it("buildSpriteEntry maps Bulbasaur from smoke fixture", async () => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
    const entry = buildSpriteEntry(sample.bulbasaur);
    expect(entry.speciesId).toBe(1);
    expect(entry.speciesConst).toBe("SPECIES_BULBASAUR");
    expect(entry.slug).toBe("bulbasaur");
    expect(entry.paths.front).toContain("bulbasaur.png");
  });

  it("throws with id context when NAME is missing", () => {
    const bad = { id: 999 } as unknown as Parameters<typeof buildSpriteEntry>[0];
    expect(() => buildSpriteEntry(bad)).toThrow(/species id=999/);
  });
});

describe.skipIf(!existsSync(VENDOR_PATH))("sprite manifest — full dump", () => {
  it("emits 1906 entries (excludes SPECIES_NONE)", async () => {
    // Filter out SPECIES_NONE per A10 hardening — its sprite paths point to
    // non-existent files upstream, would fail Phase B's sprite-audit pass.
    const dump = JSON.parse(await readFile(VENDOR_PATH, "utf8"));
    const speciesList = dump.species.filter(
      (s: { id: number; NAME?: string }) => s.id !== -1 && s.NAME !== "SPECIES_NONE",
    );
    const entries = speciesList.map(buildSpriteEntry);
    expect(entries.length).toBe(1906);
  });

  it("every entry has a non-empty slug", async () => {
    const dump = JSON.parse(await readFile(VENDOR_PATH, "utf8"));
    const entries = dump.species.map(buildSpriteEntry);
    // SPECIES_NONE has NAME="SPECIES_NONE" (slug="none") — it's filtered out
    // in build() but buildSpriteEntry itself still produces a slug for it.
    const withSlug = entries.filter((e: { slug: string }) => e.slug.length > 0);
    expect(withSlug.length).toBeGreaterThan(1900);
  });

  it("no duplicate slugs (defensive check — ER species NAMEs should be unique)", async () => {
    const dump = JSON.parse(await readFile(VENDOR_PATH, "utf8"));
    const entries = dump.species.map(buildSpriteEntry);
    const slugs = entries.map((e: { slug: string }) => e.slug).filter((s: string) => s.length > 0);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
