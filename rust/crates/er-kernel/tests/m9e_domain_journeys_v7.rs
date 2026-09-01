use std::error::Error;
use std::sync::Arc;

use er_game::m7_progression_control::{capture_control, generic_vertical_control_v2};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::GameMaterialV6;
use er_game::m9e_new_run_v6::construct_natural_run_v6;
use er_game::m72_bootstrap::{
    BootstrapCatalogV1, BootstrapModePolicyV1, RunBootstrapMachineV1, RunBootstrapStageV1,
};
use er_kernel::game_kernel_v7::{GameKernelEffectV7, GameKernelRoleV7, GameKernelV7};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use er_rng::audit::RngReason;
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::{
    DexState, InventoryEntryV1, M7StateError, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1,
    ProfileStatistics, ProgressionTaskKindV2, ProgressionTaskV2,
    SCENARIO_RUNTIME_SCHEMA_VERSION_V2, ScenarioLocalValueV2, ScenarioRuntimeStageV2,
    ScenarioRuntimeStateV2,
};
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::run_ids::Experience;
use er_types::{
    EvolutionActionV1, FusionActionV1, GAME_CONTROL_PLAN_SCHEMA_VERSION_V2, GameActionV1,
    GameControlKindV2, GameControlPlanV2, GameMenuCancelV2, InventoryActionV1, OperationId,
    ProgressionActionV1, RewardActionV1, RunDifficultyV1, RunOutcome, SafeU53,
    ScenarioGameActionV1, ScenarioId, SeatId, StarterSelectionV1, WorldActionV1,
};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn content() -> Result<Arc<PreparedGameContentV2>, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?))
}

fn profile() -> Result<ProfileStateV1, Box<dyn Error>> {
    Ok(ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: Default::default(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(safe(1))?,
        },
        dex: DexState::default(),
    })
}

fn natural_state(content: &PreparedGameContentV2) -> Result<GameStateV6, Box<dyn Error>> {
    let owner = SeatId::new(safe(1));
    let starter = &content.bundle().bootstrap.starters[0];
    let selection = StarterSelectionV1 {
        pokemon_id: er_types::battle_ids::PokemonId::new(safe(1)),
        species_id: starter.species_id.get(),
        form_index: starter.form_index,
        ability_index: starter.ability_index,
        cost: starter.cost,
        owner_seat: owner,
    };
    let catalog = BootstrapCatalogV1 {
        modes: content
            .bundle()
            .bootstrap
            .modes
            .iter()
            .map(|mode| BootstrapModePolicyV1 {
                mode: mode.mode,
                challenge_selection: mode.challenge_selection,
                cooperative: mode.cooperative,
                supported: mode.supported,
            })
            .collect(),
        challenges: Vec::new(),
        starters: vec![selection.clone()],
        save_slots: vec!["journey-slot".to_owned()],
        automatic_coop_save_slot: None,
        maximum_starter_cost: content.bundle().bootstrap.maximum_starter_cost,
        maximum_starters: content.bundle().bootstrap.maximum_starters,
        local_is_host: true,
        developer_mode: false,
    };
    let mut bootstrap =
        RunBootstrapMachineV1::new(profile()?, "m9e-domain-journeys".to_owned(), owner, catalog)?;
    bootstrap.stage = RunBootstrapStageV1::Complete;
    bootstrap.selections.mode = Some(content.bundle().bootstrap.modes[0].mode);
    bootstrap.selections.starters = vec![selection];
    bootstrap.selections.difficulty = Some(RunDifficultyV1::Youngster);
    bootstrap.selections.save_slot = Some("journey-slot".to_owned());
    bootstrap.validate()?;
    Ok(construct_natural_run_v6(&bootstrap, content, safe(1))?)
}

fn input() -> InputRouterSnapshotV2 {
    InputRouterSnapshotV2 {
        focus: InputFocus::Game,
        pressed: Vec::new(),
        suppressed_printable_keys: Vec::new(),
        held_buttons: Vec::new(),
        locks: Vec::new(),
        repeats: Vec::new(),
        disposed: false,
    }
}

fn scheduler() -> KernelSchedulerSnapshotV2 {
    KernelSchedulerSnapshotV2 {
        next_timer_id: None,
        timers: Vec::new(),
        pauses: Vec::new(),
        disposed: false,
    }
}

fn execute(
    mut state: GameStateV6,
    content: Arc<PreparedGameContentV2>,
    kind: GameControlKindV2,
    operation: &str,
    action: GameActionV1,
) -> Result<(GameKernelV7, Vec<GameKernelEffectV7>), Box<dyn Error>> {
    let control = generic_vertical_control_v2(
        MenuInstanceId::new(safe(1)),
        safe(1),
        SeatId::new(safe(1)),
        OperationId::new(operation)?,
        kind,
        operation,
        &[(format!("{operation}/option"), action)],
        GameMenuCancelV2::Disabled,
    )?;
    state.active_run.as_mut().ok_or("run missing")?.control = control;
    let mut kernel = GameKernelV7::from_active(
        state,
        safe(1),
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content,
        input(),
        scheduler(),
        None,
    )?;
    let step = kernel.raw_input(RawInputEvent::KeyDown {
        code: PhysicalKey::Space,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    })?;
    kernel.raw_input(RawInputEvent::KeyUp {
        code: PhysicalKey::Space,
    })?;
    Ok((kernel, step.effects))
}

#[test]
fn capture_success_with_full_party_uses_allocator_backed_storage() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut state = natural_state(&content)?;
    let run = state.active_run.as_mut().ok_or("run missing")?;
    let template = run.party[0].clone();
    for _ in 0..5 {
        let mut pokemon = template.clone();
        pokemon.id = state.identities.allocate_pokemon_id()?;
        run.party.push(pokemon);
    }
    let ball = content
        .progression
        .pack()
        .capture_balls
        .iter()
        .find(|ball| ball.guaranteed)
        .ok_or("capture ball missing")?;
    let ball_item = ball.item;
    let ball_key = ball.registry_key.clone();
    run.inventory.entries.push(InventoryEntryV1 {
        item: ball_item,
        registry_key: ball_key.clone(),
        count: 1,
    });
    let target = run
        .battle
        .as_ref()
        .and_then(|battle| battle.enemy_party.first())
        .map(|pokemon| pokemon.id)
        .ok_or("capture target missing")?;
    let control = capture_control(
        MenuInstanceId::new(safe(1)),
        safe(1),
        SeatId::new(safe(1)),
        OperationId::new("capture/journey/1")?,
        target,
        &[(ball_item, ball_key)],
    )?;
    run.control = control;
    let mut kernel = GameKernelV7::from_active(
        state,
        safe(1),
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content,
        input(),
        scheduler(),
        None,
    )?;
    let step = kernel.raw_input(RawInputEvent::KeyDown {
        code: PhysicalKey::Space,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    })?;
    let run = kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("run missing after capture")?;
    assert_eq!(run.party.len(), 6);
    assert_eq!(run.storage.len(), 1);
    assert!(
        run.inventory
            .entries
            .iter()
            .all(|entry| entry.item != ball_item)
    );
    assert!(
        step.effects
            .iter()
            .any(|effect| matches!(effect, GameKernelEffectV7::AuthorityMaterial { .. }))
    );
    Ok(())
}

#[test]
fn raw_capture_uses_audited_rng() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut state = natural_state(&content)?;
    let run = state.active_run.as_mut().ok_or("run missing")?;
    let before_rng = run.run_rng.clone();
    let ball = content
        .progression
        .pack()
        .capture_balls
        .iter()
        .find(|ball| !ball.guaranteed)
        .ok_or("non-guaranteed capture ball missing")?;
    run.inventory.entries.push(InventoryEntryV1 {
        item: ball.item,
        registry_key: ball.registry_key.clone(),
        count: 1,
    });
    let target = run
        .battle
        .as_ref()
        .and_then(|battle| battle.enemy_party.first())
        .map(|pokemon| pokemon.id)
        .ok_or("capture target missing")?;
    run.control = capture_control(
        MenuInstanceId::new(safe(1)),
        safe(1),
        SeatId::new(safe(1)),
        OperationId::new("capture/audited/1")?,
        target,
        &[(ball.item, ball.registry_key.clone())],
    )?;
    let mut kernel = GameKernelV7::from_active(
        state,
        safe(1),
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content,
        input(),
        scheduler(),
        None,
    )?;
    let step = kernel.raw_input(RawInputEvent::KeyDown {
        code: PhysicalKey::Space,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    })?;
    let bytes = step
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes),
            _ => None,
        })
        .ok_or("capture material missing")?;
    let material = GameMaterialV6::decode(bytes)?;
    let draws = &material.transition().rng_audit;
    assert_eq!(draws.len(), 1);
    assert_eq!(draws[0].reason, RngReason::RandomSelector);
    assert!(draws[0].consumed);
    assert_ne!(draws[0].before_state, draws[0].after_state);
    let after_rng = &kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("run missing after capture")?
        .run_rng;
    assert_ne!(after_rng, &before_rng);
    Ok(())
}

#[test]
fn raw_reward_resolves_the_committed_content_offer() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let expected = content
        .progression
        .pack()
        .capture_balls
        .first()
        .ok_or("reward content missing")?
        .clone();
    let mut state = natural_state(&content)?;
    let run = state.active_run.as_mut().ok_or("run missing")?;
    let battle = run.battle.as_mut().ok_or("battle missing")?;
    battle.outcome = er_types::battle_model::BattleOutcome::Victory;
    for enemy in &mut battle.enemy_party {
        enemy.hp = 0;
        enemy.fainted = true;
    }
    let (kernel, effects) = execute(
        state,
        content,
        GameControlKindV2::Reward,
        "reward/committed/1",
        GameActionV1::Reward {
            action: RewardActionV1::Select { option_ordinal: 0 },
        },
    )?;
    let run = kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("run missing after reward")?;
    assert!(run.inventory.entries.iter().any(|entry| {
        entry.item == expected.item
            && entry.registry_key == expected.registry_key
            && entry.count == 1
    }));
    assert_eq!(run.wave.get().get(), 2);
    assert_eq!(run.control.kind, GameControlKindV2::BattleCommand);
    let material = effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes),
            _ => None,
        })
        .ok_or("reward material missing")?;
    assert!(
        !GameMaterialV6::decode(material)?
            .transition()
            .rng_audit
            .is_empty()
    );
    Ok(())
}

#[test]
fn raw_inventory_use_resolves_content_and_target() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut state = natural_state(&content)?;
    let run = state.active_run.as_mut().ok_or("run missing")?;
    let target = run.party[0].id;
    let before_hp = run.party[0].max_hp.saturating_sub(30).max(1);
    run.party[0].hp = before_hp;
    let potion = er_types::InventoryItemId::new(safe(100));
    run.inventory.entries.push(InventoryEntryV1 {
        item: potion,
        registry_key: "POTION".to_owned(),
        count: 1,
    });
    let max_hp = run.party[0].max_hp;
    let (kernel, _) = execute(
        state,
        content,
        GameControlKindV2::FullParty,
        "inventory/use/potion",
        GameActionV1::Inventory {
            action: InventoryActionV1::Use {
                item: potion,
                target: Some(target),
            },
        },
    )?;
    let pokemon = &kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("run missing after item use")?
        .party[0];
    let expected = before_hp.saturating_add(20 + max_hp / 10).min(max_hp);
    assert_eq!(pokemon.hp, expected);
    assert!(
        kernel
            .state()
            .and_then(|state| state.active_run.as_ref())
            .unwrap()
            .inventory
            .entries
            .iter()
            .all(|entry| entry.item != potion)
    );
    Ok(())
}

#[test]
fn scenario_choices_apply_source_compiled_graph_effects() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let scenario = content
        .scenarios
        .pack()
        .scenarios
        .iter()
        .find(|scenario| scenario.key == "ER_CLEANSING_FONT")
        .ok_or("cleansing font scenario missing")?;
    let choice_node = scenario
        .nodes
        .iter()
        .find_map(|entry| {
            matches!(
                entry.node,
                er_scenario::content_v2::ScenarioNodeV2::Choice { .. }
            )
            .then_some(entry.id)
        })
        .ok_or("cleansing font choice missing")?;
    let mut initial = natural_state(&content)?;
    let run = initial.active_run.as_mut().ok_or("run missing")?;
    let initial_flags = run.flags.clone();
    let pokemon = run.party.first_mut().ok_or("party missing")?;
    pokemon.hp = 1;
    let maximum_hp = pokemon.max_hp;
    run.scenario = Some(ScenarioRuntimeStateV2 {
        schema_version: SCENARIO_RUNTIME_SCHEMA_VERSION_V2,
        scenario: scenario.id,
        node: choice_node,
        stage: ScenarioRuntimeStageV2::Choice,
        selected_option: None,
        primary_target: None,
        secondary_target: None,
        locals: Default::default(),
        reserved_pokemon: Vec::new(),
        visit_count: SafeU53::ZERO,
    });
    let mut empty_local = initial.clone();
    empty_local
        .active_run
        .as_mut()
        .and_then(|run| run.scenario.as_mut())
        .ok_or("scenario missing")?
        .locals
        .insert(String::new(), ScenarioLocalValueV2::Bool(true));
    assert!(matches!(
        empty_local.active_run.as_ref().unwrap().validate(),
        Err(M7StateError::Scenario("local key is empty"))
    ));
    let mut duplicate_reserved = initial.clone();
    let duplicate = duplicate_reserved.active_run.as_ref().unwrap().party[0].clone();
    duplicate_reserved
        .active_run
        .as_mut()
        .and_then(|run| run.scenario.as_mut())
        .ok_or("scenario missing")?
        .reserved_pokemon
        .push(duplicate);
    assert!(matches!(
        duplicate_reserved.active_run.as_ref().unwrap().validate(),
        Err(M7StateError::DuplicatePokemon(_))
    ));
    let (restored_kernel, _) = execute(
        initial.clone(),
        content.clone(),
        GameControlKindV2::Scenario,
        "scenario/cleansing-font/restore",
        GameActionV1::Scenario {
            action: ScenarioGameActionV1::Choose {
                node: choice_node,
                option_ordinal: 0,
            },
        },
    )?;
    let (declined_kernel, _) = execute(
        initial,
        content,
        GameControlKindV2::Scenario,
        "scenario/cleansing-font/decline",
        GameActionV1::Scenario {
            action: ScenarioGameActionV1::Choose {
                node: choice_node,
                option_ordinal: 1,
            },
        },
    )?;
    let restored_run = restored_kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("restored run missing")?;
    let declined_run = declined_kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("declined run missing")?;
    assert_eq!(restored_run.party[0].hp, maximum_hp);
    assert_eq!(declined_run.party[0].hp, 1);
    assert_eq!(restored_run.flags, initial_flags);
    assert_eq!(declined_run.flags, initial_flags);
    assert!(restored_run.scenario.is_none());
    assert!(declined_run.scenario.is_none());
    Ok(())
}

#[test]
fn unimplemented_source_program_fails_closed() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let scenario_id = ScenarioId::try_from_u64(6)?;
    let scenario = content
        .scenarios
        .scenario(scenario_id)
        .ok_or("department store scenario missing")?;
    let choice_node = scenario
        .nodes
        .iter()
        .find_map(|entry| {
            matches!(
                entry.node,
                er_scenario::content_v2::ScenarioNodeV2::Choice { .. }
            )
            .then_some(entry.id)
        })
        .ok_or("department store choice missing")?;
    let mut initial = natural_state(&content)?;
    initial.active_run.as_mut().ok_or("run missing")?.scenario = Some(ScenarioRuntimeStateV2 {
        schema_version: SCENARIO_RUNTIME_SCHEMA_VERSION_V2,
        scenario: scenario_id,
        node: choice_node,
        stage: ScenarioRuntimeStageV2::Choice,
        selected_option: None,
        primary_target: None,
        secondary_target: None,
        locals: Default::default(),
        reserved_pokemon: Vec::new(),
        visit_count: SafeU53::ZERO,
    });
    let result = execute(
        initial,
        content,
        GameControlKindV2::Scenario,
        "scenario/department-store/unsupported",
        GameActionV1::Scenario {
            action: ScenarioGameActionV1::Choose {
                node: choice_node,
                option_ordinal: 0,
            },
        },
    );
    assert!(result.is_err());
    Ok(())
}

#[test]
fn message_in_a_bottle_applies_source_map_effects() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let scenario_id = ScenarioId::try_from_u64(61)?;
    let scenario = content
        .scenarios
        .scenario(scenario_id)
        .ok_or("message in a bottle scenario missing")?;
    let choice_node = scenario
        .nodes
        .iter()
        .find_map(|entry| {
            matches!(
                entry.node,
                er_scenario::content_v2::ScenarioNodeV2::Choice { .. }
            )
            .then_some(entry.id)
        })
        .ok_or("message in a bottle choice missing")?;
    let mut initial = natural_state(&content)?;
    let run = initial.active_run.as_mut().ok_or("run missing")?;
    let biome = run.world.biome;
    let expected_links = content
        .world
        .biome(biome)
        .ok_or("current biome missing")?
        .links
        .iter()
        .map(|link| link.biome)
        .collect::<Vec<_>>();
    run.scenario = Some(ScenarioRuntimeStateV2 {
        schema_version: SCENARIO_RUNTIME_SCHEMA_VERSION_V2,
        scenario: scenario_id,
        node: choice_node,
        stage: ScenarioRuntimeStageV2::Choice,
        selected_option: None,
        primary_target: None,
        secondary_target: None,
        locals: Default::default(),
        reserved_pokemon: Vec::new(),
        visit_count: SafeU53::ZERO,
    });
    let (kernel, _) = execute(
        initial,
        content,
        GameControlKindV2::Scenario,
        "scenario/message-in-a-bottle/open",
        GameActionV1::Scenario {
            action: ScenarioGameActionV1::Choose {
                node: choice_node,
                option_ordinal: 0,
            },
        },
    )?;
    let run = kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("run missing")?;
    assert_eq!(run.world.treasure_fragments, 1);
    assert!(
        expected_links
            .iter()
            .all(|biome| { run.world.map_nodes.iter().any(|node| node.biome == *biome) })
    );
    assert!(run.scenario.is_none());
    Ok(())
}

#[test]
fn lost_at_sea_applies_source_party_damage() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let scenario_id = ScenarioId::try_from_u64(10)?;
    let scenario = content
        .scenarios
        .scenario(scenario_id)
        .ok_or("lost at sea scenario missing")?;
    let choice_node = scenario
        .nodes
        .iter()
        .find_map(|entry| {
            matches!(
                entry.node,
                er_scenario::content_v2::ScenarioNodeV2::Choice { .. }
            )
            .then_some(entry.id)
        })
        .ok_or("lost at sea choice missing")?;
    let mut initial = natural_state(&content)?;
    let run = initial.active_run.as_mut().ok_or("run missing")?;
    let maximum_hp = run.party[0].max_hp;
    run.scenario = Some(ScenarioRuntimeStateV2 {
        schema_version: SCENARIO_RUNTIME_SCHEMA_VERSION_V2,
        scenario: scenario_id,
        node: choice_node,
        stage: ScenarioRuntimeStageV2::Choice,
        selected_option: None,
        primary_target: None,
        secondary_target: None,
        locals: Default::default(),
        reserved_pokemon: Vec::new(),
        visit_count: SafeU53::ZERO,
    });
    let (kernel, _) = execute(
        initial,
        content,
        GameControlKindV2::Scenario,
        "scenario/lost-at-sea/wander",
        GameActionV1::Scenario {
            action: ScenarioGameActionV1::Choose {
                node: choice_node,
                option_ordinal: 2,
            },
        },
    )?;
    let run = kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("run missing")?;
    assert_eq!(run.party[0].hp, maximum_hp - maximum_hp / 4);
    assert!(run.scenario.is_none());
    Ok(())
}
#[test]
fn progression_evolution_and_fusion_actions_execute_through_raw_input() -> Result<(), Box<dyn Error>>
{
    let content = content()?;
    let mut progression = natural_state(&content)?;
    let actor = progression.active_run.as_ref().ok_or("run missing")?.party[0].id;
    progression
        .active_run
        .as_mut()
        .ok_or("run missing")?
        .progression_queue
        .tasks
        .push(ProgressionTaskV2 {
            sequence: safe(1),
            pokemon: actor,
            kind: ProgressionTaskKindV2::GrantExperience(Experience::new(safe(100))),
        });
    progression
        .active_run
        .as_mut()
        .ok_or("run missing")?
        .progression_queue
        .next_sequence = safe(2);
    let before_experience =
        progression.active_run.as_ref().ok_or("run missing")?.party[0].experience;
    let (progression, _) = execute(
        progression,
        content.clone(),
        GameControlKindV2::Progression,
        "progression/journey/1",
        GameActionV1::Progression {
            action: ProgressionActionV1::AcceptTask { sequence: safe(1) },
        },
    )
    .map_err(|error| format!("progression journey failed: {error}"))?;
    assert!(
        progression
            .state()
            .unwrap()
            .active_run
            .as_ref()
            .unwrap()
            .party[0]
            .experience
            > before_experience
    );

    let mut evolution = natural_state(&content)?;
    let actor = evolution.active_run.as_ref().unwrap().party[0].id;
    let evolution_id = content
        .progression
        .pack()
        .evolutions
        .iter()
        .find(|entry| {
            entry.source_species == evolution.active_run.as_ref().unwrap().party[0].species_id
        })
        .map(|entry| entry.id)
        .ok_or("starter evolution missing")?;
    evolution.active_run.as_mut().unwrap().party[0].level = 100;
    let (evolution, _) = execute(
        evolution,
        content.clone(),
        GameControlKindV2::Evolution,
        "evolution/journey/1",
        GameActionV1::Evolution {
            action: EvolutionActionV1::Complete {
                pokemon: actor,
                evolution: evolution_id,
            },
        },
    )
    .map_err(|error| format!("evolution journey failed: {error}"))?;
    assert_eq!(
        evolution
            .state()
            .unwrap()
            .active_run
            .as_ref()
            .unwrap()
            .party[0]
            .evolution
            .last_completed,
        Some(evolution_id)
    );

    let mut fusion = natural_state(&content)?;
    let primary = fusion.active_run.as_ref().unwrap().party[0].id;
    let mut partner = fusion.active_run.as_ref().unwrap().party[0].clone();
    partner.id = fusion.identities.allocate_pokemon_id()?;
    let partner_id = partner.id;
    fusion.active_run.as_mut().unwrap().party.push(partner);
    let (fusion, _) = execute(
        fusion,
        content,
        GameControlKindV2::Fusion,
        "fusion/journey/1",
        GameActionV1::Fusion {
            action: FusionActionV1::Fuse {
                primary,
                partner: partner_id,
            },
        },
    )
    .map_err(|error| format!("fusion journey failed: {error}"))?;
    assert!(
        fusion.state().unwrap().active_run.as_ref().unwrap().party[0]
            .fusion
            .is_some()
    );
    Ok(())
}

#[test]
fn inventory_reward_world_and_scenario_actions_execute_through_raw_input()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut inventory = natural_state(&content)?;
    let item = content.progression.pack().capture_balls[0].item;
    inventory
        .active_run
        .as_mut()
        .unwrap()
        .inventory
        .entries
        .push(InventoryEntryV1 {
            item,
            registry_key: "journey-item".to_owned(),
            count: 2,
        });
    let (inventory, _) = execute(
        inventory,
        content.clone(),
        GameControlKindV2::FullParty,
        "inventory/journey/1",
        GameActionV1::Inventory {
            action: InventoryActionV1::Discard { item, count: 1 },
        },
    )?;
    assert_eq!(
        inventory
            .state()
            .unwrap()
            .active_run
            .as_ref()
            .unwrap()
            .inventory
            .entries[0]
            .count,
        1
    );

    let reward = natural_state(&content)?;
    let before = reward.active_run.as_ref().unwrap().world.encounter_sequence;
    let (reward, _) = execute(
        reward,
        content.clone(),
        GameControlKindV2::Reward,
        "reward/journey/1",
        GameActionV1::Reward {
            action: RewardActionV1::Reroll,
        },
    )?;
    assert!(
        reward
            .state()
            .unwrap()
            .active_run
            .as_ref()
            .unwrap()
            .world
            .encounter_sequence
            > before
    );

    let world = natural_state(&content)?;
    let (world, _) = execute(
        world,
        content.clone(),
        GameControlKindV2::Route,
        "world/journey/1",
        GameActionV1::World {
            action: WorldActionV1::Leave,
        },
    )?;
    assert!(
        world
            .state()
            .unwrap()
            .active_run
            .as_ref()
            .unwrap()
            .world
            .leave_biome_now
    );

    let mut scenario = natural_state(&content)?;
    let scenario_id = ScenarioId::ZERO;
    let entry = content
        .scenarios
        .scenario(scenario_id)
        .and_then(|scenario| {
            scenario.nodes.iter().find_map(|entry| {
                matches!(
                    entry.node,
                    er_scenario::content_v2::ScenarioNodeV2::Complete { .. }
                )
                .then_some(entry.id)
            })
        })
        .ok_or("scenario completion node missing")?;
    scenario.active_run.as_mut().unwrap().scenario = Some(ScenarioRuntimeStateV2 {
        schema_version: SCENARIO_RUNTIME_SCHEMA_VERSION_V2,
        scenario: scenario_id,
        node: entry,
        stage: ScenarioRuntimeStageV2::Complete,
        selected_option: None,
        primary_target: None,
        secondary_target: None,
        locals: Default::default(),
        reserved_pokemon: Vec::new(),
        visit_count: SafeU53::ZERO,
    });
    let (scenario, _) = execute(
        scenario,
        content,
        GameControlKindV2::Scenario,
        "scenario/journey/1",
        GameActionV1::Scenario {
            action: ScenarioGameActionV1::Complete { node: entry },
        },
    )?;
    assert!(
        scenario
            .state()
            .unwrap()
            .active_run
            .as_ref()
            .unwrap()
            .scenario
            .is_none()
    );
    Ok(())
}

#[test]
fn game_save_v2_restores_every_control_kind() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let kinds = [
        GameControlKindV2::Title,
        GameControlKindV2::ModeSelect,
        GameControlKindV2::StarterSelect,
        GameControlKindV2::BattleCommand,
        GameControlKindV2::BattleMove,
        GameControlKindV2::BattleTarget,
        GameControlKindV2::BattleSwitch,
        GameControlKindV2::BattleReplacement,
        GameControlKindV2::Capture,
        GameControlKindV2::FullParty,
        GameControlKindV2::Progression,
        GameControlKindV2::MoveLearn,
        GameControlKindV2::Evolution,
        GameControlKindV2::Fusion,
        GameControlKindV2::Reward,
        GameControlKindV2::Market,
        GameControlKindV2::Scenario,
        GameControlKindV2::Quest,
        GameControlKindV2::Faction,
        GameControlKindV2::Biome,
        GameControlKindV2::Route,
        GameControlKindV2::Save,
        GameControlKindV2::Waiting,
        GameControlKindV2::Complete,
    ];
    for (index, kind) in kinds.into_iter().enumerate() {
        let mut state = natural_state(&content)?;
        let revision = safe((index + 1) as u64);
        let control = if matches!(
            kind,
            GameControlKindV2::Waiting | GameControlKindV2::Complete
        ) {
            if kind == GameControlKindV2::Complete {
                state.active_run.as_mut().ok_or("run missing")?.outcome = RunOutcome::Victory;
            }
            GameControlPlanV2 {
                schema_version: GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
                revision,
                kind,
                owner_seat: None,
                action_context: None,
                menu: None,
                actionable: false,
            }
        } else {
            generic_vertical_control_v2(
                MenuInstanceId::new(revision),
                revision,
                SeatId::new(safe(1)),
                OperationId::new(format!("save/control/{index}"))?,
                kind,
                &format!("m9e/save/control/{index}"),
                &[(
                    format!("save/control/{index}/option"),
                    GameActionV1::Save {
                        action: er_types::SaveActionV1::Cancel,
                    },
                )],
                GameMenuCancelV2::Disabled,
            )?
        };
        state.active_run.as_mut().ok_or("run missing")?.control = control.clone();
        state.validate_with(content.as_ref())?;
        let save = GameSaveV2::new(content.identity().clone(), safe(1), state)?;
        let decoded = GameSaveV2::decode(&save.encode()?)?;
        assert_eq!(
            decoded.state.active_run.as_ref().map(|run| &run.control),
            Some(&control)
        );
        let restored = GameKernelV7::from_active(
            decoded.state,
            revision,
            SeatId::new(safe(1)),
            GameKernelRoleV7::Authority,
            content.clone(),
            input(),
            scheduler(),
            None,
        )?;
        assert_eq!(restored.current_control(), Some(&control));
    }
    Ok(())
}
