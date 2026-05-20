import "#app/extensions"; // Setup Phaser extension methods/etc

import { initAbilities } from "#abilities/init-abilities";
import { initPokemonPrevolutions, initPokemonStarters } from "#balance/pokemon-evolutions";
import { initSpecies } from "#balance/pokemon-species";
import { initChallenges } from "#data/challenge";
import { initTrainerTypeDialogue } from "#data/dialogue";
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
}
