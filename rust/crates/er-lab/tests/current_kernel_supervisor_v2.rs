use std::error::Error;
use std::path::PathBuf;
use std::sync::Arc;

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, KernelPresentationOutcomeV2};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1,
    KernelSessionIdV1, KernelWorkerFaultCodeV2, KernelWorkerInitializationV2,
    KernelWorkerResponseEnvelopeV2, KernelWorkerResponseV2, MAXIMUM_WORKER_FRAME_BYTES_V2,
};
use er_lab::kernel_reload::{
    ChildKernelGenerationV2, CurrentDispatchV2, CurrentGenerationStepV2, CurrentKernelSupervisorV2,
    CurrentReloadErrorV2, CurrentTailLimitsV2, CurrentTraceRetentionV2, KernelEndpointErrorV2,
    KernelWorkerDeadlinesV2, VerifiedKernelExecutableV2,
};
use er_state::m7_state::ProfileStateV1;
use er_types::{
    GameControlKindV2, InputFocus, PhysicalKey, PresentationEventId, RawInputEvent, SafeU53, SeatId,
};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");
const SEED: &str = "current-supervisor";

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe test value")
}
fn seat() -> SeatId {
    SeatId::new(safe(1))
}

fn profile() -> Result<ProfileStateV1, Box<dyn Error>> {
    Ok(serde_json::from_value(serde_json::json!({
        "schema_version": 1, "unlocks": [], "achievements": [], "challenges": [], "flags": [],
        "statistics": {
            "runs_started": 0, "runs_won": 0, "runs_lost": 0, "battles_won": 0,
            "pokemon_captured": 0, "highest_wave": 1
        }, "dex": {"entries": []}
    }))?)
}

fn natural() -> Result<KernelWorkerInitializationV2, Box<dyn Error>> {
    Ok(KernelWorkerInitializationV2::Natural {
        profile: Box::new(profile()?),
        seed: SEED.to_owned(),
        local_seat: seat(),
        save_slots: vec!["preview-slot".to_owned()],
        local_is_host: true,
        scheduler: KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        protocol: Box::new(None),
    })
}

fn fixture() -> Result<(GameContentBundleV2, VerifiedKernelExecutableV2), Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?;
    let executable = PathBuf::from(std::env::var("ER_M9E_WORKER_EXECUTABLE")?);
    let digest = std::env::var("ER_M9E_WORKER_EXECUTABLE_SHA256")?;
    let identity = KernelGenerationIdentityV2 {
        schema_version: 2,
        session_id: KernelSessionIdV1("current-supervisor".to_owned()),
        generation: KernelGenerationV1(1),
        artifact_sha256: digest.clone(),
        executable_sha256: digest,
        source_git_sha: std::env::var("ER_M9E_WORKER_SOURCE_SHA")?,
        worker_abi_version: KERNEL_WORKER_ABI_VERSION_V2,
        minimum_snapshot_schema: 7,
        maximum_snapshot_schema: 7,
        content_identity: content.identity().clone(),
        build_target: std::env::var("ER_M9E_WORKER_BUILD_TARGET")?,
        build_profile: std::env::var("ER_M9E_WORKER_BUILD_PROFILE")?,
    };
    let root = executable
        .parent()
        .ok_or("worker executable has no parent")?;
    let artifact = VerifiedKernelExecutableV2::verify(root, &executable, identity)?;
    Ok((bundle, artifact))
}

fn next_artifact(
    artifact: &VerifiedKernelExecutableV2,
) -> Result<VerifiedKernelExecutableV2, Box<dyn Error>> {
    let mut identity = artifact.identity().clone();
    identity.generation = KernelGenerationV1(identity.generation.0 + 1);
    Ok(VerifiedKernelExecutableV2::verify(
        artifact.allowed_root(),
        artifact.executable(),
        identity,
    )?)
}

fn supervisor(
    bundle: &GameContentBundleV2,
    artifact: &VerifiedKernelExecutableV2,
    limits: CurrentTailLimitsV2,
) -> Result<CurrentKernelSupervisorV2, Box<dyn Error>> {
    let mut active = ChildKernelGenerationV2::spawn(artifact)?;
    assert_eq!(active.session_context(), None);
    active.initialize(bundle.clone(), natural()?)?;
    assert_eq!(
        active.session_context(),
        Some((seat(), GameKernelRoleV7::Authority))
    );
    Ok(CurrentKernelSupervisorV2::new(active, limits)?)
}

fn reference(bundle: &GameContentBundleV2) -> Result<CurrentGameSession, Box<dyn Error>> {
    Ok(CurrentGameSession::natural_start(
        profile()?,
        SEED.to_owned(),
        seat(),
        vec!["preview-slot".to_owned()],
        true,
        Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?),
        None,
    )?)
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

fn dispatch_pair(
    supervisor: &mut CurrentKernelSupervisorV2,
    reference: &mut CurrentGameSession,
    event: CurrentExternalEvent,
) -> Result<CurrentDispatchV2, Box<dyn Error>> {
    let expected = reference.apply(event.clone())?;
    let actual = supervisor.dispatch(event)?;
    assert_eq!(actual.evidence.step, expected);
    assert_eq!(actual.evidence.observation, reference.observe()?);
    Ok(actual)
}

fn press_pair(
    supervisor: &mut CurrentKernelSupervisorV2,
    reference: &mut CurrentGameSession,
    code: PhysicalKey,
) -> Result<(), Box<dyn Error>> {
    dispatch_pair(supervisor, reference, key(code.clone(), true))?;
    dispatch_pair(supervisor, reference, key(code, false))?;
    Ok(())
}

fn selected(reference: &CurrentGameSession) -> Result<String, Box<dyn Error>> {
    Ok(reference
        .observe()?
        .control
        .ok_or("missing control")?
        .menu
        .ok_or("missing menu")?
        .selected_option_id
        .as_str()
        .to_owned())
}

fn reach_active_battle(
    supervisor: &mut CurrentKernelSupervisorV2,
    reference: &mut CurrentGameSession,
) -> Result<(), Box<dyn Error>> {
    assert_eq!(
        reference.observe()?.control.ok_or("title control")?.kind,
        GameControlKindV2::Title
    );
    for _ in 0..3 {
        press_pair(supervisor, reference, PhysicalKey::Space)?;
    }
    let bound = reference
        .observe()?
        .control
        .ok_or("starter control")?
        .menu
        .ok_or("starter menu")?
        .options
        .len()
        + 1;
    for _ in 0..bound {
        if selected(reference)? == "bootstrap/starter/confirm" {
            break;
        }
        press_pair(supervisor, reference, PhysicalKey::ArrowDown)?;
    }
    assert_eq!(selected(reference)?, "bootstrap/starter/confirm");
    for _ in 0..4 {
        press_pair(supervisor, reference, PhysicalKey::Space)?;
    }
    for pending in reference.snapshot()?.pending_presentations {
        dispatch_pair(
            supervisor,
            reference,
            CurrentExternalEvent::PresentationOutcome {
                event_id: pending.event_id,
                outcome: KernelPresentationOutcomeV2::Settled,
            },
        )?;
    }
    assert_eq!(
        reference.observe()?.control.ok_or("battle control")?.kind,
        GameControlKindV2::BattleCommand
    );
    assert_eq!(selected(reference)?, "battle/command/fight");
    assert_eq!(supervisor.snapshot()?, reference.snapshot()?);
    Ok(())
}

#[test]
fn exact_current_reload_replays_full_tail_then_continues_in_new_process()
-> Result<(), Box<dyn Error>> {
    let (bundle, artifact) = fixture()?;
    let mut supervisor = supervisor(&bundle, &artifact, CurrentTailLimitsV2::default())?;
    let mut reference = reference(&bundle)?;
    reach_active_battle(&mut supervisor, &mut reference)?;
    let ticket = supervisor.begin_reload()?;
    let base = ticket.frontier();
    assert!(base > 0);
    assert_eq!(ticket.snapshot(), &reference.snapshot()?);
    let old_pid = supervisor.process_id();
    for (index, event) in [
        key(PhysicalKey::ArrowDown, true),
        time(249),
        time(1),
        time(500),
    ]
    .into_iter()
    .enumerate()
    {
        let actual = dispatch_pair(&mut supervisor, &mut reference, event)?;
        assert_eq!(actual.position, base + index as u64 + 1);
        assert_eq!(actual.retention, CurrentTraceRetentionV2::Retained);
    }
    assert_eq!(selected(&reference)?, "battle/command/fight");
    let held = supervisor.snapshot()?;
    assert_eq!(held, reference.snapshot()?);
    assert_eq!(held.input_router.repeats.len(), 1);
    assert_eq!(held.scheduler.timers.len(), 1);
    assert_eq!(held.scheduler.timers[0].remaining_active_ms, safe(250));
    let invalid = supervisor.dispatch(CurrentExternalEvent::PresentationOutcome {
        event_id: PresentationEventId::new(safe(999)),
        outcome: KernelPresentationOutcomeV2::Settled,
    });
    assert!(matches!(
        invalid,
        Err(CurrentReloadErrorV2::Endpoint(
            KernelEndpointErrorV2::Fault(_)
        ))
    ));
    assert_eq!(supervisor.frontier(), base + 4);
    assert_eq!(supervisor.snapshot()?, held);
    let prepared = supervisor.prepare_reload(ticket, &next_artifact(&artifact)?, bundle.clone())?;
    assert_eq!(prepared.replayed_events(), 4);
    assert_ne!(prepared.process_id(), old_pid);
    assert_eq!(supervisor.identity().generation, KernelGenerationV1(1));
    assert_eq!(supervisor.snapshot()?, reference.snapshot()?);
    let decision = supervisor.commit_reload(prepared)?;
    assert_eq!(decision.previous_identity, *artifact.identity());
    assert_eq!(decision.active_identity.generation, KernelGenerationV1(2));
    assert_eq!(decision.frontier, base + 4);
    assert_eq!(decision.replayed_events, 4);
    assert!(decision.retirement_issue.is_none());
    assert_ne!(supervisor.process_id(), old_pid);
    assert_eq!(supervisor.retained_events(), 0);
    let repeated = dispatch_pair(&mut supervisor, &mut reference, time(250))?;
    assert_eq!(repeated.evidence.step.internal_events.len(), 1);
    assert!(!repeated.evidence.step.effects.is_empty());
    assert_eq!(selected(&reference)?, "battle/command/party");
    dispatch_pair(
        &mut supervisor,
        &mut reference,
        key(PhysicalKey::ArrowDown, false),
    )?;
    assert!(supervisor.snapshot()?.scheduler.timers.is_empty());
    assert!(
        dispatch_pair(&mut supervisor, &mut reference, time(500))?
            .evidence
            .step
            .effects
            .is_empty()
    );
    assert_eq!(supervisor.snapshot()?, reference.snapshot()?);
    supervisor.dispose()?;
    Ok(())
}

#[test]
fn prepared_reload_rejects_a_later_active_event_without_losing_progress()
-> Result<(), Box<dyn Error>> {
    let (bundle, artifact) = fixture()?;
    let mut supervisor = supervisor(&bundle, &artifact, CurrentTailLimitsV2::default())?;
    let ticket = supervisor.begin_reload()?;
    supervisor.dispatch(time(1))?;
    let prepared = supervisor.prepare_reload(ticket, &next_artifact(&artifact)?, bundle)?;
    let candidate_pid = prepared.process_id();
    supervisor.dispatch(time(2))?;
    let checkpoint = supervisor.snapshot()?;
    assert!(matches!(
        supervisor.commit_reload(prepared),
        Err(CurrentReloadErrorV2::StalePrepared)
    ));
    #[cfg(target_os = "linux")]
    assert!(
        !PathBuf::from(format!("/proc/{candidate_pid}")).exists(),
        "stale candidate was not reaped"
    );
    #[cfg(not(target_os = "linux"))]
    let _ = candidate_pid;
    assert_eq!(supervisor.identity(), artifact.identity());
    assert_eq!(supervisor.frontier(), 2);
    assert_eq!(supervisor.snapshot()?, checkpoint);
    assert!(!supervisor.is_fenced());
    assert_eq!(supervisor.dispatch(time(3))?.position, 3);
    supervisor.dispose()?;
    Ok(())
}

#[test]
fn effectful_success_budget_rejection_preserves_frontier_context_and_reload_limit()
-> Result<(), Box<dyn Error>> {
    let (bundle, artifact) = fixture()?;
    let mut setup = supervisor(&bundle, &artifact, CurrentTailLimitsV2::default())?;
    let mut reference = reference(&bundle)?;
    reach_active_battle(&mut setup, &mut reference)?;
    dispatch_pair(
        &mut setup,
        &mut reference,
        key(PhysicalKey::ArrowDown, true),
    )?;
    let held = reference.snapshot()?;
    let observation = reference.observe()?;
    let encoded_len = |response| -> Result<usize, serde_json::Error> {
        Ok(serde_json::to_vec(&KernelWorkerResponseEnvelopeV2 {
            abi_version: KERNEL_WORKER_ABI_VERSION_V2,
            session_id: artifact.identity().session_id.clone(),
            generation: artifact.identity().generation,
            request_id: 100,
            accepted_sequence: Some(100),
            after_mechanical_digest: observation.mechanical_digest.clone(),
            response,
        })?
        .len())
    };
    // Reserve space for small control responses and later sequence digits while
    // deriving the bound from this actual full snapshot, not a fixed guess.
    let cap = [
        encoded_len(KernelWorkerResponseV2::Snapshot {
            snapshot: Box::new(held.clone()),
        })?,
        encoded_len(KernelWorkerResponseV2::Initialized {
            observation: Box::new(observation.clone()),
        })?,
        encoded_len(KernelWorkerResponseV2::Ready(Box::new(
            artifact.identity().clone(),
        )))?,
    ]
    .into_iter()
    .max()
    .ok_or("missing response lengths")?
        + 16_384;
    assert!(cap < MAXIMUM_WORKER_FRAME_BYTES_V2);
    let mut oversized = None;
    for ticks in [8, 32, 128, 512, 1024] {
        let mut probe = reference.fork()?;
        let event = time(ticks * 250);
        let evidence = CurrentGenerationStepV2 {
            step: probe.apply(event.clone())?,
            observation: probe.observe()?,
        };
        let bytes = encoded_len(KernelWorkerResponseV2::Effects {
            step: evidence.step.clone(),
            observation: Box::new(evidence.observation.clone()),
        })?;
        if bytes > cap + 4096 && bytes < MAXIMUM_WORKER_FRAME_BYTES_V2 {
            assert!(!evidence.step.effects.is_empty());
            assert_ne!(probe.snapshot()?, held);
            oversized = Some((event, evidence));
            break;
        }
    }
    let (large_event, expected_large) =
        oversized.ok_or("no bounded effectful response exceeded negotiated cap")?;
    // The identical event succeeds through the actual worker at its hard cap.
    assert_eq!(
        setup.dispatch(large_event.clone())?.evidence,
        expected_large
    );
    setup.dispose()?;

    let mut active = ChildKernelGenerationV2::spawn_with_limits(
        &artifact,
        KernelWorkerDeadlinesV2::default(),
        cap,
    )?;
    active.initialize(
        bundle.clone(),
        KernelWorkerInitializationV2::Snapshot {
            snapshot_bytes: serde_json::to_vec(&held)?,
            local_seat: seat(),
            role: GameKernelRoleV7::Authority,
        },
    )?;
    let context = active.session_context();
    assert_eq!(context, Some((seat(), GameKernelRoleV7::Authority)));
    let applied_before = active.health()?.applied_events;
    let accepted = active.accepted_sequence();
    assert!(matches!(active.apply(large_event.clone()),
        Err(KernelEndpointErrorV2::Fault(fault)) if fault.code == KernelWorkerFaultCodeV2::ResponseTooLarge));
    assert_eq!(active.accepted_sequence(), accepted);
    assert_eq!(active.session_context(), context);
    assert!(!active.is_fenced());
    assert_eq!(active.snapshot()?, held);
    assert_eq!(active.health()?.applied_events, applied_before);

    // Reading the snapshot consumed a request sequence. Reject again and make
    // the immediate same-sequence retry a smaller, genuinely effectful event.
    let accepted = active.accepted_sequence();
    assert!(matches!(active.apply(large_event.clone()),
        Err(KernelEndpointErrorV2::Fault(fault)) if fault.code == KernelWorkerFaultCodeV2::ResponseTooLarge));
    assert_eq!(active.accepted_sequence(), accepted);
    let expected = reference.apply(time(250))?;
    assert!(!expected.effects.is_empty());
    let retry = active.apply(time(250))?;
    assert_eq!(
        active.accepted_sequence(),
        accepted.map(|sequence| sequence + 1)
    );
    assert_eq!(retry.step, expected);
    assert_eq!(retry.observation, reference.observe()?);
    assert_eq!(active.snapshot()?, reference.snapshot()?);
    assert_eq!(active.health()?.applied_events, applied_before + 1);

    let mut supervisor = CurrentKernelSupervisorV2::new(active, CurrentTailLimitsV2::default())?;
    let ticket = supervisor.begin_reload()?;
    let prepared = supervisor.prepare_reload(ticket, &next_artifact(&artifact)?, bundle)?;
    supervisor.commit_reload(prepared)?;
    assert_eq!(supervisor.maximum_success_response_bytes(), cap);
    assert_eq!(supervisor.session_context(), context);
    let before = supervisor.snapshot()?;
    assert!(matches!(supervisor.dispatch(large_event),
        Err(CurrentReloadErrorV2::Endpoint(KernelEndpointErrorV2::Fault(fault)))
            if fault.code == KernelWorkerFaultCodeV2::ResponseTooLarge));
    assert_eq!(supervisor.frontier(), 0);
    assert_eq!(supervisor.snapshot()?, before);
    assert_eq!(supervisor.session_context(), context);
    assert_eq!(
        dispatch_pair(&mut supervisor, &mut reference, time(250))?.position,
        1
    );
    assert_eq!(supervisor.snapshot()?, reference.snapshot()?);
    supervisor.dispose()?;
    Ok(())
}

#[test]
fn tail_rotation_rejects_expired_ticket_and_replays_every_retained_event()
-> Result<(), Box<dyn Error>> {
    let (bundle, artifact) = fixture()?;
    let mut supervisor = supervisor(
        &bundle,
        &artifact,
        CurrentTailLimitsV2 {
            maximum_events: 1,
            maximum_bytes: 16_777_216,
        },
    )?;
    let expired = supervisor.begin_reload()?;
    supervisor.dispatch(time(1))?;
    let retained = supervisor.begin_reload()?;
    supervisor.dispatch(time(2))?;
    assert_eq!(supervisor.oldest_retained_frontier(), 1);
    assert_eq!(supervisor.retained_events(), 1);
    let candidate = next_artifact(&artifact)?;
    assert!(matches!(
        supervisor.prepare_reload(expired, &candidate, bundle.clone()),
        Err(CurrentReloadErrorV2::TicketExpired {
            ticket: 0,
            oldest: 1
        })
    ));
    let expected = supervisor.snapshot()?;
    let prepared = supervisor.prepare_reload(retained, &candidate, bundle)?;
    assert_eq!(prepared.replayed_events(), 1);
    supervisor.commit_reload(prepared)?;
    assert_eq!(supervisor.snapshot()?, expected);
    supervisor.dispose()?;
    Ok(())
}

#[test]
fn candidate_content_fault_and_generation_reuse_preserve_active() -> Result<(), Box<dyn Error>> {
    let (bundle, artifact) = fixture()?;
    let mut supervisor = supervisor(&bundle, &artifact, CurrentTailLimitsV2::default())?;
    let ticket = supervisor.begin_reload()?;
    supervisor.dispatch(time(9))?;
    let expected = supervisor.snapshot()?;
    assert!(matches!(
        supervisor.prepare_reload(ticket.clone(), &artifact, bundle.clone()),
        Err(CurrentReloadErrorV2::Identity(_))
    ));
    let mut invalid = serde_json::to_value(&bundle)?;
    invalid["schema_version"] = serde_json::json!(0);
    let candidate = next_artifact(&artifact)?;
    assert!(
        matches!(supervisor.prepare_reload(ticket.clone(), &candidate, serde_json::from_value(invalid)?),
        Err(CurrentReloadErrorV2::Endpoint(KernelEndpointErrorV2::Fault(fault)))
            if fault.code == KernelWorkerFaultCodeV2::ContentRejected)
    );
    assert_eq!(supervisor.identity(), artifact.identity());
    assert_eq!(supervisor.frontier(), 1);
    assert_eq!(supervisor.snapshot()?, expected);
    let prepared = supervisor.prepare_reload(ticket, &candidate, bundle)?;
    supervisor.commit_reload(prepared)?;
    assert_eq!(supervisor.snapshot()?, expected);
    supervisor.dispose()?;
    Ok(())
}

#[test]
fn retention_gap_reports_accepted_event_and_expires_previous_ticket() -> Result<(), Box<dyn Error>>
{
    let (bundle, artifact) = fixture()?;
    let mut supervisor = supervisor(
        &bundle,
        &artifact,
        CurrentTailLimitsV2 {
            maximum_events: 2,
            maximum_bytes: 1,
        },
    )?;
    let ticket = supervisor.begin_reload()?;
    let before = supervisor.snapshot()?;
    let accepted = supervisor.dispatch(time(7))?;
    assert_eq!(accepted.position, 1);
    assert_eq!(accepted.retention, CurrentTraceRetentionV2::Gap);
    assert_eq!(supervisor.frontier(), 1);
    assert_eq!(supervisor.retained_events(), 0);
    assert_eq!(supervisor.retained_bytes(), 0);
    assert_eq!(supervisor.health()?.applied_events, 1);
    assert_ne!(supervisor.snapshot()?, before);
    let candidate = next_artifact(&artifact)?;
    assert!(matches!(
        supervisor.prepare_reload(ticket, &candidate, bundle.clone()),
        Err(CurrentReloadErrorV2::TicketExpired {
            ticket: 0,
            oldest: 1
        })
    ));
    let fresh = supervisor.begin_reload()?;
    let prepared = supervisor.prepare_reload(fresh, &candidate, bundle)?;
    assert_eq!(prepared.replayed_events(), 0);
    supervisor.commit_reload(prepared)?;
    supervisor.dispose()?;
    Ok(())
}

#[test]
fn byte_budget_rotates_at_absolute_frontier() -> Result<(), Box<dyn Error>> {
    let (bundle, artifact) = fixture()?;
    let mut reference = reference(&bundle)?;
    let event = time(1);
    let evidence = CurrentGenerationStepV2 {
        step: reference.apply(event.clone())?,
        observation: reference.observe()?,
    };
    let one_record_bytes = serde_json::to_vec(&(1_u64, &event, &evidence))?.len();
    let mut supervisor = supervisor(
        &bundle,
        &artifact,
        CurrentTailLimitsV2 {
            maximum_events: 8,
            maximum_bytes: one_record_bytes,
        },
    )?;
    let ticket = supervisor.begin_reload()?;
    assert_eq!(
        supervisor.dispatch(event.clone())?.retention,
        CurrentTraceRetentionV2::Retained
    );
    assert_eq!(supervisor.retained_bytes(), one_record_bytes);
    assert_eq!(
        supervisor.dispatch(event)?.retention,
        CurrentTraceRetentionV2::Retained
    );
    assert_eq!(supervisor.retained_events(), 1);
    assert_eq!(supervisor.oldest_retained_frontier(), 1);
    assert!(supervisor.retained_bytes() <= one_record_bytes);
    assert!(matches!(
        supervisor.prepare_reload(ticket, &next_artifact(&artifact)?, bundle),
        Err(CurrentReloadErrorV2::TicketExpired {
            ticket: 0,
            oldest: 1
        })
    ));
    supervisor.dispose()?;
    Ok(())
}

#[test]
fn acknowledged_restore_context_survives_fault_and_is_preserved_by_reload()
-> Result<(), Box<dyn Error>> {
    let (bundle, artifact) = fixture()?;
    let mut active = ChildKernelGenerationV2::spawn(&artifact)?;
    active.initialize(bundle.clone(), natural()?)?;
    let snapshot = active.snapshot()?;
    let accepted = active.accepted_sequence();
    let original_context = Some((seat(), GameKernelRoleV7::Authority));
    assert_eq!(active.session_context(), original_context);
    assert!(matches!(active.restore(
        br#"{"schema_version":6}"#.to_vec(), SeatId::new(safe(2)), GameKernelRoleV7::Replica,
    ), Err(KernelEndpointErrorV2::Fault(fault)) if fault.code == KernelWorkerFaultCodeV2::SnapshotRejected));
    assert_eq!(active.accepted_sequence(), accepted);
    assert_eq!(active.session_context(), original_context);
    assert_eq!(active.snapshot()?, snapshot);

    // Construct a valid replica endpoint-context fixture at bootstrap. Replica
    // snapshots cannot retain authority AI; this is not a cooperative journey.
    let mut replica_snapshot = snapshot.clone();
    replica_snapshot.authority_ai = None;
    replica_snapshot.validate(&PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?)?;
    active.restore(
        serde_json::to_vec(&replica_snapshot)?,
        seat(),
        GameKernelRoleV7::Replica,
    )?;
    let restored_context = Some((seat(), GameKernelRoleV7::Replica));
    assert_eq!(active.session_context(), restored_context);
    let mut supervisor = CurrentKernelSupervisorV2::new(active, CurrentTailLimitsV2::default())?;
    assert_eq!(supervisor.session_context(), restored_context);
    let ticket = supervisor.begin_reload()?;
    let prepared = supervisor.prepare_reload(ticket, &next_artifact(&artifact)?, bundle)?;
    supervisor.commit_reload(prepared)?;
    assert_eq!(supervisor.session_context(), restored_context);
    assert_eq!(supervisor.snapshot()?, replica_snapshot);
    supervisor.dispose()?;
    assert_eq!(supervisor.session_context(), None);
    Ok(())
}

#[cfg(target_os = "linux")]
#[test]
fn accepted_activation_reports_failed_retirement_without_rejecting_candidate()
-> Result<(), Box<dyn Error>> {
    let (bundle, artifact) = fixture()?;
    let mut supervisor = supervisor(&bundle, &artifact, CurrentTailLimitsV2::default())?;
    let ticket = supervisor.begin_reload()?;
    supervisor.dispatch(time(4))?;
    let expected = supervisor.snapshot()?;
    let prepared = supervisor.prepare_reload(ticket, &next_artifact(&artifact)?, bundle)?;
    let previous_pid = supervisor.process_id();
    // The exact predecessor is deliberately killed after preparation. This
    // makes retirement fail without changing the candidate's prepared state.
    let status = std::process::Command::new("/bin/kill")
        .arg("-KILL")
        .arg(previous_pid.to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;
    assert!(status.success());
    let accepted = supervisor.commit_reload(prepared)?;
    assert!(accepted.retirement_issue.is_some());
    assert_eq!(supervisor.identity().generation, KernelGenerationV1(2));
    assert_eq!(supervisor.snapshot()?, expected);
    assert!(!PathBuf::from(format!("/proc/{previous_pid}")).exists());
    assert_eq!(supervisor.dispatch(time(3))?.position, 2);
    supervisor.dispose()?;
    Ok(())
}
