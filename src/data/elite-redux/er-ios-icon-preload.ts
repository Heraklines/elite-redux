/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - iOS icon-atlas preload deferral (#ios-stability, mitigation P3).
//
// The boot preload queues ~1,850 CDN requests just for the per-slug ER-custom
// species icon atlases (881 customs + newcomers, each a png+json pair). On iOS /
// the Discord WKWebView that parallel request fan can stall the connection pool
// during the pre-title crash window (investigation hypothesis #5).
//
// On iOS these icons are pulled OUT of the blocking boot preload and streamed in
// PACED batches at the title instead (see loadEliteReduxCustomIconsInBackground),
// so they never stampede the loader during boot. The single source-of-truth load
// list (getEliteReduxCustomIconLoads) is also used by the DESKTOP preload path in
// loading-scene.ts, so the two can never drift.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { markBootMilestone } from "#data/elite-redux/er-boot-diagnostics";
import { ER_NEWCOMER_FRONT_ICON_SLUGS, ER_NEWCOMER_ICON_SLUGS } from "#data/elite-redux/er-newcomer-species";
import { ER_SPRITE_MANIFEST } from "#data/elite-redux/er-sprite-manifest";
import Phaser from "phaser";

/** One ER-custom icon-atlas load: the texture key + the slug/file it resolves from. */
export interface ErIconAtlasLoad {
  /** Phaser texture key, e.g. `er_icon__rattata_redux`. */
  key: string;
  /** ER slug directory under `pokemon/elite-redux/`, e.g. `rattata_redux`. */
  slug: string;
  /** File root under `pokemon/elite-redux/<slug>/` - `icon` or (icon-from-front species) `front`. */
  file: string;
}

/**
 * The full ER-custom species icon-atlas load set, in preload order. Single source of truth
 * shared by the desktop preload (LoadingScene.loadEliteReduxCustomIcons) and the iOS
 * background streamer below, so the loaded set is identical on both paths.
 */
export function getEliteReduxCustomIconLoads(): ErIconAtlasLoad[] {
  const loads: ErIconAtlasLoad[] = [];
  for (const entry of ER_SPRITE_MANIFEST) {
    // ER species id >= 1026 -> custom (Phantowl onward). Vanilla ids 1..1025 share
    // pokerogue's bundled `pokemon_icons_N`; only the customs need a per-slug atlas.
    if (entry.speciesId < 1026) {
      continue;
    }
    loads.push({ key: `er_icon__${entry.slug}`, slug: entry.slug, file: "icon" });
  }
  // Hand-authored newcomer species (70000+ band) aren't in ER_SPRITE_MANIFEST. Icon-from-front
  // species (Regitube) load their FRONT atlas under the icon key (their icon.png may lack 0001.png).
  for (const slug of ER_NEWCOMER_ICON_SLUGS) {
    const file = ER_NEWCOMER_FRONT_ICON_SLUGS.has(slug) ? "front" : "icon";
    loads.push({ key: `er_icon__${slug}`, slug, file });
  }
  return loads;
}

/** How many icon atlases to queue per background batch before yielding the event loop. */
const ER_IOS_ICON_BATCH = 64;

/** Guards the background streamer to one run per session (the title phase re-enters). */
let backgroundLoadStarted = false;

/**
 * iOS mitigation P3: stream the ER-custom icon atlases in paced batches on the live battle
 * scene's loader, kicked off at the title (after boot). Each batch queues up to
 * {@linkcode ER_IOS_ICON_BATCH} atlases, then YIELDS via `setTimeout(0)` on the loader's
 * COMPLETE so the fetch fan never stampedes/blocks. Idempotent per session and per key
 * (already-loaded textures are skipped), so a return-to-title is a cheap no-op.
 *
 * Trade-off (documented, deliberate): the title-screen icon surfaces (starter-select /
 * save-slot preview / party) do NOT lazily load icons, so a player who navigates into one
 * within the first moment of the title - before the paced stream reaches that slug - could
 * briefly see a placeholder icon (never a crash). That is strictly preferable to the boot
 * crash the deferral prevents, and the tightly-paced stream resolves the whole set within
 * the first seconds of the title, well before typical navigation.
 */
export function loadEliteReduxCustomIconsInBackground(scene: BattleScene): void {
  if (backgroundLoadStarted) {
    return;
  }
  backgroundLoadStarted = true;

  const loads = getEliteReduxCustomIconLoads();
  markBootMilestone("ios-icons-bg-start");

  let index = 0;
  const pumpBatch = (): void => {
    if (index >= loads.length) {
      markBootMilestone("ios-icons-bg-done");
      return;
    }
    const end = Math.min(index + ER_IOS_ICON_BATCH, loads.length);
    for (; index < end; index++) {
      const load = loads[index];
      if (!scene.textures.exists(load.key)) {
        scene.loadPokemonAtlas(load.key, `elite-redux/${load.slug}/${load.file}`);
      }
    }
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      // Yield to the event loop between batches so the request fan never stampedes/blocks.
      setTimeout(pumpBatch, 0);
    });
    if (!scene.load.isLoading()) {
      scene.load.start();
    }
  };
  pumpBatch();
}
