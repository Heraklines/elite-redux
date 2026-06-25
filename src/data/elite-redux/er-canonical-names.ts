/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - locale-INVARIANT canonical match keys for co-op determinism (#633).
//
// ER data-init passes match live `Move` / `PokemonSpecies` instances to their ER
// drafts BY NAME. But `move.name` / `species.name` are localized display strings
// (`i18next.t(...)` against the ACTIVE language - see `move.ts` `localize()` and
// `pokemon-species.ts` `localize()`). Two co-op players in different languages
// therefore build DIFFERENT id / moveset / ability tables from the SAME byte-
// identical starting data, which desyncs every battle (proof: the move-id remap
// changed 67 entries on an English client but only 1 on a German one).
//
// These helpers re-derive the SAME name key the localize() methods use, but pin
// the lookup to English with `{ lng: "en" }`. For an English client this returns
// the exact string `move.name` / `species.name` already hold (so the English
// mapping is byte-for-byte unchanged - zero regression); for any other language
// it now agrees with the English client. Use these - never the localized
// `.name` getter - anywhere ER init matches a LIVE entity instance by name to
// feed a data table (id maps, moveset patching, egg pools, ability resolution).
//
// NB: do NOT use these on ER DRAFT objects (entries of `ER_MOVES` / a custom-
// species draft array): those `.name` fields are already static English and are
// thus locale-invariant on their own.
// =============================================================================

import type { Move } from "#data/moves/move";
import type { PokemonSpecies } from "#data/pokemon-species";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";

/**
 * First ER-custom move id. ER-custom moves (>= this) are NOT in pokerogue's
 * `move:` i18n bundle - their live `.name` comes from a STATIC ER draft string
 * (see `ErCustomAttackMove.localize()`), which is already English /
 * locale-invariant. (Custom species are detected differently - by the absence of
 * a `SpeciesId` enum key - because custom MOVE ids ARE injected into the `MoveId`
 * reverse-map at init, so a "missing enum key" test would not catch them.)
 */
const ER_CUSTOM_MOVE_ID_FLOOR = 5000;

/**
 * The English (locale-invariant) display name of a live {@linkcode Move} instance,
 * matching what `Move.localize()` produces for an English client (minus the
 * battle-only `nameAppend`, which is never part of a match key). Use this instead
 * of `move.name` when matching moves by name in ER init (#633).
 *
 * Two cases:
 *  - VANILLA move: the live `.name` is `i18next.t("move:<key>.name")` against the
 *    ACTIVE language, so we re-derive it pinned to English (byte-identical to
 *    `.name` for an English client).
 *  - ER-CUSTOM move (id >= {@linkcode ER_CUSTOM_MOVE_ID_FLOOR}): no `move:` i18n
 *    entry exists; `ErCustomAttackMove.localize()` sets `.name` from a STATIC
 *    (already locale-invariant) draft string, so return it directly.
 */
export function enMoveName(move: Move): string {
  if (move.id === MoveId.NONE) {
    return "";
  }
  if (move.id >= ER_CUSTOM_MOVE_ID_FLOOR) {
    return move.name;
  }
  return String(i18next.t(`move:${toCamelCase(MoveId[move.id])}.name`, { lng: "en" }));
}

/**
 * The English (locale-invariant) display name of a live {@linkcode PokemonSpecies}
 * instance, matching what `PokemonSpecies.localize()` produces for an English
 * client. Use this instead of `species.name` when matching species by name in ER
 * init (#633).
 *
 * Two cases:
 *  - VANILLA species (in the {@linkcode SpeciesId} enum): the live `.name` is
 *    `i18next.t("pokemon:<key>")` against the ACTIVE language, so we re-derive it
 *    pinned to English. For an English client this is byte-identical to `.name`.
 *  - ER-CUSTOM species (id not in `SpeciesId`, e.g. >= 10000): there is no
 *    `pokemon:` i18n entry - `ErCustomSpecies.localize()` sets `.name` from a
 *    STATIC draft string that is already English / locale-invariant, so we return
 *    `.name` directly (forcing the absent i18n key would yield an empty string).
 */
export function enSpeciesName(species: PokemonSpecies): string {
  const enumKey = SpeciesId[species.speciesId];
  if (enumKey === undefined) {
    // ER-custom species: `.name` is a static (already locale-invariant) draft name.
    return species.name;
  }
  return String(i18next.t(`pokemon:${toCamelCase(enumKey)}`, { lng: "en" }));
}
