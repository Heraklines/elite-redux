/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { auditManifest, loadManifest, renderReport } from "./audit-sprites.mjs";

const MANIFEST_PATH = resolve(__dirname, "../../src/data/elite-redux/er-sprite-manifest.ts");

type Entry = {
  speciesId: number;
  speciesConst: string;
  slug: string;
  paths: {
    front: string;
    back: string;
    shinyFront: string;
    shinyBack: string;
    icon: string;
  };
};

const SAMPLE_ENTRIES: Entry[] = [
  {
    speciesId: 1,
    speciesConst: "SPECIES_BULBASAUR",
    slug: "bulbasaur",
    paths: {
      front: "assets/images/pokemon/elite-redux/front/bulbasaur.png",
      back: "assets/images/pokemon/elite-redux/back/bulbasaur.png",
      shinyFront: "assets/images/pokemon/elite-redux/shiny/front/bulbasaur.png",
      shinyBack: "assets/images/pokemon/elite-redux/shiny/back/bulbasaur.png",
      icon: "assets/images/pokemon/elite-redux/icons/bulbasaur.png",
    },
  },
  {
    speciesId: 2,
    speciesConst: "SPECIES_IVYSAUR",
    slug: "ivysaur",
    paths: {
      front: "assets/images/pokemon/elite-redux/front/ivysaur.png",
      back: "assets/images/pokemon/elite-redux/back/ivysaur.png",
      shinyFront: "assets/images/pokemon/elite-redux/shiny/front/ivysaur.png",
      shinyBack: "assets/images/pokemon/elite-redux/shiny/back/ivysaur.png",
      icon: "assets/images/pokemon/elite-redux/icons/ivysaur.png",
    },
  },
];

describe("audit-sprites (pure)", () => {
  it("auditManifest counts all 5 variants when probe returns true", async () => {
    const probe = async () => true;
    const result = await auditManifest(SAMPLE_ENTRIES, probe, "/root");
    expect(result.totalExpected).toBe(10);
    expect(result.totalPresent).toBe(10);
    expect(result.missing).toEqual([]);
  });

  it("auditManifest counts every variant as missing when probe returns false", async () => {
    const probe = async () => false;
    const result = await auditManifest(SAMPLE_ENTRIES, probe, "/root");
    expect(result.totalExpected).toBe(10);
    expect(result.totalPresent).toBe(0);
    expect(result.missing.length).toBe(2);
    expect(result.missing[0].slug).toBe("bulbasaur");
    expect(result.missing[0].missingPaths.length).toBe(5);
  });

  it("auditManifest reports partial misses (e.g. shiny-only gap)", async () => {
    // Bulbasaur has only non-shiny assets; Ivysaur has everything.
    const probe = async (absPath: string) => {
      if (absPath.includes("ivysaur")) {
        return true;
      }
      if (absPath.includes("bulbasaur") && !absPath.includes("shiny")) {
        return true;
      }
      return false;
    };
    const result = await auditManifest(SAMPLE_ENTRIES, probe, "/root");
    expect(result.totalExpected).toBe(10);
    expect(result.totalPresent).toBe(8);
    expect(result.missing.length).toBe(1);
    expect(result.missing[0].slug).toBe("bulbasaur");
    expect(result.missing[0].missingPaths).toEqual([
      "assets/images/pokemon/elite-redux/shiny/front/bulbasaur.png",
      "assets/images/pokemon/elite-redux/shiny/back/bulbasaur.png",
    ]);
  });

  it("renderReport renders summary, completely-missing, and partially-missing sections", () => {
    const result = {
      totalExpected: 10,
      totalPresent: 3,
      missing: [
        {
          slug: "bulbasaur",
          speciesConst: "SPECIES_BULBASAUR",
          speciesId: 1,
          missingPaths: [
            "assets/images/pokemon/elite-redux/shiny/front/bulbasaur.png",
            "assets/images/pokemon/elite-redux/shiny/back/bulbasaur.png",
          ],
        },
        {
          slug: "ivysaur",
          speciesConst: "SPECIES_IVYSAUR",
          speciesId: 2,
          missingPaths: [
            "assets/images/pokemon/elite-redux/front/ivysaur.png",
            "assets/images/pokemon/elite-redux/back/ivysaur.png",
            "assets/images/pokemon/elite-redux/shiny/front/ivysaur.png",
            "assets/images/pokemon/elite-redux/shiny/back/ivysaur.png",
            "assets/images/pokemon/elite-redux/icons/ivysaur.png",
          ],
        },
      ],
    };
    const body = renderReport(result);
    expect(body).toContain("Total sprites expected: **10**");
    expect(body).toContain("Sprites present: **3** (30.00%)");
    expect(body).toContain("Species missing all 5 variants: **1**");
    expect(body).toContain("Species partially missing: **1**");
    expect(body).toContain("## Completely Missing (1 species)");
    expect(body).toContain("## Partially Missing (1 species)");
    expect(body).toContain("`ivysaur`");
    expect(body).toContain("`bulbasaur`");
    expect(body).toContain("## Accepted Gaps");
    expect(body).toContain("Path-layout mismatch");
    expect(body).toContain("No shiny PNGs upstream");
  });

  it("renderReport handles a fully-clean audit without listing sections", () => {
    const result = { totalExpected: 10, totalPresent: 10, missing: [] };
    const body = renderReport(result);
    expect(body).toContain("Sprites present: **10** (100.00%)");
    expect(body).not.toContain("## Completely Missing");
    expect(body).not.toContain("## Partially Missing");
  });
});

describe.skipIf(!existsSync(MANIFEST_PATH))("audit-sprites — manifest parser", () => {
  it("loadManifest extracts 1906 entries from the emitted manifest", async () => {
    const entries = await loadManifest(MANIFEST_PATH);
    expect(entries.length).toBe(1906);
    expect(entries[0].speciesConst).toBe("SPECIES_BULBASAUR");
    expect(entries[0].paths.front).toContain("bulbasaur.png");
  });
});
