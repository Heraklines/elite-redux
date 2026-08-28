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
const SAVE_PROFILE_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-save/src/profile.rs",
  test: "profile_preferences_filter_and_history_bound_match_oracle",
};
const SAVE_LEADERBOARD_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-save/src/profile.rs",
  test: "leaderboard_stats_are_non_negative_and_relics_unique",
};
const SAVE_SESSION_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-save/src/session.rs",
  test: "session_persistence_is_bounded_leased_and_exact_delete_safe",
};
const SAVE_IMPORT_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-save/src/session.rs",
  test: "imports_and_coop_participants_fail_closed",
};
const SAVE_MODE_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-save/src/mode_save.rs",
  test: "mode_save_projections_clone_without_aliasing_or_hidden_state",
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
const dataUtils = "src/utils/data.ts";
const leaderboardStats = "src/system/leaderboard-save-stats.ts";
const gameData = "src/system/game-data.ts";
const communityChallenges = "src/data/elite-redux/er-community-challenges.ts";
const endlessContinuation = "src/data/elite-redux/er-endless-continuation.ts";
const enemyAi = "src/data/elite-redux/er-enemy-ai.ts";
const legacyEndless = "src/data/elite-redux/er-legacy-endless-save.ts";
const runBuffs = "src/data/elite-redux/er-run-buffs.ts";
const shinyLabConfig = "src/data/elite-redux/er-shiny-lab-config.ts";
const trainingCache = "src/data/elite-redux/er-training-cache.ts";
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
  [dataUtils, 155, "saveStarterPreferences", "er_save::profile::ProfilePersistenceV1::save_starter_preferences", SAVE_PROFILE_PROOF],
  [dataUtils, 197, "saveLastTeam", "er_save::profile::ProfilePersistenceV1::save_last_team", SAVE_PROFILE_PROOF],
  [dataUtils, 234, "saveLastChallenges", "er_save::profile::ProfilePersistenceV1::save_last_challenges", SAVE_PROFILE_PROOF],
  [dataUtils, 306, "saveLastFunModeConfig", "er_save::profile::ProfilePersistenceV1::save_last_fun_mode", SAVE_PROFILE_PROOF],
  [leaderboardStats, 11, "nonNegativeInteger", "er_save::profile::non_negative_integer_v1", SAVE_LEADERBOARD_PROOF],
  [leaderboardStats, 16, "buildLeaderboardSaveStats", "er_save::profile::build_leaderboard_save_stats_v1", SAVE_LEADERBOARD_PROOF],
  [leaderboardStats, 24, "filter[0]", "er_save::profile::build_leaderboard_save_stats_v1", SAVE_LEADERBOARD_PROOF],
  [leaderboardStats, 49, "filter[0]", "er_save::profile::build_leaderboard_save_stats_v1", SAVE_LEADERBOARD_PROOF],
  [gameData, 666, "getSystemSaveData", "er_save::session::SessionPersistenceRuntimeV1::get_system_save_data", SAVE_SESSION_PROOF],
  [gameData, 725, "getFunDebugBaselineSaveData", "er_save::session::SessionPersistenceRuntimeV1::get_system_save_data", SAVE_SESSION_PROOF],
  [gameData, 824, "saveShowdownTeamPreset", "er_save::session::SessionPersistenceRuntimeV1::save_showdown_team_preset", SAVE_PROFILE_PROOF],
  [gameData, 904, "warnLocalStorageFull", "er_save::session::SessionPersistenceRuntimeV1::warn_local_storage_full", SAVE_SESSION_PROOF],
  [gameData, 944, "saveSystem", "er_save::session::SessionPersistenceRuntimeV1::save_system", SAVE_SESSION_PROOF],
  [gameData, 1085, "findImportableLocalSaveBundle", "er_save::session::SessionPersistenceRuntimeV1::find_importable_local_save_bundle", SAVE_IMPORT_PROOF],
  [gameData, 1122, "findImportableLocalSessionSaves", "er_save::session::SessionPersistenceRuntimeV1::find_importable_local_session_saves", SAVE_IMPORT_PROOF],
  [gameData, 1147, "decryptImportableLocalSave", "er_save::session::SessionPersistenceRuntimeV1::decrypt_importable_local_save", SAVE_IMPORT_PROOF],
  [gameData, 1170, "findImportableLocalSave", "er_save::session::SessionPersistenceRuntimeV1::find_importable_local_save", SAVE_IMPORT_PROOF],
  [gameData, 1210, "importSystemSaveString", "er_save::session::SessionPersistenceRuntimeV1::import_system_save_string", SAVE_IMPORT_PROOF],
  [gameData, 1216, "importLocalSaveBundle", "er_save::session::SessionPersistenceRuntimeV1::import_local_save_bundle", SAVE_IMPORT_PROOF],
  [gameData, 1624, "saveRunHistory", "er_save::profile::ProfilePersistenceV1::save_run_history", SAVE_PROFILE_PROOF],
  [gameData, 1760, "saveSetting", "er_save::profile::ProfilePersistenceV1::save_setting", SAVE_PROFILE_PROOF],
  [gameData, 1783, "saveMappingConfigs", "er_save::profile::ProfilePersistenceV1::save_mapping_config", SAVE_PROFILE_PROOF],
  [gameData, 1847, "saveControlSetting", "er_save::profile::ProfilePersistenceV1::save_control_setting", SAVE_PROFILE_PROOF],
  [gameData, 1935, "saveTutorialFlag", "er_save::profile::ProfilePersistenceV1::save_tutorial_flag", SAVE_PROFILE_PROOF],
  [gameData, 1974, "saveSeenDialogue", "er_save::profile::ProfilePersistenceV1::save_seen_dialogue", SAVE_PROFILE_PROOF],
  [gameData, 2002, "getSessionSaveData", "er_save::session::SessionPersistenceRuntimeV1::get_session", SAVE_SESSION_PROOF],
  [gameData, 2115, "getSession", "er_save::session::SessionPersistenceRuntimeV1::get_session", SAVE_SESSION_PROOF],
  [gameData, 2519, "renameSession", "er_save::session::SessionPersistenceRuntimeV1::rename_session", SAVE_SESSION_PROOF],
  [gameData, 2603, "loadSession", "er_save::session::SessionPersistenceRuntimeV1::load_session", SAVE_IMPORT_PROOF],
  [gameData, 3121, "deleteSessionBounded", "er_save::session::SessionPersistenceRuntimeV1::delete_session_bounded", SAVE_SESSION_PROOF],
  [gameData, 3130, "updateSessionBounded", "er_save::session::SessionPersistenceRuntimeV1::update_session_bounded", SAVE_SESSION_PROOF],
  [gameData, 3140, "clearSessionBounded", "er_save::session::SessionPersistenceRuntimeV1::clear_session_bounded", SAVE_SESSION_PROOF],
  [gameData, 3589, "withSessionPersistenceLease", "er_save::session::SessionPersistenceRuntimeV1::with_session_persistence_lease", SAVE_SESSION_PROOF],
  [gameData, 460, "trySetLocalStorageItem", "er_save::session::SessionPersistenceRuntimeV1::try_set_local_storage_item", SAVE_SESSION_PROOF],
  [gameData, 4776, "assessImportOverLocalSession", "er_save::session::SessionPersistenceRuntimeV1::assess_import_over_local_session", SAVE_IMPORT_PROOF],
  [gameData, 5071, "classifySessionJsonForExactDelete", "er_save::session::SessionPersistenceRuntimeV1::classify_session_json_for_exact_delete", SAVE_SESSION_PROOF],
  [gameData, 5193, "initSessionFromData", "er_save::session::SessionPersistenceRuntimeV1::init_session_from_data", SAVE_IMPORT_PROOF],
  [gameData, 5490, "deleteSession", "er_save::session::SessionPersistenceRuntimeV1::delete_session_bounded", SAVE_SESSION_PROOF],
  [gameData, 5602, "tryClearSession", "er_save::session::SessionPersistenceRuntimeV1::clear_session_bounded", SAVE_SESSION_PROOF],
  [gameData, 5735, "parseSessionData", "er_save::session::SessionPersistenceRuntimeV1::parse_session_data", SAVE_IMPORT_PROOF],
  [gameData, 5853, "saveAll", "er_save::session::SessionPersistenceRuntimeV1::save_all", SAVE_SESSION_PROOF],
  [gameData, 5887, "saveAllImpl", "er_save::session::SessionPersistenceRuntimeV1::save_all", SAVE_SESSION_PROOF],
  [communityChallenges, 1074, "saveLocalDraft", "er_save::mode_save::save_community_challenge_draft_v1", SAVE_MODE_PROOF],
  [endlessContinuation, 254, "getErEndlessSaveData", "er_save::mode_save::endless_save_data_v1", SAVE_MODE_PROOF],
  [enemyAi, 220, "getErAiProfile", "er_save::mode_save::enemy_ai_profile_v1", SAVE_MODE_PROOF],
  [fairyLuck, 68, "getErFairyLuckSave", "er_save::mode_save::fairy_luck_save_v1", SAVE_MODE_PROOF],
  [legacyEndless, 11, "isRetiredStandaloneEndlessSave", "er_save::mode_save::retired_standalone_endless_save_v1", SAVE_MODE_PROOF],
  [mapNodes, 249, "getErMapSaveData", "er_save::mode_save::map_save_data_v1", SAVE_MODE_PROOF],
  [runBuffs, 119, "getErRunBuffSaveData", "er_save::mode_save::run_buff_save_data_v1", SAVE_MODE_PROOF],
  [pacing, 93, "getErRunPacingProfile", "er_save::mode_save::run_pacing_profile_v1", SAVE_MODE_PROOF],
  [shinyLabConfig, 41, "ensureShinyLabSave", "er_save::mode_save::ensure_shiny_lab_save_v1", SAVE_MODE_PROOF],
  [shinyLabConfig, 45, "saveSystem", "er_save::mode_save::save_shiny_lab_system_v1", SAVE_MODE_PROOF],
  [trainingCache, 37, "getErTrainingCacheSaveData", "er_save::mode_save::training_cache_save_data_v1", SAVE_MODE_PROOF],
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
