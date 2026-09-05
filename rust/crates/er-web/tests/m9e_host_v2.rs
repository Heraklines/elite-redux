use std::error::Error;

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m7_progression_control::generic_vertical_control_v2;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelV7, GameProposalEnvelopeV2,
    KernelPresentationOutcomeV2,
};
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_protocol::authority_log::{AuthorityLogConfig, BackoffPolicy, PeerBinding};
use er_repro::current::{CurrentCaptureStatusV1, CurrentReproCapsuleV1, CurrentReproOutcomeV1};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
    SCENARIO_RUNTIME_SCHEMA_VERSION_V2, ScenarioRuntimeStageV2, ScenarioRuntimeStateV2,
};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::battle_model::BattleOutcome;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{
    ConnectionGeneration, FrameContext, GAME_ACTION_SCHEMA_VERSION_V1, GameActionV1,
    GameControlKindV2, GameMenuCancelV2, GameProposalV1, MembershipRevision, OperationId, RunId,
    SafeU53, SaveActionV1, ScenarioId, SeatId, SessionId, TerminalActionV1, TimeClass,
    TransportState,
};
use er_web::contracts_v2::{
    BROWSER_WORKER_PROTOCOL_VERSION_V2, BrowserEffectV2, BrowserLifecycleEventV2,
    BrowserPresentationOutcomeV2, BrowserRequestEnvelopeV2, BrowserRequestV2,
    BrowserResponseEnvelopeV2, BrowserResponseV2, BrowserSessionContextV2,
    BrowserSessionInitializationV2, BrowserStorageResultV2,
};
use er_web::host_v2::BrowserKernelHostV2;

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn content() -> Result<PreparedGameContentV2, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Ok(PreparedGameContentV2::prepare(std::sync::Arc::new(bundle))?)
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

fn context() -> BrowserSessionContextV2 {
    BrowserSessionContextV2 {
        local_seat: SeatId::new(safe(1)),
        role: GameKernelRoleV7::Authority,
        scheduler: KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        protocol: None,
    }
}

fn authority_protocol(
    host: SeatId,
    guest: SeatId,
    generation: ConnectionGeneration,
) -> Result<er_protocol::ProtocolRuntimeSnapshotV2, Box<dyn Error>> {
    let frame = FrameContext {
        session_id: SessionId::new("m9e-browser-session")?,
        run_id: RunId::new("m9e-browser-run")?,
        session_epoch: safe(1),
        seat_map_id: "m9e-browser-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: host,
        authority_seat_id: host,
        connection_generation: generation,
    };
    let config = BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: frame,
                peer_bindings: vec![PeerBinding {
                    seat_id: guest,
                    connection_generation: generation,
                }],
                owner_id: "m9e-browser-authority".to_owned(),
                retain_capacity: safe(32),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(1),
                    maximum_ms: safe(64),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: Some(safe(8)),
            },
            proposal_capacity: safe(64),
        },
    };
    Ok(initial_battle_protocol_snapshot_v2(&config, host)?)
}

fn send(
    host: &mut BrowserKernelHostV2,
    sequence: u64,
    request: BrowserRequestV2,
) -> Result<BrowserResponseV2, Box<dyn Error>> {
    let envelope = BrowserRequestEnvelopeV2 {
        version: BROWSER_WORKER_PROTOCOL_VERSION_V2,
        request_id: safe(sequence + 1),
        sequence: safe(sequence),
        request,
    };
    let bytes = er_canonical::canonical_bytes(&envelope)?;
    let decoded: BrowserRequestEnvelopeV2 = serde_json::from_slice(&bytes)?;
    if er_canonical::canonical_bytes(&decoded)? != bytes {
        return Err("browser request is not canonically idempotent".into());
    }
    let response = host
        .process_bytes(&bytes)
        .map_err(|error| format!("request of {} bytes failed: {error}", bytes.len()))?;
    let response: BrowserResponseEnvelopeV2 = serde_json::from_slice(&response)?;
    Ok(response.response)
}

fn key(key: PhysicalKey) -> BrowserRequestV2 {
    BrowserRequestV2::RawInput {
        event: RawInputEvent::KeyDown {
            code: key,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    }
}

fn key_up(key: PhysicalKey) -> BrowserRequestV2 {
    BrowserRequestV2::RawInput {
        event: RawInputEvent::KeyUp { code: key },
    }
}

fn press(
    host: &mut BrowserKernelHostV2,
    sequence: &mut u64,
    key_code: PhysicalKey,
) -> Result<BrowserResponseV2, Box<dyn Error>> {
    let response = send(host, *sequence, key(key_code.clone()))?;
    *sequence += 1;
    send(host, *sequence, key_up(key_code))?;
    *sequence += 1;
    Ok(response)
}

fn natural_host() -> Result<(BrowserKernelHostV2, u64), Box<dyn Error>> {
    let mut host = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)
        .map_err(|error| format!("bundle initialization failed: {error}"))?;
    let response = send(
        &mut host,
        0,
        BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::NaturalStart {
                context: context(),
                profile: profile()?,
                seed: "browser-v2-natural".to_owned(),
                save_slots: vec!["preview-slot".to_owned()],
                local_is_host: true,
            }),
        },
    )
    .map_err(|error| format!("natural session initialization failed: {error}"))?;
    assert!(matches!(response, BrowserResponseV2::Ready));
    Ok((host, 1))
}

fn navigate_down_to(
    host: &mut BrowserKernelHostV2,
    sequence: &mut u64,
    option: &str,
) -> Result<(), Box<dyn Error>> {
    let bound = host
        .kernel_ref()
        .and_then(GameKernelV7::current_control)
        .and_then(|control| control.menu.as_ref())
        .map(|menu| menu.options.len() + 1)
        .ok_or("control has no menu")?;
    for _ in 0..bound {
        if host
            .kernel_ref()
            .and_then(GameKernelV7::current_control)
            .and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == option)
        {
            return Ok(());
        }
        press(host, sequence, PhysicalKey::ArrowDown)?;
    }
    Err("target option is unreachable".into())
}

fn complete_natural_start(
    host: &mut BrowserKernelHostV2,
    sequence: &mut u64,
) -> Result<Vec<BrowserEffectV2>, Box<dyn Error>> {
    press(host, sequence, PhysicalKey::Space)?;
    press(host, sequence, PhysicalKey::Space)?;
    press(host, sequence, PhysicalKey::Space)?;
    navigate_down_to(host, sequence, "bootstrap/starter/confirm")?;
    press(host, sequence, PhysicalKey::Space)?;
    press(host, sequence, PhysicalKey::Space)?;
    press(host, sequence, PhysicalKey::Space)?;
    let response = press(host, sequence, PhysicalKey::Space)?;
    let BrowserResponseV2::Effects { batch } = response else {
        return Err("natural completion did not return effects".into());
    };
    Ok(batch.effects)
}

fn install_save_control(
    snapshot: &mut er_kernel::snapshot_v7::CoreGameKernelSnapshotV7,
    operation: &str,
    action: SaveActionV1,
) -> Result<(), Box<dyn Error>> {
    let revision = snapshot.material_ledger.next_authority_revision;
    let menu = snapshot.next_menu_instance_id;
    let control = generic_vertical_control_v2(
        menu,
        revision,
        context().local_seat,
        OperationId::new(operation)?,
        GameControlKindV2::Save,
        operation,
        &[(format!("{operation}/option"), GameActionV1::Save { action })],
        GameMenuCancelV2::Disabled,
    )?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut snapshot.lifecycle else {
        return Err("snapshot is not active".into());
    };
    state.active_run.as_mut().ok_or("run missing")?.control = control;
    snapshot.next_menu_instance_id = MenuInstanceId::new(safe(menu.get().get() + 1));
    Ok(())
}

#[test]
fn natural_browser_route_produces_typed_ui_transport_presentation_audio_and_assets()
-> Result<(), Box<dyn Error>> {
    let (mut host, mut sequence) = natural_host()?;
    let first = press(&mut host, &mut sequence, PhysicalKey::Space)?;
    let BrowserResponseV2::Effects { batch } = first else {
        return Err("raw input did not return effects".into());
    };
    assert!(
        batch
            .effects
            .iter()
            .any(|effect| matches!(effect, BrowserEffectV2::UiChanged { .. }))
    );
    assert!(
        batch
            .effects
            .iter()
            .any(|effect| matches!(effect, BrowserEffectV2::AssetRequest { .. }))
    );
    assert!(
        batch
            .effects
            .iter()
            .any(|effect| matches!(effect, BrowserEffectV2::AudioCue { .. }))
    );

    press(&mut host, &mut sequence, PhysicalKey::Space)?;
    press(&mut host, &mut sequence, PhysicalKey::Space)?;
    navigate_down_to(&mut host, &mut sequence, "bootstrap/starter/confirm")?;
    press(&mut host, &mut sequence, PhysicalKey::Space)?;
    press(&mut host, &mut sequence, PhysicalKey::Space)?;
    press(&mut host, &mut sequence, PhysicalKey::Space)?;
    let response = press(&mut host, &mut sequence, PhysicalKey::Space)?;
    let BrowserResponseV2::Effects { batch } = response else {
        return Err("natural completion did not return effects".into());
    };
    assert!(
        batch
            .effects
            .iter()
            .any(|effect| matches!(effect, BrowserEffectV2::SendNetworkFrame { .. }))
    );
    assert!(
        batch
            .effects
            .iter()
            .any(|effect| matches!(effect, BrowserEffectV2::Presentation { .. }))
    );
    assert!(
        batch
            .effects
            .iter()
            .any(|effect| matches!(effect, BrowserEffectV2::PresentationSceneChanged { .. }))
    );
    assert!(
        batch
            .effects
            .iter()
            .any(|effect| matches!(effect, BrowserEffectV2::Telemetry { .. }))
    );
    Ok(())
}

#[test]
fn all_five_initialization_modes_and_repro_effect_are_live() -> Result<(), Box<dyn Error>> {
    let prepared = content()?;
    let (mut natural, mut sequence) = natural_host()?;
    complete_natural_start(&mut natural, &mut sequence)?;
    let snapshot = natural.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    GameKernelV7::from_snapshot(
        snapshot.clone(),
        context().local_seat,
        GameKernelRoleV7::Authority,
        std::sync::Arc::new(content()?),
    )
    .map_err(|error| format!("direct snapshot restore failed: {error}"))?;
    let state = match &snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Active(state) => state.clone(),
        _ => return Err("natural snapshot is not active".into()),
    };
    let save = GameSaveV2::new(prepared.identity().clone(), safe(1), state)?;

    let initializations = vec![
        BrowserSessionInitializationV2::ExistingSave {
            context: context(),
            save,
        },
        BrowserSessionInitializationV2::Snapshot {
            context: context(),
            snapshot: snapshot.clone(),
        },
        BrowserSessionInitializationV2::ReproCapsule {
            context: context(),
            snapshot: snapshot.clone(),
            inputs: Vec::new(),
        },
    ];
    for (label, initialization) in ["existing-save", "snapshot", "repro"]
        .into_iter()
        .zip(initializations)
    {
        let mut host = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
        let response = send(
            &mut host,
            0,
            BrowserRequestV2::Initialize {
                initialization: Box::new(initialization),
            },
        )
        .map_err(|error| format!("{label} initialization failed: {error}"))?;
        assert!(matches!(response, BrowserResponseV2::Ready));
    }
    let mut scenario_snapshot = snapshot.clone();
    let scenario_id = ScenarioId::ZERO;
    let entry = prepared
        .scenarios
        .scenario(scenario_id)
        .ok_or("scenario zero missing")?
        .entry;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut scenario_snapshot.lifecycle else {
        return Err("snapshot is not active".into());
    };
    state.active_run.as_mut().ok_or("run missing")?.scenario = Some(ScenarioRuntimeStateV2 {
        schema_version: SCENARIO_RUNTIME_SCHEMA_VERSION_V2,
        scenario: scenario_id,
        node: entry,
        stage: ScenarioRuntimeStageV2::Intro,
        selected_option: None,
        primary_target: None,
        secondary_target: None,
        locals: Default::default(),
        reserved_pokemon: Vec::new(),
        visit_count: SafeU53::ZERO,
    });
    let mut scenario_host = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    assert!(matches!(
        send(
            &mut scenario_host,
            0,
            BrowserRequestV2::Initialize {
                initialization: Box::new(BrowserSessionInitializationV2::Scenario {
                    context: context(),
                    snapshot: scenario_snapshot,
                    scenario: scenario_id,
                }),
            },
        )?,
        BrowserResponseV2::Ready
    ));
    let response = send(&mut scenario_host, 1, BrowserRequestV2::ExportRepro)?;
    let BrowserResponseV2::Effects { batch } = response else {
        return Err("repro export did not return effects".into());
    };
    assert!(matches!(
        batch.effects.as_slice(),
        [BrowserEffectV2::CurrentReproReady { .. }]
    ));
    Ok(())
}

#[test]
fn save_and_terminal_controls_produce_storage_and_terminal_effects() -> Result<(), Box<dyn Error>> {
    let prepared = content()?;
    let (mut natural, mut sequence) = natural_host()?;
    complete_natural_start(&mut natural, &mut sequence)?;
    let base = natural.kernel_ref().ok_or("kernel missing")?.snapshot()?;

    let mut save_snapshot = base.clone();
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut save_snapshot.lifecycle else {
        return Err("snapshot is not active".into());
    };
    let revision = save_snapshot.material_ledger.next_authority_revision;
    let menu = save_snapshot.next_menu_instance_id;
    let save_control = generic_vertical_control_v2(
        menu,
        revision,
        context().local_seat,
        OperationId::new("save/browser/1")?,
        GameControlKindV2::Save,
        "m9e/browser/save",
        &[(
            "save/write".to_owned(),
            GameActionV1::Save {
                action: SaveActionV1::Write {
                    slot: "preview-slot".to_owned(),
                },
            },
        )],
        GameMenuCancelV2::Disabled,
    )?;
    state.active_run.as_mut().ok_or("run missing")?.control = save_control;
    save_snapshot.next_menu_instance_id = MenuInstanceId::new(safe(menu.get().get() + 1));
    let save = GameSaveV2::new(prepared.identity().clone(), safe(1), state.clone())?;
    let mut save_host = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    send(
        &mut save_host,
        0,
        BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::ExistingSave {
                context: context(),
                save,
            }),
        },
    )?;
    let response = press(&mut save_host, &mut 1, PhysicalKey::Space)?;
    let BrowserResponseV2::Effects { batch } = response else {
        return Err("save action returned no effects".into());
    };
    assert!(
        batch
            .effects
            .iter()
            .any(|effect| matches!(effect, BrowserEffectV2::StorageRequest { .. }))
    );

    let mut terminal_snapshot = base;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut terminal_snapshot.lifecycle else {
        return Err("snapshot is not active".into());
    };
    let revision = terminal_snapshot.material_ledger.next_authority_revision;
    let menu = terminal_snapshot.next_menu_instance_id;
    let terminal_control = generic_vertical_control_v2(
        menu,
        revision,
        context().local_seat,
        OperationId::new("terminal/browser/1")?,
        GameControlKindV2::Save,
        "m9e/browser/terminal",
        &[(
            "terminal/victory".to_owned(),
            GameActionV1::Terminal {
                action: TerminalActionV1::ConfirmOutcome {
                    outcome: BattleOutcome::Victory,
                },
            },
        )],
        GameMenuCancelV2::Disabled,
    )?;
    state.active_run.as_mut().ok_or("run missing")?.control = terminal_control;
    terminal_snapshot.next_menu_instance_id = MenuInstanceId::new(safe(menu.get().get() + 1));
    let mut terminal_host = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    send(
        &mut terminal_host,
        0,
        BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::Snapshot {
                context: context(),
                snapshot: terminal_snapshot,
            }),
        },
    )?;
    let mut terminal_sequence = 1;
    let response = press(
        &mut terminal_host,
        &mut terminal_sequence,
        PhysicalKey::Space,
    )?;
    let BrowserResponseV2::Effects { batch } = response else {
        return Err("terminal action returned no effects".into());
    };
    assert!(
        batch
            .effects
            .iter()
            .any(|effect| matches!(effect, BrowserEffectV2::Terminal { .. }))
    );
    Ok(())
}

#[test]
fn browser_host_survives_request_window() -> Result<(), Box<dyn Error>> {
    let (mut host, mut sequence) = natural_host()?;
    for _ in 0..2_100 {
        let response = send(&mut host, sequence, BrowserRequestV2::Snapshot)?;
        assert!(matches!(response, BrowserResponseV2::Snapshot { .. }));
        sequence += 1;
    }
    let response = send(&mut host, sequence, BrowserRequestV2::Snapshot)?;
    assert!(matches!(response, BrowserResponseV2::Snapshot { .. }));
    Ok(())
}

#[test]
fn browser_requests_are_atomic_and_conflicting_retries_fail_closed() -> Result<(), Box<dyn Error>> {
    let (mut host, sequence) = natural_host()?;
    let before = host.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    let invalid = BrowserRequestEnvelopeV2 {
        version: BROWSER_WORKER_PROTOCOL_VERSION_V2,
        request_id: safe(sequence + 1),
        sequence: safe(sequence),
        request: BrowserRequestV2::AuthorityMaterial {
            bytes: vec![1, 2, 3],
        },
    };
    let invalid = er_canonical::canonical_bytes(&invalid)?;
    assert!(host.process_bytes(&invalid).is_err());
    assert_eq!(
        host.kernel_ref().ok_or("kernel missing")?.snapshot()?,
        before
    );

    let response = send(&mut host, sequence, BrowserRequestV2::Snapshot)?;
    assert!(matches!(response, BrowserResponseV2::Snapshot { .. }));
    let accepted = host.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    let conflict = BrowserRequestEnvelopeV2 {
        version: BROWSER_WORKER_PROTOCOL_VERSION_V2,
        request_id: safe(sequence + 1),
        sequence: safe(sequence),
        request: BrowserRequestV2::ExportRepro,
    };
    let conflict = er_canonical::canonical_bytes(&conflict)?;
    assert!(host.process_bytes(&conflict).is_err());
    assert_eq!(
        host.kernel_ref().ok_or("kernel missing")?.snapshot()?,
        accepted
    );
    Ok(())
}

#[test]
fn browser_time_and_lifecycle_requests_execute_kernel_state_changes() -> Result<(), Box<dyn Error>>
{
    let (mut host, mut sequence) = natural_host()?;
    complete_natural_start(&mut host, &mut sequence)?;
    let before = host.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    let response = send(
        &mut host,
        sequence,
        BrowserRequestV2::AdvanceTime {
            milliseconds: safe(25),
        },
    )?;
    assert!(matches!(response, BrowserResponseV2::Effects { .. }));
    sequence += 1;
    let advanced = host.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    assert!(advanced.replay_sequence > before.replay_sequence);

    send(
        &mut host,
        sequence,
        BrowserRequestV2::Lifecycle {
            event: BrowserLifecycleEventV2::Hidden,
        },
    )?;
    sequence += 1;
    assert_eq!(
        host.kernel_ref()
            .ok_or("kernel missing")?
            .snapshot()?
            .input_router
            .focus,
        InputFocus::TextEntry
    );
    send(
        &mut host,
        sequence,
        BrowserRequestV2::Lifecycle {
            event: BrowserLifecycleEventV2::Visible,
        },
    )?;
    assert_eq!(
        host.kernel_ref()
            .ok_or("kernel missing")?
            .snapshot()?
            .input_router
            .focus,
        InputFocus::Game
    );
    Ok(())
}

#[test]
fn browser_network_and_transport_requests_execute_protocol_state() -> Result<(), Box<dyn Error>> {
    let prepared = content()?;
    let (mut source, mut source_sequence) = natural_host()?;
    complete_natural_start(&mut source, &mut source_sequence)?;
    let mut snapshot = source.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    let host = SeatId::new(safe(1));
    let guest = SeatId::new(safe(2));
    let generation = ConnectionGeneration::new(safe(1));
    let revision = snapshot.material_ledger.next_authority_revision;
    let menu_instance = snapshot.next_menu_instance_id;
    let operation = OperationId::new("save/browser/guest/1")?;
    let mut control = generic_vertical_control_v2(
        menu_instance,
        revision,
        guest,
        operation.clone(),
        GameControlKindV2::Save,
        "m9e/browser/guest-save",
        &[(
            "save/cancel".to_owned(),
            GameActionV1::Save {
                action: SaveActionV1::Cancel,
            },
        )],
        GameMenuCancelV2::Disabled,
    )?;
    control
        .action_context
        .as_mut()
        .ok_or("control context missing")?
        .authority_seat = host;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut snapshot.lifecycle else {
        return Err("source snapshot is not active".into());
    };
    state.active_run.as_mut().ok_or("run missing")?.control = control.clone();
    let save = GameSaveV2::new(prepared.identity().clone(), safe(1), state.clone())?;
    let mut browser = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    send(
        &mut browser,
        0,
        BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::ExistingSave {
                context: BrowserSessionContextV2 {
                    local_seat: host,
                    role: GameKernelRoleV7::Authority,
                    scheduler: context().scheduler,
                    protocol: Some(authority_protocol(host, guest, generation)?),
                },
                save,
            }),
        },
    )?;
    let proposal = GameProposalEnvelopeV2 {
        schema_version: 2,
        sender_seat: guest,
        connection_generation: generation,
        proposal: GameProposalV1 {
            schema_version: GAME_ACTION_SCHEMA_VERSION_V1,
            context: control.action_context.ok_or("control context missing")?,
            action: GameActionV1::Save {
                action: SaveActionV1::Cancel,
            },
        },
    };
    let response = send(
        &mut browser,
        1,
        BrowserRequestV2::NetworkFrame {
            generation: safe(1),
            bytes: er_canonical::canonical_bytes(&proposal)?,
        },
    )?;
    let BrowserResponseV2::Effects { batch } = response else {
        return Err("network ingress returned no effects".into());
    };
    assert!(
        batch
            .effects
            .iter()
            .any(|effect| matches!(effect, BrowserEffectV2::SendNetworkFrame { .. }))
    );

    send(
        &mut browser,
        2,
        BrowserRequestV2::TransportChanged {
            generation: safe(1),
            connected: false,
        },
    )?;
    let disconnected = browser.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    let disconnected_protocol = disconnected.protocol.as_ref().ok_or("protocol missing")?;
    assert_eq!(
        disconnected_protocol.connections[0].state,
        TransportState::Disconnected
    );
    assert!(!disconnected.scheduler.pauses.is_empty());
    send(
        &mut browser,
        3,
        BrowserRequestV2::TransportChanged {
            generation: safe(1),
            connected: true,
        },
    )?;
    let connected = browser.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    let connected_protocol = connected.protocol.as_ref().ok_or("protocol missing")?;
    assert_eq!(
        connected_protocol.connections[0].state,
        TransportState::Connected
    );
    assert!(connected.scheduler.pauses.is_empty());
    send(&mut browser, 4, BrowserRequestV2::TransportChanged { generation: safe(2), connected: true })?;
    let staged = browser.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    assert_eq!(staged.protocol.as_ref().ok_or("protocol missing")?.staged_rebinds[0].generation, ConnectionGeneration::new(safe(2)));
    let mut sequence = 5;
    let (capsule_bytes, capsule) = export_current_capsule(&mut browser, &mut sequence)?;
    let transport = capsule.browser_transport.as_ref().ok_or("browser transport context missing")?;
    assert_eq!(transport.base_generation, safe(1));
    assert_eq!(transport.final_generation, safe(2));
    assert!(matches!(capsule.attempts.last().ok_or("transport attempt missing")?.event,
        CurrentExternalEvent::TransportChanged { generation, connected: true } if generation == ConnectionGeneration::new(safe(2))));
    let mut imported = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    send(&mut imported, 0, BrowserRequestV2::Initialize {
        initialization: Box::new(BrowserSessionInitializationV2::CurrentReproCapsule { capsule_bytes }),
    })?;
    assert_eq!(imported.kernel_ref().ok_or("kernel missing")?.snapshot()?, staged);
    // An older transport generation must remain an adapter rejection after
    // import even while the newer generation is only staged in the kernel.
    for (host, sequence) in [(&mut browser, sequence), (&mut imported, 1)] {
        assert!(send(host, sequence, BrowserRequestV2::TransportChanged { generation: safe(1), connected: false }).is_err());
        assert_eq!(host.kernel_ref().ok_or("kernel missing")?.snapshot()?, staged);
        assert!(matches!(host.capture_status(), Some(CurrentCaptureStatusV1::Unavailable { .. })));
        send(host, sequence, BrowserRequestV2::AdvanceTime { milliseconds: safe(17) })?;
    }
    assert_eq!(imported.kernel_ref().ok_or("kernel missing")?.snapshot()?, browser.kernel_ref().ok_or("kernel missing")?.snapshot()?);
    Ok(())
}

#[test]
fn browser_storage_results_apply_cas_and_loaded_state() -> Result<(), Box<dyn Error>> {
    let (mut source, mut source_sequence) = natural_host()?;
    complete_natural_start(&mut source, &mut source_sequence)?;
    let mut write_snapshot = source.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    install_save_control(
        &mut write_snapshot,
        "save/storage/write-1",
        SaveActionV1::Write {
            slot: "slot-a".to_owned(),
        },
    )?;
    let mut writer = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    send(
        &mut writer,
        0,
        BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::Snapshot {
                context: context(),
                snapshot: write_snapshot,
            }),
        },
    )?;
    let mut writer_sequence = 1;
    let response = press(&mut writer, &mut writer_sequence, PhysicalKey::Space)?;
    let BrowserResponseV2::Effects { batch } = response else {
        return Err("save write returned no effects".into());
    };
    let first_write = batch
        .effects
        .into_iter()
        .find_map(|effect| match effect {
            BrowserEffectV2::StorageRequest { request } => Some(request),
            _ => None,
        })
        .ok_or("storage write request missing")?;
    assert_eq!(first_write.generation, Some(safe(1)));
    assert!(!first_write.bytes.is_empty());
    send(
        &mut writer,
        writer_sequence,
        BrowserRequestV2::StorageResult {
            request_id: first_write.request_id,
            result: BrowserStorageResultV2::Written,
        },
    )?;
    let written_snapshot = writer.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    assert_eq!(written_snapshot.storage_frontiers.len(), 1);
    assert_eq!(written_snapshot.storage_frontiers[0].generation, safe(1));

    let mut second_snapshot = written_snapshot.clone();
    install_save_control(
        &mut second_snapshot,
        "save/storage/write-2",
        SaveActionV1::Write {
            slot: "slot-a".to_owned(),
        },
    )?;
    let mut second_writer = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    send(
        &mut second_writer,
        0,
        BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::Snapshot {
                context: context(),
                snapshot: second_snapshot,
            }),
        },
    )?;
    let mut second_sequence = 1;
    let response = press(&mut second_writer, &mut second_sequence, PhysicalKey::Space)?;
    let BrowserResponseV2::Effects { batch } = response else {
        return Err("second save returned no effects".into());
    };
    let second_write = batch
        .effects
        .into_iter()
        .find_map(|effect| match effect {
            BrowserEffectV2::StorageRequest { request } => Some(request),
            _ => None,
        })
        .ok_or("second storage write missing")?;
    assert_eq!(second_write.generation, Some(safe(2)));
    let before_conflict = second_writer
        .kernel_ref()
        .ok_or("kernel missing")?
        .snapshot()?;
    assert!(
        send(
            &mut second_writer,
            second_sequence,
            BrowserRequestV2::StorageResult {
                request_id: second_write.request_id,
                result: BrowserStorageResultV2::Conflict {
                    current_generation: safe(1),
                },
            },
        )
        .is_err()
    );
    assert_eq!(
        second_writer
            .kernel_ref()
            .ok_or("kernel missing")?
            .snapshot()?,
        before_conflict
    );

    let mut load_snapshot = written_snapshot;
    install_save_control(
        &mut load_snapshot,
        "save/storage/load",
        SaveActionV1::Load {
            slot: "slot-a".to_owned(),
        },
    )?;
    let mut loader = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    send(
        &mut loader,
        0,
        BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::Snapshot {
                context: context(),
                snapshot: load_snapshot,
            }),
        },
    )?;
    let mut load_sequence = 1;
    let response = press(&mut loader, &mut load_sequence, PhysicalKey::Space)?;
    let BrowserResponseV2::Effects { batch } = response else {
        return Err("save load returned no effects".into());
    };
    let read = batch
        .effects
        .into_iter()
        .find_map(|effect| match effect {
            BrowserEffectV2::StorageRequest { request } => Some(request),
            _ => None,
        })
        .ok_or("storage read request missing")?;
    send(
        &mut loader,
        load_sequence,
        BrowserRequestV2::StorageResult {
            request_id: read.request_id,
            result: BrowserStorageResultV2::Read {
                bytes: Some(first_write.bytes),
            },
        },
    )?;
    let loaded = loader.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    assert_eq!(loaded.storage_frontiers[0].generation, safe(1));
    assert!(loaded.pending_platform.is_empty());
    Ok(())
}

#[test]
fn presentation_failure_retains_barrier_until_successful_settlement() -> Result<(), Box<dyn Error>>
{
    let (mut host, mut sequence) = natural_host()?;
    complete_natural_start(&mut host, &mut sequence)?;
    let pending = host
        .kernel_ref()
        .ok_or("kernel missing")?
        .snapshot()?
        .pending_presentations;
    let event = pending
        .first()
        .map(|pending| pending.event_id)
        .ok_or("pending presentation missing")?;
    let before = host.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    assert!(
        send(
            &mut host,
            sequence,
            BrowserRequestV2::PresentationSettled {
                event_id: event,
                outcome: BrowserPresentationOutcomeV2::Failed {
                    reason: "renderer-lost".to_owned(),
                },
            },
        )
        .is_err()
    );
    assert_eq!(
        host.kernel_ref().ok_or("kernel missing")?.snapshot()?,
        before
    );
    send(
        &mut host,
        sequence,
        BrowserRequestV2::PresentationSettled {
            event_id: event,
            outcome: BrowserPresentationOutcomeV2::Settled,
        },
    )?;
    assert!(
        host.kernel_ref()
            .ok_or("kernel missing")?
            .snapshot()?
            .pending_presentations
            .iter()
            .all(|pending| pending.event_id != event)
    );
    Ok(())
}

fn export_current_capsule(host: &mut BrowserKernelHostV2, sequence: &mut u64)
    -> Result<(Vec<u8>, CurrentReproCapsuleV1), Box<dyn Error>>
{
    let response = send(host, *sequence, BrowserRequestV2::ExportRepro)?;
    *sequence += 1;
    let BrowserResponseV2::Effects { batch } = response else { return Err("repro export returned no effects".into()); };
    let [BrowserEffectV2::CurrentReproReady { capsule_bytes }] = batch.effects.as_slice() else {
        return Err("current repro capsule missing".into());
    };
    let capsule: CurrentReproCapsuleV1 = serde_json::from_slice(capsule_bytes)?;
    assert_eq!(er_canonical::canonical_bytes(&capsule)?, *capsule_bytes);
    Ok((capsule_bytes.clone(), capsule))
}

#[test]
fn exported_current_repro_replays_raw_non_key_rejection_and_continues() -> Result<(), Box<dyn Error>> {
    let (mut host, mut sequence) = natural_host()?;
    press(&mut host, &mut sequence, PhysicalKey::Space)?;
    send(&mut host, sequence, BrowserRequestV2::AdvanceTime { milliseconds: safe(17) })?;
    sequence += 1;
    for event in [BrowserLifecycleEventV2::Hidden, BrowserLifecycleEventV2::Visible] {
        send(&mut host, sequence, BrowserRequestV2::Lifecycle { event })?;
        sequence += 1;
    }
    let expected = host.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    assert!(send(&mut host, sequence, BrowserRequestV2::PresentationSettled {
        event_id: er_types::PresentationEventId::new(safe(999)), outcome: BrowserPresentationOutcomeV2::Settled,
    }).is_err());
    assert_eq!(host.kernel_ref().ok_or("kernel missing")?.snapshot()?, expected);
    let capture = host.capture_status();
    assert_eq!(capture, Some(CurrentCaptureStatusV1::Available { base_position: 0, final_position: 6 }));
    send(&mut host, sequence, BrowserRequestV2::Snapshot)?;
    sequence += 1;
    assert_eq!(host.capture_status(), capture);
    let (capsule_bytes, capsule) = export_current_capsule(&mut host, &mut sequence)?;
    assert_eq!(host.capture_status(), capture);
    assert_eq!(capsule.attempts.len(), 6);
    let transport = capsule.browser_transport.as_ref().ok_or("browser transport context missing")?;
    assert_eq!(transport.base_generation, safe(1));
    assert_eq!(transport.final_generation, safe(1));
    assert!(matches!(capsule.attempts[2].event, CurrentExternalEvent::AdvanceTime { milliseconds } if milliseconds == safe(17)));
    assert_eq!(capsule.attempts[3].origin.as_deref(), Some("browser.lifecycle.HIDDEN"));
    assert_eq!(capsule.attempts[4].origin.as_deref(), Some("browser.lifecycle.VISIBLE"));
    assert!(matches!(capsule.attempts[5].outcome, CurrentReproOutcomeV1::KernelRejected { .. }));
    let mut replay = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    send(
        &mut replay,
        0,
        BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::CurrentReproCapsule { capsule_bytes }),
        },
    )?;
    assert_eq!(
        replay.kernel_ref().ok_or("kernel missing")?.snapshot()?,
        expected
    );
    let mut replay_sequence = 1;
    let (_, imported) = export_current_capsule(&mut replay, &mut replay_sequence)?;
    assert_eq!(imported, capsule);
    send(&mut host, sequence, BrowserRequestV2::AdvanceTime { milliseconds: safe(31) })?;
    sequence += 1;
    send(&mut replay, replay_sequence, BrowserRequestV2::AdvanceTime { milliseconds: safe(31) })?;
    replay_sequence += 1;
    assert_eq!(replay.kernel_ref().ok_or("kernel missing")?.snapshot()?, host.kernel_ref().ok_or("kernel missing")?.snapshot()?);
    assert_eq!(export_current_capsule(&mut host, &mut sequence)?.1,
               export_current_capsule(&mut replay, &mut replay_sequence)?.1);
    Ok(())
}

#[test]
fn current_repro_exact_cached_retry_does_not_record_twice() -> Result<(), Box<dyn Error>> {
    let (mut host, mut sequence) = natural_host()?;
    let event = er_canonical::canonical_bytes(&BrowserRequestEnvelopeV2 {
        version: BROWSER_WORKER_PROTOCOL_VERSION_V2, request_id: safe(sequence + 1), sequence: safe(sequence),
        request: BrowserRequestV2::AdvanceTime { milliseconds: safe(9) },
    })?;
    let response = host.process_bytes(&event)?;
    sequence += 1;
    let snapshot = host.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    let capture = host.capture_status();
    assert_eq!(host.process_bytes(&event)?, response);
    assert_eq!(host.capture_status(), capture);
    assert_eq!(host.kernel_ref().ok_or("kernel missing")?.snapshot()?, snapshot);
    let (_, capsule) = export_current_capsule(&mut host, &mut sequence)?;
    assert_eq!(capsule.attempts.len(), 1);
    assert_eq!(capsule.final_position, 1);
    Ok(())
}

#[test]
fn invalid_current_capsule_initialization_is_atomic_and_can_retry() -> Result<(), Box<dyn Error>> {
    let (mut source, mut sequence) = natural_host()?;
    send(&mut source, sequence, BrowserRequestV2::AdvanceTime { milliseconds: safe(12) })?;
    sequence += 1;
    let expected = source.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    let (bytes, mut capsule) = export_current_capsule(&mut source, &mut sequence)?;
    let mut missing_context = capsule.clone();
    missing_context.browser_transport = None;
    let mut wrong_generation = capsule.clone();
    wrong_generation.browser_transport.as_mut().ok_or("browser transport context missing")?.final_generation = safe(2);
    capsule.final_snapshot_digest = "invalid".to_owned();
    for invalid in [b"not JSON".to_vec(), er_canonical::canonical_bytes(&capsule)?,
        er_canonical::canonical_bytes(&missing_context)?, er_canonical::canonical_bytes(&wrong_generation)?] {
        let mut host = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
        assert!(send(&mut host, 0, BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::CurrentReproCapsule { capsule_bytes: invalid }),
        }).is_err());
        assert!(host.kernel_ref().is_none());
        assert_eq!(host.capture_status(), None);
        send(&mut host, 0, BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::CurrentReproCapsule { capsule_bytes: bytes.clone() }),
        })?;
        assert_eq!(host.kernel_ref().ok_or("kernel missing")?.snapshot()?, expected);
    }
    Ok(())
}

fn compare_current_event(
    host: &mut BrowserKernelHostV2,
    session: &mut CurrentGameSession,
    sequence: &mut u64,
    request: BrowserRequestV2,
    event: CurrentExternalEvent,
) -> Result<(), Box<dyn Error>> {
    let step = session.apply(event)?;
    let response = send(host, *sequence, request)?;
    let BrowserResponseV2::Effects { batch } = response else {
        return Err("current browser event did not return an effect batch".into());
    };
    assert_eq!(batch.external_sequence, safe(*sequence));
    *sequence += 1;
    assert_eq!(
        host.kernel_ref()
            .ok_or("browser kernel missing")?
            .snapshot()?,
        session.snapshot()?
    );

    // Compare game-owned presentation, controls, and transport in order;
    // assets/audio/telemetry remain browser-specific projections.
    let expected: Vec<_> = step
        .effects
        .into_iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::UiChanged(control) => Some(BrowserEffectV2::UiChanged { control }),
            GameKernelEffectV7::ProposalReady { bytes, .. }
            | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => {
                Some(BrowserEffectV2::SendNetworkFrame {
                    generation: safe(1),
                    bytes,
                })
            }
            GameKernelEffectV7::Presentation(effect) => {
                Some(BrowserEffectV2::Presentation { effect })
            }
            GameKernelEffectV7::Terminal(terminal) => Some(BrowserEffectV2::Terminal { terminal }),
            GameKernelEffectV7::Platform(_) => None,
        })
        .collect();
    let actual: Vec<_> = batch
        .effects
        .into_iter()
        .filter(|effect| {
            matches!(
                effect,
                BrowserEffectV2::UiChanged { .. }
                    | BrowserEffectV2::SendNetworkFrame { .. }
                    | BrowserEffectV2::Presentation { .. }
                    | BrowserEffectV2::Terminal { .. }
            )
        })
        .collect();
    assert_eq!(actual, expected);
    Ok(())
}

fn press_current_pair(
    host: &mut BrowserKernelHostV2,
    session: &mut CurrentGameSession,
    sequence: &mut u64,
    code: PhysicalKey,
) -> Result<(), Box<dyn Error>> {
    for request in [key(code.clone()), key_up(code)] {
        let BrowserRequestV2::RawInput { event } = &request else {
            return Err("key helper did not return raw input".into());
        };
        let event = CurrentExternalEvent::RawInput {
            input: event.clone(),
        };
        compare_current_event(host, session, sequence, request, event)?;
    }
    Ok(())
}

#[test]
fn current_session_and_browser_match_natural_input_and_external_outcomes()
-> Result<(), Box<dyn Error>> {
    let prepared = std::sync::Arc::new(content()?);
    let initial_context = context();
    let mut session = CurrentGameSession::natural_start_with_scheduler(
        profile()?,
        "browser-session-parity".to_owned(),
        initial_context.local_seat,
        vec!["preview-slot".to_owned()],
        true,
        prepared.clone(),
        initial_context.scheduler.clone(),
        initial_context.protocol.clone(),
    )?;
    let mut host = BrowserKernelHostV2::from_content(prepared);
    send(
        &mut host,
        0,
        BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::NaturalStart {
                context: initial_context,
                profile: profile()?,
                seed: "browser-session-parity".to_owned(),
                save_slots: vec!["preview-slot".to_owned()],
                local_is_host: true,
            }),
        },
    )?;
    assert_eq!(session.observe()?.kernel_version, 7);
    assert_eq!(
        host.kernel_ref()
            .ok_or("browser kernel missing")?
            .snapshot()?,
        session.snapshot()?
    );
    let mut sequence = 1;
    for _ in 0..3 {
        press_current_pair(&mut host, &mut session, &mut sequence, PhysicalKey::Space)?;
    }
    let bound = session
        .observe()?
        .control
        .and_then(|control| control.menu)
        .map(|menu| menu.options.len())
        .ok_or("starter menu missing")?;
    for _ in 0..bound {
        if session
            .observe()?
            .control
            .and_then(|control| control.menu)
            .is_some_and(|menu| menu.selected_option_id.as_str() == "bootstrap/starter/confirm")
        {
            break;
        }
        press_current_pair(
            &mut host,
            &mut session,
            &mut sequence,
            PhysicalKey::ArrowDown,
        )?;
    }
    assert!(
        session
            .observe()?
            .control
            .and_then(|control| control.menu)
            .is_some_and(|menu| {
                menu.selected_option_id.as_str() == "bootstrap/starter/confirm"
            })
    );
    for _ in 0..4 {
        press_current_pair(&mut host, &mut session, &mut sequence, PhysicalKey::Space)?;
    }
    assert!(session.observe()?.mechanical_digest.is_some());
    let pending = session.snapshot()?.pending_presentations;
    assert!(!pending.is_empty());
    for presentation in pending {
        compare_current_event(
            &mut host,
            &mut session,
            &mut sequence,
            BrowserRequestV2::PresentationSettled {
                event_id: presentation.event_id,
                outcome: BrowserPresentationOutcomeV2::Settled,
            },
            CurrentExternalEvent::PresentationOutcome {
                event_id: presentation.event_id,
                outcome: KernelPresentationOutcomeV2::Settled,
            },
        )?;
    }
    compare_current_event(
        &mut host,
        &mut session,
        &mut sequence,
        BrowserRequestV2::AdvanceTime {
            milliseconds: safe(25),
        },
        CurrentExternalEvent::AdvanceTime {
            milliseconds: safe(25),
        },
    )?;
    press_current_pair(
        &mut host,
        &mut session,
        &mut sequence,
        PhysicalKey::ArrowDown,
    )?;
    for (event, input) in [
        (
            BrowserLifecycleEventV2::Hidden,
            RawInputEvent::WindowBlurred,
        ),
        (
            BrowserLifecycleEventV2::Visible,
            RawInputEvent::WindowFocused,
        ),
    ] {
        compare_current_event(
            &mut host,
            &mut session,
            &mut sequence,
            BrowserRequestV2::Lifecycle { event },
            CurrentExternalEvent::RawInput { input },
        )?;
    }
    Ok(())
}

#[test]
fn rejected_browser_sequence_preserves_state_and_exact_cached_response()
-> Result<(), Box<dyn Error>> {
    let (mut host, sequence) = natural_host()?;
    let accepted_request = er_canonical::canonical_bytes(&BrowserRequestEnvelopeV2 {
        version: BROWSER_WORKER_PROTOCOL_VERSION_V2,
        request_id: safe(100),
        sequence: safe(sequence),
        request: key(PhysicalKey::Space),
    })?;
    let accepted_response = host.process_bytes(&accepted_request)?;
    let before = host.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    let mut expected = host.clone();
    let valid = BrowserRequestEnvelopeV2 {
        version: BROWSER_WORKER_PROTOCOL_VERSION_V2,
        request_id: safe(101),
        sequence: safe(sequence + 1),
        request: BrowserRequestV2::AdvanceTime {
            milliseconds: safe(25),
        },
    };
    let mut wrong_sequence = valid.clone();
    wrong_sequence.sequence = safe(sequence + 2);
    assert!(
        host.process_bytes(&er_canonical::canonical_bytes(&wrong_sequence)?)
            .is_err()
    );
    assert_eq!(
        host.kernel_ref().ok_or("kernel missing")?.snapshot()?,
        before
    );
    assert_eq!(host.process_bytes(&accepted_request)?, accepted_response);
    let valid_bytes = er_canonical::canonical_bytes(&valid)?;
    assert_eq!(
        host.process_bytes(&valid_bytes)?,
        expected.process_bytes(&valid_bytes)?
    );
    let after = host.kernel_ref().ok_or("kernel missing")?.snapshot()?;
    assert!(after.replay_sequence > before.replay_sequence);
    assert_eq!(
        after,
        expected.kernel_ref().ok_or("kernel missing")?.snapshot()?
    );
    assert_eq!(host.process_bytes(&accepted_request)?, accepted_response);
    assert_eq!(
        host.kernel_ref().ok_or("kernel missing")?.snapshot()?,
        after
    );
    Ok(())
}
