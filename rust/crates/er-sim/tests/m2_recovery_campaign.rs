use std::collections::BTreeMap;
use std::error::Error;

use serde::de::DeserializeOwned;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, MenuProposalPlan,
    ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityEntryBody, AuthorityEntryDraft, AuthorityLogConfig, BackoffPolicy, PeerBinding,
    ProposalFingerprintInput, ProposalJson, RecoveryAppliedProof, RecoveryBundleBody,
    RecoveryRequestBody, RecoveryTransactionConfig, control_id_of, proposal_fingerprint,
    DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS, DEFAULT_RECOVERY_PACING_MS,
    DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS,
};
use er_sim::{
    FaultOperation, PairEndpoint, PairOperation, PairSnapshot, PairStep, PresenterMode,
    SimulatedPair, SimulatedPairConfig, SimulatedPairError,
};
use er_types::{
    AuthorityEntryKind, CancelPolicy, CommandControlTarget, CommandFrontierControl,
    ConnectionGeneration, FrameContext, FrameType, GameButton, InputMap, KeyBinding, KernelEffect,
    LiveResourceSnapshot, Material, MenuGeneration, MenuOption, MenuOptionId, MenuState,
    MembershipRevision, NetworkFrame, NextControl, OperationId, PhysicalKey, ProposalMessage,
    Revision, RunId, SafeU53, SeatId, SessionId, UiIntent, UiState, UiViewKind, WaitingMenu,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

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

fn revision(value: u64) -> Revision {
    Revision::new(safe(value))
}

fn operation(value: u64) -> Result<OperationId, Box<dyn Error>> {
    Ok(OperationId::new(format!("recovery-operation-{value}"))?)
}

fn context(sender_seat_id: u64) -> Result<FrameContext, Box<dyn Error>> {
    context_at(sender_seat_id, 0)
}

fn context_at(
    sender_seat_id: u64,
    connection_generation: u64,
) -> Result<FrameContext, Box<dyn Error>> {
    Ok(FrameContext {
        session_id: SessionId::new("m2-recovery-campaign")?,
        run_id: RunId::new("m2-recovery-run")?,
        session_epoch: safe(1),
        seat_map_id: "m2-recovery-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: seat(sender_seat_id),
        authority_seat_id: seat(HOST_SEAT),
        connection_generation: generation(connection_generation),
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
        4 => command_control(5, HOST_SEAT),
        _ => command_control(turn + 1, HOST_SEAT),
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

fn proposal_payload(turn: u64) -> Value {
    json!({
        "surface": "m2-recovery-campaign",
        "turn": turn,
    })
}

fn production_proposal_fingerprint(turn: u64) -> Result<String, Box<dyn Error>> {
    let wire = ProposalJson::new(serde_json::to_string(&proposal_payload(turn))?)?;
    Ok(proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(turn),
        label: format!("recovery.action.{turn}"),
        choice: er_types::SafeI53::ZERO,
        wire: Some(wire),
        reward_surface: None,
    })?)
}

fn material(turn: u64) -> Material {
    Material {
        digest: format!("recovery-material-{turn}"),
        payload: json!({
            "epoch": 1,
            "wave": 1,
            "turn": turn,
            "material": "full-entry",
        }),
    }
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
            fingerprint: production_proposal_fingerprint(turn)?,
            payload: proposal_payload(turn),
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
        fingerprint: production_proposal_fingerprint(turn)?,
        draft: AuthorityEntryDraft {
            context: authority_context.clone(),
            operation_id,
            kind: AuthorityEntryKind::TurnCommit,
            material: material(turn),
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
        initial_storage: BTreeMap::from([(
            "m2-recovery-campaign".to_owned(),
            json!({"seed": SEED.to_string(), "purpose": "teardown evidence"}),
        )]),
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

fn frame_effects<'a>(
    effects: &'a [KernelEffect],
    frame_type: FrameType,
) -> Vec<(SeatId, &'a NetworkFrame)> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendFrame { from, frame } if frame.frame_type == frame_type => {
                Some((*from, frame))
            }
            _ => None,
        })
        .collect()
}

fn typed_frame_body<T: DeserializeOwned>(frame: &NetworkFrame) -> TestResult<T> {
    Ok(serde_json::from_value(frame.body.clone())?)
}

fn expected_tail_entry(expected_revision: u64) -> TestResult<AuthorityEntryBody> {
    Ok(AuthorityEntryBody {
        revision: revision(expected_revision),
        operation_id: operation(expected_revision)?,
        kind: AuthorityEntryKind::TurnCommit,
        material: material(expected_revision),
        next_control: next_control(expected_revision),
        subsumes: Vec::new(),
    })
}

fn assert_full_tail_entry(entry: &AuthorityEntryBody, expected_revision: u64) -> TestResult {
    let expected = expected_tail_entry(expected_revision)?;
    assert_eq!(entry, &expected, "recovery tail entry identity drifted");
    assert_eq!(entry.material.digest, format!("recovery-material-{expected_revision}"));
    assert_eq!(entry.material.payload, material(expected_revision).payload);
    assert_eq!(control_id_of(&entry.next_control), control_id_of(&expected.next_control));
    Ok(())
}

fn proposal_effects(steps: &[PairStep]) -> Vec<&ProposalMessage> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::SendProposal { proposal } => Some(proposal),
            _ => None,
        })
        .collect()
}

fn assert_proposal_identities(
    steps: &[PairStep],
    expected: &[(u64, ConnectionGeneration)],
) -> TestResult {
    let proposals = proposal_effects(steps);
    assert_eq!(proposals.len(), expected.len());
    for (proposal, (turn, expected_generation)) in proposals
        .into_iter()
        .zip(expected.iter().copied())
    {
        assert_eq!(proposal.operation_id, operation(turn)?);
        assert_eq!(proposal.fingerprint, production_proposal_fingerprint(turn)?);
        assert_eq!(proposal.from, seat(GUEST_SEAT));
        assert_eq!(proposal.to, seat(HOST_SEAT));
        assert_eq!(proposal.connection_generation, expected_generation);
        assert_eq!(proposal.payload, proposal_payload(turn));
    }
    Ok(())
}

fn has_guest_stale_effect(effects: &[KernelEffect]) -> bool {
    effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::UiIntent { endpoint, .. } if *endpoint == seat(GUEST_SEAT)
        ) || matches!(
            effect,
            KernelEffect::SendProposal { proposal } if proposal.from == seat(GUEST_SEAT)
        )
    })
}

fn recovery_transaction_is_held(step: &PairStep) -> bool {
    !step
        .snapshot
        .guest
        .live_resources
        .recovery_transactions
        .is_empty()
        && step.snapshot.guest.ui.kind == UiViewKind::Waiting
        && !step.snapshot.guest.ui.actionable
}

fn assert_zero_resources(snapshot: &PairSnapshot) {
    for endpoint in [&snapshot.host, &snapshot.guest] {
        assert!(endpoint.live_resources.timers.is_empty());
        assert!(endpoint.live_resources.presentations.is_empty());
        assert!(endpoint.live_resources.storage_requests.is_empty());
        assert!(endpoint.live_resources.delivery_leases.is_empty());
        assert!(endpoint.live_resources.proposal_leases.is_empty());
        assert!(endpoint.live_resources.recovery_transactions.is_empty());
        assert!(endpoint.live_resources.waits.is_empty());
        assert!(endpoint.live_resources.retained_revisions.is_empty());
        assert!(endpoint.live_resources.controls.is_empty());
        assert!(endpoint.live_resources.network_packets.is_empty());
        assert_eq!(endpoint.live_resources, LiveResourceSnapshot::default());
    }
    assert_eq!(snapshot.host.live_resources, LiveResourceSnapshot::default());
    assert_eq!(snapshot.guest.live_resources, LiveResourceSnapshot::default());
    assert!(snapshot.network.queued_packet_ids.is_empty());
    assert!(snapshot.network.disconnected_endpoints.is_empty());
    assert!(snapshot.network.suspended_endpoints.is_empty());
    assert!(snapshot.network.disposed);
    assert!(snapshot.presenter.pending_event_ids.is_empty());
    assert!(snapshot.presenter.settled_event_ids.is_empty());
    assert!(snapshot.presenter.disposed);
    assert!(snapshot.storage.pending_request_ids.is_empty());
    assert!(snapshot.storage.keys.is_empty());
    assert!(snapshot.storage.disposed);
}

fn assert_post_disposal_rejected(pair: &mut SimulatedPair) -> TestResult {
    assert!(matches!(
        pair.snapshot(),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(
        pair.apply(PairOperation::AdvanceTime {
            delta_ms: SafeU53::ZERO,
        }),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(
        pair.key_down(PairEndpoint::Guest, PhysicalKey::Enter, false),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(
        pair.teardown("m2-recovery-campaign repeated teardown"),
        Err(SimulatedPairError::Disposed)
    ));
    Ok(())
}

fn assert_fresh_guest_command(
    steps: &[PairStep],
    expected_generation: MenuGeneration,
) -> TestResult {
    let intents = steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::UiIntent { endpoint, intent } if *endpoint == seat(GUEST_SEAT) => {
                Some(intent)
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(intents.len(), 1, "fresh raw input must emit one guest intent");
    match intents[0] {
        UiIntent::CommandSubmitted {
            seat: submitted_seat,
            generation,
            operation_id,
            control_id,
            option_id,
        } => {
            assert_eq!(submitted_seat, &seat(GUEST_SEAT));
            assert_eq!(generation, &expected_generation);
            assert_eq!(operation_id, &operation(4)?);
            assert_eq!(control_id, &control_id_of(&command_control(4, GUEST_SEAT)));
            let expected_option_id = option(4)?.id;
            assert_eq!(option_id, &expected_option_id);
        }
        intent => {
            return Err(std::io::Error::other(format!(
                "fresh raw input emitted the wrong typed intent: {intent:?}"
            ))
            .into());
        }
    }
    Ok(())
}

fn run_campaign() -> TestResult<(Vec<PairStep>, PairSnapshot)> {
    assert!(matches!(next_control(4), NextControl::CommandFrontier(_)));
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
    assert_eq!(
        after_first_entry.snapshot.guest.ui.kind,
        UiViewKind::Command
    );
    assert_eq!(
        after_first_entry.snapshot.guest.ui.owner_seat,
        Some(seat(GUEST_SEAT))
    );
    let stale_generation = after_first_entry.snapshot.guest.ui.generation;

    let pre_recovery_action_start = trace.len();
    trace.push(pair.key_down(
        PairEndpoint::Guest,
        PhysicalKey::ArrowDown,
        false,
    )?);
    hold_new_packets_after_guest_action(&mut pair, &mut trace)?;
    assert_proposal_identities(
        &trace[pre_recovery_action_start..],
        &[(2, generation(0))],
    )?;

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
    assert!(recovery_transaction_is_held(reconnect_step));
    assert!(has_frame(
        &reconnect_step.generated_effects,
        FrameType::RecoveryRequest
    ));

    let reconnect_time = reconnect_step.snapshot.virtual_time_ms;
    let held_advance = pair.advance_time(safe(250))?;
    assert_eq!(
        held_advance.operation,
        PairOperation::AdvanceTime { delta_ms: safe(250) }
    );
    assert_eq!(
        held_advance.snapshot.virtual_time_ms,
        safe(reconnect_time.get() + 250)
    );
    assert!(
        !has_guest_stale_effect(&held_advance.generated_effects),
        "the held pre-recovery input must not emit a stale intent or proposal"
    );
    trace.push(held_advance);

    for _ in 0..48 {
        let step = pair.advance_time(safe(10))?;
        let recovery_released = step
            .snapshot
            .guest
            .live_resources
            .recovery_transactions
            .is_empty()
            && has_frame(&step.generated_effects, FrameType::RecoveryApplied);
        trace.push(step);
        if recovery_released {
            break;
        }
    }

    let recovery_trace = &trace[recovery_start..];
    let recovery_effects = effects(recovery_trace);
    let request_frames = frame_effects(&recovery_effects, FrameType::RecoveryRequest);
    assert_eq!(request_frames.len(), 1);
    let (request_from, request_frame) = request_frames[0];
    assert_eq!(request_from, seat(GUEST_SEAT));
    assert_eq!(request_frame.context, context_at(GUEST_SEAT, 1)?);
    assert_eq!(request_frame.context.sender_seat_id, seat(GUEST_SEAT));
    assert_eq!(request_frame.context.connection_generation, generation(1));
    let request: RecoveryRequestBody = typed_frame_body(request_frame)?;
    assert!(!request.request_id.is_empty());
    assert_eq!(request.captured_frontier, revision(1));
    assert_eq!(request.reason, "reconnect");

    let bundle_frames = frame_effects(&recovery_effects, FrameType::RecoveryBundle);
    assert_eq!(bundle_frames.len(), 1);
    let (bundle_from, bundle_frame) = bundle_frames[0];
    assert_eq!(bundle_from, seat(HOST_SEAT));
    assert_eq!(bundle_frame.context, context_at(HOST_SEAT, 1)?);
    assert_eq!(bundle_frame.context.sender_seat_id, seat(HOST_SEAT));
    assert_eq!(bundle_frame.context.connection_generation, generation(1));
    let bundle: RecoveryBundleBody = typed_frame_body(bundle_frame)?;
    assert_eq!(bundle.request_id, request.request_id);
    assert_eq!(bundle.material, material(3));
    assert_eq!(bundle.frontier, revision(3));
    assert_eq!(bundle.frontier_operation_id, Some(operation(3)?));
    assert_eq!(bundle.membership_revision, MembershipRevision::new(safe(1)));
    assert_eq!(bundle.next_control, Some(next_control(3)));
    let tail = &bundle.required_tail;
    assert_eq!(tail.len(), 2);
    assert_full_tail_entry(&tail[0], 2)?;
    assert_full_tail_entry(&tail[1], 3)?;
    let final_entry = tail[1].clone().with_context(bundle_frame.context.clone());
    let expected_final_entry = expected_tail_entry(3)?.with_context(bundle_frame.context.clone());
    assert_eq!(final_entry, expected_final_entry);
    assert_eq!(final_entry.context, context_at(HOST_SEAT, 1)?);
    assert_eq!(tail[1].revision, revision(3));
    assert_eq!(tail[1].operation_id, operation(3)?);
    assert_eq!(tail[1].material.digest, material(3).digest);
    assert_eq!(tail[1].next_control, next_control(3));

    let material_effects = recovery_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ApplyAuthorityMaterial {
                endpoint,
                revision,
                operation_id,
                material,
            } if *endpoint == seat(GUEST_SEAT) => {
                Some((*endpoint, *revision, operation_id.clone(), material.clone()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(material_effects.len(), 1);
    let (material_endpoint, material_revision, material_operation, applied_material) =
        &material_effects[0];
    assert_eq!(material_endpoint, &seat(GUEST_SEAT));
    assert_eq!(material_revision, &revision(3));
    assert_eq!(material_operation, &operation(3)?);
    assert_eq!(applied_material, &material(3));

    let control_effects = recovery_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ProjectAuthorityControl {
                endpoint,
                revision,
                operation_id,
                control,
            } if *endpoint == seat(GUEST_SEAT) => {
                Some((*endpoint, *revision, operation_id.clone(), control.clone()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(control_effects.len(), 1);
    let (control_endpoint, control_revision, control_operation, projected_control) =
        &control_effects[0];
    let expected_control_id = control_id_of(&next_control(3));
    assert_eq!(control_endpoint, &seat(GUEST_SEAT));
    assert_eq!(control_revision, &revision(3));
    assert_eq!(control_operation, &operation(3)?);
    assert_eq!(projected_control, &next_control(3));
    assert_eq!(control_id_of(projected_control), expected_control_id);

    let applied_frames = frame_effects(&recovery_effects, FrameType::RecoveryApplied);
    assert_eq!(applied_frames.len(), 1);
    let (applied_from, applied_frame) = applied_frames[0];
    assert_eq!(applied_from, seat(GUEST_SEAT));
    assert_eq!(applied_frame.context, context_at(GUEST_SEAT, 1)?);
    assert_eq!(applied_frame.context.sender_seat_id, seat(GUEST_SEAT));
    assert_eq!(applied_frame.context.connection_generation, generation(1));
    let proof: RecoveryAppliedProof = typed_frame_body(applied_frame)?;
    assert_eq!(proof.request_id, request.request_id);
    assert_eq!(proof.frontier, revision(3));
    assert_eq!(proof.material_digest, material(3).digest);
    assert_eq!(proof.control_id, Some(expected_control_id.clone()));

    let material_index = recovery_effects
        .iter()
        .position(|effect| matches!(effect, KernelEffect::ApplyAuthorityMaterial { .. }))
        .ok_or_else(|| std::io::Error::other("material effect was not emitted"))?;
    let control_index = recovery_effects
        .iter()
        .position(|effect| matches!(effect, KernelEffect::ProjectAuthorityControl { .. }))
        .ok_or_else(|| std::io::Error::other("control effect was not emitted"))?;
    let applied_index = recovery_effects
        .iter()
        .position(|effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { frame, .. }
                    if frame.frame_type == FrameType::RecoveryApplied
            )
        })
        .ok_or_else(|| std::io::Error::other("recovery proof effect was not emitted"))?;
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

    let request_step_index = recovery_trace
        .iter()
        .position(|step| has_frame(&step.generated_effects, FrameType::RecoveryRequest))
        .ok_or_else(|| std::io::Error::other("recovery request step was not retained"))?;
    let held_step_index = recovery_trace
        .iter()
        .position(recovery_transaction_is_held)
        .ok_or_else(|| std::io::Error::other("recovery fence was not observed as held"))?;
    assert!(
        held_step_index <= request_step_index,
        "the typed recovery transaction/fence must be held before the request"
    );
    assert!(recovery_transaction_is_held(&recovery_trace[request_step_index]));
    assert!(
        recovery_trace
            .iter()
            .all(|step| !has_guest_stale_effect(&step.generated_effects)),
        "the held pre-recovery input must not emit stale UiIntent or proposal effects"
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
            recovery_transaction_is_held(step)
        }),
        "the recovery transaction/fence and blocked surface must remain live until the applied proof"
    );
    let first_released_step = recovery_trace
        .iter()
        .position(|step| {
            step.snapshot
                .guest
                .live_resources
                .recovery_transactions
                .is_empty()
        })
        .ok_or_else(|| std::io::Error::other("recovery transaction was never released"))?;
    assert!(
        first_released_step >= applied_step_index,
        "recovery transaction/fence released before the applied proof"
    );
    let first_open_step = recovery_trace
        .iter()
        .position(|step| step.snapshot.guest.ui.actionable)
        .ok_or_else(|| std::io::Error::other("recovered command surface was never opened"))?;
    assert!(
        first_open_step >= applied_step_index,
        "recovered command surface opened before the applied proof"
    );
    assert!(
        recovery_trace[applied_step_index..].iter().any(|step| {
            step.snapshot
                .guest
                .live_resources
                .recovery_transactions
                .is_empty()
                && step.snapshot.guest.ui.kind == UiViewKind::Command
                && step.snapshot.guest.ui.actionable
        }),
        "recovery transaction/fence release must expose the recovered command only after proof"
    );

    let final_step = trace
        .last()
        .ok_or_else(|| std::io::Error::other("recovery trace did not produce a final step"))?;
    assert_eq!(final_step.snapshot.guest.ui.kind, UiViewKind::Command);
    assert_eq!(
        final_step.snapshot.guest.ui.owner_seat,
        Some(seat(GUEST_SEAT))
    );
    assert!(final_step.snapshot.guest.ui.actionable);
    assert_ne!(final_step.snapshot.guest.ui.generation, stale_generation);
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

    let fresh_menu_generation = final_step.snapshot.guest.ui.generation;
    trace.push(pair.key_up(PairEndpoint::Guest, PhysicalKey::ArrowDown)?);
    let post_rejoin_steps = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert_fresh_guest_command(&post_rejoin_steps, fresh_menu_generation)?;
    assert_proposal_identities(
        &post_rejoin_steps,
        &[(4, generation(1))],
    )?;
    trace.extend(post_rejoin_steps);

    let before_teardown = pair.snapshot()?;
    assert!(!before_teardown.storage.keys.is_empty());
    let torn_down = pair.teardown("m2-recovery-campaign")?;
    assert_eq!(torn_down.seed, SEED.to_string());
    assert_eq!(torn_down.network.seed, SEED.to_string());
    assert_zero_resources(&torn_down);
    assert_post_disposal_rejected(&mut pair)?;
    Ok((trace, torn_down))
}

#[test]
fn recovery_campaign_fences_dense_tail_and_rejoins_on_physical_input() -> TestResult {
    let first = run_campaign()?;
    let second = run_campaign()?;
    assert_eq!(first, second, "recovery campaign must repeat byte-for-byte");
    assert!(first.0.iter().all(|step| !step.effects_digest.is_empty()));
    Ok(())
}
