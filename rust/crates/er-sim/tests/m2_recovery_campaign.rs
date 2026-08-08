use std::collections::BTreeMap;
use std::error::Error;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, MenuProposalPlan,
    ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityEntryDraft, AuthorityLogConfig, BackoffPolicy, PeerBinding,
    RecoveryTransactionConfig, control_id_of,
    DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS, DEFAULT_RECOVERY_PACING_MS,
    DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS,
};
use er_sim::{
    FaultOperation, PairEndpoint, PairOperation, PairStep, PresenterMode, SimulatedPair,
    SimulatedPairConfig,
};
use er_types::{
    AuthorityEntryKind, CancelPolicy, CommandControlTarget, CommandFrontierControl,
    ConnectionGeneration, FrameContext, FrameType, GameButton, InputMap, KeyBinding,
    KernelEffect, LiveResourceSnapshot, Material, MenuGeneration, MenuOption, MenuOptionId,
    MenuState, MembershipRevision, NextControl, OperationId, PhysicalKey, RunId, SafeU53, SeatId,
    SessionId, TerminalControl, UiIntent, UiState, UiViewKind, WaitingMenu,
};
use serde_json::{Value, json};

type TestResult = Result<(), Box<dyn Error>>;

const SEED: u64 = 0x0123_4567_dead_beef;
const HOST_SEAT: u64 = 0;
const GUEST_SEAT: u64 = 1;

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn operation(value: u64) -> Result<OperationId, Box<dyn Error>> {
    Ok(OperationId::new(format!("recovery-operation-{value}"))?)
}

fn context(sender_seat_id: u64) -> Result<FrameContext, Box<dyn Error>> {
    Ok(FrameContext {
        session_id: SessionId::new("m2-recovery-campaign")?,
        run_id: RunId::new("m2-recovery-run")?,
        session_epoch: safe(1),
        seat_map_id: "m2-recovery-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: seat(sender_seat_id),
        authority_seat_id: seat(HOST_SEAT),
        connection_generation: generation(0),
    })
}

fn input_map() -> InputMap {
    InputMap {
        keyboard: vec![
            KeyBinding {
                key: PhysicalKey::ArrowDown,
                button: GameButton::Down,
            },
            KeyBinding {
                key: PhysicalKey::Enter,
                button: GameButton::Submit,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: safe(250),
        repeat_interval_ms: safe(250),
    }
}

fn command_control(turn: u64, owner_seat_id: u64) -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1),
        wave: safe(1),
        turn: safe(turn),
        commands: vec![CommandControlTarget {
            owner_seat_id: seat(owner_seat_id),
            pokemon_id: safe(7),
            field_index: safe(0),
        }],
    })
}

fn next_control(turn: u64) -> NextControl {
    match turn {
        1 => command_control(2, GUEST_SEAT),
        2 => command_control(3, HOST_SEAT),
        3 => command_control(4, GUEST_SEAT),
        _ => NextControl::Terminal(TerminalControl {
            terminal_id: "recovery-campaign-complete".to_owned(),
        }),
    }
}

fn option(turn: u64) -> Result<MenuOption, Box<dyn Error>> {
    let option_id = MenuOptionId::new(format!("action-{turn}"))?;
    Ok(MenuOption {
        id: option_id,
        label_key: format!("recovery.action.{turn}"),
        enabled: true,
        visible: true,
    })
}

fn fingerprint(turn: u64) -> String {
    format!("recovery-fingerprint-{turn}")
}

fn command_menu(turn: u64, owner_seat_id: u64) -> Result<MenuState, Box<dyn Error>> {
    let control = command_control(turn, owner_seat_id);
    Ok(MenuState::Command(er_types::CommandMenu {
        operation_id: operation(turn)?,
        control_id: control_id_of(&control),
        cursor: safe(0),
        options: vec![option(turn)?],
        cancel: CancelPolicy::Disabled,
    }))
}

fn command_plan(turn: u64, owner_seat_id: u64) -> Result<ControlMenuPlan, Box<dyn Error>> {
    let option = option(turn)?;
    let control = command_control(turn, owner_seat_id);
    Ok(ControlMenuPlan::Command {
        control_id: control_id_of(&control),
        owner_seat_id: seat(owner_seat_id),
        operation_id: operation(turn)?,
        field_index: safe(0),
        options: vec![option.clone()],
        proposals: vec![MenuProposalPlan {
            option_id: option.id,
            fingerprint: fingerprint(turn),
            payload: json!({
                "surface": "m2-recovery-campaign",
                "turn": turn,
            }),
        }],
        cancel: CancelPolicy::Disabled,
    })
}

fn resolution_plan(
    authority_context: &FrameContext,
    turn: u64,
) -> Result<AuthorityResolutionPlan, Box<dyn Error>> {
    let operation_id = operation(turn)?;
    Ok(AuthorityResolutionPlan {
        operation_id: operation_id.clone(),
        fingerprint: fingerprint(turn),
        draft: AuthorityEntryDraft {
            context: authority_context.clone(),
            operation_id,
            kind: AuthorityEntryKind::TurnCommit,
            material: Material {
                digest: format!("recovery-material-{turn}"),
                payload: json!({
                    "epoch": 1,
                    "wave": 1,
                    "turn": turn,
                    "material": "full-entry",
                }),
            },
            next_control: next_control(turn),
            subsumes: Vec::new(),
        },
    })
}

fn protocol_configs() -> Result<(ProtocolKernelConfig, ProtocolKernelConfig), Box<dyn Error>> {
    let authority_context = context(HOST_SEAT)?;
    let replica_context = context(GUEST_SEAT)?;
    let menu_plans = vec![
        command_plan(1, HOST_SEAT)?,
        command_plan(2, GUEST_SEAT)?,
        command_plan(3, HOST_SEAT)?,
        command_plan(4, GUEST_SEAT)?,
    ];
    let resolutions = (1..=4)
        .map(|turn| resolution_plan(&authority_context, turn))
        .collect::<Result<Vec<_>, _>>()?;

    let authority = ProtocolKernelConfig {
        role: ProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: authority_context,
                peer_bindings: vec![PeerBinding {
                    seat_id: seat(GUEST_SEAT),
                    connection_generation: generation(0),
                }],
                owner_id: "m2-recovery-campaign-authority".to_owned(),
                retain_capacity: safe(16),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(250),
                    maximum_ms: safe(5_000),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: er_types::TimeClass::Connected,
                max_delivery_attempts: Some(safe(1)),
            },
            proposal_capacity: safe(8_192),
            resolutions,
        },
        menu_plans: menu_plans.clone(),
    };

    let replica = ProtocolKernelConfig {
        role: ProtocolRoleConfig::Replica {
            replica: er_protocol::AuthorityReplicaConfig {
                receipt_context: replica_context.clone(),
                authority_seat_id: seat(HOST_SEAT),
                authority_connection_generation: generation(0),
            },
            proposal_leases: er_protocol::ProposalLeaseConfig {
                owner_prefix: "m2-recovery-campaign-proposal".to_owned(),
                retry_initial_ms: safe(250),
                retry_maximum_ms: safe(5_000),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context: replica_context,
                request_timeout_ms: safe(DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS),
                control_timeout_ms: safe(DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS),
                pacing_ms: safe(DEFAULT_RECOVERY_PACING_MS),
                timer_owner_id: "m2-recovery-campaign-recovery".to_owned(),
            },
        },
        menu_plans,
    };

    Ok((authority, replica))
}

fn campaign_config() -> Result<SimulatedPairConfig, Box<dyn Error>> {
    let (authority, replica) = protocol_configs()?;
    Ok(SimulatedPairConfig {
        host_kernel: KernelConfig {
            input_map: input_map(),
            initial_ui: UiState {
                generation: MenuGeneration::new(safe(1)),
                owner_seat: Some(seat(HOST_SEAT)),
                actionable: true,
                stack: vec![command_menu(1, HOST_SEAT)?],
            },
            protocol: Some(authority),
        },
        guest_kernel: KernelConfig {
            input_map: input_map(),
            initial_ui: UiState {
                generation: MenuGeneration::new(safe(1)),
                owner_seat: None,
                actionable: false,
                stack: vec![MenuState::Waiting(WaitingMenu {
                    prompt_key: Some("recovery.waiting".to_owned()),
                })],
            },
            protocol: Some(replica),
        },
        host_seat: seat(HOST_SEAT),
        guest_seat: seat(GUEST_SEAT),
        seed: SEED,
        presenter: PresenterMode::Instant,
        initial_storage: BTreeMap::new(),
        event_budget: safe(10_000),
    })
}

fn drop_queued_packets(pair: &mut SimulatedPair, trace: &mut Vec<PairStep>) -> TestResult {
    let Some(last) = trace.last() else {
        return Err(std::io::Error::other("cannot drop packets without a campaign step").into());
    };
    let packet_ids = last
        .snapshot
        .network
        .queued_packet_ids
        .iter()
        .copied()
        .collect::<Vec<_>>();
    for packet_id in packet_ids {
        trace.push(pair.apply(PairOperation::Fault {
            operation: FaultOperation::Drop { packet_id },
        })?);
    }
    Ok(())
}

fn hold_new_packets_after_guest_action(
    pair: &mut SimulatedPair,
    trace: &mut Vec<PairStep>,
) -> TestResult {
    let action_start = trace.len();
    trace.extend(pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?);
    let emitted_proposal = trace[action_start..].iter().any(|step| {
        step.generated_effects.iter().any(|effect| {
            matches!(
                effect,
                KernelEffect::SendProposal { proposal } if proposal.from == seat(GUEST_SEAT)
            )
        })
    });
    let mut previous = trace
        .last()
        .map(|step| step.snapshot.network.queued_packet_ids.clone())
        .ok_or_else(|| std::io::Error::other("guest action did not produce a campaign step"))?;

    for _ in 0..12 {
        let step = pair.advance_time(safe(1))?;
        let current = step.snapshot.network.queued_packet_ids.clone();
        let added = current
            .difference(&previous)
            .copied()
            .collect::<Vec<_>>();
        let removed = previous.difference(&current).next().is_some();
        trace.push(step);

        let hold_now = (!emitted_proposal && !added.is_empty()) || (emitted_proposal && removed);
        if hold_now && !added.is_empty() {
            for packet_id in added {
                trace.push(pair.apply(PairOperation::Fault {
                    operation: FaultOperation::Delay {
                        packet_id,
                        additional_ms: safe(1_000),
                    },
                })?);
            }
            return Ok(());
        }
        previous = trace
            .last()
            .map(|step| step.snapshot.network.queued_packet_ids.clone())
            .ok_or_else(|| std::io::Error::other("campaign lost its packet snapshot"))?;
    }

    Err(std::io::Error::other(
        "guest proposal did not reach the authority within the deterministic window",
    )
    .into())
}

fn find_frontier(value: &Value) -> Option<(u64, u64, u64)> {
    match value {
        Value::Object(object) => {
            if let (Some(received), Some(material), Some(control)) = (
                object.get("received").and_then(Value::as_u64),
                object.get("material").and_then(Value::as_u64),
                object.get("control").and_then(Value::as_u64),
            ) {
                return Some((received, material, control));
            }
            object.values().find_map(find_frontier)
        }
        Value::Array(values) => values.iter().find_map(find_frontier),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => None,
    }
}

fn guest_frontier(step: &PairStep) -> Option<(u64, u64, u64)> {
    find_frontier(&step.snapshot.guest.kernel.state)
}

fn recovery_fence_is_held(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            let frozen_fields = [
                "commandAdmissionFrozen",
                "controlSurfaceStartFrozen",
                "progressionFrozen",
                "materializationFrozen",
                "authorityWaitCreationFrozen",
            ];
            if object.get("state").and_then(Value::as_str) == Some("held")
                && frozen_fields
                    .iter()
                    .all(|field| object.contains_key(*field))
            {
                return true;
            }
            object.values().any(recovery_fence_is_held)
        }
        Value::Array(values) => values.iter().any(recovery_fence_is_held),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => false,
    }
}

fn recovery_fence_is_open(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            let frozen_fields = [
                "commandAdmissionFrozen",
                "controlSurfaceStartFrozen",
                "progressionFrozen",
                "materializationFrozen",
                "authorityWaitCreationFrozen",
            ];
            if object.get("state").and_then(Value::as_str) == Some("open")
                && frozen_fields
                    .iter()
                    .all(|field| object.get(*field) == Some(&Value::Bool(false)))
            {
                return true;
            }
            object.values().any(recovery_fence_is_open)
        }
        Value::Array(values) => values.iter().any(recovery_fence_is_open),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => false,
    }
}

fn effects(steps: &[PairStep]) -> Vec<KernelEffect> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter().cloned())
        .collect()
}

fn has_frame(effects: &[KernelEffect], frame_type: FrameType) -> bool {
    effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::SendFrame { frame, .. } if frame.frame_type == frame_type
        )
    })
}

fn recovery_bundle_bodies(steps: &[PairStep]) -> Vec<Value> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::SendFrame { frame, .. }
                if frame.frame_type == FrameType::RecoveryBundle =>
            {
                Some(frame.body.clone())
            }
            _ => None,
        })
        .collect()
}

fn assert_full_tail_entry(entry: &Value, expected_revision: u64) {
    for field in [
        "revision",
        "operationId",
        "kind",
        "material",
        "nextControl",
        "subsumes",
    ] {
        assert!(entry.get(field).is_some(), "recovery tail lacks {field}");
    }
    assert_eq!(entry["revision"], json!(expected_revision));
    assert_eq!(entry["operationId"], json!(format!("recovery-operation-{expected_revision}")));
    assert!(entry["material"].is_object());
    assert!(entry["nextControl"].is_object());
}

fn guest_submitted_command(effects: &[KernelEffect]) -> bool {
    effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::UiIntent {
                endpoint,
                intent: UiIntent::CommandSubmitted { .. },
            } if *endpoint == seat(GUEST_SEAT)
        )
    })
}

#[test]
fn recovery_campaign_fences_dense_tail_and_rejoins_on_physical_input() -> TestResult {
    let mut pair = SimulatedPair::new(campaign_config()?)?;
    let mut trace = Vec::new();

    trace.extend(pair.press(PairEndpoint::Host, PhysicalKey::Enter)?);
    trace.push(pair.advance_time(safe(10))?);
    drop_queued_packets(&mut pair, &mut trace)?;

    let after_first_entry = trace
        .last()
        .ok_or_else(|| std::io::Error::other("first entry did not produce a campaign step"))?;
    assert_eq!(after_first_entry.snapshot.seed, SEED.to_string());
    assert_eq!(after_first_entry.snapshot.network.seed, SEED.to_string());
    assert_eq!(guest_frontier(after_first_entry), Some((1, 1, 1)));
    assert_eq!(
        after_first_entry.snapshot.guest.ui.kind,
        UiViewKind::Command
    );
    assert_eq!(
        after_first_entry.snapshot.guest.ui.owner_seat,
        Some(seat(GUEST_SEAT))
    );
    let stale_generation = after_first_entry.snapshot.guest.ui.generation;

    trace.push(pair.key_down(
        PairEndpoint::Guest,
        PhysicalKey::ArrowDown,
        false,
    )?);
    hold_new_packets_after_guest_action(&mut pair, &mut trace)?;

    trace.extend(pair.press(PairEndpoint::Host, PhysicalKey::Enter)?);
    let disconnect_step = pair.apply(PairOperation::Disconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    trace.push(disconnect_step);
    let recovery_start = trace.len();
    trace.push(pair.apply(PairOperation::Reconnect {
        endpoint: PairEndpoint::Guest,
    })?);

    let reconnect_step = trace
        .get(recovery_start)
        .ok_or_else(|| std::io::Error::other("reconnect did not produce a campaign step"))?;
    assert_eq!(reconnect_step.snapshot.seed, SEED.to_string());
    assert_ne!(
        reconnect_step.snapshot.guest.ui.generation,
        stale_generation
    );
    assert_eq!(reconnect_step.snapshot.guest.ui.kind, UiViewKind::Waiting);
    assert!(!reconnect_step.snapshot.guest.ui.actionable);
    assert!(
        !reconnect_step
            .snapshot
            .guest
            .live_resources
            .recovery_transactions
            .is_empty(),
        "recovery must retain a live transaction while its request is in flight"
    );
    assert!(
        recovery_fence_is_held(&reconnect_step.snapshot.guest.kernel.state),
        "the recovery fence must be held before the request is emitted"
    );
    assert!(has_frame(
        &reconnect_step.generated_effects,
        FrameType::RecoveryRequest
    ));

    for _ in 0..48 {
        let step = pair.advance_time(safe(10))?;
        trace.push(step);
        let Some(last) = trace.last() else {
            return Err(std::io::Error::other("recovery trace unexpectedly became empty").into());
        };
        if guest_frontier(last) == Some((3, 3, 3))
            && last
                .snapshot
                .guest
                .live_resources
                .recovery_transactions
                .is_empty()
        {
            break;
        }
    }

    let recovery_trace = &trace[recovery_start..];
    let recovery_effects = effects(recovery_trace);
    assert!(has_frame(&recovery_effects, FrameType::RecoveryRequest));
    assert!(has_frame(&recovery_effects, FrameType::RecoveryBundle));

    let bundles = recovery_bundle_bodies(recovery_trace);
    assert_eq!(bundles.len(), 1);
    let bundle = &bundles[0];
    assert_eq!(bundle["frontier"], json!(3));
    assert_eq!(
        bundle["frontierOperationId"],
        json!("recovery-operation-3")
    );
    let tail = bundle["requiredTail"]
        .as_array()
        .ok_or_else(|| std::io::Error::other("recovery bundle did not contain a required tail"))?;
    assert_eq!(tail.len(), 2);
    assert_full_tail_entry(&tail[0], 2);
    assert_full_tail_entry(&tail[1], 3);

    let material_index = recovery_effects.iter().position(|effect| {
        matches!(
            effect,
            KernelEffect::ApplyAuthorityMaterial { endpoint, .. }
                if *endpoint == seat(GUEST_SEAT)
        )
    });
    let control_index = recovery_effects.iter().position(|effect| {
        matches!(
            effect,
            KernelEffect::ProjectAuthorityControl { endpoint, .. }
                if *endpoint == seat(GUEST_SEAT)
        )
    });
    let applied_index = recovery_effects.iter().position(|effect| {
        matches!(
            effect,
            KernelEffect::SendFrame { frame, .. }
                if frame.frame_type == FrameType::RecoveryApplied
        )
    });
    let (Some(material_index), Some(control_index), Some(applied_index)) =
        (material_index, control_index, applied_index)
    else {
        return Err(std::io::Error::other(
            "recovery did not emit material, control, and applied-proof effects",
        )
        .into());
    };
    assert!(
        material_index < control_index && control_index < applied_index,
        "recovery must apply material, project control, then send the applied proof"
    );
    assert!(
        recovery_effects[..control_index].iter().all(|effect| {
            !matches!(
                effect,
                KernelEffect::SendProposal { proposal } if proposal.from == seat(GUEST_SEAT)
            ) && !matches!(
                effect,
                KernelEffect::UiIntent {
                    endpoint,
                    intent: UiIntent::CommandSubmitted { .. },
                } if *endpoint == seat(GUEST_SEAT)
            )
        }),
        "N+1 must remain blocked while the recovered control is pending"
    );

    let applied_step_index = recovery_trace
        .iter()
        .position(|step| {
            step.generated_effects.iter().any(|effect| {
                matches!(
                    effect,
                    KernelEffect::SendFrame { frame, .. }
                        if frame.frame_type == FrameType::RecoveryApplied
                )
            })
        })
        .ok_or_else(|| std::io::Error::other("recovery proof step was not retained in the trace"))?;
    assert!(
        recovery_trace[..applied_step_index].iter().all(|step| {
            !step
                .snapshot
                .guest
                .live_resources
                .recovery_transactions
                .is_empty()
                && recovery_fence_is_held(&step.snapshot.guest.kernel.state)
        }),
        "the recovery transaction and fence must remain live until the applied proof"
    );
    assert!(
        recovery_trace[applied_step_index..].iter().any(|step| {
            step.snapshot
                .guest
                .live_resources
                .recovery_transactions
                .is_empty()
                && recovery_fence_is_open(&step.snapshot.guest.kernel.state)
        }),
        "the recovery transaction and fence may release only after the applied proof"
    );

    let final_step = trace
        .last()
        .ok_or_else(|| std::io::Error::other("recovery trace did not produce a final step"))?;
    assert_eq!(guest_frontier(final_step), Some((3, 3, 3)));
    assert_eq!(final_step.snapshot.guest.ui.kind, UiViewKind::Command);
    assert_eq!(
        final_step.snapshot.guest.ui.owner_seat,
        Some(seat(GUEST_SEAT))
    );
    assert!(final_step.snapshot.guest.ui.actionable);
    assert!(
        final_step
            .snapshot
            .guest
            .live_resources
            .recovery_transactions
            .is_empty()
    );
    assert!(final_step
        .snapshot
        .guest
        .live_resources
        .controls
        .contains(&control_id_of(&command_control(4, GUEST_SEAT))));

    trace.push(pair.key_up(PairEndpoint::Guest, PhysicalKey::ArrowDown)?);
    let post_rejoin_steps = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert!(guest_submitted_command(&effects(&post_rejoin_steps)));
    trace.extend(post_rejoin_steps);

    let torn_down = pair.teardown("m2-recovery-campaign")?;
    assert_eq!(torn_down.seed, SEED.to_string());
    assert_eq!(torn_down.network.seed, SEED.to_string());
    assert_eq!(torn_down.host.live_resources, LiveResourceSnapshot::default());
    assert_eq!(
        torn_down.guest.live_resources,
        LiveResourceSnapshot::default()
    );
    assert!(torn_down.network.queued_packet_ids.is_empty());
    Ok(())
}
