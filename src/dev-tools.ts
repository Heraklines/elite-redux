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
import defaultOverrides from "#app/overrides";
import { PlayerPokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { Gender } from "#data/gender";
import type { Starter } from "#ui/handlers/starter-select-ui-handler";
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

    /**
     * Open the starter-select (status selection) screen. Sets CLASSIC mode
     * first. Call from the title screen. Useful for iterating on the
     * starter panel / passive placement / hotkey layout.
     */
    starterSelect() {
      scene.gameMode = getGameMode(GameModes.CLASSIC);
      return scene.ui.setMode(UiMode.STARTER_SELECT, () => {});
    },

    /** Jump the UI to an arbitrary mode (advanced). */
    setMode(mode: number, ...args: unknown[]) {
      return scene.ui.setMode(mode, ...args);
    },

    /** Open the summary (ABILITIES page) for the current enemy — inspect test. */
    inspectEnemy(page = 1) {
      const enemy = scene.getEnemyParty?.()[0];
      if (!enemy) {
        throw new Error("dev.inspectEnemy: no enemy on field");
      }
      return scene.ui.setOverlayMode(UiMode.SUMMARY, enemy, undefined, page);
    },

    /**
     * Start a Classic-mode battle immediately with a chosen party + enemy —
     * bypasses title/starter-select. For testing ER abilities, innates, moves
     * and asset loading in real combat.
     *
     * MUST be called from the title screen (TitlePhase active). The puppeteer
     * helper presses Enter to reach the title first.
     *
     * @example dev.battle({ player: ["BOUFFALANT","ABOMASNOW_MEGA"], enemy: "GYARADOS", enemyLevel: 50 })
     */
    battle(
      opts: {
        player?: (number | string)[];
        enemy?: number | string;
        level?: number;
        enemyLevel?: number;
        passive?: boolean;
      } = {},
    ) {
      const ovr = defaultOverrides as unknown as Record<string, unknown>;
      if (opts.enemy !== undefined) {
        ovr.ENEMY_SPECIES_OVERRIDE = resolveSpecies(opts.enemy).speciesId;
      }
      if (opts.enemyLevel !== undefined) {
        ovr.ENEMY_LEVEL_OVERRIDE = opts.enemyLevel;
      }
      if (opts.level !== undefined) {
        ovr.STARTING_LEVEL_OVERRIDE = opts.level;
      }

      scene.gameMode = getGameMode(GameModes.CLASSIC);

      const speciesRefs = opts.player && opts.player.length > 0 ? opts.player : ["BOUFFALANT"];
      const startingLevel = scene.gameMode.getStartingLevel();
      const starters: Starter[] = speciesRefs.slice(0, 6).map(ref => {
        const species = resolveSpecies(ref);
        const probe = new PlayerPokemon(species, startingLevel, undefined, 0);
        const gender =
          species.malePercent === null ? Gender.GENDERLESS : probe.gender;
        const starter: Starter = {
          speciesId: species.speciesId,
          shiny: probe.shiny,
          variant: probe.variant,
          formIndex: probe.formIndex,
          female: gender === Gender.FEMALE,
          ivs: probe.ivs,
          abilityIndex: probe.abilityIndex,
          passive: opts.passive ?? true,
          nature: probe.getNature(),
          pokerus: probe.pokerus,
        } as Starter;
        return starter;
      });

      // initBattle() calls SoundFade.fadeOut(scene.sound.get("menu")) — that
      // sound only exists if the menu BGM is playing. We bypass
      // SelectStarterPhase.start() (which normally plays it), so play it now
      // to give the fade a valid target (otherwise it throws on null.volume).
      scene.playBgm("menu");

      // Proven test pattern (classic-mode-helper.runToSummon): construct a
      // detached SelectStarterPhase, queue the EncounterPhase, then run
      // initBattle to build the party + first battle. The live phase manager
      // then advances into the encounter automatically.
      const phase = new SelectStarterPhase();
      scene.phaseManager.pushNew("EncounterPhase", false);
      phase.initBattle(starters);
    },
  };

  (globalThis as { dev?: typeof dev }).dev = dev;
  // eslint-disable-next-line no-console
  console.log("[dev-tools] window.dev ready — try dev.summary('BOUFFALANT')");
}
