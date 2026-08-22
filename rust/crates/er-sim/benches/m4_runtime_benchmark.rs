//! Focused M4 runtime benchmarks for the implemented physical-input and
//! two-endpoint material paths. Hosted orchestration measures process RSS and
//! validates the remaining manifest workloads separately.

use std::error::Error;
use std::time::Instant;

use er_game::run_runtime::project_terminal_or_wait_control;
use er_kernel::{GameKernel, KernelInput};
use er_run::biome::{RouteOption, plan_er_biome_structure, select_route};
use er_run::modifier::{ModifierApplication, apply_modifier};
use er_run::reward::{MarketStockView, RewardOfferView, buy_stock, pay_for_offer};
use er_run::run_material::{
    AuthorityRunMaterial, RUN_MATERIAL_M3_PARITY_ORACLE_SHA, RUN_TERMINAL_MATERIAL_VERSION,
    RunMaterialHeader, RunTerminalMaterialV1, encode_run_material,
};
use er_run::transition::RunMutation;
use er_sim::M4RunPair;
use er_state::digest_v2::MechanicalStateDigestV2;
use er_state::game_v2::GameStateV2;
use er_state::run_v2::{
    CrossroadsSurfaceState, RUN_SURFACE_STATE_SCHEMA_VERSION, RunSurfaceState, SurfaceHeader,
};
use er_testkit::m4_fixture::{assemble_selected_game_state, selected_m4_game_content_bundle};
use er_types::battle_ids::{ContentPackHash, MenuInstanceId};
use er_types::input::{GameButton, InputFocus, InputMap, KeyBinding, PhysicalKey, RawInputEvent};
use er_types::run_control::{
    CrossroadsControl, GameControl, GameControlPlan, PresentationBarrier, SeatControlPlan,
    SurfaceControl,
};
use er_types::run_ids::{
    BiomeId, ModifierId, Money, RouteNodeId, RunContentPackHash, RunInteractionSequence,
    RunOfferId, RunStockId, RunSurfaceId, SurfaceDigest,
};
use er_types::run_model::{ModifierTier, RunOutcome, RunStage, RunSurfaceKind};
use er_types::ui::CancelPolicy;
use er_types::ui_menu::{LogicalMenu, LogicalMenuOption, MenuNavigationEdge, NavigationDirection};
use er_types::{OperationId, SafeU53, SeatId};
use serde_json::json;

const FIXTURE: &str =
    include_str!("../../../fixtures/m4/oracle/progression/nacli-medium-slow-level-17-v1.json");
const ORACLE: &str = "45c89493e7edec9c4da247a98cd7858b1f015c09";
const RAW_EVENT_COUNT: u64 = 100_000;
const PAIR_TRANSITION_COUNT: u64 = 1_000;

type Result<T = ()> = std::result::Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("benchmark values are safe")
}

fn fixture_state() -> Result<(GameStateV2, ContentPackHash, RunContentPackHash)> {
    let fixture: serde_json::Value = serde_json::from_str(FIXTURE)?;
    let (state, _) = assemble_selected_game_state(&fixture, ORACLE)?;
    Ok((
        state.clone(),
        state.battle_content_hash,
        state.run_content_hash,
    ))
}

fn raw_kernel() -> Result<(GameKernel, SeatId)> {
    let (mut state, _, _) = fixture_state()?;
    let owner = SeatId::new(safe(1));
    let surface_id = RunSurfaceId::new(safe(1));
    let interaction = RunInteractionSequence::new(SafeU53::ZERO);
    let menu_instance = MenuInstanceId::new(safe(1));
    let stay = er_types::MenuOptionId::new("crossroads/stay")?;
    let leave = er_types::MenuOptionId::new("crossroads/leave")?;
    let menu = LogicalMenu::new(
        menu_instance,
        owner,
        "run/benchmark/crossroads",
        stay.clone(),
        vec![
            LogicalMenuOption::new(stay.clone(), true, None)?,
            LogicalMenuOption::new(leave.clone(), true, None)?,
        ],
        vec![
            MenuNavigationEdge::new(stay.clone(), NavigationDirection::Down, leave.clone()),
            MenuNavigationEdge::new(leave, NavigationDirection::Up, stay),
        ],
        CancelPolicy::Disabled,
    )?;
    state.run.stage = RunStage::Surface;
    state.run.outcome = RunOutcome::InProgress;
    state.run.active_surface = Some(RunSurfaceState::Crossroads(CrossroadsSurfaceState {
        header: SurfaceHeader {
            schema_version: RUN_SURFACE_STATE_SCHEMA_VERSION,
            surface_id,
            kind: RunSurfaceKind::Crossroads,
            owner_seat: owner,
            interaction_sequence: interaction,
            action_ordinal: 0,
            operation_id: OperationId::new("1:1:CROSSROADS_PICK:9600001")?,
            menu: menu.clone(),
            surface_digest: SurfaceDigest::new(format!("blake3-v1:{}", "0".repeat(64)))?,
        },
        source_wave: state.run.wave,
    }));
    state.validate().map_err(|error| error.to_string())?;
    let control = SurfaceControl::Crossroads(CrossroadsControl::new(
        surface_id,
        interaction,
        menu.clone(),
    ));
    let plan = GameControlPlan::new(
        vec![SeatControlPlan {
            seat: owner,
            owner: true,
            control_id: menu.control_id.clone(),
            menu_instance_id: menu_instance,
            actionable_after: PresentationBarrier::NonBlocking,
            control: GameControl::Surface(control),
        }],
        "run/benchmark/next".to_owned(),
        MenuInstanceId::new(safe(2)),
    )?;
    let input_map = InputMap {
        keyboard: vec![
            KeyBinding {
                key: PhysicalKey::ArrowDown,
                button: GameButton::Down,
            },
            KeyBinding {
                key: PhysicalKey::ArrowUp,
                button: GameButton::Up,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: safe(250),
        repeat_interval_ms: safe(250),
    };
    let kernel = GameKernel::new_run_with_control(
        state,
        selected_m4_game_content_bundle()?,
        input_map,
        plan,
    )
    .map_err(std::io::Error::other)?;
    Ok((kernel, owner))
}

fn transition_material(
    before: &GameStateV2,
    money_after: u64,
    index: u64,
) -> Result<(Vec<u8>, GameStateV2)> {
    let mut after = before.clone();
    let money_before = after.run.money;
    after.run.money = Money::new(safe(money_after));
    let before_digest = MechanicalStateDigestV2::compute(before)?;
    let after_digest = MechanicalStateDigestV2::compute(&after)?;
    let next_control = project_terminal_or_wait_control(
        &after,
        format!("run/benchmark/complete/{index}"),
        SeatId::new(safe(1)),
        MenuInstanceId::new(safe(index + 1)),
    )?;
    let material = AuthorityRunMaterial::Terminal(RunTerminalMaterialV1 {
        schema_version: RUN_TERMINAL_MATERIAL_VERSION,
        header: RunMaterialHeader {
            m4_oracle_sha: ORACLE.to_owned(),
            m3_parity_oracle_sha: RUN_MATERIAL_M3_PARITY_ORACLE_SHA.to_owned(),
            battle_content_hash: before.battle_content_hash.clone(),
            run_content_hash: before.run_content_hash.clone(),
            operation_id: OperationId::new(format!("1:1:REWARD:{}", 9_000_000 + index))?,
            run_id: before.run.run_id,
            wave: before.run.wave,
            before_digest,
            after_digest,
            before_state: before.clone(),
            after_state: after.clone(),
            next_control,
        },
        outcome: after.run.outcome,
        mutations: vec![RunMutation::MoneyChanged {
            before: money_before,
            after: after.run.money,
        }],
        presentation: Vec::new(),
    });
    Ok((encode_run_material(&material)?, after))
}

#[test]
fn m4_run_surface_raw_key_events_100000() -> Result {
    let (mut kernel, owner) = raw_kernel()?;
    let started = Instant::now();
    for index in 0..RAW_EVENT_COUNT {
        let key = if (index / 2) % 2 == 0 {
            PhysicalKey::ArrowDown
        } else {
            PhysicalKey::ArrowUp
        };
        let event = if index % 2 == 0 {
            RawInputEvent::KeyDown {
                code: key,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            }
        } else {
            RawInputEvent::KeyUp { code: key }
        };
        kernel.step(KernelInput::RawInput { seat: owner, event })?;
    }
    let elapsed_ms = started.elapsed().as_millis();
    assert!(kernel.take_run_actions().is_empty());
    kernel.dispose("benchmark complete");
    assert_eq!(
        kernel.live_resources(),
        er_types::LiveResourceSnapshot::default()
    );
    println!(
        "{}",
        json!({
            "id": "run-surface-raw-key-events-100000",
            "events": RAW_EVENT_COUNT,
            "execution_ms": elapsed_ms
        })
    );
    Ok(())
}

#[test]
fn m4_two_client_transitions_1000() -> Result {
    let (initial, _, _) = fixture_state()?;
    let content = selected_m4_game_content_bundle()?;
    let host =
        GameKernel::new_run(initial.clone(), content.clone()).map_err(std::io::Error::other)?;
    let guest = GameKernel::new_run(initial.clone(), content).map_err(std::io::Error::other)?;
    let mut pair = M4RunPair::new(host, guest);
    let mut state = initial;
    let started = Instant::now();
    for index in 1..=PAIR_TRANSITION_COUNT {
        let (bytes, after) = transition_material(&state, 1_000_000 + index, index)?;
        pair.commit_authority(bytes, SafeU53::ZERO)?;
        assert_eq!(pair.deliver_due()?, 1);
        state = after;
    }
    let elapsed_ms = started.elapsed().as_millis();
    assert_eq!(pair.frontiers()?.0, pair.frontiers()?.1);
    let (host, guest) = pair.teardown("benchmark complete");
    assert_eq!(host, er_types::LiveResourceSnapshot::default());
    assert_eq!(guest, er_types::LiveResourceSnapshot::default());
    println!(
        "{}",
        json!({
            "id": "two-client-wave-transitions-1000",
            "transitions": PAIR_TRANSITION_COUNT,
            "execution_ms": elapsed_ms
        })
    );
    Ok(())
}

#[test]
fn m4_reward_market_cycles_1000() -> Result {
    let content = selected_m4_game_content_bundle()?;
    let modifier = content.run.modifiers[1]
        .as_ref()
        .ok_or("persistent modifier 1 missing")?;
    let offer = RewardOfferView {
        offer_id: RunOfferId::new(safe(1)),
        modifier_id: ModifierId::new(safe(1)),
        tier: ModifierTier::Common,
        price: Money::ZERO,
        sold: false,
    };
    let stock = MarketStockView {
        stock_id: RunStockId::new(safe(1)),
        modifier_id: ModifierId::new(safe(1)),
        price: Money::new(safe(50)),
        initial_quantity: 1,
        remaining_quantity: 1,
        sold: false,
    };
    let started = Instant::now();
    let mut checksum = 0_u64;
    for _ in 0..1_000 {
        let balance = pay_for_offer(
            Money::new(safe(1_000)),
            std::slice::from_ref(&offer),
            offer.offer_id,
            None,
        )
        .map_err(|error| format!("reward payment failed: {error:?}"))?;
        assert_eq!(
            apply_modifier(modifier, None, None, 0)
                .map_err(|error| format!("modifier application failed: {error:?}"))?,
            ModifierApplication::Persistent
        );
        let (balance, purchased) = buy_stock(
            balance,
            std::slice::from_ref(&stock),
            stock.stock_id,
            stock.price,
        )
        .map_err(|error| format!("market purchase failed: {error:?}"))?;
        checksum = checksum.wrapping_add(balance.get().get());
        checksum = checksum.wrapping_add(u64::from(purchased.remaining_quantity));
    }
    std::hint::black_box(checksum);
    println!(
        "{}",
        json!({
            "id": "reward-market-cycles-1000",
            "transitions": 1000,
            "execution_ms": started.elapsed().as_millis(),
            "checksum": checksum
        })
    );
    Ok(())
}

#[test]
fn m4_biome_transitions_1000() -> Result {
    let route = RouteOption {
        route_node_id: RouteNodeId::new(safe(1)),
        biome: BiomeId::new(safe(1)),
    };
    let current = BiomeId::new(SafeU53::ZERO);
    let started = Instant::now();
    let mut checksum = 0_u64;
    for index in 0..1_000_u64 {
        let wave = er_types::battle_ids::WaveIndex::new(safe(1 + index % 100))?;
        let plan = plan_er_biome_structure(wave, &format!("m4-bench-{index}"))
            .map_err(|error| format!("biome plan failed: {error:?}"))?;
        let selected = select_route(
            std::slice::from_ref(&route),
            current,
            route.route_node_id,
            route.biome,
        )
        .map_err(|error| format!("route selection failed: {error:?}"))?;
        checksum = checksum.wrapping_add(u64::from(plan.length.unwrap_or(0)));
        checksum = checksum.wrapping_add(selected.biome.get().get());
    }
    std::hint::black_box(checksum);
    println!(
        "{}",
        json!({
            "id": "biome-transitions-1000",
            "transitions": 1000,
            "execution_ms": started.elapsed().as_millis(),
            "checksum": checksum
        })
    );
    Ok(())
}
