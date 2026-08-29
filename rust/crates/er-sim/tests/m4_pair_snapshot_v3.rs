use er_sim::PairEndpoint;
use er_sim::snapshot::{
    PacketDispositionV2, PacketReorderStateV2, QueuedPacketSnapshotV2, RestorablePacketKindV2,
};
use er_sim::snapshot_v3::validate_packet_body_v3;
use er_types::battle_ids::CanonicalHexBytes;
use er_types::{ConnectionGeneration, SafeU53};
use serde::Serialize;
use serde::de::DeserializeOwned;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test values are safe")
}

fn round_trip<T>(value: &T) -> T
where
    T: Serialize + DeserializeOwned,
{
    serde_json::from_slice(&serde_json::to_vec(value).expect("serialize")).expect("deserialize")
}

#[test]
fn queued_packet_round_trip_retains_body_and_delivery_deadline() {
    let body = CanonicalHexBytes::from_bytes(b"authority-frame-body");
    let packet = QueuedPacketSnapshotV2 {
        packet_id: safe(4),
        queue_order_id: safe(8),
        kind: RestorablePacketKindV2::AuthorityFrame,
        source: PairEndpoint::Host,
        destination: PairEndpoint::Guest,
        source_generation: ConnectionGeneration::new(safe(2)),
        destination_generation: ConnectionGeneration::new(safe(2)),
        body: body.clone(),
        enqueued_at_ms: safe(10),
        delivery_deadline_ms: safe(50),
        reorder_state: PacketReorderStateV2::Stable,
        disposition: PacketDispositionV2::Queued,
    };
    let restored = round_trip(&packet);
    validate_packet_body_v3(&restored.body).expect("packet body is complete canonical bytes");
    assert_eq!(restored.body, body);
    assert_eq!(restored.delivery_deadline_ms, safe(50));
    assert_eq!(restored.source, PairEndpoint::Host);
    assert_eq!(restored.destination, PairEndpoint::Guest);
}

#[test]
fn packet_body_helper_rejects_summary_or_empty_payloads() {
    let empty = CanonicalHexBytes::from_bytes(&[]);
    assert!(validate_packet_body_v3(&empty).is_err());
}

#[test]
fn queued_packet_schema_rejects_unknown_fields() {
    let value = serde_json::json!({
        "packet_id": 1,
        "queue_order_id": 1,
        "kind": "AUTHORITY_FRAME",
        "source": "host",
        "destination": "guest",
        "source_generation": 1,
        "destination_generation": 1,
        "body": "00",
        "enqueued_at_ms": 0,
        "delivery_deadline_ms": 1,
        "reorder_state": {"kind": "STABLE"},
        "disposition": "QUEUED",
        "diagnostic_count": 1,
    });
    let error = serde_json::from_value::<QueuedPacketSnapshotV2>(value)
        .expect_err("packet owner schema is deny_unknown_fields");
    assert!(error.to_string().contains("unknown field"));
}
