/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression: the battle "top" Pokémon icon (party-icon row / enemy info panel)
// was WRONG for Elite Redux forms of vanilla species.
//
// Root cause — ER adds extra forms (e.g. formKey "redux") to vanilla species,
// but those forms have no dedicated frame in the bundled `pokemon_icons_N`
// atlas. `Pokemon.getIconId` therefore returns e.g. "21-redux" for a redux
// Spearow, a frame that does not exist, so the sprite kept whatever stale frame
// `setFrame` left it on (it looked like a Mega Charizard).
//
// The base-form fallback in `BattleScene.addPokemonIcon` was itself broken: it
// called `getSpeciesForm(...).getIconId(false, 0, …)` expecting formIndex 0 to
// yield the base frame, but `PokemonForm.getFormSpriteKey` ignores the passed
// index and re-appends its own `formKey` — producing the SAME "21-redux" string.
// `icon.texture.has("21-redux")` was false, so no fallback frame was applied.
//
// The fix adds `Pokemon.getBaseIconId`, which resolves the base frame off the
// *species* object (forms[0]) so it returns "21" (or "21s" shiny, "521-f"
// gendered, …) — a frame that exists.
//
// This test asserts the frame-id COMPUTATION (deterministic, headless-safe):
//   - redux form `getIconId` → "<id>-redux"  (the broken/missing frame)
//   - redux form `getBaseIconId` → "<id>"     (the correct base frame)
//   - shiny redux `getBaseIconId` → "<id>s"
//   - vanilla base form is unaffected (no regression)
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Find the formIndex of the "redux" form on a species, or -1 if absent. */
function reduxFormIndex(speciesId: number): number {
  const species = allSpecies.find(s => (s.speciesId as number) === speciesId);
  if (!species) {
    return -1;
  }
  return (species.forms ?? []).findIndex(f => f.formKey === "redux");
}

describe.skipIf(!RUN)("ER redux-form battle icon id", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("redux form's getIconId is the missing '<id>-redux' frame, getBaseIconId is the correct '<id>' base frame", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);

    const idx = reduxFormIndex(SpeciesId.SPEAROW);
    expect(idx).toBeGreaterThanOrEqual(0); // sanity: Spearow has an ER redux form
    const spearow = allSpecies.find(s => (s.speciesId as number) === SpeciesId.SPEAROW)!;

    const mon = game.scene.addPlayerPokemon(spearow, 20, undefined, idx);
    mon.shiny = false;

    // The form frame that the bundled atlas does NOT contain (the bug source).
    expect(mon.getIconId(true, false)).toBe(`${SpeciesId.SPEAROW}-redux`);

    // The fallback now resolves to the real base frame, NOT another "-redux".
    expect(mon.getBaseIconId(false)).toBe(`${SpeciesId.SPEAROW}`);
    expect(mon.getBaseIconId(false)).not.toContain("redux");

    // Shiny base frame must carry the shiny suffix so the correct shiny base icon shows.
    mon.shiny = true;
    mon.variant = 0;
    expect(mon.getBaseIconId(false)).toBe(`${SpeciesId.SPEAROW}s`);

    mon.destroy();
  });

  it("regression check across all ER redux forms: base icon id never contains a form suffix", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);

    let checked = 0;
    for (const species of allSpecies) {
      if ((species.speciesId as number) >= 10000) {
        continue; // ER-custom species use their own per-slug icon atlas, not this path
      }
      const idx = (species.forms ?? []).findIndex(f => f.formKey === "redux");
      if (idx < 0) {
        continue;
      }
      const mon = game.scene.addPlayerPokemon(species, 5, undefined, idx);
      mon.shiny = false;
      const baseFrame = mon.getBaseIconId(false);
      // The base frame is exactly the (possibly gendered) species id with no
      // ER form suffix appended — i.e. a frame that exists in pokemon_icons_N.
      expect(baseFrame).not.toContain("-redux");
      expect(baseFrame.startsWith(`${species.speciesId}`)).toBe(true);
      mon.destroy();
      checked++;
    }
    // We enumerated a meaningful number of redux forms (currently 150+).
    expect(checked).toBeGreaterThan(100);
  });

  it("vanilla base form is unaffected (no regression)", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const mon = game.field.getPlayerPokemon();
    mon.shiny = false;
    // Base-form Magikarp: getIconId and getBaseIconId agree on the plain id frame.
    expect(mon.getIconId(true, false)).toBe(`${SpeciesId.MAGIKARP}`);
    expect(mon.getBaseIconId(false)).toBe(`${SpeciesId.MAGIKARP}`);
  });
});
