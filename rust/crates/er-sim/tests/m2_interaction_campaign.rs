use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, MenuProposalPlan,
    ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding,
    ProposalLeaseConfig, RecoveryTransactionConfig, control_id_of, fingerprint_reward,
};
use er_sim::{
    FaultOperation, PairEndpoint, PairOperation, PairSnapshot, PairStep, PresenterMode,
    SimulatedPair, SimulatedPairConfig, SimulatedPairError,
};
use er_types::{
    AuthorityEntryKind, AwaitSuccessorControl, CancelPolicy, ConnectionGeneration, FrameContext,
    GameButton, InputMap, InteractionMenu, InteractionSuccessor, KernelEffect, Material,
    MembershipRevision, MenuGeneration, MenuOption, MenuOptionId, MenuState, NextControl,
    OperationId, PhysicalKey, ProposalMessage, SafeI53, SafeU53, SeatId, SharedInteractionControl,
    TimeClass, UiState, UiViewKind,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const INTERACTION_OPERATION: &str = "interaction/reward/1";
const INTERACTION_SURFACE: &str = "op:reward";
const INTERACTION_KIND: &str = "REWARD_PRESENT";
const SUCCESSOR_KIND: &str = "REWARD";

#[derive(Debug)]
struct CampaignFixture {
    pair: SimulatedPair,
    host: SeatId,
    guest: SeatId,
    interaction_operation: OperationId,
    interaction_control_id: String,
    wait_control_id: String,
    proposal_fingerprint: String,
    proposal_payload: Value,
}

fn error(message: impl Into<String>) -> Box<dyn Error> {
    Box::new(std::io::Error::other(message.into()))
}

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn seat(value: u64) -> TestResult<SeatId> {
    Ok(SeatId::new(safe(value)?))
}

fn generation(value: u64) -> TestResult<ConnectionGeneration> {
    Ok(ConnectionGeneration::new(safe(value)?))
}

fn operation(value: &str) -> TestResult<OperationId> {
    Ok(OperationId::new(value)?)
}

fn context(sender: SeatId, connection_generation: ConnectionGeneration) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: er_types::SessionId::new("m2b-06-interaction-session")?,
        run_id: er_types::RunId::new("m2b-06-interaction-run")?,
        session_epoch: safe(1)?,
        seat_map_id: "m2b-06-host-guest".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)?),
        sender_seat_id: sender,
        authority_seat_id: seat(1)?,
        connection_generation,
    })
}

fn input_map() -> TestResult<InputMap> {
    Ok(InputMap {
        keyboard: vec![er_types::KeyBinding {
            key: PhysicalKey::Enter,
            button: GameButton::Submit,
        }],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: safe(250)?,
        repeat_interval_ms: safe(250)?,
    })
}

fn interaction_control(
    owner_seat_id: SeatId,
    operation_id: OperationId,
) -> TestResult<NextControl> {
    Ok(NextControl::SharedInteraction(SharedInteractionControl {
        operation_id,
        owner_seat_id,
        epoch: safe(1)?,
        wave: safe(1)?,
        turn: safe(1)?,
        surface_class: INTERACTION_SURFACE.to_owned(),
        operation_kind: INTERACTION_KIND.to_owned(),
        successor: InteractionSuccessor {
            operation_kinds: vec![SUCCESSOR_KIND.to_owned()],
            operation_ids: Some(vec![operation("interaction/reward/result")?]),
        },
    }))
}

fn successor_wait(operation_id: OperationId) -> TestResult<NextControl> {
    Ok(NextControl::AwaitSuccessor(AwaitSuccessorControl {
        after_operation_id: operation_id,
        epoch: safe(1)?,
        wave: safe(1)?,
        turn: safe(1)?,
        allowed_kinds: vec![
            AuthorityEntryKind::InteractionCommit,
            AuthorityEntryKind::ControlCommit,
            AuthorityEntryKind::TerminalCommit,
        ],
        allowed_interaction_addresses: None,
        allowed_control_addresses: None,
        allow_next_wave_start: false,
        expected_operation_id: None,
    }))
}

fn interaction_options() -> TestResult<Vec<MenuOption>> {
    Ok(vec![MenuOption {
        id: MenuOptionId::new("reward:take")?,
        label_key: "interaction.reward.take".to_owned(),
        enabled: true,
        visible: true,
    }])
}

fn guest_interaction_ui(
    guest: SeatId,
    operation_id: OperationId,
    control_id: String,
    options: Vec<MenuOption>,
) -> TestResult<UiState> {
    Ok(UiState {
        generation: MenuGeneration::new(safe(7)?),
        owner_seat: Some(guest),
        actionable: true,
        stack: vec![MenuState::Interaction(InteractionMenu {
            operation_id,
            control_id,
            surface_class: INTERACTION_SURFACE.to_owned(),
            operation_kind: INTERACTION_KIND.to_owned(),
            choice: er_types::ChoiceListMenu {
                cursor: safe(0)?,
                page: safe(0)?,
                wrap: false,
                options,
                cancel: CancelPolicy::Disabled,
            },
        })],
    })
}

fn build_fixture() -> TestResult<CampaignFixture> {
    let host = seat(1)?;
    let guest = seat(2)?;
    let connection_generation = generation(0)?;
    let host_context = context(host, connection_generation)?;
    let guest_context = context(guest, connection_generation)?;
    let interaction_operation = operation(INTERACTION_OPERATION)?;
    let initial_control = interaction_control(guest, interaction_operation.clone())?;
    let interaction_control_id = control_id_of(&initial_control);
    let next_control = successor_wait(interaction_operation.clone())?;
    let wait_control_id = control_id_of(&next_control);
    let options = interaction_options()?;
    let option_id = options[0].id.clone();
    let proposal_fingerprint = fingerprint_reward(
        safe(42)?,
        "reward",
        SafeI53::ZERO,
        None,
        None,
    )?;
    let proposal_payload = json!({
        "choice": "take-reward",
        "campaign": "m2b-06",
    });

    let menu_plan = ControlMenuPlan::Interaction {
        control_id: interaction_control_id.clone(),
        owner_seat_id: guest,
        operation_id: interaction_operation.clone(),
        surface_class: INTERACTION_SURFACE.to_owned(),
        operation_kind: INTERACTION_KIND.to_owned(),
        options,
        proposals: vec![MenuProposalPlan {
            option_id,
            fingerprint: proposal_fingerprint.clone(),
            payload: proposal_payload.clone(),
        }],
        cancel: CancelPolicy::Disabled,
    };

    let draft = er_protocol::AuthorityEntryDraft {
        context: host_context.clone(),
        operation_id: interaction_operation.clone(),
        kind: AuthorityEntryKind::InteractionCommit,
        material: Material {
            digest: "digest:m2b-06:interaction:take-reward".to_owned(),
            payload: json!({
                "surfaceClass": INTERACTION_SURFACE,
                "envelope": {
                    "sessionEpoch": 1,
                    "wave": 1,
                    "turn": 1,
                    "pendingOperation": {
                        "id": INTERACTION_OPERATION,
                        "kind": SUCCESSOR_KIND,
                        "status": "applied",
                        "payload": proposal_payload.clone(),
                    },
                },
            }),
        },
        next_control,
        subsumes: Vec::new(),
    };

    let authority_log = AuthorityLogConfig {
        local_context: host_context,
        peer_bindings: vec![PeerBinding {
            seat_id: guest,
            connection_generation,
        }],
        owner_id: "m2b-06:authority".to_owned(),
        retain_capacity: safe(32)?,
        delivery_backoff: BackoffPolicy {
            initial_ms: safe(5_000)?,
            maximum_ms: safe(5_000)?,
            factor_numerator: safe(1)?,
            factor_denominator: safe(1)?,
        },
        delivery_time_class: TimeClass::Connected,
        max_delivery_attempts: None,
    };
    let replica = AuthorityReplicaConfig {
        receipt_context: guest_context.clone(),
        authority_seat_id: host,
        authority_connection_generation: connection_generation,
    };
    let proposal_leases = ProposalLeaseConfig {
        owner_prefix: "m2b-06:proposal:".to_owned(),
        retry_initial_ms: safe(250)?,
        retry_maximum_ms: safe(5_000)?,
        absolute_ceiling_ms: safe(1_200_000)?,
    };
    let recovery = RecoveryTransactionConfig {
        local_context: guest_context,
        request_timeout_ms: safe(300_000)?,
        control_timeout_ms: safe(30_000)?,
        pacing_ms: safe(16)?,
        timer_owner_id: "m2b-06:recovery".to_owned(),
    };

    let host_kernel = KernelConfig {
        input_map: input_map()?,
        initial_ui: UiState::default(),
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Authority {
                log: authority_log,
                proposal_capacity: safe(8_192)?,
                resolutions: vec![AuthorityResolutionPlan {
                    operation_id: interaction_operation.clone(),
                    fingerprint: proposal_fingerprint.clone(),
                    draft,
                }],
            },
            menu_plans: vec![menu_plan.clone()],
        }),
    };
    let guest_kernel = KernelConfig {
        input_map: input_map()?,
        initial_ui: guest_interaction_ui(
            guest,
            interaction_operation.clone(),
            interaction_control_id.clone(),
            interaction_options()?,
        )?,
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Replica {
                replica,
                proposal_leases,
                recovery,
            },
            menu_plans: vec![menu_plan],
        }),
    };

    let pair = SimulatedPair::new(SimulatedPairConfig {
        host_kernel,
        guest_kernel,
        host_seat: host,
        guest_seat: guest,
        seed: 0x2b06,
        presenter: PresenterMode::Instant,
        initial_storage: BTreeMap::new(),
        event_budget: safe(10_000)?,
    })?;

    Ok(CampaignFixture {
        pair,
        host,
        guest,
        interaction_operation,
        interaction_control_id,
        wait_control_id,
        proposal_fingerprint,
        proposal_payload,
    })
}

fn only_queued(snapshot: &PairSnapshot, label: &str) -> TestResult<SafeU53> {
    let mut ids = snapshot.network.queued_packet_ids.iter().copied();
    let Some(packet_id) = ids.next() else {
        return Err(error(format!("{label}: expected one queued packet")));
    };
    if ids.next().is_some() {
        return Err(error(format!("{label}: expected exactly one queued packet")));
    }
    Ok(packet_id)
}

fn new_packet_id(
    before: &BTreeSet<SafeU53>,
    after: &BTreeSet<SafeU53>,
    label: &str,
) -> TestResult<SafeU53> {
    let mut ids = after.difference(before).copied();
    let Some(packet_id) = ids.next() else {
        return Err(error(format!("{label}: expected one new packet")));
    };
    if ids.next().is_some() {
        return Err(error(format!("{label}: expected exactly one new packet")));
    }
    Ok(packet_id)
}

fn fault(pair: &mut SimulatedPair, operation: FaultOperation) -> TestResult<PairStep> {
    Ok(pair.apply(PairOperation::Fault { operation })?)
}

fn proposal_effects(steps: &[PairStep]) -> Vec<ProposalMessage> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::SendProposal { proposal } => Some(proposal.clone()),
            _ => None,
        })
        .collect()
}

fn send_frame_count(steps: &[PairStep]) -> usize {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter(|effect| matches!(effect, KernelEffect::SendFrame { .. }))
        .count()
}

fn material_apply_count(steps: &[PairStep]) -> usize {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter(|effect| matches!(effect, KernelEffect::ApplyAuthorityMaterial { .. }))
        .count()
}

fn assert_zero_live_resources(snapshot: &er_types::LiveResourceSnapshot) {
    assert!(snapshot.timers.is_empty());
    assert!(snapshot.presentations.is_empty());
    assert!(snapshot.storage_requests.is_empty());
    assert!(snapshot.delivery_leases.is_empty());
    assert!(snapshot.proposal_leases.is_empty());
    assert!(snapshot.recovery_transactions.is_empty());
    assert!(snapshot.waits.is_empty());
    assert!(snapshot.retained_revisions.is_empty());
    assert!(snapshot.controls.is_empty());
    assert!(snapshot.network_packets.is_empty());
}

#[test]
fn raw_shared_interaction_campaign_deduplicates_retries_and_material() -> TestResult {
    let mut fixture = build_fixture()?;
    let initial = fixture.pair.snapshot()?;
    assert_eq!(initial.guest.ui.kind, UiViewKind::Interaction);
    assert_eq!(initial.guest.ui.owner_seat, Some(fixture.guest));
    assert!(initial.guest.ui.actionable);
    let Some(MenuState::Interaction(menu)) = initial.guest.kernel.ui.stack.last() else {
        return Err(error("initial guest menu is not a shared interaction"));
    };
    assert_eq!(menu.operation_id, fixture.interaction_operation);
    assert_eq!(menu.control_id, fixture.interaction_control_id);
    assert_eq!(menu.surface_class, INTERACTION_SURFACE);
    assert_eq!(menu.operation_kind, INTERACTION_KIND);

    let host_attempt = fixture.pair.press(PairEndpoint::Host, PhysicalKey::Enter)?;
    assert!(proposal_effects(&host_attempt).is_empty());
    assert_eq!(fixture.pair.snapshot()?.guest.ui, initial.guest.ui);

    let guest_press = fixture.pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    let proposals = proposal_effects(&guest_press);
    assert_eq!(proposals.len(), 1);
    let submitted = proposals[0].clone();
    assert_eq!(submitted.operation_id, fixture.interaction_operation);
    assert_eq!(submitted.fingerprint, fixture.proposal_fingerprint);
    assert_eq!(submitted.from, fixture.guest);
    assert_eq!(submitted.to, fixture.host);
    assert_eq!(submitted.connection_generation, generation(0)?);
    assert_eq!(submitted.payload, fixture.proposal_payload);

    let press_step = guest_press
        .last()
        .ok_or_else(|| error("raw guest press did not produce steps"))?;
    let proposal_queue = press_step.snapshot.network.queued_packet_ids.clone();
    let proposal_packet = only_queued(&press_step.snapshot, "proposal enqueue")?;

    let duplicated_proposal = fault(
        &mut fixture.pair,
        FaultOperation::Duplicate {
            packet_id: proposal_packet,
        },
    )?;
    let duplicate_proposal_packet = new_packet_id(
        &proposal_queue,
        &duplicated_proposal.snapshot.network.queued_packet_ids,
        "proposal duplicate",
    )?;
    let _ = fault(
        &mut fixture.pair,
        FaultOperation::Delay {
            packet_id: proposal_packet,
            additional_ms: safe(70)?,
        },
    )?;
    let _ = fault(
        &mut fixture.pair,
        FaultOperation::Delay {
            packet_id: duplicate_proposal_packet,
            additional_ms: safe(20)?,
        },
    )?;
    let reordered_proposal = fault(
        &mut fixture.pair,
        FaultOperation::Reorder {
            packet_ids: vec![duplicate_proposal_packet, proposal_packet],
        },
    )?;
    assert!(
        reordered_proposal
            .snapshot
            .network
            .queued_packet_ids
            .contains(&proposal_packet)
    );
    assert!(
        reordered_proposal
            .snapshot
            .network
            .queued_packet_ids
            .contains(&duplicate_proposal_packet)
    );

    let first_proposal_delivery = fixture.pair.advance_time(safe(25)?)?;
    assert!(
        first_proposal_delivery
            .snapshot
            .network
            .queued_packet_ids
            .contains(&proposal_packet)
    );
    assert!(
        !first_proposal_delivery
            .snapshot
            .network
            .queued_packet_ids
            .contains(&duplicate_proposal_packet)
    );
    assert_eq!(send_frame_count(std::slice::from_ref(&first_proposal_delivery)), 1);
    let after_first_proposal = first_proposal_delivery
        .snapshot
        .network
        .queued_packet_ids
        .clone();
    let material_packet = after_first_proposal
        .iter()
        .copied()
        .find(|packet_id| *packet_id != proposal_packet)
        .ok_or_else(|| error("authority did not enqueue the interaction material"))?;
    assert_eq!(after_first_proposal.len(), 2);

    let _ = fault(
        &mut fixture.pair,
        FaultOperation::Delay {
            packet_id: material_packet,
            additional_ms: safe(300)?,
        },
    )?;
    let resend_step = fixture.pair.advance_time(safe(250)?)?;
    let resent = proposal_effects(std::slice::from_ref(&resend_step));
    assert_eq!(resent, vec![submitted.clone()]);
    assert!(
        resend_step
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .contains(&fixture.interaction_operation)
    );
    let resend_packet = new_packet_id(
        &BTreeSet::from([material_packet]),
        &resend_step.snapshot.network.queued_packet_ids,
        "proposal resend",
    )?;
    assert_ne!(resend_packet, material_packet);

    let retry_delivery = fixture.pair.advance_time(safe(10)?)?;
    assert!(
        retry_delivery
            .snapshot
            .network
            .queued_packet_ids
            .contains(&material_packet)
    );
    assert_eq!(send_frame_count(std::slice::from_ref(&retry_delivery)), 0);
    let material_queue_before_duplicate = retry_delivery
        .snapshot
        .network
        .queued_packet_ids
        .clone();

    let duplicated_material = fault(
        &mut fixture.pair,
        FaultOperation::Duplicate {
            packet_id: material_packet,
        },
    )?;
    let duplicate_material_packet = new_packet_id(
        &material_queue_before_duplicate,
        &duplicated_material.snapshot.network.queued_packet_ids,
        "material duplicate",
    )?;
    let _ = fault(
        &mut fixture.pair,
        FaultOperation::Delay {
            packet_id: material_packet,
            additional_ms: safe(60)?,
        },
    )?;
    let _ = fault(
        &mut fixture.pair,
        FaultOperation::Delay {
            packet_id: duplicate_material_packet,
            additional_ms: safe(10)?,
        },
    )?;
    let _ = fault(
        &mut fixture.pair,
        FaultOperation::Reorder {
            packet_ids: vec![duplicate_material_packet, material_packet],
        },
    )?;

    let early_material = fixture.pair.advance_time(safe(20)?)?;
    assert!(
        early_material
            .snapshot
            .network
            .queued_packet_ids
            .contains(&material_packet)
    );
    assert!(
        early_material
            .snapshot
            .network
            .queued_packet_ids
            .contains(&duplicate_material_packet)
    );

    let first_material = fixture.pair.advance_time(safe(40)?)?;
    assert!(
        first_material
            .snapshot
            .network
            .queued_packet_ids
            .contains(&material_packet)
    );
    assert!(
        !first_material
            .snapshot
            .network
            .queued_packet_ids
            .contains(&duplicate_material_packet)
    );
    assert_eq!(material_apply_count(std::slice::from_ref(&first_material)), 1);
    assert_eq!(first_material.snapshot.guest.ui.kind, UiViewKind::Waiting);
    assert!(!first_material.snapshot.guest.ui.actionable);
    assert!(
        first_material
            .snapshot
            .guest
            .live_resources
            .controls
            .contains(&fixture.wait_control_id)
    );
    assert!(
        first_material
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .is_empty()
    );
    let material_state_digest = first_material.snapshot.guest.state_digest.clone();

    let second_material = fixture.pair.advance_time(safe(50)?)?;
    assert!(
        !second_material
            .snapshot
            .network
            .queued_packet_ids
            .contains(&material_packet)
    );
    assert_eq!(material_apply_count(std::slice::from_ref(&second_material)), 0);
    assert_eq!(second_material.snapshot.guest.state_digest, material_state_digest);
    assert_eq!(second_material.snapshot.guest.ui.kind, UiViewKind::Waiting);

    let _ = fixture.pair.advance_time(safe(10)?)?;
    let settled = fixture.pair.snapshot()?;
    assert!(settled.guest.live_resources.proposal_leases.is_empty());
    assert!(settled.host.live_resources.retained_revisions.is_empty());
    assert!(settled.guest.live_resources.waits.contains(&fixture.wait_control_id));

    let torn_down = fixture.pair.teardown("m2b-06 interaction campaign complete")?;
    assert_zero_live_resources(&torn_down.host.live_resources);
    assert_zero_live_resources(&torn_down.guest.live_resources);
    assert!(torn_down.network.queued_packet_ids.is_empty());
    assert!(torn_down.presenter.pending_event_ids.is_empty());
    assert!(torn_down.storage.pending_request_ids.is_empty());
    assert!(torn_down.network.disposed);
    assert!(torn_down.presenter.disposed);
    assert!(torn_down.storage.disposed);
    assert!(matches!(
        fixture.pair.snapshot(),
        Err(SimulatedPairError::Disposed)
    ));
    Ok(())
}
