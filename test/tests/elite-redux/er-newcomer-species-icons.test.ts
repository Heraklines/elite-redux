/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER newcomer NEW-SPECIES icon resolution (live tester fix).
//
// Bug: a hand-authored newcomer species (Tentalect 70001, Astoot 70002, Discupid
// 70003, Regitube 70004) showed an ERROR BOX for its party mini icon in the
// save-slot preview (and other title-screen surfaces). The battle UI was fine —
// it lazily loads the per-slug `er_icon__<slug>` atlas via ErCustomSpecies
// .loadAssets — but title-screen surfaces never trigger that load, and these
// species are NOT in the auto-generated ER_SPRITE_MANIFEST the loading scene
// preloads, so their atlas was simply never queued (same class as #308).
//
// Fix: the loading scene now also preloads every slug in ER_NEWCOMER_ICON_SLUGS.
// This test asserts (a) the UI icon accessor resolves to the custom per-slug
// atlas (never the bundled pokemon_icons_N sheet, which has no frame for id
// >= 10000), and (b) every such slug is in the preload list so the atlas is
// actually loaded before those surfaces render.
//
// Gated behind ER_SCENARIO=1 (boots the real init via GameManager).
// =============================================================================

import {
  ER_NEWCOMER_FRONT_ICON_SLUGS,
  ER_NEWCOMER_ICON_SLUGS,
  ER_REGITUBE_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import { ErCustomSpecies } from "#data/elite-redux/init-elite-redux-custom-species";
import type { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// The four slug-based newcomer species that render a party mini icon on
// title-screen surfaces. Partner eeveelutions (70011+) alias a vanilla base's
// bundled icon, so they use pokemon_icons_N and are covered elsewhere.
const SLUG_NEWCOMER_IDS = [70001, 70002, 70003, ER_REGITUBE_SPECIES_ID] as const;

describe.skipIf(!RUN)("ER newcomer species icon resolution (save-slot / party UI)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    void game;
  });

  const ICON_PREFIX = "er_icon__";

  it("resolves the custom per-slug icon atlas via the shared UI accessor (not the bundled sheet)", () => {
    for (const id of SLUG_NEWCOMER_IDS) {
      const sp = getPokemonSpecies(id as SpeciesId);
      expect(sp, `species ${id} registered`).toBeDefined();

      // This is the exact accessor addPokemonIcon / p.toPokemon().getIconAtlasKey
      // funnel through (Pokemon.getIconAtlasKey -> getSpeciesForm().getIconAtlasKey).
      const atlasKey = sp.getIconAtlasKey(0, false, 0);
      expect(atlasKey.startsWith(ICON_PREFIX), `species ${id} uses the custom icon path`).toBe(true);
      // Never the bundled pokemon_icons_N sheet (no frames for id >= 10000).
      expect(atlasKey.startsWith("pokemon_icons")).toBe(false);
      // The frame id is the single-frame custom atlas frame.
      expect(sp.getIconId(false, 0, false, 0)).toBe("0001.png");
    }
  });

  it("preloads every slug-based newcomer icon atlas (ER_NEWCOMER_ICON_SLUGS covers each)", () => {
    for (const id of SLUG_NEWCOMER_IDS) {
      const sp = getPokemonSpecies(id as SpeciesId);
      const slug = sp.getIconAtlasKey(0, false, 0).slice(ICON_PREFIX.length);
      expect(ER_NEWCOMER_ICON_SLUGS.includes(slug), `${slug} is in the loading-scene preload list`).toBe(true);
    }
  });

  // Regitube ships front-only art; its published icon atlas lacks the 0001.png
  // frame, so the icon key rendered a black/missing box (live tester report). The
  // maintainer fix derives the icon from the downscaled FRONT sprite.
  it("Regitube derives its icon from the FRONT sprite atlas at a downscaled scale", () => {
    // The icon key is unchanged (still er_icon__regitube), but the atlas it loads
    // is the front sprite atlas, whose 0001.png frame always exists.
    const source = ErCustomSpecies.getIconAtlasSourcePath(ER_REGITUBE_SPECIES_ID);
    expect(source, "Regitube icon sources from front atlas").toBe("elite-redux/regitube/front");
    expect(ErCustomSpecies.usesIconFromFront(ER_REGITUBE_SPECIES_ID)).toBe(true);
    expect(ER_NEWCOMER_FRONT_ICON_SLUGS.has("regitube")).toBe(true);

    const sp = getPokemonSpecies(ER_REGITUBE_SPECIES_ID as SpeciesId);
    // Icon key + frame unchanged (frame present in front.json); scale downshifts.
    expect(sp.getIconAtlasKey(0, false, 0)).toBe("er_icon__regitube");
    expect(sp.getIconId(false, 0, false, 0)).toBe("0001.png");
    expect(sp.getIconScale(0)).toBeLessThan(1);
    expect(sp.getIconScale(0)).toBeGreaterThan(0);
  });

  it("the other slug newcomers keep a bespoke icon atlas at native scale", () => {
    for (const id of [70001, 70002, 70003] as const) {
      const source = ErCustomSpecies.getIconAtlasSourcePath(id);
      expect(source, `species ${id} keeps bespoke icon`).toMatch(/\/icon$/);
      expect(ErCustomSpecies.usesIconFromFront(id)).toBe(false);
      expect(getPokemonSpecies(id as SpeciesId).getIconScale(0)).toBe(1);
    }
  });

  // Starter-select handler path (#110/#113 accessor class): the 70000+ band must
  // resolve a non-empty name + a slug-based sprite atlas + a resolvable icon, so
  // the grid slot is never a blank (no sprite, no name) cell.
  it("every 70000-band newcomer resolves name + sprite + icon accessors (no blank slot)", () => {
    for (const id of SLUG_NEWCOMER_IDS) {
      const sp = getPokemonSpecies(id as SpeciesId);
      expect(sp.name?.length ?? 0, `species ${id} has a name`).toBeGreaterThan(0);
      // The detail-panel/battle sprite atlas resolves to the ER slug (never a
      // vanilla {id} path that 404s for id >= 10000).
      const atlas = sp.getSpriteAtlasPath(false, 0, false, 0, false);
      expect(atlas.startsWith("elite-redux/"), `species ${id} sprite atlas is slug-based`).toBe(true);
      // Icon accessor resolves to a custom per-slug atlas with a concrete frame.
      expect(sp.getIconAtlasKey(0, false, 0).startsWith(ICON_PREFIX)).toBe(true);
      expect(sp.getIconId(false, 0, false, 0)).toBe("0001.png");
    }
  });
});
