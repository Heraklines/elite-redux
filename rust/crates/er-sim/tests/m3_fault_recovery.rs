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

// The fault campaign uses the same production doubles builder as the raw-key
// co-op campaign.  The pump remains an external transport/proposal boundary;
// it does not call a reducer, command collector, or material applier directly.
mod live_replica_recovery {
    include!("m3_raw_key_coop.rs");

    use er_content::pack::ContentPack;
    use er_kernel::snapshot::{
        KernelDeterminismDigest, RestorableKernelSnapshotV2,
    };
    use er_protocol::snapshot::{
        CorrelatedResponseSnapshotV2, PendingRecoverySnapshotV2, ProposalTimerKindV2,
    };
    use er_types::battle_ids::{CanonicalHexBytes, ContentPackHash};

    fn content_pack() -> TestResult<Arc<ContentPack>> {
        let wire: Value = serde_json::from_str(CONTENT_PACK_FIXTURE)?;
        let value = wire
            .get("content_pack")
            .cloned()
            .ok_or_else(|| invalid("content-pack fixture has no content_pack payload"))?;
        Ok(Arc::new(serde_json::from_value(value)?))
    }

    fn snapshot_wire(
        snapshot: &RestorableKernelSnapshotV2,
    ) -> TestResult<(String, RestorableKernelSnapshotV2)> {
        assert!(
            snapshot.prepared_transaction.is_none(),
            "public snapshots are quiescent: prepared transactions are drained and unobservable"
        );
        let wire = serde_json::to_string(snapshot)?;
        let value: Value = serde_json::from_str(&wire)?;
        assert_eq!(value.get("prepared_transaction"), Some(&Value::Null));
        let decoded: RestorableKernelSnapshotV2 = serde_json::from_str(&wire)?;
        assert_eq!(
            serde_json::to_vec(snapshot)?,
            serde_json::to_vec(&decoded)?,
            "fault snapshot JSON round trip changed canonical bytes",
        );
        Ok((wire, decoded))
    }

    fn assert_kernel_observation_equal(
        left: &GameKernel,
        right: &GameKernel,
        label: &str,
    ) -> TestResult {
        assert_eq!(left.snapshot(), right.snapshot(), "legacy snapshot diverged after {label}");
        assert_eq!(left.state_digest(), right.state_digest(), "legacy state digest diverged after {label}");
        let left_v2 = left.snapshot_v2()?;
        let right_v2 = right.snapshot_v2()?;
        assert!(left_v2.prepared_transaction.is_none());
        assert!(right_v2.prepared_transaction.is_none());
        assert_eq!(serde_json::to_vec(&left_v2)?, serde_json::to_vec(&right_v2)?, "V2 snapshot bytes diverged after {label}");
        assert_eq!(left_v2.mechanical_digest, right_v2.mechanical_digest, "mechanical digest diverged after {label}");
        assert_eq!(left_v2.kernel_determinism_digest, right_v2.kernel_determinism_digest, "V2 kernel digest diverged after {label}");
        assert_eq!(left_v2.ui, right_v2.ui, "UI projection diverged after {label}");
        assert_eq!(left.battle_ui_projection(), right.battle_ui_projection(), "live UI projection diverged after {label}");
        assert_eq!(left.live_resources(), right.live_resources(), "live resources diverged after {label}");
        Ok(())
    }

    fn step_same_input(
        left: &mut GameKernel,
        right: &mut GameKernel,
        input: KernelInput,
        label: &str,
    ) -> TestResult<Vec<KernelEffect>> {
        let left_effects = left.step(input.clone())?;
        let right_effects = right.step(input)?;
        assert_eq!(serde_json::to_vec(&left_effects)?, serde_json::to_vec(&right_effects)?, "ordered effect bytes diverged after {label}");
        assert_kernel_observation_equal(left, right, label)?;
        Ok(left_effects)
    }

    fn restore_from_wire(
        wire: &str,
        content: Arc<ContentPack>,
    ) -> TestResult<GameKernel> {
        let snapshot: RestorableKernelSnapshotV2 = serde_json::from_str(wire)?;
        Ok(GameKernel::from_snapshot(snapshot, content)?)
    }

    fn alternate_content_hash(hash: &ContentPackHash) -> TestResult<ContentPackHash> {
        let mut value = hash.as_str().to_owned();
        let last = value
            .len()
            .checked_sub(1)
            .ok_or_else(|| invalid("content hash was empty"))?;
        let replacement = if value.as_bytes()[last] == b'0' {
            '1'
        } else {
            '0'
        };
        value.replace_range(last.., &replacement.to_string());
        Ok(ContentPackHash::new(value)?)
    }

    fn alternate_kernel_digest(
        digest: &KernelDeterminismDigest,
    ) -> TestResult<KernelDeterminismDigest> {
        let mut value = digest.as_str().to_owned();
        let last = value
            .len()
            .checked_sub(1)
            .ok_or_else(|| invalid("kernel digest was empty"))?;
        let replacement = if value.as_bytes()[last] == b'0' {
            '1'
        } else {
            '0'
        };
        value.replace_range(last.., &replacement.to_string());
        Ok(KernelDeterminismDigest::new(value)?)
    }

    fn assert_rejected_without_mutating_live_owner(
        live: &GameKernel,
        baseline: &[u8],
        bad_snapshot: RestorableKernelSnapshotV2,
        content: Arc<ContentPack>,
        label: &str,
    ) -> TestResult {
        assert!(
            GameKernel::from_snapshot(bad_snapshot, content).is_err(),
            "malformed {label} snapshot was accepted",
        );
        assert_eq!(
            serde_json::to_vec(&live.snapshot_v2()?)?,
            baseline,
            "failed {label} restore mutated the live owner",
        );
        Ok(())
    }

    #[test]
    fn live_replica_proposal_timer_round_trip_and_malformed_restore_is_atomic() -> TestResult {
        let mut pair = BattlePair::new(forced_doubles_config()?, generation(1))?;
        pair.connect()?;
        for endpoint in [Endpoint::Host, Endpoint::Guest] {
            for _ in 0..3 {
                pair.raw_press(endpoint, PhysicalKey::Enter)?;
            }
        }

        let original_snapshot = pair.guest.snapshot_v2()?;
        let leases = original_snapshot
            .protocol
            .proposal_leases
            .as_ref()
            .ok_or_else(|| invalid("replica snapshot omitted proposal leases"))?;
        assert!(!leases.leases.is_empty());
        let retry_timer_id = leases
            .timer_targets
            .iter()
            .find(|target| matches!(target.kind, ProposalTimerKindV2::Retry))
            .map(|target| target.timer_id)
            .ok_or_else(|| invalid("replica snapshot omitted proposal retry timer"))?;
        assert!(original_snapshot
            .scheduler
            .timers
            .iter()
            .any(|timer| timer.registration.timer_id == retry_timer_id));
        let (wire, decoded) = snapshot_wire(&original_snapshot)?;
        let content = content_pack()?;
        let (mut uninterrupted, mut restored) = {
            let original = pair.guest.clone();
            let restored = restore_from_wire(&wire, Arc::clone(&content))?;
            // `original` is the independent continuation oracle and is
            // dropped at the end of this scope after the JSON restore exists.
            (original, restored)
        };
        assert_kernel_observation_equal(
            &uninterrupted,
            &restored,
            "replica-proposal-timer-restore",
        )?;

        let effects = step_same_input(
            &mut uninterrupted,
            &mut restored,
            KernelInput::TimerFired {
                endpoint: Endpoint::Guest.seat(),
                timer_id: retry_timer_id,
            },
            "replica-proposal-retry-timer",
        )?;
        assert!(
            effects
                .iter()
                .any(|effect| matches!(effect, KernelEffect::SendProposal { .. }))
        );

        let baseline = serde_json::to_vec(&uninterrupted.snapshot_v2()?)?;

        let mut malformed_content_hash = decoded.clone();
        malformed_content_hash.content_hash =
            alternate_content_hash(&decoded.content_hash)?;
        assert_rejected_without_mutating_live_owner(
            &uninterrupted,
            &baseline,
            malformed_content_hash,
            Arc::clone(&content),
            "content identity",
        )?;

        let malformed_content = decoded.clone();
        let mut wrong_content_pack = (*content).clone();
        wrong_content_pack.hash = alternate_content_hash(&wrong_content_pack.hash)?;
        assert_rejected_without_mutating_live_owner(
            &uninterrupted,
            &baseline,
            malformed_content,
            Arc::new(wrong_content_pack),
            "content pack",
        )?;

        let mut malformed_digest = decoded.clone();
        malformed_digest.kernel_determinism_digest =
            alternate_kernel_digest(&decoded.kernel_determinism_digest)?;
        assert_rejected_without_mutating_live_owner(
            &uninterrupted,
            &baseline,
            malformed_digest,
            Arc::clone(&content),
            "kernel digest",
        )?;

        let mut malformed_timer = decoded.clone();
        let timer = malformed_timer
            .scheduler
            .timers
            .first_mut()
            .ok_or_else(|| invalid("replica snapshot has no timer to corrupt"))?;
        timer.original_delay_ms = SafeU53::ZERO;
        timer.remaining_active_ms = SafeU53::MAX;
        assert_rejected_without_mutating_live_owner(
            &uninterrupted,
            &baseline,
            malformed_timer,
            Arc::clone(&content),
            "timer",
        )?;

        let mut malformed_correlation = decoded.clone();
        malformed_correlation
            .protocol
            .pending_correlations
            .push(CorrelatedResponseSnapshotV2 {
                correlation_id: String::new(),
                bytes: CanonicalHexBytes::from_bytes(b""),
            });
        assert_rejected_without_mutating_live_owner(
            &uninterrupted,
            &baseline,
            malformed_correlation,
            Arc::clone(&content),
            "correlation",
        )?;

        let mut malformed_recovery = decoded.clone();
        malformed_recovery.protocol.pending_recoveries.push(
            PendingRecoverySnapshotV2 {
                correlation_id: String::new(),
                bundle: None,
            },
        );
        assert_rejected_without_mutating_live_owner(
            &uninterrupted,
            &baseline,
            malformed_recovery,
            Arc::clone(&content),
            "recovery correlation",
        )?;
        Ok(())
    }
}
