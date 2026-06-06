/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Regression: ER-NEW mega forms (on species with no vanilla mega) must resolve
// their sprite to the ER `elite-redux/{slug}/…` art, NOT the vanilla
// `{speciesId}-mega` path which 404s/403s and (on the live build) hangs the
// loader. Repro: Mega Goodra Hisuian (6706) showed as a substitute and froze a
// veteran fight. Gated ER_SCENARIO=1.

import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER-new mega forms resolve to ER slug sprites", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("Goodra Hisuian's mega form points at elite-redux art, not 6706-mega", () => {
    const sp = getPokemonSpecies(6706 as unknown as number);
    const mega = sp.forms.find(f => f.formKey === "mega");
    expect(mega).toBeDefined();
    const path = mega!.getSpriteAtlasPath(false, sp.forms.indexOf(mega!), false, 0, false);
    expect(path).toBe("elite-redux/goodra_hisuian_mega/front");
    expect(path).not.toContain("6706");
  });

  it("no injected ER-new mega form resolves to a bare {id}-mega vanilla path", () => {
    // Spot-check a few species that have an ER-only mega (no vanilla mega) and
    // whose ER art exists: each must NOT fall back to the {id}-{key} scheme.
    const offenders: string[] = [];
    for (const sp of [getPokemonSpecies(6706 as unknown as number)]) {
      for (const f of sp.forms) {
        if (f.formKey !== "mega") {
          continue;
        }
        const path = f.getSpriteAtlasPath(false, sp.forms.indexOf(f), false, 0, false);
        if (/^\d+-mega$/.test(path)) {
          offenders.push(`${sp.name}:${path}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
