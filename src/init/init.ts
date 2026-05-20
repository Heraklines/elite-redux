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
import { initEliteReduxTrainers } from "#data/elite-redux/init-elite-redux-trainers";
import { initEliteReduxVanillaRebalance } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
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
  // Elite Redux Phase B3: patch ER's stat rebalances onto vanilla moves +
  // abilities. Must run AFTER initEliteReduxCustomAbilities() and
  // initEliteReduxCustomMoves() so we know which ids are customs (skipped)
  // and which are vanilla (patched).
  const rebalanceResult = initEliteReduxVanillaRebalance();
  if (rebalanceResult.moveErrors.length > 0 || rebalanceResult.abilityErrors.length > 0) {
    console.warn(
      `[er-b3] rebalance errors: ${rebalanceResult.moveErrors.length} moves, ${rebalanceResult.abilityErrors.length} abilities`,
      [...rebalanceResult.moveErrors.slice(0, 3), ...rebalanceResult.abilityErrors.slice(0, 3)],
    );
  }
  console.info(
    `[er-b3] vanilla rebalance applied: ${rebalanceResult.moveDeltas} move deltas (${rebalanceResult.moveFieldWrites} field writes), ${rebalanceResult.abilityDeltas} ability deltas, ${rebalanceResult.moveMissing} moves + ${rebalanceResult.abilityMissing} abilities skipped (id-map drift)`,
  );
  // Elite Redux Phase B4: populate the ER trainer registry. Must run AFTER
  // initEliteReduxCustomSpecies() and initEliteReduxCustomMoves() so the
  // species/move ids the registry references are guaranteed-resolvable
  // downstream (the registry itself only translates ER ids — the constraint
  // is on consumers, not this initializer).
  const trainerResult = initEliteReduxTrainers();
  if (trainerResult.errors.length > 0) {
    console.warn(
      `[er-b4] ${trainerResult.errors.length} trainer registration errors:`,
      trainerResult.errors.slice(0, 5),
    );
  }
  console.info(
    `[er-b4] registered ${trainerResult.trainersRegistered} ER trainers in registry (skipped ${trainerResult.trainersSkipped} already present, dropped ${trainerResult.trainersDroppedMissingSpecies} for missing-species drift)`,
  );
}
