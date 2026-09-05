use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameActionV1, GameControlKindV2, SafeU53, SeatId};
use er_wasm::m9e_parity::{
    M9E_PARITY_REPORT_SCHEMA_VERSION_V1, M9EParityEventV2, M9EParityObservationV1,
    M9EParityReportV1, M9EParityRequestV1, replay_m9e_eventwise_native,
};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn profile() -> ProfileStateV1 {
    ProfileStateV1 {
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
            highest_wave: WaveIndex::new(safe(1)).expect("wave is valid"),
        },
        dex: DexState::default(),
    }
}

fn scheduler() -> KernelSchedulerSnapshotV2 {
    KernelSchedulerSnapshotV2 {
        next_timer_id: Some(SafeU53::ZERO),
        timers: Vec::new(),
        pauses: Vec::new(),
        disposed: false,
    }
}

fn key_down(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

fn apply_raw(
    kernel: &mut GameKernelV7,
    events: &mut Vec<M9EParityEventV2>,
    event: RawInputEvent,
) -> Result<(), Box<dyn Error>> {
    kernel.raw_input(event.clone())?;
    events.push(M9EParityEventV2::RawInput { event });
    Ok(())
}

fn settle_presentations(
    kernel: &mut GameKernelV7,
    events: &mut Vec<M9EParityEventV2>,
) -> Result<(), Box<dyn Error>> {
    let pending = kernel.snapshot()?.pending_presentations;
    for pending in pending {
        kernel.settle_presentation(pending.event_id)?;
        events.push(M9EParityEventV2::PresentationSettled {
            event_id: pending.event_id,
        });
    }
    Ok(())
}

fn press(
    kernel: &mut GameKernelV7,
    events: &mut Vec<M9EParityEventV2>,
    code: PhysicalKey,
) -> Result<(), Box<dyn Error>> {
    apply_raw(kernel, events, key_down(code.clone()))?;
    apply_raw(kernel, events, RawInputEvent::KeyUp { code })?;
    settle_presentations(kernel, events)
}

fn navigate_down_to(
    kernel: &mut GameKernelV7,
    events: &mut Vec<M9EParityEventV2>,
    option: &str,
) -> Result<(), Box<dyn Error>> {
    let bound = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map(|menu| menu.options.len() + 1)
        .ok_or("menu missing")?;
    for _ in 0..bound {
        if kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == option)
        {
            return Ok(());
        }
        press(kernel, events, PhysicalKey::ArrowDown)?;
    }
    Err(format!("option {option} is unreachable").into())
}

fn strongest_move_option(
    kernel: &GameKernelV7,
    content: &PreparedGameContentV2,
) -> Result<String, Box<dyn Error>> {
    let menu = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .ok_or("move menu missing")?;
    let state = kernel.state().ok_or("state missing")?;
    let run = state.active_run.as_ref().ok_or("run missing")?;
    let actor = run
        .party
        .iter()
        .find(|pokemon| {
            run.battle.as_ref().is_some_and(|battle| {
                battle.field.slots.iter().any(|slot| {
                    slot.slot.side == er_types::battle_ids::BattleSide::Player
                        && slot.occupant == Some(pokemon.id)
                })
            })
        })
        .ok_or("player actor missing")?;
    menu.options
        .iter()
        .filter_map(|option| {
            let GameActionV1::Battle {
                action: er_types::BattleUiActionV1::SelectMove { move_slot, .. },
            } = option.action
            else {
                return None;
            };
            let move_id = actor.moves[usize::from(move_slot.get())]?.move_id;
            let definition = content.battle.move_definition(move_id).ok()?;
            let power = match definition.power {
                er_types::battle_model::MovePower::None => 0,
                er_types::battle_model::MovePower::Value(power) => power,
            };
            Some((power, option.option_id.as_str().to_owned()))
        })
        .max_by_key(|(power, _)| *power)
        .map(|(_, option)| option)
        .ok_or_else(|| "strong move missing".into())
}

fn request() -> Result<M9EParityRequestV1, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?);
    let seat = SeatId::new(safe(1));
    let mut bootstrap = GameKernelV7::natural_start(
        profile(),
        "m9e-native-wasm-longitudinal".to_owned(),
        seat,
        vec!["m9e-parity-slot".to_owned()],
        true,
        content.clone(),
        scheduler(),
        None,
    )?;
    let mut ignored = Vec::new();
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    navigate_down_to(&mut bootstrap, &mut ignored, "bootstrap/starter/confirm")?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;

    let mut snapshot = bootstrap.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut snapshot.lifecycle else {
        return Err("bootstrap snapshot is not active".into());
    };
    let run = state.active_run.as_mut().ok_or("run missing")?;
    let player = run.party.first_mut().ok_or("player missing")?;
    player.stats.hp = 10_000;
    player.stats.attack = 10_000;
    player.stats.defense = 10_000;
    player.stats.special_attack = 10_000;
    player.stats.special_defense = 10_000;
    player.stats.speed = 10_000;
    player.hp = 10_000;
    player.max_hp = 10_000;
    player.permanent_bonuses.hp = 9_000;
    player.permanent_bonuses.attack = 9_000;
    player.permanent_bonuses.defense = 9_000;
    player.permanent_bonuses.special_attack = 9_000;
    player.permanent_bonuses.special_defense = 9_000;
    player.permanent_bonuses.speed = 9_000;
    if let Some(enemy) = run
        .battle
        .as_mut()
        .and_then(|battle| battle.enemy_party.first_mut())
    {
        enemy.hp = 1;
        enemy.fainted = false;
    }
    // Boosting is an explicit controlled fixture boundary. The original
    // bootstrap material digest describes the unmodified state and cannot be
    // retained as evidence for this fixture's canonical state.
    let mut driver = GameKernelV7::from_active(
        state.clone(),
        snapshot.material_ledger.next_authority_revision,
        seat,
        GameKernelRoleV7::Authority,
        content.clone(),
        snapshot.input_router,
        snapshot.scheduler,
        snapshot.protocol,
    )?;
    let initial_snapshot = driver.snapshot()?;
    let mut events = Vec::new();
    for _ in 0..300 {
        let wave = driver
            .state()
            .and_then(|state| state.active_run.as_ref())
            .map(|run| run.wave.get().get())
            .ok_or("wave missing")?;
        if wave >= 3
            && driver.current_control().map(|control| control.kind)
                == Some(GameControlKindV2::BattleCommand)
        {
            break;
        }
        match driver
            .current_control()
            .map(|control| control.kind)
            .ok_or("control missing")?
        {
            GameControlKindV2::BattleCommand => {
                press(&mut driver, &mut events, PhysicalKey::Space)?;
            }
            GameControlKindV2::BattleMove => {
                let option = strongest_move_option(&driver, &content)?;
                navigate_down_to(&mut driver, &mut events, &option)?;
                press(&mut driver, &mut events, PhysicalKey::Space)?;
            }
            GameControlKindV2::Progression
            | GameControlKindV2::MoveLearn
            | GameControlKindV2::Evolution
            | GameControlKindV2::Reward => {
                press(&mut driver, &mut events, PhysicalKey::Space)?;
            }
            other => return Err(format!("longitudinal trace stalled at {other:?}").into()),
        }
    }
    assert!(
        driver
            .state()
            .and_then(|state| state.active_run.as_ref())
            .is_some_and(|run| run.wave.get().get() >= 3)
    );
    assert_eq!(
        initial_snapshot.scheduler.next_timer_id,
        Some(SafeU53::ZERO)
    );
    let navigation_presses = events
        .iter()
        .filter(|event| {
            matches!(
                event,
                M9EParityEventV2::RawInput {
                    event: RawInputEvent::KeyDown {
                        code: PhysicalKey::ArrowDown,
                        ..
                    }
                }
            )
        })
        .count();
    let final_snapshot = driver.snapshot()?;
    assert!(final_snapshot.input_router.repeats.is_empty());
    assert!(final_snapshot.scheduler.timers.is_empty());
    assert_eq!(
        final_snapshot.scheduler.next_timer_id,
        Some(safe(navigation_presses as u64))
    );
    Ok(M9EParityRequestV1 {
        bundle,
        profile: profile(),
        seed: "unused-with-snapshot".to_owned(),
        local_seat: seat,
        role: GameKernelRoleV7::Authority,
        save_slots: Vec::new(),
        local_is_host: true,
        initial_snapshot: Some(initial_snapshot),
        events,
    })
}

fn assert_eventwise_parity_contract() -> Result<(), Box<dyn Error>> {
    let request = request()?;
    let event_count = request.events.len();
    let report = replay_m9e_eventwise_native(request)?;
    assert_eq!(report.observations.len(), event_count);
    assert!(
        report
            .observations
            .iter()
            .any(|item| { item.control_kind == Some(GameControlKindV2::Progression) })
    );
    assert!(
        report
            .observations
            .iter()
            .any(|item| item.control_kind == Some(GameControlKindV2::Reward))
    );
    assert!(
        report
            .observations
            .last()
            .and_then(|item| item.wave)
            .is_some_and(|wave| wave.get().get() >= 3)
    );
    for (index, observation) in report.observations.iter().enumerate() {
        assert_eq!(observation.sequence.get(), (index + 1) as u64);
        assert!(!observation.input_digest.is_empty());
        assert!(!observation.effect_digest.is_empty());
        assert!(!observation.internal_event_digest.is_empty());
        assert!(!observation.mechanical_state_digest.is_empty());
        assert!(!observation.kernel_determinism_digest.is_empty());
    }
    let report_digest = er_canonical::content_digest(&report)?;
    // B1 makes fresh allocation explicit (Some(0), formerly exhausted None)
    // and records held navigation registrations until key release. Full kernel
    // snapshot digests include those allocator and repeat ownership changes.
    // The controlled fixture now starts with fresh ledger/replay bookkeeping,
    // and private navigation retains its exact canonical/return controls. Both
    // change snapshot evidence; canonical material also uses the retained root.
    // Updated from native runner 33959674311; Wasm must match independently.
    assert_eq!(
        report_digest,
        "4d5ef01099d9942c0dec32227366a3faf018a77aa5c5b6a1d60e84b3e75bf0c5"
    );
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn native_replays_v7_raw_inputs_eventwise() -> Result<(), Box<dyn Error>> {
    assert_eventwise_parity_contract()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm_replays_v7_raw_inputs_eventwise() -> Result<(), wasm_bindgen::JsValue> {
    assert_eventwise_parity_contract()
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
}

fn timer_request() -> Result<(M9EParityRequestV1, Arc<PreparedGameContentV2>), Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?);
    let seat = SeatId::new(safe(1));
    let mut kernel = GameKernelV7::natural_start(
        profile(),
        "m9e-native-wasm-held-timer".to_owned(),
        seat,
        vec!["m9e-parity-slot".to_owned()],
        true,
        content.clone(),
        scheduler(),
        None,
    )?;
    let mut setup = Vec::new();
    for _ in 0..3 {
        press(&mut kernel, &mut setup, PhysicalKey::Space)?;
    }
    navigate_down_to(&mut kernel, &mut setup, "bootstrap/starter/confirm")?;
    for _ in 0..4 {
        press(&mut kernel, &mut setup, PhysicalKey::Space)?;
    }
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::BattleCommand)
    );
    assert_eq!(timer_cursor(&kernel)?, "battle/command/fight");
    let snapshot = kernel.snapshot()?;
    assert!(snapshot.input_router.repeats.is_empty());
    assert!(snapshot.scheduler.timers.is_empty());
    let events = vec![
        M9EParityEventV2::RawInput {
            event: key_down(PhysicalKey::ArrowDown),
        },
        M9EParityEventV2::AdvanceTime {
            milliseconds: safe(249),
        },
        M9EParityEventV2::AdvanceTime {
            milliseconds: safe(1),
        },
        M9EParityEventV2::AdvanceTime {
            milliseconds: safe(250),
        },
        M9EParityEventV2::RawInput {
            event: RawInputEvent::KeyUp {
                code: PhysicalKey::ArrowDown,
            },
        },
        M9EParityEventV2::AdvanceTime {
            milliseconds: safe(500),
        },
    ];
    Ok((
        M9EParityRequestV1 {
            bundle,
            profile: profile(),
            seed: "unused-with-natural-checkpoint".to_owned(),
            local_seat: seat,
            role: GameKernelRoleV7::Authority,
            save_slots: vec!["m9e-parity-slot".to_owned()],
            local_is_host: true,
            initial_snapshot: Some(snapshot),
            events,
        },
        content,
    ))
}

fn timer_cursor(kernel: &GameKernelV7) -> Result<&str, Box<dyn Error>> {
    kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map(|menu| menu.selected_option_id.as_str())
        .ok_or_else(|| "timer menu missing".into())
}

fn apply_timer_event(
    kernel: &mut GameKernelV7,
    event: M9EParityEventV2,
) -> Result<GameKernelStepV7, Box<dyn Error>> {
    Ok(match event {
        M9EParityEventV2::RawInput { event } => kernel.raw_input(event)?,
        M9EParityEventV2::AdvanceTime { milliseconds } => kernel.advance_time(milliseconds)?,
        M9EParityEventV2::PresentationSettled { event_id } => {
            kernel.settle_presentation(event_id)?;
            GameKernelStepV7::default()
        }
    })
}

fn assert_timer_eventwise_parity_contract(
    replay: impl Fn(M9EParityRequestV1) -> Result<M9EParityReportV1, Box<dyn Error>>,
) -> Result<String, Box<dyn Error>> {
    let (request, content) = timer_request()?;
    let mut driver = GameKernelV7::from_snapshot(
        request
            .initial_snapshot
            .clone()
            .ok_or("natural checkpoint missing")?,
        request.local_seat,
        request.role,
        content.clone(),
    )?;
    let expected_cursors = [
        "battle/command/party",
        "battle/command/party",
        "battle/command/fight",
        "battle/command/party",
        "battle/command/party",
        "battle/command/party",
    ];
    let mut observations = Vec::new();
    let mut midpoint = None;
    let mut restored: Option<GameKernelV7> = None;
    for (index, event) in request.events.iter().enumerate() {
        let step = apply_timer_event(&mut driver, event.clone())?;
        let snapshot = driver.snapshot()?;
        assert_eq!(timer_cursor(&driver)?, expected_cursors[index]);
        match index {
            0 | 2 | 3 => {
                let [GameKernelEffectV7::UiChanged(control)] = step.effects.as_slice() else {
                    return Err(format!(
                        "timer event {index} did not emit exactly one cursor effect"
                    )
                    .into());
                };
                assert_eq!(
                    control
                        .menu
                        .as_ref()
                        .ok_or("effect menu missing")?
                        .selected_option_id
                        .as_str(),
                    expected_cursors[index]
                );
            }
            _ => assert!(step.effects.is_empty()),
        }
        if index == 2 || index == 3 {
            assert_eq!(
                step.internal_events,
                [er_game::m9e_internal_event_v2::GameInternalEventKindV2::TimerFired]
            );
        } else {
            assert!(step.internal_events.is_empty());
        }
        if let Some(restored) = restored.as_mut() {
            assert_eq!(apply_timer_event(restored, event.clone())?, step);
            assert_eq!(restored.snapshot()?, snapshot);
        }
        if index == 1 {
            assert_eq!(snapshot.scheduler.timers[0].remaining_active_ms, safe(1));
            midpoint = Some(snapshot.clone());
            restored = Some(GameKernelV7::from_snapshot(
                snapshot.clone(),
                request.local_seat,
                request.role,
                content.clone(),
            )?);
        }
        if index >= 4 {
            assert!(snapshot.input_router.repeats.is_empty());
            assert!(snapshot.scheduler.timers.is_empty());
        }
        observations.push(M9EParityObservationV1 {
            sequence: safe((index + 1) as u64),
            input_digest: er_canonical::content_digest(event)?,
            effect_digest: er_canonical::content_digest(&step.effects)?,
            internal_event_digest: er_canonical::content_digest(&step.internal_events)?,
            mechanical_state_digest: er_canonical::content_digest(&driver.state())?,
            kernel_determinism_digest: er_canonical::content_digest(&snapshot)?,
            control_kind: driver.current_control().map(|control| control.kind),
            wave: driver
                .state()
                .and_then(|state| state.active_run.as_ref())
                .map(|run| run.wave),
        });
    }
    let expected = M9EParityReportV1 {
        schema_version: M9E_PARITY_REPORT_SCHEMA_VERSION_V1,
        content_identity_digest: er_canonical::content_digest(content.identity())?,
        observations,
        final_snapshot_digest: er_canonical::content_digest(&driver.snapshot()?)?,
    };
    let mut resumed_request = request.clone();
    resumed_request.initial_snapshot = Some(midpoint.ok_or("midpoint missing")?);
    resumed_request.events = request.events[2..].to_vec();
    let actual = replay(request)?;
    assert_eq!(actual, expected);
    let resumed = replay(resumed_request)?;
    let mut expected_resumed = expected.clone();
    expected_resumed.observations = expected.observations[2..].to_vec();
    for (index, observation) in expected_resumed.observations.iter_mut().enumerate() {
        observation.sequence = safe((index + 1) as u64);
    }
    assert_eq!(resumed, expected_resumed);
    // The remote gate compares this same full-record report digest across
    // native and Wasm, separately from each target's behavioral assertions.
    Ok(er_canonical::content_digest(&actual)?)
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
#[allow(clippy::print_stdout)]
fn native_replays_v7_held_timers_eventwise() -> Result<(), Box<dyn Error>> {
    let digest = assert_timer_eventwise_parity_contract(|request| {
        replay_m9e_eventwise_native(request).map_err(Into::into)
    })?;
    println!("M9E_TIMER_PARITY_DIGEST={digest}");
    Ok(())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm_replays_v7_held_timers_eventwise() -> Result<(), wasm_bindgen::JsValue> {
    let result = assert_timer_eventwise_parity_contract(|request| {
        let json = serde_json::to_string(&request)?;
        let report = er_wasm::m9e_parity::replay_m9e_eventwise_json(&json).map_err(|error| {
            error
                .as_string()
                .unwrap_or_else(|| "Wasm replay failed".to_owned())
        })?;
        Ok(serde_json::from_str(&report)?)
    });
    let digest = result.map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
    wasm_bindgen_test::console_log!("M9E_TIMER_PARITY_DIGEST={digest}");
    Ok(())
}
