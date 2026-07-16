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
import type { PokemonForm, PokemonSpecies } from "#data/pokemon-species";

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

/** ER-custom species live at id >= this cutoff; below it is a real vanilla-scheme species. */
const VANILLA_ID_CUTOFF = 10000;

/**
 * Redirect a single FORM object's sprite + icon to the ER-custom `slug` art, and
 * wrap its loadAssets to preload the per-slug icon atlas (mirroring
 * ErCustomSpecies.loadAssets) and skip the nonexistent slug variant-colour palette
 * (spriteOnly). The vanilla-scheme cry, when it exists, is re-queued explicitly (see
 * inside). Always-on for this form instance (the form IS the ER art). Idempotent via
 * a per-object flag.
 */
export function installErFormSpriteRedirect(form: PokemonForm, slug: string): void {
  const fm = form as unknown as {
    speciesId?: number;
    getSpriteAtlasPath(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
    getSpriteId(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
    getIconAtlasKey(formIndex?: number, shiny?: boolean, variant?: number): string;
    getIconId(female: boolean, formIndex?: number, shiny?: boolean, variant?: number): string;
    getCryKey(formIndex?: number): string;
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
    // The SPRITE lives under the ER slug, but the CRY still resolves through the
    // vanilla `getCryKey` scheme (`cry/445-mega`), and that audio EXISTS for a
    // vanilla-species mega/primal. The spriteOnly=true below is needed to skip the
    // nonexistent slug variant-colour palette, but it ALSO skips the base cry load
    // — so a mon built straight INTO a redirected form (the Showdown teambuilder,
    // or any construction-time mega, rather than a mid-run form change) was left
    // mute and logged `cry/<id>-mega not found` when it tried to play. Re-queue the
    // cry here for real vanilla-base forms only: an ER-custom base id (>= 10000)
    // would crash the base `getCryKey` (its `id % 2000` lookup is undefined — see
    // ErCustomSpecies.getCryKey) and is intentionally silent anyway. A vanilla base
    // with no matching cry file just 404s harmlessly, exactly as before.
    const speciesId = fm.speciesId ?? 0;
    if (speciesId > 0 && speciesId < VANILLA_ID_CUTOFF) {
      const cryKey = fm.getCryKey(formIndex);
      if (cryKey && !globalScene.cache.audio.exists(cryKey)) {
        globalScene.load.audio(cryKey, `audio/${cryKey}.m4a`);
      }
    }
    // Force sprite-only: ER slug art has no variantData colour entry (the cry, when
    // it exists, is queued explicitly above).
    return origLoadAssets(female, formIndex, shiny, variant, startLoad, back, true);
  };
}

/**
 * Build a sprite's animation if its atlas texture is loaded but the anim was
 * never created. `PokemonSpeciesForm.loadAssets` builds the (single-frame for ER
 * art) anim in `finalize()` once the atlas lands — but its safety backstop can
 * settle the awaited promise BEFORE `finalize` runs on a slow/contended load,
 * leaving `Missing animation: pkmn__er__<slug>` and the BASE sprite shown in the
 * preview UIs (starter-select / Pokedex). The battle field already gap-fills this
 * (see `Pokemon.loadAssets` in pokemon.ts); the preview screens did not, so a
 * redirected ER mega/primal/costume form rendered as the base mon there.
 *
 * Safe + idempotent: no-op when the texture is absent or the anim already exists;
 * never creates an empty (frame-less) anim.
 */
export function ensureErSpriteAnim(spriteKey: string): void {
  if (!globalScene.textures.exists(spriteKey) || globalScene.anims.exists(spriteKey)) {
    return;
  }
  const originalWarn = console.warn;
  console.warn = () => {}; // generateFrameNames warns once per missing frame index
  const frameNames = globalScene.anims.generateFrameNames(spriteKey, {
    zeroPad: 4,
    suffix: ".png",
    start: 1,
    end: 400,
  });
  console.warn = originalWarn;
  if (frameNames.length > 0) {
    globalScene.anims.create({ key: spriteKey, frames: frameNames, frameRate: 10, repeat: -1 });
  }
}

/**
 * Robustly show `spriteKey` on a pokemon SPRITE across the non-battle surfaces
 * (evolution scene, egg hatch, egg-summary card, summary, dex, starter select,
 * run-info). A multi-frame packed ER atlas defaults to its whole-sheet `__BASE`
 * frame on `setTexture`, and these surfaces do NOT lazily build the per-species
 * animation the way the battle field does - so a bare `play(key)` either fails
 * ("Missing animation") leaving the sprite blank / on the previous mon, or draws
 * the raw packed sheet (the scrambled-sprite class: Regitube on hatch, Discupid
 * on evolution). This one helper closes it everywhere:
 *   1. pin the atlas + its first real frame "0001.png" (never the `__BASE` sheet),
 *   2. gap-fill the animation if the atlas is loaded but the anim was not built,
 *   3. play the looping animation; a still-missing anim just leaves the clean
 *      pinned frame, never a scramble.
 * Safe on a `MockSprite` (headless tests): every op is a no-op there.
 */
export function playErPokemonSpriteAnim(sprite: Phaser.GameObjects.Sprite, spriteKey: string): void {
  if (globalScene.textures.exists(spriteKey)) {
    sprite.setTexture(spriteKey);
    if (sprite.texture.has("0001.png")) {
      sprite.setFrame("0001.png");
    }
  }
  ensureErSpriteAnim(spriteKey);
  try {
    sprite.play(spriteKey);
  } catch (err: unknown) {
    console.error(`Failed to play animation for ${spriteKey}`, err);
  }
}

/** Sprite/icon/asset methods shared by PokemonSpecies and PokemonForm. */
interface ErSpriteCarrier {
  formIndex?: number;
  forms?: ErRedirectableForm[];
  getSpriteAtlasPath(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
  getSpriteId(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
  getSpriteKey(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
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
}
interface ErRedirectableForm extends ErSpriteCarrier {
  __erFormSpriteRedirect?: boolean;
}

/**
 * Bridge the SPECIES-level sprite path to a form's {@linkcode installErFormSpriteRedirect}.
 *
 * pokerogue resolves a form sprite TWO ways. The battle path uses
 * `getSpeciesForm(formIndex).getSpriteAtlasPath()` — the FORM object, which the
 * per-form redirect patches. But UI paths (starter select, Pokedex, party screen)
 * call the SPECIES-level `species.getSpriteAtlasPath(female, formIndex, …)`, and
 * `getBaseSpriteKey` builds the key from `this.speciesId` + `getFormSpriteKey(formIndex)`
 * — i.e. the vanilla `{speciesId}-{formKey}` path computed from the SPECIES, never
 * touching the patched form. So an ER mega rendered through the UI still 404s and
 * shows the BASE sprite. This makes the species method delegate to the redirected
 * form for that formIndex; the base form and every non-redirected form keep the
 * original behaviour (incl. ErCustomSpecies' own slug override). Idempotent.
 */
export function installErSpeciesFormSpriteDispatch(species: PokemonSpecies): void {
  const sp = species as unknown as ErSpriteCarrier & { __erSpeciesSpriteDispatch?: boolean };
  if (sp.__erSpeciesSpriteDispatch) {
    return;
  }
  sp.__erSpeciesSpriteDispatch = true;

  // The redirected form for a given formIndex, or undefined to keep the original.
  const formFor = (formIndex?: number): ErRedirectableForm | undefined => {
    const fi = formIndex ?? sp.formIndex ?? 0;
    const f = sp.forms?.[fi];
    return f && (f as object) !== (sp as object) && f.__erFormSpriteRedirect ? f : undefined;
  };

  const oAtlas = sp.getSpriteAtlasPath.bind(sp);
  sp.getSpriteAtlasPath = (female, formIndex, shiny, variant, back) =>
    formFor(formIndex)?.getSpriteAtlasPath(female, formIndex, shiny, variant, back)
    ?? oAtlas(female, formIndex, shiny, variant, back);

  const oId = sp.getSpriteId.bind(sp);
  sp.getSpriteId = (female, formIndex, shiny, variant, back) =>
    formFor(formIndex)?.getSpriteId(female, formIndex, shiny, variant, back)
    ?? oId(female, formIndex, shiny, variant, back);

  const oKey = sp.getSpriteKey.bind(sp);
  sp.getSpriteKey = (female, formIndex, shiny, variant, back) =>
    formFor(formIndex)?.getSpriteKey(female, formIndex, shiny, variant, back)
    ?? oKey(female, formIndex, shiny, variant, back);

  const oIconKey = sp.getIconAtlasKey.bind(sp);
  sp.getIconAtlasKey = (formIndex, shiny, variant) =>
    formFor(formIndex)?.getIconAtlasKey(formIndex, shiny, variant) ?? oIconKey(formIndex, shiny, variant);

  const oIconId = sp.getIconId.bind(sp);
  sp.getIconId = (female, formIndex, shiny, variant) =>
    formFor(formIndex)?.getIconId(female, formIndex, shiny, variant) ?? oIconId(female, formIndex, shiny, variant);

  const oLoad = sp.loadAssets.bind(sp);
  sp.loadAssets = (female, formIndex, shiny, variant, startLoad, back, spriteOnly) => {
    const f = formFor(formIndex);
    return f
      ? f.loadAssets(female, formIndex, shiny, variant, startLoad, back, spriteOnly)
      : oLoad(female, formIndex, shiny, variant, startLoad, back, spriteOnly);
  };
}
