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
// read the static English catalogs directly. This test deliberately makes every
// i18next lookup unavailable: the helpers must still return the canonical names
// without consulting runtime translation state.
//
// Engine-free / fast: the helpers only read `move.id` / `species.speciesId`, so
// minimal typed stubs suffice - no GameManager / ER init boot.
// =============================================================================

import type { Ability } from "#data/abilities/ability";
import { enAbilityName, enMoveName, enMoveNameForId, enSpeciesName } from "#data/elite-redux/er-canonical-names";
import { remapEliteReduxMoveIdsInMap } from "#data/elite-redux/init-elite-redux-c-source-corrections";
import type { Move } from "#data/moves/move";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import i18next from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Sentinel returned for any NON-English (unforced) `i18next.t` lookup. */
const FAKE_LOCALIZED = "__LOCALIZED_NOT_ENGLISH__";

/** Emulate a production client where the English namespace is not loaded. */
function stubUnavailableEnglishCatalog(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(i18next, "t").mockReturnValue(FAKE_LOCALIZED);
}

const moveStub = (id: MoveId): Move => ({ id }) as unknown as Move;
const abilityStub = (id: AbilityId): Ability => ({ id }) as unknown as Ability;
const speciesStub = (speciesId: SpeciesId): PokemonSpecies => ({ speciesId }) as unknown as PokemonSpecies;

/**
 * ER-CUSTOM move/species stubs: an id OUTSIDE the vanilla enum range, plus the
 * STATIC draft `.name` their real `localize()` overrides install. These have no
 * `move:` / `pokemon:` i18n entry, so the helpers must return `.name` verbatim
 * (already locale-invariant) instead of forcing a non-existent i18n key.
 */
const customMoveStub = (id: number, name: string): Move => ({ id, name }) as unknown as Move;
const customAbilityStub = (id: number, name: string): Ability => ({ id, name }) as unknown as Ability;
const customSpeciesStub = (speciesId: number, name: string): PokemonSpecies =>
  ({ speciesId, name }) as unknown as PokemonSpecies;

describe("ER canonical (locale-invariant) name keys (#633)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enMoveName returns the ENGLISH name even when the active language is not English", () => {
    const spyT = stubUnavailableEnglishCatalog();
    expect(i18next.t("move:pound.name")).toBe(FAKE_LOCALIZED);
    expect(enMoveName(moveStub(MoveId.POUND))).toBe("Pound");
    expect(enMoveName(moveStub(MoveId.TACKLE))).toBe("Tackle");
    expect(spyT).toHaveBeenCalledTimes(1);
  });

  it("enMoveNameForId resolves from static enum/catalog data only", () => {
    const spyT = vi.spyOn(i18next, "t").mockImplementation(() => {
      throw new Error("translation state must not participate in static id lookup");
    });
    expect(enMoveNameForId(MoveId.KOWTOW_CLEAVE)).toBe("Kowtow Cleave");
    expect(enMoveNameForId(MoveId.AXE_KICK)).toBe("Axe Kick");
    expect(enMoveNameForId(MoveId.NONE)).toBe("");
    expect(enMoveNameForId(5000)).toBe("");
    expect(spyT).not.toHaveBeenCalled();
  });

  it("enSpeciesName returns the ENGLISH name even when the active language is not English", () => {
    const spyT = stubUnavailableEnglishCatalog();
    expect(i18next.t("pokemon:bulbasaur")).toBe(FAKE_LOCALIZED);
    expect(enSpeciesName(speciesStub(SpeciesId.BULBASAUR))).toBe("Bulbasaur");
    expect(spyT).toHaveBeenCalledTimes(1);
  });

  it("enAbilityName returns the ENGLISH name without a loaded English namespace", () => {
    const spyT = stubUnavailableEnglishCatalog();
    expect(i18next.t("ability:stench.name")).toBe(FAKE_LOCALIZED);
    expect(enAbilityName(abilityStub(AbilityId.STENCH))).toBe("Stench");
    expect(enAbilityName(abilityStub(AbilityId.SPEED_BOOST))).toBe("Speed Boost");
    expect(spyT).toHaveBeenCalledTimes(1);
  });

  it("does not consult i18next even when translation lookup throws", () => {
    const spyT = vi.spyOn(i18next, "t").mockImplementation(() => {
      throw new Error("English namespace unavailable");
    });
    enMoveName(moveStub(MoveId.POUND));
    enSpeciesName(speciesStub(SpeciesId.BULBASAUR));
    enAbilityName(abilityStub(AbilityId.STENCH));
    expect(spyT).not.toHaveBeenCalled();
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
    const spyT = stubUnavailableEnglishCatalog();
    expect(enMoveName(customMoveStub(5140, "Spine Breaker"))).toBe("Spine Breaker");
    // The custom branch never calls i18next.t (no `{ lng: "en" }` key to resolve).
    expect(spyT).not.toHaveBeenCalled();
  });

  it("ER-CUSTOM species (id not in SpeciesId enum): returns the static draft `.name`, locale-independent", () => {
    const spyT = stubUnavailableEnglishCatalog();
    // 10000+ ids are ER customs with no `pokemon:` i18n key (e.g. "Unown Q").
    expect(enSpeciesName(customSpeciesStub(10859, "Unown Q"))).toBe("Unown Q");
    expect(enSpeciesName(customSpeciesStub(10001, "Phantowl"))).toBe("Phantowl");
    expect(spyT).not.toHaveBeenCalled();
  });

  it("ER-CUSTOM ability (id >= 5000): returns the static draft `.name` without i18next", () => {
    const spyT = stubUnavailableEnglishCatalog();
    expect(enAbilityName(customAbilityStub(5001, "Aqua Veil"))).toBe("Aqua Veil");
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

describe("ER production move-id remap is locale- and runtime-independent (#633)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("repairs the production ER draft ids identically when translation lookup is unavailable", () => {
    const makeBrokenMap = (): Record<number, number> => ({
      868: MoveId.BLOOD_MOON, // ER Kowtow Cleave was scrambled to Blood Moon.
      894: MoveId.TRAILBLAZE, // ER Axe Kick was scrambled to Trailblaze.
    });

    vi.spyOn(i18next, "t").mockImplementation(() => {
      throw new Error("runtime locale unavailable");
    });

    const first = makeBrokenMap();
    const firstCount = remapEliteReduxMoveIdsInMap(first);

    vi.restoreAllMocks();
    vi.spyOn(i18next, "t").mockReturnValue("__GERMAN_RUNTIME_NAME__");

    const second = makeBrokenMap();
    const secondCount = remapEliteReduxMoveIdsInMap(second);

    expect(firstCount).toBe(2);
    expect(secondCount).toBe(firstCount);
    expect(second).toEqual(first);
    expect(first[868]).toBe(MoveId.KOWTOW_CLEAVE);
    expect(first[894]).toBe(MoveId.AXE_KICK);
  });

  it("repairs all 67 entries in a fresh real ER_ID_MAP module, then is idempotent", async () => {
    vi.resetModules();
    const [{ ER_ID_MAP: freshIdMap }, { remapEliteReduxMoveIdsByName: freshRemap }] = await Promise.all([
      import("#data/elite-redux/er-id-map"),
      import("#data/elite-redux/init-elite-redux-c-source-corrections"),
    ]);
    vi.spyOn(i18next, "t").mockImplementation(() => {
      throw new Error("translation state must not participate in the real remap");
    });

    expect(freshRemap()).toBe(67);
    expect(freshIdMap.moves[868]).toBe(MoveId.KOWTOW_CLEAVE);
    expect(freshIdMap.moves[894]).toBe(MoveId.AXE_KICK);
    expect(freshRemap()).toBe(0);
  });
});
