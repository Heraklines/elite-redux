//! Focused M4 runtime benchmarks for the implemented physical-input and
//! two-endpoint material paths. Hosted orchestration measures process RSS and
//! validates the remaining manifest workloads separately.

use std::error::Error;
use std::time::Instant;

use er_game::battle_start_v2::start_battle_v2;
use er_game::run_runtime::project_terminal_or_wait_control;
use er_kernel::{GameKernel, KernelInput};
use er_run::biome::{RouteOption, plan_er_biome_structure, select_route};
use er_run::content::EncounterPlanSource;
use er_run::encounter_plan::{ENCOUNTER_PLAN_SCHEMA_VERSION, EncounterPlan};
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
use er_types::battle_command::ScriptedEnemyPolicyV1;
use er_types::battle_ids::{BattleFormat, ContentPackHash, MenuInstanceId, PokemonId};
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
const ENCOUNTER_FIXTURE: &str =
    include_str!("../../../fixtures/m4/oracle/encounters/plains-wave-11-captured-v1.json");

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

fn benchmark_encounter(state: &GameStateV2) -> Result<EncounterPlan> {
    let fixture: serde_json::Value = serde_json::from_str(ENCOUNTER_FIXTURE)?;
    let enemy_value = fixture["final"]["canonical"]["save_data"]["enemyParty"]
        .as_array()
        .and_then(|party| party.first())
        .ok_or("captured enemy missing")?;
    let enemy_id = PokemonId::new(safe(enemy_value["id"].as_u64().ok_or("captured enemy ID")?));
    let mut enemy = er_testkit::m4_fixture::convert_pokemon(enemy_value, enemy_id, None)?;
    enemy.hp = 1;
    enemy.max_hp = 1;
    enemy.stats.hp = 1;
    let wave = er_types::battle_ids::WaveIndex::new(safe(state.run.wave.get().get() + 1))?;
    let enemy_slot =
        er_types::battle_ids::FieldSlot::new(er_types::battle_ids::BattleSide::Enemy, 0)?;
    let player_slot =
        er_types::battle_ids::FieldSlot::new(er_types::battle_ids::BattleSide::Player, 0)?;
    let mut commands = Vec::new();
    for index in 0..1_u64 {
        let turn = er_types::battle_ids::TurnIndex::new(safe(index + 1))?;
        let cursor = safe(index);
        commands.push(er_types::battle_command::ScriptedEnemyBattleCommandV1::new(
            er_types::battle_command::scripted_enemy_command_operation_id(
                state.run.next_battle_id,
                wave,
                turn,
                enemy_slot,
                cursor,
            )?,
            state.run.next_battle_id,
            wave,
            turn,
            cursor,
            enemy_id,
            enemy_slot,
            er_types::battle_command::BattleCommand::fight(
                enemy_id,
                er_types::battle_ids::MoveSlotIndex::new(1)?,
                er_types::battle_command::BattleTargetSelection::selected(vec![player_slot])?,
            )?,
        )?);
    }
    Ok(EncounterPlan {
        schema_version: ENCOUNTER_PLAN_SCHEMA_VERSION,
        encounter_id: er_types::run_ids::EncounterId::new(safe(1)),
        run_id: state.run.run_id,
        wave,
        biome: BiomeId::new(safe(1)),
        format: BattleFormat::single(),
        enemy_party: vec![enemy],
        enemy_leads: vec![enemy_id],
        player_leads: vec![state.player_party[0].id],
        scripted_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, commands)?,
        battle_seed: "m4-benchmark-encounter".to_owned(),
        generation_audit: Vec::new(),
        source: EncounterPlanSource::OracleCaptureRequired,
        content_hash: Some(state.run_content_hash.clone()),
    })
}

fn raw_kernel() -> Result<(GameKernel, SeatId)> {
    let (mut state, _, _) = fixture_state()?;
    state.run.wave = er_types::battle_ids::WaveIndex::new(safe(1))?;
    for move_slot in state.player_party[0].moves.iter_mut().flatten() {
        move_slot.max_pp_override = Some(10_000);
    }
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
            KeyBinding {
                key: PhysicalKey::Space,
                button: GameButton::Submit,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: safe(250),
        repeat_interval_ms: safe(250),
    };
    let encounter = benchmark_encounter(&state)?;
    let kernel = GameKernel::new_run_with_control_and_encounter(
        state,
        selected_m4_game_content_bundle()?,
        input_map,
        plan,
        encounter,
    )
    .map_err(std::io::Error::other)?;
    Ok((kernel, owner))
}

fn benchmark_press(
    kernel: &mut GameKernel,
    owner: SeatId,
    key: PhysicalKey,
) -> Result<Vec<er_types::KernelEffect>> {
    let mut effects = Vec::new();
    for event in [
        RawInputEvent::KeyDown {
            code: key.clone(),
            printable: matches!(key, PhysicalKey::Space),
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::KeyUp { code: key },
    ] {
        effects.extend(kernel.step(KernelInput::RawInput { seat: owner, event })?);
    }
    Ok(effects)
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

#[test]
fn m4_wave_transitions_10000() -> Result {
    let fixture: serde_json::Value = serde_json::from_str(FIXTURE)?;
    let encounter_fixture: serde_json::Value = serde_json::from_str(ENCOUNTER_FIXTURE)?;
    let (mut state, content) = assemble_selected_game_state(&fixture, ORACLE)?;
    state.run.wave = er_types::battle_ids::WaveIndex::new(safe(11))?;
    state.run.biome.biome = BiomeId::new(safe(1));
    state.run.biome.source_wave = state.run.wave;
    let enemy_value = encounter_fixture["final"]["canonical"]["save_data"]["enemyParty"]
        .as_array()
        .and_then(|party| party.first())
        .ok_or("captured enemy missing")?;
    let enemy_id = PokemonId::new(safe(enemy_value["id"].as_u64().ok_or("captured enemy ID")?));
    let enemy = er_testkit::m4_fixture::convert_pokemon(enemy_value, enemy_id, None)?;
    let plan = EncounterPlan {
        schema_version: ENCOUNTER_PLAN_SCHEMA_VERSION,
        encounter_id: er_types::run_ids::EncounterId::new(safe(1)),
        run_id: state.run.run_id,
        wave: state.run.wave,
        biome: state.run.biome.biome,
        format: BattleFormat::single(),
        enemy_party: vec![enemy],
        enemy_leads: vec![enemy_id],
        player_leads: vec![state.player_party[0].id],
        scripted_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, Vec::new())?,
        battle_seed: encounter_fixture["final"]["canonical"]["runtime"]["battle_seed"]
            .as_str()
            .ok_or("captured battle seed")?
            .to_owned(),
        generation_audit: Vec::new(),
        source: EncounterPlanSource::OracleCaptureRequired,
        content_hash: Some(state.run_content_hash.clone()),
    };
    let started = Instant::now();
    let mut checksum = 0_u64;
    for _ in 0..10_000 {
        let after = start_battle_v2(&state, &plan, SeatId::new(safe(1)), content.as_ref())?;
        checksum = checksum.wrapping_add(
            after
                .battle
                .as_ref()
                .ok_or("started battle missing")?
                .battle_id
                .get()
                .get(),
        );
    }
    std::hint::black_box(checksum);
    println!(
        "{}",
        json!({
            "id": "wave-transitions-10000",
            "transitions": 10000,
            "execution_ms": started.elapsed().as_millis(),
            "checksum": checksum
        })
    );
    Ok(())
}

fn run_complete_batch(count: usize) -> std::result::Result<(u64, u64), String> {
    let execute = || -> Result<(u64, u64)> {
        let mut checksum = 0_u64;
        let mut raw_events = 0_u64;
        for _run in 0..count {
            let (mut kernel, owner) = raw_kernel()?;
            for key in [
                PhysicalKey::ArrowDown,
                PhysicalKey::Space,
                PhysicalKey::Space,
            ] {
                let _ = benchmark_press(&mut kernel, owner, key)?;
                raw_events += 2;
            }
            for _step in 0..2_000 {
                let state = kernel.run_state().ok_or("benchmark run state missing")?;
                if state.run.stage == RunStage::Complete {
                    break;
                }
                if state.run.stage != RunStage::Battle {
                    return Err(
                        format!("unexpected benchmark run stage {:?}", state.run.stage).into(),
                    );
                }
                let mut effects = Vec::new();
                effects.extend(benchmark_press(&mut kernel, owner, PhysicalKey::Enter)?);
                effects.extend(benchmark_press(&mut kernel, owner, PhysicalKey::Enter)?);
                raw_events += 4;
                let presentations = effects
                    .iter()
                    .filter_map(|effect| match effect {
                        er_types::KernelEffect::PresentBattle { event, .. } => Some(event.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>();
                for event in presentations {
                    let _ = kernel.step(KernelInput::BattlePresentationOutcome {
                        endpoint: owner,
                        event_id: event.event_id,
                        outcome: er_types::battle_ui::PresentationSettlementOutcome::Settled,
                    })?;
                }
            }
            let final_state = kernel.run_state().ok_or("final run state missing")?;
            if final_state.run.stage != RunStage::Complete
                || final_state.run.wave.get().get() != 200
            {
                return Err("200-wave run did not complete".into());
            }
            checksum = checksum.wrapping_add(final_state.run.wave.get().get());
            let _ = kernel.dispose("200-wave benchmark complete");
            if kernel.live_resources() != er_types::LiveResourceSnapshot::default() {
                return Err("200-wave run leaked resources".into());
            }
        }
        Ok((checksum, raw_events))
    };
    execute().map_err(|error| error.to_string())
}

#[test]
fn m4_complete_runs_200_waves_100() -> Result {
    let started = Instant::now();
    let results = std::thread::scope(|scope| {
        (0..4)
            .map(|_| scope.spawn(|| run_complete_batch(25)))
            .collect::<Vec<_>>()
            .into_iter()
            .map(|worker| {
                worker
                    .join()
                    .map_err(|_| "200-wave benchmark worker panicked".to_owned())?
            })
            .collect::<std::result::Result<Vec<_>, String>>()
    })?;
    let checksum = results.iter().map(|result| result.0).sum::<u64>();
    let raw_events = results.iter().map(|result| result.1).sum::<u64>();
    std::hint::black_box(checksum);
    println!(
        "{}",
        json!({
            "id": "complete-runs-200-waves-100",
            "runs": 100,
            "workers": 4,
            "waves_each": 200,
            "events": raw_events,
            "execution_ms": started.elapsed().as_millis(),
            "checksum": checksum
        })
    );
    Ok(())
}
