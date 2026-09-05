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

fn setup_press(session: &mut CurrentGameSession, code: PhysicalKey) -> TestResult {
    session.apply(key(code.clone(), true))?;
    session.apply(key(code, false))?;
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
    title_capsule: CurrentReproCapsuleV1,
    title_final_snapshot: CoreGameKernelSnapshotV7,
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
    press(&mut session, &mut recorder, PhysicalKey::Space)?;
    assert_eq!(
        session.observe()?.control.ok_or("mode missing")?.kind,
        GameControlKindV2::ModeSelect
    );
    let title_capsule = recorder.export()?;
    let title_final_snapshot = session.snapshot()?;
    drop(recorder);

    // Traverse the catalog using real inputs as setup, outside either capture.
    // A bounded recorder need not retain this entire bootstrap traversal.
    for _ in 0..2 {
        setup_press(&mut session, PhysicalKey::Space)?;
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
        setup_press(&mut session, PhysicalKey::ArrowDown)?;
    }
    assert_eq!(selected(&session)?, "bootstrap/starter/confirm");
    for _ in 0..4 {
        setup_press(&mut session, PhysicalKey::Space)?;
    }
    for pending in session.snapshot()?.pending_presentations {
        session.apply(CurrentExternalEvent::PresentationOutcome {
            event_id: pending.event_id,
            outcome: KernelPresentationOutcomeV2::Settled,
        })?;
    }
    assert_eq!(
        session.observe()?.control.ok_or("active control missing")?.kind,
        GameControlKindV2::BattleCommand
    );
    assert_eq!(selected(&session)?, "battle/command/fight");
    let active = session.snapshot()?;
    // This is a new, explicit active checkpoint, not a claim that the Title
    // capture retained the intervening catalog traversal.
    let mut recorder = CurrentReproRecorderV1::new(
        active.clone(),
        seat(),
        GameKernelRoleV7::Authority,
        Arc::clone(&content),
        limits(),
    )?;
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
        title_capsule,
        title_final_snapshot,
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
    assert_eq!(fixture.title_capsule.base_position, 0);
    assert_eq!(fixture.title_capsule.final_position, 2);
    assert_eq!(fixture.title_capsule.attempts.len(), 2);
    let initial = CurrentGameSession::from_snapshot(
        (*fixture.title_capsule.checkpoint).clone(),
        seat(),
        GameKernelRoleV7::Authority,
        Arc::clone(&fixture.content),
    )?;
    assert_eq!(
        initial.observe()?.control.ok_or("initial control")?.kind,
        GameControlKindV2::Title
    );
    let title_encoded = serde_json::to_vec(&fixture.title_capsule)?;
    let title_decoded: CurrentReproCapsuleV1 = serde_json::from_slice(&title_encoded)?;
    let title_replayed = replay(&title_decoded)?;
    assert_eq!(title_replayed.snapshot()?, fixture.title_final_snapshot);
    assert_eq!(
        title_replayed.observe()?.control.ok_or("mode control")?.kind,
        GameControlKindV2::ModeSelect
    );

    assert_eq!(fixture.capsule.base_position, 0);
    assert_eq!(fixture.capsule.final_position, 5);
    assert_eq!(*fixture.capsule.checkpoint, fixture.active);
    assert_eq!(
        active()?.observe()?.control.ok_or("active control")?.kind,
        GameControlKindV2::BattleCommand
    );
    assert_eq!(
        fixture
            .capsule
            .attempts
            .iter()
            .map(|attempt| attempt.event.clone())
            .collect::<Vec<_>>(),
        vec![
            key(PhysicalKey::ArrowDown, true),
            time(249),
            time(1),
            key(PhysicalKey::ArrowDown, false),
            time(500),
        ]
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
    wrong_content.content_identity.bundle_hash =
        er_types::GameContentBundleHash::parse(format!("blake3-v1:{}", "0".repeat(64)))?;
    assert_ne!(
        wrong_content.content_identity,
        fixture.capsule.content_identity
    );
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
    exact_incremental_capsule_byte_boundaries()?;
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

const ACCOUNTING_ORIGIN: &str = r#"accounting "quoted" \ café 😀"#;

fn accounting_capture(
    session: &mut CurrentGameSession,
    recorder: &mut CurrentReproRecorderV1,
    event: CurrentExternalEvent,
    generation: Option<u64>,
) -> TestResult<Captured> {
    let before = session.snapshot()?;
    let result = session.apply(event.clone());
    let after = session.snapshot()?;
    let observation = session.observe()?;
    let status = match generation {
        Some(generation) => recorder.record_with_browser_transport(&before, event, result.as_ref(),
            &after, &observation, Some(ACCOUNTING_ORIGIN), safe(generation), safe(generation)),
        None => recorder.record_with_origin(&before, event, result.as_ref(), &after, &observation,
            Some(ACCOUNTING_ORIGIN)),
    };
    Ok((result, status))
}

fn accounting_imported_frontier(frontier: u64, generation: Option<u64>) -> TestResult<CurrentReproCapsuleV1> {
    let session = active()?;
    let recorder = match generation {
        Some(generation) => CurrentReproRecorderV1::new_with_browser_transport(
            session.snapshot()?, seat(), GameKernelRoleV7::Authority,
            Arc::clone(&fixture()?.content), limits(), safe(generation))?,
        None => recorder(&session, limits())?,
    };
    // A restored suffix can begin at any safe absolute frontier. No fabricated
    // gameplay history is inserted; replay validates this empty checkpoint.
    let mut checkpoint = recorder.export()?;
    checkpoint.base_position = frontier - 1;
    checkpoint.final_position = frontier - 1;
    let (mut recorder, mut session) = CurrentReproRecorderV1::from_capsule(
        checkpoint, Arc::clone(&fixture()?.content), limits())?;
    let (result, status) = accounting_capture(&mut session, &mut recorder, time(1), generation)?;
    assert!(result.is_ok());
    assert!(matches!(status, CurrentCaptureStatusV1::Available { .. }));
    let capsule = recorder.export()?;
    assert_eq!(capsule.final_position, frontier);
    assert_eq!(capsule.attempts.len(), 1);
    Ok(capsule)
}

fn exact_incremental_capsule_byte_boundaries() -> TestResult {
    // Independent complete serde encoding is the oracle. Cases straddle both
    // 9->10 and 99->100 absolute positions, native and browser contexts, one- and
    // two-digit browser generations, and accepted versus rejected attempts.
    for (frontier, generation, rejected) in [
        (9, None, false), (99, None, true), (9, Some(9), false),
        (99, Some(9), true), (9, Some(10), true), (99, Some(10), false),
    ] {
        let baseline = accounting_imported_frontier(frontier, generation)?;
        let event = if rejected { CurrentExternalEvent::ProposalFrame { bytes: vec![255] } } else { time(1) };
        let (mut probe, mut session) = CurrentReproRecorderV1::from_capsule(
            baseline.clone(), Arc::clone(&fixture()?.content), limits())?;
        let (result, status) = accounting_capture(&mut session, &mut probe, event.clone(), generation)?;
        assert_eq!(result.is_err(), rejected);
        assert!(matches!(status, CurrentCaptureStatusV1::Available { .. }));
        let expected = probe.export()?;
        let expected_snapshot = session.snapshot()?;
        let bytes = serde_json::to_vec(&expected)?.len();
        assert_eq!(expected.final_position, frontier + 1);
        assert_eq!(expected.attempts.len(), 2);
        assert!(expected.attempts.iter().all(|attempt| attempt.origin.as_deref() == Some(ACCOUNTING_ORIGIN)));
        assert!(serde_json::to_vec(&baseline)?.len() < bytes);

        for exact in [true, false] {
            let bounded = CurrentReproLimitsV1 { maximum_bytes: bytes - usize::from(!exact), ..limits() };
            let (mut recorder, mut resumed) = CurrentReproRecorderV1::from_capsule(
                baseline.clone(), Arc::clone(&fixture()?.content), bounded)?;
            let before = resumed.snapshot()?;
            let (result, status) = accounting_capture(&mut resumed, &mut recorder, event.clone(), generation)?;
            assert_eq!(result.is_err(), rejected);
            assert!(matches!(status, CurrentCaptureStatusV1::Available { .. }));
            let actual = recorder.export()?;
            assert!(serde_json::to_vec(&actual)?.len() <= bounded.maximum_bytes);
            if exact {
                assert_eq!(actual, expected, "exact byte fit must preserve both retained attempts");
            } else {
                assert_eq!((actual.base_position, actual.final_position), (frontier, frontier + 1));
                assert_eq!(actual.attempts.len(), 1, "one-byte overflow must rotate, not publish the old tail");
                assert_eq!(*actual.checkpoint, before);
                assert_eq!(actual.attempts[0], expected.attempts[1]);
            }
            assert_eq!(resumed.snapshot()?, expected_snapshot);
            let replayed = replay_current_capsule_v1(&actual, Arc::clone(&fixture()?.content), bounded)?;
            assert_eq!(replayed.snapshot()?, expected_snapshot);
            // Import the rotated or exact tail again, then append: this catches
            // stale imported caches and commas counted against an empty array.
            let (mut imported, mut continued) = CurrentReproRecorderV1::from_capsule(
                actual, Arc::clone(&fixture()?.content), bounded)?;
            let (result, status) = accounting_capture(&mut continued, &mut imported, time(1), generation)?;
            assert!(result.is_ok());
            assert!(matches!(status, CurrentCaptureStatusV1::Available { .. }));
            let tail = imported.export()?;
            assert!(serde_json::to_vec(&tail)?.len() <= bounded.maximum_bytes);
            assert_eq!(replay_current_capsule_v1(&tail, Arc::clone(&fixture()?.content), bounded)?.snapshot()?,
                continued.snapshot()?);
        }
    }

    // A browser adapter gap may recover at a new host generation. Test the
    // concrete 9->10 digit-width change without inventing a successful kernel
    // TransportChanged operation for this no-protocol fixture.
    let previous = accounting_imported_frontier(99, Some(9))?;
    let (mut recorder, mut session) = CurrentReproRecorderV1::from_capsule(
        previous, Arc::clone(&fixture()?.content), limits())?;
    assert!(matches!(recorder.invalidate_attempt("adapter generation changed across capture gap"),
        CurrentCaptureStatusV1::Unavailable { position: 100, .. }));
    assert!(recorder.export().is_err());
    let (result, status) = browser_capture(&mut session, &mut recorder, time(1), 10, 10)?;
    assert!(result.is_ok());
    assert!(matches!(status, CurrentCaptureStatusV1::Available { base_position: 100, final_position: 101 }));
    let recovered = recorder.export()?;
    assert_eq!(recovered.browser_transport, Some(CurrentReproBrowserTransportV1 {
        base_generation: safe(10), final_generation: safe(10) }));
    let (mut probe, mut continued) = CurrentReproRecorderV1::from_capsule(
        recovered.clone(), Arc::clone(&fixture()?.content),
        CurrentReproLimitsV1 { maximum_events: 1, ..limits() })?;
    let (result, status) = browser_capture(&mut continued, &mut probe, time(1), 10, 10)?;
    assert!(result.is_ok());
    assert!(matches!(status, CurrentCaptureStatusV1::Available { .. }));
    let expected_rotated = probe.export()?;
    let exact = CurrentReproLimitsV1 { maximum_bytes: serde_json::to_vec(&recovered)?.len()
        .max(serde_json::to_vec(&expected_rotated)?.len()), ..limits() };
    let (mut imported, mut resumed) = CurrentReproRecorderV1::from_capsule(
        recovered, Arc::clone(&fixture()?.content), exact)?;
    let (result, status) = browser_capture(&mut resumed, &mut imported, time(1), 10, 10)?;
    assert!(result.is_ok());
    assert!(matches!(status, CurrentCaptureStatusV1::Available { .. }));
    let rotated = imported.export()?;
    assert_eq!(rotated, expected_rotated);
    assert_eq!(rotated.attempts.len(), 1);
    assert_eq!((rotated.base_position, rotated.final_position), (101, 102));
    assert!(serde_json::to_vec(&rotated)?.len() <= exact.maximum_bytes);
    assert_eq!(replay_current_capsule_v1(&rotated, Arc::clone(&fixture()?.content), exact)?.snapshot()?, resumed.snapshot()?);
    Ok(())
}
