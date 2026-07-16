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

import { ER_NEWCOMER_ICON_SLUGS, ER_REGITUBE_SPECIES_ID } from "#data/elite-redux/er-newcomer-species";
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
});
