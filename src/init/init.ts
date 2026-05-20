import "#app/extensions"; // Setup Phaser extension methods/etc

import { initAbilities } from "#abilities/init-abilities";
import { initPokemonPrevolutions, initPokemonStarters } from "#balance/pokemon-evolutions";
import { initSpecies } from "#balance/pokemon-species";
import { initChallenges } from "#data/challenge";
import { initTrainerTypeDialogue } from "#data/dialogue";
import { initEliteReduxCustomAbilities } from "#data/elite-redux/init-elite-redux-custom-abilities";
import { initEliteReduxCustomMoves } from "#data/elite-redux/init-elite-redux-custom-moves";
import { initEliteReduxCustomSpecies } from "#data/elite-redux/init-elite-redux-custom-species";
import { initEliteReduxSpecies } from "#data/elite-redux/init-elite-redux-species";
import { initPokemonForms } from "#data/pokemon-forms";
import { initBiomeBgmLoopPoints } from "#init/init-biome-bgm-loop-points";
import { initBiomeDepths } from "#init/init-biome-depths";
import { initBiomes } from "#init/init-biomes";
import { initCatchableSpecies } from "#init/init-catchable-species";
import { initModifierPools } from "#modifiers/init-modifier-pools";
import { initModifierTypes } from "#modifiers/modifier-type";
import { initMoves } from "#moves/move";
import { initMysteryEncounters } from "#mystery-encounters/mystery-encounters";
import { initAchievements } from "#system/achv";
import { initVouchers } from "#system/voucher";
import { initStatsKeys } from "#ui/game-stats-ui-handler";

export function initializeGame() {
  initBiomeBgmLoopPoints();
  initModifierTypes();
  initModifierPools();
  initAchievements();
  initVouchers();
  initStatsKeys();
  initPokemonPrevolutions();
  initPokemonStarters();
  initBiomes();
  initCatchableSpecies();
  initBiomeDepths();
  initPokemonForms();
  initTrainerTypeDialogue();
  initSpecies();
  initMoves();
  initAbilities();
  initChallenges();
  initMysteryEncounters();
  // Elite Redux Phase B1a: install ER 3-passive triples on vanilla species.
  // Must run AFTER initSpecies() (needs allSpecies populated) and AFTER
  // initAbilities() (so ability ids resolve cleanly when activated later).
  initEliteReduxSpecies();
  // Elite Redux Phase B1b: register 881 ER-custom species (ids ≥ 10000).
  // Must run AFTER initEliteReduxSpecies() since it appends to allSpecies.
  const customResult = initEliteReduxCustomSpecies();
  if (customResult.errors.length > 0) {
    console.warn(
      `[er-b1b] ${customResult.errors.length} species construction errors:`,
      customResult.errors.slice(0, 5),
    );
  }
  console.info(
    `[er-b1b] registered ${customResult.customsAdded} ER-custom species (skipped ${customResult.customsAlreadyPresent} already present)`,
  );
  // Elite Redux Phase B2: register ER-custom abilities + moves (ids ≥ 5000).
  // Must run AFTER initAbilities() / initMoves() so the vanilla baselines
  // are in place.
  const abilityResult = initEliteReduxCustomAbilities();
  if (abilityResult.errors.length > 0) {
    console.warn(
      `[er-b2] ${abilityResult.errors.length} ability construction errors:`,
      abilityResult.errors.slice(0, 5),
    );
  }
  console.info(
    `[er-b2] registered ${abilityResult.customsAdded} ER-custom abilities (skipped ${abilityResult.customsAlreadyPresent} already present)`,
  );
  const moveResult = initEliteReduxCustomMoves();
  if (moveResult.errors.length > 0) {
    console.warn(`[er-b2] ${moveResult.errors.length} move construction errors:`, moveResult.errors.slice(0, 5));
  }
  console.info(
    `[er-b2] registered ${moveResult.customsAdded} ER-custom moves (skipped ${moveResult.customsAlreadyPresent} already present)`,
  );
}
