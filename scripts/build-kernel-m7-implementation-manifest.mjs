#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CATALOG = resolve(ROOT, "rust/fixtures/m7/game-system-catalog-v1.json");
const OUTPUT = resolve(ROOT, "rust/fixtures/m7/m7-behavior-implementation-v1.json");
const WORLD_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-testkit/tests/m7_system_proof.rs",
  test: "branching_routes_and_biome_structure_are_canonical_state",
};
const WORLD_ORACLE_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-content-compiler/src/m7_world.rs",
  test: "pinned_world_tables_compile_without_floats_in_output",
};
const SAVE_REPLAY_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-save/src/oracle_replay.rs",
  test: "replay_trace_guards_and_validation_match_oracle_contract",
};
const SAVE_RECORDER_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-save/src/oracle_replay.rs",
  test: "replay_recorder_is_idempotent_and_wave_bounded",
};
const SAVE_SINGLE_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-save/src/oracle_replay.rs",
  test: "single_player_capture_helpers_preserve_command_and_state",
};

const routing = "src/data/elite-redux/er-biome-routing.ts";
const structure = "src/data/elite-redux/er-biome-structure.ts";
const pacing = "src/data/elite-redux/er-run-pacing.ts";
const notoriety = "src/data/elite-redux/er-biome-notoriety.ts";
const mapEvents = "src/data/elite-redux/er-map-events.ts";
const mapNodes = "src/data/elite-redux/er-map-nodes.ts";
const fairyLuck = "src/data/elite-redux/er-fairy-luck.ts";
const gameMode = "src/game-mode.ts";
const arena = "src/field/arena.ts";
const biomeEncounters = "src/data/elite-redux/er-biome-encounters.ts";
const biomeRules = "src/data/elite-redux/er-biome-rules.ts";
const battleFrequency = "src/data/elite-redux/er-battle-frequency.ts";
const biomeDepths = "src/init/init-biome-depths.ts";
const biomeRegistry = "src/init/init-biomes.ts";
const replayTrace = "src/data/elite-redux/replay-trace.ts";
const replayRecorder = "src/data/elite-redux/replay-recorder.ts";
const replaySingle = "src/data/elite-redux/replay-single-recording.ts";
const implemented = [
  [routing, 53, "erBiomeRoutingActive", "er_world::runtime::roll_next_biome_nodes"],
  [routing, 77, "erRecordBiomeEntry", "er_world::runtime::record_biome_entry"],
  [routing, 94, "loopbackExcluded", "er_world::runtime::loopback_exclusions"],
  [routing, 103, "restoreErRecentBiomes", "er_world::runtime::restore_routing_state"],
  [routing, 108, "getErPrevBiome", "er_state::m7_state::WorldStateV1::previous_biome"],
  [routing, 123, "setErPendingNodes", "er_world::runtime::set_pending_route_nodes"],
  [routing, 134, "erPendingNodesReady", "er_state::m7_state::WorldStateV1::pending_nodes_ready"],
  [routing, 139, "getErPendingNodes", "er_state::m7_state::WorldStateV1::pending_nodes"],
  [routing, 159, "revealAllErPendingNodes", "er_world::runtime::reveal_all_pending_nodes"],
  [routing, 178, "revealNextHiddenErPendingNode", "er_world::runtime::reveal_next_pending_node"],
  [routing, 179, "find[0]", "er_world::runtime::reveal_next_pending_node"],
  [routing, 200, "addErEventRevealedNode", "er_world::runtime::add_event_revealed_biome"],
  [routing, 210, "some[0]", "er_world::runtime::add_event_revealed_biome"],
  [routing, 216, "resetErRouting", "er_world::runtime::reset_routing_state"],
  [routing, 225, "getErRoutingState", "er_state::m7_state::WorldStateV1::previous_biome"],
  [routing, 230, "restoreErRouting", "er_world::runtime::restore_routing_state"],
  [routing, 235, "erMapUpgradeTier", "er_world::runtime::map_upgrade_tier"],
  [routing, 238, "reduce[0]", "er_world::runtime::map_upgrade_tier"],
  [routing, 242, "getErVisibleNodeCount", "er_world::runtime::visible_route_node_count"],
  [routing, 253, "baseLinks", "er_world::runtime::collect_base_links"],
  [routing, 256, "filter[0]", "er_world::runtime::collect_base_links"],
  [routing, 257, "map[0]", "er_world::runtime::collect_base_links"],
  [routing, 286, "rollErNextBiomeNodes", "er_world::runtime::roll_next_biome_nodes"],
  [routing, 329, "find[0]", "er_world::runtime::roll_next_biome_nodes"],
  [routing, 339, "map[0]", "er_world::runtime::roll_next_biome_nodes"],
  [routing, 347, "some[0]", "er_world::runtime::roll_next_biome_nodes"],
  [structure, 80, "resetErBiomeStructure", "er_world::runtime::restore_biome_structure"],
  [structure, 95, "lateGameThreshold", "er_world::runtime::in_late_game_zone"],
  [structure, 100, "erInLateGameZone", "er_world::runtime::in_late_game_zone"],
  [structure, 116, "erRollBiomeLength", "er_world::runtime::plan_biome_structure"],
  [structure, 127, "planErBiomeStructure", "er_world::runtime::plan_biome_structure"],
  [structure, 156, "roll", "er_world::runtime::plan_biome_structure"],
  [structure, 165, "restoreErBiomeStructure", "er_world::runtime::restore_biome_structure"],
  [structure, 182, "erMarkBiomeStay", "er_world::runtime::mark_biome_stay"],
  [structure, 192, "erBiomeOverstayAnchor", "er_state::m7_state::WorldStateV1::overstay_anchor_wave"],
  [structure, 203, "setErBiomeOverstayAnchor", "er_world::runtime::set_biome_overstay_anchor"],
  [structure, 217, "setErBiomeStructureExtent", "er_world::runtime::set_biome_structure_extent"],
  [structure, 225, "getErBiomeLength", "er_state::m7_state::WorldStateV1::biome_length"],
  [structure, 230, "getErBiomeStartWave", "er_state::m7_state::WorldStateV1::biome_start_wave"],
  [structure, 249, "erBiomeJustEnteredAfterWave", "er_world::runtime::biome_just_entered_after_wave"],
  [structure, 254, "wavesSinceEnteredBiome", "er_world::runtime::waves_in_current_biome"],
  [structure, 259, "setErLeaveBiomeNow", "er_world::runtime::mark_leave_biome"],
  [structure, 264, "getErLeaveBiomeNow", "er_state::m7_state::WorldStateV1::leave_biome_now"],
  [structure, 273, "erIsBiomeEnd", "er_world::runtime::biome_end_rule"],
  [structure, 292, "erShouldRaiseCrossroads", "er_world::runtime::should_raise_crossroads"],
  [pacing, 97, "getErFinalWave", "er_world::runtime::final_wave"],
  [pacing, 101, "getErProgressionWave", "er_world::runtime::progression_wave"],
  [pacing, 106, "getErEarlyWaveMovePowerMultiplier", "er_world::runtime::early_wave_move_power_ratio"],
  [pacing, 123, "isErCheckpointWave", "er_world::runtime::is_checkpoint_wave"],
  [pacing, 127, "isErChapterStartWave", "er_world::runtime::is_chapter_start_wave"],
  [pacing, 135, "isErMajorCheckpointWave", "er_world::runtime::is_major_checkpoint_wave"],
  [pacing, 147, "getErFinaleRoutingStartWave", "er_world::GameModeDefinitionV1::finale_routing_start_wave"],
  [pacing, 162, "getErStorySourceWave", "er_world::runtime::story_source_wave"],
  [notoriety, 59, "erBiomeOverstay", "er_world::runtime::biome_overstay"],
  [notoriety, 71, "erHasNotoriety", "er_world::runtime::has_notoriety"],
  [notoriety, 83, "escalationOverstay", "er_world::runtime::scaled_overstay"],
  [notoriety, 91, "notorietyRamp", "er_world::runtime::notoriety_scaled_ceiling"],
  [notoriety, 102, "erNotorietyBstBonus", "er_world::runtime::notoriety_bst_bonus"],
  [mapEvents, 22, "onwardBiomes", "er_world::runtime::onward_biomes"],
  [mapEvents, 32, "chartOnwardRoutes", "er_world::runtime::chart_onward_routes"],
  [mapEvents, 73, "setAnyBiomeTravelTarget", "er_world::runtime::set_any_biome_travel_target"],
  [mapNodes, 79, "recordErBiomeVisited", "er_world::runtime::record_map_biome_visited"],
  [mapNodes, 90, "getErBiomeHistory", "er_state::m7_state::WorldStateV1::biome_history"],
  [mapNodes, 97, "clearErBiomeNodes", "er_world::runtime::clear_biome_map_nodes"],
  [fairyLuck, 60, "erFairyLuckWavesLeft", "er_world::runtime::fairy_luck_waves_left"],
  [gameMode, 233, "getStartingBiome", "er_world::runtime::starting_biome"],
  [gameMode, 246, "getWaveForDifficulty", "er_world::runtime::wave_for_difficulty"],
  [gameMode, 452, "isWaveFinal", "er_world::runtime::is_wave_final"],
  [arena, 89, "erLegendMinWave", "er_world::runtime::legend_min_wave"],
  [biomeEncounters, 105, "getErBiomeEncounter", "er_world::runtime::biome_encounter_profile", WORLD_ORACLE_PROOF],
  [biomeEncounters, 110, "erBiomeEventRateMult", "er_world::runtime::biome_event_rate", WORLD_ORACLE_PROOF],
  [biomeEncounters, 138, "erBiomeWaveSkipChance", "er_world::runtime::biome_wave_skip_chance", WORLD_ORACLE_PROOF],
  [biomeEncounters, 144, "erBiomeSkipFallback", "er_world::runtime::biome_skip_fallback", WORLD_ORACLE_PROOF],
  [biomeRules, 202, "getErBiomeRule", "er_world::runtime::biome_battle_rule", WORLD_ORACLE_PROOF],
  [biomeRules, 207, "erBiomeForcedWeather", "er_world::runtime::biome_forced_weather", WORLD_ORACLE_PROOF],
  [biomeRules, 212, "erBiomeForcedTerrain", "er_world::runtime::biome_forced_terrain", WORLD_ORACLE_PROOF],
  [battleFrequency, 116, "erExtraRivalTypeForWave", "er_world::runtime::extra_rival_type_for_wave", WORLD_ORACLE_PROOF],
  [battleFrequency, 124, "erRivalWaveSequence", "er_world::runtime::rival_wave_sequence", WORLD_ORACLE_PROOF],
  [battleFrequency, 137, "erRivalWaveOrdinal", "er_world::runtime::rival_wave_ordinal", WORLD_ORACLE_PROOF],
  [biomeDepths, 7, "initBiomeDepths", "er_world::runtime::initialize_biome_depths"],
  [biomeDepths, 13, "map[0]", "er_world::runtime::initialize_biome_depths"],
  [biomeDepths, 14, "reduce[0]", "er_world::runtime::initialize_biome_depths"],
  [biomeDepths, 19, "traverseBiome", "er_world::runtime::initialize_biome_depths"],
  [biomeRegistry, 39, "initBiomes", "er_content_compiler::m7_world::compile_world_behavior_v1", WORLD_ORACLE_PROOF],
  [replayTrace, 247, "isReplayCommandEvent", "er_save::oracle_replay::OracleReplayEventV2::is_command", SAVE_REPLAY_PROOF],
  [replayTrace, 252, "isReplayInteractionEvent", "er_save::oracle_replay::OracleReplayEventV2::is_interaction", SAVE_REPLAY_PROOF],
  [replayTrace, 268, "validateReplayTrace", "er_save::oracle_replay::validate_oracle_replay_trace_v2", SAVE_REPLAY_PROOF],
  [replayTrace, 282, "forEach[0]", "er_save::oracle_replay::validate_oracle_replay_trace_v2", SAVE_REPLAY_PROOF],
  [replayTrace, 318, "isValidCommandKind", "er_save::oracle_replay::OracleReplayCommandKindV2::structurally_valid", SAVE_REPLAY_PROOF],
  [replayTrace, 338, "makeReplayTrace", "er_save::oracle_replay::make_oracle_replay_trace_v2", SAVE_REPLAY_PROOF],
  [replayRecorder, 99, "isReplayRecording", "er_save::oracle_replay::OracleReplayRecorderV2::is_recording", SAVE_RECORDER_PROOF],
  [replayRecorder, 110, "beginReplayRecording", "er_save::oracle_replay::OracleReplayRecorderV2::begin", SAVE_RECORDER_PROOF],
  [replayRecorder, 121, "clearReplayRecording", "er_save::oracle_replay::OracleReplayRecorderV2::clear", SAVE_RECORDER_PROOF],
  [replayRecorder, 129, "pruneOldWaves", "er_save::oracle_replay::OracleReplayRecorderV2::prune_old_waves", SAVE_RECORDER_PROOF],
  [replayRecorder, 134, "filter[0]", "er_save::oracle_replay::OracleReplayRecorderV2::prune_old_waves", SAVE_RECORDER_PROOF],
  [replayRecorder, 149, "recordReplayCheckpoint", "er_save::oracle_replay::OracleReplayRecorderV2::record_checkpoint", SAVE_RECORDER_PROOF],
  [replayRecorder, 168, "windowStartCheckpoint", "er_save::oracle_replay::OracleReplayRecorderV2::window_start_checkpoint", SAVE_RECORDER_PROOF],
  [replayRecorder, 172, "map[0]", "er_save::oracle_replay::OracleReplayRecorderV2::window_start_checkpoint", SAVE_RECORDER_PROOF],
  [replayRecorder, 189, "recordReplayCommand", "er_save::oracle_replay::OracleReplayRecorderV2::record_command", SAVE_RECORDER_PROOF],
  [replayRecorder, 206, "recordReplayInteraction", "er_save::oracle_replay::OracleReplayRecorderV2::record_interaction", SAVE_RECORDER_PROOF],
  [replayRecorder, 223, "getReplayTrace", "er_save::oracle_replay::OracleReplayRecorderV2::trace", SAVE_RECORDER_PROOF],
  [replayRecorder, 242, "map[0]", "er_save::oracle_replay::OracleReplayRecorderV2::trace", SAVE_RECORDER_PROOF],
  [replaySingle, 75, "captureSinglePlayerEndState", "er_save::oracle_replay::capture_single_player_end_state_v2", SAVE_SINGLE_PROOF],
  [replaySingle, 79, "map[0]", "er_save::oracle_replay::capture_single_player_end_state_v2", SAVE_SINGLE_PROOF],
  [replaySingle, 98, "maybeBeginSinglePlayerReplayRecording", "er_save::oracle_replay::SinglePlayerReplayRuntimeV2::maybe_begin", SAVE_SINGLE_PROOF],
  [replaySingle, 117, "map[0]", "er_save::oracle_replay::SinglePlayerReplayRuntimeV2::maybe_begin", SAVE_SINGLE_PROOF],
  [replaySingle, 118, "currentWave", "er_save::oracle_replay::SinglePlayerReplayRuntimeV2::record_interaction", SAVE_SINGLE_PROOF],
  [replaySingle, 134, "captureReplayCheckpoint", "er_save::oracle_replay::capture_replay_checkpoint_v2", SAVE_SINGLE_PROOF],
  [replaySingle, 138, "map[0]", "er_save::oracle_replay::capture_replay_checkpoint_v2", SAVE_SINGLE_PROOF],
  [replaySingle, 139, "map[0]", "er_save::oracle_replay::capture_replay_checkpoint_v2", SAVE_SINGLE_PROOF],
  [replaySingle, 153, "maybeCaptureReplayCheckpoint", "er_save::oracle_replay::SinglePlayerReplayRuntimeV2::maybe_capture_checkpoint", SAVE_SINGLE_PROOF],
  [replaySingle, 165, "playerCommandToReplayKind", "er_save::oracle_replay::player_command_to_replay_kind_v2", SAVE_SINGLE_PROOF],
  [replaySingle, 191, "recordSinglePlayerCommand", "er_save::oracle_replay::SinglePlayerReplayRuntimeV2::record_command", SAVE_SINGLE_PROOF],
  [replaySingle, 233, "recordSinglePlayerInteraction", "er_save::oracle_replay::SinglePlayerReplayRuntimeV2::record_interaction", SAVE_SINGLE_PROOF],
];

function fail(message) {
  throw new Error(`M7 implementation manifest: ${message}`);
}

const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
const entries = implemented.map(([path, line, symbol, rustSymbol, proof = WORLD_PROOF]) => {
  const matches = catalog.behaviors.filter(behavior =>
    behavior.source.path === path
    && behavior.source.line === line
    && behavior.symbol === symbol,
  );
  if (matches.length !== 1) {
    fail(`${path}:${line} ${symbol} matched ${matches.length} behavior units`);
  }
  const [behavior] = matches;
  if (behavior.implementation_status !== "REQUIRES_M7") {
    fail(`${path}:${line} ${symbol} is ${behavior.implementation_status}, not REQUIRES_M7`);
  }
  return {
    behavior_unit: behavior.id,
    status: "BESPOKE_IMPLEMENTED",
    source: behavior.source,
    rust_symbol: rustSymbol,
    proof,
  };
});
entries.sort((left, right) => left.behavior_unit.localeCompare(right.behavior_unit));
if (new Set(entries.map(entry => entry.behavior_unit)).size !== entries.length) {
  fail("one behavior unit received duplicate implementation evidence");
}
const document = {
  schema_version: 1,
  oracle_sha: catalog.oracle_sha,
  oracle_tree_sha: catalog.oracle_tree_sha,
  implementation_count: entries.length,
  implementations: entries,
};
writeFileSync(OUTPUT, `${JSON.stringify(document)}\n`);
console.log(`M7 implementation manifest: ${entries.length} exact behavior units`);
