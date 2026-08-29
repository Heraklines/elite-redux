use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, KernelEffect, MenuProposalPlan,
    ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AckStage, AuthorityEntryBody, AuthorityLogConfig, AuthorityReceiptBody, AuthorityReplicaConfig,
    BackoffPolicy, PeerBinding, ProposalFingerprintInput, ProposalLeaseConfig,
    RecoveryTransactionConfig, control_id_of, proposal_fingerprint,
};
use er_sim::{
    FaultOperation, PairEndpoint, PairOperation, PairSnapshot, PairStep, PresenterMode,
    SimulatedPair, SimulatedPairConfig, SimulatedPairError,
};
use er_types::{
    AuthorityEntryKind, AuthorityFrontier, AwaitSuccessorControl, CancelPolicy,
    ConnectionGeneration, FRAME_PROTOCOL_VERSION, FrameContext, FrameType, GameButton, InputMap,
    InteractionMenu, InteractionSuccessor, Material, MembershipRevision, MenuGeneration,
    MenuOption, MenuOptionId, MenuState, NextControl, OperationId, PhysicalKey,
    PresentationEventId, PresentationOutcome, ProposalMessage, Revision, SafeI53, SafeU53, SeatId,
    SharedInteractionControl, TimeClass, UiIntent, UiState, UiViewKind,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const INTERACTION_OPERATION: &str = "interaction/reward/1";
const INTERACTION_SURFACE: &str = "op:reward";
const INTERACTION_KIND: &str = "REWARD_PRESENT";
const SUCCESSOR_KIND: &str = "REWARD";
const PRODUCTION_PROPOSAL_FINGERPRINT: &str = r#"[42,"reward",0,null,null]"#;
const CAMPAIGN_SEED: u64 = 0x2b06;
const TEARDOWN_REASON: &str = "m2b-06 interaction campaign complete";

#[derive(Debug)]
struct CampaignFixture {
    pair: SimulatedPair,
    host: SeatId,
    guest: SeatId,
    interaction_operation: OperationId,
    interaction_revision: Revision,
    interaction_control_id: String,
    wait_control_id: String,
    wait_control: NextControl,
    interaction_material: Material,
    authority_context: FrameContext,
    receipt_context: FrameContext,
    option_id: MenuOptionId,
    proposal_fingerprint: String,
    proposal_payload: Value,
}

#[derive(Debug)]
struct CampaignRun {
    trace: Vec<PairStep>,
    final_snapshot: PairSnapshot,
}

#[derive(Clone, Debug, PartialEq)]
struct NormalizedPairStep {
    operation: PairOperation,
    generated_effects: Vec<KernelEffect>,
    snapshot: PairSnapshot,
}

#[derive(Clone, Debug, PartialEq)]
struct ReceiptEvidence {
    from: SeatId,
    version: u32,
    frame_type: FrameType,
    context: FrameContext,
    body: AuthorityReceiptBody,
    raw_body: Value,
}

#[derive(Clone, Debug, PartialEq)]
struct EntryEvidence {
    from: SeatId,
    version: u32,
    frame_type: FrameType,
    context: FrameContext,
    body: AuthorityEntryBody,
    raw_body: Value,
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

fn revision(value: u64) -> TestResult<Revision> {
    Ok(Revision::new(safe(value)?))
}

fn operation(value: &str) -> TestResult<OperationId> {
    Ok(OperationId::new(value)?)
}

fn context(
    sender: SeatId,
    connection_generation: ConnectionGeneration,
) -> TestResult<FrameContext> {
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

fn build_fixture(seed: u64, presenter: PresenterMode) -> TestResult<CampaignFixture> {
    let host = seat(1)?;
    let guest = seat(2)?;
    let connection_generation = generation(0)?;
    let host_context = context(host, connection_generation)?;
    let guest_context = context(guest, connection_generation)?;
    let interaction_operation = operation(INTERACTION_OPERATION)?;
    let interaction_revision = revision(1)?;
    let initial_control = interaction_control(guest, interaction_operation.clone())?;
    let interaction_control_id = control_id_of(&initial_control);
    let next_control = successor_wait(interaction_operation.clone())?;
    let wait_control_id = control_id_of(&next_control);
    let options = interaction_options()?;
    let option_id = options
        .first()
        .ok_or_else(|| error("interaction plan has no option"))?
        .id
        .clone();
    let proposal_fingerprint = proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(42)?,
        label: "reward".to_owned(),
        choice: SafeI53::ZERO,
        wire: None,
        reward_surface: None,
    })?;
    if proposal_fingerprint != PRODUCTION_PROPOSAL_FINGERPRINT {
        return Err(error("production proposal fingerprint identity drifted"));
    }
    let proposal_payload = json!({
        "choice": "take-reward",
        "campaign": "m2b-06",
    });
    let interaction_material = Material {
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
    };

    let menu_plan = ControlMenuPlan::Interaction {
        control_id: interaction_control_id.clone(),
        owner_seat_id: guest,
        operation_id: interaction_operation.clone(),
        surface_class: INTERACTION_SURFACE.to_owned(),
        operation_kind: INTERACTION_KIND.to_owned(),
        options,
        proposals: vec![MenuProposalPlan {
            option_id: option_id.clone(),
            fingerprint: proposal_fingerprint.clone(),
            payload: proposal_payload.clone(),
        }],
        cancel: CancelPolicy::Disabled,
    };

    let draft = er_protocol::AuthorityEntryDraft {
        context: host_context.clone(),
        operation_id: interaction_operation.clone(),
        kind: AuthorityEntryKind::InteractionCommit,
        material: interaction_material.clone(),
        next_control: next_control.clone(),
        subsumes: Vec::new(),
    };

    let authority_log = AuthorityLogConfig {
        local_context: host_context.clone(),
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
        local_context: guest_context.clone(),
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
        seed,
        presenter,
        initial_storage: BTreeMap::new(),
        event_budget: safe(10_000)?,
    })?;

    Ok(CampaignFixture {
        pair,
        host,
        guest,
        interaction_operation,
        interaction_revision,
        interaction_control_id,
        wait_control_id,
        wait_control: next_control,
        interaction_material,
        authority_context: host_context,
        receipt_context: guest_context,
        option_id,
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
        return Err(error(format!(
            "{label}: expected exactly one queued packet"
        )));
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

fn normalized_trace(steps: &[PairStep]) -> Vec<NormalizedPairStep> {
    steps
        .iter()
        .map(|step| NormalizedPairStep {
            operation: step.operation.clone(),
            generated_effects: step.generated_effects.clone(),
            snapshot: step.snapshot.clone(),
        })
        .collect()
}

fn ui_intent_effects(steps: &[PairStep]) -> Vec<(SeatId, UiIntent)> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::UiIntent { endpoint, intent } => Some((*endpoint, intent.clone())),
            _ => None,
        })
        .collect()
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

fn authority_entry_effects(steps: &[PairStep]) -> TestResult<Vec<EntryEvidence>> {
    let mut entries = Vec::new();
    for effect in steps.iter().flat_map(|step| step.generated_effects.iter()) {
        let KernelEffect::SendFrame { from, frame } = effect else {
            continue;
        };
        if frame.frame_type != FrameType::AuthorityEntry {
            continue;
        }
        entries.push(EntryEvidence {
            from: *from,
            version: frame.version,
            frame_type: frame.frame_type,
            context: frame.context.clone(),
            body: serde_json::from_value(frame.body.clone())?,
            raw_body: frame.body.clone(),
        });
    }
    Ok(entries)
}

fn receipt_effects(steps: &[PairStep]) -> TestResult<Vec<ReceiptEvidence>> {
    let mut receipts = Vec::new();
    for effect in steps.iter().flat_map(|step| step.generated_effects.iter()) {
        let KernelEffect::SendFrame { from, frame } = effect else {
            continue;
        };
        if frame.frame_type != FrameType::AuthorityReceipt {
            continue;
        }
        receipts.push(ReceiptEvidence {
            from: *from,
            version: frame.version,
            frame_type: frame.frame_type,
            context: frame.context.clone(),
            body: serde_json::from_value(frame.body.clone())?,
            raw_body: frame.body.clone(),
        });
    }
    Ok(receipts)
}

fn material_effects(steps: &[PairStep]) -> Vec<(SeatId, Revision, OperationId, Material)> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::ApplyAuthorityMaterial {
                endpoint,
                revision,
                operation_id,
                material,
            } => Some((*endpoint, *revision, operation_id.clone(), material.clone())),
            _ => None,
        })
        .collect()
}

fn control_effects(steps: &[PairStep]) -> Vec<(SeatId, Revision, OperationId, NextControl)> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::ProjectAuthorityControl {
                endpoint,
                revision,
                operation_id,
                control,
            } => Some((*endpoint, *revision, operation_id.clone(), control.clone())),
            _ => None,
        })
        .collect()
}

fn packet_ids_for_sends<F>(
    before: &BTreeSet<SafeU53>,
    step: &PairStep,
    mut predicate: F,
) -> TestResult<Vec<SafeU53>>
where
    F: FnMut(&KernelEffect) -> bool,
{
    let sends = step
        .generated_effects
        .iter()
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { .. } | KernelEffect::SendProposal { .. }
            )
        })
        .collect::<Vec<_>>();
    let packet_ids = step
        .snapshot
        .network
        .queued_packet_ids
        .difference(before)
        .copied()
        .collect::<Vec<_>>();
    if sends.len() != packet_ids.len() {
        return Err(error(
            "network send effects did not map exactly to new packet ids",
        ));
    }
    Ok(sends
        .into_iter()
        .zip(packet_ids)
        .filter_map(|(effect, packet_id)| predicate(effect).then_some(packet_id))
        .collect())
}

fn only_packet_for_sends<F>(
    before: &BTreeSet<SafeU53>,
    step: &PairStep,
    predicate: F,
    label: &str,
) -> TestResult<SafeU53>
where
    F: FnMut(&KernelEffect) -> bool,
{
    let packet_ids = packet_ids_for_sends(before, step, predicate)?;
    if packet_ids.len() != 1 {
        return Err(error(format!(
            "{label}: expected exactly one matching packet, got {}",
            packet_ids.len()
        )));
    }
    packet_ids
        .first()
        .copied()
        .ok_or_else(|| error(format!("{label}: matching packet disappeared")))
}

fn is_receipt_stage(effect: &KernelEffect, stage: AckStage) -> bool {
    let KernelEffect::SendFrame { frame, .. } = effect else {
        return false;
    };
    frame.frame_type == FrameType::AuthorityReceipt
        && matches!(
            serde_json::from_value::<AuthorityReceiptBody>(frame.body.clone()),
            Ok(body) if body.stage == stage
        )
}

fn is_authority_entry(effect: &KernelEffect) -> bool {
    matches!(
        effect,
        KernelEffect::SendFrame { frame, .. } if frame.frame_type == FrameType::AuthorityEntry
    )
}

fn presentation_effects(steps: &[PairStep]) -> Vec<(SeatId, PresentationEventId)> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::Present { endpoint, event } => Some((*endpoint, event.event_id)),
            _ => None,
        })
        .collect()
}

fn expected_receipt(
    fixture: &CampaignFixture,
    stage: AckStage,
    control_id: Option<&str>,
) -> TestResult<ReceiptEvidence> {
    let body = AuthorityReceiptBody {
        revision: fixture.interaction_revision,
        operation_id: fixture.interaction_operation.clone(),
        stage,
        control_id: control_id.map(str::to_owned),
    };
    Ok(ReceiptEvidence {
        from: fixture.guest,
        version: FRAME_PROTOCOL_VERSION,
        frame_type: FrameType::AuthorityReceipt,
        context: fixture.receipt_context.clone(),
        raw_body: serde_json::to_value(&body)?,
        body,
    })
}

fn receipt_frontier_chain(receipts: &[ReceiptEvidence]) -> TestResult<Vec<AuthorityFrontier>> {
    let mut frontier = AuthorityFrontier::default();
    let mut chain = vec![frontier];

    for receipt in receipts {
        let revision = receipt.body.revision;
        match receipt.body.stage {
            AckStage::Admitted => {
                if revision > frontier.received {
                    frontier.received = revision;
                }
            }
            AckStage::MaterialApplied => {
                if frontier.received < revision {
                    return Err(error("material receipt advanced before admission"));
                }
                if revision > frontier.material {
                    frontier.material = revision;
                }
            }
            AckStage::ControlInstalled => {
                if frontier.material < revision {
                    return Err(error("control receipt advanced before material"));
                }
                if revision > frontier.control {
                    frontier.control = revision;
                }
            }
            AckStage::PresentationSettled => {
                if frontier.control < revision {
                    return Err(error("presentation receipt advanced before control"));
                }
            }
        }
        if frontier.received < frontier.material || frontier.material < frontier.control {
            return Err(error("replica receipt frontier order regressed"));
        }
        chain.push(frontier);
    }

    Ok(chain)
}

fn actual_replica_frontier(snapshot: &PairSnapshot) -> TestResult<AuthorityFrontier> {
    let protocol = snapshot
        .guest
        .kernel
        .state
        .get("protocol")
        .ok_or_else(|| error("guest kernel state has no protocol diagnostics"))?;
    assert_eq!(
        protocol.get("role").and_then(Value::as_str),
        Some("replica"),
        "guest kernel protocol diagnostics are not for a replica"
    );
    let replica = protocol
        .get("replica")
        .ok_or_else(|| error("guest kernel protocol diagnostics have no replica state"))?;
    let frontier = replica
        .get("frontier")
        .ok_or_else(|| error("guest kernel replica state has no frontier"))?;
    Ok(serde_json::from_value(frontier.clone())?)
}

fn assert_zero_live_resources(snapshot: &er_types::LiveResourceSnapshot) {
    assert_eq!(snapshot, &er_types::LiveResourceSnapshot::default());
}

fn run_campaign(seed: u64) -> TestResult<CampaignRun> {
    let mut fixture = build_fixture(seed, PresenterMode::Instant)?;
    let mut trace = Vec::new();
    assert_eq!(
        fixture.proposal_fingerprint,
        PRODUCTION_PROPOSAL_FINGERPRINT
    );

    let expected_ui = guest_interaction_ui(
        fixture.guest,
        fixture.interaction_operation.clone(),
        fixture.interaction_control_id.clone(),
        interaction_options()?,
    )?;
    let expected_proposal = ProposalMessage {
        operation_id: fixture.interaction_operation.clone(),
        fingerprint: PRODUCTION_PROPOSAL_FINGERPRINT.to_owned(),
        from: fixture.guest,
        to: fixture.host,
        connection_generation: generation(0)?,
        payload: fixture.proposal_payload.clone(),
    };
    let expected_entry_body = AuthorityEntryBody {
        revision: fixture.interaction_revision,
        operation_id: fixture.interaction_operation.clone(),
        kind: AuthorityEntryKind::InteractionCommit,
        material: fixture.interaction_material.clone(),
        next_control: fixture.wait_control.clone(),
        subsumes: Vec::new(),
    };
    let expected_entry = EntryEvidence {
        from: fixture.host,
        version: FRAME_PROTOCOL_VERSION,
        frame_type: FrameType::AuthorityEntry,
        context: fixture.authority_context.clone(),
        raw_body: serde_json::to_value(&expected_entry_body)?,
        body: expected_entry_body,
    };
    let expected_host_material = (
        fixture.host,
        fixture.interaction_revision,
        fixture.interaction_operation.clone(),
        fixture.interaction_material.clone(),
    );
    let expected_guest_material = (
        fixture.guest,
        fixture.interaction_revision,
        fixture.interaction_operation.clone(),
        fixture.interaction_material.clone(),
    );
    let expected_host_control = (
        fixture.host,
        fixture.interaction_revision,
        fixture.interaction_operation.clone(),
        fixture.wait_control.clone(),
    );
    let expected_guest_control = (
        fixture.guest,
        fixture.interaction_revision,
        fixture.interaction_operation.clone(),
        fixture.wait_control.clone(),
    );
    let admitted_receipt = expected_receipt(&fixture, AckStage::Admitted, None)?;
    let material_receipt = expected_receipt(&fixture, AckStage::MaterialApplied, None)?;
    let control_receipt = expected_receipt(
        &fixture,
        AckStage::ControlInstalled,
        Some(&fixture.wait_control_id),
    )?;
    let presentation_receipt = expected_receipt(&fixture, AckStage::PresentationSettled, None)?;
    let expected_replica_frontier = AuthorityFrontier {
        received: fixture.interaction_revision,
        material: fixture.interaction_revision,
        control: fixture.interaction_revision,
    };
    let await_prompt = format!("await/{}", fixture.interaction_operation);

    let initial = fixture.pair.snapshot()?;
    assert_eq!(initial.seed, seed.to_string());
    assert_eq!(
        actual_replica_frontier(&initial)?,
        AuthorityFrontier::default()
    );
    assert_eq!(initial.guest.kernel.ui, expected_ui);
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
    assert_eq!(menu.choice.options, interaction_options()?);
    assert_eq!(menu.choice.cursor, safe(0)?);
    assert_eq!(menu.choice.page, safe(0)?);
    assert!(!menu.choice.wrap);
    assert_eq!(menu.choice.cancel, CancelPolicy::Disabled);

    let host_attempt = fixture.pair.press(PairEndpoint::Host, PhysicalKey::Enter)?;
    assert!(proposal_effects(&host_attempt).is_empty());
    assert!(ui_intent_effects(&host_attempt).is_empty());
    assert_eq!(fixture.pair.snapshot()?.guest.ui, initial.guest.ui);
    trace.extend(host_attempt);

    let guest_press = fixture
        .pair
        .press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert_eq!(
        ui_intent_effects(&guest_press),
        vec![(
            fixture.guest,
            UiIntent::InteractionSubmitted {
                seat: fixture.guest,
                generation: MenuGeneration::new(safe(7)?),
                operation_id: fixture.interaction_operation.clone(),
                control_id: fixture.interaction_control_id.clone(),
                option_id: fixture.option_id.clone(),
            },
        )]
    );
    assert_eq!(
        proposal_effects(&guest_press),
        vec![expected_proposal.clone()]
    );

    let press_step = guest_press
        .last()
        .ok_or_else(|| error("raw guest press did not produce steps"))?;
    assert_eq!(press_step.snapshot.guest.kernel.ui, expected_ui);
    let proposal_queue = press_step.snapshot.network.queued_packet_ids.clone();
    let proposal_packet = only_queued(&press_step.snapshot, "proposal enqueue")?;
    trace.extend(guest_press);

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
    trace.push(duplicated_proposal);
    let delayed_proposal = fault(
        &mut fixture.pair,
        FaultOperation::Delay {
            packet_id: proposal_packet,
            additional_ms: safe(70)?,
        },
    )?;
    trace.push(delayed_proposal);
    let delayed_duplicate_proposal = fault(
        &mut fixture.pair,
        FaultOperation::Delay {
            packet_id: duplicate_proposal_packet,
            additional_ms: safe(20)?,
        },
    )?;
    trace.push(delayed_duplicate_proposal);
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
    trace.push(reordered_proposal);

    let proposal_admission = fault(
        &mut fixture.pair,
        FaultOperation::Deliver {
            packet_id: duplicate_proposal_packet,
        },
    )?;
    assert!(
        proposal_admission
            .snapshot
            .network
            .queued_packet_ids
            .contains(&proposal_packet)
    );
    assert!(
        !proposal_admission
            .snapshot
            .network
            .queued_packet_ids
            .contains(&duplicate_proposal_packet)
    );
    assert_eq!(
        authority_entry_effects(std::slice::from_ref(&proposal_admission))?,
        vec![expected_entry.clone()]
    );
    assert_eq!(
        material_effects(std::slice::from_ref(&proposal_admission)),
        vec![expected_host_material.clone()]
    );
    assert_eq!(
        control_effects(std::slice::from_ref(&proposal_admission)),
        vec![expected_host_control.clone()]
    );
    assert!(receipt_effects(std::slice::from_ref(&proposal_admission))?.is_empty());
    assert!(
        proposal_admission
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .contains(&fixture.interaction_operation)
    );
    let after_proposal_admission = proposal_admission
        .snapshot
        .network
        .queued_packet_ids
        .clone();
    let material_packet = after_proposal_admission
        .iter()
        .copied()
        .find(|packet_id| *packet_id != proposal_packet)
        .ok_or_else(|| error("authority did not enqueue the interaction material"))?;
    assert_eq!(after_proposal_admission.len(), 2);
    trace.push(proposal_admission);

    let delayed_material = fault(
        &mut fixture.pair,
        FaultOperation::Delay {
            packet_id: material_packet,
            additional_ms: safe(300)?,
        },
    )?;
    trace.push(delayed_material);
    let resend_step = fixture.pair.advance_time(safe(250)?)?;
    let resent = proposal_effects(std::slice::from_ref(&resend_step));
    assert_eq!(resent, vec![expected_proposal.clone()]);
    assert!(material_effects(std::slice::from_ref(&resend_step)).is_empty());
    assert!(control_effects(std::slice::from_ref(&resend_step)).is_empty());
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
    trace.push(resend_step);

    let retry_delivery = fixture.pair.advance_time(safe(10)?)?;
    assert!(
        retry_delivery
            .snapshot
            .network
            .queued_packet_ids
            .contains(&material_packet)
    );
    assert!(authority_entry_effects(std::slice::from_ref(&retry_delivery))?.is_empty());
    assert!(material_effects(std::slice::from_ref(&retry_delivery)).is_empty());
    assert!(control_effects(std::slice::from_ref(&retry_delivery)).is_empty());
    assert!(receipt_effects(std::slice::from_ref(&retry_delivery))?.is_empty());
    assert!(
        retry_delivery
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .contains(&fixture.interaction_operation)
    );
    let material_queue_before_duplicate = retry_delivery.snapshot.network.queued_packet_ids.clone();
    trace.push(retry_delivery);

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
    trace.push(duplicated_material);
    let delayed_original_material = fault(
        &mut fixture.pair,
        FaultOperation::Delay {
            packet_id: material_packet,
            additional_ms: safe(60)?,
        },
    )?;
    trace.push(delayed_original_material);
    let delayed_duplicate_material = fault(
        &mut fixture.pair,
        FaultOperation::Delay {
            packet_id: duplicate_material_packet,
            additional_ms: safe(10)?,
        },
    )?;
    trace.push(delayed_duplicate_material);
    let reordered_material = fault(
        &mut fixture.pair,
        FaultOperation::Reorder {
            packet_ids: vec![duplicate_material_packet, material_packet],
        },
    )?;
    trace.push(reordered_material);

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
    assert!(material_effects(std::slice::from_ref(&early_material)).is_empty());
    assert!(control_effects(std::slice::from_ref(&early_material)).is_empty());
    trace.push(early_material);

    // The delayed authority entry is the first accepted proposal delivery to the replica.
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
    assert_eq!(
        material_effects(std::slice::from_ref(&first_material)),
        vec![expected_guest_material.clone()]
    );
    assert_eq!(
        control_effects(std::slice::from_ref(&first_material)),
        vec![expected_guest_control.clone()]
    );
    assert_eq!(
        receipt_effects(std::slice::from_ref(&first_material))?,
        vec![
            admitted_receipt.clone(),
            material_receipt.clone(),
            control_receipt.clone(),
            presentation_receipt.clone(),
        ]
    );
    assert_eq!(
        presentation_effects(std::slice::from_ref(&first_material)),
        vec![(
            fixture.guest,
            PresentationEventId::new(fixture.interaction_revision.get()),
        )]
    );
    assert_eq!(first_material.snapshot.guest.ui.kind, UiViewKind::Waiting);
    assert!(!first_material.snapshot.guest.ui.actionable);
    assert_eq!(
        first_material.snapshot.guest.live_resources.controls,
        BTreeSet::new()
    );
    assert_eq!(
        first_material.snapshot.guest.live_resources.waits,
        BTreeSet::from([await_prompt.clone()])
    );
    assert!(
        first_material
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .is_empty()
    );
    let guest_material_index = first_material
        .generated_effects
        .iter()
        .position(|effect| {
            matches!(
                effect,
                KernelEffect::ApplyAuthorityMaterial { endpoint, .. }
                    if *endpoint == fixture.guest
            )
        })
        .ok_or_else(|| error("first interaction delivery did not apply guest material"))?;
    let proposal_cancellations_before_material = first_material
        .generated_effects
        .iter()
        .take(guest_material_index)
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::CancelTimer { endpoint, .. } if *endpoint == fixture.guest
            )
        })
        .count();
    assert_eq!(proposal_cancellations_before_material, 2);
    assert_eq!(
        actual_replica_frontier(&first_material.snapshot)?,
        expected_replica_frontier
    );
    let material_state_digest = first_material.snapshot.guest.state_digest.clone();
    let material_live_resources = first_material.snapshot.guest.live_resources.clone();
    trace.push(first_material);

    let second_material = fixture.pair.advance_time(safe(50)?)?;
    assert!(
        !second_material
            .snapshot
            .network
            .queued_packet_ids
            .contains(&material_packet)
    );
    assert!(material_effects(std::slice::from_ref(&second_material)).is_empty());
    assert!(control_effects(std::slice::from_ref(&second_material)).is_empty());
    assert_eq!(
        receipt_effects(std::slice::from_ref(&second_material))?,
        vec![control_receipt.clone(), presentation_receipt.clone()]
    );
    assert_eq!(
        second_material.snapshot.guest.state_digest,
        material_state_digest
    );
    assert_eq!(
        second_material.snapshot.guest.live_resources,
        material_live_resources
    );
    assert!(presentation_effects(std::slice::from_ref(&second_material)).is_empty());
    assert_eq!(second_material.snapshot.guest.ui.kind, UiViewKind::Waiting);
    assert_eq!(
        actual_replica_frontier(&second_material.snapshot)?,
        expected_replica_frontier
    );
    trace.push(second_material);

    let receipt_delivery = fixture.pair.advance_time(safe(10)?)?;
    trace.push(receipt_delivery);
    let settled = fixture.pair.snapshot()?;
    assert_eq!(
        actual_replica_frontier(&settled)?,
        expected_replica_frontier
    );
    assert!(settled.guest.live_resources.proposal_leases.is_empty());
    assert!(settled.host.live_resources.retained_revisions.is_empty());
    assert_eq!(settled.guest.live_resources.controls, BTreeSet::new());
    assert_eq!(
        settled.guest.live_resources.waits,
        BTreeSet::from([await_prompt])
    );

    assert_eq!(
        proposal_effects(&trace),
        vec![expected_proposal.clone(), expected_proposal]
    );
    assert_eq!(authority_entry_effects(&trace)?, vec![expected_entry]);
    assert_eq!(
        material_effects(&trace),
        vec![expected_host_material, expected_guest_material]
    );
    assert_eq!(
        control_effects(&trace),
        vec![expected_host_control, expected_guest_control]
    );
    assert_eq!(
        presentation_effects(&trace),
        vec![(
            fixture.guest,
            PresentationEventId::new(fixture.interaction_revision.get()),
        )]
    );
    let receipts = receipt_effects(&trace)?;
    assert_eq!(
        receipts,
        vec![
            admitted_receipt,
            material_receipt,
            control_receipt.clone(),
            presentation_receipt.clone(),
            control_receipt,
            presentation_receipt,
        ]
    );
    assert_eq!(
        receipt_frontier_chain(&receipts)?,
        vec![
            AuthorityFrontier::default(),
            AuthorityFrontier {
                received: fixture.interaction_revision,
                material: Revision::ZERO,
                control: Revision::ZERO,
            },
            AuthorityFrontier {
                received: fixture.interaction_revision,
                material: fixture.interaction_revision,
                control: Revision::ZERO,
            },
            AuthorityFrontier {
                received: fixture.interaction_revision,
                material: fixture.interaction_revision,
                control: fixture.interaction_revision,
            },
            AuthorityFrontier {
                received: fixture.interaction_revision,
                material: fixture.interaction_revision,
                control: fixture.interaction_revision,
            },
            AuthorityFrontier {
                received: fixture.interaction_revision,
                material: fixture.interaction_revision,
                control: fixture.interaction_revision,
            },
            AuthorityFrontier {
                received: fixture.interaction_revision,
                material: fixture.interaction_revision,
                control: fixture.interaction_revision,
            },
        ]
    );

    let torn_down = fixture.pair.teardown(TEARDOWN_REASON)?;
    assert_zero_live_resources(&torn_down.host.live_resources);
    assert_zero_live_resources(&torn_down.guest.live_resources);
    assert!(torn_down.network.queued_packet_ids.is_empty());
    assert!(torn_down.network.disconnected_endpoints.is_empty());
    assert!(torn_down.network.suspended_endpoints.is_empty());
    assert!(torn_down.clock_timers.is_empty());
    for endpoint in [&torn_down.host, &torn_down.guest] {
        assert!(endpoint.presenter.pending_event_ids.is_empty());
        assert!(endpoint.presenter.settled_event_ids.is_empty());
        assert!(endpoint.presenter.disposed);
    }
    assert!(torn_down.presenter.pending_event_ids.is_empty());
    assert!(torn_down.presenter.settled_event_ids.is_empty());
    assert!(torn_down.storage.pending_request_ids.is_empty());
    assert!(torn_down.storage.keys.is_empty());
    assert!(torn_down.network.disposed);
    assert!(torn_down.presenter.disposed);
    assert!(torn_down.storage.disposed);
    assert_eq!(torn_down.terminal_reason.as_deref(), Some(TEARDOWN_REASON));
    assert!(matches!(
        fixture.pair.snapshot(),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(
        fixture
            .pair
            .apply(PairOperation::AdvanceTime { delta_ms: safe(1)? }),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(
        fixture.pair.press(PairEndpoint::Guest, PhysicalKey::Enter),
        Err(SimulatedPairError::Disposed)
    ));
    Ok(CampaignRun {
        trace,
        final_snapshot: torn_down,
    })
}

fn receipt_stages(step: &PairStep) -> TestResult<Vec<AckStage>> {
    Ok(receipt_effects(std::slice::from_ref(step))?
        .into_iter()
        .map(|receipt| receipt.body.stage)
        .collect())
}

fn reach_fault_controlled_presentation(
    fixture: &mut CampaignFixture,
    hold_duplicate_before_first_delivery: bool,
) -> TestResult<(Vec<PairStep>, SafeU53, Option<SafeU53>)> {
    let mut trace = fixture
        .pair
        .press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    let proposal_snapshot = fixture.pair.snapshot()?;
    let proposal_packet = only_queued(&proposal_snapshot, "fault-controlled proposal")?;
    let proposal_queue = proposal_snapshot.network.queued_packet_ids;

    let authority_admission = fault(
        &mut fixture.pair,
        FaultOperation::Deliver {
            packet_id: proposal_packet,
        },
    )?;
    let authority_entry_packet = only_packet_for_sends(
        &proposal_queue,
        &authority_admission,
        is_authority_entry,
        "fault-controlled authority entry",
    )?;
    trace.push(authority_admission);

    let entry_queue = fixture.pair.snapshot()?.network.queued_packet_ids;
    let held_duplicate_packet = if hold_duplicate_before_first_delivery {
        let duplicated_entry = fault(
            &mut fixture.pair,
            FaultOperation::Duplicate {
                packet_id: authority_entry_packet,
            },
        )?;
        let duplicate_packet = new_packet_id(
            &entry_queue,
            &duplicated_entry.snapshot.network.queued_packet_ids,
            "pre-delivery authority entry duplicate",
        )?;
        trace.push(duplicated_entry);
        Some(duplicate_packet)
    } else {
        None
    };
    let delivery_queue = fixture.pair.snapshot()?.network.queued_packet_ids;
    let replica_admission = fault(
        &mut fixture.pair,
        FaultOperation::Deliver {
            packet_id: authority_entry_packet,
        },
    )?;
    let control_receipt_packet = only_packet_for_sends(
        &delivery_queue,
        &replica_admission,
        |effect| is_receipt_stage(effect, AckStage::ControlInstalled),
        "fault-controlled control receipt",
    )?;
    assert_eq!(
        receipt_stages(&replica_admission)?,
        vec![
            AckStage::Admitted,
            AckStage::MaterialApplied,
            AckStage::ControlInstalled,
        ]
    );
    assert_eq!(
        presentation_effects(std::slice::from_ref(&replica_admission)),
        vec![(
            fixture.guest,
            PresentationEventId::new(fixture.interaction_revision.get()),
        )]
    );
    assert_eq!(
        replica_admission
            .snapshot
            .guest
            .live_resources
            .presentations,
        BTreeSet::from([PresentationEventId::new(fixture.interaction_revision.get(),)])
    );
    assert_eq!(
        replica_admission.snapshot.guest.presenter.pending_event_ids,
        replica_admission
            .snapshot
            .guest
            .live_resources
            .presentations
    );
    trace.push(replica_admission);
    Ok((trace, control_receipt_packet, held_duplicate_packet))
}

fn assert_one_guest_application_chain(trace: &[PairStep], fixture: &CampaignFixture) {
    assert_eq!(
        material_effects(trace)
            .into_iter()
            .filter(|(endpoint, revision, operation_id, _)| {
                endpoint == &fixture.guest
                    && revision == &fixture.interaction_revision
                    && operation_id == &fixture.interaction_operation
            })
            .count(),
        1
    );
    assert_eq!(
        control_effects(trace)
            .into_iter()
            .filter(|(endpoint, revision, operation_id, _)| {
                endpoint == &fixture.guest
                    && revision == &fixture.interaction_revision
                    && operation_id == &fixture.interaction_operation
            })
            .count(),
        1
    );
    assert_eq!(
        presentation_effects(trace),
        vec![(
            fixture.guest,
            PresentationEventId::new(fixture.interaction_revision.get()),
        )]
    );
}

#[test]
fn duplicate_complete_replaces_dropped_settlement_after_rebind() -> TestResult {
    let mut fixture = build_fixture(CAMPAIGN_SEED + 1, PresenterMode::FaultControlled)?;
    let event_id = PresentationEventId::new(fixture.interaction_revision.get());
    let (mut trace, control_receipt_packet, held_duplicate_packet) =
        reach_fault_controlled_presentation(&mut fixture, false)?;
    assert!(held_duplicate_packet.is_none());
    let pending_snapshot = fixture.pair.snapshot()?;
    let pending_digest = pending_snapshot.guest.state_digest.clone();

    let control_queue = pending_snapshot.network.queued_packet_ids;
    assert!(control_queue.contains(&control_receipt_packet));
    assert!(
        pending_snapshot
            .host
            .live_resources
            .retained_revisions
            .contains(&fixture.interaction_revision)
    );
    let settlement_queue = control_queue.clone();
    let original_settlement = fixture.pair.apply(PairOperation::PresentationSettled {
        endpoint: PairEndpoint::Guest,
        event_id,
        outcome: PresentationOutcome::Settled,
    })?;
    let original_settlement_packet = only_packet_for_sends(
        &settlement_queue,
        &original_settlement,
        |effect| is_receipt_stage(effect, AckStage::PresentationSettled),
        "original settlement receipt",
    )?;
    assert_eq!(
        receipt_stages(&original_settlement)?,
        vec![AckStage::PresentationSettled]
    );
    assert!(
        original_settlement
            .snapshot
            .guest
            .live_resources
            .presentations
            .is_empty()
    );
    assert_eq!(
        original_settlement
            .snapshot
            .guest
            .presenter
            .settled_event_ids,
        BTreeSet::from([event_id])
    );
    let settled_digest = original_settlement.snapshot.guest.state_digest.clone();
    assert_ne!(settled_digest, pending_digest);
    trace.push(original_settlement);

    let dropped_original = fault(
        &mut fixture.pair,
        FaultOperation::Drop {
            packet_id: original_settlement_packet,
        },
    )?;
    assert!(
        !dropped_original
            .snapshot
            .network
            .queued_packet_ids
            .contains(&original_settlement_packet)
    );
    trace.push(dropped_original);

    let before_rebind = fixture.pair.snapshot()?;
    let rebound = fixture.pair.apply(PairOperation::Reconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    let rebound_entry_packet = only_packet_for_sends(
        &before_rebind.network.queued_packet_ids,
        &rebound,
        is_authority_entry,
        "rebound duplicate-complete entry",
    )?;
    assert!(presentation_effects(std::slice::from_ref(&rebound)).is_empty());
    assert!(material_effects(std::slice::from_ref(&rebound)).is_empty());
    assert!(control_effects(std::slice::from_ref(&rebound)).is_empty());
    let rebound_digest = rebound.snapshot.guest.state_digest.clone();
    assert_eq!(
        rebound.snapshot.guest.presenter.settled_event_ids,
        BTreeSet::from([event_id])
    );
    trace.push(rebound);

    let stale_control = fault(
        &mut fixture.pair,
        FaultOperation::Drop {
            packet_id: control_receipt_packet,
        },
    )?;
    assert!(
        !stale_control
            .snapshot
            .network
            .queued_packet_ids
            .contains(&control_receipt_packet)
    );
    trace.push(stale_control);

    let replacement_queue = fixture.pair.snapshot()?.network.queued_packet_ids;
    let replacement = fault(
        &mut fixture.pair,
        FaultOperation::Deliver {
            packet_id: rebound_entry_packet,
        },
    )?;
    assert_eq!(
        receipt_stages(&replacement)?,
        vec![AckStage::ControlInstalled, AckStage::PresentationSettled,]
    );
    assert!(presentation_effects(std::slice::from_ref(&replacement)).is_empty());
    assert!(material_effects(std::slice::from_ref(&replacement)).is_empty());
    assert!(control_effects(std::slice::from_ref(&replacement)).is_empty());
    assert_eq!(replacement.snapshot.guest.state_digest, rebound_digest);
    assert!(
        replacement
            .snapshot
            .guest
            .live_resources
            .presentations
            .is_empty()
    );
    let replay_receipt_packets =
        packet_ids_for_sends(&replacement_queue, &replacement, |effect| {
            is_receipt_stage(effect, AckStage::ControlInstalled)
                || is_receipt_stage(effect, AckStage::PresentationSettled)
        })?;
    assert_eq!(replay_receipt_packets.len(), 2);
    let Some(&replay_control_packet) = replay_receipt_packets.first() else {
        return Err("missing rebound control receipt packet".into());
    };
    let Some(&replay_settlement_packet) = replay_receipt_packets.get(1) else {
        return Err("missing rebound settlement receipt packet".into());
    };
    assert_eq!(
        receipt_effects(std::slice::from_ref(&replacement))?
            .into_iter()
            .map(|receipt| receipt.context.connection_generation)
            .collect::<Vec<_>>(),
        vec![generation(1)?, generation(1)?]
    );
    trace.push(replacement);

    let replay_control = fault(
        &mut fixture.pair,
        FaultOperation::Deliver {
            packet_id: replay_control_packet,
        },
    )?;
    assert!(
        replay_control
            .snapshot
            .host
            .live_resources
            .delivery_leases
            .is_empty()
    );
    assert!(
        replay_control
            .snapshot
            .host
            .live_resources
            .retained_revisions
            .is_empty()
    );
    assert_eq!(receipt_stages(&replay_control)?, Vec::<AckStage>::new());
    assert!(replay_control.snapshot.terminal_reason.is_none());
    trace.push(replay_control);

    let replay_settlement = fault(
        &mut fixture.pair,
        FaultOperation::Deliver {
            packet_id: replay_settlement_packet,
        },
    )?;
    assert!(receipt_stages(&replay_settlement)?.is_empty());
    assert_eq!(
        replay_settlement.snapshot.guest.state_digest,
        rebound_digest
    );
    assert!(replay_settlement.snapshot.terminal_reason.is_none());
    trace.push(replay_settlement);
    assert_one_guest_application_chain(&trace, &fixture);

    let torn_down = fixture.pair.teardown("m2b-06 focused liveness complete")?;
    assert_zero_live_resources(&torn_down.host.live_resources);
    assert_zero_live_resources(&torn_down.guest.live_resources);
    Ok(())
}

fn assert_nonsettled_presentation_is_not_upgraded(
    seed: u64,
    outcome: PresentationOutcome,
) -> TestResult {
    let mut fixture = build_fixture(seed, PresenterMode::FaultControlled)?;
    let event_id = PresentationEventId::new(fixture.interaction_revision.get());
    let (mut trace, _control_receipt_packet, held_duplicate_packet) =
        reach_fault_controlled_presentation(&mut fixture, true)?;
    let Some(duplicate_entry_packet) = held_duplicate_packet else {
        return Err("fault scenario did not retain its pre-delivery duplicate".into());
    };
    let before_outcome = fixture.pair.snapshot()?;

    let completion = fixture.pair.apply(PairOperation::PresentationSettled {
        endpoint: PairEndpoint::Guest,
        event_id,
        outcome,
    })?;
    assert!(receipt_stages(&completion)?.is_empty());
    assert!(presentation_effects(std::slice::from_ref(&completion)).is_empty());
    assert_ne!(
        completion.snapshot.guest.state_digest,
        before_outcome.guest.state_digest
    );
    assert!(
        completion
            .snapshot
            .guest
            .live_resources
            .presentations
            .is_empty()
    );
    let post_failure_digest = completion.snapshot.guest.state_digest.clone();
    assert_ne!(post_failure_digest, before_outcome.guest.state_digest);
    trace.push(completion);

    let duplicate = fault(
        &mut fixture.pair,
        FaultOperation::Deliver {
            packet_id: duplicate_entry_packet,
        },
    )?;
    assert_eq!(
        receipt_stages(&duplicate)?,
        vec![AckStage::ControlInstalled]
    );
    assert!(presentation_effects(std::slice::from_ref(&duplicate)).is_empty());
    assert!(material_effects(std::slice::from_ref(&duplicate)).is_empty());
    assert!(control_effects(std::slice::from_ref(&duplicate)).is_empty());
    assert_eq!(duplicate.snapshot.guest.state_digest, post_failure_digest);
    assert!(
        duplicate
            .snapshot
            .guest
            .live_resources
            .presentations
            .is_empty()
    );
    assert!(!receipt_stages(&duplicate)?.contains(&AckStage::PresentationSettled));
    assert!(duplicate.snapshot.terminal_reason.is_none());
    assert!(
        !duplicate
            .snapshot
            .host
            .live_resources
            .retained_revisions
            .is_empty()
    );
    trace.push(duplicate);
    assert_one_guest_application_chain(&trace, &fixture);

    let torn_down = fixture
        .pair
        .teardown("m2b-06 non-settled presentation complete")?;
    assert_zero_live_resources(&torn_down.host.live_resources);
    assert_zero_live_resources(&torn_down.guest.live_resources);
    Ok(())
}

#[test]
fn cancelled_and_failed_presentations_are_never_upgraded_to_settled() -> TestResult {
    assert_nonsettled_presentation_is_not_upgraded(
        CAMPAIGN_SEED + 2,
        PresentationOutcome::Cancelled,
    )?;
    assert_nonsettled_presentation_is_not_upgraded(
        CAMPAIGN_SEED + 3,
        PresentationOutcome::Failed {
            reason: "focused presenter failure".to_owned(),
        },
    )?;
    Ok(())
}

#[test]
fn raw_shared_interaction_campaign_deduplicates_retries_and_material() -> TestResult {
    let first = run_campaign(CAMPAIGN_SEED)?;
    let second = run_campaign(CAMPAIGN_SEED)?;
    let first_normalized = normalized_trace(&first.trace);
    let second_normalized = normalized_trace(&second.trace);

    assert_eq!(first_normalized, second_normalized);
    assert_eq!(first.trace, second.trace);
    assert_eq!(first.final_snapshot, second.final_snapshot);
    assert!(
        first
            .trace
            .iter()
            .all(|step| !step.effects_digest.is_empty())
    );
    Ok(())
}
