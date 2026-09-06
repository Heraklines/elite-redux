//! Native current host ingress and typed storage callbacks; no browser adapter drain claim.
use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, KernelStorageResultV2};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{SafeU53, SeatId};
use er_web::contracts_v2::{
    BROWSER_WORKER_PROTOCOL_VERSION_V2, BrowserEffectV2, BrowserRequestEnvelopeV2,
    BrowserRequestV2, BrowserResponseEnvelopeV2, BrowserResponseV2, BrowserSessionContextV2,
    BrowserSessionInitializationV2, BrowserStorageRequestKindV2, BrowserStorageResultV2,
};
use er_web::host_v2::BrowserKernelHostV2;
use std::error::Error;
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
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

fn initialization(enabled: bool) -> Result<BrowserSessionInitializationV2, Box<dyn Error>> {
    Ok(BrowserSessionInitializationV2::NaturalStart {
        context: context(),
        profile: profile()?,
        seed: "title-host".to_owned(),
        save_slots: vec!["preview-slot".to_owned()],
        local_is_host: true,
        existing_saves: enabled,
    })
}
fn direct(enabled: bool) -> Result<CurrentGameSession, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = std::sync::Arc::new(PreparedGameContentV2::prepare(std::sync::Arc::new(bundle))?);
    let mut session = CurrentGameSession::natural_start(
        profile()?,
        "title-host".to_owned(),
        SeatId::new(safe(1)),
        vec!["preview-slot".to_owned()],
        true,
        content,
        None,
    )?;
    if enabled {
        session.enable_current_title_storage()?;
    }
    Ok(session)
}
fn full_snapshot(
    host: &mut BrowserKernelHostV2,
    sequence: &mut u64,
) -> Result<CoreGameKernelSnapshotV7, Box<dyn Error>> {
    let response = send(host, *sequence, BrowserRequestV2::Snapshot)?;
    *sequence += 1;
    let BrowserResponseV2::Snapshot { snapshot } = response else {
        return Err("snapshot absent".into());
    };
    Ok(*snapshot)
}
fn storage(
    response: BrowserResponseV2,
    kind: BrowserStorageRequestKindV2,
) -> Result<er_web::contracts_v2::BrowserStorageRequestV2, Box<dyn Error>> {
    let BrowserResponseV2::Effects { batch } = response else {
        return Err("effects absent".into());
    };
    let requests = batch
        .effects
        .into_iter()
        .filter_map(|effect| match effect {
            BrowserEffectV2::StorageRequest { request } => Some(request),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].kind, kind);
    Ok(requests[0].clone())
}
#[test]
fn current_host_title_ingress_emits_typed_list_read_missing_and_cancel()
-> Result<(), Box<dyn Error>> {
    let mut host = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    let mut session = direct(true)?;
    assert_eq!(
        send(
            &mut host,
            0,
            BrowserRequestV2::Initialize {
                initialization: Box::new(initialization(true)?)
            }
        )?,
        BrowserResponseV2::Ready
    );
    let mut sequence = 1;
    assert_eq!(
        full_snapshot(&mut host, &mut sequence)?,
        session.snapshot()?
    );
    for code in [PhysicalKey::ArrowDown, PhysicalKey::Space] {
        let response = press(&mut host, &mut sequence, code.clone())?;
        for input in [
            RawInputEvent::KeyDown {
                code: code.clone(),
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
            RawInputEvent::KeyUp { code: code.clone() },
        ] {
            session.apply(CurrentExternalEvent::RawInput { input })?;
        }
        if code == PhysicalKey::Space {
            let list = storage(response, BrowserStorageRequestKindV2::List)?;
            assert_eq!(
                list.request_id,
                session.snapshot()?.pending_platform[0].request_id
            );
            assert!(list.slot.is_none() && list.generation.is_none() && list.bytes.is_empty());
        }
        assert_eq!(
            full_snapshot(&mut host, &mut sequence)?,
            session.snapshot()?
        );
    }
    let request_id = session.snapshot()?.pending_platform[0].request_id;
    let result = BrowserStorageResultV2::Slots {
        slots: vec!["actual-slot".to_owned()],
    };
    send(
        &mut host,
        sequence,
        BrowserRequestV2::StorageResult { request_id, result },
    )?;
    sequence += 1;
    session.apply(CurrentExternalEvent::StorageResult {
        request_id,
        result: KernelStorageResultV2::Slots {
            slots: vec!["actual-slot".to_owned()],
        },
    })?;
    assert_eq!(
        full_snapshot(&mut host, &mut sequence)?,
        session.snapshot()?
    );
    let read = storage(
        press(&mut host, &mut sequence, PhysicalKey::Space)?,
        BrowserStorageRequestKindV2::Read,
    )?;
    for input in [
        RawInputEvent::KeyDown {
            code: PhysicalKey::Space,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::KeyUp {
            code: PhysicalKey::Space,
        },
    ] {
        session.apply(CurrentExternalEvent::RawInput { input })?;
    }
    assert_eq!(read.slot.as_deref(), Some("actual-slot"));
    assert!(read.request_id > request_id && read.generation.is_none() && read.bytes.is_empty());
    assert_eq!(
        full_snapshot(&mut host, &mut sequence)?,
        session.snapshot()?
    );
    send(
        &mut host,
        sequence,
        BrowserRequestV2::StorageResult {
            request_id: read.request_id,
            result: BrowserStorageResultV2::Read { bytes: None },
        },
    )?;
    sequence += 1;
    session.apply(CurrentExternalEvent::StorageResult {
        request_id: read.request_id,
        result: KernelStorageResultV2::Read { bytes: None },
    })?;
    assert_eq!(
        full_snapshot(&mut host, &mut sequence)?,
        session.snapshot()?
    );
    press(&mut host, &mut sequence, PhysicalKey::Escape)?;
    for input in [
        RawInputEvent::KeyDown {
            code: PhysicalKey::Escape,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::KeyUp {
            code: PhysicalKey::Escape,
        },
    ] {
        session.apply(CurrentExternalEvent::RawInput { input })?;
    }
    assert_eq!(
        full_snapshot(&mut host, &mut sequence)?,
        session.snapshot()?
    );
    Ok(())
}
#[test]
fn current_host_default_wire_omits_opt_in_and_non_authority_is_rejected()
-> Result<(), Box<dyn Error>> {
    let old = initialization(false)?;
    let value = serde_json::to_value(&old)?;
    assert!(value.get("existing_saves").is_none());
    assert_eq!(
        serde_json::from_value::<BrowserSessionInitializationV2>(value)?,
        old
    );
    let mut host = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
    assert_eq!(
        send(
            &mut host,
            0,
            BrowserRequestV2::Initialize {
                initialization: Box::new(old)
            }
        )?,
        BrowserResponseV2::Ready
    );
    let mut sequence = 1;
    assert_eq!(
        full_snapshot(&mut host, &mut sequence)?,
        direct(false)?.snapshot()?
    );
    for role in [GameKernelRoleV7::Replica, GameKernelRoleV7::Authority] {
        let mut init = initialization(true)?;
        let BrowserSessionInitializationV2::NaturalStart {
            context,
            local_is_host,
            ..
        } = &mut init
        else {
            return Err("wrong init".into());
        };
        context.role = role;
        if role == GameKernelRoleV7::Authority {
            *local_is_host = false;
        }
        let mut host = BrowserKernelHostV2::from_bundle_bytes(BUNDLE)?;
        assert!(
            send(
                &mut host,
                0,
                BrowserRequestV2::Initialize {
                    initialization: Box::new(init)
                }
            )
            .is_err()
        );
        assert_eq!(
            send(
                &mut host,
                0,
                BrowserRequestV2::Initialize {
                    initialization: Box::new(initialization(true)?)
                }
            )?,
            BrowserResponseV2::Ready
        );
        let mut sequence = 1;
        assert_eq!(
            full_snapshot(&mut host, &mut sequence)?,
            direct(true)?.snapshot()?
        );
    }
    Ok(())
}
