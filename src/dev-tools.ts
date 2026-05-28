// =============================================================================
// Dev-only test harness. Exposes `window.dev` with helpers to jump straight to
// any UI screen with generated test data — no menu-driving required.
//
// Stripped from production: the only call site (battle-scene initGlobalScene)
// guards on `import.meta.env.DEV`, and this module's heavy imports are only
// pulled in there.
//
// Usage from the browser console (or Puppeteer page.evaluate):
//   dev.scene                       → the live BattleScene (globalScene)
//   dev.summary("BOUFFALANT")       → open the Pokémon summary on a fresh mon
//   dev.summary(626, { page: 1 })   → open summary directly on page index 1
//   dev.pokedex("SWINUB_REDUX")     → open the Pokédex page for a species
//   dev.makeMon("BOUFFALANT", 50)   → return a PlayerPokemon instance
//   dev.species("PHANTOWL")         → resolve a PokemonSpecies by name or id
//   dev.UiMode, dev.SpeciesId       → enums for ad-hoc calls
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { allSpecies } from "#data/data-lists";
import type { PokemonSpecies } from "#data/pokemon-species";
import { GameModes, getGameMode } from "#app/game-mode";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Resolve a species by numeric id, SpeciesId enum key, or display name. */
function resolveSpecies(ref: number | string): PokemonSpecies {
  if (typeof ref === "number") {
    return getPokemonSpecies(ref as SpeciesId);
  }
  // Try SpeciesId enum key (e.g. "BOUFFALANT", "SWINUB_REDUX").
  const enumVal = (SpeciesId as Record<string, number>)[ref.toUpperCase()];
  if (typeof enumVal === "number") {
    return getPokemonSpecies(enumVal as SpeciesId);
  }
  // Fall back to case-insensitive display-name match across allSpecies.
  const lower = ref.toLowerCase();
  const byName = allSpecies.find(s => s.name?.toLowerCase() === lower);
  if (byName) {
    return byName;
  }
  throw new Error(`dev.species: could not resolve "${ref}"`);
}

export function installDevTools(scene: BattleScene): void {
  const dev = {
    /** The live BattleScene. */
    get scene() {
      return scene;
    },
    UiMode,
    SpeciesId,

    /** Resolve a species by id / enum-key / display name. */
    species: resolveSpecies,

    /** Generate a fresh PlayerPokemon (not added to party). */
    makeMon(ref: number | string, level = 50) {
      // Pokemon construction reads scene.gameMode (trySetShiny etc.). At the
      // title screen it's unset — default to CLASSIC so dev calls work.
      if (!scene.gameMode) {
        scene.gameMode = getGameMode(GameModes.CLASSIC);
      }
      return scene.addPlayerPokemon(resolveSpecies(ref), level);
    },

    /**
     * Open the Pokémon summary screen on a freshly-generated mon.
     * @param ref species id / enum-key / display name
     * @param opts.page start page index (0=STATUS, see Page enum)
     * @param opts.level mon level (default 50)
     */
    summary(
      ref: number | string,
      opts: { page?: number; level?: number; passive?: boolean; passiveAttr?: number } = {},
    ) {
      const mon = this.makeMon(ref, opts.level ?? 50);
      // Force the passive/innate slots on for layout testing (a freshly
      // generated mon has no unlocked passive by default).
      if (opts.passive) {
        (mon as { passive: boolean }).passive = true;
      }
      // Optionally set the candy-unlock bitmask so the ABILITIES page can be
      // tested across unlocked / disabled / locked innate states.
      if (opts.passiveAttr !== undefined) {
        const rootId = mon.species.getRootSpeciesId();
        if (scene.gameData.starterData[rootId]) {
          scene.gameData.starterData[rootId].passiveAttr = opts.passiveAttr;
        }
      }
      return scene.ui.setOverlayMode(UiMode.SUMMARY, mon, undefined, opts.page);
    },

    /** Open the Pokédex detail page for a species. */
    pokedex(ref: number | string) {
      const species = resolveSpecies(ref);
      return scene.ui.setOverlayMode(UiMode.POKEDEX_PAGE, species, null);
    },

    /** Jump the UI to an arbitrary mode (advanced). */
    setMode(mode: number, ...args: unknown[]) {
      return scene.ui.setMode(mode, ...args);
    },
  };

  (globalThis as { dev?: typeof dev }).dev = dev;
  // eslint-disable-next-line no-console
  console.log("[dev-tools] window.dev ready — try dev.summary('BOUFFALANT')");
}
