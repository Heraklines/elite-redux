use std::error::Error;

use er_sim::{
    FaultNetwork, FaultNetworkDiagnostics, FaultNetworkError, FaultOperation, FrameCorruption,
    NetworkEvent,
};
use er_types::{
    ConnectionGeneration, NetworkPayload, OperationId, ProposalMessage, RawFrame, SafeU53, SeatId,
};
use serde_json::{Value, json};

type TestResult = Result<(), Box<dyn Error>>;

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

fn endpoints() -> [SeatId; 2] {
    [seat(1), seat(2)]
}

fn frame(value: Value) -> NetworkPayload {
    NetworkPayload::Frame(RawFrame::JsonValue(value))
}

fn text_frame(value: &str) -> NetworkPayload {
    NetworkPayload::Frame(RawFrame::JsonText(value.to_owned()))
}

fn proposal(
    from: SeatId,
    to: SeatId,
    connection_generation: ConnectionGeneration,
    payload: Value,
) -> Result<NetworkPayload, Box<dyn Error>> {
    Ok(NetworkPayload::Proposal(ProposalMessage {
        operation_id: OperationId::new("proposal-1")?,
        fingerprint: "fingerprint-1".to_owned(),
        from,
        to,
        connection_generation,
        payload,
    }))
}

fn missing(message: &str) -> Box<dyn Error> {
    std::io::Error::other(message).into()
}

fn packet(
    network: &FaultNetwork,
    packet_id: SafeU53,
) -> Result<er_sim::NetworkPacket, Box<dyn Error>> {
    network
        .packet(packet_id)
        .cloned()
        .ok_or_else(|| missing("packet was not retained"))
}

fn delivered_id(events: &[NetworkEvent]) -> Result<SafeU53, Box<dyn Error>> {
    match events {
        [NetworkEvent::Delivered { packet }] => Ok(packet.packet_id),
        _ => Err(missing("expected one delivered packet")),
    }
}

fn dropped_id(events: &[NetworkEvent]) -> Result<SafeU53, Box<dyn Error>> {
    match events {
        [NetworkEvent::Dropped { packet_id }] => Ok(*packet_id),
        _ => Err(missing("expected one dropped packet")),
    }
}

type SeededTrace = (
    Vec<er_sim::NetworkPacket>,
    Vec<NetworkEvent>,
    FaultNetworkDiagnostics,
);

fn seeded_trace(seed: u64) -> Result<SeededTrace, Box<dyn Error>> {
    let mut network = FaultNetwork::new(seed, endpoints());
    let first = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        text_frame(r#"{"v":2,"t":"authorityEntry","body":{"n":1}}"#),
        safe(10),
    )?;
    let second = network.enqueue(
        seat(2),
        seat(1),
        generation(0),
        proposal(seat(2), seat(1), generation(0), json!({"choice":"a"}))?,
        safe(10),
    )?;
    network.apply(FaultOperation::Duplicate { packet_id: second }, safe(10))?;
    let duplicate = safe(2);
    network.apply(
        FaultOperation::Delay {
            packet_id: first,
            additional_ms: safe(3),
        },
        safe(10),
    )?;
    network.apply(
        FaultOperation::Reorder {
            packet_ids: vec![duplicate, first],
        },
        safe(10),
    )?;
    let queued = network.queued_packets();
    let events = network.deliver_due(SafeU53::MAX)?;
    Ok((queued, events, network.diagnostics()))
}

fn seeded_delivery_trace(seed: u64) -> Result<Vec<SafeU53>, Box<dyn Error>> {
    let mut network = FaultNetwork::new(seed, endpoints());
    for index in 0_u64..16 {
        network.enqueue(
            seat(1),
            seat(2),
            generation(0),
            frame(json!({"index": index})),
            safe(100),
        )?;
    }
    Ok(network
        .queued_packets()
        .into_iter()
        .map(|packet| packet.deliver_at_ms)
        .collect())
}

#[test]
fn seed_replays_queue_timing_and_event_order_exactly() -> TestResult {
    let first = seeded_trace(0xdecafbad)?;
    let second = seeded_trace(0xdecafbad)?;
    assert_eq!(first, second);
    assert_eq!(first.2.seed, 0xdecafbad);
    assert!(first.1.iter().all(|event| {
        matches!(
            event,
            NetworkEvent::Delivered { .. } | NetworkEvent::Dropped { .. }
        )
    }));
    Ok(())
}

#[test]
fn both_seed_halves_change_multi_packet_traces() -> TestResult {
    let baseline = seeded_delivery_trace(0x0123_4567_dead_beef)?;
    let high_changed = seeded_delivery_trace(0x89ab_cdef_dead_beef)?;
    let low_changed = seeded_delivery_trace(0x0123_4567_feed_face)?;
    assert_eq!(baseline.len(), 16);
    assert_eq!(high_changed.len(), 16);
    assert_eq!(low_changed.len(), 16);
    assert_ne!(baseline, high_changed);
    assert_ne!(baseline, low_changed);
    Ok(())
}

#[test]
fn drop_is_loss_and_is_counted_once() -> TestResult {
    let mut network = FaultNetwork::new(7, endpoints());
    let packet_id = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({"kind":"frame"})),
        safe(0),
    )?;
    let events = network.apply(FaultOperation::Drop { packet_id }, safe(0))?;
    assert_eq!(dropped_id(&events)?, packet_id);
    assert!(network.packet(packet_id).is_none());
    assert_eq!(network.diagnostics().dropped_count, safe(1));
    assert!(matches!(
        network.apply(FaultOperation::Drop { packet_id }, safe(0)),
        Err(FaultNetworkError::UnknownPacket { packet_id: id }) if id == packet_id
    ));
    Ok(())
}

#[test]
fn duplicate_adds_one_new_packet_with_the_same_payload() -> TestResult {
    let mut network = FaultNetwork::new(9, endpoints());
    let packet_id = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({"kind":"frame","body":{"value":1}})),
        safe(0),
    )?;
    let original = packet(&network, packet_id)?;
    network.apply(FaultOperation::Duplicate { packet_id }, safe(0))?;
    assert_eq!(network.diagnostics().duplicated_count, safe(1));
    let queued = network.queued_packets();
    assert_eq!(queued.len(), 2);
    assert_eq!(queued[0], original);
    assert_eq!(queued[1].payload, original.payload);
    assert_ne!(queued[1].packet_id, original.packet_id);
    let events = network.deliver_due(SafeU53::MAX)?;
    assert_eq!(events.len(), 2);
    let delivered_ids: Vec<SafeU53> = events
        .iter()
        .filter_map(|event| match event {
            NetworkEvent::Delivered { packet } => Some(packet.packet_id),
            NetworkEvent::Dropped { .. } => None,
        })
        .collect();
    assert!(delivered_ids.contains(&packet_id));
    assert_eq!(delivered_ids.len(), 2);
    Ok(())
}

#[test]
fn delay_changes_only_the_delivery_deadline() -> TestResult {
    let mut network = FaultNetwork::new(11, endpoints());
    let packet_id = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({"body":{"value":1}})),
        safe(10),
    )?;
    let before = packet(&network, packet_id)?;
    network.apply(
        FaultOperation::Delay {
            packet_id,
            additional_ms: safe(7),
        },
        safe(10),
    )?;
    let after = packet(&network, packet_id)?;
    assert_eq!(after.packet_id, before.packet_id);
    assert_eq!(after.payload, before.payload);
    assert_eq!(after.deliver_at_ms, safe(before.deliver_at_ms.get() + 7));
    assert!(
        network
            .deliver_due(safe(after.deliver_at_ms.get() - 1))?
            .is_empty()
    );
    let events = network.deliver_due(after.deliver_at_ms)?;
    assert_eq!(delivered_id(&events)?, packet_id);
    Ok(())
}

#[test]
fn reorder_moves_the_requested_packets_to_the_front_in_requested_order() -> TestResult {
    let mut network = FaultNetwork::new(13, endpoints());
    let first = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({"id":1})),
        safe(0),
    )?;
    let second = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({"id":2})),
        safe(0),
    )?;
    let third = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({"id":3})),
        safe(0),
    )?;
    network.apply(
        FaultOperation::Reorder {
            packet_ids: vec![third, first],
        },
        safe(0),
    )?;
    let queued_ids: Vec<SafeU53> = network
        .queued_packets()
        .into_iter()
        .map(|packet| packet.packet_id)
        .collect();
    assert_eq!(queued_ids, vec![third, first, second]);
    let next = network.apply(FaultOperation::DeliverNext, safe(0))?;
    assert_eq!(delivered_id(&next)?, third);
    let remaining = network.deliver_due(SafeU53::MAX)?;
    assert_eq!(remaining.len(), 2);
    assert_eq!(delivered_id(&remaining[0..1])?, first);
    assert_eq!(delivered_id(&remaining[1..2])?, second);
    Ok(())
}

#[test]
fn reconnect_advances_generation_and_drops_old_queued_packets() -> TestResult {
    let mut network = FaultNetwork::new(17, endpoints());
    let old_packet = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({"generation":0})),
        safe(0),
    )?;
    assert!(network.disconnect(seat(1)));
    assert!(!network.disconnect(seat(1)));
    let next_generation = network.reconnect(seat(1))?;
    assert_eq!(next_generation, generation(1));
    assert_eq!(network.connection_generation(seat(1)), generation(1));
    let stale = network.apply(
        FaultOperation::Deliver {
            packet_id: old_packet,
        },
        safe(0),
    )?;
    assert_eq!(dropped_id(&stale)?, old_packet);
    assert_eq!(network.diagnostics().dropped_count, safe(1));

    let new_packet = network.enqueue(
        seat(1),
        seat(2),
        next_generation,
        frame(json!({"generation":1})),
        safe(0),
    )?;
    let delivered = network.apply(
        FaultOperation::Deliver {
            packet_id: new_packet,
        },
        safe(0),
    )?;
    assert_eq!(delivered_id(&delivered)?, new_packet);
    Ok(())
}

#[test]
fn suspension_is_idempotent_and_does_not_mutate_or_drop_transport() -> TestResult {
    let mut network = FaultNetwork::new(19, endpoints());
    assert!(network.suspend(seat(2)));
    assert!(!network.suspend(seat(2)));
    assert!(network.diagnostics().suspended_endpoints.contains(&seat(2)));
    let packet_id = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({"during":"suspension"})),
        safe(0),
    )?;
    let delivered = network.deliver_due(SafeU53::MAX)?;
    assert_eq!(delivered_id(&delivered)?, packet_id);
    assert!(network.resume(seat(2)));
    assert!(!network.resume(seat(2)));
    assert!(network.diagnostics().suspended_endpoints.is_empty());
    Ok(())
}

#[test]
fn frame_corruption_preserves_raw_variant_and_exact_json_mutations() -> TestResult {
    let mut network = FaultNetwork::new(23, endpoints());
    let delete_id = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({
            "v": 2,
            "body": {"keep": true, "remove": 1}
        })),
        safe(0),
    )?;
    network.apply(
        FaultOperation::Corrupt {
            packet_id: delete_id,
            corruption: FrameCorruption::DeleteField {
                json_pointer: "/body/remove".to_owned(),
            },
        },
        safe(0),
    )?;
    let deleted = packet(&network, delete_id)?;
    match deleted.payload {
        NetworkPayload::Frame(RawFrame::JsonValue(value)) => {
            assert_eq!(value.pointer("/body/keep"), Some(&json!(true)));
            assert!(value.pointer("/body/remove").is_none());
        }
        _ => return Err(missing("JSON-value corruption changed the raw variant")),
    }

    let replace_id = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        text_frame(r#"{"body":{"keep":true,"value":1}}"#),
        safe(0),
    )?;
    network.apply(
        FaultOperation::Corrupt {
            packet_id: replace_id,
            corruption: FrameCorruption::ReplaceField {
                json_pointer: "/body/value".to_owned(),
                value: Value::Null,
            },
        },
        safe(0),
    )?;
    let replaced = packet(&network, replace_id)?;
    match replaced.payload {
        NetworkPayload::Frame(RawFrame::JsonText(text)) => {
            let value: Value = serde_json::from_str(&text)?;
            assert_eq!(value.pointer("/body/value"), Some(&Value::Null));
        }
        _ => return Err(missing("JSON-text corruption changed the raw variant")),
    }

    let raw_replace_id = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({"before": true})),
        safe(0),
    )?;
    network.apply(
        FaultOperation::Corrupt {
            packet_id: raw_replace_id,
            corruption: FrameCorruption::Replace {
                value: RawFrame::JsonText("replacement".to_owned()),
            },
        },
        safe(0),
    )?;
    let raw_replaced = packet(&network, raw_replace_id)?;
    assert_eq!(
        raw_replaced.payload,
        NetworkPayload::Frame(RawFrame::JsonText("replacement".to_owned()))
    );

    let malformed_id = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({"valid": true})),
        safe(0),
    )?;
    network.apply(
        FaultOperation::Corrupt {
            packet_id: malformed_id,
            corruption: FrameCorruption::MalformedJson {
                text: "{not-json".to_owned(),
            },
        },
        safe(0),
    )?;
    let malformed = packet(&network, malformed_id)?;
    assert_eq!(
        malformed.payload,
        NetworkPayload::Frame(RawFrame::JsonText("{not-json".to_owned()))
    );
    assert_eq!(network.diagnostics().corrupted_count, safe(4));
    Ok(())
}

#[test]
fn proposal_corruption_is_rejected_without_mutation_or_counting() -> TestResult {
    let mut network = FaultNetwork::new(29, endpoints());
    let packet_id = network.enqueue(
        seat(2),
        seat(1),
        generation(0),
        proposal(seat(2), seat(1), generation(0), json!({"opaque": true}))?,
        safe(0),
    )?;
    let before = packet(&network, packet_id)?;
    assert!(matches!(
        network.apply(
            FaultOperation::Corrupt {
                packet_id,
                corruption: FrameCorruption::MalformedJson {
                    text: "not-a-proposal-frame".to_owned(),
                },
            },
            safe(0),
        ),
        Err(FaultNetworkError::PayloadIsNotFrame { packet_id: id }) if id == packet_id
    ));
    assert_eq!(packet(&network, packet_id)?, before);
    assert_eq!(network.diagnostics().corrupted_count, safe(0));
    Ok(())
}

#[test]
fn all_faults_compose_deterministically_with_reconnect_staleness() -> TestResult {
    fn run(seed: u64) -> Result<(Vec<NetworkEvent>, FaultNetworkDiagnostics), Box<dyn Error>> {
        let mut network = FaultNetwork::new(seed, endpoints());
        let first = network.enqueue(
            seat(1),
            seat(2),
            generation(0),
            frame(json!({"id":1,"value":1})),
            safe(0),
        )?;
        let proposal_id = network.enqueue(
            seat(2),
            seat(1),
            generation(0),
            proposal(seat(2), seat(1), generation(0), json!({"id":2}))?,
            safe(0),
        )?;
        let third = network.enqueue(
            seat(1),
            seat(2),
            generation(0),
            frame(json!({"id":3,"value":3})),
            safe(0),
        )?;
        network.apply(
            FaultOperation::Duplicate {
                packet_id: proposal_id,
            },
            safe(0),
        )?;
        let duplicate = safe(3);
        network.apply(
            FaultOperation::Delay {
                packet_id: first,
                additional_ms: safe(20),
            },
            safe(0),
        )?;
        network.apply(
            FaultOperation::Corrupt {
                packet_id: third,
                corruption: FrameCorruption::ReplaceField {
                    json_pointer: "/value".to_owned(),
                    value: json!(33),
                },
            },
            safe(0),
        )?;
        network.apply(
            FaultOperation::Reorder {
                packet_ids: vec![third, first, duplicate, proposal_id],
            },
            safe(0),
        )?;
        let dropped = network.apply(
            FaultOperation::Drop {
                packet_id: proposal_id,
            },
            safe(0),
        )?;
        assert_eq!(dropped_id(&dropped)?, proposal_id);
        assert!(network.disconnect(seat(1)));
        assert_eq!(network.reconnect(seat(1))?, generation(1));
        let events = network.deliver_due(SafeU53::MAX)?;
        Ok((events, network.diagnostics()))
    }

    let first = run(31)?;
    let second = run(31)?;
    assert_eq!(first, second);
    assert_eq!(first.0.len(), 3);
    assert!(
        first
            .0
            .iter()
            .all(|event| matches!(event, NetworkEvent::Dropped { .. }))
    );
    assert_eq!(first.1.dropped_count, safe(4));
    assert_eq!(first.1.duplicated_count, safe(1));
    assert_eq!(first.1.corrupted_count, safe(1));
    assert!(first.1.queued_packet_ids.is_empty());
    Ok(())
}

#[test]
fn dispose_is_idempotent_and_drains_queued_packets() -> TestResult {
    let mut network = FaultNetwork::new(37, endpoints());
    let packet_id = network.enqueue(
        seat(1),
        seat(2),
        generation(0),
        frame(json!({"queued":true})),
        safe(0),
    )?;
    assert!(network.packet(packet_id).is_some());
    network.dispose();
    network.dispose();
    let diagnostics = network.diagnostics();
    assert!(diagnostics.disposed);
    assert!(diagnostics.queued_packet_ids.is_empty());
    assert!(network.packet(packet_id).is_none());
    assert!(matches!(
        network.enqueue(
            seat(1),
            seat(2),
            generation(0),
            frame(json!({"after":"dispose"})),
            safe(0),
        ),
        Err(FaultNetworkError::Disposed)
    ));
    assert!(matches!(
        network.deliver_due(SafeU53::MAX),
        Err(FaultNetworkError::Disposed)
    ));
    assert!(!network.disconnect(seat(1)));
    assert!(!network.suspend(seat(1)));
    Ok(())
}
