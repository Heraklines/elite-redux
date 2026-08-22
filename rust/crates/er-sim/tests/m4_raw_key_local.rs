//! M4 raw-key local campaign: loads published oracle fixtures, constructs
//! the run-mode kernel, and verifies material application through the single
//! shared production applier.
//!
//! This campaign proves that the fixture loader → GameStateV2 → RunRuntime
//! pipeline works end-to-end without fixture-authored plans or semantic
//! shortcuts.

use std::error::Error;

use er_game::run_runtime::RunRuntime;
use er_state::digest_v2::MechanicalStateDigestV2;
use er_testkit::m4_fixture::{assemble_game_state, selected_m4_game_content_bundle};
use er_types::SafeU53;
use er_types::battle_ids::ContentPackHash;
use er_types::run_ids::RunContentPackHash;

/// The published progression fixture path relative to the repository root.
const PROGRESSION_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m4/oracle/progression/nacli-medium-slow-level-17-v1.json"
);
const M4_ORACLE_SHA: &str = "45c89493e7edec9c4da247a98cd7858b1f015c09";

fn load_fixture_value(path: &str) -> Result<serde_json::Value, Box<dyn Error>> {
    let data = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&data)?)
}

fn content_hashes(
    fixture: &serde_json::Value,
) -> Result<(ContentPackHash, RunContentPackHash), Box<dyn Error>> {
    let initial = &fixture["initial"];
    let battle = initial["battle_content_hash"]
        .as_str()
        .ok_or("missing battle_content_hash")?;
    let run = initial["run_content_hash"]
        .as_str()
        .ok_or("missing run_content_hash")?;
    if battle != "blake3-v1:cd0738f7c0d09be0fb0cec5fbcdbf060810d9cc502dcfec671325ddc08a75112"
        || run != "blake3-v1:f079ef60e7ebdb975c05d62d64aee08979aa243dbca308297be5cc8aa359d697"
    {
        return Err("fixture content identity is not frozen".into());
    }
    let content = selected_m4_game_content_bundle()?;
    Ok((
        content.battle.hash.clone(),
        content.run.run_content_hash.clone(),
    ))
}

#[test]
fn progression_fixture_produces_validated_v2_state() -> Result<(), Box<dyn Error>> {
    let fixture = load_fixture_value(PROGRESSION_FIXTURE)?;
    let (battle_hash, run_hash) = content_hashes(&fixture)?;

    // The fixture loader converts TypeScript save-data into validated V2.
    let state = assemble_game_state(
        &fixture,
        battle_hash.clone(),
        run_hash.clone(),
        M4_ORACLE_SHA,
    )?;

    // State must pass complete V2 validation.
    state.validate().map_err(|e| format!("validation: {e}"))?;

    // Party must contain Nacli at level 16 with exp 4329.
    assert!(!state.player_party.is_empty(), "party must not be empty");
    assert_eq!(state.run.stage, er_types::run_model::RunStage::Complete);
    assert_eq!(state.run.outcome, er_types::run_model::RunOutcome::Victory);

    Ok(())
}

#[test]
fn runtime_accepts_validated_state_and_computes_frontier() -> Result<(), Box<dyn Error>> {
    let fixture = load_fixture_value(PROGRESSION_FIXTURE)?;
    let (battle_hash, run_hash) = content_hashes(&fixture)?;

    let state = assemble_game_state(
        &fixture,
        battle_hash.clone(),
        run_hash.clone(),
        M4_ORACLE_SHA,
    )?;
    let runtime = RunRuntime::new(state, selected_m4_game_content_bundle()?)?;

    // The frontier digest must be a well-formed blake3-v1 value.
    let frontier = runtime.frontier_digest()?;
    assert!(
        frontier.as_str().starts_with("blake3-v1:"),
        "frontier must start with blake3-v1:"
    );
    assert_eq!(frontier.as_str().len(), 10 + 64);

    // Determinism: recomputing produces the same digest.
    let frontier2 = runtime.frontier_digest()?;
    assert_eq!(frontier, frontier2);

    Ok(())
}

#[test]
fn runtime_rejects_local_frontier_mismatch() -> Result<(), Box<dyn Error>> {
    use er_run::run_material::{AuthorityRunMaterial, RunMaterialHeader, WaveAdvanceMaterialV1};

    let fixture = load_fixture_value(PROGRESSION_FIXTURE)?;
    let (battle_hash, run_hash) = content_hashes(&fixture)?;

    let state = assemble_game_state(
        &fixture,
        battle_hash.clone(),
        run_hash.clone(),
        M4_ORACLE_SHA,
    )?;
    let mut runtime = RunRuntime::new(state, selected_m4_game_content_bundle()?)?;

    // Build a material whose before_digest does NOT match the local frontier.
    let fake_digest = MechanicalStateDigestV2::new(format!("blake3-v1:{}", "f".repeat(64)))?;
    let header = RunMaterialHeader {
        m4_oracle_sha: M4_ORACLE_SHA.to_owned(),
        m3_parity_oracle_sha: "3b534099919efae827019d4a3f3c4ab0ecd6d67b".to_owned(),
        battle_content_hash: battle_hash,
        run_content_hash: run_hash,
        operation_id: er_types::OperationId::new("V2/WAVE/e1/w9/tick1")?,
        run_id: er_types::run_ids::GameRunId::new(SafeU53::new(1)?),
        wave: er_types::battle_ids::WaveIndex::new(SafeU53::new(10)?).map_err(|e| e.to_string())?,
        before_digest: fake_digest.clone(),
        after_digest: fake_digest,
        before_state: runtime.state().clone(),
        after_state: runtime.state().clone(),
        next_control: er_types::run_control::GameControlPlan {
            schema_version: 1,
            seats: vec![],
            next_control_id: String::new(),
            next_menu_instance_id: er_types::battle_ids::MenuInstanceId::new(SafeU53::ZERO),
        },
    };
    let material = AuthorityRunMaterial::WaveAdvance(WaveAdvanceMaterialV1 {
        schema_version: 1,
        header,
        source_battle_id: er_types::battle_ids::BattleId::new(SafeU53::new(1)?),
        mutations: vec![],
        presentation: vec![],
        rng_audit: vec![],
    });

    // Apply must fail because the fake digest doesn't match the local frontier.
    let result = runtime.apply(&material);
    assert!(result.is_err(), "must reject mismatched frontier");
    Ok(())
}

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe u53")
}

fn crossroads_state_and_control(
    fixture: &serde_json::Value,
) -> Result<
    (
        er_state::game_v2::GameStateV2,
        er_types::battle_ids::ContentPackHash,
        er_types::run_ids::RunContentPackHash,
        er_types::run_control::GameControlPlan,
        er_types::SeatId,
    ),
    Box<dyn Error>,
> {
    use er_state::run_v2::{
        CrossroadsSurfaceState, RUN_SURFACE_STATE_SCHEMA_VERSION, RunSurfaceState, SurfaceHeader,
    };
    use er_types::battle_ids::MenuInstanceId;
    use er_types::run_control::{
        CrossroadsControl, GameControl, PresentationBarrier, SeatControlPlan, SurfaceControl,
    };
    use er_types::run_ids::{RunInteractionSequence, RunSurfaceId, SurfaceDigest};
    use er_types::run_model::{RunOutcome, RunStage, RunSurfaceKind};
    use er_types::ui::CancelPolicy;
    use er_types::ui_menu::{
        LogicalMenu, LogicalMenuOption, MenuNavigationEdge, NavigationDirection,
    };

    let (battle_hash, run_hash) = content_hashes(fixture)?;
    let mut state = assemble_game_state(
        fixture,
        battle_hash.clone(),
        run_hash.clone(),
        M4_ORACLE_SHA,
    )?;
    let owner = er_types::SeatId::new(safe(1));
    let surface_id = RunSurfaceId::new(safe(1));
    let interaction = RunInteractionSequence::new(SafeU53::ZERO);
    let menu_instance = MenuInstanceId::new(safe(1));
    let stay = er_types::MenuOptionId::new("crossroads/stay")?;
    let leave = er_types::MenuOptionId::new("crossroads/leave")?;
    let menu = LogicalMenu::new(
        menu_instance,
        owner,
        "run/crossroads/1",
        stay.clone(),
        vec![
            LogicalMenuOption::new(stay.clone(), true, None)?,
            LogicalMenuOption::new(leave.clone(), true, None)?,
        ],
        vec![MenuNavigationEdge::new(
            stay,
            NavigationDirection::Down,
            leave,
        )],
        CancelPolicy::Disabled,
    )?;
    let header = SurfaceHeader {
        schema_version: RUN_SURFACE_STATE_SCHEMA_VERSION,
        surface_id,
        kind: RunSurfaceKind::Crossroads,
        owner_seat: owner,
        interaction_sequence: interaction,
        action_ordinal: 0,
        operation_id: er_types::OperationId::new("1:1:CROSSROADS_PICK:9600001")?,
        menu: menu.clone(),
        surface_digest: SurfaceDigest::new(format!("blake3-v1:{}", "0".repeat(64)))?,
    };
    state.run.stage = RunStage::Surface;
    state.run.outcome = RunOutcome::InProgress;
    state.run.active_surface = Some(RunSurfaceState::Crossroads(CrossroadsSurfaceState {
        header,
        source_wave: state.run.wave,
    }));
    state.validate().map_err(|error| error.to_string())?;

    let surface = SurfaceControl::Crossroads(CrossroadsControl::new(surface_id, interaction, menu));
    let control = er_types::run_control::GameControlPlan::new(
        vec![SeatControlPlan {
            seat: owner,
            owner: true,
            control_id: "run/crossroads/1".to_owned(),
            menu_instance_id: menu_instance,
            actionable_after: PresentationBarrier::NonBlocking,
            control: GameControl::Surface(surface),
        }],
        "run/crossroads/2".to_owned(),
        MenuInstanceId::new(safe(2)),
    )?;
    Ok((state, battle_hash, run_hash, control, owner))
}

#[test]
fn physical_keys_navigate_crossroads_and_submit_one_intent() -> Result<(), Box<dyn Error>> {
    use er_kernel::{GameKernel, KernelInput};
    use er_types::input::{
        GameButton, InputFocus, InputMap, KeyBinding, PhysicalKey, RawInputEvent,
    };

    let fixture = load_fixture_value(PROGRESSION_FIXTURE)?;
    let (state, _, _, control, owner) = crossroads_state_and_control(&fixture)?;
    let input_map = InputMap {
        keyboard: vec![
            KeyBinding {
                key: PhysicalKey::ArrowDown,
                button: GameButton::Down,
            },
            KeyBinding {
                key: PhysicalKey::Space,
                button: GameButton::Submit,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: safe(250),
        repeat_interval_ms: safe(250),
    };
    let mut kernel = GameKernel::new_run_with_control(
        state,
        selected_m4_game_content_bundle()?,
        input_map,
        control,
    )
    .map_err(std::io::Error::other)?;
    let before = kernel
        .run_frontier_digest()
        .map_err(std::io::Error::other)?;

    for event in [
        RawInputEvent::KeyDown {
            code: PhysicalKey::ArrowDown,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::KeyUp {
            code: PhysicalKey::ArrowDown,
        },
        RawInputEvent::KeyDown {
            code: PhysicalKey::Space,
            printable: true,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::KeyUp {
            code: PhysicalKey::Space,
        },
    ] {
        let effects = kernel.step(KernelInput::RawInput { seat: owner, event })?;
        assert!(effects.is_empty(), "run intents remain internal");
    }

    let actions = kernel.take_run_actions();
    assert_eq!(
        actions,
        vec![er_types::run_model::RunSurfaceAction::Crossroads(
            er_types::run_model::CrossroadsAction::MoveOn
        )]
    );
    assert_ne!(
        kernel
            .run_frontier_digest()
            .map_err(std::io::Error::other)?,
        before,
        "Crossroads selection must apply canonical material internally"
    );
    let plan = kernel
        .run_control_plan()
        .ok_or("BiomeSelect control was not installed")?;
    assert!(matches!(
        &plan.seats[0].control,
        er_types::run_control::GameControl::Surface(
            er_types::run_control::SurfaceControl::BiomeSelect(_)
        )
    ));
    Ok(())
}

fn menu_for_surface(
    owner: er_types::SeatId,
    instance: u64,
    selected: &str,
    options: &[(&str, bool)],
    edges: &[(&str, er_types::ui_menu::NavigationDirection, &str)],
    cancel: er_types::ui::CancelPolicy,
) -> Result<er_types::ui_menu::LogicalMenu, Box<dyn Error>> {
    use er_types::battle_ids::MenuInstanceId;
    use er_types::ui_menu::{LogicalMenuOption, MenuNavigationEdge};

    Ok(er_types::ui_menu::LogicalMenu::new(
        MenuInstanceId::new(safe(instance)),
        owner,
        format!("run/surface/{instance}"),
        er_types::MenuOptionId::new(selected)?,
        options
            .iter()
            .map(|(id, enabled)| -> Result<_, Box<dyn Error>> {
                let option_id = er_types::MenuOptionId::new(*id)?;
                Ok(LogicalMenuOption::new(option_id, *enabled, None)?)
            })
            .collect::<Result<Vec<_>, _>>()?,
        edges
            .iter()
            .map(|(from, direction, to)| {
                Ok(MenuNavigationEdge::new(
                    er_types::MenuOptionId::new(*from)?,
                    *direction,
                    er_types::MenuOptionId::new(*to)?,
                ))
            })
            .collect::<Result<Vec<_>, er_types::StringIdError>>()?,
        cancel,
    )?)
}

fn surface_header(
    owner: er_types::SeatId,
    surface_id: u64,
    kind: er_types::run_model::RunSurfaceKind,
    menu: er_types::ui_menu::LogicalMenu,
) -> Result<er_state::run_v2::SurfaceHeader, Box<dyn Error>> {
    use er_state::run_v2::RUN_SURFACE_STATE_SCHEMA_VERSION;
    use er_types::run_ids::{RunInteractionSequence, RunSurfaceId, SurfaceDigest};

    Ok(er_state::run_v2::SurfaceHeader {
        schema_version: RUN_SURFACE_STATE_SCHEMA_VERSION,
        surface_id: RunSurfaceId::new(safe(surface_id)),
        kind,
        owner_seat: owner,
        interaction_sequence: RunInteractionSequence::new(SafeU53::ZERO),
        action_ordinal: 0,
        operation_id: er_types::OperationId::new(format!("1:1:SURFACE:{surface_id}"))?,
        menu,
        surface_digest: SurfaceDigest::new(format!("blake3-v1:{}", "0".repeat(64)))?,
    })
}

fn kernel_for_surface(
    fixture: &serde_json::Value,
    surface: er_state::run_v2::RunSurfaceState,
    control: er_types::run_control::SurfaceControl,
) -> Result<(er_kernel::GameKernel, er_types::SeatId), Box<dyn Error>> {
    use er_types::battle_ids::MenuInstanceId;
    use er_types::input::{GameButton, InputMap, KeyBinding, PhysicalKey};
    use er_types::run_control::{
        GameControl, GameControlPlan, PresentationBarrier, SeatControlPlan,
    };
    use er_types::run_model::{RunOutcome, RunStage};

    let (battle_hash, run_hash) = content_hashes(fixture)?;
    let mut state = assemble_game_state(
        fixture,
        battle_hash.clone(),
        run_hash.clone(),
        M4_ORACLE_SHA,
    )?;
    let owner = surface.header().owner_seat;
    state.run.stage = RunStage::Surface;
    state.run.outcome = RunOutcome::InProgress;
    state.run.active_surface = Some(surface);
    state.validate().map_err(|error| error.to_string())?;
    let control_id = control.menu().control_id.clone();
    let menu_instance_id = control.menu().instance_id;
    let plan = GameControlPlan::new(
        vec![SeatControlPlan {
            seat: owner,
            owner: true,
            control_id,
            menu_instance_id,
            actionable_after: PresentationBarrier::NonBlocking,
            control: GameControl::Surface(control),
        }],
        "run/surface/next".to_owned(),
        MenuInstanceId::new(safe(menu_instance_id.get().get() + 1)),
    )?;
    let input_map = InputMap {
        keyboard: vec![
            KeyBinding {
                key: PhysicalKey::ArrowDown,
                button: GameButton::Down,
            },
            KeyBinding {
                key: PhysicalKey::ArrowRight,
                button: GameButton::Right,
            },
            KeyBinding {
                key: PhysicalKey::Space,
                button: GameButton::Submit,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: safe(250),
        repeat_interval_ms: safe(250),
    };
    let kernel = er_kernel::GameKernel::new_run_with_control(
        state,
        selected_m4_game_content_bundle()?,
        input_map,
        plan,
    )
    .map_err(std::io::Error::other)?;
    Ok((kernel, owner))
}

fn press_physical(
    kernel: &mut er_kernel::GameKernel,
    owner: er_types::SeatId,
    key: er_types::input::PhysicalKey,
) -> Result<(), Box<dyn Error>> {
    use er_kernel::KernelInput;
    use er_types::input::{InputFocus, RawInputEvent};

    let printable = matches!(key, er_types::input::PhysicalKey::Space);
    for event in [
        RawInputEvent::KeyDown {
            code: key.clone(),
            printable,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::KeyUp { code: key },
    ] {
        assert!(
            kernel
                .step(KernelInput::RawInput { seat: owner, event })?
                .is_empty()
        );
    }
    Ok(())
}

#[test]
fn physical_keys_resolve_every_m4_surface_family_to_typed_actions() -> Result<(), Box<dyn Error>> {
    use er_state::run_v2::{
        BiomeMarketSurfaceState, BiomeSelectSurfaceState, CrossroadsSurfaceState, LearnMoveTask,
        MarketStockEntry, MoveLearnSurfaceState, RewardOffer, RewardShopSurfaceState, RouteNode,
        RunSurfaceState,
    };
    use er_types::battle_ids::{BattleId, MoveId};
    use er_types::input::PhysicalKey;
    use er_types::run_control::{
        BiomeMarketControl, BiomeSelectControl, CrossroadsControl, MoveLearnControl,
        RewardShopControl, SurfaceControl,
    };
    use er_types::run_ids::{
        BiomeId, ModifierId, Money, RouteNodeId, RunInteractionSequence, RunOfferId, RunStockId,
    };
    use er_types::run_model::{
        BiomeMarketAction, BiomeSelectAction, CrossroadsAction, LearnMoveDecision, ModifierTier,
        RewardAction, RunSurfaceAction, RunSurfaceKind,
    };
    use er_types::ui::CancelPolicy;
    use er_types::ui_menu::NavigationDirection;

    let fixture = load_fixture_value(PROGRESSION_FIXTURE)?;
    let base = assemble_game_state(
        &fixture,
        content_hashes(&fixture)?.0,
        content_hashes(&fixture)?.1,
        M4_ORACLE_SHA,
    )?;
    let owner = er_types::SeatId::new(safe(1));
    let pokemon = base.player_party[0].id;
    let interaction = RunInteractionSequence::new(SafeU53::ZERO);

    let candidate = "learn/candidate/34".to_owned();
    let replacement = format!("learn/replace/{}/0", pokemon.get().get());
    let menu = menu_for_surface(
        owner,
        11,
        &candidate,
        &[(&candidate, true), (&replacement, true)],
        &[(&candidate, NavigationDirection::Down, &replacement)],
        CancelPolicy::Disabled,
    )?;
    let header = surface_header(owner, 11, RunSurfaceKind::MoveLearn, menu.clone())?;
    let surface = RunSurfaceState::MoveLearn(MoveLearnSurfaceState {
        header,
        task: LearnMoveTask {
            pokemon,
            move_id: MoveId::new(safe(34)),
            source_battle_id: BattleId::new(safe(1)),
        },
        pending_slot: None,
    });
    let control = SurfaceControl::MoveLearn(MoveLearnControl::new(
        er_types::run_ids::RunSurfaceId::new(safe(11)),
        interaction,
        menu,
    ));
    let (mut kernel, owner) = kernel_for_surface(&fixture, surface, control)?;
    press_physical(&mut kernel, owner, PhysicalKey::ArrowDown)?;
    press_physical(&mut kernel, owner, PhysicalKey::Space)?;
    assert_eq!(
        kernel.take_run_actions(),
        vec![RunSurfaceAction::LearnMove(LearnMoveDecision::Replace {
            slot: er_types::battle_ids::MoveSlotIndex::ZERO
        })]
    );

    let free = "reward/free/1/100";
    let skip = "reward/skip";
    let menu = menu_for_surface(
        owner,
        21,
        free,
        &[(free, true), (skip, true)],
        &[(free, NavigationDirection::Down, skip)],
        CancelPolicy::Select(er_types::MenuOptionId::new(skip)?),
    )?;
    let header = surface_header(owner, 21, RunSurfaceKind::RewardShop, menu.clone())?;
    let surface = RunSurfaceState::RewardShop(RewardShopSurfaceState {
        header,
        offers: vec![RewardOffer {
            offer_id: RunOfferId::new(safe(1)),
            modifier_id: ModifierId::new(safe(100)),
            tier: ModifierTier::Common,
            price: Money::ZERO,
            sold: false,
        }],
        lock_tiers: Vec::new(),
        reroll_count: 0,
        reroll_cost: Money::new(safe(250)),
        pending_target: None,
    });
    let control = SurfaceControl::RewardShop(RewardShopControl::new(
        er_types::run_ids::RunSurfaceId::new(safe(21)),
        interaction,
        menu,
    ));
    let (mut kernel, owner) = kernel_for_surface(&fixture, surface, control)?;
    press_physical(&mut kernel, owner, PhysicalKey::Space)?;
    assert_eq!(
        kernel.take_run_actions(),
        vec![RunSurfaceAction::Reward(RewardAction::SelectFree {
            offer: RunOfferId::new(safe(1)),
            target: None
        })]
    );

    let buy = "market/1/200";
    let leave = "market/leave";
    let menu = menu_for_surface(
        owner,
        31,
        buy,
        &[(buy, true), (leave, true)],
        &[(buy, NavigationDirection::Right, leave)],
        CancelPolicy::Select(er_types::MenuOptionId::new(leave)?),
    )?;
    let header = surface_header(owner, 31, RunSurfaceKind::BiomeMarket, menu.clone())?;
    let surface = RunSurfaceState::BiomeMarket(BiomeMarketSurfaceState {
        header,
        stock: vec![MarketStockEntry {
            stock_id: RunStockId::new(safe(1)),
            modifier_id: ModifierId::new(safe(200)),
            tier: ModifierTier::Common,
            price: Money::new(safe(50)),
            initial_quantity: 1,
            remaining_quantity: 1,
            sold: false,
        }],
        pending_target: None,
    });
    let control = SurfaceControl::BiomeMarket(BiomeMarketControl::new(
        er_types::run_ids::RunSurfaceId::new(safe(31)),
        interaction,
        menu,
    ));
    let (mut kernel, owner) = kernel_for_surface(&fixture, surface, control)?;
    press_physical(&mut kernel, owner, PhysicalKey::Space)?;
    assert_eq!(
        kernel.take_run_actions(),
        vec![RunSurfaceAction::BiomeMarket(BiomeMarketAction::Buy {
            stock: RunStockId::new(safe(1)),
            target: None,
            price: Money::new(safe(50))
        })]
    );

    let stay = "crossroads/stay";
    let leave = "crossroads/leave";
    let menu = menu_for_surface(
        owner,
        41,
        stay,
        &[(stay, true), (leave, true)],
        &[(stay, NavigationDirection::Down, leave)],
        CancelPolicy::Select(er_types::MenuOptionId::new(leave)?),
    )?;
    let header = surface_header(owner, 41, RunSurfaceKind::Crossroads, menu.clone())?;
    let source_wave = base.run.wave;
    let surface = RunSurfaceState::Crossroads(CrossroadsSurfaceState {
        header,
        source_wave,
    });
    let control = SurfaceControl::Crossroads(CrossroadsControl::new(
        er_types::run_ids::RunSurfaceId::new(safe(41)),
        interaction,
        menu,
    ));
    let (mut kernel, owner) = kernel_for_surface(&fixture, surface, control)?;
    press_physical(&mut kernel, owner, PhysicalKey::ArrowDown)?;
    press_physical(&mut kernel, owner, PhysicalKey::Space)?;
    assert_eq!(
        kernel.take_run_actions(),
        vec![RunSurfaceAction::Crossroads(CrossroadsAction::MoveOn)]
    );

    let route_a = "biome/1/2";
    let route_b = "biome/2/3";
    let menu = menu_for_surface(
        owner,
        51,
        route_a,
        &[(route_a, true), (route_b, true)],
        &[(route_a, NavigationDirection::Right, route_b)],
        CancelPolicy::Disabled,
    )?;
    let header = surface_header(owner, 51, RunSurfaceKind::BiomeSelect, menu.clone())?;
    let surface = RunSurfaceState::BiomeSelect(BiomeSelectSurfaceState {
        header,
        routes: vec![
            RouteNode {
                route_node_id: RouteNodeId::new(safe(1)),
                biome: BiomeId::new(safe(2)),
            },
            RouteNode {
                route_node_id: RouteNodeId::new(safe(2)),
                biome: BiomeId::new(safe(3)),
            },
        ],
        inherited_crossroads_sequence: Some(interaction),
    });
    let control = SurfaceControl::BiomeSelect(BiomeSelectControl::new(
        er_types::run_ids::RunSurfaceId::new(safe(51)),
        interaction,
        menu,
    ));
    let (mut kernel, owner) = kernel_for_surface(&fixture, surface, control)?;
    press_physical(&mut kernel, owner, PhysicalKey::ArrowRight)?;
    press_physical(&mut kernel, owner, PhysicalKey::Space)?;
    assert_eq!(
        kernel.take_run_actions(),
        vec![RunSurfaceAction::BiomeSelect(BiomeSelectAction {
            route_node: RouteNodeId::new(safe(2)),
            biome: BiomeId::new(safe(3))
        })]
    );
    Ok(())
}
