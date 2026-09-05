//! Current causal replay through the public recorder and isolated session APIs.

use std::error::Error;
use std::sync::{Arc, OnceLock};

use er_env::current::{CurrentExternalEvent, CurrentGameSession, CurrentSessionError};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, GameKernelStepV7, KernelPresentationOutcomeV2};
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_repro::current::{
    CurrentCaptureStatusV1, CurrentReproBrowserTransportV1, CurrentReproCapsuleV1,
    CurrentReproErrorV1, CurrentReproLimitsV1, CurrentReproOutcomeV1, CurrentReproRecorderV1,
    MAXIMUM_CURRENT_REPRO_BYTES_V1, MAXIMUM_CURRENT_REPRO_EVENTS_V1,
    MAXIMUM_CURRENT_REPRO_POSITION_V1, replay_current_capsule_v1,
};
use er_types::{
    ConnectionGeneration, GameControlKindV2, InputFocus, PhysicalKey, RawInputEvent, SafeU53,
    SeatId,
};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type Captured = (
    Result<GameKernelStepV7, CurrentSessionError>,
    CurrentCaptureStatusV1,
);
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe test integer")
}
fn seat() -> SeatId {
    SeatId::new(safe(1))
}
fn limits() -> CurrentReproLimitsV1 {
    CurrentReproLimitsV1 {
        maximum_events: MAXIMUM_CURRENT_REPRO_EVENTS_V1,
        maximum_bytes: MAXIMUM_CURRENT_REPRO_BYTES_V1,
    }
}
fn time(milliseconds: u64) -> CurrentExternalEvent {
    CurrentExternalEvent::AdvanceTime {
        milliseconds: safe(milliseconds),
    }
}
fn key(code: PhysicalKey, down: bool) -> CurrentExternalEvent {
    CurrentExternalEvent::RawInput {
        input: if down {
            RawInputEvent::KeyDown {
                code,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            }
        } else {
            RawInputEvent::KeyUp { code }
        },
    }
}

fn capture(
    session: &mut CurrentGameSession,
    recorder: &mut CurrentReproRecorderV1,
    event: CurrentExternalEvent,
) -> TestResult<Captured> {
    let before = session.snapshot()?;
    let result = session.apply(event.clone());
    let status = recorder.record(
        &before,
        event,
        result.as_ref(),
        &session.snapshot()?,
        &session.observe()?,
    );
    Ok((result, status))
}

fn apply(
    session: &mut CurrentGameSession,
    recorder: &mut CurrentReproRecorderV1,
    event: CurrentExternalEvent,
) -> TestResult<GameKernelStepV7> {
    let (result, status) = capture(session, recorder, event)?;
    assert!(
        matches!(status, CurrentCaptureStatusV1::Available { .. }),
        "{status:?}"
    );
    Ok(result?)
}

fn press(
    session: &mut CurrentGameSession,
    recorder: &mut CurrentReproRecorderV1,
    code: PhysicalKey,
) -> TestResult {
    apply(session, recorder, key(code.clone(), true))?;
    apply(session, recorder, key(code, false))?;
    Ok(())
}

fn selected(session: &CurrentGameSession) -> TestResult<String> {
    Ok(session
        .observe()?
        .control
        .ok_or("control missing")?
        .menu
        .ok_or("menu missing")?
        .selected_option_id
        .as_str()
        .to_owned())
}

struct Fixture {
    content: Arc<PreparedGameContentV2>,
    active: CoreGameKernelSnapshotV7,
    capsule: CurrentReproCapsuleV1,
    final_snapshot: CoreGameKernelSnapshotV7,
}

fn create_fixture() -> TestResult<Fixture> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let mut session = CurrentGameSession::natural_start(
        serde_json::from_value(serde_json::json!({
            "schema_version": 1, "unlocks": [], "achievements": [], "challenges": [], "flags": [],
            "dex": {"entries": []}, "statistics": {
                "runs_started": 0, "runs_won": 0, "runs_lost": 0, "battles_won": 0,
                "pokemon_captured": 0, "highest_wave": 1
            }
        }))?,
        "m9e-causal-natural".to_owned(),
        seat(),
        vec!["preview-slot".to_owned()],
        true,
        Arc::clone(&content),
        None,
    )?;
    assert_eq!(
        session.observe()?.control.ok_or("title missing")?.kind,
        GameControlKindV2::Title
    );
    let mut recorder = CurrentReproRecorderV1::new(
        session.snapshot()?,
        seat(),
        GameKernelRoleV7::Authority,
        Arc::clone(&content),
        limits(),
    )?;
    for _ in 0..3 {
        press(&mut session, &mut recorder, PhysicalKey::Space)?;
    }
    let bound = session
        .observe()?
        .control
        .ok_or("starter control missing")?
        .menu
        .ok_or("starter menu missing")?
        .options
        .len()
        + 1;
    for _ in 0..bound {
        if selected(&session)? == "bootstrap/starter/confirm" {
            break;
        }
        press(&mut session, &mut recorder, PhysicalKey::ArrowDown)?;
    }
    assert_eq!(selected(&session)?, "bootstrap/starter/confirm");
    for _ in 0..4 {
        press(&mut session, &mut recorder, PhysicalKey::Space)?;
    }
    for pending in session.snapshot()?.pending_presentations {
        apply(
            &mut session,
            &mut recorder,
            CurrentExternalEvent::PresentationOutcome {
                event_id: pending.event_id,
                outcome: KernelPresentationOutcomeV2::Settled,
            },
        )?;
    }
    assert_eq!(selected(&session)?, "battle/command/fight");
    let active = session.snapshot()?;
    apply(
        &mut session,
        &mut recorder,
        key(PhysicalKey::ArrowDown, true),
    )?;
    assert_eq!(selected(&session)?, "battle/command/party");
    assert!(
        apply(&mut session, &mut recorder, time(249))?
            .effects
            .is_empty()
    );
    assert_eq!(selected(&session)?, "battle/command/party");
    assert!(
        !apply(&mut session, &mut recorder, time(1))?
            .effects
            .is_empty()
    );
    assert_eq!(selected(&session)?, "battle/command/fight");
    apply(
        &mut session,
        &mut recorder,
        key(PhysicalKey::ArrowDown, false),
    )?;
    assert!(
        apply(&mut session, &mut recorder, time(500))?
            .effects
            .is_empty()
    );
    assert_eq!(selected(&session)?, "battle/command/fight");
    Ok(Fixture {
        content,
        active,
        capsule: recorder.export()?,
        final_snapshot: session.snapshot()?,
    })
}

fn fixture() -> TestResult<&'static Fixture> {
    static FIXTURE: OnceLock<Result<Fixture, String>> = OnceLock::new();
    FIXTURE
        .get_or_init(|| create_fixture().map_err(|error| error.to_string()))
        .as_ref()
        .map_err(|error| error.clone().into())
}

fn active() -> TestResult<CurrentGameSession> {
    let fixture = fixture()?;
    Ok(CurrentGameSession::from_snapshot(
        fixture.active.clone(),
        seat(),
        GameKernelRoleV7::Authority,
        Arc::clone(&fixture.content),
    )?)
}
fn recorder(
    session: &CurrentGameSession,
    limits: CurrentReproLimitsV1,
) -> TestResult<CurrentReproRecorderV1> {
    Ok(CurrentReproRecorderV1::new(
        session.snapshot()?,
        seat(),
        GameKernelRoleV7::Authority,
        Arc::clone(&fixture()?.content),
        limits,
    )?)
}
fn replay(capsule: &CurrentReproCapsuleV1) -> TestResult<CurrentGameSession> {
    Ok(replay_current_capsule_v1(
        capsule,
        Arc::clone(&fixture()?.content),
        limits(),
    )?)
}

#[test]
fn natural_title_to_battle_held_timer_capsule_replays_full_evidence() -> TestResult {
    let fixture = fixture()?;
    assert_eq!(fixture.capsule.base_position, 0);
    let initial = CurrentGameSession::from_snapshot(
        (*fixture.capsule.checkpoint).clone(),
        seat(),
        GameKernelRoleV7::Authority,
        Arc::clone(&fixture.content),
    )?;
    assert_eq!(
        initial.observe()?.control.ok_or("initial control")?.kind,
        GameControlKindV2::Title
    );
    let encoded = serde_json::to_vec(&fixture.capsule)?;
    let decoded: CurrentReproCapsuleV1 = serde_json::from_slice(&encoded)?;
    let (mut imported_recorder, mut resumed) = CurrentReproRecorderV1::from_capsule(
        decoded.clone(),
        Arc::clone(&fixture.content),
        limits(),
    )?;
    assert_eq!(imported_recorder.export()?, decoded);
    assert_eq!(resumed.snapshot()?, fixture.final_snapshot);
    assert_eq!(selected(&resumed)?, "battle/command/fight");
    assert!(resumed.snapshot()?.scheduler.timers.is_empty());
    assert!(
        apply(&mut resumed, &mut imported_recorder, time(250))?
            .effects
            .is_empty()
    );
    let continued = imported_recorder.export()?;
    assert_eq!(continued.final_position, decoded.final_position + 1);
    assert_eq!(
        &continued.attempts[..decoded.attempts.len()],
        decoded.attempts.as_slice()
    );
    assert_eq!(replay(&continued)?.snapshot()?, resumed.snapshot()?);
    Ok(())
}

#[test]
fn replay_rejects_nonkey_omission_reordering_wrong_content_and_unsafe_positions() -> TestResult {
    let fixture = fixture()?;
    let index = fixture
        .capsule
        .attempts
        .iter()
        .position(|attempt| attempt.event == time(249))
        .ok_or("249ms attempt missing")?;
    let mut omitted = fixture.capsule.clone();
    omitted.attempts.remove(index);
    // Repair the superficial position metadata: causal evidence must still fail.
    for attempt in &mut omitted.attempts[index..] {
        attempt.position -= 1;
    }
    omitted.final_position -= 1;
    assert!(
        matches!(replay_current_capsule_v1(&omitted, Arc::clone(&fixture.content), limits()), Err(CurrentReproErrorV1::Divergence { position, .. }) if position == omitted.attempts[index].position)
    );
    let mut reordered = fixture.capsule.clone();
    reordered.attempts[index].event = time(1);
    reordered.attempts[index + 1].event = time(249);
    assert!(
        matches!(replay_current_capsule_v1(&reordered, Arc::clone(&fixture.content), limits()), Err(CurrentReproErrorV1::Divergence { position, .. }) if position == reordered.attempts[index].position)
    );
    let mut wrong_content = fixture.capsule.clone();
    wrong_content.content_identity.bundle_hash.push('0');
    assert!(
        matches!(replay_current_capsule_v1(&wrong_content, Arc::clone(&fixture.content), limits()), Err(CurrentReproErrorV1::Invalid { field }) if field == "content_identity")
    );
    let mut unsafe_position = fixture.capsule.clone();
    unsafe_position.base_position = MAXIMUM_CURRENT_REPRO_POSITION_V1 + 1;
    assert!(
        matches!(unsafe_position.validate(limits()), Err(CurrentReproErrorV1::Invalid { field }) if field == "unsafe attempt position")
    );
    Ok(())
}

#[test]
fn rejected_attempt_retains_game_frontier_and_replays_valid_retry() -> TestResult {
    let mut session = active()?;
    let mut recorder = recorder(&session, limits())?;
    let before = session.snapshot()?;
    let (result, status) = capture(
        &mut session,
        &mut recorder,
        key(PhysicalKey::ArrowLeft, true),
    )?;
    assert!(result.is_err());
    assert!(matches!(
        status,
        CurrentCaptureStatusV1::Available {
            final_position: 1,
            ..
        }
    ));
    assert_eq!(session.snapshot()?, before);
    assert!(
        !apply(
            &mut session,
            &mut recorder,
            key(PhysicalKey::ArrowDown, true)
        )?
        .effects
        .is_empty()
    );
    apply(&mut session, &mut recorder, time(250))?;
    let mut capsule = recorder.export()?;
    assert_eq!(replay(&capsule)?.snapshot()?, session.snapshot()?);
    let CurrentReproOutcomeV1::KernelRejected { error, .. } = &mut capsule.attempts[0].outcome
    else {
        return Err("missing kernel rejection".into());
    };
    error.message.push('!');
    assert!(matches!(
        replay_current_capsule_v1(&capsule, Arc::clone(&fixture()?.content), limits()),
        Err(CurrentReproErrorV1::Divergence {
            position: 1,
            field: "rejection"
        })
    ));
    Ok(())
}

#[test]
fn count_rotation_retains_checkpoint_before_current_timer_consequence() -> TestResult {
    let mut session = active()?;
    let mut recorder = recorder(
        &session,
        CurrentReproLimitsV1 {
            maximum_events: 2,
            ..limits()
        },
    )?;
    apply(
        &mut session,
        &mut recorder,
        key(PhysicalKey::ArrowDown, true),
    )?;
    apply(&mut session, &mut recorder, time(249))?;
    let before_fire = session.snapshot()?;
    apply(&mut session, &mut recorder, time(1))?;
    let capsule = recorder.export()?;
    assert_eq!((capsule.base_position, capsule.final_position), (2, 3));
    assert_eq!(*capsule.checkpoint, before_fire);
    assert_eq!(capsule.attempts.len(), 1);
    assert_eq!(capsule.attempts[0].event, time(1));
    assert_eq!(replay(&capsule)?.snapshot()?, session.snapshot()?);
    assert_eq!(selected(&session)?, "battle/command/fight");
    let (mut imported, mut resumed) = CurrentReproRecorderV1::from_capsule(
        capsule.clone(),
        Arc::clone(&fixture()?.content),
        CurrentReproLimitsV1 {
            maximum_events: 2,
            ..limits()
        },
    )?;
    assert_eq!(imported.export()?, capsule);
    apply(
        &mut resumed,
        &mut imported,
        key(PhysicalKey::ArrowDown, false),
    )?;
    let before_rotation = resumed.snapshot()?;
    apply(&mut resumed, &mut imported, time(500))?;
    let rotated = imported.export()?;
    assert_eq!((rotated.base_position, rotated.final_position), (4, 5));
    assert_eq!(*rotated.checkpoint, before_rotation);
    assert_eq!(rotated.attempts[0].position, 5);
    assert_eq!(replay(&rotated)?.snapshot()?, resumed.snapshot()?);
    Ok(())
}

#[test]
fn byte_rotation_uses_full_serialized_capsule_bound() -> TestResult {
    let mut probe = active()?;
    let mut probe_recorder = recorder(&probe, limits())?;
    apply(&mut probe, &mut probe_recorder, time(1))?;
    let one = serde_json::to_vec(&probe_recorder.export()?)?.len();
    apply(&mut probe, &mut probe_recorder, time(1))?;
    let two = serde_json::to_vec(&probe_recorder.export()?)?.len();
    assert!(two > one);
    let bounded = CurrentReproLimitsV1 {
        maximum_bytes: one + (two - one) / 2,
        ..limits()
    };
    let mut session = active()?;
    let mut recorder = recorder(&session, bounded)?;
    apply(&mut session, &mut recorder, time(1))?;
    let before_second = session.snapshot()?;
    apply(&mut session, &mut recorder, time(1))?;
    let capsule = recorder.export()?;
    assert_eq!((capsule.base_position, capsule.final_position), (1, 2));
    assert_eq!(*capsule.checkpoint, before_second);
    assert!(serde_json::to_vec(&capsule)?.len() <= bounded.maximum_bytes);
    assert_eq!(
        replay_current_capsule_v1(&capsule, Arc::clone(&fixture()?.content), bounded)?
            .snapshot()?,
        session.snapshot()?
    );
    Ok(())
}

#[test]
fn oversized_attempt_adapter_gap_and_origin_failure_are_explicit_then_recover() -> TestResult {
    let mut session = active()?;
    let baseline = recorder(&session, limits())?.export()?;
    let bounded = CurrentReproLimitsV1 {
        maximum_bytes: serde_json::to_vec(&baseline)?.len() + 4096,
        ..limits()
    };
    let mut recorder = recorder(&session, bounded)?;
    let before = session.snapshot()?;
    let (result, status) = capture(
        &mut session,
        &mut recorder,
        CurrentExternalEvent::ProposalFrame {
            bytes: vec![0; bounded.maximum_bytes],
        },
    )?;
    assert!(result.is_err());
    assert!(matches!(
        status,
        CurrentCaptureStatusV1::Unavailable { position: 1, .. }
    ));
    assert_eq!(session.snapshot()?, before);
    assert!(matches!(
        recorder.export(),
        Err(CurrentReproErrorV1::Unavailable { position: 1, .. })
    ));
    apply(&mut session, &mut recorder, time(1))?;
    let recovered = recorder.export()?;
    assert_eq!((recovered.base_position, recovered.final_position), (1, 2));
    assert_eq!(replay(&recovered)?.snapshot()?, session.snapshot()?);
    assert!(matches!(
        recorder.invalidate_attempt("browser response budget rejected completion"),
        CurrentCaptureStatusV1::Unavailable { position: 3, .. }
    ));
    assert!(recorder.export().is_err());
    let before = session.snapshot()?;
    let event = time(1);
    let result = session.apply(event.clone());
    let status = recorder.record_with_origin(
        &before,
        event,
        result.as_ref(),
        &session.snapshot()?,
        &session.observe()?,
        Some(&"x".repeat(129)),
    );
    assert!(result.is_ok());
    assert_ne!(session.snapshot()?, before);
    assert!(matches!(
        status,
        CurrentCaptureStatusV1::Unavailable { position: 4, .. }
    ));
    assert!(recorder.export().is_err());
    let before = session.snapshot()?;
    let event = CurrentExternalEvent::RawInput {
        input: RawInputEvent::WindowBlurred,
    };
    let result = session.apply(event.clone());
    assert!(result.is_ok());
    let status = recorder.record_with_origin(
        &before,
        event,
        result.as_ref(),
        &session.snapshot()?,
        &session.observe()?,
        Some("browser.lifecycle.HIDDEN"),
    );
    assert!(matches!(
        status,
        CurrentCaptureStatusV1::Available {
            base_position: 4,
            final_position: 5
        }
    ));
    let capsule = recorder.export()?;
    assert_eq!(
        capsule.attempts[0].origin.as_deref(),
        Some("browser.lifecycle.HIDDEN")
    );
    assert_eq!(replay(&capsule)?.snapshot()?, session.snapshot()?);
    let (imported, _) = CurrentReproRecorderV1::from_capsule(
        capsule.clone(),
        Arc::clone(&fixture()?.content),
        bounded,
    )?;
    assert_eq!(imported.export()?, capsule);
    Ok(())
}

#[test]
fn broken_capture_continuity_cannot_export_a_false_complete_tail() -> TestResult {
    let mut session = active()?;
    let mut recorder = recorder(&session, limits())?;
    // An unrecorded accepted event creates a detectable hole in state continuity.
    session.apply(time(1))?;
    let (_, status) = capture(&mut session, &mut recorder, time(1))?;
    assert!(matches!(
        status,
        CurrentCaptureStatusV1::Unavailable { position: 1, .. }
    ));
    assert!(recorder.export().is_err());
    apply(&mut session, &mut recorder, time(1))?;
    let capsule = recorder.export()?;
    assert_eq!((capsule.base_position, capsule.final_position), (1, 2));
    assert_eq!(replay(&capsule)?.snapshot()?, session.snapshot()?);
    let mut exhausted = CurrentReproRecorderV1::new(
        session.snapshot()?,
        seat(),
        GameKernelRoleV7::Authority,
        Arc::clone(&fixture()?.content),
        limits(),
    )?
    .export()?;
    exhausted.base_position = MAXIMUM_CURRENT_REPRO_POSITION_V1;
    exhausted.final_position = MAXIMUM_CURRENT_REPRO_POSITION_V1;
    let (mut recorder, mut session) =
        CurrentReproRecorderV1::from_capsule(exhausted, Arc::clone(&fixture()?.content), limits())?;
    let before = session.snapshot()?;
    let (result, status) = capture(&mut session, &mut recorder, time(1))?;
    assert!(result.is_ok());
    assert_ne!(session.snapshot()?, before);
    assert!(matches!(
        status,
        CurrentCaptureStatusV1::Unavailable {
            position: MAXIMUM_CURRENT_REPRO_POSITION_V1,
            ..
        }
    ));
    assert!(recorder.export().is_err());
    Ok(())
}

fn browser_capture(
    session: &mut CurrentGameSession,
    recorder: &mut CurrentReproRecorderV1,
    event: CurrentExternalEvent,
    before_generation: u64,
    after_generation: u64,
) -> TestResult<Captured> {
    let before = session.snapshot()?;
    let result = session.apply(event.clone());
    let status = recorder.record_with_browser_transport(
        &before,
        event,
        result.as_ref(),
        &session.snapshot()?,
        &session.observe()?,
        Some("browser.test"),
        safe(before_generation),
        safe(after_generation),
    );
    Ok((result, status))
}

#[test]
fn browser_generation_survives_rotation_import_and_kernel_rejections_without_protocol() -> TestResult
{
    let mut session = active()?;
    assert!(session.snapshot()?.protocol.is_none());
    let bounded = CurrentReproLimitsV1 {
        maximum_events: 2,
        ..limits()
    };
    let mut recorder = CurrentReproRecorderV1::new_with_browser_transport(
        session.snapshot()?,
        seat(),
        GameKernelRoleV7::Authority,
        Arc::clone(&fixture()?.content),
        bounded,
        safe(7),
    )?;
    for milliseconds in [1, 2, 3] {
        let (result, status) =
            browser_capture(&mut session, &mut recorder, time(milliseconds), 7, 7)?;
        assert!(result.is_ok());
        assert!(matches!(status, CurrentCaptureStatusV1::Available { .. }));
    }
    let capsule = recorder.export()?;
    assert_eq!((capsule.base_position, capsule.final_position), (2, 3));
    assert_eq!(
        capsule.browser_transport,
        Some(CurrentReproBrowserTransportV1 {
            base_generation: safe(7),
            final_generation: safe(7)
        })
    );
    assert_eq!(
        capsule.attempts[0]
            .browser_transport
            .expect("browser attempt context")
            .before_generation,
        safe(7)
    );
    let (mut recorder, mut resumed) = CurrentReproRecorderV1::from_capsule(
        capsule.clone(),
        Arc::clone(&fixture()?.content),
        bounded,
    )?;
    assert_eq!(recorder.export()?, capsule);
    let before = resumed.snapshot()?;
    let (result, status) = browser_capture(
        &mut resumed,
        &mut recorder,
        CurrentExternalEvent::TransportChanged {
            generation: ConnectionGeneration::new(safe(9)),
            connected: true,
        },
        7,
        7,
    )?;
    assert!(result.is_err());
    assert!(matches!(
        status,
        CurrentCaptureStatusV1::Available {
            final_position: 4,
            ..
        }
    ));
    assert_eq!(resumed.snapshot()?, before);
    assert_eq!(
        recorder
            .export()?
            .browser_transport
            .expect("browser context")
            .final_generation,
        safe(7)
    );
    let (result, status) = browser_capture(
        &mut resumed,
        &mut recorder,
        CurrentExternalEvent::NetworkFrame {
            generation: ConnectionGeneration::new(safe(7)),
            bytes: Vec::new(),
        },
        7,
        7,
    )?;
    assert!(result.is_err());
    assert!(matches!(
        status,
        CurrentCaptureStatusV1::Available {
            base_position: 4,
            final_position: 5
        }
    ));
    assert_eq!(
        replay(&recorder.export()?)?.snapshot()?,
        resumed.snapshot()?
    );
    // Accidentally using the native wrapper cannot silently discard host context.
    let (result, status) = capture(&mut resumed, &mut recorder, time(1))?;
    assert!(result.is_ok());
    assert!(matches!(
        status,
        CurrentCaptureStatusV1::Unavailable { position: 6, .. }
    ));
    assert!(recorder.export().is_err());
    let (result, status) = browser_capture(&mut resumed, &mut recorder, time(1), 7, 7)?;
    assert!(result.is_ok());
    assert!(matches!(
        status,
        CurrentCaptureStatusV1::Available {
            base_position: 6,
            final_position: 7
        }
    ));
    assert_eq!(
        recorder
            .export()?
            .browser_transport
            .expect("recovered context")
            .base_generation,
        safe(7)
    );
    Ok(())
}

#[test]
fn browser_transport_validation_checks_admission_continuity_and_outcome_separately() -> TestResult {
    let mut session = active()?;
    let mut recorder = CurrentReproRecorderV1::new_with_browser_transport(
        session.snapshot()?,
        seat(),
        GameKernelRoleV7::Authority,
        Arc::clone(&fixture()?.content),
        limits(),
        safe(7),
    )?;
    let (result, status) = browser_capture(
        &mut session,
        &mut recorder,
        CurrentExternalEvent::NetworkFrame {
            generation: ConnectionGeneration::new(safe(7)),
            bytes: Vec::new(),
        },
        7,
        7,
    )?;
    assert!(result.is_err());
    assert!(matches!(status, CurrentCaptureStatusV1::Available { .. }));
    let valid = recorder.export()?;
    valid.validate(limits())?;
    assert_eq!(replay(&valid)?.snapshot()?, session.snapshot()?);
    let mut wrong_frame = valid.clone();
    wrong_frame.attempts[0].event = CurrentExternalEvent::NetworkFrame {
        generation: ConnectionGeneration::new(safe(6)),
        bytes: Vec::new(),
    };
    assert!(matches!(
        wrong_frame.validate(limits()),
        Err(CurrentReproErrorV1::Divergence {
            position: 1,
            field: "browser transport"
        })
    ));
    let mut wrong_before = valid.clone();
    wrong_before.attempts[0]
        .browser_transport
        .as_mut()
        .ok_or("attempt context")?
        .before_generation = safe(6);
    assert!(wrong_before.validate(limits()).is_err());
    let mut missing = valid.clone();
    missing.attempts[0].browser_transport = None;
    assert!(missing.validate(limits()).is_err());
    let mut wrong_final = valid.clone();
    wrong_final
        .browser_transport
        .as_mut()
        .ok_or("capsule context")?
        .final_generation = safe(8);
    assert!(matches!(
        wrong_final.validate(limits()),
        Err(CurrentReproErrorV1::Divergence {
            position: 1,
            field: "final browser generation"
        })
    ));
    let mut backwards = valid.clone();
    backwards.attempts[0].event = CurrentExternalEvent::TransportChanged {
        generation: ConnectionGeneration::new(safe(6)),
        connected: true,
    };
    assert!(backwards.validate(limits()).is_err());
    let mut false_applied = valid;
    let CurrentReproOutcomeV1::KernelRejected {
        observation,
        snapshot_digest,
        ..
    } = &false_applied.attempts[0].outcome
    else {
        return Err("rejection missing".into());
    };
    false_applied.attempts[0].outcome = CurrentReproOutcomeV1::Applied {
        step: Box::new(GameKernelStepV7::default()),
        observation: observation.clone(),
        snapshot_digest: snapshot_digest.clone(),
    };
    false_applied.attempts[0].event = CurrentExternalEvent::TransportChanged {
        generation: ConnectionGeneration::new(safe(9)),
        connected: true,
    };
    false_applied.attempts[0]
        .browser_transport
        .as_mut()
        .ok_or("attempt context")?
        .after_generation = safe(9);
    false_applied
        .browser_transport
        .as_mut()
        .ok_or("capsule context")?
        .final_generation = safe(9);
    // Valid adapter reduction metadata cannot substitute for kernel evidence:
    // this session has no protocol, so its alleged successful rebind is false.
    false_applied.validate(limits())?;
    assert!(matches!(
        replay_current_capsule_v1(&false_applied, Arc::clone(&fixture()?.content), limits()),
        Err(CurrentReproErrorV1::Divergence {
            position: 1,
            field: "outcome"
        })
    ));
    false_applied.attempts[0]
        .browser_transport
        .as_mut()
        .ok_or("attempt context")?
        .after_generation = safe(8);
    false_applied
        .browser_transport
        .as_mut()
        .ok_or("capsule context")?
        .final_generation = safe(8);
    assert!(false_applied.validate(limits()).is_err());
    Ok(())
}
