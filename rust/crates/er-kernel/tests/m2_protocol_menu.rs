use std::error::Error;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, GameKernel, KernelConfig, KernelEffect, KernelError,
    KernelInput, MenuProposalPlan, ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityEntryDraft, AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding,
    ProposalLeaseConfig, RecoveryTransactionConfig, control_id_of,
};
use er_types::{
    AckStage, AuthorityEntry, AuthorityEntryBody, AuthorityEntryKind, AuthorityReceiptBody,
    CancelPolicy, CommandControlTarget, CommandFrontierControl, ConnectionGeneration,
    ControlProjectionOutcome, FRAME_PROTOCOL_VERSION, FrameContext, FrameType, GameButton,
    InputFocus, InputMap, InteractionSuccessor, KeyBinding, Material, MaterialApplicationOutcome,
    MenuGeneration, MenuOption, MenuOptionId, MenuState, NextControl, OperationId, PhysicalKey,
    ProposalMessage, RawInputEvent, RecoveryAppliedProof, RecoveryBundleBody, RecoveryRequestBody,
    ReplacementControl, Revision, RunId, SafeU53, SeatId, SessionId, SharedInteractionControl,
    TerminalFrameBody, TerminalMenu, TransportState, UiState, WaitingMenu,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

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

fn operation(value: &str) -> TestResult<OperationId> {
    Ok(OperationId::new(value.to_owned())?)
}

fn context(sender: u64, authority: u64, connection_generation: u64) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("m2-kernel-session")?,
        run_id: RunId::new("m2-kernel-run")?,
        session_epoch: safe(1),
        seat_map_id: "m2-kernel-seat-map".to_owned(),
        membership_revision: er_types::MembershipRevision::new(safe(1)),
        sender_seat_id: seat(sender),
        authority_seat_id: seat(authority),
        connection_generation: generation(connection_generation),
    })
}

fn input_map() -> InputMap {
    InputMap {
        keyboard: vec![KeyBinding {
            key: PhysicalKey::Enter,
            button: GameButton::Submit,
        }],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: safe(250),
        repeat_interval_ms: safe(250),
    }
}

fn option(id: &str) -> TestResult<MenuOption> {
    Ok(MenuOption {
        id: MenuOptionId::new(id.to_owned())?,
        label_key: format!("m2.{id}"),
        enabled: true,
        visible: true,
    })
}

fn command_control(owner: u64, pokemon: u64, turn: u64) -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1),
        wave: safe(1),
        turn: safe(turn),
        commands: vec![CommandControlTarget {
            owner_seat_id: seat(owner),
            pokemon_id: safe(pokemon),
            field_index: safe(0),
        }],
    })
}

fn replacement_control(operation_id: &OperationId) -> NextControl {
    NextControl::Replacement(ReplacementControl {
        operation_id: operation_id.clone(),
        owner_seat_id: seat(0),
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        occurrence: safe(0),
        field_index: safe(0),
        remaining: Vec::new(),
    })
}

fn interaction_control(operation_id: &OperationId) -> NextControl {
    interaction_control_for_owner(0, operation_id)
}

fn interaction_control_for_owner(owner: u64, operation_id: &OperationId) -> NextControl {
    NextControl::SharedInteraction(SharedInteractionControl {
        operation_id: operation_id.clone(),
        owner_seat_id: seat(owner),
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        surface_class: "op:ability".to_owned(),
        operation_kind: "ABILITY_PICK".to_owned(),
        successor: InteractionSuccessor {
            operation_kinds: vec!["ABILITY_PICK".to_owned()],
            operation_ids: None,
        },
    })
}

fn command_plan(
    control: &NextControl,
    operation_id: &OperationId,
    with_proposal: bool,
) -> TestResult<ControlMenuPlan> {
    let NextControl::CommandFrontier(control) = control else {
        return Err("command plan requires command control".into());
    };
    let target = control
        .commands
        .first()
        .ok_or("command plan requires a command target")?;
    Ok(ControlMenuPlan::Command {
        control_id: control_id_of(&NextControl::CommandFrontier(control.clone())),
        owner_seat_id: target.owner_seat_id,
        operation_id: operation_id.clone(),
        field_index: target.field_index,
        options: vec![option("accept")?],
        proposals: if with_proposal {
            vec![MenuProposalPlan {
                option_id: MenuOptionId::new("accept")?,
                fingerprint: "fp".to_owned(),
                payload: json!({"choice": "accept"}),
            }]
        } else {
            Vec::new()
        },
        cancel: CancelPolicy::Disabled,
    })
}

fn interaction_plan_with_proposal(
    control: &NextControl,
    operation_id: &OperationId,
) -> TestResult<ControlMenuPlan> {
    let NextControl::SharedInteraction(control) = control else {
        return Err("interaction plan requires interaction control".into());
    };
    Ok(ControlMenuPlan::Interaction {
        control_id: control_id_of(&NextControl::SharedInteraction(control.clone())),
        owner_seat_id: control.owner_seat_id,
        operation_id: operation_id.clone(),
        surface_class: control.surface_class.clone(),
        operation_kind: control.operation_kind.clone(),
        options: vec![option("accept")?],
        proposals: vec![MenuProposalPlan {
            option_id: MenuOptionId::new("accept")?,
            fingerprint: "fp".to_owned(),
            payload: json!({"choice": "accept"}),
        }],
        cancel: CancelPolicy::Disabled,
    })
}

fn replacement_plan(
    control: &NextControl,
    operation_id: &OperationId,
) -> TestResult<ControlMenuPlan> {
    let NextControl::Replacement(control) = control else {
        return Err("replacement plan requires replacement control".into());
    };
    Ok(ControlMenuPlan::Replacement {
        control_id: control_id_of(&NextControl::Replacement(control.clone())),
        owner_seat_id: control.owner_seat_id,
        operation_id: operation_id.clone(),
        field_index: control.field_index,
        options: vec![option("accept")?],
        proposals: Vec::new(),
        cancel: CancelPolicy::Disabled,
    })
}

fn interaction_plan(
    control: &NextControl,
    operation_id: &OperationId,
) -> TestResult<ControlMenuPlan> {
    let NextControl::SharedInteraction(control) = control else {
        return Err("interaction plan requires interaction control".into());
    };
    Ok(ControlMenuPlan::Interaction {
        control_id: control_id_of(&NextControl::SharedInteraction(control.clone())),
        owner_seat_id: control.owner_seat_id,
        operation_id: operation_id.clone(),
        surface_class: control.surface_class.clone(),
        operation_kind: control.operation_kind.clone(),
        options: vec![option("accept")?],
        proposals: Vec::new(),
        cancel: CancelPolicy::Disabled,
    })
}

fn draft(
    operation_id: &OperationId,
    kind: AuthorityEntryKind,
    payload: Value,
    next_control: NextControl,
) -> TestResult<AuthorityEntryDraft> {
    Ok(AuthorityEntryDraft {
        context: context(0, 0, 1)?,
        operation_id: operation_id.clone(),
        kind,
        material: Material {
            digest: format!("digest-{}", operation_id.as_str()),
            payload,
        },
        next_control,
        subsumes: Vec::new(),
    })
}

fn turn_payload() -> Value {
    json!({"epoch": 1, "wave": 1, "turn": 1})
}

fn authority_config(
    menu_plans: Vec<ControlMenuPlan>,
    resolutions: Vec<AuthorityResolutionPlan>,
    peers: &[u64],
) -> TestResult<ProtocolKernelConfig> {
    Ok(ProtocolKernelConfig {
        role: ProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: context(0, 0, 1)?,
                peer_bindings: peers
                    .iter()
                    .map(|peer| PeerBinding {
                        seat_id: seat(*peer),
                        connection_generation: generation(1),
                    })
                    .collect(),
                owner_id: "m2-kernel-authority".to_owned(),
                retain_capacity: safe(32),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(250),
                    maximum_ms: safe(5_000),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: er_types::TimeClass::Connected,
                max_delivery_attempts: None,
            },
            proposal_capacity: safe(32),
            resolutions,
        },
        menu_plans,
    })
}

fn authority_kernel(protocol: ProtocolKernelConfig, initial_ui: UiState) -> GameKernel {
    GameKernel::new(KernelConfig {
        input_map: input_map(),
        initial_ui,
        protocol: Some(protocol),
    })
}

fn replica_config(menu_plans: Vec<ControlMenuPlan>) -> TestResult<ProtocolKernelConfig> {
    let local_context = context(1, 0, 1)?;
    Ok(ProtocolKernelConfig {
        role: ProtocolRoleConfig::Replica {
            replica: AuthorityReplicaConfig {
                receipt_context: local_context.clone(),
                authority_seat_id: seat(0),
                authority_connection_generation: generation(1),
            },
            proposal_leases: ProposalLeaseConfig {
                owner_prefix: "m2-kernel-proposal".to_owned(),
                retry_initial_ms: safe(250),
                retry_maximum_ms: safe(5_000),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context,
                request_timeout_ms: safe(5_000),
                control_timeout_ms: safe(5_000),
                pacing_ms: safe(16),
                timer_owner_id: "m2-kernel-recovery".to_owned(),
            },
        },
        menu_plans,
    })
}

fn replica_kernel(protocol: ProtocolKernelConfig, initial_ui: UiState) -> GameKernel {
    GameKernel::new(KernelConfig {
        input_map: input_map(),
        initial_ui,
        protocol: Some(protocol),
    })
}

fn ui(menu: MenuState, owner: Option<SeatId>, actionable: bool) -> UiState {
    UiState {
        generation: MenuGeneration::new(safe(1)),
        owner_seat: owner,
        actionable,
        stack: vec![menu],
    }
}

fn initial_command_menu(
    control: &NextControl,
    operation_id: &OperationId,
) -> TestResult<MenuState> {
    Ok(MenuState::Command(er_types::CommandMenu {
        operation_id: operation_id.clone(),
        control_id: control_id_of(control),
        cursor: SafeU53::ZERO,
        options: vec![option("accept")?],
        cancel: CancelPolicy::Disabled,
    }))
}

fn proposal(
    from: u64,
    operation_id: &OperationId,
    fingerprint: &str,
    generation_value: u64,
) -> ProposalMessage {
    ProposalMessage {
        operation_id: operation_id.clone(),
        fingerprint: fingerprint.to_owned(),
        from: seat(from),
        to: seat(0),
        connection_generation: generation(generation_value),
        payload: json!({"choice": "accept"}),
    }
}

fn key_down(kernel: &mut GameKernel, seat_id: SeatId) -> Result<Vec<KernelEffect>, KernelError> {
    kernel.step(KernelInput::RawInput {
        seat: seat_id,
        event: RawInputEvent::KeyDown {
            code: PhysicalKey::Enter,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    })
}

fn key_up(kernel: &mut GameKernel, seat_id: SeatId) -> Result<Vec<KernelEffect>, KernelError> {
    kernel.step(KernelInput::RawInput {
        seat: seat_id,
        event: RawInputEvent::KeyUp {
            code: PhysicalKey::Enter,
        },
    })
}

fn network_frame(
    context: FrameContext,
    frame_type: FrameType,
    body: Value,
) -> er_types::NetworkFrame {
    er_types::NetworkFrame {
        version: FRAME_PROTOCOL_VERSION,
        frame_type,
        context,
        body,
    }
}

fn terminal_frame(
    context: FrameContext,
    terminal_id: &str,
    reason: &str,
) -> TestResult<er_types::NetworkFrame> {
    Ok(network_frame(
        context,
        FrameType::Terminal,
        serde_json::to_value(TerminalFrameBody {
            terminal_id: terminal_id.to_owned(),
            reason: reason.to_owned(),
        })?,
    ))
}

fn recovery_request_frame(
    context: FrameContext,
    request_id: &str,
    captured: u64,
    reason: &str,
) -> TestResult<er_types::NetworkFrame> {
    Ok(network_frame(
        context,
        FrameType::RecoveryRequest,
        serde_json::to_value(RecoveryRequestBody {
            request_id: request_id.to_owned(),
            captured_frontier: Revision::new(safe(captured)),
            reason: reason.to_owned(),
        })?,
    ))
}

fn recovery_applied_frame(
    context: FrameContext,
    request_id: &str,
    digest: &str,
) -> TestResult<er_types::NetworkFrame> {
    Ok(network_frame(
        context,
        FrameType::RecoveryApplied,
        serde_json::to_value(RecoveryAppliedProof {
            request_id: request_id.to_owned(),
            frontier: Revision::ZERO,
            material_digest: digest.to_owned(),
            control_id: None,
        })?,
    ))
}

fn has_apply(effects: &[KernelEffect], revision: u64, operation_id: &OperationId) -> bool {
    effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::ApplyAuthorityMaterial {
                revision: actual_revision,
                operation_id: actual_operation,
                ..
            } if *actual_revision == Revision::new(safe(revision))
                && actual_operation == operation_id
        )
    })
}

fn has_project(
    effects: &[KernelEffect],
    revision: u64,
    operation_id: &OperationId,
    control: &NextControl,
) -> bool {
    effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::ProjectAuthorityControl {
                revision: actual_revision,
                operation_id: actual_operation,
                control: actual_control,
                ..
            } if *actual_revision == Revision::new(safe(revision))
                && actual_operation == operation_id
                && actual_control == control
        )
    })
}

fn sent_frame(effects: &[KernelEffect]) -> Option<er_types::NetworkFrame> {
    effects.iter().find_map(|effect| match effect {
        KernelEffect::SendFrame { frame, .. } => Some(frame.clone()),
        _ => None,
    })
}

fn proposal_timer_ids(effects: &[KernelEffect]) -> Vec<er_types::TimerId> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ScheduleTimer {
                timer_id, owner, ..
            } if owner.owner_id.starts_with("m2-kernel-proposal") => Some(*timer_id),
            _ => None,
        })
        .collect()
}

fn initial_interaction_menu(
    control: &NextControl,
    operation_id: &OperationId,
) -> TestResult<MenuState> {
    let NextControl::SharedInteraction(control) = control else {
        return Err("interaction menu requires interaction control".into());
    };
    Ok(MenuState::Interaction(er_types::InteractionMenu {
        operation_id: operation_id.clone(),
        control_id: control_id_of(&NextControl::SharedInteraction(control.clone())),
        surface_class: control.surface_class.clone(),
        operation_kind: control.operation_kind.clone(),
        choice: er_types::ChoiceListMenu {
            cursor: SafeU53::ZERO,
            page: SafeU53::ZERO,
            wrap: false,
            options: vec![option("accept")?],
            cancel: CancelPolicy::Disabled,
        },
    }))
}

#[test]
fn configured_protocol_initial_resources_include_wait_and_control() -> TestResult {
    let waiting = authority_kernel(
        authority_config(Vec::new(), Vec::new(), &[1])?,
        ui(
            MenuState::Waiting(WaitingMenu {
                prompt_key: Some("m2.waiting".to_owned()),
            }),
            None,
            false,
        ),
    );
    assert!(waiting.live_resources().waits.contains("m2.waiting"));

    let control = command_control(0, 42, 1);
    let host = operation("host.command")?;
    let control_id = control_id_of(&control);
    let control_kernel = authority_kernel(
        authority_config(
            vec![command_plan(&control, &host, false)?],
            Vec::new(),
            &[1],
        )?,
        ui(initial_command_menu(&control, &host)?, Some(seat(0)), true),
    );
    assert!(
        control_kernel
            .live_resources()
            .controls
            .contains(&control_id)
    );
    Ok(())
}

#[test]
fn local_physical_proposal_projects_distinct_next_command_once() -> TestResult {
    let guest_control = command_control(0, 42, 1);
    let host_control = command_control(0, 43, 1);
    let guest = operation("guest.command")?;
    let host = operation("host.command")?;
    let protocol = authority_config(
        vec![
            command_plan(&guest_control, &guest, true)?,
            command_plan(&host_control, &host, false)?,
        ],
        vec![AuthorityResolutionPlan {
            operation_id: guest.clone(),
            fingerprint: "fp".to_owned(),
            draft: draft(
                &guest,
                AuthorityEntryKind::TurnCommit,
                turn_payload(),
                host_control.clone(),
            )?,
        }],
        &[1],
    )?;
    let mut kernel = authority_kernel(
        protocol,
        ui(
            initial_command_menu(&guest_control, &guest)?,
            Some(seat(0)),
            true,
        ),
    );

    let down = key_down(&mut kernel, seat(0))?;
    assert!(has_apply(&down, 1, &guest));
    key_up(&mut kernel, seat(0))?;

    let project = kernel.step(KernelInput::MaterialApplied {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: MaterialApplicationOutcome::Applied,
    })?;
    assert!(has_project(&project, 1, &guest, &host_control));

    let installed = kernel.step(KernelInput::ControlProjected {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: ControlProjectionOutcome::Installed {
            control_id: control_id_of(&host_control),
        },
    })?;
    assert_eq!(
        installed
            .iter()
            .filter(|effect| matches!(effect, KernelEffect::UiChanged { .. }))
            .count(),
        1
    );
    let Some(MenuState::Command(menu)) = kernel.ui_state().stack.last() else {
        return Err("successor command menu was not installed".into());
    };
    assert_eq!(menu.operation_id, host);
    assert_eq!(menu.control_id, control_id_of(&host_control));

    assert!(
        kernel
            .step(KernelInput::ControlProjected {
                endpoint: seat(0),
                revision: Revision::new(safe(1)),
                outcome: ControlProjectionOutcome::AlreadyInstalled {
                    control_id: control_id_of(&host_control),
                },
            })?
            .is_empty()
    );
    Ok(())
}

#[test]
fn multi_target_command_frontier_selects_the_local_canonical_target() -> TestResult {
    let multi_target = NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        commands: vec![
            CommandControlTarget {
                owner_seat_id: seat(1),
                pokemon_id: safe(11),
                field_index: safe(0),
            },
            CommandControlTarget {
                owner_seat_id: seat(0),
                pokemon_id: safe(22),
                field_index: safe(1),
            },
        ],
    });
    let guest = operation("guest.multi")?;
    let host = operation("host.multi")?;
    let control_id = control_id_of(&multi_target);
    let menu_plans = vec![
        ControlMenuPlan::Command {
            control_id: control_id.clone(),
            owner_seat_id: seat(1),
            operation_id: guest.clone(),
            field_index: safe(0),
            options: vec![option("accept")?],
            proposals: Vec::new(),
            cancel: CancelPolicy::Disabled,
        },
        ControlMenuPlan::Command {
            control_id,
            owner_seat_id: seat(0),
            operation_id: host.clone(),
            field_index: safe(1),
            options: vec![option("accept")?],
            proposals: Vec::new(),
            cancel: CancelPolicy::Disabled,
        },
    ];
    let mut kernel = authority_kernel(
        authority_config(
            menu_plans,
            vec![AuthorityResolutionPlan {
                operation_id: guest.clone(),
                fingerprint: "fp".to_owned(),
                draft: draft(
                    &guest,
                    AuthorityEntryKind::TurnCommit,
                    turn_payload(),
                    multi_target.clone(),
                )?,
            }],
            &[1],
        )?,
        UiState::default(),
    );
    kernel.step(KernelInput::ProposalReceived {
        endpoint: seat(0),
        proposal: proposal(0, &guest, "fp", 1),
    })?;
    project_successor(&mut kernel, &guest, &multi_target)?;
    let Some(MenuState::Command(menu)) = kernel.ui_state().stack.last() else {
        return Err("multi-target command successor menu was not installed".into());
    };
    assert_eq!(menu.operation_id, host);
    assert_eq!(kernel.ui_state().owner_seat, Some(seat(0)));
    Ok(())
}

#[test]
fn peer_only_command_frontier_installs_without_a_local_command_surface() -> TestResult {
    let peer_control = command_control(0, 44, 1);
    let peer_operation = operation("peer.only-command")?;
    let stale_control = command_control(1, 45, 1);
    let stale_operation = operation("stale.local-command")?;
    let mut kernel = replica_kernel(
        replica_config(Vec::new())?,
        ui(
            initial_command_menu(&stale_control, &stale_operation)?,
            Some(seat(1)),
            true,
        ),
    );
    assert!(
        kernel
            .live_resources()
            .controls
            .contains(&control_id_of(&stale_control))
    );

    let entry = AuthorityEntry {
        context: context(0, 0, 1)?,
        revision: Revision::new(safe(1)),
        operation_id: peer_operation.clone(),
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: "peer-only-material".to_owned(),
            payload: turn_payload(),
        },
        next_control: peer_control.clone(),
        subsumes: Vec::new(),
    };
    let accepted = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: network_frame(
            context(0, 0, 1)?,
            FrameType::AuthorityEntry,
            serde_json::to_value(AuthorityEntryBody::from(&entry))?,
        ),
    })?;
    assert!(has_apply(&accepted, 1, &peer_operation));

    let projected = kernel.step(KernelInput::MaterialApplied {
        endpoint: seat(1),
        revision: Revision::new(safe(1)),
        outcome: MaterialApplicationOutcome::Applied,
    })?;
    assert!(has_project(&projected, 1, &peer_operation, &peer_control));

    let control_id = control_id_of(&peer_control);
    let installed = kernel.step(KernelInput::ControlProjected {
        endpoint: seat(1),
        revision: Revision::new(safe(1)),
        outcome: ControlProjectionOutcome::Installed {
            control_id: control_id.clone(),
        },
    })?;
    assert!(
        installed
            .iter()
            .any(|effect| matches!(effect, KernelEffect::UiChanged { .. }))
    );
    assert!(
        !installed
            .iter()
            .any(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
    );
    let receipt = sent_frame(&installed).ok_or("controlInstalled receipt was not emitted")?;
    let receipt: AuthorityReceiptBody = serde_json::from_value(receipt.body)?;
    assert_eq!(receipt.stage, AckStage::ControlInstalled);
    assert_eq!(receipt.control_id, Some(control_id.clone()));
    assert_eq!(kernel.ui_state().owner_seat, None);
    assert!(!kernel.ui_state().actionable);
    assert_eq!(kernel.ui_state().stack, vec![MenuState::None]);
    assert_eq!(kernel.ui_state().generation, MenuGeneration::new(safe(2)));
    assert!(kernel.live_resources().controls.is_empty());
    assert_eq!(kernel.live_resources().presentations.len(), 1);

    let duplicate = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: network_frame(
            context(0, 0, 1)?,
            FrameType::AuthorityEntry,
            serde_json::to_value(AuthorityEntryBody::from(&entry))?,
        ),
    })?;
    let duplicate_receipt = sent_frame(&duplicate).ok_or("duplicate receipt was not emitted")?;
    let duplicate_receipt: AuthorityReceiptBody = serde_json::from_value(duplicate_receipt.body)?;
    assert_eq!(duplicate_receipt.stage, AckStage::ControlInstalled);
    assert_eq!(duplicate_receipt.control_id, Some(control_id));
    assert!(
        !duplicate
            .iter()
            .any(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
    );
    assert_eq!(kernel.ui_state().stack, vec![MenuState::None]);
    assert!(kernel.live_resources().controls.is_empty());
    assert_eq!(kernel.live_resources().presentations.len(), 1);
    Ok(())
}

#[test]
fn local_command_frontier_without_an_exact_plan_still_terminalizes() -> TestResult {
    let local_control = command_control(0, 46, 1);
    let local_operation = operation("local.missing-command-plan")?;
    let control_id = control_id_of(&local_control);
    let mut kernel = authority_kernel(
        authority_config(
            Vec::new(),
            vec![AuthorityResolutionPlan {
                operation_id: local_operation.clone(),
                fingerprint: "fp".to_owned(),
                draft: draft(
                    &local_operation,
                    AuthorityEntryKind::TurnCommit,
                    turn_payload(),
                    local_control,
                )?,
            }],
            &[1],
        )?,
        UiState::default(),
    );
    assert!(has_apply(
        &kernel.step(KernelInput::ProposalReceived {
            endpoint: seat(0),
            proposal: proposal(0, &local_operation, "fp", 1),
        })?,
        1,
        &local_operation,
    ));
    kernel.step(KernelInput::MaterialApplied {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: MaterialApplicationOutcome::Applied,
    })?;

    let terminalized = kernel.step(KernelInput::ControlProjected {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: ControlProjectionOutcome::Installed { control_id },
    })?;
    assert!(
        terminalized
            .iter()
            .any(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
    );
    let Some(MenuState::Terminal(TerminalMenu { prompt_key, .. })) = kernel.ui_state().stack.last()
    else {
        return Err("missing local command plan did not install a terminal menu".into());
    };
    assert!(
        prompt_key
            .as_deref()
            .is_some_and(|reason| reason.contains("missing exact control menu plan"))
    );
    assert_eq!(kernel.live_resources(), Default::default());
    Ok(())
}

#[test]
fn peer_proposal_projects_locally_and_duplicate_is_idempotent() -> TestResult {
    let control = command_control(0, 43, 1);
    let guest = operation("guest.peer")?;
    let host = operation("host.peer")?;
    let mut kernel = authority_kernel(
        authority_config(
            vec![command_plan(&control, &host, false)?],
            vec![
                AuthorityResolutionPlan {
                    operation_id: guest.clone(),
                    fingerprint: "fp".to_owned(),
                    draft: draft(
                        &guest,
                        AuthorityEntryKind::TurnCommit,
                        turn_payload(),
                        control.clone(),
                    )?,
                },
                AuthorityResolutionPlan {
                    operation_id: guest.clone(),
                    fingerprint: "other-fingerprint".to_owned(),
                    draft: draft(
                        &guest,
                        AuthorityEntryKind::TurnCommit,
                        turn_payload(),
                        control.clone(),
                    )?,
                },
            ],
            &[1],
        )?,
        UiState::default(),
    );
    let peer_proposal = proposal(1, &guest, "fp", 1);
    let accepted = kernel.step(KernelInput::ProposalReceived {
        endpoint: seat(0),
        proposal: peer_proposal.clone(),
    })?;
    assert!(has_apply(&accepted, 1, &guest));
    let duplicate = kernel.step(KernelInput::ProposalReceived {
        endpoint: seat(0),
        proposal: peer_proposal,
    })?;
    assert!(!has_apply(&duplicate, 2, &guest));
    assert_eq!(kernel.live_resources().retained_revisions.len(), 1);

    let project = kernel.step(KernelInput::MaterialApplied {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: MaterialApplicationOutcome::Applied,
    })?;
    assert!(has_project(&project, 1, &guest, &control));
    kernel.step(KernelInput::ControlProjected {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: ControlProjectionOutcome::Installed {
            control_id: control_id_of(&control),
        },
    })?;
    let conflict = kernel.step(KernelInput::ProposalReceived {
        endpoint: seat(0),
        proposal: proposal(1, &guest, "other-fingerprint", 1),
    });
    assert!(matches!(conflict, Err(KernelError::Canonical { .. })));
    Ok(())
}

#[test]
fn stale_local_generation_is_inert_but_current_local_proposal_is_admitted() -> TestResult {
    let control = command_control(0, 43, 1);
    let guest = operation("guest.local-generation")?;
    let host = operation("host.local-generation")?;
    let mut kernel = authority_kernel(
        authority_config(
            vec![command_plan(&control, &host, false)?],
            vec![AuthorityResolutionPlan {
                operation_id: guest.clone(),
                fingerprint: "fp".to_owned(),
                draft: draft(
                    &guest,
                    AuthorityEntryKind::TurnCommit,
                    turn_payload(),
                    control,
                )?,
            }],
            &[1],
        )?,
        UiState::default(),
    );
    assert!(
        kernel
            .step(KernelInput::ProposalReceived {
                endpoint: seat(0),
                proposal: proposal(0, &guest, "fp", 2),
            })?
            .is_empty()
    );
    assert!(has_apply(
        &kernel.step(KernelInput::ProposalReceived {
            endpoint: seat(0),
            proposal: proposal(0, &guest, "fp", 1),
        })?,
        1,
        &guest
    ));
    Ok(())
}

#[test]
fn deferred_authority_boundaries_block_the_next_revision() -> TestResult {
    let first_control = command_control(0, 43, 1);
    let second_control = command_control(0, 44, 1);
    let first = operation("guest.first")?;
    let second = operation("guest.second")?;
    let first_host = operation("host.first")?;
    let second_host = operation("host.second")?;
    let mut kernel = authority_kernel(
        authority_config(
            vec![
                command_plan(&first_control, &first_host, false)?,
                command_plan(&second_control, &second_host, false)?,
            ],
            vec![
                AuthorityResolutionPlan {
                    operation_id: first.clone(),
                    fingerprint: "fp-1".to_owned(),
                    draft: draft(
                        &first,
                        AuthorityEntryKind::TurnCommit,
                        turn_payload(),
                        first_control.clone(),
                    )?,
                },
                AuthorityResolutionPlan {
                    operation_id: second.clone(),
                    fingerprint: "fp-2".to_owned(),
                    draft: draft(
                        &second,
                        AuthorityEntryKind::TurnCommit,
                        turn_payload(),
                        second_control.clone(),
                    )?,
                },
            ],
            &[1],
        )?,
        UiState::default(),
    );
    assert!(has_apply(
        &kernel.step(KernelInput::ProposalReceived {
            endpoint: seat(0),
            proposal: proposal(0, &first, "fp-1", 1),
        })?,
        1,
        &first
    ));
    let unresolved_ui = kernel.ui_state().clone();
    assert!(
        kernel
            .step(KernelInput::ProposalReceived {
                endpoint: seat(0),
                proposal: proposal(0, &second, "fp-2", 1),
            })?
            .is_empty()
    );
    kernel.step(KernelInput::MaterialApplied {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: MaterialApplicationOutcome::Deferred,
    })?;
    assert!(
        kernel
            .step(KernelInput::ProposalReceived {
                endpoint: seat(0),
                proposal: proposal(0, &second, "fp-2", 1),
            })?
            .is_empty()
    );
    assert_eq!(kernel.ui_state(), &unresolved_ui);
    let project = kernel.step(KernelInput::MaterialApplied {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: MaterialApplicationOutcome::Applied,
    })?;
    assert!(has_project(&project, 1, &first, &first_control));
    assert!(
        kernel
            .step(KernelInput::ProposalReceived {
                endpoint: seat(0),
                proposal: proposal(0, &second, "fp-2", 1),
            })?
            .is_empty()
    );
    kernel.step(KernelInput::ControlProjected {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: ControlProjectionOutcome::Deferred,
    })?;
    assert!(
        kernel
            .step(KernelInput::ProposalReceived {
                endpoint: seat(0),
                proposal: proposal(0, &second, "fp-2", 1),
            })?
            .is_empty()
    );
    assert_eq!(kernel.ui_state(), &unresolved_ui);
    kernel.step(KernelInput::ControlProjected {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: ControlProjectionOutcome::Installed {
            control_id: control_id_of(&first_control),
        },
    })?;
    assert!(has_apply(
        &kernel.step(KernelInput::ProposalReceived {
            endpoint: seat(0),
            proposal: proposal(0, &second, "fp-2", 1),
        })?,
        2,
        &second
    ));
    Ok(())
}

fn project_successor(
    kernel: &mut GameKernel,
    operation_id: &OperationId,
    control: &NextControl,
) -> TestResult {
    let project = kernel.step(KernelInput::MaterialApplied {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: MaterialApplicationOutcome::Applied,
    })?;
    assert!(has_project(&project, 1, operation_id, control));
    kernel.step(KernelInput::ControlProjected {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: ControlProjectionOutcome::Installed {
            control_id: control_id_of(control),
        },
    })?;
    Ok(())
}

#[test]
fn replacement_and_interaction_successors_install_their_embedded_operation_ids() -> TestResult {
    let guest = operation("guest.replacement")?;
    let host = operation("host.replacement")?;
    let replacement = replacement_control(&host);
    let mut replacement_kernel = authority_kernel(
        authority_config(
            vec![replacement_plan(&replacement, &host)?],
            vec![AuthorityResolutionPlan {
                operation_id: guest.clone(),
                fingerprint: "fp".to_owned(),
                draft: draft(
                    &guest,
                    AuthorityEntryKind::TurnCommit,
                    turn_payload(),
                    replacement.clone(),
                )?,
            }],
            &[1],
        )?,
        UiState::default(),
    );
    assert!(has_apply(
        &replacement_kernel.step(KernelInput::ProposalReceived {
            endpoint: seat(0),
            proposal: proposal(0, &guest, "fp", 1),
        })?,
        1,
        &guest
    ));
    project_successor(&mut replacement_kernel, &guest, &replacement)?;
    let Some(MenuState::Replacement(menu)) = replacement_kernel.ui_state().stack.last() else {
        return Err("replacement successor menu was not installed".into());
    };
    assert_eq!(menu.operation_id, host);

    let guest = operation("guest.interaction")?;
    let host = operation("host.interaction")?;
    let interaction = interaction_control(&host);
    let mut interaction_kernel = authority_kernel(
        authority_config(
            vec![interaction_plan(&interaction, &host)?],
            vec![AuthorityResolutionPlan {
                operation_id: guest.clone(),
                fingerprint: "fp".to_owned(),
                draft: draft(
                    &guest,
                    AuthorityEntryKind::TurnCommit,
                    turn_payload(),
                    interaction.clone(),
                )?,
            }],
            &[1],
        )?,
        UiState::default(),
    );
    assert!(has_apply(
        &interaction_kernel.step(KernelInput::ProposalReceived {
            endpoint: seat(0),
            proposal: proposal(0, &guest, "fp", 1),
        })?,
        1,
        &guest
    ));
    project_successor(&mut interaction_kernel, &guest, &interaction)?;
    let Some(MenuState::Interaction(menu)) = interaction_kernel.ui_state().stack.last() else {
        return Err("interaction successor menu was not installed".into());
    };
    assert_eq!(menu.operation_id, host);
    Ok(())
}

#[test]
fn replica_interaction_commit_settles_proposal_lease_before_material_and_duplicate_is_idempotent()
-> TestResult {
    let operation_id = operation("replica.interaction-lease")?;
    let control = interaction_control_for_owner(1, &operation_id);
    let mut kernel = replica_kernel(
        replica_config(vec![interaction_plan_with_proposal(
            &control,
            &operation_id,
        )?])?,
        ui(
            initial_interaction_menu(&control, &operation_id)?,
            Some(seat(1)),
            true,
        ),
    );

    let armed = key_down(&mut kernel, seat(1))?;
    let proposal_timers = proposal_timer_ids(&armed);
    assert_eq!(proposal_timers.len(), 2);
    assert_eq!(
        armed
            .iter()
            .filter(|effect| {
                matches!(
                    effect,
                    KernelEffect::ScheduleTimer { owner, time_class, .. }
                        if owner.owner_id.starts_with("m2-kernel-proposal")
                            && *time_class == er_types::TimeClass::Absolute
                )
            })
            .count(),
        1
    );
    assert_eq!(
        armed
            .iter()
            .filter(|effect| {
                matches!(
                    effect,
                    KernelEffect::ScheduleTimer { owner, time_class, .. }
                        if owner.owner_id.starts_with("m2-kernel-proposal")
                            && *time_class == er_types::TimeClass::Connected
                )
            })
            .count(),
        1
    );
    assert!(armed.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::SendProposal { proposal } if proposal.operation_id == operation_id
        )
    }));
    key_up(&mut kernel, seat(1))?;
    assert!(
        kernel
            .live_resources()
            .proposal_leases
            .contains(&operation_id)
    );
    assert!(
        proposal_timers
            .iter()
            .all(|timer_id| kernel.live_resources().timers.contains(timer_id))
    );

    let entry = AuthorityEntry {
        context: context(0, 0, 1)?,
        revision: Revision::new(safe(1)),
        operation_id: operation_id.clone(),
        kind: AuthorityEntryKind::InteractionCommit,
        material: Material {
            digest: "replica-interaction-lease-material".to_owned(),
            payload: json!({
                "envelope": {
                    "sessionEpoch": 1,
                    "wave": 1,
                    "turn": 1,
                    "pendingOperation": {"kind": "ABILITY_PICK"}
                },
                "surfaceClass": "op:ability",
                "choice": "accept"
            }),
        },
        next_control: interaction_control(&operation_id),
        subsumes: Vec::new(),
    };
    let frame = network_frame(
        context(0, 0, 1)?,
        FrameType::AuthorityEntry,
        serde_json::to_value(AuthorityEntryBody::from(&entry))?,
    );
    let accepted = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: frame.clone(),
    })?;
    let apply_index = accepted
        .iter()
        .position(|effect| {
            matches!(
                effect,
                KernelEffect::ApplyAuthorityMaterial { operation_id: actual, .. }
                    if actual == &operation_id
            )
        })
        .ok_or("interaction material effect was not emitted")?;
    for timer_id in &proposal_timers {
        let cancellations = accepted
            .iter()
            .enumerate()
            .filter_map(|(index, effect)| match effect {
                KernelEffect::CancelTimer {
                    timer_id: actual, ..
                } if actual == timer_id => Some(index),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(cancellations.len(), 1);
        assert!(cancellations[0] < apply_index);
    }
    assert!(
        !kernel
            .live_resources()
            .proposal_leases
            .contains(&operation_id)
    );
    assert!(
        proposal_timers
            .iter()
            .all(|timer_id| !kernel.live_resources().timers.contains(timer_id))
    );

    let duplicate = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame,
    })?;
    assert!(has_apply(&duplicate, 1, &operation_id));
    assert!(!duplicate.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::CancelTimer { timer_id, .. } if proposal_timers.contains(timer_id)
        )
    }));
    assert!(
        !kernel
            .live_resources()
            .proposal_leases
            .contains(&operation_id)
    );
    Ok(())
}

#[test]
fn replica_turn_commit_does_not_settle_interaction_proposal_lease() -> TestResult {
    let operation_id = operation("replica.turn-lease")?;
    let interaction = interaction_control_for_owner(1, &operation_id);
    let mut kernel = replica_kernel(
        replica_config(vec![interaction_plan_with_proposal(
            &interaction,
            &operation_id,
        )?])?,
        ui(
            initial_interaction_menu(&interaction, &operation_id)?,
            Some(seat(1)),
            true,
        ),
    );

    let armed = key_down(&mut kernel, seat(1))?;
    let proposal_timers = proposal_timer_ids(&armed);
    assert_eq!(proposal_timers.len(), 2);
    key_up(&mut kernel, seat(1))?;

    let entry = AuthorityEntry {
        context: context(0, 0, 1)?,
        revision: Revision::new(safe(1)),
        operation_id: operation_id.clone(),
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: "replica-turn-lease-material".to_owned(),
            payload: turn_payload(),
        },
        next_control: command_control(0, 99, 1),
        subsumes: Vec::new(),
    };
    let accepted = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: network_frame(
            context(0, 0, 1)?,
            FrameType::AuthorityEntry,
            serde_json::to_value(AuthorityEntryBody::from(&entry))?,
        ),
    })?;
    assert!(has_apply(&accepted, 1, &operation_id));
    assert!(!accepted.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::CancelTimer { timer_id, .. } if proposal_timers.contains(timer_id)
        )
    }));
    assert!(
        kernel
            .live_resources()
            .proposal_leases
            .contains(&operation_id)
    );
    assert!(
        proposal_timers
            .iter()
            .all(|timer_id| kernel.live_resources().timers.contains(timer_id))
    );
    Ok(())
}

#[test]
fn terminal_frame_requires_authenticated_peer_and_absorbs_later_inputs() -> TestResult {
    let guest = operation("guest.terminal-cleanup")?;
    let host = operation("host.terminal-cleanup")?;
    let control = command_control(0, 50, 1);
    let mut kernel = authority_kernel(
        authority_config(
            vec![command_plan(&control, &host, false)?],
            vec![AuthorityResolutionPlan {
                operation_id: guest.clone(),
                fingerprint: "fp".to_owned(),
                draft: draft(
                    &guest,
                    AuthorityEntryKind::TurnCommit,
                    turn_payload(),
                    control,
                )?,
            }],
            &[1],
        )?,
        UiState::default(),
    );
    assert!(
        kernel
            .step(KernelInput::NetworkFrame {
                endpoint: seat(2),
                frame: terminal_frame(context(1, 0, 1)?, "peer-terminal", "peer reason")?,
            })?
            .is_empty()
    );
    assert!(
        kernel
            .step(KernelInput::NetworkFrame {
                endpoint: seat(0),
                frame: terminal_frame(context(1, 0, 2)?, "stale-terminal", "stale reason")?,
            })?
            .is_empty()
    );
    assert!(
        kernel
            .step(KernelInput::NetworkFrame {
                endpoint: seat(0),
                frame: terminal_frame(context(0, 0, 1)?, "wrong-role", "wrong role")?,
            })?
            .is_empty()
    );

    let committed = kernel.step(KernelInput::ProposalReceived {
        endpoint: seat(0),
        proposal: proposal(0, &guest, "fp", 1),
    })?;
    let delivery_timer = committed.iter().find_map(|effect| match effect {
        KernelEffect::ScheduleTimer { timer_id, .. } => Some(*timer_id),
        _ => None,
    });
    let delivery_timer = delivery_timer.ok_or("authority delivery timer was not scheduled")?;

    let entered = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(0),
        frame: terminal_frame(context(1, 0, 1)?, "peer-terminal", "peer reason")?,
    })?;
    assert_eq!(
        entered
            .iter()
            .filter(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
            .count(),
        1
    );
    let shared_terminal = entered.iter().find_map(|effect| match effect {
        KernelEffect::EnterSharedTerminal { terminal } => Some(terminal.clone()),
        _ => None,
    });
    assert_eq!(
        shared_terminal,
        Some(er_types::TerminalState {
            terminal_id: "peer-terminal".to_owned(),
            reason: "peer reason".to_owned(),
        })
    );
    assert!(entered.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::CancelTimer { timer_id, .. } if *timer_id == delivery_timer
        )
    }));
    let Some(MenuState::Terminal(TerminalMenu {
        terminal_id,
        prompt_key,
    })) = kernel.ui_state().stack.last()
    else {
        return Err("terminal menu was not installed".into());
    };
    assert_eq!(terminal_id, "peer-terminal");
    assert_eq!(prompt_key.as_deref(), Some("peer reason"));
    let terminal_ui = kernel.ui_state().clone();
    let post_terminal_operation = operation("post-terminal-menu")?;
    let post_terminal_control = command_control(0, 51, 1);
    let terminal_generation = kernel.replace_menu(
        Some(seat(0)),
        true,
        initial_command_menu(&post_terminal_control, &post_terminal_operation)?,
    );
    assert_eq!(terminal_generation, terminal_ui.generation);
    assert_eq!(kernel.ui_state(), &terminal_ui);
    assert_eq!(kernel.live_resources(), Default::default());
    assert!(
        kernel
            .step(KernelInput::RawInput {
                seat: seat(0),
                event: RawInputEvent::KeyDown {
                    code: PhysicalKey::Enter,
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game,
                },
            })?
            .is_empty()
    );
    let post_terminal = operation("post-terminal")?;
    assert!(
        kernel
            .step(KernelInput::ProposalReceived {
                endpoint: seat(0),
                proposal: proposal(0, &post_terminal, "fp", 1),
            })?
            .is_empty()
    );
    assert!(kernel
        .step(KernelInput::NetworkFrame {
            endpoint: seat(0),
            frame: terminal_frame(
                context(1, 0, 1)?,
                "different-terminal",
                "different reason",
            )?,
        })?
        .is_empty());
    assert!(
        kernel
            .step(KernelInput::NetworkFrame {
                endpoint: seat(0),
                frame: terminal_frame(context(1, 0, 1)?, "peer-terminal", "peer reason")?,
            })?
            .is_empty()
    );
    assert!(
        kernel
            .step(KernelInput::TimerFired {
                endpoint: seat(0),
                timer_id: delivery_timer,
            })?
            .is_empty()
    );
    assert_eq!(*kernel.ui_state(), terminal_ui);
    assert_eq!(kernel.live_resources(), Default::default());
    assert!(kernel.dispose("after terminal").is_empty());
    assert!(kernel.dispose("again").is_empty());
    Ok(())
}

#[test]
fn recovery_bundle_error_keeps_phase_and_pending_state_atomic() -> TestResult {
    let initial_operation = operation("recovery.atomic.initial")?;
    let initial_control = command_control(1, 74, 1);
    let initial_entry = AuthorityEntry {
        context: context(0, 0, 1)?,
        revision: Revision::new(safe(1)),
        operation_id: initial_operation.clone(),
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: "recovery-atomic-initial".to_owned(),
            payload: turn_payload(),
        },
        next_control: initial_control.clone(),
        subsumes: Vec::new(),
    };
    let initial_bundle = RecoveryBundleBody {
        request_id: "recovery-before-start".to_owned(),
        material: initial_entry.material.clone(),
        frontier: initial_entry.revision,
        frontier_operation_id: Some(initial_operation),
        membership_revision: initial_entry.context.membership_revision,
        next_control: Some(initial_control),
        required_tail: vec![AuthorityEntryBody::from(&initial_entry)],
    };
    let mut kernel = replica_kernel(replica_config(Vec::new())?, UiState::default());
    let before = kernel.snapshot();
    let rejected = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: network_frame(
            context(0, 0, 1)?,
            FrameType::RecoveryBundle,
            serde_json::to_value(initial_bundle)?,
        ),
    });
    assert!(matches!(
        rejected,
        Err(KernelError::Canonical { reason })
            if reason.contains("recovery transition is invalid")
    ));
    assert_eq!(kernel.snapshot(), before);
    assert!(kernel.live_resources().recovery_transactions.is_empty());

    let recovered_operation = operation("recovery.atomic.accepted")?;
    let recovered_control = command_control(1, 75, 2);
    let recovered_entry = AuthorityEntry {
        context: context(0, 0, 2)?,
        revision: Revision::new(safe(1)),
        operation_id: recovered_operation.clone(),
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: "recovery-atomic-accepted".to_owned(),
            payload: turn_payload(),
        },
        next_control: recovered_control.clone(),
        subsumes: Vec::new(),
    };
    let recovered_bundle = RecoveryBundleBody {
        request_id: "recovery-2".to_owned(),
        material: recovered_entry.material.clone(),
        frontier: recovered_entry.revision,
        frontier_operation_id: Some(recovered_operation.clone()),
        membership_revision: recovered_entry.context.membership_revision,
        next_control: Some(recovered_control),
        required_tail: vec![AuthorityEntryBody::from(&recovered_entry)],
    };

    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Connected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Connected,
        generation: generation(2),
    })?;
    assert_eq!(
        kernel.snapshot().state["protocol"]["recovery"]["phase"],
        json!("requested")
    );
    assert_eq!(
        kernel.snapshot().state["protocol"]["pendingRecovery"],
        Value::Null
    );

    let accepted = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: network_frame(
            context(0, 0, 2)?,
            FrameType::RecoveryBundle,
            serde_json::to_value(recovered_bundle)?,
        ),
    })?;
    assert!(has_apply(&accepted, 1, &recovered_operation));
    assert_eq!(
        kernel.snapshot().state["protocol"]["recovery"]["phase"],
        json!("validated")
    );
    assert_eq!(
        kernel.snapshot().state["protocol"]["pendingRecovery"]["requestId"],
        json!("recovery-2")
    );
    Ok(())
}

#[test]
fn exact_terminal_control_and_frame_identity_are_preserved_and_idempotent() -> TestResult {
    let terminal_control = NextControl::Terminal(er_types::TerminalControl {
        terminal_id: "control-terminal".to_owned(),
    });
    let guest = operation("guest.control-terminal")?;
    let mut control_kernel = authority_kernel(
        authority_config(
            Vec::new(),
            vec![AuthorityResolutionPlan {
                operation_id: guest.clone(),
                fingerprint: "fp".to_owned(),
                draft: draft(
                    &guest,
                    AuthorityEntryKind::TerminalCommit,
                    turn_payload(),
                    terminal_control,
                )?,
            }],
            &[1],
        )?,
        UiState::default(),
    );
    control_kernel.step(KernelInput::ProposalReceived {
        endpoint: seat(0),
        proposal: proposal(0, &guest, "fp", 1),
    })?;
    control_kernel.step(KernelInput::MaterialApplied {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: MaterialApplicationOutcome::Applied,
    })?;
    let entered = control_kernel.step(KernelInput::ControlProjected {
        endpoint: seat(0),
        revision: Revision::new(safe(1)),
        outcome: ControlProjectionOutcome::Installed {
            control_id: control_id_of(&NextControl::Terminal(er_types::TerminalControl {
                terminal_id: "control-terminal".to_owned(),
            })),
        },
    })?;
    assert_eq!(
        entered
            .iter()
            .filter(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
            .count(),
        1
    );
    let Some(MenuState::Terminal(menu)) = control_kernel.ui_state().stack.last() else {
        return Err("terminal control menu was not installed".into());
    };
    assert_eq!(menu.terminal_id, "control-terminal");
    assert_eq!(
        menu.prompt_key.as_deref(),
        Some("terminal control control-terminal")
    );
    Ok(())
}

#[test]
fn recovery_request_duplicate_conflict_and_rebind_are_correlated() -> TestResult {
    let peer_context = context(1, 0, 1)?;
    let mut kernel = authority_kernel(
        authority_config(Vec::new(), Vec::new(), &[1])?,
        UiState::default(),
    );
    let request = recovery_request_frame(peer_context.clone(), "recovery-1", 0, "rejoin")?;
    let first = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(0),
        frame: request.clone(),
    })?;
    let response = sent_frame(&first).ok_or("recovery response was not emitted")?;
    assert!(
        kernel
            .live_resources()
            .recovery_transactions
            .contains("recovery-1")
    );
    let duplicate = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(0),
        frame: request,
    })?;
    assert_eq!(sent_frame(&duplicate), Some(response.clone()));

    let conflict = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(0),
        frame: recovery_request_frame(peer_context.clone(), "recovery-1", 1, "rejoin")?,
    })?;
    assert!(
        conflict
            .iter()
            .any(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
    );

    let mut rebound = authority_kernel(
        authority_config(Vec::new(), Vec::new(), &[1])?,
        UiState::default(),
    );
    rebound.step(KernelInput::NetworkFrame {
        endpoint: seat(0),
        frame: recovery_request_frame(peer_context.clone(), "recovery-rebind", 0, "rejoin")?,
    })?;
    rebound.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Connected,
        generation: generation(2),
    })?;
    assert!(rebound.live_resources().recovery_transactions.is_empty());
    assert!(
        rebound
            .step(KernelInput::NetworkFrame {
                endpoint: seat(0),
                frame: recovery_applied_frame(peer_context, "recovery-rebind", "recovery-empty",)?,
            })?
            .is_empty()
    );
    Ok(())
}

#[test]
fn recovery_applied_exact_proof_closes_only_its_authenticated_expectation() -> TestResult {
    let peer_context = context(1, 0, 1)?;
    let mut kernel = authority_kernel(
        authority_config(Vec::new(), Vec::new(), &[1])?,
        UiState::default(),
    );
    kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(0),
        frame: recovery_request_frame(peer_context.clone(), "recovery-proof", 0, "rejoin")?,
    })?;
    let applied = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(0),
        frame: recovery_applied_frame(peer_context.clone(), "recovery-proof", "recovery-empty")?,
    })?;
    assert!(applied.is_empty());
    assert!(kernel.live_resources().recovery_transactions.is_empty());
    assert!(
        kernel
            .step(KernelInput::NetworkFrame {
                endpoint: seat(0),
                frame: recovery_applied_frame(peer_context, "recovery-proof", "recovery-empty",)?,
            })?
            .is_empty()
    );
    Ok(())
}

#[test]
fn authority_staged_reconnect_redelivers_once_when_peer_connects() -> TestResult {
    let committed_operation = operation("authority.rebind.commit")?;
    let next_operation = operation("authority.rebind.next")?;
    let control = command_control(0, 71, 1);
    let mut kernel = authority_kernel(
        authority_config(
            vec![command_plan(&control, &next_operation, false)?],
            vec![AuthorityResolutionPlan {
                operation_id: committed_operation.clone(),
                fingerprint: "fp".to_owned(),
                draft: draft(
                    &committed_operation,
                    AuthorityEntryKind::TurnCommit,
                    turn_payload(),
                    control,
                )?,
            }],
            &[1],
        )?,
        UiState::default(),
    );
    kernel.step(KernelInput::ProposalReceived {
        endpoint: seat(0),
        proposal: proposal(0, &committed_operation, "fp", 1),
    })?;

    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    let authority_connected = kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Connected,
        generation: generation(2),
    })?;
    assert!(!authority_connected.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::SendFrame {
                frame,
                ..
            } if frame.frame_type == FrameType::AuthorityEntry
        )
    }));

    let peer_connected = kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Connected,
        generation: generation(2),
    })?;
    let redeliveries = peer_connected
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendFrame { frame, .. }
                if frame.frame_type == FrameType::AuthorityEntry =>
            {
                Some(frame)
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(redeliveries.len(), 1);
    assert_eq!(redeliveries[0].context.connection_generation, generation(2));
    let redelivered: AuthorityEntryBody = serde_json::from_value(redeliveries[0].body.clone())?;
    assert_eq!(redelivered.operation_id, committed_operation);
    assert!(
        kernel
            .step(KernelInput::TransportChanged {
                endpoint: seat(1),
                state: TransportState::Connected,
                generation: generation(2),
            })?
            .is_empty()
    );
    assert!(
        kernel
            .step(KernelInput::TransportChanged {
                endpoint: seat(1),
                state: TransportState::Connected,
                generation: generation(1),
            })?
            .is_empty()
    );
    Ok(())
}

#[test]
fn post_rebind_generation_two_raw_proposal_commits_with_exact_context() -> TestResult {
    let first_operation = operation("authority.rebind.first")?;
    let second_operation = operation("authority.rebind.generation-two")?;
    let first_control = command_control(0, 71, 1);
    let second_control = command_control(0, 72, 1);
    let mut kernel = authority_kernel(
        authority_config(
            vec![command_plan(&first_control, &second_operation, false)?],
            vec![
                AuthorityResolutionPlan {
                    operation_id: first_operation.clone(),
                    fingerprint: "fp-first".to_owned(),
                    draft: draft(
                        &first_operation,
                        AuthorityEntryKind::TurnCommit,
                        turn_payload(),
                        first_control.clone(),
                    )?,
                },
                AuthorityResolutionPlan {
                    operation_id: second_operation.clone(),
                    fingerprint: "fp-generation-two".to_owned(),
                    draft: draft(
                        &second_operation,
                        AuthorityEntryKind::TurnCommit,
                        turn_payload(),
                        second_control,
                    )?,
                },
            ],
            &[1],
        )?,
        UiState::default(),
    );

    assert!(has_apply(
        &kernel.step(KernelInput::ProposalReceived {
            endpoint: seat(0),
            proposal: proposal(0, &first_operation, "fp-first", 1),
        })?,
        1,
        &first_operation,
    ));
    project_successor(&mut kernel, &first_operation, &first_control)?;

    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Connected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Connected,
        generation: generation(2),
    })?;

    let committed = kernel.step(KernelInput::ProposalReceived {
        endpoint: seat(0),
        proposal: proposal(0, &second_operation, "fp-generation-two", 2),
    })?;
    assert!(has_apply(&committed, 2, &second_operation));
    let committed_frame = committed
        .iter()
        .find_map(|effect| match effect {
            KernelEffect::SendFrame { frame, .. }
                if frame.frame_type == FrameType::AuthorityEntry =>
            {
                Some(frame)
            }
            _ => None,
        })
        .ok_or("generation-two authority entry was not delivered")?;
    assert_eq!(committed_frame.context, context(0, 0, 2)?);
    let committed_body: AuthorityEntryBody = serde_json::from_value(committed_frame.body.clone())?;
    assert_eq!(committed_body.revision, Revision::new(safe(2)));
    assert_eq!(committed_body.operation_id, second_operation);
    Ok(())
}

#[test]
fn replica_staged_reconnect_resends_and_starts_recovery_once() -> TestResult {
    let control = command_control(1, 72, 1);
    let operation_id = operation("replica.rebind.proposal")?;
    let mut kernel = replica_kernel(
        replica_config(vec![command_plan(&control, &operation_id, true)?])?,
        ui(
            initial_command_menu(&control, &operation_id)?,
            Some(seat(1)),
            true,
        ),
    );
    let armed = key_down(&mut kernel, seat(1))?;
    assert_eq!(
        armed
            .iter()
            .filter(|effect| matches!(effect, KernelEffect::SendProposal { .. }))
            .count(),
        1
    );
    key_up(&mut kernel, seat(1))?;

    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    let authority_connected = kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Connected,
        generation: generation(2),
    })?;
    let resent = authority_connected
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendProposal { proposal } => Some(proposal),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(resent.len(), 1);
    assert_eq!(resent[0].operation_id, operation_id);
    assert_eq!(resent[0].connection_generation, generation(2));
    let recovery_requests = authority_connected
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendFrame { frame, .. }
                if frame.frame_type == FrameType::RecoveryRequest =>
            {
                Some(frame)
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(recovery_requests.len(), 1);
    assert_eq!(
        recovery_requests[0].context.connection_generation,
        generation(2)
    );

    let local_connected = kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Connected,
        generation: generation(2),
    })?;
    assert!(!local_connected.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::SendProposal { .. }
                | KernelEffect::SendFrame { .. }
                | KernelEffect::EnterSharedTerminal { .. }
        )
    }));
    assert!(
        kernel
            .live_resources()
            .recovery_transactions
            .contains("recovery-2")
    );
    assert!(
        kernel
            .step(KernelInput::TransportChanged {
                endpoint: seat(0),
                state: TransportState::Connected,
                generation: generation(2),
            })?
            .is_empty()
    );
    assert!(
        kernel
            .live_resources()
            .recovery_transactions
            .contains("recovery-2")
    );
    Ok(())
}

#[test]
fn replica_recovery_fence_snapshot_is_fail_closed_and_truthful() -> TestResult {
    let mut kernel = replica_kernel(replica_config(Vec::new())?, UiState::default());
    let idle_snapshot = kernel.snapshot();
    let idle_fence = &idle_snapshot.state["protocol"]["recoveryFence"];
    assert_eq!(
        idle_fence,
        &json!({
            "state": "open",
            "commandAdmissionFrozen": false,
            "controlSurfaceStartFrozen": false,
            "progressionFrozen": false,
            "materializationFrozen": false,
            "authorityWaitCreationFrozen": false,
        })
    );
    assert!(idle_fence.get("terminalReason").is_none());

    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    let recovery_request = kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Connected,
        generation: generation(2),
    })?;
    assert!(recovery_request.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::SendFrame { frame, .. }
                if frame.frame_type == FrameType::RecoveryRequest
        )
    }));

    let held_snapshot = kernel.snapshot();
    let held_fence = &held_snapshot.state["protocol"]["recoveryFence"];
    assert_eq!(
        held_fence,
        &json!({
            "state": "held",
            "commandAdmissionFrozen": true,
            "controlSurfaceStartFrozen": true,
            "progressionFrozen": true,
            "materializationFrozen": true,
            "authorityWaitCreationFrozen": true,
        })
    );
    assert!(held_fence.get("terminalReason").is_none());

    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Connected,
        generation: generation(2),
    })?;
    assert_eq!(
        kernel.snapshot().state["protocol"]["recoveryFence"],
        *held_fence
    );

    let terminal = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: terminal_frame(
            context(0, 0, 2)?,
            "recovery-fence-disposed",
            "recovery fence disposed",
        )?,
    })?;
    assert!(
        terminal
            .iter()
            .any(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
    );
    assert_eq!(
        kernel.snapshot().state["protocol"]["recoveryFence"],
        Value::Null
    );
    Ok(())
}

#[test]
fn recovery_control_receipt_precedes_proof_and_reopened_ui() -> TestResult {
    let recovered_operation = operation("authority.recovered.commit")?;
    let menu_operation = operation("replica.recovered.command")?;
    let control = command_control(1, 73, 2);
    let control_id = control_id_of(&control);
    let mut kernel = replica_kernel(
        replica_config(vec![command_plan(&control, &menu_operation, false)?])?,
        UiState::default(),
    );

    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Disconnected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(0),
        state: TransportState::Connected,
        generation: generation(2),
    })?;
    kernel.step(KernelInput::TransportChanged {
        endpoint: seat(1),
        state: TransportState::Connected,
        generation: generation(2),
    })?;

    let recovered_entry = AuthorityEntry {
        context: context(0, 0, 2)?,
        revision: Revision::new(safe(1)),
        operation_id: recovered_operation.clone(),
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: "recovery-material".to_owned(),
            payload: turn_payload(),
        },
        next_control: control.clone(),
        subsumes: Vec::new(),
    };
    let bundle = RecoveryBundleBody {
        request_id: "recovery-2".to_owned(),
        material: recovered_entry.material.clone(),
        frontier: recovered_entry.revision,
        frontier_operation_id: Some(recovered_operation.clone()),
        membership_revision: recovered_entry.context.membership_revision,
        next_control: Some(control.clone()),
        required_tail: vec![AuthorityEntryBody::from(&recovered_entry)],
    };
    let accepted = kernel.step(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: network_frame(
            context(0, 0, 2)?,
            FrameType::RecoveryBundle,
            serde_json::to_value(bundle)?,
        ),
    })?;
    assert!(has_apply(&accepted, 1, &recovered_operation));

    let projected = kernel.step(KernelInput::MaterialApplied {
        endpoint: seat(1),
        revision: Revision::new(safe(1)),
        outcome: MaterialApplicationOutcome::Applied,
    })?;
    assert!(has_project(&projected, 1, &recovered_operation, &control));

    let completed = kernel.step(KernelInput::ControlProjected {
        endpoint: seat(1),
        revision: Revision::new(safe(1)),
        outcome: ControlProjectionOutcome::Installed {
            control_id: control_id.clone(),
        },
    })?;
    let receipt_index = completed
        .iter()
        .position(|effect| {
            matches!(
                effect,
                KernelEffect::SendFrame {
                    frame,
                    ..
                } if frame.frame_type == FrameType::AuthorityReceipt
            )
        })
        .ok_or("controlInstalled receipt effect was not emitted")?;
    let proof_index = completed
        .iter()
        .position(|effect| {
            matches!(
                effect,
                KernelEffect::SendFrame {
                    frame,
                    ..
                } if frame.frame_type == FrameType::RecoveryApplied
            )
        })
        .ok_or("recoveryApplied proof effect was not emitted")?;
    let ui_index = completed
        .iter()
        .position(|effect| matches!(effect, KernelEffect::UiChanged { .. }))
        .ok_or("recovered command UI was not reopened")?;
    assert!(receipt_index < proof_index);
    assert!(proof_index < ui_index);

    let KernelEffect::SendFrame {
        frame: receipt_frame,
        ..
    } = &completed[receipt_index]
    else {
        return Err("receipt effect changed shape".into());
    };
    let receipt: AuthorityReceiptBody = serde_json::from_value(receipt_frame.body.clone())?;
    assert_eq!(receipt.stage, AckStage::ControlInstalled);
    assert_eq!(receipt.control_id, Some(control_id.clone()));
    let KernelEffect::SendFrame {
        frame: proof_frame, ..
    } = &completed[proof_index]
    else {
        return Err("proof effect changed shape".into());
    };
    let proof: RecoveryAppliedProof = serde_json::from_value(proof_frame.body.clone())?;
    assert_eq!(proof.request_id, "recovery-2");
    assert_eq!(proof.control_id, Some(control_id.clone()));
    let Some(MenuState::Command(menu)) = kernel.ui_state().stack.last() else {
        return Err("recovered command menu was not installed".into());
    };
    assert_eq!(menu.operation_id, menu_operation);
    assert_eq!(menu.control_id, control_id);
    Ok(())
}
