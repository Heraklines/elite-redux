import "#app/extensions"; // Setup Phaser extension methods/etc

import { initAbilities } from "#abilities/init-abilities";
import { initPokemonPrevolutions, initPokemonStarters } from "#balance/pokemon-evolutions";
import { initSpecies } from "#balance/pokemon-species";
import { initChallenges } from "#data/challenge";
import { initTrainerTypeDialogue } from "#data/dialogue";
import { wireEliteReduxManualComposites } from "#data/elite-redux/abilities/composite-newcomers";
import { registerErFinalBossFormChange } from "#data/elite-redux/er-final-boss";
import {
  initEliteReduxCSourceCorrections,
  remapEliteReduxMoveIdsByName,
} from "#data/elite-redux/init-elite-redux-c-source-corrections";
import {
  initEliteReduxCustomAbilities,
  refreshEliteReduxComposites,
} from "#data/elite-redux/init-elite-redux-custom-abilities";
import { initEliteReduxCustomMons } from "#data/elite-redux/init-elite-redux-custom-mons";
import { initEliteReduxCustomMoves } from "#data/elite-redux/init-elite-redux-custom-moves";
import { initEliteReduxCustomSpecies } from "#data/elite-redux/init-elite-redux-custom-species";
import { initEliteReduxEggMoves } from "#data/elite-redux/init-elite-redux-egg-moves";
import { initEliteReduxEggTiers } from "#data/elite-redux/init-elite-redux-egg-tiers";
import { initEliteReduxErCustomFormChanges } from "#data/elite-redux/init-elite-redux-er-custom-form-changes";
import { initEliteReduxEvolutions } from "#data/elite-redux/init-elite-redux-evolutions";
import { initEliteReduxFormChanges } from "#data/elite-redux/init-elite-redux-form-changes";
import { initEliteReduxItemTuning } from "#data/elite-redux/init-elite-redux-item-tuning";
import { initEliteReduxMovesets } from "#data/elite-redux/init-elite-redux-movesets";
import { initEliteReduxPokedexOverrides } from "#data/elite-redux/init-elite-redux-pokedex-overrides";
import {
  initEliteReduxSpecies,
  injectAllErMegaForms,
  installAllErMegaSpriteRedirects,
  installAllErReduxSpriteRedirects,
} from "#data/elite-redux/init-elite-redux-species";
import { initEliteReduxSpeciesTuning } from "#data/elite-redux/init-elite-redux-species-tuning";
import { initEliteReduxStarterCosts } from "#data/elite-redux/init-elite-redux-starter-costs";
import { initEliteReduxTmMoves } from "#data/elite-redux/init-elite-redux-tm-moves";
import { initEliteReduxTrainers } from "#data/elite-redux/init-elite-redux-trainers";
import { initEliteReduxUnownSchool } from "#data/elite-redux/init-elite-redux-unown-school";
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
    `[er-b1b] registered ${customResult.customsAdded} ER-custom species (skipped ${customResult.customsAlreadyPresent} already present + ${customResult.skippedDegenerate} degenerate stubs)`,
  );
  // Elite Redux Phase B1c: data-driven mega/primal/origin FORM injection for
  // every ER mega — including ER-custom (Redux) megas, which B1a skips. Must run
  // AFTER initEliteReduxCustomSpecies() so custom bases exist in allSpecies, and
  // BEFORE initEliteReduxFormChanges() so the form-change bridge sees the forms.
  const megaFormResult = injectAllErMegaForms();
  if (megaFormResult.errors.length > 0) {
    console.warn(
      `[er-b1c] ${megaFormResult.errors.length} mega-form injection issues:`,
      megaFormResult.errors.slice(0, 5),
    );
  }
  console.info(
    `[er-b1c] injected ${megaFormResult.injected} ER mega forms (skipped ${megaFormResult.skippedExisting} already present)`,
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
  // Elite Redux: wire Unown's Wishiwashi-style School (Revelation) form change.
  // Must run AFTER initEliteReduxSpecies() (base Unown's letter forms exist) and
  // AFTER initEliteReduxCustomAbilities() (the Revelation ability instance, id
  // 5586, exists in allAbilities so its dispatcher-attached attr can be fixed).
  const unownSchoolResult = initEliteReduxUnownSchool();
  if (unownSchoolResult.errors.length > 0) {
    console.warn("[er-unown-school] issues:", unownSchoolResult.errors.slice(0, 5));
  }
  console.info(
    `[er-unown-school] form injected: ${unownSchoolResult.formInjected}, form changes: ${unownSchoolResult.formChangesRegistered}, ability rewired: ${unownSchoolResult.abilityRewired}`,
  );
  // Elite Redux: inject ER-custom battle forms that ER ships as separate dump
  // species (Wispywaspy → Hivemind for Locust Swarm 884; Darmanitan Redux Bond
  // → Blunder for Battle Bond). pokerogue's form system only swaps formIndex on
  // the SAME species, so the alternate form must be a FORM on the base custom
  // species with its `<base> -> form` (+ revert) edges registered. The same
  // three-step wiring the vanilla Unown got in initEliteReduxUnownSchool, but
  // for ER-custom (id ≥ 10000) bases. Must run AFTER initEliteReduxCustomSpecies()
  // (bases exist) and AFTER injectAllErMegaForms() (reuse any seeded base form).
  const erCustomFormResult = initEliteReduxErCustomFormChanges();
  if (erCustomFormResult.errors.length > 0) {
    console.warn("[er-custom-forms] issues:", erCustomFormResult.errors.slice(0, 5));
  }
  console.info(
    `[er-custom-forms] injected ${erCustomFormResult.formsInjected} battle forms, registered ${erCustomFormResult.formChangesRegistered} form-change edges`,
  );
  // Elite Redux: point EVERY ER mega/primal form at its `elite-redux/{slug}` art.
  // injectAllErMegaForms() only redirects the forms it freshly injects; megas
  // whose form already existed (skipped as "already present") otherwise keep the
  // vanilla `{id}-{formKey}` sprite path, which 404s → the mega renders as the
  // BASE sprite (the "Wigglytuff Mega shows normal Wigglytuff" bug). Must run
  // AFTER injectAllErMegaForms() AND initEliteReduxErCustomFormChanges() so all
  // form objects exist; idempotent, so already-redirected forms are untouched.
  const megaSpriteResult = installAllErMegaSpriteRedirects();
  console.info(
    `[er-b1c2] mega sprite redirects: ${megaSpriteResult.applied} applied, ${megaSpriteResult.missing} unresolved`,
  );
  // Same species-level UI sprite gap for ER "redux" forms (e.g. Redux Litwick
  // showing Redux Pansear art in the Pokedex/starter/party screens). Bridge them
  // the same way; the battle path already worked via the per-form redirect.
  const reduxSpriteCount = installAllErReduxSpriteRedirects();
  console.info(`[er] redux sprite dispatch installed on ${reduxSpriteCount} species`);
  // Elite Redux #151: repair scrambled gen8/9 move id-map entries (by name)
  // BEFORE the rebalance + move-patches consume the map, so stats and effects
  // land on the correct pokerogue move (e.g. Kowtow Cleave, not Blood Moon).
  const moveRemapped = remapEliteReduxMoveIdsByName();
  if (moveRemapped > 0) {
    console.info(`[er-151] repointed ${moveRemapped} vanilla ER move ids to their name-matched MoveIds`);
  }
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
  // R57: C-source corrections. Must run AFTER initEliteReduxVanillaRebalance
  // so we overwrite stale beta-JSON values with the v2.65.3b ROM C source.
  const cSrcResult = initEliteReduxCSourceCorrections();
  console.info(
    `[er-r57] C-source corrections applied: ${cSrcResult.movesPatched} move stats, ${cSrcResult.flagsPatched} flag patches, ${cSrcResult.movesMissing} missing`,
  );
  // Re-resolve composite-vanilla-mashup abilities NOW that every vanilla part
  // has its final (rebalance- + C-source-patched) attrs. Composites were first
  // built before those patches ran, so any embedding a patched vanilla part
  // (e.g. 614 Balloon Bomb embeds the rewired Aftermath) froze stale behavior.
  const compositeRefresh = refreshEliteReduxComposites();
  console.info(
    `[er-composite-refresh] re-resolved ${compositeRefresh.refreshed} composite abilities against patched parts${compositeRefresh.errors.length > 0 ? ` (${compositeRefresh.errors.length} errors)` : ""}`,
  );
  // Newcomer-patch manual composites (5933+): fill each composite's attrs from
  // its constituents NOW that vanilla parts + draft-id composites are final.
  const manualCompositeResult = wireEliteReduxManualComposites();
  console.info(
    `[er-manual-composite] wired ${manualCompositeResult.wired} newcomer composites${manualCompositeResult.emptyConstituents.length > 0 ? ` (${manualCompositeResult.emptyConstituents.length} empty constituents: ${manualCompositeResult.emptyConstituents.map(e => `${e.compositeId}<-${e.constituentId}`).join(", ")})` : ""}`,
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
    `[er-b4] registered ${trainerResult.trainersRegistered} ER trainers in registry (skipped ${trainerResult.trainersSkipped} already present, dropped ${trainerResult.trainersDroppedMissingSpecies} trainers + ${trainerResult.membersDroppedMissingSpecies} party members for missing-species drift)`,
  );
  // Elite Redux Phase B5: populate the ER form-change registry (megas +
  // primals + move-megas). Must run AFTER initEliteReduxCustomSpecies() so
  // the source/target species ids the registry references are
  // guaranteed-resolvable downstream. ER models megas as separate species
  // (not form keys), so the registry stores a (source → target) edge
  // pair; pokerogue's `pokemonFormChanges` is NOT modified here — see
  // file header on init-elite-redux-form-changes.ts.
  const formResult = initEliteReduxFormChanges();
  if (formResult.errors.length > 0) {
    console.warn(`[er-b5] ${formResult.errors.length} form-change errors:`, formResult.errors.slice(0, 5));
  }
  console.info(
    `[er-b5] registered ${formResult.formChangesRegistered} ER form changes (${formResult.megaRegistered} mega + ${formResult.primalRegistered} primal + ${formResult.moveMegaRegistered} move-mega), skipped ${formResult.skipped} already present, dropped ${formResult.droppedMissingSpecies} for missing-species drift`,
  );
  // Elite Redux: register the Elite/Hell classic-final-boss form change
  // (Cascoon "" → "primal") so the two-phase boss transform works. Must run
  // after the species/form tables are populated.
  registerErFinalBossFormChange();
  // Elite Redux: re-run the form-change reverse generator. `initPokemonForms()`
  // (called far earlier, before ER's form changes existed) auto-creates the
  // DEACTIVATE (revert) entry for every forward item-trigger — that's what lets
  // the party menu turn a Mega back off. ER megas/primals are bridged into
  // `pokemonFormChanges` AFTER that first pass, so without this they'd have no
  // revert entry and couldn't be deactivated (the reported "can't revert some
  // megas" bug). The generator is idempotent (it skips forwards that already
  // have a matching reverse), so re-running only fills in the ER additions.
  initPokemonForms();
  // Elite Redux Phase B6: wire ER per-species level-up movesets into
  // pokerogue's `pokemonSpeciesLevelMoves` table. Must run AFTER
  // initEliteReduxCustomMoves() (so ER-custom move ids ≥ 5000 are valid)
  // and AFTER initEliteReduxCustomSpecies() (so ER-custom species ids
  // ≥ 10000 have entries that can be keyed).
  const movesetResult = initEliteReduxMovesets();
  if (movesetResult.errors.length > 0) {
    console.warn(`[er-b6] ${movesetResult.errors.length} moveset errors:`, movesetResult.errors.slice(0, 5));
  }
  console.info(
    `[er-b6] patched ${movesetResult.speciesPatched} species' level-up movesets (${movesetResult.movesetEntriesApplied} [level, move] entries; skipped ${movesetResult.speciesSkippedNoMapping} no-mapping + ${movesetResult.speciesSkippedEmpty} empty; dropped ${movesetResult.moveIdsDropped} unmapped move ids)`,
  );
  // Elite Redux Phase B6: wire ER per-species level evolution requirements
  // into pokerogue's `pokemonEvolutions` table (kinds 0/3/4 — LEVEL,
  // LEVEL_MALE, LEVEL_FEMALE). Form changes (kinds 1/2/5 — MEGA, PRIMAL,
  // MOVE_MEGA) are owned by B5 and live in the ER form-change registry.
  // The initializer rebuilds `pokemonPrevolutions` + `pokemonStarters`
  // after its patches.
  const evoResult = initEliteReduxEvolutions();
  if (evoResult.errors.length > 0) {
    console.warn(`[er-b6] ${evoResult.errors.length} evolution errors:`, evoResult.errors.slice(0, 5));
  }
  console.info(
    `[er-b6] patched ${evoResult.speciesPatched} species' evolution tables (${evoResult.evolutionEdgesApplied} level edges; skipped ${evoResult.speciesSkippedNoLevelEvos} no-level-evos + ${evoResult.formChangeEdgesSkipped} form-change edges + ${evoResult.speciesSkippedNoMapping} no-mapping; dropped ${evoResult.edgesDroppedMissingTarget} missing-target + ${evoResult.edgesDroppedBadLevel} bad-level)`,
  );

  // Elite Redux: register ER customs as egg-hatchable. Must run AFTER
  // initEliteReduxEvolutions() because the skip-prevolution gate reads
  // `pokemonPrevolutions` which evolution-init populates.
  const eggResult = initEliteReduxEggTiers();
  console.info(
    `[er-egg-tiers] added ${eggResult.eggTiersAdded} ER customs to egg pool (+${eggResult.starterCostsAdded} starter-costs; skipped ${eggResult.skippedPrevolutions} evolved + ${eggResult.skippedFormChanges} form-change + ${eggResult.skippedUnregistered} unregistered + ${eggResult.alreadyPresent} already present)`,
  );

  // Elite Redux: re-tier ER-custom starter costs (BST bands + legendary/AG
  // overrides) and pull ability/item-emergent battle forms out of the grid +
  // egg pool. Must run AFTER egg tiers so its entries exist to delete.
  const costResult = initEliteReduxStarterCosts();
  console.info(
    `[er-starter-costs] re-costed ${costResult.recosted} ER customs (${costResult.legendaryTiered} → Legendary eggs); removed ${costResult.removed} ability/item-emergent forms from grid + egg pool`,
  );

  // Elite Redux: editor-managed per-species tuning (egg tier + starter cost)
  // from er-species-tuning.json. Must run LAST in the tier/cost chain so a
  // committed editor edit is the final word.
  const speciesTuningResult = initEliteReduxSpeciesTuning();
  console.info(
    `[er-species-tuning] applied ${speciesTuningResult.eggTiersApplied} egg-tier + ${speciesTuningResult.costsApplied} cost overrides (skipped ${speciesTuningResult.skippedAbsent} absent + ${speciesTuningResult.skippedUnmapped} unmapped)`,
  );

  // Elite Redux: editor-managed item tuning (reward-pool tier/weight + params)
  // from er-item-tuning.json, applied over the pools initModifierPools() built.
  const itemTuningResult = initEliteReduxItemTuning();
  console.info(
    `[er-item-tuning] moved ${itemTuningResult.tiersMoved} tiers, applied ${itemTuningResult.weightsApplied} weights + ${itemTuningResult.maxStacksApplied} stack caps (skipped ${itemTuningResult.skipped})`,
  );

  // Elite Redux: inject hand-audited egg moves for ER-custom base species into
  // `speciesEggMoves` (vanilla only covers vanilla species).
  const eggMoveResult = initEliteReduxEggMoves();
  console.info(
    `[er-egg-moves] applied egg-move table: ${eggMoveResult.added} new + ${eggMoveResult.alreadyPresent} overridden species (skipped ${eggMoveResult.skippedUnmapped} unmapped)`,
  );

  // Elite Redux: editor-created custom mons (er-custom-mons.json). Runs after
  // the egg-move pass so every balance table it writes exists; invalid entries
  // are skipped, never fatal.
  const customMonResult = initEliteReduxCustomMons();
  if (customMonResult.registered + customMonResult.skippedInvalid + customMonResult.alreadyPresent > 0) {
    console.info(
      `[er-custom-mons] registered ${customMonResult.registered} editor mons (skipped ${customMonResult.skippedInvalid} invalid + ${customMonResult.alreadyPresent} already present)`,
    );
  }

  // Elite Redux: extend TM-learnable pool with each species's tutor moves.
  // Must run AFTER move/species init so id lookups resolve.
  const tmResult = initEliteReduxTmMoves();
  console.info(
    `[er-tm] added ${tmResult.pairsAdded} (species, move) pairs to TM-learnable pool (${tmResult.movesAddedToPool} new moves added to drop pool; skipped ${tmResult.pairsSkippedDup} duplicates + ${tmResult.pairsSkippedUnmapped} unmapped)`,
  );

  // Elite Redux: editor-managed Pokedex overrides (learnsets / TM sets / ability
  // slots) from er-learnsets.json + er-tm-learnsets.json + er-species-abilities.json.
  // Runs LAST so a committed editor edit is the final word over every prior pass;
  // fail-safe (revalidates every id, can only no-op on a bad entry).
  const pokedexResult = initEliteReduxPokedexOverrides();
  if (
    pokedexResult.learnsetsApplied + pokedexResult.tmSetsApplied + pokedexResult.abilitiesApplied > 0
    || pokedexResult.errors.length > 0
  ) {
    console.info(
      `[er-pokedex-overrides] applied ${pokedexResult.learnsetsApplied} learnsets + ${pokedexResult.tmSetsApplied} TM sets + ${pokedexResult.abilitiesApplied} ability sets (dropped ${pokedexResult.idsDropped} ids, skipped ${pokedexResult.skippedUnmapped} unmapped${pokedexResult.errors.length > 0 ? `, ${pokedexResult.errors.length} errors` : ""})`,
    );
  }
}
