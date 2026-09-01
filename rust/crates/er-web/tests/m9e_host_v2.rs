use std::error::Error;

use er_game::m7_progression_control::generic_vertical_control_v2;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, GameKernelV7};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
    SCENARIO_RUNTIME_SCHEMA_VERSION_V1, ScenarioRuntimeStateV1,
};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::battle_model::BattleOutcome;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{
    GameActionV1, GameControlKindV2, GameMenuCancelV2, OperationId, SafeU53, SaveActionV1,
    ScenarioId, SeatId, TerminalActionV1,
};
use er_web::contracts_v2::{
    BROWSER_WORKER_PROTOCOL_VERSION_V2, BrowserEffectV2, BrowserRequestEnvelopeV2,
    BrowserRequestV2, BrowserResponseEnvelopeV2, BrowserResponseV2, BrowserSessionContextV2,
    BrowserSessionInitializationV2,
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
            next_timer_id: None,
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        protocol: None,
    }
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
            initialization: BrowserSessionInitializationV2::NaturalStart {
                context: context(),
                profile: profile()?,
                seed: "browser-v2-natural".to_owned(),
                save_slots: vec!["preview-slot".to_owned()],
                local_is_host: true,
            },
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
            BrowserRequestV2::Initialize { initialization },
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
    state.active_run.as_mut().ok_or("run missing")?.scenario = Some(ScenarioRuntimeStateV1 {
        schema_version: SCENARIO_RUNTIME_SCHEMA_VERSION_V1,
        scenario: scenario_id,
        node: entry,
        flags: Default::default(),
        visit_count: SafeU53::ZERO,
    });
    let mut scenario_host = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    assert!(matches!(
        send(
            &mut scenario_host,
            0,
            BrowserRequestV2::Initialize {
                initialization: BrowserSessionInitializationV2::Scenario {
                    context: context(),
                    snapshot: scenario_snapshot,
                    scenario: scenario_id,
                },
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
        [BrowserEffectV2::ReproReady { .. }]
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
            initialization: BrowserSessionInitializationV2::ExistingSave {
                context: context(),
                save,
            },
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
            initialization: BrowserSessionInitializationV2::Snapshot {
                context: context(),
                snapshot: terminal_snapshot,
            },
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
