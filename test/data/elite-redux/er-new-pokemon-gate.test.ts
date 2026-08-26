/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  isGatedNewPokemonAbilityId,
  isGatedNewPokemonFormSlug,
  isGatedNewPokemonStoneName,
  resolveNewPokemonContentEnabled,
} from "#data/elite-redux/er-new-pokemon-gate";
import { describe, expect, it } from "vitest";

describe("new Pokemon release gate", () => {
  it("fails closed for deployed builds and defaults on only for development/test", () => {
    expect(resolveNewPokemonContentEnabled(undefined, "standalone")).toBe(false);
    expect(resolveNewPokemonContentEnabled(undefined, "production")).toBe(false);
    expect(resolveNewPokemonContentEnabled(undefined, "development")).toBe(true);
    expect(resolveNewPokemonContentEnabled(undefined, "test")).toBe(true);
    expect(resolveNewPokemonContentEnabled("on", "standalone")).toBe(true);
    expect(resolveNewPokemonContentEnabled("off", "development")).toBe(false);
  });

  it("covers the added ability, form, and stone bands without gating released content", () => {
    expect(isGatedNewPokemonAbilityId(6004)).toBe(true);
    expect(isGatedNewPokemonAbilityId(6116)).toBe(true);
    expect(isGatedNewPokemonAbilityId(5998)).toBe(false);
    expect(isGatedNewPokemonFormSlug("raichu_alolan_mega_female")).toBe(true);
    expect(isGatedNewPokemonFormSlug("fidough_partner_mega")).toBe(false);
    expect(isGatedNewPokemonStoneName("ALORAICHUNITE")).toBe(true);
    expect(isGatedNewPokemonStoneName("FIDOUGHITE")).toBe(false);
  });
});
