/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Regression: injected ER-custom forms (Wispywaspy Hivemind, Darmanitan Blunder)
// must resolve their sprite/icon via the ER slug scheme — NOT the broken
// `{speciesId}` / `{speciesId}-{formKey}` fallback. Seeding forms onto an
// ErCustomSpecies makes getSpeciesForm() return plain PokemonForm objects that
// lose the species-level slug overrides; the form-sprite redirect restores them
// for BOTH the seeded base form and the injected alternate. Gated ER_SCENARIO=1.

import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER injected-custom-form sprites resolve via slug scheme", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  // [base speciesId, base slug, alternate formKey, alternate slug]
  const CASES: [number, string, string, string][] = [
    [10065, "wispywaspy", "hivemind", "wispywaspy_hivemind"],
    [10813, "darmanitan_redux_bond", "blunder", "darmanitan_redux_blunder"],
    // Redux-custom species with an injected MEGA form (injectAllErMegaForms):
    // both the seeded base form and the mega form must use ER slugs.
    [10773, "mawile_redux_b", "mega", "mawile_redux_b_mega"],
  ];

  it.each(CASES)("species %i base+alternate forms use ER slugs", (id, baseSlug, altKey, altSlug) => {
    const sp = getPokemonSpecies(id as unknown as number);
    expect(sp).toBeDefined();
    const baseForm = sp.forms[0];
    const altIdx = sp.forms.findIndex(f => f.formKey === altKey);
    expect(altIdx).toBeGreaterThan(0);
    const altForm = sp.forms[altIdx];

    // Base form (the object getSpeciesForm(0) returns) must NOT fall back to the
    // bare `{speciesId}` vanilla scheme.
    expect(baseForm.getSpriteAtlasPath(false, 0, false, 0, false)).toBe(`elite-redux/${baseSlug}/front`);
    expect(baseForm.getIconAtlasKey(0, false, 0)).toBe(`er_icon__${baseSlug}`);

    // Alternate form points at its SOURCE custom species' art (not `{id}-{key}`).
    expect(altForm.getSpriteAtlasPath(false, altIdx, false, 0, false)).toBe(`elite-redux/${altSlug}/front`);
    expect(altForm.getSpriteAtlasPath(false, altIdx, false, 0, true)).toBe(`elite-redux/${altSlug}/back`);
    expect(altForm.getIconAtlasKey(altIdx, false, 0)).toBe(`er_icon__${altSlug}`);
  });
});
