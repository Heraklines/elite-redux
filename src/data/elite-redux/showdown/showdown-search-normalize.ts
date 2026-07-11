/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown teambuilder - the SEPARATOR-INSENSITIVE name normalization + typeahead ranking.
//
// Extracted from the Set Editor handler (it was private there) so BOTH the editor's search pane
// AND the PS-format text codec resolve names through the SAME normalization: apostrophes, hyphens
// and spaces are the punctuation a player (or a pasted set) never types consistently, so a query /
// a pasted move name compares equal to the real name across all of them ("uturn" == "U-turn",
// "kingsshield" == "King's Shield", "farfetchd" == "Farfetch'd").
//
// PURE (no engine / Phaser imports) so it is unit-testable and importable from the pure codec.
// =============================================================================

/**
 * Lowercase + strip apostrophes (straight AND curly) so a query and a name compare equal across the
 * punctuation a player never types: "kings" == "king's", "farfetchd" == "farfetch'd".
 */
export function stripSoftPunct(s: string): string {
  return s.toLowerCase().replace(/['’‘]/g, "");
}

/**
 * Collapse ALL word separators (spaces + hyphens) after {@linkcode stripSoftPunct}, so a query typed with
 * no separators still prefix-matches the real name: "uturn" -> "U-turn", "stonee" -> "Stone Edge",
 * "kingsshield" -> "King's Shield". This is THE separator-insensitive comparison key both the search
 * ranker and the codec's name resolution use.
 */
export function collapseSearchKey(s: string): string {
  return stripSoftPunct(s).replace(/[\s-]+/g, "");
}

/** The word tokens of a name (apostrophe-stripped, split on spaces + hyphens) for word-prefix ranking. */
export function searchWords(s: string): string[] {
  return stripSoftPunct(s)
    .split(/[\s-]+/)
    .filter(Boolean);
}

/**
 * Typeahead ranking - Showdown-standard "autocomplete" order. Case-insensitive and separator-insensitive
 * (apostrophes/hyphens/spaces normalized on BOTH sides). A non-matching row is dropped; a match ranks by
 * tier, then alphabetically within a tier:
 *   (0) EXACT PREFIX  - the whole name starts with the query ("ea" -> Earthquake; "sto" -> Stone Edge;
 *       "kings" -> King's Shield; "uturn" -> U-turn).
 *   (1) WORD PREFIX   - a later word starts with the query ("sto" -> Bleakwind Storm's "Storm").
 *   (2) SUBSTRING     - the query appears anywhere else.
 * So a one-char "e" surfaces every Earthquake-class prefix match above a mere substring hit like "Blaze".
 */
export function rankByFilter<T>(items: T[], nameOf: (item: T) => string, filter: string): T[] {
  const fKey = collapseSearchKey(filter);
  if (fKey.length === 0) {
    return [...items].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }
  const tierOf = (name: string): number => {
    const nameKey = collapseSearchKey(name);
    if (nameKey.startsWith(fKey)) {
      return 0;
    }
    if (searchWords(name).some(word => word.startsWith(fKey))) {
      return 1;
    }
    return nameKey.includes(fKey) ? 2 : 3;
  };
  return items
    .map(item => ({ item, name: nameOf(item), tier: tierOf(nameOf(item)) }))
    .filter(entry => entry.tier < 3)
    .sort((a, b) => (a.tier === b.tier ? a.name.localeCompare(b.name) : a.tier - b.tier))
    .map(entry => entry.item);
}
