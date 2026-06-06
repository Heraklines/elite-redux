/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — form-object sprite/icon redirect to an ER-custom slug.
//
// ER models several in-battle alternate forms (Unown Revelation, Wispywaspy
// Hivemind, Darmanitan Redux Blunder, …) as separate dump species with their
// own `elite-redux/{slug}/…` art, but pokerogue's form-change system can only
// swap `formIndex` on the SAME species — so the alternate must live as a FORM.
//
// Two distinct breakages this fixes:
//
//   1. A form injected onto a VANILLA species (Unown) would resolve its sprite
//      via the vanilla scheme (`pokemon/201-revelation`) and 404.
//
//   2. A form injected onto an ER-CUSTOM species is subtler. ErCustomSpecies
//      overrides getSpriteAtlasPath / getSpriteId / getIconAtlasKey / getIconId
//      at the SPECIES level. But the moment a custom species gains ANY forms
//      (because we seed a base form + inject an alternate), `getSpeciesForm`
//      returns `species.forms[formIndex]` — a plain `PokemonForm` that does NOT
//      inherit those overrides. So BOTH the seeded base form AND the injected
//      alternate render via the base `PokemonSpeciesForm` scheme (`10065`,
//      `10065-hivemind`) and 404, and their icons fall back to the bundled
//      `pokemon_icons_N` sheet (which has no frame for id ≥ 10000).
//
// In all cases the rendering path is `Pokemon.getSpriteAtlasPath` ->
// `getSpeciesForm().getSpriteAtlasPath`, and asset loading is
// `Pokemon.loadAssets` -> `getSpeciesForm().loadAssets` — i.e. the FORM object's
// methods. So we patch the FORM instance directly to emit the ER-custom scheme
// (mirroring ErCustomSpecies' overrides) and wrap its loadAssets to preload the
// per-slug icon atlas + force sprite-only (the ER art has no cry / no
// variantData colour entry).
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { PokemonForm } from "#data/pokemon-species";

/** ER-scheme sprite atlas PATH for a slug (mirrors ErCustomSpecies). */
function erAtlasPath(slug: string, shiny?: boolean, variant?: number, back?: boolean): string {
  let filename: string;
  if (shiny) {
    const tier = variant ?? 0;
    const suffix = tier === 0 ? "" : `-${tier + 1}`;
    filename = back ? `shiny-back${suffix}` : `shiny${suffix}`;
  } else {
    filename = back ? "back" : "front";
  }
  return `elite-redux/${slug}/${filename}`;
}

/** ER-scheme sprite ID (atlas KEY base) for a slug (mirrors ErCustomSpecies). */
function erSpriteId(slug: string, shiny?: boolean, variant?: number, back?: boolean): string {
  const suffix = shiny ? (variant ? `_shiny${variant + 1}` : "_shiny") : "";
  const backPrefix = back ? "back__" : "";
  return `${backPrefix}er__${slug}${suffix}`;
}

/**
 * Redirect a single FORM object's sprite + icon to the ER-custom `slug` art, and
 * wrap its loadAssets to preload the per-slug icon atlas (mirroring
 * ErCustomSpecies.loadAssets) and force sprite-only. Always-on for this form
 * instance (the form IS the ER art). Idempotent via a per-object flag.
 */
export function installErFormSpriteRedirect(form: PokemonForm, slug: string): void {
  const fm = form as unknown as {
    getSpriteAtlasPath(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
    getSpriteId(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
    getIconAtlasKey(formIndex?: number, shiny?: boolean, variant?: number): string;
    getIconId(female: boolean, formIndex?: number, shiny?: boolean, variant?: number): string;
    loadAssets(
      female?: boolean,
      formIndex?: number,
      shiny?: boolean,
      variant?: number,
      startLoad?: boolean,
      back?: boolean,
      spriteOnly?: boolean,
    ): Promise<void>;
    __erFormSpriteRedirect?: boolean;
  };
  if (fm.__erFormSpriteRedirect) {
    return;
  }
  fm.__erFormSpriteRedirect = true;

  fm.getSpriteAtlasPath = (_female, _formIndex, shiny, variant, back) => erAtlasPath(slug, shiny, variant, back);
  fm.getSpriteId = (_female, _formIndex, shiny, variant, back) => erSpriteId(slug, shiny, variant, back);
  fm.getIconAtlasKey = () => `er_icon__${slug}`;
  fm.getIconId = () => "0001.png";

  const origLoadAssets = fm.loadAssets.bind(fm);
  fm.loadAssets = (female, formIndex, shiny, variant, startLoad, back) => {
    const iconKey = `er_icon__${slug}`;
    if (!globalScene.textures.exists(iconKey)) {
      globalScene.loadPokemonAtlas(iconKey, `elite-redux/${slug}/icon`);
    }
    // Force sprite-only: ER art has no cry audio / no variantData colour entry.
    return origLoadAssets(female, formIndex, shiny, variant, startLoad, back, true);
  };
}
