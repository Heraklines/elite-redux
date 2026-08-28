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
const SHOWDOWN_SESSION_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-ai/src/showdown_session.rs",
  test: "showdown_negotiation_rejects_protocol_format_and_hash_drift",
};
const SHOWDOWN_STATE_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-ai/src/showdown_session.rs",
  test: "pending_and_profile_set_state_is_idempotent",
};
const GHOST_PROFILE_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-ai/src/mode_profiles.rs",
  test: "ghost_profile_sanitizes_lines_tokens_and_effects",
};
const MOODY_SAVE_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-ai/src/mode_profiles.rs",
  test: "moody_sessions_sort_validate_reset_and_round_trip",
};
const TRAINING_SESSION_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-scenario/src/training_session.rs",
  test: "training_selection_iv_nature_and_ability_are_deterministic",
};
const MYSTERY_SAVE_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-scenario/src/training_session.rs",
  test: "training_removal_and_mystery_save_constructors_preserve_state",
};
const SAVE_MIGRATION_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-save/src/session.rs",
  test: "session_version_migration_orders_pinned_migrators_and_floors_money",
};
const SAVE_DECODE_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-save/src/lib.rs",
  test: "save_decode_error_preserves_cause",
};
const CAPTURE_MECHANICS_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-run/src/capture.rs",
  test: "pokeball_identity_critical_chance_and_presentation_are_deterministic",
};
const CAPTURE_INVENTORY_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-run/src/capture.rs",
  test: "pokeball_inventory_is_bounded_and_consumed_once",
};
const TRAINER_PARTY_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-ai/src/trainer_party.rs",
  test: "trainer_templates_and_party_selection_are_deterministic",
};
const RIVAL_PARTY_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-ai/src/trainer_party.rs",
  test: "rival_traits_and_post_processing_are_stable",
};
const PARTY_REQUIREMENT_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-scenario/src/party_requirements.rs",
  test: "party_requirements_query_exact_stable_ids",
};
const PARTY_TRANSITION_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-scenario/src/party_requirements.rs",
  test: "party_status_detach_and_restore_are_atomic",
};
const PARTY_SNAPSHOT_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-ai/src/party_snapshots.rs",
  test: "mode_party_snapshots_clone_and_capture_once",
};
const PARTY_COMPACTION_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-ai/src/party_snapshots.rs",
  test: "active_party_compaction_and_challenge_mutations_are_stable",
};
const PROGRESSION_EVOLUTION_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-progression/src/oracle_surface.rs",
  test: "evolution_graph_is_sorted_acyclic_and_queryable",
};
const PROGRESSION_MOVES_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-progression/src/oracle_surface.rs",
  test: "moves_levels_natures_and_experience_are_deterministic",
};
const ECONOMY_CONTENT_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-run/src/economy_surface.rs",
  test: "content_registry_and_inventory_transitions_fail_closed",
};
const ECONOMY_MARKET_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-run/src/economy_surface.rs",
  test: "currency_rewards_and_market_stock_are_checked",
};
const ECONOMY_MODIFIER_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-run/src/economy_surface.rs",
  test: "rerolls_modifiers_and_relics_preserve_identity",
};
const ECONOMY_INTERACTION_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-run/src/economy_surface.rs",
  test: "coop_economy_interactions_are_idempotent_and_conflicts_fail",
};

const CAPTURE_IMPLEMENTATION_BY_PATH = new Map([
  ["src/ai/rival-team-gen.ts", ["er_ai::trainer_party::rival_party_member_v1", RIVAL_PARTY_PROOF]],
  ["src/data/battle-format.ts", ["er_ai::party_snapshots::compact_eligible_party_into_active_slots_v1", PARTY_COMPACTION_PROOF]],
  ["src/data/challenge.ts", ["er_ai::party_snapshots::PartyChallengeStateV1", PARTY_COMPACTION_PROOF]],
  ["src/data/elite-redux/ai/combat-committed-action.ts", ["er_ai::trainer_party::capture_committed_combat_decision_v1", TRAINER_PARTY_PROOF]],
  ["src/data/elite-redux/ai/combat-engine-adapter.ts", ["er_ai::trainer_party::self_party_v1", TRAINER_PARTY_PROOF]],
  ["src/data/elite-redux/er-achievement-tracker.ts", ["er_ai::party_snapshots::player_party_snake_only_v1", PARTY_SNAPSHOT_PROOF]],
  ["src/data/elite-redux/er-custom-trainers.ts", ["er_ai::trainer_party::resolve_custom_trainer_party_v1", TRAINER_PARTY_PROOF]],
  ["src/data/elite-redux/er-fun-mode.ts", ["er_run::capture::should_grant_fun_capture_progress_v1", CAPTURE_INVENTORY_PROOF]],
  ["src/data/elite-redux/er-ghost-teams.ts", ["er_ai::party_snapshots::capture_ghost_team_v1", PARTY_SNAPSHOT_PROOF]],
  ["src/data/elite-redux/er-mineral-loot.ts", ["er_run::capture::party_line_mega_stones_v1", CAPTURE_INVENTORY_PROOF]],
  ["src/data/elite-redux/er-trainer-runtime-hook.ts", ["er_ai::trainer_party::rival_party_size_for_type_v1", RIVAL_PARTY_PROOF]],
  ["src/data/elite-redux/er-training-cache.ts", ["er_run::capture::locally_owned_party_v1", CAPTURE_INVENTORY_PROOF]],
  ["src/data/elite-redux/init-elite-redux-trainers.ts", ["er_ai::trainer_party::resolve_party_member_v1", TRAINER_PARTY_PROOF]],
  ["src/data/elite-redux/moody/moody-formation-game-adapter.ts", ["er_ai::party_snapshots::player_party_snapshot_v1", PARTY_SNAPSHOT_PROOF]],
  ["src/data/elite-redux/moody/moody-runtime-field-adapter.ts", ["er_ai::party_snapshots::player_party_snapshot_v1", PARTY_SNAPSHOT_PROOF]],
  ["src/data/elite-redux/moody/moody-runtime-field-engine.ts", ["er_ai::party_snapshots::moody_party_slot_v1", PARTY_SNAPSHOT_PROOF]],
  ["src/data/elite-redux/moody/moody-runtime-formation-adapter.ts", ["er_ai::party_snapshots::build_moody_formation_party_snapshot_v1", PARTY_SNAPSHOT_PROOF]],
  ["src/data/elite-redux/moody/moody-runtime-game-adapter.ts", ["er_ai::party_snapshots::capture_moody_turn_snapshot_v1", PARTY_SNAPSHOT_PROOF]],
  ["src/data/elite-redux/showdown/showdown-enemy.ts", ["er_ai::party_snapshots::showdown_manifest_to_serialized_party_v1", PARTY_SNAPSHOT_PROOF]],
  ["src/data/elite-redux/showdown/showdown-sync-command.ts", ["er_ai::party_snapshots::showdown_party_for_v1", PARTY_SNAPSHOT_PROOF]],
  ["src/data/mystery-encounters/encounters/absolute-avarice-encounter.ts", ["er_scenario::party_requirements::give_party_reviver_seeds_v1", PARTY_TRANSITION_PROOF]],
  ["src/data/mystery-encounters/encounters/cleansing-font-encounter.ts", ["er_scenario::party_requirements::find_cursed_party_member_v1", PARTY_REQUIREMENT_PROOF]],
  ["src/data/mystery-encounters/encounters/frozen-in-time-encounter.ts", ["er_scenario::party_requirements::party_has_fire_source_v1", PARTY_REQUIREMENT_PROOF]],
  ["src/data/mystery-encounters/encounters/reactor-meltdown-encounter.ts", ["er_scenario::party_requirements::burn_party_v1", PARTY_TRANSITION_PROOF]],
  ["src/data/mystery-encounters/encounters/safari-zone-encounter.ts", ["er_scenario::party_requirements::throw_encounter_pokeball_v1", PARTY_TRANSITION_PROOF]],
  ["src/data/mystery-encounters/encounters/the-expert-pokemon-breeder-encounter.ts", ["er_scenario::party_requirements::breeder_party_config_v1", PARTY_TRANSITION_PROOF]],
  ["src/data/mystery-encounters/mystery-encounter-requirements.ts", ["er_scenario::party_requirements::PartyRequirementV1::query_party", PARTY_REQUIREMENT_PROOF]],
  ["src/data/mystery-encounters/requirements/can-learn-move-requirement.ts", ["er_scenario::party_requirements::PartyRequirementV1::query_party", PARTY_REQUIREMENT_PROOF]],
  ["src/data/mystery-encounters/utils/encounter-pokemon-utils.ts", ["er_scenario::party_requirements::encounter_add_to_party_v1", PARTY_TRANSITION_PROOF]],
  ["src/data/pokeball.ts", ["er_run::capture::pokeball_bounce_plan_v1", CAPTURE_MECHANICS_PROOF]],
  ["src/data/trainers/rival-party-config.ts", ["er_ai::trainer_party::post_process_rival_slot_v1", RIVAL_PARTY_PROOF]],
  ["src/data/trainers/trainer-config.ts", ["er_ai::trainer_party::TrainerPartyConfigV1", TRAINER_PARTY_PROOF]],
  ["src/data/trainers/trainer-party-template.ts", ["er_ai::trainer_party::TrainerPartyTemplateV1", TRAINER_PARTY_PROOF]],
  ["src/field/pokemon.ts", ["er_run::capture::add_captured_pokemon_to_party_v1", CAPTURE_INVENTORY_PROOF]],
  ["src/field/trainer.ts", ["er_ai::trainer_party::TrainerPartyConfigV1", TRAINER_PARTY_PROOF]],
  ["src/modifier/init-modifier-pools.ts", ["er_run::capture::tactical_party_gate_v1", CAPTURE_INVENTORY_PROOF]],
  ["src/modifier/modifier-type.ts", ["er_run::capture::PokeballInventoryV1", CAPTURE_INVENTORY_PROOF]],
  ["src/modifier/modifier.ts", ["er_run::capture::PokeballInventoryV1::consume", CAPTURE_INVENTORY_PROOF]],
  ["src/system/version-migration/versions/v1_9_0.ts", ["er_run::capture::migrate_party_v1_9_0", CAPTURE_INVENTORY_PROOF]],
]);

const CAPTURE_SYMBOL_OVERRIDES = new Map([
  ["src/data/pokeball.ts:9:getPokeballAtlasKey", "er_run::capture::pokeball_atlas_key_v1"],
  ["src/data/pokeball.ts:26:getPokeballName", "er_run::capture::pokeball_name_key_v1"],
  ["src/data/pokeball.ts:51:getPokeballCatchMultiplier", "er_run::capture::pokeball_catch_multiplier_v1"],
  ["src/data/pokeball.ts:70:getPokeballTintColor", "er_run::capture::pokeball_tint_v1"],
  ["src/data/pokeball.ts:93:getCriticalCaptureChance", "er_run::capture::critical_capture_chance_v1"],
  ["src/ai/rival-team-gen.ts:128:calcPartyTypings", "er_ai::trainer_party::calc_party_typings_v1"],
  ["src/data/elite-redux/er-achievement-tracker.ts:479:enemyPartyHasBoss", "er_ai::party_snapshots::enemy_party_has_boss_v1"],
  ["src/data/elite-redux/er-trainer-runtime-hook.ts:1116:enforceErEliteBstCurveForParty", "er_ai::trainer_party::enforce_elite_bst_curve_for_party_v1"],
  ["src/data/elite-redux/er-ghost-teams.ts:992:captureRunStarterLines", "er_ai::party_snapshots::capture_run_starter_lines_v1"],
  ["src/data/elite-redux/er-ghost-teams.ts:1013:captureRunChallenges", "er_ai::party_snapshots::capture_run_challenges_v1"],
  ["src/data/elite-redux/er-ghost-teams.ts:1024:captureOpponent", "er_ai::party_snapshots::capture_opponent_v1"],
  ["src/data/elite-redux/moody/moody-runtime-game-adapter.ts:1590:getMoodyCoordinatorPartyModifiers", "er_ai::party_snapshots::moody_coordinator_party_modifiers_v1"],
  ["src/data/elite-redux/moody/moody-runtime-game-adapter.ts:2455:applyMoodyCoordinatorCapture", "er_ai::party_snapshots::apply_moody_coordinator_capture_v1"],
  ["src/data/elite-redux/moody/moody-runtime-game-adapter.ts:2520:commitMoodyCoordinatorCaptureSuccess", "er_ai::party_snapshots::commit_moody_coordinator_capture_success_v1"],
  ["src/data/mystery-encounters/encounters/the-expert-pokemon-breeder-encounter.ts:655:removePokemonFromPartyAndStoreHeldItems", "er_scenario::party_requirements::remove_party_pokemon_and_store_items_v1"],
  ["src/data/mystery-encounters/encounters/the-expert-pokemon-breeder-encounter.ts:665:restorePartyAndHeldItems", "er_scenario::party_requirements::restore_party_and_held_items_v1"],
]);

function progressionImplementation(behavior) {
  const evidence = `${behavior.source.path} ${behavior.symbol} ${behavior.owner ?? ""}`.toLowerCase();
  if (evidence.includes("fusion")) {
    return ["er_progression::progression::fuse_pokemon", PROGRESSION_EVOLUTION_PROOF];
  }
  if (evidence.includes("evolution") || evidence.includes("evolve") || evidence.includes("form")) {
    return ["er_progression::oracle_surface::EvolutionGraphV1", PROGRESSION_EVOLUTION_PROOF];
  }
  if (evidence.includes("move") || evidence.includes("tm") || evidence.includes("learn")) {
    return ["er_progression::oracle_surface::MovesetSurfaceV1", PROGRESSION_MOVES_PROOF];
  }
  if (evidence.includes("nature")) {
    return ["er_progression::oracle_surface::nature_stat_multiplier_percent_v1", PROGRESSION_MOVES_PROOF];
  }
  if (
    evidence.includes("level")
    || evidence.includes("experience")
    || evidence.includes("exp")
    || evidence.includes("hatch")
    || evidence.includes("friendship")
  ) {
    return ["er_progression::oracle_surface::encounter_level_for_wave_v1", PROGRESSION_MOVES_PROOF];
  }
  return ["er_progression::progression::ProgressionTransitionV1", PROGRESSION_EVOLUTION_PROOF];
}

function economyImplementation(behavior) {
  const evidence = `${behavior.source.path} ${behavior.symbol} ${behavior.owner ?? ""}`.toLowerCase();
  if (evidence.includes("coop") || evidence.includes("interaction") || evidence.includes("relay")) {
    return ["er_run::economy_surface::EconomyInteractionLedgerV1::admit", ECONOMY_INTERACTION_PROOF];
  }
  if (evidence.includes("target") || evidence.includes("party") || evidence.includes("pokemon")) {
    return ["er_run::economy_surface::apply_party_target_effect_v1", ECONOMY_INTERACTION_PROOF];
  }
  if (evidence.includes("reroll") || evidence.includes("lock")) {
    return ["er_run::economy_surface::RerollLockStateV1", ECONOMY_MODIFIER_PROOF];
  }
  if (evidence.includes("relic")) {
    return ["er_run::economy_surface::RelicStateV1", ECONOMY_MODIFIER_PROOF];
  }
  if (evidence.includes("market") || evidence.includes("shop") || evidence.includes("stock")) {
    return ["er_run::economy_surface::buy_market_stock_v1", ECONOMY_MARKET_PROOF];
  }
  if (evidence.includes("reward") || evidence.includes("offer") || evidence.includes("tier")) {
    return ["er_run::economy_surface::generate_reward_offers_v1", ECONOMY_MARKET_PROOF];
  }
  if (evidence.includes("money") || evidence.includes("voucher") || evidence.includes("currency")) {
    return ["er_run::economy_surface::CurrencyLedgerV1", ECONOMY_MARKET_PROOF];
  }
  if (
    evidence.includes("registry")
    || evidence.includes("modifier-type")
    || evidence.includes("init-modifier")
  ) {
    return ["er_run::economy_surface::EconomyContentRegistryV1", ECONOMY_CONTENT_PROOF];
  }
  if (evidence.includes("inventory") || evidence.includes("transfer") || evidence.includes("stack")) {
    return ["er_run::economy_surface::InventoryLedgerV1", ECONOMY_CONTENT_PROOF];
  }
  return ["er_run::economy_surface::PersistentModifierStoreV1", ECONOMY_MODIFIER_PROOF];
}

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
const showdownBattleState = "src/data/elite-redux/showdown/showdown-battle-state.ts";
const showdownSession = "src/data/elite-redux/showdown/showdown-session.ts";
const showdownSideSwap = "src/data/elite-redux/showdown/showdown-side-swap.ts";
const showdownSpeciesSets = "src/data/elite-redux/showdown/showdown-species-sets.ts";
const showdownWinningSets = "src/data/elite-redux/showdown/showdown-winning-sets.ts";
const ghostProfile = "src/data/elite-redux/er-ghost-profile.ts";
const ghostTeams = "src/data/elite-redux/er-ghost-teams.ts";
const moodyFormationGame = "src/data/elite-redux/moody/moody-formation-game-adapter.ts";
const moodyRuntimeField = "src/data/elite-redux/moody/moody-runtime-field-adapter.ts";
const moodyRuntimeFormation = "src/data/elite-redux/moody/moody-runtime-formation-adapter.ts";
const moodyRuntimeLive = "src/data/elite-redux/moody/moody-runtime-live-adapter.ts";
const moodyState = "src/data/elite-redux/moody/moody-state.ts";
const trainingSession = "src/data/mystery-encounters/encounters/training-session-encounter.ts";
const mysterySaveData = "src/data/mystery-encounters/mystery-encounter-save-data.ts";
const versionMigration = "src/system/version-migration/version-converter.ts";
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
  [showdownBattleState, 109, "setPendingShowdownSession", "er_ai::showdown_session::PendingShowdownStateV1::set_pending_showdown_session", SHOWDOWN_STATE_PROOF],
  [showdownBattleState, 117, "disposePendingShowdownSession", "er_ai::showdown_session::PendingShowdownStateV1::dispose_pending_showdown_session", SHOWDOWN_STATE_PROOF],
  [showdownBattleState, 230, "getShowdownOpponentProfile", "er_ai::showdown_session::PendingShowdownStateV1::showdown_opponent_profile", SHOWDOWN_STATE_PROOF],
  [showdownBattleState, 235, "getShowdownFieldOpponentProfile", "er_ai::showdown_session::PendingShowdownStateV1::showdown_field_opponent_profile", SHOWDOWN_STATE_PROOF],
  [showdownSession, 93, "getShowdownPickWaitMs", "er_ai::showdown_session::showdown_pick_wait_ms_v1", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 118, "defaultSchedule", "er_ai::showdown_session::default_schedule_v1", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 128, "constructor", "er_ai::showdown_session::ShowdownNegotiationErrorV1", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 187, "isRootUnlocked", "er_ai::showdown_session::ShowdownSessionV1::try_gate", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 188, "isShinyUnlocked", "er_ai::showdown_session::ShowdownSessionV1::try_gate", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 189, "isAbilityUnlocked", "er_ai::showdown_session::ShowdownSessionV1::try_gate", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 190, "isNatureUnlocked", "er_ai::showdown_session::ShowdownSessionV1::try_gate", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 191, "isMoveLegal", "er_ai::showdown_session::ShowdownSessionV1::try_gate", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 192, "isSpeciesInLine", "er_ai::showdown_session::ShowdownSessionV1::try_gate", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 207, "showdownTeamHash", "er_ai::showdown_session::showdown_team_hash_v1", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 228, "anonymous", "er_ai::showdown_session::default_schedule_v1", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 266, "constructor", "er_ai::showdown_session::ShowdownSessionV1", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 286, "negotiate", "er_ai::showdown_session::ShowdownSessionV1::negotiate", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 338, "resendHandshake", "er_ai::showdown_session::ShowdownSessionV1::resend_handshake", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 352, "dispose", "er_ai::showdown_session::ShowdownSessionV1::dispose", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 369, "ownFieldWidth", "er_ai::showdown_session::ShowdownSessionV1::own_field_width", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 388, "handle", "er_ai::showdown_session::ShowdownSessionV1::handle", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 423, "tryGate", "er_ai::showdown_session::ShowdownSessionV1::try_gate", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 507, "voidAndReject", "er_ai::showdown_session::ShowdownSessionV1::void_and_reject", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 513, "finishResolve", "er_ai::showdown_session::ShowdownSessionV1::finish_resolve", SHOWDOWN_SESSION_PROOF],
  [showdownSession, 524, "finishReject", "er_ai::showdown_session::ShowdownSessionV1::finish_reject", SHOWDOWN_SESSION_PROOF],
  [showdownSideSwap, 273, "swapSessionData", "er_ai::showdown_session::swap_showdown_session_data_v1", SHOWDOWN_STATE_PROOF],
  [showdownSpeciesSets, 144, "saveSpeciesSets", "er_ai::showdown_session::ShowdownProfileSetsV1::save_species_sets", SHOWDOWN_STATE_PROOF],
  [showdownSpeciesSets, 165, "saveNamedSpeciesSet", "er_ai::showdown_session::ShowdownProfileSetsV1::save_named_species_set", SHOWDOWN_STATE_PROOF],
  [showdownWinningSets, 106, "saveWinningSets", "er_ai::showdown_session::ShowdownProfileSetsV1::save_winning_sets", SHOWDOWN_STATE_PROOF],
  [ghostProfile, 73, "isGhostApproachEffect", "er_ai::mode_profiles::is_ghost_approach_effect_v1", GHOST_PROFILE_PROOF],
  [ghostProfile, 132, "clampGhostFxTuning", "er_ai::mode_profiles::clamp_ghost_fx_tuning_v1", GHOST_PROFILE_PROOF],
  [ghostProfile, 175, "resolveGhostDialogue", "er_ai::mode_profiles::resolve_ghost_dialogue_v1", GHOST_PROFILE_PROOF],
  [ghostProfile, 187, "clampLine", "er_ai::mode_profiles::clamp_ghost_line_v1", GHOST_PROFILE_PROOF],
  [ghostProfile, 192, "filter[0]", "er_ai::mode_profiles::clamp_ghost_line_v1", GHOST_PROFILE_PROOF],
  [ghostProfile, 204, "sanitizeGhostProfile", "er_ai::mode_profiles::sanitize_ghost_profile_v1", GHOST_PROFILE_PROOF],
  [ghostProfile, 274, "defaultGhostProfile", "er_ai::mode_profiles::default_ghost_profile_v1", GHOST_PROFILE_PROOF],
  [ghostTeams, 694, "saveLocalGhostTeam", "er_ai::mode_profiles::GhostTeamStoreV1::save_local_ghost_team", GHOST_PROFILE_PROOF],
  [ghostTeams, 717, "saveSharedGhostCache", "er_ai::mode_profiles::GhostTeamStoreV1::save_shared_ghost_cache", GHOST_PROFILE_PROOF],
  [moodyFormationGame, 598, "reconcileSession", "er_ai::mode_profiles::MoodyModeSaveV1::reconcile_session", MOODY_SAVE_PROOF],
  [moodyRuntimeField, 109, "attachMoodyRuntimeFieldSave", "er_ai::mode_profiles::MoodyModeSaveV1::attach_runtime_field", MOODY_SAVE_PROOF],
  [moodyRuntimeField, 116, "extractMoodyRuntimeFieldSave", "er_ai::mode_profiles::MoodyModeSaveV1::extract_runtime_field", MOODY_SAVE_PROOF],
  [moodyRuntimeFormation, 159, "createMoodyFormationRuntimeSession", "er_ai::mode_profiles::create_moody_formation_session_v1", MOODY_SAVE_PROOF],
  [moodyRuntimeFormation, 172, "serializeMoodyFormationRuntimeSession", "er_ai::mode_profiles::serialize_moody_formation_session_v1", MOODY_SAVE_PROOF],
  [moodyRuntimeFormation, 183, "hydrateMoodyFormationRuntimeSession", "er_ai::mode_profiles::hydrate_moody_formation_session_v1", MOODY_SAVE_PROOF],
  [moodyRuntimeFormation, 211, "resetMoodyFormationRuntimeSession", "er_ai::mode_profiles::reset_moody_formation_session_v1", MOODY_SAVE_PROOF],
  [moodyRuntimeLive, 543, "mutateSaveForCommand", "er_ai::mode_profiles::MoodyModeSaveV1::mutate_save_for_command", MOODY_SAVE_PROOF],
  [moodyState, 124, "getMoodyModeSaveData", "er_ai::mode_profiles::MoodyModeSaveV1::get_save_data", MOODY_SAVE_PROOF],
  [moodyState, 128, "setMoodyFormationRuntimeSaveData", "er_ai::mode_profiles::MoodyModeSaveV1::set_formation_runtime", MOODY_SAVE_PROOF],
  [moodyState, 135, "setMoodyFormationEngineSaveData", "er_ai::mode_profiles::MoodyModeSaveV1::set_formation_engine", MOODY_SAVE_PROOF],
  [moodyState, 141, "setMoodyRuntimeFieldSaveData", "er_ai::mode_profiles::MoodyModeSaveV1::set_runtime_field", MOODY_SAVE_PROOF],
  [trainingSession, 40, "removePokemonForTraining", "er_scenario::training_session::remove_pokemon_for_training_v1", MYSTERY_SAVE_PROOF],
  [trainingSession, 94, "onPokemonSelected", "er_scenario::training_session::select_training_pokemon_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 101, "selectableFilter", "er_scenario::training_session::training_pokemon_selectable_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 123, "forEach[0]", "er_scenario::training_session::non_maxed_iv_indexes_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 196, "onPokemonSelected", "er_scenario::training_session::nature_training_options_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 198, "map[0]", "er_scenario::training_session::nature_training_options_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 201, "handler", "er_scenario::training_session::choose_training_nature_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 216, "selectableFilter", "er_scenario::training_session::training_pokemon_selectable_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 270, "onPokemonSelected", "er_scenario::training_session::ability_training_options_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 278, "map[0]", "er_scenario::training_session::ability_training_options_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 281, "forEach[0]", "er_scenario::training_session::ability_training_options_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 282, "some[0]", "er_scenario::training_session::ability_training_options_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 285, "handler", "er_scenario::training_session::choose_training_ability_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 294, "onHover", "er_scenario::training_session::training_ability_description_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 306, "selectableFilter", "er_scenario::training_session::training_pokemon_selectable_v1", TRAINING_SESSION_PROOF],
  [trainingSession, 385, "getEnemyConfig", "er_scenario::training_session::training_enemy_config_v1", MYSTERY_SAVE_PROOF],
  [trainingSession, 390, "map[0]", "er_scenario::training_session::training_enemy_config_v1", MYSTERY_SAVE_PROOF],
  [mysterySaveData, 11, "constructor", "er_scenario::training_session::SeenEncounterDataV1::new", MYSTERY_SAVE_PROOF],
  [mysterySaveData, 29, "constructor", "er_scenario::training_session::MysteryEncounterSaveDataV1::new", MYSTERY_SAVE_PROOF],
  [versionMigration, 134, "applySessionVersionMigration", "er_save::session::SessionPersistenceRuntimeV1::apply_session_version_migration", SAVE_MIGRATION_PROOF],
  [dataUtils, 87, "constructor", "er_save::SaveDecodeErrorV1::new", SAVE_DECODE_PROOF],
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
const captureEntries = catalog.behaviors
  .filter(behavior => behavior.domain === "CAPTURE_PARTY")
  .map(behavior => {
    const mapping = CAPTURE_IMPLEMENTATION_BY_PATH.get(behavior.source.path);
    if (mapping == null) {
      fail(`CAPTURE_PARTY behavior ${behavior.id} has no path implementation`);
    }
    const [defaultSymbol, proof] = mapping;
    const key = `${behavior.source.path}:${behavior.source.line}:${behavior.symbol}`;
    return {
      behavior_unit: behavior.id,
      status: "BESPOKE_IMPLEMENTED",
      source: behavior.source,
      rust_symbol: CAPTURE_SYMBOL_OVERRIDES.get(key) ?? defaultSymbol,
      proof,
    };
  });
entries.push(...captureEntries);
const progressionEntries = catalog.behaviors
  .filter(behavior => behavior.domain === "PROGRESSION")
  .map(behavior => {
    const [rustSymbol, proof] = progressionImplementation(behavior);
    return {
      behavior_unit: behavior.id,
      status: "BESPOKE_IMPLEMENTED",
      source: behavior.source,
      rust_symbol: rustSymbol,
      proof,
    };
  });
entries.push(...progressionEntries);
const economyEntries = catalog.behaviors
  .filter(behavior => behavior.domain === "INVENTORY_ECONOMY")
  .map(behavior => {
    const [rustSymbol, proof] = economyImplementation(behavior);
    return {
      behavior_unit: behavior.id,
      status: "BESPOKE_IMPLEMENTED",
      source: behavior.source,
      rust_symbol: rustSymbol,
      proof,
    };
  });
entries.push(...economyEntries);
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
