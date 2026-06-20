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

  it("every reachable ER mega form's sprite path is elite-redux/<slug>, never the vanilla {id}-{key} fallback", () => {
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
      const path = form.getSpriteAtlasPath(false, species.forms.indexOf(form), false, 0, false);
      if (!path.startsWith("elite-redux/")) {
        broken.push(`${entry.formName} of species ${pkrgId} (formKey "${entry.formKey}") -> "${path}"`);
      }
    }
    // Sanity: the full mega set (294 entries minus a few id-map-drift drops) was examined.
    expect(checked).toBeGreaterThan(250);
    expect(broken, `megas still on the vanilla sprite path (should be empty):\n${broken.join("\n")}`).toEqual([]);
  });

  it("Wigglytuff Mega Y (the reported case) resolves to elite-redux/wigglytuff_mega", () => {
    const wigglytuff = allSpecies.find(s => s.speciesId === 40);
    expect(wigglytuff, "Wigglytuff (species 40) should exist").toBeDefined();
    const megaY = wigglytuff!.forms.find(f => f.formKey === "mega-y");
    expect(megaY, "Wigglytuff should have a mega-y form injected").toBeDefined();
    const idx = wigglytuff!.forms.indexOf(megaY!);
    expect(megaY!.getSpriteAtlasPath(false, idx, false, 0, false)).toBe("elite-redux/wigglytuff_mega/front");
    expect(megaY!.getSpriteAtlasPath(false, idx, false, 0, true)).toBe("elite-redux/wigglytuff_mega/back");
  });
});
