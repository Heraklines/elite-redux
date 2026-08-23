const AUTHORITY_SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/battle_authority.rs"
));
const KERNEL_SOURCE: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/battle_kernel.rs"));

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
    let mapper = KERNEL_SOURCE
        .find("fn map_replica_actions(")
        .expect("replica action mapper is present");
    let mapper = &KERNEL_SOURCE[mapper..];
    let apply_arm = mapper
        .find("ReplicaAction::ApplyMaterial { entry } => {")
        .expect("replica material arm is present");
    let terminal_start = apply_arm
        + mapper[apply_arm..]
            .find("if entry.kind == AuthorityEntryKind::TerminalCommit {")
            .expect("terminal material branch is present");
    let terminal_end = terminal_start
        + mapper[terminal_start..]
            .find("let current = BattleMaterialApplyContext {")
            .expect("battle material branch follows terminal material branch");
    let terminal_branch = &mapper[terminal_start..terminal_end];
    assert!(terminal_branch.contains("validate_battle_terminal_commit"));
    assert!(terminal_branch.contains("ReplicaMechanicalStage::MaterialApplied"));
    assert!(!terminal_branch.contains("apply_authority_material"));
    let battle_apply = mapper
        .find("apply_authority_material")
        .expect("battle applier remains in the non-terminal replica arm");
    assert!(terminal_end < battle_apply);

    let control_reducer = KERNEL_SOURCE
        .find("fn reduce_control_installed(")
        .expect("control reducer is present");
    let terminal_control_start = control_reducer
        + KERNEL_SOURCE[control_reducer..]
            .find("else if let Some(pending_terminal) = self.pending_replica_terminal.take() {")
            .expect("terminal control branch is present");
    let regular_control_start = terminal_control_start
        + KERNEL_SOURCE[terminal_control_start..]
            .find("let pending = self.pending_replica_material.take().ok_or_else")
            .expect("regular replica control branch follows terminal control branch");
    let terminal_control = &KERNEL_SOURCE[terminal_control_start..regular_control_start];
    assert!(terminal_control.contains("ReplicaMechanicalStage::ControlInstalled"));

    let probe_arm = mapper
        .find("ReplicaAction::ProbePresentation { entry } => {")
        .expect("replica presentation probe arm is present");
    let terminal_probe_start = probe_arm
        + mapper[probe_arm..]
            .find("if entry.kind == AuthorityEntryKind::TerminalCommit {")
            .expect("terminal presentation probe branch is present");
    let terminal_probe_end = terminal_probe_start
        + mapper[terminal_probe_start..]
            .find("let terminal = TerminalState {")
            .expect("terminal presentation transition follows its probe");
    let terminal_probe = &mapper[terminal_probe_start..terminal_probe_end];
    assert!(terminal_probe.contains("PresentationProbeOutcome::Settled"));
    assert!(KERNEL_SOURCE.contains("ReplicaAction::EmitReceipt { receipt }"));
    assert!(KERNEL_SOURCE.contains("AckStage::PresentationSettled"));
}

#[test]
fn duplicate_complete_probe_replays_settled_only_without_live_presentation() {
    let mapper = KERNEL_SOURCE
        .find("fn map_replica_actions_with_probe_mode(")
        .expect("probe-mode replica mapper is present");
    let probe_start = mapper
        + KERNEL_SOURCE[mapper..]
            .find("ReplicaAction::ProbePresentation { entry } => {")
            .expect("replica presentation probe arm is present");
    let probe_end = probe_start
        + KERNEL_SOURCE[probe_start..]
            .find("ReplicaAction::RequestTail {")
            .expect("probe arm is followed by tail handling");
    let probe = &KERNEL_SOURCE[probe_start..probe_end];
    assert!(probe.contains("duplicate_complete_probe"));
    assert!(probe.contains("pending_replica_material.is_none()"));
    assert!(probe.contains("pending_presentation_probes"));
    assert!(probe.contains("pending_ids()"));
    assert!(probe.contains("event_id.operation_id == entry.operation_id"));
    assert!(probe.contains("PresentationProbeOutcome::Settled"));
    assert!(probe.contains("if let Some(existing) = self"));
    let compact = KERNEL_SOURCE.split_whitespace().collect::<String>();
    assert!(compact.contains(
        "ReplicaAdmission::Duplicate{resume:er_protocol::ReplicaResume::ControlInstalled,}=>self.map_replica_actions_with_probe_mode(step.actions,true),"
    ));
    assert!(compact.contains(
        "ReplicaAdmission::Admitted{..}|ReplicaAdmission::Duplicate{..}|ReplicaAdmission::Gap{..}"
    ));
    assert!(compact.contains("self.map_replica_actions(step.actions)"));
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
    let recovery_start = KERNEL_SOURCE
        .find("fn receive_recovery_bundle(")
        .expect("recovery bundle applier is present");
    let recovery_tail = KERNEL_SOURCE
        .find("fn apply_recovery_tail(")
        .expect("recovery tail applier is present");
    let tail_end = KERNEL_SOURCE
        .find("fn map_replica_actions(")
        .expect("replica action mapper follows recovery tail");
    let tail = &KERNEL_SOURCE[recovery_tail..tail_end];
    let source = &KERNEL_SOURCE[recovery_start..recovery_tail];
    assert!(tail.contains("RecoveredMaterial::Battle"));
    assert!(tail.contains("RecoveredMaterial::Terminal"));
    assert!(source.contains("terminal_final"));
    assert!(
        source.contains(
            "let terminal_final = final_entry.kind == AuthorityEntryKind::TerminalCommit;"
        )
    );
    assert!(source.contains("previous_battle_is_present"));
    assert!(source.contains("!previous_battle_is_present && !terminal_predecessor_frontier_ready"));
}
