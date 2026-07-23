/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER NEWCOMER RENDER SWEEP — the maintainer's mandatory verification gate.
//
// Standing rule (CLAUDE.md "Adding new Pokemon"): every new species AND every new
// form must render a REAL, NON-EMPTY sprite on EVERY surface it can appear on:
//   (a) SUMMARY screen        (form-level front atlas)
//   (b) STARTER SELECT        (species-level front atlas + the mini icon)
//   (c) COMBAT front AND back (form-level front + back atlas)
//   (d) DEX page              (species-level front atlas)
//   (e) SHINY variant tiers   (form-level shiny front + back, variants 0/1/2)
//
// This is a PIXEL-LEVEL gate, not a key-resolution check: for each surface it
// resolves the sprite atlas path the surface actually uses (via the real
// accessors), then decodes that atlas's first animation frame from the local
// er-assets checkout and asserts it EXISTS and is not fully transparent. So it
// fails BOTH when a surface resolves to a wrong/404 path (the #287 dex bug:
// species-level getSpriteAtlasPath returned `311-mega`/`312-mega` for Minun/Plusle,
// and the Primal Mew/Regigigas dex spritelessness) AND when the resolved art is
// empty/placeholder where real art exists.
//
// SHINY-VARIANT COVERAGE (added after the 2026-07-16 live report "no primal mew
// sprites"): the base surfaces above only exercise the NON-shiny (variant-0)
// palette. ER-custom slug art ships a SEPARATE atlas file per shiny tier
// (`shiny`/`shiny-2`/`shiny-3` and their `-back` twins) because ER customs carry NO
// vanilla `variantData` recolor - loadAssets forces spriteOnly, so a shiny mon of
// variant tier N renders `elite-redux/<slug>/shiny[-N+1][-back]` DIRECTLY. A shiny
// variant-2 (variant index 1) Primal Mew's BACK sprite requested
// `pkmn__back__er__mew_primal_shiny2` -> `elite-redux/mew_primal/shiny-back-2`,
// which was not yet published, so the player's own Primal Mew showed no back sprite
// in battle. The base-only sweep stayed green through that miss. The shiny block
// below closes the gap: it gates every shiny tier, front AND back, on the FORM-level
// path the battle field uses, for entries whose art resolves to the `elite-redux/`
// slug scheme (vanilla-aliasing partner eeveelutions recolor via vanilla variantData
// - a different, working path this file-existence gate does not model).
//
// Roster (24): the 4 newcomer species (Tentalect/Astoot/Discupid/Regitube), the 8
// partner eeveelutions (alias vanilla base art), and the 12 injected forms
// (megas/primals). This is the pass/fail gate for shipping the newcomer patch.
//
// Gated behind ER_SCENARIO=1 (boots the real init via GameManager). Needs the
// local er-assets checkout (the `../er-assets` symlink) for the pixel decode.
// =============================================================================

import { ER_NEWCOMER_FORMS } from "#data/elite-redux/er-newcomer-forms";
import {
  ER_ASTOOT_SPECIES_ID,
  ER_DISCUPID_SPECIES_ID,
  ER_DRAWCLOPS_SPECIES_ID,
  ER_DUSTNOIR_SPECIES_ID,
  ER_EGOELK_SPECIES_ID,
  ER_FORBIDDRON_SPECIES_ID,
  ER_IDOLFIN_SPECIES_ID,
  ER_NIMBEON_SPECIES_ID,
  ER_PARTNER_ESPEON_SPECIES_ID,
  ER_PARTNER_FLAREON_SPECIES_ID,
  ER_PARTNER_GLACEON_SPECIES_ID,
  ER_PARTNER_JOLTEON_SPECIES_ID,
  ER_PARTNER_LEAFEON_SPECIES_ID,
  ER_PARTNER_NIMBEON_SPECIES_ID,
  ER_PARTNER_RYUVEON_SPECIES_ID,
  ER_PARTNER_SYLVEON_SPECIES_ID,
  ER_PARTNER_TITANEON_SPECIES_ID,
  ER_PARTNER_UMBREON_SPECIES_ID,
  ER_PARTNER_VAPOREON_SPECIES_ID,
  ER_REGITUBE_SPECIES_ID,
  ER_RYUVEON_SPECIES_ID,
  ER_TENTALECT_SPECIES_ID,
  ER_TITANEON_SPECIES_ID,
  ER_TWINKLETUFF_SPECIES_ID,
  ER_WEBBED_BRUISER_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import { ErCustomSpecies } from "#data/elite-redux/init-elite-redux-custom-species";
import type { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The exact bytes the game ships (symlink -> the real er-assets checkout). */
const POKEMON_ROOT = "../er-assets/images/pokemon";

/** A resolved sprite-atlas frame's opacity, or `exists:false` if the file is absent. */
interface AtlasAnalysis {
  exists: boolean;
  transparentPct: number;
  dims: string;
  /** True when the decoded frame is a single mon frame (not the whole packed sheet). */
  spriteSized: boolean;
}

/**
 * Decode the FIRST real animation frame ("0001.png" when present, else frame 0) of
 * an atlas path (e.g. `elite-redux/mew_primal/front`, `134`, `back/134`) from the
 * local er-assets checkout and measure how transparent it is. A missing file =>
 * `exists:false` (a resolution/404 bug); >= 99% transparent => an empty sprite.
 */
async function analyzeAtlas(atlasPath: string): Promise<AtlasAnalysis> {
  const png = join(POKEMON_ROOT, `${atlasPath}.png`);
  if (!existsSync(png)) {
    return { exists: false, transparentPct: 100, dims: "0x0", spriteSized: false };
  }
  const img = await loadImage(png);
  let frame = { x: 0, y: 0, w: img.width, h: img.height };
  const jsonPath = join(POKEMON_ROOT, `${atlasPath}.json`);
  if (existsSync(jsonPath)) {
    const atlas = JSON.parse(readFileSync(jsonPath, "utf8"));
    const frames = atlas.textures?.[0]?.frames ?? atlas.frames ?? [];
    const list: Array<{ filename?: string; frame?: typeof frame }> = Array.isArray(frames)
      ? frames
      : Object.entries(frames).map(([filename, v]) => ({ filename, ...(v as object) }));
    // Prefer the first real animation frame ("0001.png"); the sheet-level entry
    // (e.g. "front.png") spans the whole packed image and is not what the game draws.
    const chosen = list.find(f => /(^|\/)0*1\.png$/.test(f.filename ?? "")) ?? list[0];
    if (chosen?.frame) {
      frame = chosen.frame;
    }
  }
  const canvas = createCanvas(frame.w, frame.h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
  const { data } = ctx.getImageData(0, 0, frame.w, frame.h);
  const total = frame.w * frame.h;
  let transparent = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      transparent++;
    }
  }
  // A SINGLE mon frame is roughly square (~64x64). A frame whose height dwarfs its
  // width is the WHOLE packed multi-frame sheet (e.g. regitube front is 64x1536,
  // 24 frames) - which is exactly what a menu surface draws when it renders the
  // atlas WITHOUT selecting frame 0001 (the #Regitube scrambled-sprite class).
  const spriteSized = frame.h <= frame.w * 4;
  return { exists: true, transparentPct: (transparent / total) * 100, dims: `${frame.w}x${frame.h}`, spriteSized };
}

/**
 * ER-custom forms still AWAITING shiny-variant art on er-assets (the maintainer owes
 * the art; art is a maintainer decision, never fabricated by a fix). Tracked here so
 * the shiny gate below does NOT silently pass them AND fails loudly when the art
 * lands (prompting removal from this quarantine so the hard gate takes over). The
 * value lists the missing atlas files under `elite-redux/<slug>/` as of 2026-07-17.
 *
 * These are the SAME "no shiny sprite" bug class as the reported Primal Mew, but
 * their art simply does not exist yet (their dirs ship base front/back/icon only) -
 * distinct from Primal Mew, whose complete shiny set the maintainer HAS published.
 */
const KNOWN_MISSING_SHINY_ART: Record<string, readonly string[]> = {
  // (empty) — the five mega slugs' generated shiny sets (parasect_mega, jumpluff_mega,
  // skarmory_mega_z, dragonite_mega_z, electivire_mega_x) landed on er-assets, so the
  // hard shiny gate below now covers them.
};

/** A form's shiny-variant atlases (tiers 0/1/2 x front/back) partitioned by health. */
interface ShinyVariantReport {
  /** Resolved ER-custom shiny atlases with no file (the 404 / no-sprite class). */
  missing: string[];
  /** Resolved ER-custom shiny atlases that exist but are empty / non-sprite frame. */
  broken: string[];
  /** True if ANY shiny tier resolved to the `elite-redux/` slug scheme. */
  sawErCustom: boolean;
}

/** Minimal shape shared by PokemonSpecies + PokemonForm for sprite-atlas resolution. */
interface AtlasResolver {
  getSpriteAtlasPath(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
}

/**
 * Analyze the FORM-level shiny atlas the battle field draws, across all 3 shiny
 * tiers (variant 0/1/2) x {front, back}. Only ER-custom slug art uses the per-tier
 * file scheme (`elite-redux/<slug>/shiny[-N][-back]`); entries that resolve elsewhere
 * (partner eeveelutions -> vanilla variantData recolor) are skipped - a different,
 * working shiny path this file-existence gate does not model.
 */
async function analyzeShinyVariants(form: AtlasResolver, formIndex: number): Promise<ShinyVariantReport> {
  const report: ShinyVariantReport = { missing: [], broken: [], sawErCustom: false };
  for (let variant = 0; variant <= 2; variant++) {
    for (const back of [false, true]) {
      const atlasPath = form.getSpriteAtlasPath(false, formIndex, true, variant, back);
      if (!atlasPath.startsWith("elite-redux/")) {
        continue;
      }
      report.sawErCustom = true;
      const surface = `combat shiny v${variant} ${back ? "back" : "front"}`;
      const a = await analyzeAtlas(atlasPath);
      if (!a.exists) {
        report.missing.push(`${surface}: resolved atlas "${atlasPath}" has NO file (wrong/404 path)`);
      } else if (a.transparentPct >= 99) {
        report.broken.push(`${surface}: atlas "${atlasPath}" (${a.dims}) is EMPTY (${a.transparentPct.toFixed(1)}%)`);
      } else if (!a.spriteSized) {
        report.broken.push(`${surface}: atlas "${atlasPath}" decoded a NON-sprite frame (${a.dims})`);
      }
    }
  }
  return report;
}

/** One roster entry to sweep. */
interface SweepEntry {
  label: string;
  speciesId: number;
  /** Resolved lazily (forms are injected at init) so mega/primal indices are live. */
  formKey?: string;
}

describe.skipIf(!RUN)("ER newcomer render sweep (non-empty sprite on every surface)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    void new GameManager(phaserGame);
  });

  const entries: SweepEntry[] = [
    // 4 hand-authored batch-1 newcomer species.
    { label: "Tentalect", speciesId: ER_TENTALECT_SPECIES_ID },
    { label: "Astoot", speciesId: ER_ASTOOT_SPECIES_ID },
    { label: "Discupid", speciesId: ER_DISCUPID_SPECIES_ID },
    { label: "Regitube", speciesId: ER_REGITUBE_SPECIES_ID },
    // 10 batch-2 newcomer species (9 evolution-only + Webbed Bruiser standalone).
    { label: "Drawclops", speciesId: ER_DRAWCLOPS_SPECIES_ID },
    { label: "Dustnoir", speciesId: ER_DUSTNOIR_SPECIES_ID },
    { label: "Nimbeon", speciesId: ER_NIMBEON_SPECIES_ID },
    { label: "Ryuveon", speciesId: ER_RYUVEON_SPECIES_ID },
    { label: "Titaneon", speciesId: ER_TITANEON_SPECIES_ID },
    { label: "Twinkletuff", speciesId: ER_TWINKLETUFF_SPECIES_ID },
    { label: "Egoelk", speciesId: ER_EGOELK_SPECIES_ID },
    { label: "Forbiddron", speciesId: ER_FORBIDDRON_SPECIES_ID },
    { label: "Idolfin", speciesId: ER_IDOLFIN_SPECIES_ID },
    { label: "Webbed Bruiser", speciesId: ER_WEBBED_BRUISER_SPECIES_ID },
    // 8 partner eeveelutions (alias vanilla base eeveelution art).
    { label: "Partner Vaporeon", speciesId: ER_PARTNER_VAPOREON_SPECIES_ID },
    { label: "Partner Jolteon", speciesId: ER_PARTNER_JOLTEON_SPECIES_ID },
    { label: "Partner Flareon", speciesId: ER_PARTNER_FLAREON_SPECIES_ID },
    { label: "Partner Espeon", speciesId: ER_PARTNER_ESPEON_SPECIES_ID },
    { label: "Partner Umbreon", speciesId: ER_PARTNER_UMBREON_SPECIES_ID },
    { label: "Partner Leafeon", speciesId: ER_PARTNER_LEAFEON_SPECIES_ID },
    { label: "Partner Glaceon", speciesId: ER_PARTNER_GLACEON_SPECIES_ID },
    { label: "Partner Sylveon", speciesId: ER_PARTNER_SYLVEON_SPECIES_ID },
    // 3 partner ALIAS eeveelutions (alias the base custom eeveelution's slug art).
    { label: "Partner Nimbeon", speciesId: ER_PARTNER_NIMBEON_SPECIES_ID },
    { label: "Partner Ryuveon", speciesId: ER_PARTNER_RYUVEON_SPECIES_ID },
    { label: "Partner Titaneon", speciesId: ER_PARTNER_TITANEON_SPECIES_ID },
    // injected forms (megas / primals / battle-bond) - keyed by baseSpecies + formKey.
    ...ER_NEWCOMER_FORMS.map(def => ({
      label: def.slug,
      speciesId: def.baseSpecies as number,
      formKey: def.formKey,
    })),
  ];

  it("sweeps every newcomer mon/form (14 species + 8 partners + 3 partner aliases + all injected forms)", () => {
    // 4 batch-1 species + 10 batch-2 species + 8 partner eeveelutions + 3 partner aliases
    // (Nimbeon/Ryuveon/Titaneon) + ER_NEWCOMER_FORMS.
    expect(entries.length).toBe(25 + ER_NEWCOMER_FORMS.length);
  });

  it.each(entries)("$label renders a non-empty sprite on every surface", async entry => {
    const species = getPokemonSpecies(entry.speciesId as SpeciesId);
    expect(species, `${entry.label}: species registered`).toBeDefined();
    const formIndex = entry.formKey ? species.forms.findIndex(f => f.formKey === entry.formKey) : 0;
    expect(formIndex, `${entry.label}: form ${entry.formKey ?? "(base)"} injected`).toBeGreaterThanOrEqual(0);

    // Each surface -> the sprite atlas path it actually resolves through.
    const form = species.forms[formIndex] ?? species;
    const surfaces: Record<string, string> = {
      // Species-level path (the #287 dex/starter bug lived here).
      "dex-page (species front)": species.getSpriteAtlasPath(false, formIndex, false, 0, false),
      "starter-select (species front)": species.getSpriteAtlasPath(false, formIndex, false, 0, false),
      // Form-level path (summary + battle field).
      "summary/combat front (form)": form.getSpriteAtlasPath(false, formIndex, false, 0, false),
      "combat back (form)": form.getSpriteAtlasPath(false, formIndex, false, 0, true),
      // Evolution scene: EvolutionPhase.configureSprite plays `pokemon.getSpriteKey(true)`
      // -> the FORM-level front atlas, the SAME sheet Luvdisc->Discupid drew blank /
      // Regitube drew scrambled on. A separate gate so a 404/whole-sheet regression on
      // the evolution surface is named explicitly (runtime frame-pin: er-evolution-render).
      "evolution scene (evolved form front)": form.getSpriteAtlasPath(false, formIndex, false, 0, false),
    };

    const failures: string[] = [];
    for (const [surface, atlasPath] of Object.entries(surfaces)) {
      const a = await analyzeAtlas(atlasPath);
      if (!a.exists) {
        failures.push(`${surface}: resolved atlas "${atlasPath}" has NO file (wrong/404 path)`);
      } else if (a.transparentPct >= 99) {
        failures.push(
          `${surface}: atlas "${atlasPath}" (${a.dims}) is EMPTY (${a.transparentPct.toFixed(1)}% transparent)`,
        );
      } else if (!a.spriteSized) {
        failures.push(
          `${surface}: atlas "${atlasPath}" decoded a NON-sprite frame (${a.dims}) - the whole packed sheet, `
            + "not frame 0001 (the scrambled-sprite class)",
        );
      }
    }
    expect(failures, `${entry.label}:\n${failures.join("\n")}`).toEqual([]);

    // --- SHINY VARIANT sprites (the "no primal mew sprites" gap, 2026-07-16) ----
    // The base surfaces above only exercise variant 0. Gate every shiny tier
    // (0/1/2) x {front, back} of the FORM-level path the battle field draws.
    const shiny = await analyzeShinyVariants(form, formIndex);
    if (Object.hasOwn(KNOWN_MISSING_SHINY_ART, entry.label)) {
      // Documented as awaiting shiny art: assert it is STILL missing, so when the
      // maintainer publishes it this test fails loudly and the entry gets removed
      // from KNOWN_MISSING_SHINY_ART (the hard gate then covers it).
      expect(
        shiny.missing.length,
        `${entry.label}: shiny art has LANDED (0 missing) - remove it from `
          + "KNOWN_MISSING_SHINY_ART so the hard gate covers it.",
      ).toBeGreaterThan(0);
    } else if (shiny.sawErCustom) {
      // Hard gate: every ER-custom shiny tier (front + back) must have real art. This
      // is the surface the sweep previously missed - Primal Mew shipped with no
      // `shiny-back-2` and the base-only sweep stayed green.
      const shinyFailures = [...shiny.missing, ...shiny.broken];
      expect(shinyFailures, `${entry.label} (shiny variants):\n${shinyFailures.join("\n")}`).toEqual([]);
    }
  });

  // --- MINI-ICON surface (the front-frame-as-icon oversize class) --------------
  // The atlas sweep above exercises front/back/dex/summary/evolution but NOT the
  // per-slug menu-icon atlas. Regitube formerly derived its mini icon from the
  // 64x64 FRONT sprite (registerIconFromFront), so it rendered ~2x oversized on
  // egg-hatch / party / summary. Its `icon.png` now ships a valid 32x32 frame, so
  // it must route through the bespoke icon atlas like every other newcomer.
  it("Regitube's mini icon routes to the bespoke icon atlas at icon size, not the oversized front sprite", async () => {
    // No custom species may still derive its icon from the front sprite.
    expect(ErCustomSpecies.usesIconFromFront(ER_REGITUBE_SPECIES_ID), "Regitube uses front-as-icon").toBe(false);

    // Regitube resolves to its bespoke icon atlas, exactly like a known-good newcomer.
    const regitubeIcon = ErCustomSpecies.getIconAtlasSourcePath(ER_REGITUBE_SPECIES_ID);
    expect(regitubeIcon).toBe("elite-redux/regitube/icon");
    expect(ErCustomSpecies.getIconAtlasSourcePath(ER_TENTALECT_SPECIES_ID)).toBe("elite-redux/tentalect/icon");

    // The resolved icon atlas decodes a real, icon-sized (32x32) frame - the front
    // atlas would decode a 64x64 frame (the oversize) or the whole packed sheet.
    const a = await analyzeAtlas(regitubeIcon as string);
    expect(a.exists, `icon atlas "${regitubeIcon}" has a file`).toBe(true);
    expect(a.dims, "Regitube icon frame is icon-sized").toBe("32x32");
    expect(a.transparentPct, "Regitube icon frame is non-empty").toBeLessThan(99);
  });
});
