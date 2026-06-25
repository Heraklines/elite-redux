/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op desync root cause (#633): ER data-init matches live entities by their
// LOCALIZED display name (`move.name` / `species.name` are `i18next.t(...)`
// strings against the ACTIVE language). Two co-op players in different languages
// therefore built DIFFERENT id / moveset / ability tables and desynced.
//
// The fix is `enMoveName` / `enSpeciesName` in `er-canonical-names.ts`, which
// re-derive the SAME name key but pin the lookup to English (`{ lng: "en" }`).
// This test proves the helpers ignore the ACTIVE language: we spy on `i18next.t`
// so that an UNforced lookup returns a fake "localized" string, while a lookup
// forced to English returns the real English name. The helpers must always
// return the English value (so two clients agree regardless of locale), and an
// English client sees the exact string it always did (zero regression).
//
// Engine-free / fast: the helpers only read `move.id` / `species.speciesId`, so
// minimal typed stubs suffice - no GameManager / ER init boot.
// =============================================================================

import { enMoveName, enSpeciesName } from "#data/elite-redux/er-canonical-names";
import type { Move } from "#data/moves/move";
import type { PokemonSpecies } from "#data/pokemon-species";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import i18next from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Sentinel returned for any NON-English (unforced) `i18next.t` lookup. */
const FAKE_LOCALIZED = "__LOCALIZED_NOT_ENGLISH__";

/**
 * Spy on `i18next.t` to emulate a co-op client whose ACTIVE language is NOT
 * English: an unforced lookup yields {@linkcode FAKE_LOCALIZED}, while a lookup
 * forced with `{ lng: "en" }` resolves to the real English name. Returns the
 * captured original `t` so we can produce the genuine English values.
 */
function stubNonEnglishActiveLanguage(): typeof i18next.t {
  const realT = i18next.t.bind(i18next);
  vi.spyOn(i18next, "t").mockImplementation(((key: string, options?: Record<string, unknown>) => {
    if (options && options.lng === "en") {
      return realT(key, options);
    }
    return FAKE_LOCALIZED;
  }) as typeof i18next.t);
  return realT;
}

const moveStub = (id: MoveId): Move => ({ id }) as unknown as Move;
const speciesStub = (speciesId: SpeciesId): PokemonSpecies => ({ speciesId }) as unknown as PokemonSpecies;

/**
 * ER-CUSTOM move/species stubs: an id OUTSIDE the vanilla enum range, plus the
 * STATIC draft `.name` their real `localize()` overrides install. These have no
 * `move:` / `pokemon:` i18n entry, so the helpers must return `.name` verbatim
 * (already locale-invariant) instead of forcing a non-existent i18n key.
 */
const customMoveStub = (id: number, name: string): Move => ({ id, name }) as unknown as Move;
const customSpeciesStub = (speciesId: number, name: string): PokemonSpecies =>
  ({ speciesId, name }) as unknown as PokemonSpecies;

describe("ER canonical (locale-invariant) name keys (#633)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enMoveName returns the ENGLISH name even when the active language is not English", () => {
    const realT = stubNonEnglishActiveLanguage();
    // Sanity: an unforced lookup (what `move.name` would use) is NOT English here.
    expect(i18next.t("move:pound.name")).toBe(FAKE_LOCALIZED);
    // The helper forces English, so it agrees across every locale.
    const expectedEnglish = String(realT("move:pound.name", { lng: "en" }));
    expect(expectedEnglish).toBe("Pound");
    expect(enMoveName(moveStub(MoveId.POUND))).toBe("Pound");
    expect(enMoveName(moveStub(MoveId.TACKLE))).toBe("Tackle");
  });

  it("enSpeciesName returns the ENGLISH name even when the active language is not English", () => {
    const realT = stubNonEnglishActiveLanguage();
    expect(i18next.t("pokemon:bulbasaur")).toBe(FAKE_LOCALIZED);
    const expectedEnglish = String(realT("pokemon:bulbasaur", { lng: "en" }));
    expect(expectedEnglish).toBe("Bulbasaur");
    expect(enSpeciesName(speciesStub(SpeciesId.BULBASAUR))).toBe("Bulbasaur");
  });

  it('forces `{ lng: "en" }` on every helper lookup (so it never reads the active language)', () => {
    const spyT = vi.spyOn(i18next, "t");
    enMoveName(moveStub(MoveId.POUND));
    enSpeciesName(speciesStub(SpeciesId.BULBASAUR));
    expect(spyT).toHaveBeenCalledTimes(2);
    for (const call of spyT.mock.calls) {
      const options = call[1] as Record<string, unknown> | undefined;
      expect(options).toBeDefined();
      expect(options?.lng).toBe("en");
    }
  });

  it("enMoveName(MoveId.NONE) returns the empty string (edge case, no i18n lookup)", () => {
    const spyT = vi.spyOn(i18next, "t");
    expect(enMoveName(moveStub(MoveId.NONE))).toBe("");
    // NONE short-circuits before any translation lookup.
    expect(spyT).not.toHaveBeenCalled();
  });

  it("ER-CUSTOM move (id >= 5000): returns the static draft `.name`, no i18n lookup, locale-independent", () => {
    // Active language is non-English; a custom move has no `move:` i18n entry, so
    // the helper must return its already-English draft name verbatim.
    stubNonEnglishActiveLanguage();
    const spyT = vi.spyOn(i18next, "t");
    expect(enMoveName(customMoveStub(5140, "Spine Breaker"))).toBe("Spine Breaker");
    // The custom branch never calls i18next.t (no `{ lng: "en" }` key to resolve).
    expect(spyT).not.toHaveBeenCalled();
  });

  it("ER-CUSTOM species (id not in SpeciesId enum): returns the static draft `.name`, locale-independent", () => {
    stubNonEnglishActiveLanguage();
    const spyT = vi.spyOn(i18next, "t");
    // 10000+ ids are ER customs with no `pokemon:` i18n key (e.g. "Unown Q").
    expect(enSpeciesName(customSpeciesStub(10859, "Unown Q"))).toBe("Unown Q");
    expect(enSpeciesName(customSpeciesStub(10001, "Phantowl"))).toBe("Phantowl");
    expect(spyT).not.toHaveBeenCalled();
  });

  it("without the spy, the English (active=en) result equals what the helper returns - zero English regression", () => {
    // No stub here: the test env's active language IS English, so the localized
    // `move.name` lookup and the forced-English helper must be byte-identical.
    const localized = String(i18next.t("move:pound.name"));
    expect(enMoveName(moveStub(MoveId.POUND))).toBe(localized);
    const localizedSpecies = String(i18next.t("pokemon:bulbasaur"));
    expect(enSpeciesName(speciesStub(SpeciesId.BULBASAUR))).toBe(localizedSpecies);
  });
});
