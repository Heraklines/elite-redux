import { consumePendingDevStarters } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { Phase } from "#app/phase";
import { allMoves } from "#data/data-lists";
import { applyErBlackShinyKit } from "#data/elite-redux/er-black-shinies";
import { PokemonMove } from "#moves/pokemon-move";

/** Throwaway save slot used by dev test-scenarios so they don't clobber slot 0. */
const DEV_SCENARIO_SLOT = 4;

import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { Gender } from "#data/gender";
import { ChallengeType } from "#enums/challenge-type";
import { UiMode } from "#enums/ui-mode";
import { overrideHeldItems, overrideModifiers } from "#modifiers/modifier";
import type { Starter } from "#types/save-data";
import { SaveSlotUiMode } from "#ui/handlers/save-slot-select-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import SoundFade from "phaser3-rex-plugins/plugins/soundfade";

export class SelectStarterPhase extends Phase {
  public readonly phaseName = "SelectStarterPhase";
  start() {
    super.start();

    // Local-only dev tools: a test scenario may have staged a party so we can
    // drop straight into the battle, skipping starter-select. consumePending…
    // returns null in production / on a clean checkout, so this is inert there.
    const devStarters = consumePendingDevStarters();
    if (devStarters && devStarters.length > 0) {
      globalScene.sessionSlotId = DEV_SCENARIO_SLOT;
      // Dev scenarios hand-pick movesets for TESTING (e.g. Thunder Wave on a
      // Blastoise) — skip the starter-legality validation that silently
      // rejected them and left scenario mons with NO moves.
      this.initBattle(devStarters, true);
      return;
    }

    globalScene.playBgm("menu");

    globalScene.ui.setMode(UiMode.STARTER_SELECT, (starters: Starter[]) => {
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.SAVE_SLOT, SaveSlotUiMode.SAVE, (slotId: number) => {
        // If clicking cancel, back out to title screen
        if (slotId === -1) {
          globalScene.phaseManager.toTitleScreen();
          this.end();
          return;
        }
        globalScene.sessionSlotId = slotId;
        this.initBattle(starters);
      });
    });
  }

  /**
   * Initialize starters before starting the first battle
   * @param starters - Array of {@linkcode Starter}s with which to start the battle
   */
  initBattle(starters: Starter[], ignoreMovesetValidation = false) {
    const party = globalScene.getPlayerParty();
    const loadPokemonAssets: Promise<void>[] = [];
    starters.forEach((starter: Starter, i: number) => {
      if (!i && Overrides.STARTER_SPECIES_OVERRIDE) {
        starter.speciesId = Overrides.STARTER_SPECIES_OVERRIDE;
      }
      const species = getPokemonSpecies(starter.speciesId);
      let starterFormIndex = starter.formIndex;
      if (
        starter.speciesId in Overrides.STARTER_FORM_OVERRIDES
        && Overrides.STARTER_FORM_OVERRIDES[starter.speciesId] != null
        && species.forms[Overrides.STARTER_FORM_OVERRIDES[starter.speciesId]!]
      ) {
        starterFormIndex = Overrides.STARTER_FORM_OVERRIDES[starter.speciesId]!;
      }

      let starterGender =
        species.malePercent === null ? Gender.GENDERLESS : starter.female ? Gender.FEMALE : Gender.MALE;
      if (Overrides.GENDER_OVERRIDE !== null) {
        starterGender = Overrides.GENDER_OVERRIDE;
      }
      const starterPokemon = globalScene.addPlayerPokemon(
        species,
        globalScene.gameMode.getStartingLevel(),
        starter.abilityIndex,
        starterFormIndex,
        starterGender,
        starter.shiny,
        starter.variant,
        starter.ivs,
        starter.nature,
      );
      if (starter.moveset) {
        starterPokemon.tryPopulateMoveset(starter.moveset, ignoreMovesetValidation);
      }
      // ER (community report 2026-06-11): some lines' EARLY learnset is all
      // status moves (Krabby Redux opens Kinesis/Showtime/Meditate/...), so a
      // starter could begin the run with NO damaging move at all. Guarantee
      // one: swap the last slot for the line's earliest damaging level-up
      // move (skipped for dev scenarios, whose movesets are intentional).
      if (!ignoreMovesetValidation) {
        ensureStarterHasDamagingMove(starterPokemon);
      }
      // ER Black Shinies (#349): a starter chosen at the BLACK tier enters the
      // run as a full t4 (epic base + gift kit). One per team is implicit:
      // only one starter can be black since the unlock is per-line and the
      // roll guard caps player teams at one anyway.
      if (starter.erBlackShiny) {
        starterPokemon.shiny = true;
        starterPokemon.variant = 2;
        applyErBlackShinyKit(starterPokemon);
      }
      if (starter.passive) {
        starterPokemon.passive = true;
      }
      starterPokemon.luck = globalScene.gameData.getDexAttrLuck(
        globalScene.gameData.dexData[species.speciesId].caughtAttr,
      );
      if (starter.pokerus) {
        starterPokemon.pokerus = true;
      }

      if (starter.nickname) {
        starterPokemon.nickname = starter.nickname;
      }

      if (starter.teraType == null) {
        starterPokemon.teraType = starterPokemon.species.type1;
      } else {
        starterPokemon.teraType = starter.teraType;
      }

      if (globalScene.gameMode.isSplicedOnly || Overrides.STARTER_FUSION_OVERRIDE) {
        starterPokemon.generateFusionSpecies(true);
      }
      starterPokemon.setVisible(false);
      const chalApplied = applyChallenges(ChallengeType.STARTER_MODIFY, starterPokemon);
      party.push(starterPokemon);
      if (chalApplied) {
        // If any challenges modified the starter, it should update
        loadPokemonAssets.push(starterPokemon.updateInfo());
      }
      loadPokemonAssets.push(starterPokemon.loadAssets());
    });
    overrideModifiers();
    overrideHeldItems(party[0]);
    Promise.all(loadPokemonAssets).then(() => {
      // Guard: the menu BGM may not exist (e.g. the AudioContext never started
      // because the browser blocked autoplay). Fading out a null sound throws,
      // which would reject this promise and leave the run stuck on a blank field.
      const menuBgm = globalScene.sound.get("menu");
      if (menuBgm) {
        SoundFade.fadeOut(globalScene, menuBgm, 500, true);
      }
      globalScene.time.delayedCall(500, () => globalScene.playBgm());
      if (globalScene.gameMode.isClassic) {
        globalScene.gameData.gameStats.classicSessionsPlayed++;
      } else {
        globalScene.gameData.gameStats.endlessSessionsPlayed++;
      }
      globalScene.newBattle();
      globalScene.arena.init();
      globalScene.sessionPlayTime = 0;
      globalScene.lastSavePlayTime = 0;
      // Ensures Keldeo (or any future Pokemon that have this type of form change) starts in the correct form
      globalScene.getPlayerParty().forEach(p => {
        globalScene.triggerPokemonFormChange(p, SpeciesFormChangeMoveLearnedTrigger);
      });
      this.end();
    });
  }
}

/**
 * ER: guarantee a freshly created starter has at least ONE damaging move.
 * Some ER learnsets open with nothing but status moves (Krabby Redux), which
 * left the run unwinnable from turn 1. Replaces the last moveset slot (or
 * fills an empty one) with the line's earliest damaging level-up move.
 */
function ensureStarterHasDamagingMove(pokemon: ReturnType<typeof globalScene.addPlayerPokemon>): void {
  const moveset = pokemon.getMoveset();
  if (moveset.some(m => (m?.getMove()?.power ?? 0) > 0)) {
    return;
  }
  const firstDamaging = pokemon
    .getLevelMoves(1, true, false, true)
    .map(lm => lm[1])
    .find(moveId => (allMoves[moveId]?.power ?? 0) > 0);
  if (firstDamaging === undefined) {
    return;
  }
  if (moveset.length < 4) {
    pokemon.moveset.push(new PokemonMove(firstDamaging));
  } else {
    pokemon.moveset[3] = new PokemonMove(firstDamaging);
  }
}
