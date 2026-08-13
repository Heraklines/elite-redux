const AUTHORITY_SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/battle_authority.rs"
));
const KERNEL_SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/battle_kernel.rs"
));

#[test]
fn complete_battle_authorizes_one_terminal_successor() {
    let complete = AUTHORITY_SOURCE
        .find("BattleNextDecision::Complete(outcome)")
        .expect("complete decision projection is present");
    let terminal_wait = AUTHORITY_SOURCE[complete..]
        .find("NextControl::AwaitSuccessor")
        .expect("complete decision must project an AwaitSuccessor")
        + complete;
    let projection = &AUTHORITY_SOURCE[terminal_wait..];
    assert!(projection.contains("allowed_kinds: vec![AuthorityEntryKind::TerminalCommit]"));
    assert!(projection.contains("after_operation_id: predecessor_operation_id.clone()"));
    assert!(projection.contains("expected_operation_id: Some(terminal_operation_id)"));
    assert!(!projection.contains("NextControl::Terminal"));
}

#[test]
fn authority_terminal_publish_is_gated_by_local_and_peer_presentation() {
    assert!(KERNEL_SOURCE.contains("fn maybe_progress_authority_terminal"));
    assert!(KERNEL_SOURCE.contains("pending_ids()"));
    assert!(KERNEL_SOURCE.contains("AckStage::PresentationSettled"));
    assert!(KERNEL_SOURCE.contains("build_battle_terminal_commit_draft"));
    assert!(KERNEL_SOURCE.contains("self.maybe_progress_authority_terminal()?"));
    assert!(KERNEL_SOURCE.contains("BattleTerminalReasonV1::GameOver"));
}

#[test]
fn replica_terminal_path_is_typed_and_never_uses_battle_material_apply() {
    let terminal_branch = KERNEL_SOURCE
        .find("ReplicaAction::ApplyMaterial { entry } => {")
        .expect("terminal replica branch is present");
    let branch = &KERNEL_SOURCE[terminal_branch..];
    assert!(branch.contains("validate_battle_terminal_commit"));
    assert!(branch.contains("ReplicaMechanicalStage::MaterialApplied"));
    assert!(branch.contains("ReplicaMechanicalStage::ControlInstalled"));
    assert!(branch.contains("PresentationProbeOutcome::Settled"));
    assert!(KERNEL_SOURCE.contains("ReplicaAction::EmitReceipt { receipt }"));
    assert!(KERNEL_SOURCE.contains("AckStage::PresentationSettled"));
    let terminal_apply = branch
        .find("apply_authority_material")
        .expect("battle applier remains in the surrounding replica reducer");
    let terminal_validation = branch
        .find("validate_battle_terminal_commit")
        .expect("terminal validation precedes battle applier");
    assert!(terminal_validation < terminal_apply);
}

#[test]
fn terminal_cleanup_preserves_protocol_proofs_and_recovery_applies_battle_first() {
    assert!(KERNEL_SOURCE.contains("fn is_terminal_cleanup_effect"));
    assert!(KERNEL_SOURCE.contains("FrameType::AuthorityReceipt | FrameType::RecoveryApplied"));
    assert!(KERNEL_SOURCE.contains("enum RecoveredMaterial"));
    assert!(KERNEL_SOURCE.contains("self.defer_terminalization = true"));
    assert!(KERNEL_SOURCE.contains("RecoveredMaterial::Terminal"));
    assert!(KERNEL_SOURCE.contains("terminal recovery has neither a preceding battle entry"));
    assert!(KERNEL_SOURCE.contains("replica_has_terminal_predecessor_frontier"));
    assert!(KERNEL_SOURCE.contains("frontier.received == entry.revision"));
    assert!(KERNEL_SOURCE.contains("frontier.received == previous"));
    assert!(KERNEL_SOURCE.contains("frontier.material == previous"));
    assert!(KERNEL_SOURCE.contains("frontier.control == previous"));
}

#[test]
fn recovery_accepts_battle_then_terminal_and_predecessor_frontier_terminal_only_tails() {
    let recovery = KERNEL_SOURCE
        .find("fn apply_recovery_tail")
        .expect("recovery tail applier is present");
    let source = &KERNEL_SOURCE[recovery..];
    assert!(source.contains("RecoveredMaterial::Battle"));
    assert!(source.contains("RecoveredMaterial::Terminal"));
    assert!(source.contains("terminal_final"));
    assert!(source.contains("previous_battle_is_present"));
    assert!(source.contains(
        "!previous_battle_is_present && !terminal_predecessor_frontier_ready"
    ));
}
