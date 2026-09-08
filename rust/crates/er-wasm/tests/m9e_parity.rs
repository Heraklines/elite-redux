use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use std::io::Write;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::{GameMaterialV6, game_state_digest};
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
#[cfg(not(target_arch = "wasm32"))]
use er_wasm::m9e_parity::replay_m9e_eventwise_native;
use er_wasm::m9e_parity::{
    M9E_PARITY_REPORT_SCHEMA_VERSION_V1, M9EParityEventV2, M9EParityObservationV1,
    M9EParityReportV1, M9EParityRequestV1,
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

const PRE_METADATA_PARITY: (&str, &str, usize, &str) = (
    "blake3-v1:9de581e0d922874eaf17b8a9c355e4d154b051b34935fad60d5779c70de68429",
    "751643168aa2c2405d700c13b6438b10dec901d969de2c6b1048663b421b2695",
    15_810_979,
    "42da262041f8b58b7c0bf95253e5560cfd1b4c2b571b46419555df6df94278f4",
);
const GENERATED_METADATA_PARITY: (&str, &str, usize, &str) = (
    "blake3-v1:dc4ab1ede5c52152e40f1dc5579d93841898126903b3047bf66b60efd7646493",
    "b167ad856885c95dab4f1e9cdf1456dd4924f6c4dbc8443e12918f232215192e",
    16_325_821,
    "c28ac3b994c687413a4d0bcae7c558f0e02dfafd5e9ec3482bbb9462f5598063",
);

fn cohort_report_golden(bundle: &str, progression: &str, bytes: usize) -> Option<&'static str> {
    [PRE_METADATA_PARITY, GENERATED_METADATA_PARITY]
        .into_iter()
        .find(|cohort| (bundle, progression, bytes) == (cohort.0, cohort.1, cohort.2))
        .map(|cohort| cohort.3)
}

fn assert_eventwise_parity_contract(
    replay: impl FnOnce(M9EParityRequestV1) -> Result<M9EParityReportV1, Box<dyn Error>>,
) -> Result<String, Box<dyn Error>> {
    let request = request()?;
    let event_count = request.events.len();
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(
        request.bundle.clone(),
    ))?);
    let golden = cohort_report_golden(
        content.identity().bundle_hash.as_str(),
        content.identity().progression_hash.as_str(),
        BUNDLE.len(),
    )
    .ok_or("parity requires an exact independently audited content cohort")?;
    for (bundle, progression, bytes) in [
        (
            PRE_METADATA_PARITY.0,
            GENERATED_METADATA_PARITY.1,
            PRE_METADATA_PARITY.2,
        ),
        (
            GENERATED_METADATA_PARITY.0,
            PRE_METADATA_PARITY.1,
            GENERATED_METADATA_PARITY.2,
        ),
        (
            GENERATED_METADATA_PARITY.0,
            GENERATED_METADATA_PARITY.1,
            PRE_METADATA_PARITY.2,
        ),
        (
            "unknown",
            GENERATED_METADATA_PARITY.1,
            GENERATED_METADATA_PARITY.2,
        ),
    ] {
        assert!(cohort_report_golden(bundle, progression, bytes).is_none());
    }
    let mut driver = GameKernelV7::from_snapshot(
        request
            .initial_snapshot
            .clone()
            .ok_or("controlled checkpoint missing")?,
        request.local_seat,
        request.role,
        content.clone(),
    )?;
    let mut expected_observations = Vec::new();
    let mut material_count = 0;
    let mut canonical_control_material_count = 0;
    for (index, event) in request.events.iter().enumerate() {
        let before_snapshot = driver.snapshot()?;
        let mut admission_before = driver.state().cloned().ok_or("active state missing")?;
        // Material admission restores the retained canonical battle control
        // before hashing its frontier (game_kernel_v7::collect_battle_action).
        // Derive only that field from the actual pre-event owner; never from
        // the returned material. The real driver and its raw report stay intact.
        if let Some(owner) = &before_snapshot.private_battle_control {
            admission_before
                .active_run
                .as_mut()
                .ok_or("canonical admission run missing")?
                .control = owner.canonical_control.clone();
        }
        let before_digest = game_state_digest(&admission_before)?;
        let step = apply_timer_event(&mut driver, event.clone())?;
        let snapshot = driver.snapshot()?;
        for effect in &step.effects {
            if let GameKernelEffectV7::AuthorityMaterial {
                operation_id,
                bytes,
            } = effect
            {
                let material = GameMaterialV6::decode(bytes)?;
                let transition = material.transition();
                assert_eq!(&transition.operation_id, operation_id);
                assert_eq!(&transition.content_identity, content.identity());
                assert_eq!(transition.before_digest, before_digest);
                assert_eq!(
                    &transition.after_state,
                    driver.state().ok_or("material after-state missing")?
                );
                let after_digest = game_state_digest(&transition.after_state)?;
                assert_eq!(transition.after_digest, after_digest);
                for mutation in &transition.mutations {
                    assert_eq!(mutation.before_digest, before_digest);
                    assert_eq!(mutation.after_digest, after_digest);
                }
                let record = snapshot
                    .material_ledger
                    .record(operation_id)
                    .ok_or("actual material receipt missing")?;
                assert_eq!(record.authority_revision, transition.authority_revision);
                assert_eq!(record.after_digest, after_digest);
                assert_eq!(
                    record.material_fingerprint,
                    format!("blake3-v1:{}", er_canonical::content_digest(bytes)?)
                );
                material_count += 1;
                if before_snapshot.private_battle_control.is_some() {
                    canonical_control_material_count += 1;
                }
            }
        }
        expected_observations.push(M9EParityObservationV1 {
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
    assert_eq!(event_count, 30);
    assert_eq!(material_count, 6);
    assert!(canonical_control_material_count > 0);
    let expected = M9EParityReportV1 {
        schema_version: M9E_PARITY_REPORT_SCHEMA_VERSION_V1,
        content_identity_digest: er_canonical::content_digest(content.identity())?,
        observations: expected_observations,
        final_snapshot_digest: er_canonical::content_digest(&driver.snapshot()?)?,
    };
    let report = replay(request)?;
    assert_eq!(report, expected);
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
    // Current XP tables start at level 1. Correcting both reward and level
    // indices changes persistent XP, with the independent natural regression
    // binding the source threshold. Native run 34091578658 on 90798ca7 binds
    // this unchanged trace; Wasm must independently match its full report.
    // Audited two-cohort run 34144718100 reproduces the old full golden and
    // exposes all 26 changed paths: only the two content identity fields and
    // derived material/state/effect/snapshot hashes. Both raw reports and all
    // gameplay preimages are preserved remotely. Require the exact cohort's
    // full report here, plus independently derived observations/materials above.
    // No report normalization or unknown-content fallback is accepted.
    assert_eq!(report_digest, golden);
    Ok(report_digest)
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn native_replays_v7_raw_inputs_eventwise() -> Result<(), Box<dyn Error>> {
    let digest = assert_eventwise_parity_contract(|request| {
        replay_m9e_eventwise_native(request).map_err(Into::into)
    })?;
    writeln!(std::io::stdout().lock(), "M9E_RAW_PARITY_DIGEST={digest}")?;
    Ok(())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm_replays_v7_raw_inputs_eventwise() -> Result<(), wasm_bindgen::JsValue> {
    let digest = assert_eventwise_parity_contract(|request| {
        let json = serde_json::to_string(&request)?;
        let report = er_wasm::m9e_parity::replay_m9e_eventwise_json(&json).map_err(|error| {
            error
                .as_string()
                .unwrap_or_else(|| "Wasm replay failed".to_owned())
        })?;
        Ok(serde_json::from_str(&report)?)
    })
    .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
    wasm_bindgen_test::console_log!("M9E_RAW_PARITY_DIGEST={digest}");
    Ok(())
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

// Diagnostic only: original golden assertions above remain exact.
#[cfg(not(target_arch = "wasm32"))]
mod generated_cohort_diagnostic {
    use super::*;
    use std::io::{BufWriter, Write};

    fn write_bounded(
        writer: &mut impl Write,
        value: &impl serde::Serialize,
        total: &mut usize,
    ) -> Result<(), Box<dyn Error>> {
        let bytes = serde_json::to_vec(value)?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("diagnostic record exceeds four MiB".into());
        }
        *total = total
            .checked_add(bytes.len() + 1)
            .ok_or("trace size overflow")?;
        if *total > 64 * 1024 * 1024 {
            return Err("diagnostic trace exceeds sixty-four MiB".into());
        }
        writer.write_all(&bytes)?;
        writer.write_all(b"\n")?;
        Ok(())
    }

    #[test]
    fn capture_actual_eventwise_report_and_preimages() -> Result<(), Box<dyn Error>> {
        let directory = std::path::PathBuf::from(std::env::var("M9E_PARITY_DIAGNOSTIC_DIR")?);
        let cohort = std::env::var("M9E_PARITY_COHORT")?;
        if !directory.is_absolute()
            || !directory.is_dir()
            || !matches!(cohort.as_str(), "old" | "new")
        {
            return Err("explicit owned diagnostic directory and cohort required".into());
        }
        let request = request()?;
        let reference = replay_m9e_eventwise_native(request.clone())?;
        let observed_digest = er_canonical::content_digest(&reference)?;
        // This only pins reproducibility of two previously observed native reports.
        // It does not replace the original golden or qualify a new Wasm golden.
        let expected = if cohort == "old" {
            "c28ac3b994c687413a4d0bcae7c558f0e02dfafd5e9ec3482bbb9462f5598063"
        } else {
            "e426cc7e5fef4bf23b2f081d5d0f3fe44b4ceb33046982638a620e1f6cd9276b"
        };
        assert_eq!(observed_digest, expected);
        let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(
            request.bundle.clone(),
        ))?);
        let initial = request
            .initial_snapshot
            .clone()
            .ok_or("controlled initial snapshot absent")?;
        let mut kernel = GameKernelV7::from_snapshot(
            initial.clone(),
            request.local_seat,
            request.role,
            content,
        )?;
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(directory.join("trace.jsonl"))?;
        let mut writer = BufWriter::new(file);
        let mut total = 0;
        write_bounded(
            &mut writer,
            &serde_json::json!({"kind":"initial", "snapshot":initial}),
            &mut total,
        )?;
        assert_eq!(reference.observations.len(), request.events.len());
        for (index, event) in request.events.iter().enumerate() {
            let step = match event.clone() {
                M9EParityEventV2::RawInput { event } => kernel.raw_input(event)?,
                M9EParityEventV2::PresentationSettled { event_id } => {
                    kernel.settle_presentation(event_id)?;
                    GameKernelStepV7::default()
                }
                M9EParityEventV2::AdvanceTime { milliseconds } => {
                    kernel.advance_time(milliseconds)?
                }
            };
            let snapshot = kernel.snapshot()?;
            let observation = M9EParityObservationV1 {
                sequence: safe((index + 1) as u64),
                input_digest: er_canonical::content_digest(event)?,
                effect_digest: er_canonical::content_digest(&step.effects)?,
                internal_event_digest: er_canonical::content_digest(&step.internal_events)?,
                mechanical_state_digest: er_canonical::content_digest(&kernel.state())?,
                kernel_determinism_digest: er_canonical::content_digest(&snapshot)?,
                control_kind: kernel.current_control().map(|control| control.kind),
                wave: kernel
                    .state()
                    .and_then(|state| state.active_run.as_ref())
                    .map(|run| run.wave),
            };
            assert_eq!(observation, reference.observations[index]);
            write_bounded(
                &mut writer,
                &serde_json::json!({
                    "kind":"event", "sequence":index+1, "event":event,
                    "effects":step.effects, "internal_events":step.internal_events,
                    "mechanical_state":kernel.state(), "kernel_snapshot":snapshot,
                    "observation":observation
                }),
                &mut total,
            )?;
        }
        assert_eq!(
            er_canonical::content_digest(&kernel.snapshot()?)?,
            reference.final_snapshot_digest
        );
        writer.flush()?;
        let mut report_file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(directory.join("report.json"))?;
        let mut report_bytes = 0;
        write_bounded(&mut report_file, &reference, &mut report_bytes)?;
        report_file.flush()?;
        let mut receipt_file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(directory.join("capture.json"))?;
        let mut receipt_bytes = 0;
        write_bounded(
            &mut receipt_file,
            &serde_json::json!({
                "cohort":cohort, "events":reference.observations.len(), "report_digest":observed_digest,
                "trace_bytes":total, "report_bytes":report_bytes, "actual_preimages_match_full_report":true,
                "original_golden_changed":false, "new_wasm_qualification":false
            }),
            &mut receipt_bytes,
        )?;
        receipt_file.flush()?;
        Ok(())
    }
}
