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
    RUN_CONTENT_PACK_SCHEMA_VERSION_V3, RunContentPackV3,
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
    InventoryStateV1, POKEMON_STATE_SCHEMA_VERSION_V5, PROFILE_STATE_SCHEMA_VERSION_V1,
    PokemonStateV5, ProfileStateV1, ProfileStatistics, ProgressionQueueV2, QuestStateV1,
    RUN_STATE_SCHEMA_VERSION_V3, RunStateV3, WORLD_STATE_SCHEMA_VERSION_V1, WorldStateV1,
};
use er_state::mechanic_state_v2::MechanicStateStoreV2;
use er_state::pokemon_v2::{Iv, PermanentStatBonuses};
use er_types::battle_command::CommandCollectionState;
use er_types::battle_ids::{
    AbilityId, BattleFormat, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, GameModeId,
    MenuInstanceId, MoveId, PokemonId, SpeciesId, WaveIndex,
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
    AiPolicyId, BattleContentPackHashV3, CatalogHash, GameBehaviorStatus, GameBehaviorUnitId,
    GameContentBundleHash, InputFocus, InventoryItemId, OperationId, OracleSha, PhysicalKey,
    RawInputEvent, RunCondition, RunConditionId, RunFlagId, RunHook, RunHookBinding, RunOperation,
    RunProgramBudget, RunProgramId, RunProgramV1, SafeU53, ScenarioId, ScenarioNodeId, SeatId,
};
use er_wasm::m7_parity::{
    LifecycleBoundaryRequestV1, MaterialBoundaryResultV1, apply_lifecycle_boundary_native,
};
use er_world::runtime::advance_wave;
use er_world::{
    BiomeDefinitionV1, EncounterDefinitionV1, EncounterKindV1, GameModeDefinitionV1,
    PokemonBuildV1, RouteDefinitionV1, WORLD_CONTENT_PACK_SCHEMA_VERSION_V1, WeightedEncounterV1,
    WeightedRouteV1, WorldContentPackV1,
};

const ORACLE: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe fixture integer")
}

fn catalog(fill: char) -> CatalogHash {
    CatalogHash::parse(fill.to_string().repeat(64)).expect("catalog hash")
}

fn behavior() -> GameBehaviorUnitId {
    GameBehaviorUnitId::parse("a".repeat(64)).expect("behavior ID")
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
            route: RouteNodeId::new(safe(1)),
            allows_coop: true,
        }],
        biomes: vec![BiomeDefinitionV1 {
            id: BiomeId::new(safe(1)),
            key: "plains".to_owned(),
            encounters: vec![WeightedEncounterV1 {
                encounter: EncounterId::new(safe(1)),
                weight: 1,
            }],
            exits: vec![WeightedRouteV1 {
                route: RouteNodeId::new(safe(1)),
                weight: 1,
            }],
        }],
        routes: vec![RouteDefinitionV1 {
            id: RouteNodeId::new(safe(1)),
            biome: BiomeId::new(safe(1)),
            next: Vec::new(),
            minimum_wave: 1,
            maximum_wave: Some(200),
        }],
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
    let run = Arc::new(RunContentPackV3 {
        schema_version: RUN_CONTENT_PACK_SCHEMA_VERSION_V3,
        oracle_sha: OracleSha::parse(ORACLE)?,
        battle_content_hash: battle.content_hash.clone(),
        content_hash: catalog('7'),
        programs: vec![run_program()],
    });
    let meta = Arc::new(MetaContentPackV1 {
        schema_version: META_CONTENT_PACK_SCHEMA_VERSION_V1,
        oracle_sha: OracleSha::parse(ORACLE)?,
        content_hash: catalog('8'),
        classifications: vec![GameBehaviorClassificationV1 {
            behavior: behavior(),
            status: GameBehaviorStatus::Compiled,
        }],
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
        &["poke-ball".to_owned()],
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
fn run_program_material_save_and_control_paths_agree() -> TestResult {
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

    let mut environment = GameEnvironment::new_run(
        state.clone(),
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
    assert_eq!(
        environment.raw_input(RawInputEvent::KeyDown {
            code: PhysicalKey::ArrowDown,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        })?,
        vec![GameEffect::Navigated]
    );
    environment = GameEnvironment::from_snapshot(environment.snapshot(), content.clone())?;
    assert!(
        environment
            .raw_input(RawInputEvent::KeyDown {
                code: PhysicalKey::ArrowDown,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            })?
            .is_empty()
    );
    environment.raw_input(RawInputEvent::KeyUp {
        code: PhysicalKey::ArrowDown,
    })?;
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

    let mut runtime = GameRuntimeV5::new(state, content)?;
    runtime.navigate_control(er_types::ui_menu::NavigationDirection::Down)?;
    assert!(matches!(
        runtime.submit_control()?,
        GameControlIntentV2::Selected { .. }
    ));
    Ok(())
}

#[test]
fn two_hundred_wave_run_is_deterministic_to_terminal() -> TestResult {
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
