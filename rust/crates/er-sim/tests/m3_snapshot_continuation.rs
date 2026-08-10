//! Restorable V2 continuation-boundary coverage.
//!
//! The focused checks below are necessary rejection/shape evidence only.
//! M3C-11 acceptance additionally requires a live-production round-trip test
//! once the integration owner exposes the private owner bridges; these DTO
//! checks are not a substitute for that test.

use std::error::Error;

use er_kernel::snapshot::{
    HeldLogicalButtonSnapshotV2, InputRepeatSnapshotV2, InputRouterSnapshotV2,
    KernelSchedulerSnapshotV2, PendingPresentationsSnapshotV1, PhysicalInputSourceV2,
    PresentationPlanSnapshotV1,
    PresentationOutcomeSnapshotV1, PressedPhysicalInputSnapshotV2, RestorableTimerSnapshotV2,
    TimeClassPauseSnapshotV2,
};
use er_protocol::snapshot::{
    PendingRecoverySnapshotV2, StagedPeerRebindSnapshotV2,
};
use er_sim::snapshot::{
    FaultNetworkSnapshotV2, NetworkLinkSnapshotV2, PacketDispositionV2, PacketReorderStateV2,
    QueuedPacketSnapshotV2,
};
use er_sim::PairEndpoint;
use er_types::battle_ids::{BattlePresentationEventId, MenuInstanceId};
use er_types::battle_ui::{
    BattlePresentationEvent, BattlePresentationKind, PresentationBlockingPolicy,
    PresentationSettlementOutcome, PresentationSkipPolicy,
};
use er_types::{
    ConnectionGeneration, GameButton, InputFocus, OperationId, PhysicalKey, SafeU53, SeatId,
    TimeClass, TimerId, TimerOwner,
};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).unwrap_or(SafeU53::ZERO)
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn operation(value: &str) -> TestResult<OperationId> {
    Ok(OperationId::new(value)?)
}

fn battle_event() -> TestResult<BattlePresentationEvent> {
    Ok(BattlePresentationEvent::new(
        BattlePresentationEventId::new(operation("m3c-11/presentation")?, safe(0)),
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Forbidden,
        BattlePresentationKind::BattleWon,
    ))
}

#[test]
fn held_key_snapshot_retains_physical_source_menu_and_repeat_timer() -> TestResult {
    let endpoint = seat(1);
    let source = PhysicalInputSourceV2::Keyboard(PhysicalKey::Space);
    let timer_id = TimerId::new(safe(17));
    let snapshot = InputRouterSnapshotV2 {
        focus: InputFocus::Game,
        pressed: vec![PressedPhysicalInputSnapshotV2 {
            seat: endpoint,
            source: source.clone(),
            logical_button: Some(GameButton::Action),
            printable: false,
            accepted: true,
            menu_instance_id: Some(MenuInstanceId::new(safe(9))),
        }],
        suppressed_printable_keys: Vec::new(),
        held_buttons: vec![HeldLogicalButtonSnapshotV2 {
            seat: endpoint,
            button: GameButton::Action,
            source: source.clone(),
            menu_instance_id: MenuInstanceId::new(safe(9)),
        }],
        locks: Vec::new(),
        repeats: vec![InputRepeatSnapshotV2 {
            seat: endpoint,
            button: GameButton::Action,
            source,
            menu_instance_id: MenuInstanceId::new(safe(9)),
            timer_id,
        }],
        disposed: false,
    };
    snapshot.validate()?;
    let encoded = serde_json::to_string(&snapshot)?;
    let decoded: InputRouterSnapshotV2 = serde_json::from_str(&encoded)?;
    assert_eq!(decoded, snapshot);
    Ok(())
}

#[test]
fn one_doubles_command_snapshot_retains_both_control_histories_and_allocators() -> TestResult {
    use er_game::snapshot::SeatControlHistorySnapshotV1;
    use er_types::battle_control::{BattleControl, WaitingControl, WaitingReason};

    let waiting = BattleControl::Waiting(WaitingControl::new(
        WaitingReason::PartnerCommand,
        vec![operation("m3c-11/doubles/turn")?],
    )?);
    let histories = vec![
        SeatControlHistorySnapshotV1 {
            seat: seat(1),
            controls: vec![waiting.clone()],
        },
        SeatControlHistorySnapshotV1 {
            seat: seat(2),
            controls: vec![waiting.clone()],
        },
    ];
    for history in &histories {
        history.validate()?;
    }
    let encoded = serde_json::to_string(&histories)?;
    let decoded: Vec<SeatControlHistorySnapshotV1> = serde_json::from_str(&encoded)?;
    assert_eq!(decoded, histories);
    Ok(())
}

#[test]
fn delayed_turn_snapshot_retains_typed_packet_deadline_and_order() -> TestResult {
    let snapshot = FaultNetworkSnapshotV2 {
        next_packet_id: safe(2),
        next_queue_order_id: safe(2),
        packets: vec![QueuedPacketSnapshotV2 {
            packet_id: safe(1),
            queue_order_id: safe(1),
            kind: er_sim::snapshot::RestorablePacketKindV2::AuthorityFrame,
            source: PairEndpoint::Host,
            destination: PairEndpoint::Guest,
            source_generation: generation(0),
            destination_generation: generation(0),
            body: er_types::battle_ids::CanonicalHexBytes::from_bytes(b"turn"),
            enqueued_at_ms: safe(10),
            delivery_deadline_ms: safe(110),
            reorder_state: PacketReorderStateV2::Stable,
            disposition: PacketDispositionV2::Delayed,
        }],
        links: vec![
            NetworkLinkSnapshotV2 {
                endpoint: PairEndpoint::Host,
                generation: generation(0),
                connected: true,
                suspended: false,
            },
            NetworkLinkSnapshotV2 {
                endpoint: PairEndpoint::Guest,
                generation: generation(0),
                connected: true,
                suspended: false,
            },
        ],
        disposed: false,
    };
    snapshot.validate()?;
    Ok(())
}

#[test]
fn pending_presentation_snapshot_keeps_blocking_barrier_until_outcome() -> TestResult {
    let event = battle_event()?;
    let operation_id = event.event_id.operation_id.clone();
    let pending = PendingPresentationsSnapshotV1 {
        local_endpoint: seat(1),
        plans: vec![PresentationPlanSnapshotV1 {
            operation_id: operation_id.clone(),
            events: vec![event.clone()],
        }],
        last_plan_operation_id: Some(operation_id.clone()),
        pending_barrier_ids: vec![event.event_id.clone()],
        blocking_barrier_ids: vec![event.event_id.clone()],
        outcomes: Vec::new(),
        event_catalog: vec![event.clone()],
        presentation_failed: false,
        disposed: false,
    };
    pending.validate()?;
    let settled = PendingPresentationsSnapshotV1 {
        local_endpoint: seat(1),
        plans: vec![PresentationPlanSnapshotV1 {
            operation_id,
            events: vec![event.clone()],
        }],
        last_plan_operation_id: Some(event.event_id.operation_id.clone()),
        pending_barrier_ids: Vec::new(),
        blocking_barrier_ids: Vec::new(),
        outcomes: vec![PresentationOutcomeSnapshotV1 {
            event_id: event.event_id.clone(),
            outcome: PresentationSettlementOutcome::Settled,
        }],
        event_catalog: vec![event],
        presentation_failed: false,
        disposed: false,
    };
    settled.validate()?;
    Ok(())
}

#[test]
fn reconnect_recovery_snapshot_retains_generation_and_pending_correlation() -> TestResult {
    let rebind = StagedPeerRebindSnapshotV2 {
        peer_seat: seat(2),
        generation: generation(3),
    };
    let recovery = PendingRecoverySnapshotV2 {
        correlation_id: "m3c-11/recovery/3".to_owned(),
        bundle: None,
    };
    let encoded = serde_json::to_string(&(rebind, recovery))?;
    assert!(encoded.contains("correlation_id"));
    assert!(encoded.contains("generation"));
    Ok(())
}

#[test]
fn scheduler_snapshot_retains_remaining_active_time_and_pause_reason() -> TestResult {
    let scheduler = KernelSchedulerSnapshotV2 {
        next_timer_id: Some(safe(18)),
        timers: vec![RestorableTimerSnapshotV2 {
            registration: er_protocol::ScheduledTimer {
                endpoint: seat(1),
                timer_id: TimerId::new(safe(17)),
                owner: TimerOwner::new("m3c-11", "held/action", "held repeat")?,
                delay_ms: safe(250),
                time_class: TimeClass::HumanInput,
            },
            original_delay_ms: safe(250),
            remaining_active_ms: safe(90),
        }],
        pauses: vec![TimeClassPauseSnapshotV2 {
            endpoint: seat(1),
            time_class: TimeClass::Connected,
            reasons: vec!["recovery".to_owned()],
        }],
        disposed: false,
    };
    scheduler.validate()?;
    Ok(())
}
