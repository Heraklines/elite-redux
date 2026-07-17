/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Mega / primal cry availability manifest (live 2026-07-16 fix).
//
// ER adds many mega / primal forms that the official games never had (Mega
// Talonflame, Mega Samurott, ...). Their sprite art ships on the er-assets CDN,
// but a dedicated CRY recording usually does NOT. The vanilla `getCryKey` scheme
// still builds a form-suffixed key for them (`cry/663-mega`, `cry/503-mega`), so
// the loader fetches a file that is not on the CDN and it 404s PERMANENTLY -
// spamming every tester's console with `cry/663-mega not found` on each summon.
//
// This set is the ground truth of which mega/primal cry files actually ship. It
// is a verbatim mirror of the mega/primal-family files under er-assets
// `audio/cry`, the exact directory the deploy serves via jsDelivr (see
// `plugins/phaser/cache-busted-loader-plugin.ts` CDN_PATH_RE - `audio/` is
// CDN-served). `PokemonSpecies.getCryKey` consults it: a mega/primal form whose
// key is NOT here falls back to the base species cry (which always exists), so a
// real cry plays and nothing 404s.
//
// REGENERATE (from the repo root, with the er-assets checkout at ../er-assets):
//   ls ../er-assets/audio/cry/ | grep -E -- '-(mega|mega-x|mega-y|primal)\.(m4a|mp3|ogg|wav)$' \
//     | sed -E 's/\.(m4a|mp3|ogg|wav)$//' | sort -u
// Drift is graceful: a NEW mega cry not yet listed here simply plays the base
// cry until added; a NEW mega WITHOUT a cry is handled automatically (absent ->
// base). Neither case ever reintroduces a 404.
// =============================================================================

/**
 * Bare form-cry ids (no `cry/` prefix) for every mega/primal form whose cry file
 * ships on the er-assets CDN. Keyed to match the `ret` value {@link
 * import("#data/pokemon-species").PokemonSpecies.getCryKey} builds before it
 * prepends `cry/`.
 */
export const AVAILABLE_MEGA_FORM_CRIES: ReadonlySet<string> = new Set<string>([
  "115-mega",
  "121-mega",
  "127-mega",
  "130-mega",
  "142-mega",
  "149-mega",
  "150-mega-x",
  "150-mega-y",
  "154-mega",
  "15-mega",
  "160-mega",
  "181-mega",
  "18-mega",
  "208-mega",
  "212-mega",
  "214-mega",
  "227-mega",
  "229-mega",
  "248-mega",
  "254-mega",
  "257-mega",
  "260-mega",
  "2670-mega",
  "26-mega-x",
  "26-mega-y",
  "282-mega",
  "302-mega",
  "303-mega",
  "306-mega",
  "308-mega",
  "310-mega",
  "319-mega",
  "323-mega",
  "334-mega",
  "354-mega",
  "358-mega",
  "359-mega",
  "362-mega",
  "36-mega",
  "373-mega",
  "376-mega",
  "380-mega",
  "381-mega",
  "382-primal",
  "383-primal",
  "384-mega",
  "398-mega",
  "3-mega",
  "428-mega",
  "445-mega",
  "448-mega",
  "460-mega",
  "475-mega",
  "478-mega",
  "485-mega",
  "491-mega",
  "500-mega",
  "530-mega",
  "531-mega",
  "545-mega",
  "560-mega",
  "604-mega",
  "609-mega",
  "623-mega",
  "652-mega",
  "655-mega",
  "658-mega",
  "65-mega",
  "668-mega",
  "678-mega",
  "687-mega",
  "689-mega",
  "691-mega",
  "6-mega-x",
  "6-mega-y",
  "701-mega",
  "718-mega",
  "719-mega",
  "71-mega",
  "740-mega",
  "768-mega",
  "780-mega",
  "801-mega",
  "807-mega",
  "80-mega",
  "870-mega",
  "94-mega",
  "952-mega",
  "970-mega",
  "978-mega",
  "998-mega",
  "9-mega",
]);

/** Matches only the mega/primal-family suffixes {@link getCryKey} appends. */
const MEGA_FAMILY_CRY_SUFFIX_RE = /-(mega(?:-[xy])?|primal)$/;

/**
 * Whether `formCryId` (bare, e.g. `"663-mega"`) is a mega/primal-family cry id -
 * i.e. one this manifest governs. Non-mega form cries (therian, sky, ...) return
 * false and are left untouched by the fallback.
 */
export function isMegaFamilyFormCry(formCryId: string): boolean {
  return MEGA_FAMILY_CRY_SUFFIX_RE.test(formCryId);
}

/**
 * True when a mega/primal form cry file actually ships on the CDN for
 * `formCryId`. Only meaningful for {@link isMegaFamilyFormCry} ids.
 */
export function megaFormCryExists(formCryId: string): boolean {
  return AVAILABLE_MEGA_FORM_CRIES.has(formCryId);
}
