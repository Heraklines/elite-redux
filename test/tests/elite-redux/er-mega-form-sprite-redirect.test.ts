/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Regression (mega sprites): EVERY reachable ER mega/primal/origin form must
// resolve its sprite via the ER `elite-redux/{slug}` scheme, NOT the vanilla
// `{speciesId}-{formKey}` path. The vanilla path 404s for ER art (which lives
// under the slug), so the mega renders as the BASE sprite — the "Wigglytuff
// Mega shows the normal Wigglytuff" bug. injectAllErMegaForms() only redirects
// the forms IT injects; installAllErMegaSpriteRedirects() must additionally cover
// every mega it SKIPS as "already present". Gated ER_SCENARIO=1.

import { allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MEGA_FORMS } from "#data/elite-redux/er-mega-forms";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER mega/primal forms all use the ER slug sprite scheme", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  // The SPECIES-level call (`species.getSpriteAtlasPath(female, formIndex, …)`) is
  // the path the UI (starter select / Pokedex / party) uses; it was the one still
  // 404ing after the per-form redirect, so assert it directly (the form-level path
  // was already covered by the battle render).
  it("every reachable ER mega form's SPECIES-level sprite path is elite-redux/<slug>, never the {id}-{key} fallback", () => {
    const byId = new Map(allSpecies.map(s => [s.speciesId, s]));
    const broken: string[] = [];
    let checked = 0;
    for (const entry of ER_MEGA_FORMS) {
      const pkrgId = ER_ID_MAP.species[entry.baseErId];
      const species = pkrgId === undefined ? undefined : byId.get(pkrgId);
      const form = species?.forms.find(f => f.formKey === entry.formKey);
      if (!species || !form) {
        continue; // base unmapped / form not registered — out of scope (the sweep skips it too)
      }
      checked++;
      const formIndex = species.forms.indexOf(form);
      // Species-level call (UI path) AND form-level call (battle path) must BOTH
      // resolve to the ER slug scheme.
      const speciesPath = species.getSpriteAtlasPath(false, formIndex, false, 0, false);
      const formPath = form.getSpriteAtlasPath(false, formIndex, false, 0, false);
      if (!speciesPath.startsWith("elite-redux/") || !formPath.startsWith("elite-redux/")) {
        broken.push(
          `${entry.formName} of species ${pkrgId} (formKey "${entry.formKey}") -> species="${speciesPath}" form="${formPath}"`,
        );
      }
    }
    // Sanity: the full mega set (294 entries minus a few id-map-drift drops) was examined.
    expect(checked).toBeGreaterThan(250);
    expect(broken, `megas still on the vanilla sprite path (should be empty):\n${broken.join("\n")}`).toEqual([]);
  });

  it("Wigglytuff Mega Y (the reported case) resolves to elite-redux/wigglytuff_mega via the SPECIES method", () => {
    const wigglytuff = allSpecies.find(s => s.speciesId === 40);
    expect(wigglytuff, "Wigglytuff (species 40) should exist").toBeDefined();
    const megaY = wigglytuff!.forms.find(f => f.formKey === "mega-y");
    expect(megaY, "Wigglytuff should have a mega-y form injected").toBeDefined();
    const idx = wigglytuff!.forms.indexOf(megaY!);
    // The UI path that was 404ing on `40-mega-y`:
    expect(wigglytuff!.getSpriteAtlasPath(false, idx, false, 0, false)).toBe("elite-redux/wigglytuff_mega/front");
    expect(wigglytuff!.getSpriteKey(false, idx, false, 0, false)).toBe("pkmn__er__wigglytuff_mega");
    // The base form (formIndex 0) must be UNAFFECTED — NOT hijacked onto a slug.
    expect(wigglytuff!.getSpriteAtlasPath(false, 0, false, 0, false)).not.toMatch(/^elite-redux\//);
  });
});
