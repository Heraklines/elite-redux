use std::error::Error;

use er_protocol::{
    AuthorityLog, AuthorityLogAction, AuthorityLogConfig, AuthorityLogSnapshotBridge,
    AuthorityReplica, AuthorityReplicaConfig, AuthorityReplicaSnapshotBridge, BackoffPolicy,
    BattleTerminalMaterialV1, BattleTerminalReasonV1, KernelScheduler, PeerBinding, ReplicaAction,
    ReplicaAdmission, ReplicaMechanicalStage, ReplicaTailProofDisposition,
    build_battle_terminal_commit_draft, control_id_of,
};
use er_types::{
    AckStage, AuthorityEntry, AuthorityEntryDraft, AuthorityEntryKind, AuthorityReceipt,
    AwaitSuccessorControl, CommandControlTarget, CommandFrontierControl, ConnectionGeneration,
    FrameContext, Material, MembershipRevision, NextControl, OperationId, Revision, RunId,
    SafeU53, SeatId, SessionId, TailProofBody, TailProofPhase, TailRequestBody, TimeClass,
};
use serde_json::json;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::MAX,
    }
}

fn revision(value: u64) -> Revision {
    Revision::new(safe(value))
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn operation(value: &str) -> TestResult<OperationId> {
    Ok(OperationId::new(value.to_owned())?)
}

fn context(
    sender: u64,
    authority: u64,
    membership: u64,
    connection: u64,
) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("m3-tail-proof-session")?,
        run_id: RunId::new("m3-tail-proof-run")?,
        session_epoch: safe(1),
        seat_map_id: "m3-tail-proof-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(membership)),
        sender_seat_id: seat(sender),
        authority_seat_id: seat(authority),
        connection_generation: generation(connection),
    })
}

fn command_control(turn: u64) -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1),
        wave: safe(1),
        turn: safe(turn),
        commands: vec![CommandControlTarget {
            owner_seat_id: seat(0),
            pokemon_id: safe(1),
            field_index: safe(0),
        }],
    })
}

fn await_turn_successor(
    after_operation_id: OperationId,
    expected_operation_id: OperationId,
) -> NextControl {
    NextControl::AwaitSuccessor(AwaitSuccessorControl {
        after_operation_id,
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        allowed_kinds: vec![AuthorityEntryKind::TurnCommit],
        allowed_interaction_addresses: None,
        allowed_control_addresses: None,
        allow_next_wave_start: false,
        expected_operation_id: Some(expected_operation_id),
    })
}

fn source_draft() -> TestResult<AuthorityEntryDraft> {
    Ok(AuthorityEntryDraft {
        context: context(0, 0, 1, 1)?,
        operation_id: operation("turn-1")?,
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: "turn-1-digest".to_owned(),
            payload: json!({"kind": "turn", "wave": 1, "turn": 1}),
        },
        next_control: command_control(1),
        subsumes: Vec::new(),
    })
}

fn authority_config() -> TestResult<AuthorityLogConfig> {
    Ok(AuthorityLogConfig {
        local_context: context(0, 0, 1, 1)?,
        peer_bindings: vec![PeerBinding {
            seat_id: seat(1),
            connection_generation: generation(1),
        }],
        owner_id: "m3-tail-proof-authority".to_owned(),
        retain_capacity: safe(16),
        delivery_backoff: BackoffPolicy {
            initial_ms: safe(250),
            maximum_ms: safe(5_000),
            factor_numerator: safe(2),
            factor_denominator: safe(1),
        },
        delivery_time_class: TimeClass::Connected,
        max_delivery_attempts: Some(SafeU53::ZERO),
    })
}

fn receipt(entry: &AuthorityEntry, stage: AckStage) -> TestResult<AuthorityReceipt> {
    Ok(AuthorityReceipt {
        context: context(1, 0, 1, 1)?,
        revision: entry.revision,
        operation_id: entry.operation_id.clone(),
        stage,
        control_id: (stage == AckStage::ControlInstalled)
            .then(|| control_id_of(&entry.next_control)),
    })
}

fn terminal_draft() -> TestResult<AuthorityEntryDraft> {
    let terminal = BattleTerminalMaterialV1::new(
        "terminal-2",
        BattleTerminalReasonV1::GameOver,
        safe(1),
        safe(1),
    )?;
    Ok(build_battle_terminal_commit_draft(
        context(0, 0, 1, 1)?,
        operation("terminal-2")?,
        terminal,
        vec![revision(1)],
    )?)
}

fn replica() -> TestResult<AuthorityReplica> {
    Ok(AuthorityReplica::new(AuthorityReplicaConfig {
        receipt_context: context(1, 0, 1, 1)?,
        authority_seat_id: seat(0),
        authority_connection_generation: generation(1),
    })?)
}

fn install_source(replica: &mut AuthorityReplica, source: &AuthorityEntry) -> TestResult {
    assert!(matches!(
        replica.admit(source.clone()).admission,
        ReplicaAdmission::Admitted { .. }
    ));
    replica.record_replica_stage(source, ReplicaMechanicalStage::MaterialApplied)?;
    replica.record_replica_stage(
        source,
        ReplicaMechanicalStage::ControlInstalled {
            control_id: control_id_of(&source.next_control),
        },
    )?;
    Ok(())
}

fn correlated_request(step: &er_protocol::ReplicaStep) -> TestResult<TailRequestBody> {
    let Some(ReplicaAction::RequestTailProof {
        context: action_context,
        request,
    }) = step.actions.first()
    else {
        return Err("boundary candidate did not emit one correlated tail request".into());
    };
    assert_eq!(action_context.sender_seat_id, seat(1));
    assert_eq!(action_context.authority_seat_id, seat(0));
    assert_eq!(step.actions.len(), 1);
    Ok(request.clone())
}

fn response_parts(
    actions: &[AuthorityLogAction],
) -> TestResult<(TailProofBody, AuthorityEntry, TailProofBody)> {
    let [
        AuthorityLogAction::TailProof {
            to: manifest_to,
            body: manifest,
            ..
        },
        AuthorityLogAction::Deliver { to: source_to, entry },
        AuthorityLogAction::TailProof {
            to: complete_to,
            body: complete,
            ..
        },
    ] = actions
    else {
        return Err(format!("unexpected tail proof response order: {actions:?}").into());
    };
    assert_eq!((*manifest_to, *source_to, *complete_to), (seat(1), seat(1), seat(1)));
    assert_eq!(manifest.phase, TailProofPhase::Manifest);
    assert_eq!(complete.phase, TailProofPhase::Complete);
    Ok((manifest.clone(), entry.as_ref().clone(), complete.clone()))
}

fn live_boundary() -> TestResult<(
    KernelScheduler,
    AuthorityLog,
    AuthorityReplica,
    AuthorityEntry,
    AuthorityEntry,
    TailRequestBody,
)> {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(authority_config()?)?;
    let source = log.commit(source_draft()?, &mut scheduler)?.entry;
    let candidate = log.commit(terminal_draft()?, &mut scheduler)?.entry;

    let mut replica = replica()?;
    install_source(&mut replica, &source)?;
    let parked = replica.admit(candidate.clone());
    assert_eq!(
        parked.admission,
        ReplicaAdmission::Gap {
            missing_from: revision(1)
        }
    );
    let request = correlated_request(&parked)?;
    Ok((scheduler, log, replica, source, candidate, request))
}

#[test]
fn authority_freezes_manifest_sources_complete_and_replays_exact_id() -> TestResult {
    let (mut scheduler, mut log, _replica, source, candidate, request) = live_boundary()?;
    for stage in [
        AckStage::Admitted,
        AckStage::MaterialApplied,
        AckStage::ControlInstalled,
    ] {
        log.accept_receipt_detailed(receipt(&source, stage)?, &mut scheduler);
    }
    assert!(log.retained_entry(source.revision).is_none());
    assert_eq!(log.diagnostics().retired_tail_proof_sources, safe(1));

    let response = log.handle_tail_proof_request(context(1, 0, 1, 1)?, request.clone());
    let (manifest, emitted_source, complete) = response_parts(&response)?;
    assert_eq!(emitted_source, source);
    assert_eq!(manifest.source_revisions, vec![source.revision]);
    assert_eq!(manifest.head_revision, candidate.revision);
    assert_eq!(manifest.request_id, request.request_id.clone().ok_or("request id")?);
    assert_eq!(manifest.from_revision, request.from_revision);
    assert_eq!(complete.source_revisions, manifest.source_revisions);
    assert_eq!(log.diagnostics().tail_proof_responses, safe(1));

    let snapshot_json = serde_json::to_string(&log.snapshot_v2()?)?;
    log = AuthorityLog::from_snapshot_v2(serde_json::from_str(&snapshot_json)?, &mut scheduler)?;

    assert_eq!(
        log.handle_tail_proof_request(context(1, 0, 1, 1)?, request.clone()),
        response,
        "same peer/request ID must replay the frozen response"
    );
    let mut conflict = request.clone();
    conflict.candidate_operation_id = Some(operation("conflicting-candidate")?);
    assert!(
        log.handle_tail_proof_request(context(1, 0, 1, 1)?, conflict)
            .is_empty()
    );
    assert_eq!(
        log.handle_tail_proof_request(context(1, 0, 1, 1)?, request),
        response,
        "conflicting reuse must not mutate the original replay"
    );

    for stage in [
        AckStage::Admitted,
        AckStage::MaterialApplied,
        AckStage::ControlInstalled,
        AckStage::PresentationSettled,
    ] {
        log.accept_receipt_detailed(receipt(&candidate, stage)?, &mut scheduler);
    }
    assert_eq!(log.diagnostics().tail_proof_responses, SafeU53::ZERO);
    Ok(())
}

#[test]
fn replica_restores_capture_parks_candidate_and_redrives_only_after_complete() -> TestResult {
    let (_scheduler, mut log, mut replica, source, candidate, request) = live_boundary()?;
    let response = log.handle_tail_proof_request(context(1, 0, 1, 1)?, request.clone());
    let (manifest, emitted_source, complete) = response_parts(&response)?;

    assert_eq!(
        replica.accept_tail_proof(&candidate.context, &manifest),
        ReplicaTailProofDisposition::Pending
    );
    let snapshot = replica.snapshot_v2()?;
    let encoded = serde_json::to_string(&snapshot)?;
    let decoded = serde_json::from_str(&encoded)?;
    replica = AuthorityReplica::from_snapshot_v2(decoded)?;

    let redelivery = replica.admit(candidate.clone());
    assert!(matches!(redelivery.admission, ReplicaAdmission::Gap { .. }));
    let redriven = correlated_request(&redelivery)?;
    assert_eq!(redriven, request);
    assert_eq!(replica.frontier().control, source.revision);

    assert!(matches!(
        replica.admit(emitted_source).admission,
        ReplicaAdmission::Gap { .. }
    ));
    let ReplicaTailProofDisposition::Completed { step } =
        replica.accept_tail_proof(&candidate.context, &complete)
    else {
        return Err("complete proof did not redrive the parked candidate".into());
    };
    assert!(matches!(step.admission, ReplicaAdmission::Admitted { .. }));
    assert!(step.actions.iter().any(
        |action| matches!(action, ReplicaAction::ApplyMaterial { entry } if entry == &candidate)
    ));
    assert_eq!(replica.frontier().received, candidate.revision);
    Ok(())
}

#[test]
fn replica_rejects_incomplete_conflicting_unlisted_and_over_capacity_proofs() -> TestResult {
    let (_scheduler, mut log, mut replica, source, candidate, request) = live_boundary()?;
    let response = log.handle_tail_proof_request(context(1, 0, 1, 1)?, request);
    let (manifest, emitted_source, complete) = response_parts(&response)?;
    assert_eq!(
        replica.accept_tail_proof(&candidate.context, &manifest),
        ReplicaTailProofDisposition::Pending
    );
    assert!(matches!(
        replica.accept_tail_proof(&candidate.context, &complete),
        ReplicaTailProofDisposition::Rejected { .. }
    ));

    let parked = replica.admit(candidate.clone());
    assert!(matches!(parked.admission, ReplicaAdmission::Gap { .. }));
    let request = correlated_request(&parked)?;
    let response = log.handle_tail_proof_request(context(1, 0, 1, 1)?, request);
    let (manifest, _, _) = response_parts(&response)?;
    assert_eq!(
        replica.accept_tail_proof(&candidate.context, &manifest),
        ReplicaTailProofDisposition::Pending
    );
    let mut conflicting = emitted_source.clone();
    conflicting.material.payload = json!({"conflict": true});
    assert!(matches!(
        replica.admit(emitted_source).admission,
        ReplicaAdmission::Gap { .. }
    ));
    assert_eq!(
        replica.admit(conflicting).admission,
        ReplicaAdmission::Rejected {
            reason: er_protocol::ReplicaRejectReason::TailProofRejected
        }
    );

    let parked = replica.admit(candidate.clone());
    let request = correlated_request(&parked)?;
    let response = log.handle_tail_proof_request(context(1, 0, 1, 1)?, request);
    let (manifest, _, _) = response_parts(&response)?;
    assert_eq!(
        replica.accept_tail_proof(&candidate.context, &manifest),
        ReplicaTailProofDisposition::Pending
    );
    let mut unlisted = source.clone();
    unlisted.revision = revision(3);
    unlisted.operation_id = operation("unlisted-3")?;
    assert_eq!(
        replica.admit(unlisted).admission,
        ReplicaAdmission::Rejected {
            reason: er_protocol::ReplicaRejectReason::TailProofRejected
        }
    );

    let parked = replica.admit(candidate.clone());
    let request = correlated_request(&parked)?;
    let response = log.handle_tail_proof_request(context(1, 0, 1, 1)?, request);
    let (mut manifest, _, _) = response_parts(&response)?;
    manifest.source_revisions = vec![revision(1); 513];
    assert!(matches!(
        replica.accept_tail_proof(&candidate.context, &manifest),
        ReplicaTailProofDisposition::Rejected { .. }
    ));
    Ok(())
}

#[test]
fn replica_rejects_listed_sources_delivered_out_of_manifest_order() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(authority_config()?)?;
    let first_operation = operation("ordered-turn-1")?;
    let second_operation = operation("ordered-turn-2")?;
    let first = log
        .commit(
            AuthorityEntryDraft {
                context: context(0, 0, 1, 1)?,
                operation_id: first_operation.clone(),
                kind: AuthorityEntryKind::TurnCommit,
                material: Material {
                    digest: "ordered-turn-1-digest".to_owned(),
                    payload: json!({"kind": "turn", "wave": 1, "turn": 1}),
                },
                next_control: await_turn_successor(first_operation, second_operation.clone()),
                subsumes: Vec::new(),
            },
            &mut scheduler,
        )?
        .entry;
    let second = log
        .commit(
            AuthorityEntryDraft {
                context: context(0, 0, 1, 1)?,
                operation_id: second_operation,
                kind: AuthorityEntryKind::TurnCommit,
                material: Material {
                    digest: "ordered-turn-2-digest".to_owned(),
                    payload: json!({"kind": "turn", "wave": 1, "turn": 1}),
                },
                next_control: command_control(1),
                subsumes: Vec::new(),
            },
            &mut scheduler,
        )?
        .entry;
    let terminal = BattleTerminalMaterialV1::new(
        "ordered-terminal-3",
        BattleTerminalReasonV1::GameOver,
        safe(1),
        safe(1),
    )?;
    let candidate = log
        .commit(
            build_battle_terminal_commit_draft(
                context(0, 0, 1, 1)?,
                operation("ordered-terminal-3")?,
                terminal,
                vec![first.revision, second.revision],
            )?,
            &mut scheduler,
        )?
        .entry;

    let mut replica = replica()?;
    install_source(&mut replica, &first)?;
    install_source(&mut replica, &second)?;
    let parked = replica.admit(candidate.clone());
    let request = correlated_request(&parked)?;
    let response = log.handle_tail_proof_request(context(1, 0, 1, 1)?, request);
    let manifest = match response.first() {
        Some(AuthorityLogAction::TailProof { body, .. }) => body.clone(),
        _ => return Err("ordered proof did not begin with a manifest".into()),
    };
    let second_source = match response.get(2) {
        Some(AuthorityLogAction::Deliver { entry, .. }) => entry.as_ref().clone(),
        _ => return Err("ordered proof did not contain its second source".into()),
    };
    assert_eq!(manifest.source_revisions, vec![first.revision, second.revision]);
    assert_eq!(second_source, second);
    assert_eq!(
        replica.accept_tail_proof(&candidate.context, &manifest),
        ReplicaTailProofDisposition::Pending
    );
    assert_eq!(
        replica.admit(second_source).admission,
        ReplicaAdmission::Rejected {
            reason: er_protocol::ReplicaRejectReason::TailProofRejected
        }
    );
    Ok(())
}

#[test]
fn replica_rebind_clears_stale_capture_and_restarts_sequence_in_new_context() -> TestResult {
    let (_scheduler, mut log, mut replica, _source, mut candidate, request) = live_boundary()?;
    let response = log.handle_tail_proof_request(context(1, 0, 1, 1)?, request);
    let (manifest, _, _) = response_parts(&response)?;

    replica.rebind_connection(context(1, 0, 2, 2)?, generation(2))?;
    assert!(matches!(
        replica.accept_tail_proof(&candidate.context, &manifest),
        ReplicaTailProofDisposition::Ignored { .. }
    ));

    candidate.context = context(0, 0, 2, 2)?;
    let rebound = replica.admit(candidate.clone());
    assert!(matches!(rebound.admission, ReplicaAdmission::Gap { .. }));
    let rebound_request = correlated_request(&rebound)?;
    assert_eq!(rebound_request.candidate_revision, Some(candidate.revision));
    assert_eq!(
        rebound_request.request_id.as_ref().map(OperationId::as_str),
        Some("authority-v2:m3-tail-proof-session:seat1:boundary-proof:1")
    );
    Ok(())
}
