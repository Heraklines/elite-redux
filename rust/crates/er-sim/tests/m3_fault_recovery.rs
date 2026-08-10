//! Closed fault/recovery snapshot boundary coverage.
//!
//! The malformed/duplicate cases below are necessary rejection evidence only.
//! M3C-11 acceptance also requires a live production Battle `SimulatedPair`
//! round-trip remains integration-owned until the private owner bridges are
//! exposed; these fault DTO checks are not a substitute for that test.

use std::error::Error;

use er_sim::PairEndpoint;
use er_sim::snapshot::{
    FaultNetworkSnapshotV2, FaultOperationV2, FaultScriptSnapshotV2, FrameCorruptionV2,
    NetworkLinkSnapshotV2, PacketDispositionV2, PacketReorderStateV2,
    QueuedPacketSnapshotV2, RestorablePacketKindV2, RestorableStorageRequestV2,
    StorageRequestSnapshotV2, StorageSnapshotV2,
};
use er_types::battle_ids::CanonicalHexBytes;
use er_types::{ConnectionGeneration, SafeU53};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).unwrap_or(SafeU53::ZERO)
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn links(generation: ConnectionGeneration) -> Vec<NetworkLinkSnapshotV2> {
    vec![
        NetworkLinkSnapshotV2 {
            endpoint: PairEndpoint::Host,
            generation,
            connected: true,
            suspended: false,
        },
        NetworkLinkSnapshotV2 {
            endpoint: PairEndpoint::Guest,
            generation,
            connected: true,
            suspended: false,
        },
    ]
}

fn packet(packet_id: u64, queue_order_id: u64) -> QueuedPacketSnapshotV2 {
    QueuedPacketSnapshotV2 {
        packet_id: safe(packet_id),
        queue_order_id: safe(queue_order_id),
        kind: RestorablePacketKindV2::AuthorityFrame,
        source: PairEndpoint::Host,
        destination: PairEndpoint::Guest,
        source_generation: generation(1),
        destination_generation: generation(1),
        body: CanonicalHexBytes::from_bytes(b"stale turn"),
        enqueued_at_ms: safe(10),
        delivery_deadline_ms: safe(50),
        reorder_state: PacketReorderStateV2::Stable,
        disposition: PacketDispositionV2::Delayed,
    }
}

#[test]
fn network_rejects_duplicate_packet_ids_but_retains_stale_generation_packets() {
    let stale = FaultNetworkSnapshotV2 {
        next_packet_id: safe(2),
        next_queue_order_id: safe(2),
        packets: vec![packet(1, 1)],
        links: links(generation(3)),
        disposed: false,
    };
    assert!(stale.validate().is_ok());

    let duplicate = FaultNetworkSnapshotV2 {
        next_packet_id: safe(3),
        next_queue_order_id: safe(3),
        packets: vec![packet(1, 1), packet(1, 2)],
        links: links(generation(3)),
        disposed: false,
    };
    assert!(duplicate.validate().is_err());
}

#[test]
fn fault_script_round_trips_duplicate_delay_and_all_corruption_variants() -> TestResult {
    let script = FaultScriptSnapshotV2 {
        cursor: safe(0),
        operations: vec![
            FaultOperationV2::Duplicate { packet_id: safe(1) },
            FaultOperationV2::Delay {
                packet_id: safe(1),
                additional_ms: safe(90),
            },
            FaultOperationV2::Corrupt {
                packet_id: safe(1),
                corruption: FrameCorruptionV2::Replace {
                    body: CanonicalHexBytes::from_bytes(br#"{"kind":"TURN"}"#),
                },
            },
            FaultOperationV2::Corrupt {
                packet_id: safe(1),
                corruption: FrameCorruptionV2::DeleteField {
                    json_pointer: "/context/connectionGeneration".to_owned(),
                },
            },
            FaultOperationV2::Corrupt {
                packet_id: safe(1),
                corruption: FrameCorruptionV2::ReplaceField {
                    json_pointer: "/context/connectionGeneration".to_owned(),
                    canonical_value: CanonicalHexBytes::from_bytes(b"4"),
                },
            },
            FaultOperationV2::Corrupt {
                packet_id: safe(1),
                corruption: FrameCorruptionV2::MalformedJson {
                    body: CanonicalHexBytes::from_bytes(b"{"),
                },
            },
        ],
    };
    script.validate()?;
    let encoded = serde_json::to_string(&script)?;
    let decoded: FaultScriptSnapshotV2 = serde_json::from_str(&encoded)?;
    assert_eq!(decoded, script);
    Ok(())
}

#[test]
fn fault_script_rejects_duplicate_reorder_ids_and_unknown_shapes() {
    let duplicate_reorder = FaultScriptSnapshotV2 {
        cursor: safe(0),
        operations: vec![FaultOperationV2::Reorder {
            packet_ids: vec![safe(7), safe(7)],
        }],
    };
    assert!(duplicate_reorder.validate().is_err());

    let root_pointer = FaultScriptSnapshotV2 {
        cursor: safe(0),
        operations: vec![FaultOperationV2::Corrupt {
            packet_id: safe(7),
            corruption: FrameCorruptionV2::DeleteField {
                json_pointer: String::new(),
            },
        }],
    };
    assert!(root_pointer.validate().is_err());
    assert!(serde_json::from_str::<FaultOperationV2>(r#"{"kind":"BIT_FLIP"}"#).is_err());
    assert!(serde_json::from_str::<FrameCorruptionV2>(
        r#"{"kind":"DELETE_FIELD","json_pointer":"/x","extra":true}"#,
    )
    .is_err());
}

#[test]
fn storage_identity_is_endpoint_qualified_and_nullable_fields_are_required() -> TestResult {
    let host_request = StorageRequestSnapshotV2 {
        endpoint: PairEndpoint::Host,
        request: RestorableStorageRequestV2::Load {
            request_id: safe(1),
            key: "run".to_owned(),
        },
    };
    let guest_request = StorageRequestSnapshotV2 {
        endpoint: PairEndpoint::Guest,
        request: RestorableStorageRequestV2::Load {
            request_id: safe(1),
            key: "run".to_owned(),
        },
    };
    let endpoint_qualified = StorageSnapshotV2 {
        next_request_id: Some(safe(2)),
        values: Vec::new(),
        pending_requests: vec![host_request.clone(), guest_request],
        one_shot_fault: None,
        disposed: false,
    };
    endpoint_qualified.validate()?;

    let duplicate_owner_key = StorageSnapshotV2 {
        next_request_id: Some(safe(2)),
        values: Vec::new(),
        pending_requests: vec![host_request.clone(), host_request],
        one_shot_fault: None,
        disposed: false,
    };
    assert!(duplicate_owner_key.validate().is_err());

    let missing_required_nullable =
        r#"{"values":[],"pending_requests":[],"one_shot_fault":null,"disposed":false}"#;
    assert!(serde_json::from_str::<StorageSnapshotV2>(missing_required_nullable).is_err());
    let explicit_null = r#"{"next_request_id":null,"values":[],"pending_requests":[],"one_shot_fault":null,"disposed":false}"#;
    let decoded: StorageSnapshotV2 = serde_json::from_str(explicit_null)?;
    decoded.validate()?;
    Ok(())
}
