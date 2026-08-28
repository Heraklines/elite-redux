//! End-to-end synthetic proof for M7 content, run IR, lifecycle material, controls, and saves.

use std::collections::BTreeMap;
use std::error::Error;
use std::sync::Arc;

use er_ai::{
    AI_POLICY_PACK_SCHEMA_VERSION_V1, AiPolicyDefinitionV1, AiPolicyKindV1, AiPolicyPackV1,
};
use er_content::pack::m6_pack::{
    BattleContentPackV3, BehaviorClassificationManifestV2, BespokeManifestV2, FieldContentV1,
};
use er_content::pack::{m6_prepared::prepare_content, selected_type_chart};
use er_env::{EnvironmentKernelComponentsV1, GameEffect, GameEnvironment};
use er_game::m7_content::{
    GAME_CONTENT_BUNDLE_SCHEMA_VERSION_V1, GameBehaviorClassificationV1, GameContentBundleV1,
    META_CONTENT_PACK_SCHEMA_VERSION_V1, MetaContentPackV1, PreparedGameContentV1,
    RunContentPackV3,
};
use er_game::m7_material::{
    GameActionMaterialKindV1, GameActionMaterialV1, GameMaterialV5, MaterialApplyResultV5,
    apply_game_material_v5,
};
use er_game::m7_progression_control::capture_control;
use er_game::m7_run_executor::{RunExecutionContextV1, execute_run_hook_v1};
use er_game::m7_runtime::{GameControlIntentV2, GameRuntimeV5};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use er_progression::lifecycle::{
    AuditedCaptureRng, CaptureDestinationV1, CaptureOutcomeV1, LifecycleError, attempt_capture,
};
use er_progression::material::{
    LifecycleMaterialApplyV1, LifecycleMaterialV1, apply_lifecycle_material_v1,
    apply_serialized_lifecycle_material_v1,
};
use er_progression::{
    CaptureBallDefinitionV1, GrowthRateDefinitionV1, NatureDefinitionV1,
    PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V1, ProgressionContentPackV1,
    SpeciesProgressionDefinitionV1,
};
use er_rng::battle::RngRuntime;
use er_save::GameSaveV1;
use er_scenario::{
    CompleteNode, MessageNode, SCENARIO_CONTENT_PACK_SCHEMA_VERSION_V1,
    SCENARIO_GRAPH_SCHEMA_VERSION_V1, ScenarioContentPackV1, ScenarioGraphV1, ScenarioNode,
    ScenarioNodeEntryV1,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::m7_state::{
    BATTLE_STATE_SCHEMA_VERSION_V5, BattleStateV5, DexState, EvolutionStateV1, FactionStateV1,
    GAME_STATE_SCHEMA_VERSION_V5, GameStateV5, INVENTORY_STATE_SCHEMA_VERSION_V1, InventoryEntryV1,
    InventoryStateV1, MapNodeKindV1, MapNodeStateV1, POKEMON_STATE_SCHEMA_VERSION_V5,
    PROFILE_STATE_SCHEMA_VERSION_V1, PokemonStateV5, ProfileStateV1, ProfileStatistics,
    ProgressionQueueV2, QuestStateV1, RUN_STATE_SCHEMA_VERSION_V3, RouteRevealSourceV1, RunStateV3,
    WORLD_STATE_SCHEMA_VERSION_V1, WorldStateV1,
};
use er_state::mechanic_state_v2::MechanicStateStoreV2;
use er_state::pokemon_v2::{Iv, PermanentStatBonuses};
use er_types::battle_command::CommandCollectionState;
use er_types::battle_ids::{
    AbilityId, BattleFormat, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, GameModeId,
    MenuInstanceId, MoveId, PartyIndex, PokemonId, SpeciesId, WaveIndex,
};
use er_types::battle_model::{
    AbilityLoadout, BattleOutcome, BattleStats, GlobalAbilitySuppressionState, PokemonType,
    PokemonTyping, StatStages, StatusKind, StatusState, TerrainKind, TerrainState, WeatherKind,
    WeatherState,
};
use er_types::run_ids::{
    BiomeId, EncounterId, Experience, GameRunId, GrowthRateId, Money, NatureId, RouteNodeId,
};
use er_types::run_model::RunOutcome;
use er_types::{
    AiPolicyId, BattleContentPackHashV3, BattleUiActionV1, CaptureActionV1, CatalogHash,
    GameActionContextV1, GameActionV1, GameBehaviorStatus, GameBehaviorUnitId,
    GameContentBundleHash, GameControlKindV2, GameControlPlanV2, GameMenuCancelV2,
    GameMenuOptionV2, GameMenuV2, InputFocus, InventoryItemId, MenuOptionId, OperationId,
    OracleSha, PartyActionV1, PhysicalKey, ProfileFlagId, ProgressionActionV1, RawInputEvent,
    RunCondition, RunConditionId, RunExecutionContextV2, RunFlagId, RunHook, RunHookBinding,
    RunOperation, RunProgramBudget, RunProgramId, RunProgramV1, RunSelector, RunSelectorId,
    RunValue, RunValueId, SafeU53, ScenarioGameActionV1, ScenarioId, ScenarioNodeId, SeatId,
    TerminalActionV1, WorldActionV1,
};
use er_wasm::m7_parity::{
    LifecycleBoundaryRequestV1, MaterialBoundaryResultV1, apply_lifecycle_boundary_native,
};
use er_world::runtime::{
    AuditedWorldRng, NotorietyScaleV1, PacingRatioV1, WorldRuntimeError, add_treasure_fragments,
    advance_wave, biome_end_rule, biome_event_rate, biome_forced_terrain, biome_forced_weather,
    biome_should_end, biome_skip_fallback, biome_wave_skip_chance, chart_onward_routes,
    consume_carried_weather, consume_map_travel_target, consume_treasure_fragments_for_reward,
    early_wave_move_power_ratio, fairy_luck_waves_left, final_wave, grant_fairy_luck,
    initialize_biome_depths, is_chapter_start_wave, is_checkpoint_wave, is_major_checkpoint_wave,
    is_wave_final, legend_min_wave, map_upgrade_tier, mark_biome_stay, mark_leave_biome,
    notoriety_boss_chance_pct, notoriety_bst_bonus, notoriety_trainer_chance_pct,
    plan_biome_structure, progression_wave, record_biome_entry, reveal_next_pending_node,
    roll_next_biome_nodes, set_any_biome_travel_target, set_carried_weather,
    should_raise_crossroads, starting_biome, story_source_wave, temporary_fairy_luck,
    visible_route_node_count, wave_for_difficulty,
};
use er_world::{
    BiomeBattleRuleV1, BiomeDefinitionV1, BiomeEncounterProfileV1, BiomeRouteLinkV1,
    BiomeSkipFallbackV1, EncounterDefinitionV1, EncounterKindV1, GameModeDefinitionV1,
    PokemonBuildV1, RouteDefinitionV1, TerminalWavePolicyV1, WORLD_CONTENT_PACK_SCHEMA_VERSION_V1,
    WeightedEncounterV1, WeightedRouteV1, WorldContentPackV1, WorldRatioV1,
};

const ORACLE: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";

pub type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe fixture integer")
}

fn catalog(fill: char) -> CatalogHash {
    CatalogHash::parse(fill.to_string().repeat(64)).expect("catalog hash")
}

fn behavior() -> GameBehaviorUnitId {
    GameBehaviorUnitId::parse("a".repeat(64)).expect("behavior ID")
}

fn foundation_behavior() -> GameBehaviorUnitId {
    GameBehaviorUnitId::parse("b".repeat(64)).expect("foundation behavior ID")
}

fn terminal_behavior() -> GameBehaviorUnitId {
    GameBehaviorUnitId::parse("c".repeat(64)).expect("terminal behavior ID")
}

fn run_program() -> RunProgramV1 {
    RunProgramV1 {
        schema_version: 1,
        id: RunProgramId::new(safe(1)),
        source: behavior(),
        hooks: vec![RunHookBinding {
            hook: RunHook::RunStarted,
            condition: RunConditionId(0),
            first_operation: 0,
            operation_count: 1,
        }],
        conditions: vec![RunCondition::Always],
        selectors: Vec::new(),
        values: Vec::new(),
        operations: vec![RunOperation::SetRunFlag {
            flag: RunFlagId::new(safe(1)),
            value: true,
        }],
        budget: RunProgramBudget {
            condition_nodes: 1,
            selector_nodes: 0,
            value_nodes: 0,
            operations: 1,
            emitted_presentations: 0,
        },
    }
}

fn foundation_journey_program() -> RunProgramV1 {
    RunProgramV1 {
        schema_version: 1,
        id: RunProgramId::new(safe(2)),
        source: foundation_behavior(),
        hooks: vec![RunHookBinding {
            hook: RunHook::RewardSelected,
            condition: RunConditionId(0),
            first_operation: 0,
            operation_count: 7,
        }],
        conditions: vec![RunCondition::Always],
        selectors: vec![RunSelector::Pokemon(PokemonId::new(safe(1)))],
        values: vec![RunValue::Unsigned(5)],
        operations: vec![
            RunOperation::SetBiome {
                biome: BiomeId::new(safe(2)),
            },
            RunOperation::SetProfileFlag {
                flag: ProfileFlagId::new(safe(1)),
                value: true,
            },
            RunOperation::HealPokemon {
                target: RunSelectorId(0),
                amount: RunValueId(0),
            },
            RunOperation::SetLevel {
                target: RunSelectorId(0),
                level: 6,
            },
            RunOperation::SendPokemonToStorage {
                target: RunSelectorId(0),
            },
            RunOperation::AddItem {
                item: InventoryItemId::new(safe(1)),
                count: 1,
            },
            RunOperation::SetRunFlag {
                flag: RunFlagId::new(safe(2)),
                value: true,
            },
        ],
        budget: RunProgramBudget {
            condition_nodes: 1,
            selector_nodes: 1,
            value_nodes: 1,
            operations: 7,
            emitted_presentations: 0,
        },
    }
}

fn terminal_journey_program() -> RunProgramV1 {
    RunProgramV1 {
        schema_version: 1,
        id: RunProgramId::new(safe(3)),
        source: terminal_behavior(),
        hooks: vec![RunHookBinding {
            hook: RunHook::ProfileLoaded,
            condition: RunConditionId(0),
            first_operation: 0,
            operation_count: 1,
        }],
        conditions: vec![RunCondition::Always],
        selectors: Vec::new(),
        values: Vec::new(),
        operations: vec![RunOperation::EnterTerminal {
            outcome: RunOutcome::Victory,
        }],
        budget: RunProgramBudget {
            condition_nodes: 1,
            selector_nodes: 0,
            value_nodes: 0,
            operations: 1,
            emitted_presentations: 0,
        },
    }
}

fn battle_pack() -> TestResult<BattleContentPackV3> {
    let mut pack = BattleContentPackV3 {
        schema_version: er_types::M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
        oracle_sha: OracleSha::parse(ORACLE)?,
        raw_catalog_hash: catalog('1'),
        semantic_catalog_hash: catalog('2'),
        content_hash: BattleContentPackHashV3::parse(format!(
            "{}{}",
            BattleContentPackHashV3::PREFIX,
            "0".repeat(64)
        ))?,
        species: Vec::new(),
        forms: Vec::new(),
        moves: Vec::new(),
        abilities: Vec::new(),
        held_items: Vec::new(),
        field_content: FieldContentV1::default(),
        programs: vec![None],
        classifications: BehaviorClassificationManifestV2::default(),
        bespoke: BespokeManifestV2::default(),
        rng_sites: Vec::new(),
        type_chart: selected_type_chart(),
    };
    pack.content_hash = pack.compute_content_hash()?;
    prepare_content(pack.clone())?;
    Ok(pack)
}

fn progression_pack() -> ProgressionContentPackV1 {
    let experience_by_level = (0_u64..=100)
        .map(|level| Experience::new(safe(level * level * level)))
        .collect();
    ProgressionContentPackV1 {
        schema_version: PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V1,
        oracle_sha: OracleSha::parse(ORACLE).expect("oracle"),
        content_hash: catalog('3'),
        growth_rates: vec![GrowthRateDefinitionV1 {
            id: GrowthRateId::new(0),
            experience_by_level,
        }],
        natures: vec![NatureDefinitionV1 {
            id: NatureId::new(0),
            increased_stat: None,
            decreased_stat: None,
        }],
        capture_balls: vec![CaptureBallDefinitionV1 {
            item: InventoryItemId::new(safe(1)),
            registry_key: "poke-ball".to_owned(),
            catch_multiplier_numerator: 1,
            catch_multiplier_denominator: 1,
        }],
        species: vec![SpeciesProgressionDefinitionV1 {
            species: SpeciesId::new(safe(1)),
            form: 0,
            growth_rate: GrowthRateId::new(0),
            base_friendship: 70,
            catch_rate: 255,
            allowed_natures: vec![NatureId::new(0)],
            level_moves: Vec::new(),
            reminder_moves: Vec::new(),
            tm_moves: Vec::new(),
            evolutions: Vec::new(),
        }],
        evolutions: Vec::new(),
    }
}

fn world_pack() -> WorldContentPackV1 {
    WorldContentPackV1 {
        schema_version: WORLD_CONTENT_PACK_SCHEMA_VERSION_V1,
        oracle_sha: OracleSha::parse(ORACLE).expect("oracle"),
        content_hash: catalog('4'),
        modes: vec![GameModeDefinitionV1 {
            id: GameModeId::new(safe(1)),
            key: "classic".to_owned(),
            first_wave: 1,
            terminal_wave: Some(200),
            terminal_policy: TerminalWavePolicyV1::Exact(200),
            difficulty_base_offset: 0,
            difficulty_curve_interval: None,
            route: RouteNodeId::new(safe(1)),
            allows_coop: true,
            branching_routes: true,
            sprint_structure: false,
            finale_routing_start_wave: Some(170),
            progression_scale: 1,
            checkpoint_interval: 10,
            major_checkpoint_interval: 50,
            mystery_encounter_max_wave: 180,
            mystery_encounter_target: 24,
            early_move_power_cap_wave: 30,
            gym_interval: 30,
            story_source_waves: BTreeMap::new(),
        }],
        biomes: vec![
            BiomeDefinitionV1 {
                id: BiomeId::new(safe(1)),
                key: "plains".to_owned(),
                travel_allowed: true,
                encounters: vec![WeightedEncounterV1 {
                    encounter: EncounterId::new(safe(1)),
                    weight: 1,
                }],
                exits: vec![WeightedRouteV1 {
                    route: RouteNodeId::new(safe(2)),
                    weight: 1,
                }],
                routing_exits: vec![BiomeRouteLinkV1 {
                    route: RouteNodeId::new(safe(2)),
                    inclusion_denominator: None,
                }],
                encounter_profile: Some(BiomeEncounterProfileV1 {
                    event_rate: WorldRatioV1 {
                        numerator: 7,
                        denominator: 10,
                    },
                    trainer_rate: WorldRatioV1 {
                        numerator: 1,
                        denominator: 1,
                    },
                    boss_chance_pct: 25,
                    boss_every_wave: false,
                    boss_bars: None,
                    skip_chance_pct: 40,
                    skip_fallback: Some(BiomeSkipFallbackV1 {
                        event_weight: 60,
                        boss_weight: 40,
                    }),
                }),
                battle_rule: Some(BiomeBattleRuleV1 {
                    forced_weather: Some(WeatherKind::UnsupportedOracleCode(1)),
                    forced_terrain: Some(TerrainKind::UnsupportedOracleCode(1)),
                }),
            },
            BiomeDefinitionV1 {
                id: BiomeId::new(safe(2)),
                key: "forest".to_owned(),
                travel_allowed: true,
                encounters: vec![WeightedEncounterV1 {
                    encounter: EncounterId::new(safe(1)),
                    weight: 1,
                }],
                exits: vec![WeightedRouteV1 {
                    route: RouteNodeId::new(safe(3)),
                    weight: 1,
                }],
                routing_exits: vec![BiomeRouteLinkV1 {
                    route: RouteNodeId::new(safe(3)),
                    inclusion_denominator: None,
                }],
                encounter_profile: None,
                battle_rule: None,
            },
            BiomeDefinitionV1 {
                id: BiomeId::new(safe(3)),
                key: "cave".to_owned(),
                travel_allowed: true,
                encounters: vec![WeightedEncounterV1 {
                    encounter: EncounterId::new(safe(1)),
                    weight: 1,
                }],
                exits: vec![WeightedRouteV1 {
                    route: RouteNodeId::new(safe(1)),
                    weight: 1,
                }],
                routing_exits: vec![BiomeRouteLinkV1 {
                    route: RouteNodeId::new(safe(1)),
                    inclusion_denominator: None,
                }],
                encounter_profile: None,
                battle_rule: None,
            },
        ],
        routes: vec![
            RouteDefinitionV1 {
                id: RouteNodeId::new(safe(1)),
                biome: BiomeId::new(safe(1)),
                next: vec![WeightedRouteV1 {
                    route: RouteNodeId::new(safe(2)),
                    weight: 1,
                }],
                minimum_wave: 1,
                maximum_wave: Some(200),
            },
            RouteDefinitionV1 {
                id: RouteNodeId::new(safe(2)),
                biome: BiomeId::new(safe(2)),
                next: vec![WeightedRouteV1 {
                    route: RouteNodeId::new(safe(3)),
                    weight: 1,
                }],
                minimum_wave: 1,
                maximum_wave: Some(200),
            },
            RouteDefinitionV1 {
                id: RouteNodeId::new(safe(3)),
                biome: BiomeId::new(safe(3)),
                next: vec![WeightedRouteV1 {
                    route: RouteNodeId::new(safe(1)),
                    weight: 1,
                }],
                minimum_wave: 1,
                maximum_wave: Some(200),
            },
        ],
        encounters: vec![EncounterDefinitionV1 {
            id: EncounterId::new(safe(1)),
            key: "wild-one".to_owned(),
            kind: EncounterKindV1::Wild,
            party: vec![PokemonBuildV1 {
                species: SpeciesId::new(safe(1)),
                form: 0,
                level_offset: 0,
                moves: vec![MoveId::new(safe(1))],
                active_ability: er_types::battle_ids::AbilityId::new(safe(1)),
                passive_abilities: [None; 3],
                held_items: Vec::new(),
                tera_type: None,
            }],
            money_reward: safe(0),
            ai_policy_key: "first-legal".to_owned(),
        }],
    }
}

fn scenario_pack() -> ScenarioContentPackV1 {
    ScenarioContentPackV1 {
        schema_version: SCENARIO_CONTENT_PACK_SCHEMA_VERSION_V1,
        oracle_sha: OracleSha::parse(ORACLE).expect("oracle"),
        content_hash: catalog('5'),
        graphs: vec![ScenarioGraphV1 {
            schema_version: SCENARIO_GRAPH_SCHEMA_VERSION_V1,
            id: ScenarioId::new(safe(1)),
            source: behavior(),
            entry: ScenarioNodeId::new(safe(1)),
            nodes: vec![
                ScenarioNodeEntryV1 {
                    id: ScenarioNodeId::new(safe(1)),
                    node: ScenarioNode::Message(MessageNode {
                        message_key: "mystery.start".to_owned(),
                        next: ScenarioNodeId::new(safe(2)),
                    }),
                },
                ScenarioNodeEntryV1 {
                    id: ScenarioNodeId::new(safe(2)),
                    node: ScenarioNode::Complete(CompleteNode {
                        outcome_key: "mystery.complete".to_owned(),
                    }),
                },
            ],
            intentionally_unreachable: Vec::new(),
        }],
    }
}

fn ai_pack() -> AiPolicyPackV1 {
    AiPolicyPackV1 {
        schema_version: AI_POLICY_PACK_SCHEMA_VERSION_V1,
        oracle_sha: OracleSha::parse(ORACLE).expect("oracle"),
        content_hash: catalog('6'),
        policies: vec![AiPolicyDefinitionV1 {
            id: AiPolicyId::new(safe(1)),
            key: "first-legal".to_owned(),
            kind: AiPolicyKindV1::FirstLegal,
            decision_budget: 1,
        }],
    }
}

fn prepared_content() -> TestResult<Arc<PreparedGameContentV1>> {
    let battle = Arc::new(battle_pack()?);
    let run = Arc::new(RunContentPackV3::new(
        OracleSha::parse(ORACLE)?,
        battle.content_hash.clone(),
        vec![
            run_program(),
            foundation_journey_program(),
            terminal_journey_program(),
        ],
    )?);
    let meta = Arc::new(MetaContentPackV1 {
        schema_version: META_CONTENT_PACK_SCHEMA_VERSION_V1,
        oracle_sha: OracleSha::parse(ORACLE)?,
        content_hash: catalog('8'),
        classifications: vec![
            GameBehaviorClassificationV1 {
                behavior: behavior(),
                status: GameBehaviorStatus::Compiled,
            },
            GameBehaviorClassificationV1 {
                behavior: foundation_behavior(),
                status: GameBehaviorStatus::Compiled,
            },
            GameBehaviorClassificationV1 {
                behavior: terminal_behavior(),
                status: GameBehaviorStatus::Compiled,
            },
        ],
    });
    let mut bundle = GameContentBundleV1 {
        schema_version: GAME_CONTENT_BUNDLE_SCHEMA_VERSION_V1,
        oracle_sha: OracleSha::parse(ORACLE)?,
        battle,
        run,
        progression: Arc::new(progression_pack()),
        world: Arc::new(world_pack()),
        scenarios: Arc::new(scenario_pack()),
        ai: Arc::new(ai_pack()),
        meta,
        content_hash: GameContentBundleHash::parse(format!("blake3-v1:{}", "0".repeat(64)))?,
    };
    bundle.content_hash = bundle.recompute_hash()?;
    Ok(Arc::new(PreparedGameContentV1::prepare(Arc::new(bundle))?))
}

fn profile() -> ProfileStateV1 {
    ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: BTreeMap::new(),
        statistics: ProfileStatistics {
            runs_started: safe(1),
            runs_won: safe(0),
            runs_lost: safe(0),
            battles_won: safe(0),
            pokemon_captured: safe(0),
            highest_wave: WaveIndex::new(safe(1)).expect("wave"),
        },
        dex: DexState::default(),
    }
}

fn game_state(content: &PreparedGameContentV1) -> TestResult<GameStateV5> {
    let control = capture_control(
        MenuInstanceId::new(safe(1)),
        safe(1),
        SeatId::new(safe(1)),
        OperationId::new("m7/system/capture")?,
        PokemonId::new(safe(2)),
        &[(InventoryItemId::new(safe(1)), "poke-ball".to_owned())],
    )?;
    let state = GameStateV5 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V5,
        content_identity: content.identity().clone(),
        profile: profile(),
        active_run: Some(RunStateV3 {
            schema_version: RUN_STATE_SCHEMA_VERSION_V3,
            run_id: GameRunId::new(safe(1)),
            seed: "m7-system-proof".to_owned(),
            mode: GameModeId::new(safe(1)),
            wave: WaveIndex::new(safe(1))?,
            run_rng: RngRuntime::from_run_seed("m7-system-proof").run_state(),
            party: Vec::new(),
            storage: Vec::new(),
            inventory: InventoryStateV1 {
                schema_version: INVENTORY_STATE_SCHEMA_VERSION_V1,
                entries: vec![InventoryEntryV1 {
                    item: InventoryItemId::new(safe(1)),
                    registry_key: "poke-ball".to_owned(),
                    count: 1,
                }],
            },
            modifiers: Vec::new(),
            money: Money::new(safe(0)),
            world: WorldStateV1 {
                schema_version: WORLD_STATE_SCHEMA_VERSION_V1,
                biome: BiomeId::new(safe(1)),
                route: RouteNodeId::new(safe(1)),
                visited_routes: vec![RouteNodeId::new(safe(1))],
                encounter_sequence: safe(0),
                mode_counters: BTreeMap::new(),
                previous_biome: None,
                recent_biomes: Vec::new(),
                pending_nodes: Vec::new(),
                pending_nodes_ready: false,
                event_revealed_biomes: Vec::new(),
                biome_length: Some(1),
                biome_start_wave: WaveIndex::new(safe(1))?,
                leave_biome_now: false,
                overstay_anchor_wave: None,
                map_nodes: Vec::new(),
                travel_target: None,
                authoritative_travel: None,
                treasure_fragments: 0,
                carried_weather: None,
                biome_history: vec![BiomeId::new(safe(1))],
                fairy_luck_bonus: 0,
                fairy_luck_expiry_wave: None,
            },
            scenario: None,
            quests: QuestStateV1::default(),
            factions: FactionStateV1::default(),
            progression_queue: ProgressionQueueV2 {
                next_sequence: safe(1),
                tasks: Vec::new(),
                active_index: None,
            },
            battle: None,
            control,
            flags: BTreeMap::new(),
            outcome: RunOutcome::InProgress,
        }),
    };
    state.validate()?;
    Ok(state)
}

fn pokemon_state(id: u64, owner: Option<SeatId>) -> TestResult<PokemonStateV5> {
    Ok(PokemonStateV5 {
        schema_version: POKEMON_STATE_SCHEMA_VERSION_V5,
        id: PokemonId::new(safe(id)),
        owner_seat: owner,
        species_id: SpeciesId::new(safe(1)),
        form_index: 0,
        level: 5,
        experience: Experience::new(safe(125)),
        types: PokemonTyping {
            primary: PokemonType::Normal,
            secondary: None,
        },
        stats: BattleStats {
            hp: 20,
            attack: 10,
            defense: 10,
            special_attack: 10,
            special_defense: 10,
            speed: 10,
        },
        hp: 20,
        max_hp: 20,
        status: StatusState {
            kind: StatusKind::None,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        },
        stat_stages: StatStages {
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
            accuracy: 0,
            evasion: 0,
        },
        moves: [None; 4],
        abilities: AbilityLoadout {
            active: AbilityId::new(safe(1)),
            passives: [None; 3],
            active_suppressed: false,
            passive_suppressed: [false; 3],
        },
        ivs: [Iv::new(31)?; 6],
        nature: NatureId::new(0),
        effective_nature: NatureId::new(0),
        friendship: 70,
        permanent_bonuses: PermanentStatBonuses {
            hp: 0,
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
        },
        pause_evolutions: false,
        held_items: Vec::new(),
        mechanics: MechanicStateStoreV2::default(),
        fusion: None,
        evolution: EvolutionStateV1 {
            last_completed: None,
            cancelled: Vec::new(),
        },
        tera_type: None,
        shiny: false,
        variant: 0,
        capture: None,
        fainted: false,
    })
}

fn game_state_with_battle(content: &PreparedGameContentV1) -> TestResult<GameStateV5> {
    let mut state = game_state(content)?;
    let run = state.active_run.as_mut().ok_or("missing run")?;
    let player = pokemon_state(1, Some(SeatId::new(safe(1))))?;
    let enemy = pokemon_state(2, None)?;
    run.party.push(player);
    let format = BattleFormat::single();
    let player_slot = FieldSlot::new(BattleSide::Player, 0)?;
    let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)?;
    let field = FieldState::new_for_format(
        &format,
        vec![
            FieldSlotState::new(player_slot, Some(PokemonId::new(safe(1)))),
            FieldSlotState::new(enemy_slot, Some(PokemonId::new(safe(2)))),
        ],
    )?;
    let mut rng = RngRuntime::from_run_seed("m7-capture-proof");
    let battle_rng = rng.initialize_battle("m7-capture-wave", run.wave)?;
    run.run_rng = rng.run_state();
    run.battle = Some(BattleStateV5 {
        schema_version: BATTLE_STATE_SCHEMA_VERSION_V5,
        battle_id: BattleId::new(safe(1)),
        wave: run.wave,
        wave_seed: "m7-capture-wave".to_owned(),
        turn: battle_rng.turn,
        format,
        authority_seat: SeatId::new(safe(1)),
        enemy_party: vec![enemy],
        field,
        weather: WeatherState {
            kind: WeatherKind::None,
            remaining_turns: 0,
        },
        terrain: TerrainState {
            kind: TerrainKind::None,
            remaining_turns: 0,
        },
        arena_conditions: Vec::new(),
        global_ability_suppression: GlobalAbilitySuppressionState {
            ignore_abilities: false,
            source: None,
        },
        battle_rng,
        command_state: CommandCollectionState {
            frontier: Vec::new(),
            tombstones: Vec::new(),
        },
        mechanics: MechanicStateStoreV2::default(),
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::new(safe(1)),
        outcome: BattleOutcome::Ongoing,
    });
    state.validate()?;
    Ok(state)
}

struct CaptureZero;

impl AuditedCaptureRng for CaptureZero {
    fn draw_capture(&mut self, _upper_exclusive: u32) -> Result<u32, LifecycleError> {
        Ok(0)
    }
}

struct ScriptedWorldRng {
    draws: Vec<u64>,
    next: usize,
}

impl ScriptedWorldRng {
    fn new(draws: Vec<u64>) -> Self {
        Self { draws, next: 0 }
    }
}

impl AuditedWorldRng for ScriptedWorldRng {
    fn draw_weighted(&mut self, _upper_exclusive: u64) -> Result<u64, WorldRuntimeError> {
        let draw = self
            .draws
            .get(self.next)
            .copied()
            .ok_or(WorldRuntimeError::Weight)?;
        self.next += 1;
        Ok(draw)
    }
}

#[test]
fn capture_consumes_ball_and_moves_enemy_into_party() -> TestResult {
    let content = prepared_content()?;
    let state = game_state_with_battle(&content)?;
    let transition = attempt_capture(
        &state,
        &content.progression,
        PokemonId::new(safe(2)),
        InventoryItemId::new(safe(1)),
        SeatId::new(safe(1)),
        &mut CaptureZero,
    )?;
    assert_eq!(
        transition.outcome,
        CaptureOutcomeV1::Captured {
            destination: CaptureDestinationV1::Party,
        }
    );
    let run = transition
        .after_state
        .active_run
        .as_ref()
        .ok_or("missing run")?;
    assert_eq!(run.party.len(), 2);
    assert!(run.inventory.entries.is_empty());
    assert!(
        run.battle
            .as_ref()
            .is_some_and(|battle| battle.enemy_party.is_empty())
    );
    Ok(())
}

#[test]
fn branching_routes_and_biome_structure_are_canonical_state() -> TestResult {
    let content = prepared_content()?;
    let state = game_state(&content)?;
    assert_eq!(
        biome_event_rate(&content.world, BiomeId::new(safe(1))),
        WorldRatioV1 {
            numerator: 7,
            denominator: 10,
        }
    );
    assert_eq!(
        biome_wave_skip_chance(&content.world, BiomeId::new(safe(1))),
        40
    );
    assert_eq!(
        biome_skip_fallback(&content.world, BiomeId::new(safe(1))),
        Some(BiomeSkipFallbackV1 {
            event_weight: 60,
            boss_weight: 40,
        })
    );
    assert_eq!(
        biome_forced_weather(&content.world, BiomeId::new(safe(1))),
        Some(WeatherKind::UnsupportedOracleCode(1))
    );
    assert_eq!(
        biome_forced_terrain(&content.world, BiomeId::new(safe(1))),
        Some(TerrainKind::UnsupportedOracleCode(1))
    );
    let mut depth_rng = ScriptedWorldRng::new(vec![0]);
    let (depths, depth_draws) = initialize_biome_depths(
        &content.world,
        BiomeId::new(safe(1)),
        BiomeId::new(safe(3)),
        &mut depth_rng,
    )?;
    assert_eq!(depth_draws.len(), 1);
    assert!(depths[&BiomeId::new(safe(3))].depth > depths[&BiomeId::new(safe(1))].depth);
    let mut route_rng = ScriptedWorldRng::new(vec![49]);
    let routed = roll_next_biome_nodes(&state, &content.world, 1, &mut route_rng)?;
    assert_eq!(routed.draws.len(), 1);
    let world = &routed
        .after_state
        .active_run
        .as_ref()
        .ok_or("missing run")?
        .world;
    assert!(world.pending_nodes_ready);
    assert_eq!(world.pending_nodes.len(), 2);
    assert_eq!(world.pending_nodes[0].biome, BiomeId::new(safe(2)));
    assert!(world.pending_nodes[0].revealed);
    assert_eq!(world.pending_nodes[0].source, RouteRevealSourceV1::Base);
    assert_eq!(world.pending_nodes[1].biome, BiomeId::new(safe(3)));
    assert!(!world.pending_nodes[1].revealed);
    assert_eq!(world.pending_nodes[1].source, RouteRevealSourceV1::Base);

    let (revealed_state, revealed) = reveal_next_pending_node(&routed.after_state)?;
    assert!(revealed);
    assert_eq!(
        revealed_state
            .active_run
            .as_ref()
            .ok_or("missing run")?
            .world
            .pending_nodes[1]
            .source,
        RouteRevealSourceV1::Event
    );
    let landmark = MapNodeStateV1 {
        biome: BiomeId::new(safe(3)),
        label: "observatory".to_owned(),
        kind: MapNodeKindV1::Landmark,
    };
    let (mapped, added) = chart_onward_routes(
        &revealed_state,
        &content.world,
        std::slice::from_ref(&landmark),
    )?;
    assert_eq!(added, 2);
    assert_eq!(
        mapped
            .active_run
            .as_ref()
            .ok_or("missing run")?
            .world
            .map_nodes
            .len(),
        2
    );
    let entered = record_biome_entry(&mapped, BiomeId::new(safe(2)), RouteNodeId::new(safe(2)))?;
    let entered_world = &entered.active_run.as_ref().ok_or("missing run")?.world;
    assert_eq!(entered_world.previous_biome, Some(BiomeId::new(safe(1))));
    assert_eq!(entered_world.recent_biomes, vec![BiomeId::new(safe(1))]);
    assert!(!entered_world.pending_nodes_ready);
    assert!(entered_world.pending_nodes.is_empty());
    assert_eq!(
        entered_world.biome_history,
        vec![BiomeId::new(safe(1)), BiomeId::new(safe(2))]
    );
    assert_eq!(entered_world.map_nodes, vec![landmark]);

    let mut travel_rng = ScriptedWorldRng::new(vec![1]);
    let (targeted, target, audit) =
        set_any_biome_travel_target(&entered, &content.world, &mut travel_rng)?;
    assert_eq!(target, Some(BiomeId::new(safe(3))));
    assert_eq!(audit.ok_or("missing travel audit")?.selected_ordinal, 1);
    let (consumed, consumed_target) = consume_map_travel_target(&targeted)?;
    assert_eq!(consumed_target, target);
    let weather = WeatherKind::UnsupportedOracleCode(1);
    let weather_state = set_carried_weather(&consumed, weather.clone())?;
    let (weather_state, consumed_weather) = consume_carried_weather(&weather_state)?;
    assert_eq!(consumed_weather, Some(weather));
    let (fragment_state, total) = add_treasure_fragments(&weather_state, 4)?;
    assert_eq!(total, 4);
    let (entered, rewarded) = consume_treasure_fragments_for_reward(&fragment_state)?;
    assert!(rewarded);
    assert_eq!(
        entered
            .active_run
            .as_ref()
            .ok_or("missing run")?
            .world
            .treasure_fragments,
        1
    );
    let fairy = grant_fairy_luck(&entered, 6, 12, WaveIndex::new(safe(1))?)?;
    let fairy_world = &fairy.active_run.as_ref().ok_or("missing run")?.world;
    assert_eq!(
        temporary_fairy_luck(fairy_world, WaveIndex::new(safe(1))?),
        6
    );
    assert_eq!(
        fairy_luck_waves_left(fairy_world, WaveIndex::new(safe(1))?),
        13
    );
    assert_eq!(
        temporary_fairy_luck(fairy_world, WaveIndex::new(safe(14))?),
        0
    );

    let mut length_rng = ScriptedWorldRng::new(vec![0, 18]);
    let planned = plan_biome_structure(&fairy, &content.world, &mut length_rng)?;
    assert_eq!(planned.draws.len(), 2);
    assert_eq!(
        planned
            .after_state
            .active_run
            .as_ref()
            .ok_or("missing run")?
            .world
            .biome_length,
        Some(25)
    );
    assert_eq!(map_upgrade_tier(0), 0);
    assert_eq!(map_upgrade_tier(9), 3);
    assert_eq!(visible_route_node_count(4, 1, 1)?, 7);
    let mut overstay = planned.after_state;
    overstay.active_run.as_mut().ok_or("missing run")?.wave = WaveIndex::new(safe(10))?;
    overstay.validate()?;
    let mode = content
        .world
        .mode(GameModeId::new(safe(1)))
        .ok_or("missing mode")?;
    assert_eq!(final_wave(mode), Some(200));
    assert_eq!(progression_wave(mode, 0)?, 1);
    assert_eq!(
        early_wave_move_power_ratio(mode, 1),
        PacingRatioV1 {
            numerator: 2,
            denominator: 5,
        }
    );
    assert_eq!(
        early_wave_move_power_ratio(mode, 30),
        PacingRatioV1 {
            numerator: 1,
            denominator: 1,
        }
    );
    assert_eq!(starting_biome(mode, &content.world)?, BiomeId::new(safe(1)));
    assert_eq!(wave_for_difficulty(mode, 12, false)?, 12);
    assert!(is_wave_final(mode, 200));
    assert!(!is_wave_final(mode, 199));
    assert_eq!(legend_min_wave(580), 65);
    assert_eq!(legend_min_wave(600), 70);
    assert_eq!(legend_min_wave(660), 85);
    assert_eq!(legend_min_wave(680), 90);
    assert!(is_checkpoint_wave(mode, 10));
    assert!(is_chapter_start_wave(mode, 11));
    assert!(is_major_checkpoint_wave(mode, 50));
    assert_eq!(story_source_wave(mode, 48), 48);
    let run = overstay.active_run.as_ref().ok_or("missing run")?;
    assert!(should_raise_crossroads(&run.world, run.wave, mode)?);
    assert_eq!(
        biome_end_rule(&run.world, WaveIndex::new(safe(25))?, mode)?,
        Some(true)
    );
    let overstay = mark_biome_stay(&overstay, &content.world)?;
    assert_eq!(
        overstay
            .active_run
            .as_ref()
            .ok_or("missing run")?
            .world
            .overstay_anchor_wave,
        Some(WaveIndex::new(safe(10))?)
    );
    let run = overstay.active_run.as_ref().ok_or("missing run")?;
    let full_scale = NotorietyScaleV1 {
        numerator: 1,
        denominator: 1,
    };
    assert_eq!(
        notoriety_bst_bonus(&run.world, WaveIndex::new(safe(11))?, mode, full_scale,)?,
        10
    );
    assert_eq!(
        notoriety_boss_chance_pct(&run.world, WaveIndex::new(safe(11))?, mode, full_scale,)?,
        33
    );
    assert_eq!(
        notoriety_bst_bonus(&run.world, WaveIndex::new(safe(20))?, mode, full_scale,)?,
        100
    );
    assert_eq!(
        notoriety_trainer_chance_pct(&run.world, WaveIndex::new(safe(20))?, mode, full_scale,)?,
        90
    );
    let leaving = mark_leave_biome(&overstay)?;
    let run = leaving.active_run.as_ref().ok_or("missing run")?;
    assert!(biome_should_end(&run.world, run.wave)?);
    Ok(())
}

#[test]
pub fn run_program_material_save_and_control_paths_agree() -> TestResult {
    let content = prepared_content()?;
    let state = game_state(&content)?;
    let transition = execute_run_hook_v1(
        &state,
        &content,
        RunHook::RunStarted,
        RunExecutionContextV1::default(),
    )?;
    assert_eq!(transition.evidence.len(), 1);
    assert_eq!(
        transition
            .after_state
            .active_run
            .as_ref()
            .and_then(|run| run.flags.get(&RunFlagId::new(safe(1))))
            .copied(),
        Some(true)
    );

    let action = GameActionV1::ExecuteRunProgram {
        program: RunProgramId::new(safe(1)),
        hook: RunHook::RunStarted,
        context: RunExecutionContextV2::default(),
    };
    let action_material = GameActionMaterialV1::new(
        GameActionContextV1 {
            operation_id: OperationId::new("m7/run/system-proof")?,
            authority_seat: SeatId::new(safe(1)),
            authority_revision: safe(1),
            menu_instance: MenuInstanceId::new(safe(1)),
        },
        &content,
        &state,
        action,
        Vec::new(),
        Vec::new(),
        transition.after_state.clone(),
        Vec::new(),
    )?;
    let game_material =
        GameMaterialV5::from_action(GameActionMaterialKindV1::RunAction, action_material);
    let game_bytes = game_material.canonical_bytes()?;
    let mut game_host = state.clone();
    let mut game_replica = state.clone();
    assert_eq!(
        apply_game_material_v5(&mut game_host, &content, &game_bytes)?,
        MaterialApplyResultV5::Applied
    );
    assert_eq!(
        apply_game_material_v5(&mut game_replica, &content, &game_bytes)?,
        MaterialApplyResultV5::Applied
    );
    assert_eq!(game_host, transition.after_state);
    assert_eq!(game_host, game_replica);
    assert_eq!(
        apply_game_material_v5(&mut game_replica, &content, &game_bytes)?,
        MaterialApplyResultV5::Duplicate
    );

    let material_cases = vec![
        (
            GameActionMaterialKindV1::Progression,
            GameActionV1::Progression {
                action: ProgressionActionV1::AcceptTask { sequence: safe(1) },
            },
        ),
        (
            GameActionMaterialKindV1::Capture,
            GameActionV1::Capture {
                action: CaptureActionV1::Decline,
            },
        ),
        (
            GameActionMaterialKindV1::Party,
            GameActionV1::Party {
                action: PartyActionV1::Cancel,
            },
        ),
        (
            GameActionMaterialKindV1::World,
            GameActionV1::World {
                action: WorldActionV1::Stay,
            },
        ),
        (
            GameActionMaterialKindV1::Scenario,
            GameActionV1::Scenario {
                action: ScenarioGameActionV1::Advance {
                    node: ScenarioNodeId::new(safe(1)),
                },
            },
        ),
        (
            GameActionMaterialKindV1::Terminal,
            GameActionV1::Terminal {
                action: TerminalActionV1::ReturnToTitle,
            },
        ),
        (
            GameActionMaterialKindV1::BattleReplacement,
            GameActionV1::Battle {
                action: BattleUiActionV1::SelectReplacement {
                    occurrence: FaintOccurrenceId::new(safe(1)),
                    field: FieldSlot::new(BattleSide::Player, 0)?,
                    party_slot: PartyIndex::new(0)?,
                },
            },
        ),
    ];
    for (ordinal, (kind, action)) in material_cases.into_iter().enumerate() {
        let material = GameActionMaterialV1::new(
            GameActionContextV1 {
                operation_id: OperationId::new(format!("m7/material/{ordinal}"))?,
                authority_seat: SeatId::new(safe(1)),
                authority_revision: safe(1),
                menu_instance: MenuInstanceId::new(safe(1)),
            },
            &content,
            &state,
            action,
            Vec::new(),
            Vec::new(),
            transition.after_state.clone(),
            Vec::new(),
        )?;
        let bytes = GameMaterialV5::from_action(kind, material).canonical_bytes()?;
        let mut host_applied = state.clone();
        let mut replica_applied = state.clone();
        assert_eq!(
            apply_game_material_v5(&mut host_applied, &content, &bytes)?,
            MaterialApplyResultV5::Applied
        );
        assert_eq!(
            apply_game_material_v5(&mut replica_applied, &content, &bytes)?,
            MaterialApplyResultV5::Applied
        );
        assert_eq!(host_applied, replica_applied);
        assert_eq!(host_applied, transition.after_state);
    }
    let material = LifecycleMaterialV1::new(
        OperationId::new("m7/lifecycle/system-proof")?,
        SeatId::new(safe(1)),
        safe(1),
        content.identity().clone(),
        &state,
        transition.after_state.clone(),
        Vec::new(),
    )?;
    let bytes = material.canonical_bytes()?;
    let mut host = state.clone();
    let mut replica = state.clone();
    assert_eq!(
        apply_lifecycle_material_v1(&mut host, content.identity(), &material)?,
        LifecycleMaterialApplyV1::Applied
    );
    assert_eq!(
        apply_serialized_lifecycle_material_v1(&mut replica, content.identity(), &bytes)?,
        LifecycleMaterialApplyV1::Applied
    );
    assert_eq!(host, replica);
    let wasm_boundary = apply_lifecycle_boundary_native(LifecycleBoundaryRequestV1 {
        content_identity: content.identity().clone(),
        before: state.clone(),
        material_bytes: bytes.clone(),
    })
    .map_err(std::io::Error::other)?;
    assert_eq!(wasm_boundary.result, MaterialBoundaryResultV1::Applied);
    assert_eq!(wasm_boundary.after, host);

    let save = GameSaveV1::new(
        content.identity(),
        host.profile.clone(),
        host.active_run.clone(),
    )?;
    let save_bytes = save.canonical_bytes()?;
    assert_eq!(
        GameSaveV1::decode_canonical(&save_bytes, content.identity())?,
        save
    );

    let mut environment_state = state.clone();
    let program_option = MenuOptionId::new("program/1")?;
    let action = GameActionV1::ExecuteRunProgram {
        program: RunProgramId::new(safe(1)),
        hook: RunHook::RunStarted,
        context: RunExecutionContextV2::default(),
    };
    let run = environment_state
        .active_run
        .as_mut()
        .ok_or("missing active run")?;
    run.control = GameControlPlanV2 {
        schema_version: er_types::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision: safe(2),
        kind: GameControlKindV2::ModeSelect,
        owner_seat: Some(SeatId::new(safe(1))),
        action_context: Some(GameActionContextV1 {
            operation_id: OperationId::new("m7/system/run-start")?,
            authority_seat: SeatId::new(safe(1)),
            authority_revision: safe(2),
            menu_instance: MenuInstanceId::new(safe(2)),
        }),
        menu: Some(GameMenuV2::new(
            MenuInstanceId::new(safe(2)),
            SeatId::new(safe(1)),
            "m7/program-control",
            program_option.clone(),
            vec![GameMenuOptionV2::new(
                program_option,
                true,
                true,
                action,
                None,
            )?],
            Vec::new(),
            GameMenuCancelV2::Disabled,
        )?),
        actionable: true,
    };
    environment_state.validate()?;
    let mut environment = GameEnvironment::new_run(
        environment_state.clone(),
        content.clone(),
        EnvironmentKernelComponentsV1 {
            input_router: InputRouterSnapshotV2 {
                focus: InputFocus::Game,
                pressed: Vec::new(),
                suppressed_printable_keys: Vec::new(),
                held_buttons: Vec::new(),
                locks: Vec::new(),
                repeats: Vec::new(),
                disposed: false,
            },
            scheduler: KernelSchedulerSnapshotV2 {
                next_timer_id: None,
                timers: Vec::new(),
                pauses: Vec::new(),
                disposed: false,
            },
            protocol: None,
            replay_sequence: SafeU53::ZERO,
            terminal: None,
        },
    )?;
    assert!(matches!(
        environment
            .raw_input(RawInputEvent::KeyDown {
                code: PhysicalKey::Space,
                printable: true,
                browser_repeat: false,
                focus: InputFocus::Game,
            })?
            .as_slice(),
        [GameEffect::Selected { .. }]
    ));
    assert_eq!(
        environment
            .snapshot()
            .game_state
            .active_run
            .as_ref()
            .and_then(|run| run.flags.get(&RunFlagId::new(safe(1))))
            .copied(),
        Some(true)
    );
    environment = GameEnvironment::from_snapshot(environment.snapshot(), content.clone())?;
    assert!(
        environment
            .raw_input(RawInputEvent::KeyDown {
                code: PhysicalKey::Space,
                printable: true,
                browser_repeat: false,
                focus: InputFocus::Game,
            })?
            .is_empty()
    );
    environment.raw_input(RawInputEvent::KeyUp {
        code: PhysicalKey::Space,
    })?;
    let before_retry = environment.snapshot().game_state;
    assert!(
        environment
            .raw_input(RawInputEvent::KeyDown {
                code: PhysicalKey::Space,
                printable: true,
                browser_repeat: false,
                focus: InputFocus::Game,
            })
            .is_err()
    );
    assert_eq!(environment.snapshot().game_state, before_retry);

    let mut runtime = GameRuntimeV5::new(environment_state, content)?;
    assert!(matches!(
        runtime.select_control()?,
        GameControlIntentV2::Selected { .. }
    ));
    assert_eq!(
        runtime
            .state()
            .active_run
            .as_ref()
            .and_then(|run| run.flags.get(&RunFlagId::new(safe(1))))
            .copied(),
        Some(true)
    );
    Ok(())
}

#[test]
pub fn continuous_foundation_raw_key_journey_crosses_world_save_party_and_progression() -> TestResult
{
    let content = prepared_content()?;
    let mut state = game_state(&content)?;
    let mut pokemon = pokemon_state(1, Some(SeatId::new(safe(1))))?;
    pokemon.hp = 10;
    let option = MenuOptionId::new("foundation/continue")?;
    let run = state.active_run.as_mut().ok_or("missing active run")?;
    run.party.push(pokemon);
    run.control = GameControlPlanV2 {
        schema_version: er_types::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision: safe(3),
        kind: GameControlKindV2::Reward,
        owner_seat: Some(SeatId::new(safe(1))),
        action_context: Some(GameActionContextV1 {
            operation_id: OperationId::new("m7/foundation/journey")?,
            authority_seat: SeatId::new(safe(1)),
            authority_revision: safe(3),
            menu_instance: MenuInstanceId::new(safe(3)),
        }),
        menu: Some(GameMenuV2::new(
            MenuInstanceId::new(safe(3)),
            SeatId::new(safe(1)),
            "m7/foundation",
            option.clone(),
            vec![GameMenuOptionV2::new(
                option,
                true,
                true,
                GameActionV1::ExecuteRunProgram {
                    program: RunProgramId::new(safe(2)),
                    hook: RunHook::RewardSelected,
                    context: RunExecutionContextV2 {
                        pokemon: Some(PokemonId::new(safe(1))),
                        scenario_target: None,
                    },
                },
                None,
            )?],
            Vec::new(),
            GameMenuCancelV2::Disabled,
        )?),
        actionable: true,
    };
    state.validate()?;
    let mut environment = GameEnvironment::new_run(
        state,
        content,
        EnvironmentKernelComponentsV1 {
            input_router: InputRouterSnapshotV2 {
                focus: InputFocus::Game,
                pressed: Vec::new(),
                suppressed_printable_keys: Vec::new(),
                held_buttons: Vec::new(),
                locks: Vec::new(),
                repeats: Vec::new(),
                disposed: false,
            },
            scheduler: KernelSchedulerSnapshotV2 {
                next_timer_id: None,
                timers: Vec::new(),
                pauses: Vec::new(),
                disposed: false,
            },
            protocol: None,
            replay_sequence: SafeU53::ZERO,
            terminal: None,
        },
    )?;
    assert!(matches!(
        environment
            .raw_input(RawInputEvent::KeyDown {
                code: PhysicalKey::Space,
                printable: true,
                browser_repeat: false,
                focus: InputFocus::Game,
            })?
            .as_slice(),
        [GameEffect::Selected { .. }]
    ));
    let snapshot = environment.snapshot();
    assert_eq!(snapshot.replay_sequence, safe(1));
    assert_eq!(
        snapshot
            .game_state
            .profile
            .flags
            .get(&ProfileFlagId::new(safe(1))),
        Some(&true)
    );
    let run = snapshot
        .game_state
        .active_run
        .as_ref()
        .ok_or("missing run")?;
    assert_eq!(run.world.biome, BiomeId::new(safe(2)));
    assert!(run.party.is_empty());
    assert_eq!(run.storage.len(), 1);
    assert_eq!(run.storage[0].pokemon.level, 6);
    assert_eq!(run.storage[0].pokemon.hp, 15);
    assert_eq!(run.inventory.entries[0].count, 2);
    assert_eq!(run.flags.get(&RunFlagId::new(safe(2))), Some(&true));
    Ok(())
}

#[test]
fn raw_key_mode_select_reaches_shared_terminal() -> TestResult {
    let content = prepared_content()?;
    let mut state = game_state(&content)?;
    let option = MenuOptionId::new("mode/classic")?;
    let run = state.active_run.as_mut().ok_or("missing active run")?;
    run.control = GameControlPlanV2 {
        schema_version: er_types::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision: safe(4),
        kind: GameControlKindV2::ModeSelect,
        owner_seat: Some(SeatId::new(safe(1))),
        action_context: Some(GameActionContextV1 {
            operation_id: OperationId::new("m7/title/classic")?,
            authority_seat: SeatId::new(safe(1)),
            authority_revision: safe(4),
            menu_instance: MenuInstanceId::new(safe(4)),
        }),
        menu: Some(GameMenuV2::new(
            MenuInstanceId::new(safe(4)),
            SeatId::new(safe(1)),
            "m7/title",
            option.clone(),
            vec![GameMenuOptionV2::new(
                option,
                true,
                true,
                GameActionV1::ExecuteRunProgram {
                    program: RunProgramId::new(safe(3)),
                    hook: RunHook::ProfileLoaded,
                    context: RunExecutionContextV2::default(),
                },
                None,
            )?],
            Vec::new(),
            GameMenuCancelV2::Disabled,
        )?),
        actionable: true,
    };
    state.validate()?;
    let mut environment = GameEnvironment::new_run(
        state,
        content,
        EnvironmentKernelComponentsV1 {
            input_router: InputRouterSnapshotV2 {
                focus: InputFocus::Game,
                pressed: Vec::new(),
                suppressed_printable_keys: Vec::new(),
                held_buttons: Vec::new(),
                locks: Vec::new(),
                repeats: Vec::new(),
                disposed: false,
            },
            scheduler: KernelSchedulerSnapshotV2 {
                next_timer_id: None,
                timers: Vec::new(),
                pauses: Vec::new(),
                disposed: false,
            },
            protocol: None,
            replay_sequence: SafeU53::ZERO,
            terminal: None,
        },
    )?;
    environment.raw_input(RawInputEvent::KeyDown {
        code: PhysicalKey::Space,
        printable: true,
        browser_repeat: false,
        focus: InputFocus::Game,
    })?;
    environment.raw_input(RawInputEvent::KeyUp {
        code: PhysicalKey::Space,
    })?;
    let observation = environment.observe()?;
    assert!(observation.terminal);
    assert_eq!(observation.control, Some(GameControlKindV2::Complete));
    let snapshot = environment.snapshot();
    assert_eq!(
        snapshot
            .game_state
            .active_run
            .as_ref()
            .map(|run| run.outcome),
        Some(RunOutcome::Victory)
    );
    assert!(snapshot.pressed_keys.is_empty());
    assert!(snapshot.scheduler.timers.is_empty());
    assert!(snapshot.pending_presentations.is_empty());
    assert!(snapshot.protocol.is_none());
    Ok(())
}

#[test]
pub fn two_hundred_wave_run_is_deterministic_to_terminal() -> TestResult {
    let content = prepared_content()?;
    let initial = game_state(&content)?;
    let mut first = initial.clone();
    let mut second = initial;
    for _ in 0..200 {
        first = advance_wave(&first, &content.world)?;
        second = advance_wave(&second, &content.world)?;
        assert_eq!(first, second);
    }
    let run = first.active_run.as_ref().ok_or("missing run")?;
    assert_eq!(run.outcome, RunOutcome::Victory);
    assert_eq!(run.control.kind, er_types::GameControlKindV2::Complete);
    Ok(())
}

#[test]
pub fn randomized_campaign_profiles_replay_deterministically() -> TestResult {
    let content = prepared_content()?;
    for seed in 0_u64..128 {
        let mut first = game_state(&content)?;
        let mut second = first.clone();
        let run_seed = format!("m7-randomized-{seed}");
        for state in [&mut first, &mut second] {
            let run = state.active_run.as_mut().ok_or("missing run")?;
            run.seed = run_seed.clone();
            run.run_rng = RngRuntime::from_run_seed(&run_seed).run_state();
        }
        for _ in 0..20 {
            first = advance_wave(&first, &content.world)?;
            second = advance_wave(&second, &content.world)?;
            assert_eq!(first, second);
        }
    }
    Ok(())
}
