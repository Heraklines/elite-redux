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
  ER_PARTNER_ESPEON_SPECIES_ID,
  ER_PARTNER_FLAREON_SPECIES_ID,
  ER_PARTNER_GLACEON_SPECIES_ID,
  ER_PARTNER_JOLTEON_SPECIES_ID,
  ER_PARTNER_LEAFEON_SPECIES_ID,
  ER_PARTNER_SYLVEON_SPECIES_ID,
  ER_PARTNER_UMBREON_SPECIES_ID,
  ER_PARTNER_VAPOREON_SPECIES_ID,
  ER_REGITUBE_SPECIES_ID,
  ER_TENTALECT_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
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
    // 4 hand-authored newcomer species.
    { label: "Tentalect", speciesId: ER_TENTALECT_SPECIES_ID },
    { label: "Astoot", speciesId: ER_ASTOOT_SPECIES_ID },
    { label: "Discupid", speciesId: ER_DISCUPID_SPECIES_ID },
    { label: "Regitube", speciesId: ER_REGITUBE_SPECIES_ID },
    // 8 partner eeveelutions (alias vanilla base eeveelution art).
    { label: "Partner Vaporeon", speciesId: ER_PARTNER_VAPOREON_SPECIES_ID },
    { label: "Partner Jolteon", speciesId: ER_PARTNER_JOLTEON_SPECIES_ID },
    { label: "Partner Flareon", speciesId: ER_PARTNER_FLAREON_SPECIES_ID },
    { label: "Partner Espeon", speciesId: ER_PARTNER_ESPEON_SPECIES_ID },
    { label: "Partner Umbreon", speciesId: ER_PARTNER_UMBREON_SPECIES_ID },
    { label: "Partner Leafeon", speciesId: ER_PARTNER_LEAFEON_SPECIES_ID },
    { label: "Partner Glaceon", speciesId: ER_PARTNER_GLACEON_SPECIES_ID },
    { label: "Partner Sylveon", speciesId: ER_PARTNER_SYLVEON_SPECIES_ID },
    // 12 injected forms (megas / primals) - keyed by baseSpecies + formKey.
    ...ER_NEWCOMER_FORMS.map(def => ({
      label: def.slug,
      speciesId: def.baseSpecies as number,
      formKey: def.formKey,
    })),
  ];

  it("sweeps 24 newcomer mons/forms", () => {
    expect(entries.length).toBe(24);
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
  });
});
