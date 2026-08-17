use std::error::Error;

use er_kernel::{GameKernel, KernelConfig, ProtocolKernelConfig, ProtocolRoleConfig};
use er_protocol::{
    AuthorityReplicaConfig, BattleTerminalMaterialV1, BattleTerminalReasonV1, ProposalLeaseConfig,
    RecoveryTransactionConfig, build_battle_terminal_commit_draft, control_id_of,
};
use er_types::{
    AuthorityEntry, AuthorityEntryBody, AuthorityEntryKind, AwaitSuccessorControl,
    ConnectionGeneration, ControlProjectionOutcome, FRAME_PROTOCOL_VERSION, FrameContext,
    FrameType, InputMap, KernelEffect, KernelInput, Material, MaterialApplicationOutcome,
    MembershipRevision, NextControl, OperationId, Revision, RunId, SafeU53, SeatId, SessionId,
    TailProofBody, TailProofPhase, TailRequestBody, UiState,
};
use serde_json::json;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const GENERIC_KERNEL_SOURCE: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/kernel.rs"));
const BATTLE_KERNEL_SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/battle_kernel.rs"
));

const fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::MAX,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn revision(value: u64) -> Revision {
    Revision::new(safe(value))
}

fn operation(value: &str) -> TestResult<OperationId> {
    Ok(OperationId::new(value.to_owned())?)
}

fn context(sender: u64) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("m3-kernel-tail-proof")?,
        run_id: RunId::new("m3-kernel-tail-proof-run")?,
        session_epoch: safe(1),
        seat_map_id: "m3-kernel-tail-proof-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: seat(sender),
        authority_seat_id: seat(0),
        connection_generation: generation(1),
    })
}

fn network_frame(
    frame_type: FrameType,
    context: FrameContext,
    body: serde_json::Value,
) -> er_types::NetworkFrame {
    er_types::NetworkFrame {
        version: FRAME_PROTOCOL_VERSION,
        frame_type,
        context,
        body,
    }
}

fn source() -> TestResult<AuthorityEntry> {
    let operation_id = operation("turn-1")?;
    Ok(AuthorityEntry {
        context: context(0)?,
        revision: revision(1),
        operation_id: operation_id.clone(),
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: "turn-1-digest".to_owned(),
            payload: json!({"kind": "turn", "wave": 1, "turn": 1}),
        },
        next_control: NextControl::AwaitSuccessor(AwaitSuccessorControl {
            after_operation_id: operation_id,
            epoch: safe(1),
            wave: safe(1),
            turn: safe(1),
            allowed_kinds: vec![AuthorityEntryKind::TurnCommit],
            allowed_interaction_addresses: None,
            allowed_control_addresses: None,
            allow_next_wave_start: false,
            expected_operation_id: Some(operation("turn-2")?),
        }),
        subsumes: Vec::new(),
    })
}

fn candidate() -> TestResult<AuthorityEntry> {
    let material = BattleTerminalMaterialV1::new(
        "terminal-2",
        BattleTerminalReasonV1::GameOver,
        safe(1),
        safe(1),
    )?;
    let draft = build_battle_terminal_commit_draft(
        context(0)?,
        operation("terminal-2")?,
        material,
        vec![revision(1)],
    )?;
    Ok(AuthorityEntry {
        context: draft.context,
        revision: revision(2),
        operation_id: draft.operation_id,
        kind: draft.kind,
        material: draft.material,
        next_control: draft.next_control,
        subsumes: draft.subsumes,
    })
}

fn replica_kernel() -> TestResult<GameKernel> {
    let local_context = context(1)?;
    Ok(GameKernel::new(KernelConfig {
        input_map: InputMap::default(),
        initial_ui: UiState::default(),
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Replica {
                replica: AuthorityReplicaConfig {
                    receipt_context: local_context.clone(),
                    authority_seat_id: seat(0),
                    authority_connection_generation: generation(1),
                },
                proposal_leases: ProposalLeaseConfig {
                    owner_prefix: "m3-tail-proof-proposal".to_owned(),
                    retry_initial_ms: safe(250),
                    retry_maximum_ms: safe(5_000),
                    absolute_ceiling_ms: safe(1_200_000),
                },
                recovery: RecoveryTransactionConfig {
                    local_context,
                    request_timeout_ms: safe(5_000),
                    control_timeout_ms: safe(5_000),
                    pacing_ms: safe(16),
                    timer_owner_id: "m3-tail-proof-recovery".to_owned(),
                },
            },
            menu_plans: Vec::new(),
        }),
    }))
}

fn authority_entry_input(entry: &AuthorityEntry) -> TestResult<KernelInput> {
    Ok(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: network_frame(
            FrameType::AuthorityEntry,
            entry.context.clone(),
            serde_json::to_value(AuthorityEntryBody::from(entry))?,
        ),
    })
}

fn proof_input(context: &FrameContext, body: TailProofBody) -> TestResult<KernelInput> {
    Ok(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: network_frame(
            FrameType::TailProof,
            context.clone(),
            serde_json::to_value(body)?,
        ),
    })
}

#[test]
fn generic_kernel_routes_correlated_tail_request_and_tail_proof_completion() -> TestResult {
    let mut kernel = replica_kernel()?;
    let source = source()?;
    let candidate = candidate()?;

    let admitted = kernel.step(authority_entry_input(&source)?)?;
    assert!(admitted.iter().any(|effect| matches!(
        effect,
        KernelEffect::ApplyAuthorityMaterial { revision: actual, .. }
            if *actual == source.revision
    )));
    kernel.step(KernelInput::MaterialApplied {
        endpoint: seat(1),
        revision: source.revision,
        outcome: MaterialApplicationOutcome::Applied,
    })?;
    kernel.step(KernelInput::ControlProjected {
        endpoint: seat(1),
        revision: source.revision,
        outcome: ControlProjectionOutcome::Installed {
            control_id: control_id_of(&source.next_control),
        },
    })?;

    let parked = kernel.step(authority_entry_input(&candidate)?)?;
    let request_frame = parked
        .iter()
        .find_map(|effect| match effect {
            KernelEffect::SendFrame { frame, .. }
                if frame.frame_type == FrameType::TailRequest =>
            {
                Some(frame)
            }
            _ => None,
        })
        .ok_or("generic kernel did not emit correlated tailRequest")?;
    let request: TailRequestBody = serde_json::from_value(request_frame.body.clone())?;
    assert!(request.request_id.is_some());
    assert_eq!(request.candidate_revision, Some(candidate.revision));

    let proof_base = TailProofBody {
        phase: TailProofPhase::Manifest,
        request_id: request.request_id.ok_or("correlated request id")?,
        from_revision: request.from_revision,
        candidate_revision: candidate.revision,
        candidate_operation_id: candidate.operation_id.clone(),
        head_revision: candidate.revision,
        source_revisions: vec![source.revision],
    };
    assert!(
        kernel
            .step(proof_input(&candidate.context, proof_base.clone())?)?
            .is_empty()
    );
    assert!(kernel.step(authority_entry_input(&source)?)?.is_empty());
    let mut complete = proof_base;
    complete.phase = TailProofPhase::Complete;
    let completed = kernel.step(proof_input(&candidate.context, complete)?)?;
    assert!(completed.iter().any(|effect| matches!(
        effect,
        KernelEffect::ApplyAuthorityMaterial {
            revision: actual,
            operation_id,
            ..
        } if *actual == candidate.revision && operation_id == &candidate.operation_id
    )));
    Ok(())
}

#[test]
fn generic_and_battle_dispatchers_share_protocol_tail_proof_owners() {
    for source in [GENERIC_KERNEL_SOURCE, BATTLE_KERNEL_SOURCE] {
        assert!(source.contains("handle_tail_proof_request"));
        assert!(source.contains("accept_tail_proof"));
        assert!(source.contains("ReplicaAction::RequestTailProof"));
        assert!(source.contains("AuthorityLogAction::TailProof"));
        assert!(!source.contains("ValidatedFrameBody::TailProof(_) => Ok"));
    }
    assert!(GENERIC_KERNEL_SOURCE.contains("dispatch_tail_proof"));
    assert!(BATTLE_KERNEL_SOURCE.contains("receive_tail_proof"));
}
