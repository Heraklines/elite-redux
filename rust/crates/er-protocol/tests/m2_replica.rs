use std::error::Error;

use er_protocol::{
    AuthorityReplica, AuthorityReplicaConfig, AuthorityReplicaError, ControlProjectionOutcome,
    PresentationProbeOutcome, ReplicaAction, ReplicaAdmission, ReplicaMechanicalStage,
    ReplicaRejectReason, ReplicaResume, ReplicaStep, control_id_of,
};
use er_types::{
    AckStage, AuthorityEntry, AuthorityEntryKind, AuthorityFrontier, AwaitSuccessorControl,
    CommandControlTarget, CommandFrontierControl, ConnectionGeneration, ControlAddress,
    FrameContext, InteractionControlAddress, InteractionSuccessor, Material,
    MaterialApplicationOutcome, MembershipRevision, NextControl, OperationId,
    RecoveredFrontierTerminal, ReplacementControl, ReplacementControlAddress, Revision, RunId,
    SafeU53, SeatId, SessionId, SharedInteractionControl, TerminalControl,
};
use serde_json::json;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test fixture must use a JavaScript-safe integer")
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

fn context(
    sender_seat_id: u64,
    membership_revision: u64,
    connection_generation: u64,
) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("session")?,
        run_id: RunId::new("run")?,
        session_epoch: safe(1),
        seat_map_id: "seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(membership_revision)),
        sender_seat_id: seat(sender_seat_id),
        authority_seat_id: seat(0),
        connection_generation: generation(connection_generation),
    })
}

fn replica() -> TestResult<AuthorityReplica> {
    Ok(AuthorityReplica::new(AuthorityReplicaConfig {
        receipt_context: context(1, 1, 1)?,
        authority_seat_id: seat(0),
        authority_connection_generation: generation(1),
    })?)
}

fn command_control() -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        commands: vec![CommandControlTarget {
            owner_seat_id: seat(1),
            pokemon_id: safe(42),
            field_index: safe(0),
        }],
    })
}

fn replacement_control() -> NextControl {
    NextControl::Replacement(ReplacementControl {
        operation_id: OperationId::new("replace/head").expect("valid replacement operation id"),
        owner_seat_id: seat(1),
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        occurrence: safe(0),
        field_index: safe(0),
        remaining: vec![ReplacementControlAddress {
            operation_id: OperationId::new("replace/tail").expect("valid replacement operation id"),
            owner_seat_id: seat(0),
            epoch: safe(1),
            wave: safe(1),
            turn: safe(1),
            occurrence: safe(1),
            field_index: safe(1),
        }],
    })
}

fn shared_interaction_control() -> NextControl {
    NextControl::SharedInteraction(SharedInteractionControl {
        operation_id: OperationId::new("op/shared/1").expect("valid interaction operation id"),
        owner_seat_id: seat(1),
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        surface_class: "op:me".to_owned(),
        operation_kind: "ME_TERMINAL".to_owned(),
        successor: InteractionSuccessor {
            operation_kinds: vec!["REWARD".to_owned(), "ME_PICK".to_owned()],
            operation_ids: Some(vec![
                OperationId::new("result/2").expect("valid interaction result id"),
                OperationId::new("result/1").expect("valid interaction result id"),
            ]),
        },
    })
}

fn await_successor_control() -> NextControl {
    NextControl::AwaitSuccessor(AwaitSuccessorControl {
        after_operation_id: OperationId::new("after/op").expect("valid wait operation id"),
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        allowed_kinds: vec![
            AuthorityEntryKind::TerminalCommit,
            AuthorityEntryKind::TurnCommit,
            AuthorityEntryKind::ControlCommit,
        ],
        allowed_interaction_addresses: Some(vec![InteractionControlAddress {
            surface_class: "op:me".to_owned(),
            operation_kind: "ME_TERMINAL".to_owned(),
            wave: safe(1),
            turn: safe(1),
        }]),
        allowed_control_addresses: Some(vec![ControlAddress {
            material_kind: "command-open".to_owned(),
            wave: safe(1),
            turn: safe(2),
            operation_id: None,
        }]),
        allow_next_wave_start: true,
        expected_operation_id: Some(
            OperationId::new("next/op").expect("valid expected operation id"),
        ),
    })
}

fn terminal_control() -> NextControl {
    NextControl::Terminal(TerminalControl {
        terminal_id: "terminal/id".to_owned(),
    })
}

fn entry_with(
    value: u64,
    operation_id: &str,
    context: FrameContext,
    kind: AuthorityEntryKind,
    payload: serde_json::Value,
    next_control: NextControl,
) -> TestResult<AuthorityEntry> {
    Ok(AuthorityEntry {
        context,
        revision: revision(value),
        operation_id: OperationId::new(operation_id)?,
        kind,
        material: Material {
            digest: format!("digest-{operation_id}"),
            payload,
        },
        next_control,
        subsumes: Vec::new(),
    })
}

fn entry(value: u64, operation_id: &str) -> TestResult<AuthorityEntry> {
    entry_with(
        value,
        operation_id,
        context(0, 1, 1)?,
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 1, "revision": value, "turn": 1, "wave": 1}),
        command_control(),
    )
}

fn entry_for_context(
    value: u64,
    operation_id: &str,
    membership_revision: u64,
    connection_generation: u64,
) -> TestResult<AuthorityEntry> {
    entry_with(
        value,
        operation_id,
        context(0, membership_revision, connection_generation)?,
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 1, "revision": value, "turn": 1, "wave": 1}),
        command_control(),
    )
}

fn context_variants(
    entry: &AuthorityEntry,
) -> Result<Vec<(&'static str, AuthorityEntry)>, Box<dyn Error>> {
    let mut variants = Vec::new();

    let mut session = entry.clone();
    session.context.session_id = SessionId::new("other-session")?;
    variants.push(("session", session));

    let mut run = entry.clone();
    run.context.run_id = RunId::new("other-run")?;
    variants.push(("run", run));

    let mut epoch = entry.clone();
    epoch.context.session_epoch = safe(2);
    variants.push(("epoch", epoch));

    let mut seat_map = entry.clone();
    seat_map.context.seat_map_id = "other-seat-map".to_owned();
    variants.push(("seat-map", seat_map));

    let mut membership = entry.clone();
    membership.context.membership_revision = MembershipRevision::new(safe(2));
    variants.push(("membership", membership));

    let mut sender = entry.clone();
    sender.context.sender_seat_id = seat(1);
    variants.push(("sender", sender));

    let mut authority = entry.clone();
    authority.context.authority_seat_id = seat(2);
    variants.push(("authority", authority));

    let mut connection = entry.clone();
    connection.context.connection_generation = generation(2);
    variants.push(("connection-generation", connection));

    Ok(variants)
}

fn complete_entry(replica: &mut AuthorityReplica, entry: &AuthorityEntry) -> TestResult {
    assert!(matches!(
        replica.admit(entry.clone()).admission,
        ReplicaAdmission::Admitted { .. }
    ));
    replica.material_result(entry.revision, MaterialApplicationOutcome::Applied)?;
    replica.control_result(
        entry.revision,
        ControlProjectionOutcome::Installed {
            control_id: control_id_of(&entry.next_control),
        },
    )?;
    Ok(())
}

struct RecoveryBoundaryHarness {
    replica: AuthorityReplica,
    material_applied: bool,
    events: Vec<&'static str>,
}

impl RecoveryBoundaryHarness {
    fn new(replica: AuthorityReplica) -> Self {
        Self {
            replica,
            material_applied: false,
            events: Vec::new(),
        }
    }

    fn apply_material_success(&mut self) {
        self.material_applied = true;
        self.events.push("material-application-success");
    }

    fn stage_full_entry(
        &mut self,
        entry: AuthorityEntry,
        expected_control_id: &str,
    ) -> Result<Revision, Box<dyn Error>> {
        if !self.material_applied {
            return Err("full-entry staging was attempted before material success".into());
        }
        self.events.push("full-entry-stage-called");
        let actions = self.replica.stage_recovered_frontier(entry.clone())?;
        assert_eq!(
            actions,
            vec![ReplicaAction::ProjectControl {
                entry: entry.clone(),
                expected_control_id: expected_control_id.to_owned(),
            }]
        );
        self.events.push("staged-revision");
        Ok(entry.revision)
    }
}

#[test]
fn canonical_control_ids_match_the_frozen_wire_addresses() {
    let fixtures = [
        (command_control(), "COMMAND_FRONTIER/e1/w1/t1/f0:s1:p42"),
        (
            replacement_control(),
            "REPLACEMENT/replace%2Fhead/s1/e1/w1/t1/o0/f0/remaining:replace%2Ftail:s0:e1:w1:t1:o1:f1",
        ),
        (
            shared_interaction_control(),
            "SHARED_INTERACTION/op%3Ame/ME_TERMINAL/op%2Fshared%2F1/s1/e1/w1/t1/results:ME_PICK,REWARD/resultIds:result%2F1,result%2F2",
        ),
        (
            await_successor_control(),
            "AWAIT_SUCCESSOR/after%2Fop/e1/w1/t1/TURN_COMMIT,CONTROL_COMMIT,TERMINAL_COMMIT/interactionAddresses:op%3Ame:ME_TERMINAL:w1:t1/controlAddresses:command-open:w1:t2:id*/nextWave:1/next:next%2Fop",
        ),
        (terminal_control(), "TERMINAL/terminal%2Fid"),
    ];

    for (control, expected) in fixtures {
        assert_eq!(control_id_of(&control), expected);
    }
}

#[test]
fn invalid_controls_are_rejected_before_replica_state_or_actions_change() -> TestResult {
    let invalid_controls = vec![
        (
            "command coordinates and field uniqueness",
            NextControl::CommandFrontier(CommandFrontierControl {
                epoch: safe(0),
                wave: safe(1),
                turn: safe(1),
                commands: vec![
                    CommandControlTarget {
                        owner_seat_id: seat(1),
                        pokemon_id: safe(42),
                        field_index: safe(0),
                    },
                    CommandControlTarget {
                        owner_seat_id: seat(0),
                        pokemon_id: safe(43),
                        field_index: safe(0),
                    },
                ],
            }),
        ),
        (
            "replacement chain",
            NextControl::Replacement(ReplacementControl {
                operation_id: OperationId::new("replace/head")
                    .expect("valid replacement operation id"),
                owner_seat_id: seat(1),
                epoch: safe(1),
                wave: safe(1),
                turn: safe(1),
                occurrence: safe(1),
                field_index: safe(0),
                remaining: vec![ReplacementControlAddress {
                    operation_id: OperationId::new("replace/head")
                        .expect("valid replacement operation id"),
                    owner_seat_id: seat(0),
                    epoch: safe(9),
                    wave: safe(1),
                    turn: safe(1),
                    occurrence: safe(1),
                    field_index: safe(1),
                }],
            }),
        ),
        (
            "shared interaction compatibility and successor set",
            NextControl::SharedInteraction(SharedInteractionControl {
                operation_id: OperationId::new("op/shared")
                    .expect("valid interaction operation id"),
                owner_seat_id: seat(1),
                epoch: safe(1),
                wave: safe(1),
                turn: safe(1),
                surface_class: "op:me".to_owned(),
                operation_kind: "NOT_A_V2_OPERATION".to_owned(),
                successor: InteractionSuccessor {
                    operation_kinds: Vec::new(),
                    operation_ids: Some(Vec::new()),
                },
            }),
        ),
        (
            "successor wait addresses",
            NextControl::AwaitSuccessor(AwaitSuccessorControl {
                after_operation_id: OperationId::new("after").expect("valid wait operation id"),
                epoch: safe(1),
                wave: safe(1),
                turn: safe(1),
                allowed_kinds: Vec::new(),
                allowed_interaction_addresses: None,
                allowed_control_addresses: None,
                allow_next_wave_start: false,
                expected_operation_id: None,
            }),
        ),
        (
            "terminal identity",
            NextControl::Terminal(TerminalControl {
                terminal_id: String::new(),
            }),
        ),
    ];

    for (label, next_control) in invalid_controls {
        let mut replica = replica()?;
        let before = replica.diagnostics();
        let invalid = entry_with(
            1,
            label,
            context(0, 1, 1)?,
            AuthorityEntryKind::TurnCommit,
            json!({"epoch": 1, "turn": 1, "wave": 1}),
            next_control,
        )?;
        let result = replica.admit(invalid);
        assert_eq!(
            result.admission,
            ReplicaAdmission::Rejected {
                reason: ReplicaRejectReason::InvalidEntry
            },
            "fixture {label} unexpectedly admitted",
        );
        assert!(
            result.actions.is_empty(),
            "fixture {label} emitted an action"
        );
        assert_eq!(
            replica.diagnostics(),
            before,
            "fixture {label} mutated state"
        );
    }
    Ok(())
}

#[test]
fn authority_entry_strings_use_utf16_and_layered_control_rules() -> TestResult {
    let astral_at_limit = "\u{1f642}".repeat(128);
    let astral_over_limit = "\u{1f642}".repeat(129);

    let mut operation_at_limit = entry(1, "op-utf16")?;
    operation_at_limit.operation_id = OperationId::new(astral_at_limit.clone())?;
    assert!(matches!(
        replica()?.admit(operation_at_limit).admission,
        ReplicaAdmission::Admitted { .. }
    ));

    for control in ['\u{0000}', '\u{001f}', '\u{007f}'] {
        let mut invalid_operation = entry(1, "op-control")?;
        invalid_operation.operation_id = OperationId::new(format!("a{control}b"))?;
        assert_eq!(
            replica()?.admit(invalid_operation).admission,
            ReplicaAdmission::Rejected {
                reason: ReplicaRejectReason::InvalidEntry
            }
        );
    }

    let mut operation_over_limit = entry(1, "op-too-long")?;
    operation_over_limit.operation_id = OperationId::new(astral_over_limit.clone())?;
    assert_eq!(
        replica()?.admit(operation_over_limit).admission,
        ReplicaAdmission::Rejected {
            reason: ReplicaRejectReason::InvalidEntry
        }
    );

    let mut digest_at_limit = entry(1, "digest-utf16")?;
    digest_at_limit.material.digest = astral_at_limit;
    assert!(matches!(
        replica()?.admit(digest_at_limit).admission,
        ReplicaAdmission::Admitted { .. }
    ));

    let mut digest_with_controls = entry(1, "digest-controls")?;
    digest_with_controls.material.digest = "a\u{0000}\u{001f}\u{007f}b".to_owned();
    assert!(matches!(
        replica()?.admit(digest_with_controls).admission,
        ReplicaAdmission::Admitted { .. }
    ));

    let mut digest_over_limit = entry(1, "digest-too-long")?;
    digest_over_limit.material.digest = astral_over_limit;
    assert_eq!(
        replica()?.admit(digest_over_limit).admission,
        ReplicaAdmission::Rejected {
            reason: ReplicaRejectReason::InvalidEntry
        }
    );
    Ok(())
}

#[test]
fn raw_json_lone_utf16_surrogates_are_rejected_at_the_string_boundary() -> TestResult {
    for raw in [r#""\uD800""#, r#""\uDC00""#] {
        assert!(
            serde_json::from_str::<String>(raw).is_err(),
            "raw lone surrogate unexpectedly decoded: {raw}"
        );
    }
    let mut raw_entry = serde_json::to_string(&entry(1, "op-surrogate")?)?;
    raw_entry = raw_entry.replace("op-surrogate", "\\uD800");
    assert!(serde_json::from_str::<AuthorityEntry>(&raw_entry).is_err());
    let paired: String = serde_json::from_str(r#""\uD83D\uDE42""#)?;
    assert_eq!(paired, "🙂");
    Ok(())
}

#[test]
fn global_opaque_context_ids_keep_their_non_empty_only_rule() -> TestResult {
    let mut receipt_context = context(1, 1, 1)?;
    receipt_context.session_id = SessionId::new("session\u{0000}opaque")?;
    receipt_context.run_id = RunId::new("\u{1f642}".repeat(129))?;
    receipt_context.seat_map_id = "seat-map\u{007f}opaque".to_owned();
    let mut entry_context = receipt_context.clone();
    entry_context.sender_seat_id = seat(0);

    let mut replica = AuthorityReplica::new(AuthorityReplicaConfig {
        receipt_context,
        authority_seat_id: seat(0),
        authority_connection_generation: generation(1),
    })?;
    let entry = entry_with(
        1,
        "authority-token",
        entry_context,
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 1, "revision": 1}),
        command_control(),
    )?;
    assert!(matches!(
        replica.admit(entry).admission,
        ReplicaAdmission::Admitted { .. }
    ));
    Ok(())
}

#[test]
fn safe_u53_fixture_helpers_fail_fast_at_the_inclusive_boundary() {
    assert_eq!(safe(SafeU53::MAX.get()), SafeU53::MAX);
    assert!(SafeU53::new(SafeU53::MAX.get() + 1).is_err());
    assert!(std::panic::catch_unwind(|| safe(SafeU53::MAX.get() + 1)).is_err());
}

fn receipt(actions: &[ReplicaAction], stage: AckStage) -> Option<&er_types::AuthorityReceipt> {
    actions.iter().find_map(|action| match action {
        ReplicaAction::EmitReceipt { receipt } if receipt.stage == stage => Some(receipt),
        _ => None,
    })
}

fn has_apply_material(actions: &[ReplicaAction]) -> bool {
    actions
        .iter()
        .any(|action| matches!(action, ReplicaAction::ApplyMaterial { .. }))
}

fn has_project_control(actions: &[ReplicaAction]) -> bool {
    actions
        .iter()
        .any(|action| matches!(action, ReplicaAction::ProjectControl { .. }))
}

#[test]
fn staged_pipeline_keeps_frontiers_independent_and_resumes_exactly() -> TestResult {
    let mut replica = replica()?;
    let first = entry(1, "op-1")?;

    let admitted = replica.admit(first.clone());
    assert_eq!(
        admitted.admission,
        ReplicaAdmission::Admitted {
            resume: ReplicaResume::Admitted
        }
    );
    assert!(has_apply_material(&admitted.actions));
    assert_eq!(
        receipt(&admitted.actions, AckStage::Admitted).map(|receipt| receipt.revision),
        Some(revision(1))
    );
    assert_eq!(replica.received_through(), revision(1));
    assert_eq!(replica.applied_through(), Revision::ZERO);
    assert_eq!(replica.control_installed_through(), Revision::ZERO);

    let duplicate_material = replica.admit(first.clone());
    assert_eq!(
        duplicate_material.admission,
        ReplicaAdmission::Duplicate {
            resume: ReplicaResume::Admitted
        }
    );
    assert!(has_apply_material(&duplicate_material.actions));
    assert_eq!(replica.applied_through(), Revision::ZERO);

    let deferred_material =
        replica.material_result(revision(1), MaterialApplicationOutcome::Deferred)?;
    assert!(deferred_material.is_empty());
    assert_eq!(replica.frontier().material, Revision::ZERO);

    let material = replica.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    assert_eq!(
        receipt(&material, AckStage::MaterialApplied).map(|receipt| receipt.revision),
        Some(revision(1))
    );
    assert!(has_project_control(&material));
    assert_eq!(replica.applied_through(), revision(1));
    assert_eq!(replica.control_installed_through(), Revision::ZERO);

    let duplicate_control = replica.admit(first.clone());
    assert_eq!(
        duplicate_control.admission,
        ReplicaAdmission::Duplicate {
            resume: ReplicaResume::MaterialApplied
        }
    );
    assert!(!has_apply_material(&duplicate_control.actions));
    assert!(has_project_control(&duplicate_control.actions));

    let deferred_control =
        replica.control_result(revision(1), ControlProjectionOutcome::Deferred)?;
    assert!(deferred_control.is_empty());
    assert_eq!(replica.control_installed_through(), Revision::ZERO);

    let control_id = control_id_of(&first.next_control);
    let installed = replica.control_result(
        revision(1),
        ControlProjectionOutcome::AlreadyInstalled {
            control_id: control_id.clone(),
        },
    )?;
    assert_eq!(
        receipt(&installed, AckStage::ControlInstalled)
            .and_then(|receipt| receipt.control_id.as_deref()),
        Some(control_id.as_str())
    );
    assert!(
        installed
            .iter()
            .any(|action| matches!(action, ReplicaAction::ProbePresentation { .. }))
    );
    assert_eq!(replica.frontier().received, revision(1));
    assert_eq!(replica.frontier().material, revision(1));
    assert_eq!(replica.frontier().control, revision(1));
    assert!(replica.pending_entry().is_none());

    let before_duplicate = replica.diagnostics();
    let pending_before_duplicate = replica.pending_entry().cloned();
    let duplicate_complete = replica.admit(first.clone());
    assert_eq!(
        duplicate_complete.admission,
        ReplicaAdmission::Duplicate {
            resume: ReplicaResume::ControlInstalled
        }
    );
    assert!(!has_apply_material(&duplicate_complete.actions));
    assert_eq!(
        receipt(&duplicate_complete.actions, AckStage::ControlInstalled)
            .and_then(|receipt| receipt.control_id.as_deref()),
        Some(control_id.as_str())
    );
    assert!(matches!(
        duplicate_complete.actions.as_slice(),
        [
            ReplicaAction::EmitReceipt { receipt },
            ReplicaAction::ProbePresentation { entry: probe_entry }
        ] if receipt.stage == AckStage::ControlInstalled
            && receipt.control_id.as_deref() == Some(control_id.as_str())
            && probe_entry == &first
    ));
    assert!(!duplicate_complete.actions.iter().any(|action| matches!(
        action,
        ReplicaAction::EmitReceipt {
            receipt: settled,
        } if settled.stage == AckStage::PresentationSettled
    )));
    assert_eq!(replica.diagnostics(), before_duplicate);
    assert_eq!(replica.pending_entry(), pending_before_duplicate.as_ref());

    let duplicate_again = replica.admit(first);
    assert_eq!(duplicate_again, duplicate_complete);
    assert_eq!(replica.diagnostics(), before_duplicate);
    assert_eq!(replica.pending_entry(), pending_before_duplicate.as_ref());
    Ok(())
}

#[test]
fn duplicate_identity_includes_the_complete_material_payload() -> TestResult {
    let mut replica = replica()?;
    let first = entry(1, "op-full-identity")?;
    replica.admit(first.clone());

    let mut pending_conflict = first.clone();
    pending_conflict.material.payload = json!({"epoch": 99, "revision": 1});
    assert_eq!(
        replica.admit(pending_conflict).admission,
        ReplicaAdmission::Rejected {
            reason: ReplicaRejectReason::RevisionIdentityConflict
        }
    );

    replica.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    replica.control_result(
        revision(1),
        ControlProjectionOutcome::Installed {
            control_id: control_id_of(&first.next_control),
        },
    )?;

    let mut complete_conflict = first;
    complete_conflict.material.payload = json!({"epoch": 100, "revision": 1});
    assert_eq!(
        replica.admit(complete_conflict).admission,
        ReplicaAdmission::Rejected {
            reason: ReplicaRejectReason::RevisionIdentityConflict
        }
    );
    Ok(())
}

#[test]
fn every_frame_context_dimension_is_bound_on_stage_duplicates_and_recovery() -> TestResult {
    let first = entry(1, "op-context-identity")?;

    let mut pending = replica()?;
    pending.admit(first.clone());
    for (label, candidate) in context_variants(&first)? {
        let before = pending.diagnostics();
        let pending_before = pending.pending_entry().cloned();
        assert!(
            pending
                .record_replica_stage(&candidate, ReplicaMechanicalStage::MaterialApplied)
                .is_err(),
            "direct stage accepted changed {label}"
        );
        assert_eq!(
            pending.diagnostics(),
            before,
            "direct stage changed {label}"
        );
        assert_eq!(
            pending.pending_entry(),
            pending_before.as_ref(),
            "direct stage changed pending {label}"
        );
    }

    let mut complete = replica()?;
    complete_entry(&mut complete, &first)?;
    for (label, candidate) in context_variants(&first)? {
        let before = complete.diagnostics();
        assert!(
            matches!(
                complete.admit(candidate),
                ReplicaStep {
                    admission: ReplicaAdmission::Rejected { .. },
                    actions
                } if actions.is_empty()
            ),
            "duplicate accepted changed {label}"
        );
        assert_eq!(complete.diagnostics(), before, "duplicate changed {label}");
        assert!(complete.pending_entry().is_none());
    }

    let mut recovery = replica()?;
    recovery.stage_recovered_frontier(first.clone())?;
    for (label, candidate) in context_variants(&first)? {
        let before = recovery.diagnostics();
        let pending_before = recovery.pending_entry().cloned();
        assert!(
            recovery.stage_recovered_frontier(candidate).is_err(),
            "recovery accepted changed {label}"
        );
        assert_eq!(recovery.diagnostics(), before, "recovery changed {label}");
        assert_eq!(
            recovery.pending_entry(),
            pending_before.as_ref(),
            "recovery changed pending {label}"
        );
    }
    recovery.stage_recovered_frontier(first.clone())?;
    recovery.control_result(
        first.revision,
        ControlProjectionOutcome::Installed {
            control_id: control_id_of(&first.next_control),
        },
    )?;
    assert_eq!(recovery.control_installed_through(), first.revision);
    Ok(())
}

#[test]
fn recovery_proof_rejects_complete_material_conflicts_atomically() -> TestResult {
    let mut replica = replica()?;
    let recovered = entry(1, "op-recovery-material")?;
    replica.stage_recovered_frontier(recovered.clone())?;

    let mut payload = recovered.clone();
    payload.material.payload = json!({"epoch": 1, "revision": 1, "turn": 99, "wave": 1});
    let mut digest = recovered.clone();
    digest.material.digest = "digest-recovery-conflict".to_owned();
    let mut operation = recovered.clone();
    operation.operation_id = OperationId::new("op-recovery-conflict")?;
    let mut kind = recovered.clone();
    kind.kind = AuthorityEntryKind::ControlCommit;
    let mut control = recovered.clone();
    control.next_control = replacement_control();
    let mut revision_conflict = recovered.clone();
    revision_conflict.revision = revision(2);
    let mut subsumption = recovered.clone();
    subsumption.subsumes = vec![revision(1)];
    let conflicts = [
        ("payload", payload),
        ("digest", digest),
        ("operation", operation),
        ("kind", kind),
        ("control", control),
        ("revision", revision_conflict),
        ("subsumes", subsumption),
    ];

    let before = replica.diagnostics();
    let pending_before = replica.pending_entry().cloned();
    for (label, candidate) in conflicts {
        assert!(
            matches!(
                replica.stage_recovered_frontier(candidate),
                Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
            ),
            "recovery accepted changed {label}"
        );
        assert_eq!(replica.diagnostics(), before, "recovery changed {label}");
        assert_eq!(
            replica.pending_entry(),
            pending_before.as_ref(),
            "recovery changed pending {label}"
        );
    }

    let staged = replica.stage_recovered_frontier(recovered.clone())?;
    assert!(has_project_control(&staged));
    let after_stage = replica.diagnostics();
    let duplicate = replica.stage_recovered_frontier(recovered.clone())?;
    assert!(has_project_control(&duplicate));
    assert_eq!(replica.diagnostics(), after_stage);
    replica.control_result(
        recovered.revision,
        ControlProjectionOutcome::Installed {
            control_id: control_id_of(&recovered.next_control),
        },
    )?;
    assert_eq!(replica.control_installed_through(), recovered.revision);
    Ok(())
}

#[test]
fn n_plus_one_requires_the_installed_predecessor_control_and_shared_authorization() -> TestResult {
    let mut replica = replica()?;
    let first = entry(1, "op-predecessor")?;
    replica.admit(first.clone());
    replica.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    replica.control_result(
        revision(1),
        ControlProjectionOutcome::Installed {
            control_id: control_id_of(&first.next_control),
        },
    )?;

    let unauthorized = entry_with(
        2,
        "op-unauthorized",
        context(0, 1, 1)?,
        AuthorityEntryKind::ControlCommit,
        json!({"turn": 1, "wave": 1}),
        command_control(),
    )?;
    let before = replica.diagnostics();
    let rejected = replica.admit(unauthorized);
    assert_eq!(
        rejected.admission,
        ReplicaAdmission::Rejected {
            reason: ReplicaRejectReason::PredecessorControlMismatch
        }
    );
    assert!(rejected.actions.is_empty());
    assert_eq!(replica.diagnostics(), before);

    let authorized = replica.admit(entry(2, "op-authorized")?);
    assert!(matches!(
        authorized.admission,
        ReplicaAdmission::Admitted { .. }
    ));
    assert!(has_apply_material(&authorized.actions));
    Ok(())
}

#[test]
fn gap_requests_coalesce_and_n_plus_one_waits_for_control() -> TestResult {
    let mut replica = replica()?;
    let third = entry(3, "op-3")?;
    let fourth = entry(4, "op-4")?;

    let first_gap = replica.admit(third);
    assert_eq!(
        first_gap.admission,
        ReplicaAdmission::Gap {
            missing_from: revision(1)
        }
    );
    assert_eq!(
        first_gap
            .actions
            .iter()
            .filter(|action| matches!(action, ReplicaAction::RequestTail { .. }))
            .count(),
        1
    );
    let second_gap = replica.admit(fourth);
    assert!(second_gap.actions.is_empty());
    assert_eq!(replica.diagnostics().requested_tail_from, Some(revision(1)));

    let first = entry(1, "op-1")?;
    assert!(matches!(
        replica.admit(first.clone()).admission,
        ReplicaAdmission::Admitted { .. }
    ));
    let blocked_successor = replica.admit(entry(2, "op-2")?);
    assert_eq!(
        blocked_successor.admission,
        ReplicaAdmission::Gap {
            missing_from: revision(1)
        }
    );
    assert!(blocked_successor.actions.is_empty());

    replica.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    let still_blocked = replica.admit(entry(2, "op-2b")?);
    assert_eq!(
        still_blocked.admission,
        ReplicaAdmission::Gap {
            missing_from: revision(1)
        }
    );
    assert!(still_blocked.actions.is_empty());

    let control_id = control_id_of(&first.next_control);
    replica.control_result(
        revision(1),
        ControlProjectionOutcome::Installed { control_id },
    )?;
    let new_gap = replica.admit(entry(3, "op-3b")?);
    assert_eq!(
        new_gap.admission,
        ReplicaAdmission::Gap {
            missing_from: revision(2)
        }
    );
    assert_eq!(
        new_gap
            .actions
            .iter()
            .filter(|action| matches!(action, ReplicaAction::RequestTail { .. }))
            .count(),
        1
    );
    assert_eq!(replica.diagnostics().requested_tail_from, Some(revision(2)));
    Ok(())
}

#[test]
fn invalid_stage_transitions_fail_closed_without_frontier_mutation() -> TestResult {
    let mut replica = replica()?;
    let first = entry(1, "op-invalid")?;
    replica.admit(first.clone());
    let before_control = replica.diagnostics();

    let control_before_material = replica.control_result(
        revision(1),
        ControlProjectionOutcome::Installed {
            control_id: control_id_of(&first.next_control),
        },
    );
    assert!(control_before_material.is_err());
    assert_eq!(replica.diagnostics(), before_control);

    replica.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    let duplicate_material =
        replica.material_result(revision(1), MaterialApplicationOutcome::Applied);
    assert!(duplicate_material.is_err());
    assert_eq!(replica.frontier().material, revision(1));
    assert_eq!(replica.frontier().control, Revision::ZERO);

    let wrong_control = replica.control_result(
        revision(1),
        ControlProjectionOutcome::Installed {
            control_id: "wrong-control".to_owned(),
        },
    );
    assert!(wrong_control.is_err());
    assert_eq!(replica.frontier().control, Revision::ZERO);

    let rejected_material = replica.material_result(
        revision(1),
        MaterialApplicationOutcome::Rejected {
            reason: "digest mismatch".to_owned(),
        },
    );
    assert!(rejected_material.is_err());
    assert_eq!(replica.frontier().material, revision(1));

    let wrong_revision =
        replica.presentation_result(revision(9), PresentationProbeOutcome::Settled);
    assert!(wrong_revision.is_err());
    Ok(())
}

#[test]
fn generation_only_rebind_updates_pending_context_and_resumes() -> TestResult {
    let mut replica = replica()?;
    let first = entry(1, "op-rebind")?;
    replica.admit(first);

    replica.rebind_connection(context(1, 1, 2)?, generation(2))?;
    let expected_control_id = {
        let Some(pending) = replica.pending_entry() else {
            return Err("missing pending entry after connection rebind".into());
        };
        assert_eq!(pending.context.session_id.as_str(), "session");
        assert_eq!(pending.context.run_id.as_str(), "run");
        assert_eq!(pending.context.session_epoch, safe(1));
        assert_eq!(pending.context.seat_map_id, "seat-map");
        assert_eq!(
            pending.context.membership_revision,
            MembershipRevision::new(safe(1))
        );
        assert_eq!(pending.context.sender_seat_id, seat(0));
        assert_eq!(pending.context.authority_seat_id, seat(0));
        assert_eq!(pending.context.connection_generation, generation(2));
        control_id_of(&pending.next_control)
    };

    let material = replica.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    let Some(material_receipt) = receipt(&material, AckStage::MaterialApplied) else {
        return Err("missing material receipt after connection rebind".into());
    };
    assert_eq!(material_receipt.context.sender_seat_id, seat(1));
    assert_eq!(
        material_receipt.context.membership_revision,
        MembershipRevision::new(safe(1))
    );
    assert_eq!(
        material_receipt.context.connection_generation,
        generation(2)
    );

    let control = replica.control_result(
        revision(1),
        ControlProjectionOutcome::Installed {
            control_id: expected_control_id,
        },
    )?;
    let Some(control_receipt) = receipt(&control, AckStage::ControlInstalled) else {
        return Err("missing control receipt after connection rebind".into());
    };
    assert_eq!(control_receipt.context.sender_seat_id, seat(1));
    assert_eq!(
        control_receipt.context.membership_revision,
        MembershipRevision::new(safe(1))
    );
    assert_eq!(control_receipt.context.connection_generation, generation(2));
    assert_eq!(
        replica.frontier(),
        AuthorityFrontier {
            received: revision(1),
            material: revision(1),
            control: revision(1),
        }
    );
    Ok(())
}

#[test]
fn rebind_accepts_monotonic_membership_and_generation_and_updates_pending_context() -> TestResult {
    let mut replica = replica()?;
    let first = entry(1, "op-membership-rebind")?;
    replica.admit(first);

    replica.rebind_connection(context(1, 2, 2)?, generation(2))?;
    let expected_control_id = {
        let Some(pending) = replica.pending_entry() else {
            return Err("missing pending entry after monotonic rebind".into());
        };
        assert_eq!(
            pending.context.membership_revision,
            MembershipRevision::new(safe(2))
        );
        assert_eq!(pending.context.connection_generation, generation(2));
        control_id_of(&pending.next_control)
    };

    let material = replica.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    let Some(material_receipt) = receipt(&material, AckStage::MaterialApplied) else {
        return Err("missing material receipt after monotonic rebind".into());
    };
    assert_eq!(
        material_receipt.context.membership_revision,
        MembershipRevision::new(safe(2))
    );
    assert_eq!(
        material_receipt.context.connection_generation,
        generation(2)
    );
    let control = replica.control_result(
        revision(1),
        ControlProjectionOutcome::Installed {
            control_id: expected_control_id,
        },
    )?;
    let Some(control_receipt) = receipt(&control, AckStage::ControlInstalled) else {
        return Err("missing control receipt after monotonic rebind".into());
    };
    assert_eq!(
        control_receipt.context.membership_revision,
        MembershipRevision::new(safe(2))
    );
    assert_eq!(control_receipt.context.connection_generation, generation(2));

    replica.rebind_connection(context(1, 2, 3)?, generation(2))?;
    let rebound_duplicate = replica.admit(entry_for_context(1, "op-membership-rebind", 2, 2)?);
    assert!(matches!(
        rebound_duplicate.admission,
        ReplicaAdmission::Duplicate {
            resume: ReplicaResume::ControlInstalled
        }
    ));
    let before_old_context_duplicate = replica.diagnostics();
    let old_context_duplicate = replica.admit(entry(1, "op-membership-rebind")?);
    assert!(matches!(
        old_context_duplicate.admission,
        ReplicaAdmission::Rejected { .. }
    ));
    assert_eq!(replica.diagnostics(), before_old_context_duplicate);
    let accepted_after_rebind = replica.admit(entry_for_context(2, "op-after-rebind", 2, 2)?);
    assert!(matches!(
        accepted_after_rebind.admission,
        ReplicaAdmission::Admitted { .. }
    ));
    Ok(())
}

#[test]
fn successful_rebind_clears_pending_gap_request_and_allows_the_same_request_again() -> TestResult {
    let mut replica = replica()?;
    let first_gap = replica.admit(entry(3, "op-gap")?);
    assert_eq!(
        first_gap.admission,
        ReplicaAdmission::Gap {
            missing_from: revision(1)
        }
    );
    assert_eq!(replica.diagnostics().requested_tail_from, Some(revision(1)));

    replica.rebind_connection(context(1, 2, 2)?, generation(2))?;
    assert_eq!(replica.diagnostics().requested_tail_from, None);

    let retried_gap = replica.admit(entry_for_context(3, "op-gap", 2, 2)?);
    assert_eq!(
        retried_gap.admission,
        ReplicaAdmission::Gap {
            missing_from: revision(1)
        }
    );
    assert_eq!(
        retried_gap
            .actions
            .iter()
            .filter(|action| matches!(action, ReplicaAction::RequestTail { .. }))
            .count(),
        1
    );
    Ok(())
}

#[test]
fn rebind_rejects_membership_generation_and_stable_axis_rollbacks_without_mutation() -> TestResult {
    let mut replica = replica()?;
    replica.admit(entry(1, "op-rebind-rollback")?);

    for (next_context, next_authority_generation) in [
        (context(1, 0, 2)?, generation(2)),
        (context(1, 1, 0)?, generation(1)),
        (context(2, 1, 2)?, generation(2)),
    ] {
        let before_frontier = replica.frontier();
        let before_pending = replica.pending_entry().cloned();
        let before_diagnostics = replica.diagnostics();
        let rejected = replica.rebind_connection(next_context, next_authority_generation);
        assert!(matches!(
            rejected,
            Err(AuthorityReplicaError::InvalidStage { .. })
        ));
        assert_eq!(replica.frontier(), before_frontier);
        assert_eq!(replica.pending_entry(), before_pending.as_ref());
        assert_eq!(replica.diagnostics(), before_diagnostics);
    }
    Ok(())
}

#[test]
fn receipts_preserve_receiving_context_and_serde_omission_rules() -> TestResult {
    let mut replica = replica()?;
    let first = entry(1, "op-receipt")?;
    let admitted = replica.admit(first.clone());
    let Some(admitted_receipt) = receipt(&admitted.actions, AckStage::Admitted) else {
        return Err("missing admitted receipt".into());
    };
    assert_eq!(admitted_receipt.context.sender_seat_id, seat(1));
    assert_eq!(admitted_receipt.context.authority_seat_id, seat(0));
    let admitted_json = serde_json::to_value(admitted_receipt)?;
    assert!(
        !admitted_json
            .as_object()
            .is_some_and(|object| object.contains_key("controlId"))
    );

    replica.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    let control_id = control_id_of(&first.next_control);
    let installed = replica.control_result(
        revision(1),
        ControlProjectionOutcome::Installed {
            control_id: control_id.clone(),
        },
    )?;
    let Some(control_receipt) = receipt(&installed, AckStage::ControlInstalled) else {
        return Err("missing control receipt".into());
    };
    let control_json = serde_json::to_value(control_receipt)?;
    assert_eq!(
        control_json
            .get("controlId")
            .and_then(|value| value.as_str()),
        Some(control_id.as_str())
    );
    assert!(
        !control_json
            .get("controlId")
            .is_some_and(serde_json::Value::is_null)
    );

    let settled = replica.presentation_result(revision(1), PresentationProbeOutcome::Settled)?;
    assert_eq!(
        receipt(&settled, AckStage::PresentationSettled)
            .map(|receipt| receipt.operation_id.as_str()),
        Some("op-receipt")
    );
    Ok(())
}

#[test]
fn fresh_gap_recovery_stages_full_entry_and_then_unblocks_tail() -> TestResult {
    let mut replica = replica()?;
    let recovered = entry(7, "op-recovered")?;
    let gap = replica.admit(recovered.clone());
    assert_eq!(
        gap.admission,
        ReplicaAdmission::Gap {
            missing_from: revision(1)
        }
    );

    replica.rebind_connection(context(1, 2, 2)?, generation(2))?;
    let rebound_recovered = entry_with(
        7,
        "op-recovered",
        context(0, 2, 2)?,
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 1, "revision": 7, "turn": 1, "wave": 1}),
        recovered.next_control.clone(),
    )?;
    let staged = replica.stage_recovered_frontier(rebound_recovered.clone())?;
    assert!(has_project_control(&staged));
    assert_eq!(replica.frontier().received, revision(7));
    assert_eq!(replica.frontier().material, revision(7));
    assert_eq!(replica.frontier().control, revision(6));
    assert_eq!(
        replica.pending_entry().map(|entry| entry.revision),
        Some(revision(7))
    );
    assert_eq!(
        replica
            .pending_entry()
            .map(|entry| entry.context.membership_revision),
        Some(MembershipRevision::new(safe(2)))
    );

    let blocked = replica.admit(entry_for_context(8, "op-too-early", 2, 2)?);
    assert_eq!(
        blocked.admission,
        ReplicaAdmission::Gap {
            missing_from: revision(7)
        }
    );
    let control_id = control_id_of(&recovered.next_control);
    replica.control_result(
        revision(7),
        ControlProjectionOutcome::Installed { control_id },
    )?;
    assert_eq!(replica.frontier().control, revision(7));
    assert!(matches!(
        replica
            .admit(entry_for_context(8, "op-next", 2, 2)?)
            .admission,
        ReplicaAdmission::Admitted { .. }
    ));
    Ok(())
}

#[test]
fn fresh_recovered_stage_rejects_malformed_identity_and_context_atomically() -> TestResult {
    let recovered = entry(4, "op-fresh-recovered-adversarial")?;

    let mut malformed_context = recovered.clone();
    malformed_context.context.seat_map_id.clear();

    let mut context_conflict = recovered.clone();
    context_conflict.context.session_id = SessionId::new("other-session")?;

    let mut malformed_digest = recovered.clone();
    malformed_digest.material.digest.clear();

    let mut oversized_digest = recovered.clone();
    oversized_digest.material.digest = "d".repeat(257);

    let mut malformed_operation = recovered.clone();
    malformed_operation.operation_id = OperationId::new("bad\u{0000}operation")?;

    let mut malformed_subsumption = recovered.clone();
    malformed_subsumption.subsumes = vec![Revision::ZERO];

    let mut incompatible_successor = recovered.clone();
    incompatible_successor.kind = AuthorityEntryKind::TerminalCommit;

    let candidates = vec![
        ("malformed context", malformed_context),
        ("context conflict", context_conflict),
        ("empty digest", malformed_digest),
        ("oversized digest", oversized_digest),
        ("malformed operation", malformed_operation),
        ("zero subsumption", malformed_subsumption),
        ("incompatible successor", incompatible_successor),
    ];

    for (label, candidate) in candidates {
        let mut replica = replica()?;
        let before = replica.diagnostics();
        assert!(
            matches!(
                replica.stage_recovered_frontier(candidate),
                Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
            ),
            "fresh recovery accepted {label}"
        );
        assert_eq!(
            replica.diagnostics(),
            before,
            "fresh recovery changed {label}"
        );
        assert_eq!(replica.frontier(), AuthorityFrontier::default());
        assert!(replica.pending_entry().is_none());
    }

    // Material.payload is an opaque serde_json::Value in the frozen typed
    // contract; malformed payload bytes are rejected before this callable.
    // Payload identity conflicts are exercised by the staged conflict test.
    let mut replica = replica()?;
    replica.stage_recovered_frontier(recovered.clone())?;
    let mut identity_conflict = recovered.clone();
    identity_conflict.next_control = replacement_control();
    let before_conflict = replica.diagnostics();
    let pending_before_conflict = replica.pending_entry().cloned();
    assert!(matches!(
        replica.stage_recovered_frontier(identity_conflict),
        Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
    ));
    assert_eq!(replica.diagnostics(), before_conflict);
    assert_eq!(replica.pending_entry(), pending_before_conflict.as_ref());
    Ok(())
}

#[test]
fn recovery_staging_seam_requires_full_entry_before_staged_signal() -> TestResult {
    // This is the M2-04 callable ordering contract. M2B-01 must separately
    // prove that the future GameKernel dispatch uses this boundary ordering.
    let recovered = entry(3, "op-recovery-call-order")?;
    let terminal = RecoveredFrontierTerminal {
        operation_id: OperationId::new("op-recovery-call-order")?,
        next_control: command_control(),
    };
    let mut harness = RecoveryBoundaryHarness::new(replica()?);
    let before_terminal_only = harness.replica.diagnostics();
    harness.events.push("terminal-only-adopt-attempt");
    assert!(matches!(
        harness.replica.adopt_frontier(revision(3), Some(terminal)),
        Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
    ));
    harness.events.push("terminal-only-adopt-rejected");
    assert_eq!(harness.replica.diagnostics(), before_terminal_only);
    assert!(
        harness
            .stage_full_entry(recovered.clone(), "COMMAND_FRONTIER/e1/w1/t1/f0:s1:p42")
            .is_err()
    );

    harness.apply_material_success();
    assert_eq!(
        harness.stage_full_entry(recovered.clone(), "COMMAND_FRONTIER/e1/w1/t1/f0:s1:p42")?,
        revision(3)
    );
    assert_eq!(
        harness.events,
        vec![
            "terminal-only-adopt-attempt",
            "terminal-only-adopt-rejected",
            "material-application-success",
            "full-entry-stage-called",
            "staged-revision",
        ]
    );
    assert_eq!(
        harness.replica.frontier(),
        AuthorityFrontier {
            received: revision(3),
            material: revision(3),
            control: revision(2),
        }
    );
    assert_eq!(harness.replica.pending_entry(), Some(&recovered));
    Ok(())
}

#[test]
fn recovery_zero_equal_and_complete_terminal_cases_are_atomic() -> TestResult {
    let mut recovery_replica = replica()?;
    let zero_before = recovery_replica.diagnostics();
    recovery_replica.adopt_frontier(Revision::ZERO, None)?;
    assert_eq!(recovery_replica.diagnostics(), zero_before);
    assert!(matches!(
        recovery_replica.adopt_frontier(
            Revision::ZERO,
            Some(RecoveredFrontierTerminal {
                operation_id: OperationId::new("op-zero-proof")?,
                next_control: command_control(),
            }),
        ),
        Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
    ));
    assert_eq!(recovery_replica.diagnostics(), zero_before);

    let mut admitted_frontier = replica()?;
    let admitted_entry = entry(1, "op-admitted-terminal-only")?;
    assert!(matches!(
        admitted_frontier.admit(admitted_entry.clone()).admission,
        ReplicaAdmission::Admitted { .. }
    ));
    let admitted_before = admitted_frontier.diagnostics();
    assert!(matches!(
        admitted_frontier.adopt_frontier(
            admitted_entry.revision,
            Some(RecoveredFrontierTerminal {
                operation_id: admitted_entry.operation_id.clone(),
                next_control: admitted_entry.next_control.clone(),
            }),
        ),
        Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
    ));
    assert_eq!(admitted_frontier.diagnostics(), admitted_before);
    assert_eq!(admitted_frontier.pending_entry(), Some(&admitted_entry));

    let mut equal_frontier = replica()?;
    let equal_entry = entry(1, "op-equal-frontier")?;
    equal_frontier.admit(equal_entry.clone());
    equal_frontier.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    equal_frontier.control_result(
        revision(1),
        ControlProjectionOutcome::Installed {
            control_id: control_id_of(&equal_entry.next_control),
        },
    )?;
    let equal_before = equal_frontier.diagnostics();
    equal_frontier.adopt_frontier(revision(1), None)?;
    assert_eq!(equal_frontier.diagnostics(), equal_before);
    let equal_terminal_before = equal_frontier.diagnostics();
    assert!(matches!(
        equal_frontier.adopt_frontier(
            revision(1),
            Some(RecoveredFrontierTerminal {
                operation_id: equal_entry.operation_id.clone(),
                next_control: equal_entry.next_control.clone(),
            }),
        ),
        Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
    ));
    assert_eq!(equal_frontier.diagnostics(), equal_terminal_before);

    let before_proof = recovery_replica.diagnostics();
    assert!(matches!(
        recovery_replica.adopt_frontier(revision(7), None),
        Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
    ));
    assert_eq!(recovery_replica.diagnostics(), before_proof);

    let recovered = entry(7, "op-exact-recovery")?;
    let terminal = RecoveredFrontierTerminal {
        operation_id: recovered.operation_id.clone(),
        next_control: recovered.next_control.clone(),
    };
    assert!(matches!(
        recovery_replica.adopt_frontier(revision(7), Some(terminal.clone())),
        Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
    ));
    assert_eq!(recovery_replica.diagnostics(), before_proof);

    let staged = recovery_replica.stage_recovered_frontier(recovered.clone())?;
    assert!(has_project_control(&staged));
    assert_eq!(
        recovery_replica.frontier(),
        AuthorityFrontier {
            received: revision(7),
            material: revision(7),
            control: revision(6),
        }
    );
    let exact_staging = recovery_replica.diagnostics();
    recovery_replica.adopt_frontier(revision(7), Some(terminal.clone()))?;
    assert_eq!(recovery_replica.diagnostics(), exact_staging);

    let conflicting_terminal = RecoveredFrontierTerminal {
        operation_id: OperationId::new("op-conflicting-proof")?,
        next_control: recovered.next_control.clone(),
    };
    assert!(matches!(
        recovery_replica.adopt_frontier(revision(7), Some(conflicting_terminal)),
        Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
    ));
    assert_eq!(recovery_replica.diagnostics(), exact_staging);
    assert_eq!(recovery_replica.pending_entry(), Some(&recovered));

    let mut conflicting_entry = recovered.clone();
    conflicting_entry.material.payload = json!({"epoch": 1, "revision": 7, "turn": 99});
    let before_conflict = recovery_replica.diagnostics();
    let pending_before_conflict = recovery_replica.pending_entry().cloned();
    assert!(matches!(
        recovery_replica.stage_recovered_frontier(conflicting_entry),
        Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
    ));
    assert_eq!(recovery_replica.diagnostics(), before_conflict);
    assert_eq!(
        recovery_replica.pending_entry(),
        pending_before_conflict.as_ref()
    );

    let duplicate_stage = recovery_replica.stage_recovered_frontier(recovered.clone())?;
    assert!(has_project_control(&duplicate_stage));
    assert_eq!(recovery_replica.diagnostics(), before_conflict);
    let control_id = control_id_of(&recovered.next_control);
    recovery_replica.control_result(
        revision(7),
        ControlProjectionOutcome::Installed { control_id },
    )?;
    assert_eq!(recovery_replica.frontier().control, revision(7));
    Ok(())
}

#[test]
fn old_complete_duplicates_fail_closed_without_a_retained_revision_entry() -> TestResult {
    let mut replica = replica()?;
    let recovered = entry(7, "op-recovery-old-duplicate")?;
    replica.stage_recovered_frontier(recovered.clone())?;
    replica.control_result(
        revision(7),
        ControlProjectionOutcome::Installed {
            control_id: control_id_of(&recovered.next_control),
        },
    )?;

    let old = entry(1, "op-old-duplicate")?;
    assert_eq!(
        replica.admit(old).admission,
        ReplicaAdmission::Rejected {
            reason: ReplicaRejectReason::RevisionIdentityConflict
        }
    );
    Ok(())
}

#[test]
fn maximum_frontiers_are_checked_without_safe_integer_overflow() -> TestResult {
    let maximum = Revision::new(SafeU53::MAX);
    let mut replica = replica()?;
    assert_eq!(replica.missing_from(), revision(1));
    assert_eq!(
        replica
            .admit(entry_with(
                SafeU53::MAX.get(),
                "op-max-gap",
                context(0, 1, 1)?,
                AuthorityEntryKind::TurnCommit,
                json!({"epoch": 1, "revision": SafeU53::MAX.get()}),
                command_control(),
            )?)
            .admission,
        ReplicaAdmission::Gap {
            missing_from: revision(1)
        }
    );

    let recovered = entry_with(
        SafeU53::MAX.get(),
        "op-max-frontier",
        context(0, 1, 1)?,
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 1, "revision": SafeU53::MAX.get()}),
        command_control(),
    )?;
    let terminal = RecoveredFrontierTerminal {
        operation_id: recovered.operation_id.clone(),
        next_control: recovered.next_control.clone(),
    };
    let before_partial_adoption = replica.diagnostics();
    assert!(matches!(
        replica.adopt_frontier(maximum, Some(terminal)),
        Err(AuthorityReplicaError::InvalidRecoveryFrontier { .. })
    ));
    assert_eq!(replica.diagnostics(), before_partial_adoption);
    replica.stage_recovered_frontier(recovered.clone())?;
    assert_eq!(replica.frontier().received, maximum);
    assert_eq!(replica.frontier().material, maximum);
    assert_eq!(
        replica.frontier().control,
        Revision::new(safe(SafeU53::MAX.get() - 1))
    );
    replica.control_result(
        maximum,
        ControlProjectionOutcome::Installed {
            control_id: control_id_of(&recovered.next_control),
        },
    )?;
    assert_eq!(replica.frontier().control, maximum);
    assert_eq!(replica.missing_from(), Revision::ZERO);
    assert_eq!(
        replica.classify(maximum),
        er_protocol::ReplicaClassification::DuplicateComplete
    );
    Ok(())
}

#[test]
fn stale_and_duplicate_stage_inputs_fail_without_frontier_changes() -> TestResult {
    let mut replica = replica()?;
    let first = entry(1, "op-stage-inputs")?;
    replica.admit(first.clone());
    let before = replica.diagnostics();
    assert!(matches!(
        replica.material_result(revision(2), MaterialApplicationOutcome::Deferred),
        Err(AuthorityReplicaError::WrongPendingRevision { revision: got }) if got == revision(2)
    ));
    assert!(matches!(
        replica.record_replica_stage(&entry(2, "op-stale-stage")?, ReplicaMechanicalStage::MaterialApplied),
        Err(AuthorityReplicaError::WrongPendingRevision { revision: got }) if got == revision(2)
    ));
    assert_eq!(replica.diagnostics(), before);

    replica.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    assert!(
        replica
            .record_replica_stage(&first, ReplicaMechanicalStage::MaterialApplied)
            .is_err()
    );
    assert_eq!(replica.frontier().material, revision(1));
    Ok(())
}

#[test]
fn disposal_clears_pending_and_tombstones_idempotently() -> TestResult {
    let mut replica = replica()?;
    let first = entry(1, "op-dispose")?;
    replica.admit(first.clone());
    replica.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    let control_id = control_id_of(&first.next_control);
    replica.control_result(
        revision(1),
        ControlProjectionOutcome::Installed { control_id },
    )?;
    assert!(!replica.diagnostics().installed_control_ids.is_empty());

    replica.dispose("test teardown");
    replica.dispose("duplicate teardown");
    let diagnostics = replica.diagnostics();
    assert!(diagnostics.disposed);
    assert!(diagnostics.installed_control_ids.is_empty());
    assert!(replica.pending_entry().is_none());
    assert_eq!(
        replica.admit(first.clone()).admission,
        ReplicaAdmission::Rejected {
            reason: ReplicaRejectReason::Disposed
        }
    );
    assert!(matches!(
        replica.material_result(revision(1), MaterialApplicationOutcome::Deferred),
        Err(AuthorityReplicaError::Disposed)
    ));
    assert!(matches!(
        replica.control_result(revision(1), ControlProjectionOutcome::Deferred,),
        Err(AuthorityReplicaError::Disposed)
    ));
    assert!(matches!(
        replica.presentation_result(revision(1), PresentationProbeOutcome::Settled),
        Err(AuthorityReplicaError::Disposed)
    ));
    assert!(matches!(
        replica.record_replica_stage(&first, ReplicaMechanicalStage::MaterialApplied),
        Err(AuthorityReplicaError::Disposed)
    ));
    assert!(matches!(
        replica.adopt_frontier(revision(2), None),
        Err(AuthorityReplicaError::Disposed)
    ));
    assert!(matches!(
        replica.stage_recovered_frontier(first),
        Err(AuthorityReplicaError::Disposed)
    ));
    assert!(matches!(
        replica.rebind_connection(context(1, 2, 2)?, generation(2)),
        Err(AuthorityReplicaError::Disposed)
    ));
    Ok(())
}
