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
    icon: string;
    animFront: string;
    footprint: string;
    shinyFront: string;
    shinyBack: string;
    shinyPlusFront: string;
    shinyPlusBack: string;
    shinyUltraFront: string;
    shinyUltraBack: string;
  };
};

function pathsFor(slug: string): Entry["paths"] {
  return {
    front: `assets/images/pokemon/elite-redux/${slug}/front.png`,
    back: `assets/images/pokemon/elite-redux/${slug}/back.png`,
    icon: `assets/images/pokemon/elite-redux/${slug}/icon.png`,
    animFront: `assets/images/pokemon/elite-redux/${slug}/anim_front.png`,
    footprint: `assets/images/pokemon/elite-redux/${slug}/footprint.png`,
    shinyFront: `assets/images/pokemon/elite-redux/${slug}/shiny.png`,
    shinyBack: `assets/images/pokemon/elite-redux/${slug}/shiny-back.png`,
    shinyPlusFront: `assets/images/pokemon/elite-redux/${slug}/shiny-2.png`,
    shinyPlusBack: `assets/images/pokemon/elite-redux/${slug}/shiny-back-2.png`,
    shinyUltraFront: `assets/images/pokemon/elite-redux/${slug}/shiny-3.png`,
    shinyUltraBack: `assets/images/pokemon/elite-redux/${slug}/shiny-back-3.png`,
  };
}

const SAMPLE_ENTRIES: Entry[] = [
  { speciesId: 1, speciesConst: "SPECIES_BULBASAUR", slug: "bulbasaur", paths: pathsFor("bulbasaur") },
  { speciesId: 2, speciesConst: "SPECIES_IVYSAUR", slug: "ivysaur", paths: pathsFor("ivysaur") },
];

describe("audit-sprites (pure)", () => {
  it("auditManifest counts all 11 variants when probe returns true", async () => {
    const probe = async () => true;
    const result = await auditManifest(SAMPLE_ENTRIES, probe, "/root");
    expect(result.totalExpected).toBe(22);
    expect(result.totalPresent).toBe(22);
    expect(result.missing).toEqual([]);
  });

  it("auditManifest counts every variant as missing when probe returns false", async () => {
    const probe = async () => false;
    const result = await auditManifest(SAMPLE_ENTRIES, probe, "/root");
    expect(result.totalExpected).toBe(22);
    expect(result.totalPresent).toBe(0);
    expect(result.missing.length).toBe(2);
    expect(result.missing[0].slug).toBe("bulbasaur");
    expect(result.missing[0].missingPaths.length).toBe(11);
  });

  it("auditManifest reports partial misses (e.g. shiny-only gap)", async () => {
    // Bulbasaur has only static assets (no shinies, no anim_/footprint);
    // Ivysaur has everything.
    const probe = async (absPath: string) => {
      if (absPath.includes("ivysaur")) {
        return true;
      }
      if (
        absPath.includes("bulbasaur")
        && !absPath.includes("anim_")
        && !absPath.includes("footprint")
        && !absPath.includes("shiny")
      ) {
        return true;
      }
      return false;
    };
    const result = await auditManifest(SAMPLE_ENTRIES, probe, "/root");
    expect(result.totalExpected).toBe(22);
    // Bulbasaur present: front, back, icon = 3. Ivysaur present: all 11.
    expect(result.totalPresent).toBe(14);
    expect(result.missing.length).toBe(1);
    expect(result.missing[0].slug).toBe("bulbasaur");
    expect(result.missing[0].missingPaths).toEqual([
      "assets/images/pokemon/elite-redux/bulbasaur/anim_front.png",
      "assets/images/pokemon/elite-redux/bulbasaur/footprint.png",
      "assets/images/pokemon/elite-redux/bulbasaur/shiny.png",
      "assets/images/pokemon/elite-redux/bulbasaur/shiny-back.png",
      "assets/images/pokemon/elite-redux/bulbasaur/shiny-2.png",
      "assets/images/pokemon/elite-redux/bulbasaur/shiny-back-2.png",
      "assets/images/pokemon/elite-redux/bulbasaur/shiny-3.png",
      "assets/images/pokemon/elite-redux/bulbasaur/shiny-back-3.png",
    ]);
  });

  it("renderReport renders summary, completely-missing, and partially-missing sections", () => {
    const result = {
      totalExpected: 22,
      totalPresent: 3,
      missing: [
        {
          slug: "bulbasaur",
          speciesConst: "SPECIES_BULBASAUR",
          speciesId: 1,
          missingPaths: [
            "assets/images/pokemon/elite-redux/bulbasaur/anim_front.png",
            "assets/images/pokemon/elite-redux/bulbasaur/footprint.png",
          ],
        },
        {
          slug: "ivysaur",
          speciesConst: "SPECIES_IVYSAUR",
          speciesId: 2,
          missingPaths: [
            "assets/images/pokemon/elite-redux/ivysaur/front.png",
            "assets/images/pokemon/elite-redux/ivysaur/back.png",
            "assets/images/pokemon/elite-redux/ivysaur/icon.png",
            "assets/images/pokemon/elite-redux/ivysaur/anim_front.png",
            "assets/images/pokemon/elite-redux/ivysaur/footprint.png",
            "assets/images/pokemon/elite-redux/ivysaur/shiny.png",
            "assets/images/pokemon/elite-redux/ivysaur/shiny-back.png",
            "assets/images/pokemon/elite-redux/ivysaur/shiny-2.png",
            "assets/images/pokemon/elite-redux/ivysaur/shiny-back-2.png",
            "assets/images/pokemon/elite-redux/ivysaur/shiny-3.png",
            "assets/images/pokemon/elite-redux/ivysaur/shiny-back-3.png",
          ],
        },
      ],
    };
    const body = renderReport(result);
    expect(body).toContain("Total sprites expected: **22**");
    expect(body).toContain("Sprites present: **3** (13.64%)");
    expect(body).toContain("Species missing all 11 variants: **1**");
    expect(body).toContain("Species partially missing: **1**");
    expect(body).toContain("## Completely Missing (1 species)");
    expect(body).toContain("## Partially Missing (1 species)");
    expect(body).toContain("`ivysaur`");
    expect(body).toContain("`bulbasaur`");
    expect(body).toContain("## Accepted Gaps");
    // Shinies are no longer an accepted gap — they're generated by er:render-shinies.
    expect(body).toContain("Shiny variants (generated from palette files)");
    expect(body).toContain("er:render-shinies");
  });

  it("renderReport handles a fully-clean audit without listing sections", () => {
    const result = { totalExpected: 22, totalPresent: 22, missing: [] };
    const body = renderReport(result);
    expect(body).toContain("Sprites present: **22** (100.00%)");
    expect(body).not.toContain("## Completely Missing");
    expect(body).not.toContain("## Partially Missing");
  });
});

describe.skipIf(!existsSync(MANIFEST_PATH))("audit-sprites — manifest parser", () => {
  it("loadManifest extracts 1906 entries from the emitted manifest", async () => {
    const entries = await loadManifest(MANIFEST_PATH);
    expect(entries.length).toBe(1906);
    expect(entries[0].speciesConst).toBe("SPECIES_BULBASAUR");
    expect(entries[0].paths.front).toContain("bulbasaur/front.png");
    expect(entries[0].paths.shinyFront).toContain("bulbasaur/shiny.png");
    expect(entries[0].paths.shinyPlusFront).toContain("bulbasaur/shiny-2.png");
    expect(entries[0].paths.shinyUltraFront).toContain("bulbasaur/shiny-3.png");
  });
});
