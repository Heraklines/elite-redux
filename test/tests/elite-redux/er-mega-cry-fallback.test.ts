/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (live 2026-07-16): testers' consoles spammed `cry/663-mega not
// found` and `cry/503-mega not found` on every summon. ER adds mega forms the
// official games never had (Mega Talonflame 663, Mega Samurott 503); their
// sprite art ships on the er-assets CDN but no dedicated cry recording does, so
// the vanilla `getCryKey` scheme (`cry/<id>-mega`) fetched a nonexistent file
// that 404'd PERMANENTLY.
//
// Fix: `PokemonSpecies.getCryKey` consults the shipped mega/primal cry manifest
// (`er-mega-cry-manifest.ts`, a mirror of er-assets `audio/cry`). A mega/primal
// form whose cry is not shipped falls back to the BASE species cry (which always
// exists), so a real cry plays and nothing 404s. A mega that DOES ship a cry
// (Mega Garchomp `cry/445-mega`) is untouched.
//
// Gated behind ER_SCENARIO=1 (needs the ER species/form registry initialized).
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { AVAILABLE_MEGA_FORM_CRIES, isMegaFamilyFormCry } from "#data/elite-redux/er-mega-cry-manifest";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The formIndex of a species' mega/primal form, or -1 if it has none. */
function megaFormIndex(speciesId: SpeciesId): number {
  const species = getPokemonSpecies(speciesId);
  return species.forms.findIndex(f => isMegaFamilyFormCry(`${speciesId}-${f.formKey}`));
}

describe.skipIf(!RUN)("ER mega cry falls back to base when no mega cry ships (cry/663-mega, cry/503-mega)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("Mega Talonflame (663) resolves to the base cry, not the missing cry/663-mega", () => {
    const idx = megaFormIndex(SpeciesId.TALONFLAME);
    expect(idx, "Talonflame should have a mega form injected").toBeGreaterThan(0);
    expect(AVAILABLE_MEGA_FORM_CRIES.has("663-mega"), "no 663-mega cry ships").toBe(false);
    expect(getPokemonSpecies(SpeciesId.TALONFLAME).getCryKey(idx)).toBe("cry/663");
  });

  it("Mega Samurott (503) resolves to the base cry, not the missing cry/503-mega", () => {
    const idx = megaFormIndex(SpeciesId.SAMUROTT);
    expect(idx, "Samurott should have a mega form injected").toBeGreaterThan(0);
    expect(AVAILABLE_MEGA_FORM_CRIES.has("503-mega"), "no 503-mega cry ships").toBe(false);
    expect(getPokemonSpecies(SpeciesId.SAMUROTT).getCryKey(idx)).toBe("cry/503");
  });

  it("Mega Garchomp (445) keeps its shipped mega cry cry/445-mega", () => {
    const idx = megaFormIndex(SpeciesId.GARCHOMP);
    expect(idx, "Garchomp should have a mega form").toBeGreaterThan(0);
    expect(AVAILABLE_MEGA_FORM_CRIES.has("445-mega"), "445-mega cry ships").toBe(true);
    expect(getPokemonSpecies(SpeciesId.GARCHOMP).getCryKey(idx)).toBe("cry/445-mega");
  });

  it("GENERAL: no reachable form ever RESOLVES to a mega/primal cry key that is not shipped (the 404 invariant)", () => {
    // The core invariant: whatever key getCryKey RETURNS, if it is a mega/primal
    // key it MUST have a shipped file. Any unshipped mega form must have fallen
    // back to a plain base cry. Asserted on the OUTPUT, so it is robust to the
    // internal `speciesId %= 2000` reduction (a regional form like Galar Slowbro
    // 4080 correctly resolves to the base-species Mega Slowbro cry `cry/80-mega`).
    const offenders: string[] = [];
    for (const species of allSpecies) {
      if (species.speciesId >= 10000) {
        continue; // ER custom species override getCryKey separately (see er-custom-crykey.test.ts).
      }
      for (let i = 0; i < species.forms.length; i++) {
        const key = species.getCryKey(i);
        const bare = key.slice("cry/".length);
        if (isMegaFamilyFormCry(bare) && !AVAILABLE_MEGA_FORM_CRIES.has(bare)) {
          offenders.push(`species ${species.speciesId} form ${i} (${species.forms[i].formKey}) -> ${key} (would 404)`);
        }
      }
    }
    expect(offenders, `mega cry keys that would 404:\n${offenders.join("\n")}`).toEqual([]);
  });
});
