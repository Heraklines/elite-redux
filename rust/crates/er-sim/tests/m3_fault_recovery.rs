//! Closed fault/recovery snapshot boundary coverage.
//!
//! The malformed/duplicate cases below are necessary rejection evidence only.
//! The live production Battle `SimulatedPair` campaign below proves that the
//! same fault state is restorable at the owner boundary, not only in DTOs.

use std::error::Error;

use er_sim::PairEndpoint;
use er_sim::snapshot::{
    FaultNetworkSnapshotV2, FaultOperationV2, FaultScriptSnapshotV2, FrameCorruptionV2,
    NetworkLinkSnapshotV2, PacketDispositionV2, PacketReorderStateV2, QueuedPacketSnapshotV2,
    RestorablePacketKindV2, RestorableStorageRequestV2, StorageRequestSnapshotV2,
    StorageSnapshotV2,
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
                    body: CanonicalHexBytes::from_bytes(
                        br#"{"kind":"JSON_VALUE","value":{"kind":"TURN"}}"#,
                    ),
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
    assert!(
        serde_json::from_str::<FrameCorruptionV2>(
            r#"{"kind":"DELETE_FIELD","json_pointer":"/x","extra":true}"#,
        )
        .is_err()
    );
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

// The legacy replica test retains the same external transport/proposal pump as
// the raw-key co-op campaign. The live Battle test below uses SimulatedPair's
// production environment owner and never bypasses the public pair boundary.
mod live_replica_recovery {
    include!("m3_raw_key_coop.rs");

    use std::collections::BTreeMap;

    use er_kernel::snapshot::{KernelDeterminismDigest, RestorableKernelSnapshotV2};
    use er_protocol::snapshot::{
        CorrelatedResponseSnapshotV2, PendingRecoverySnapshotV2, ProposalTimerKindV2,
    };
    use er_sim::snapshot::{
        PacketDispositionV2, QueuedPacketSnapshotV2, RestorablePacketKindV2,
        RestorablePairSnapshotV2,
    };
    use er_sim::{
        FaultOperation, FrameCorruption, PairEndpoint, PairOperation, SimulatedBattlePairConfig,
        SimulatedPair,
    };
    use er_types::battle_ids::{CanonicalHexBytes, ContentPackHash};
    use er_types::{LiveResourceSnapshot, RecoveryFenceState};

    fn content_pack() -> TestResult<Arc<ContentPack>> {
        let selected = selected_content_pack()?;
        let mut wire: Value = serde_json::from_str(CONTENT_PACK_FIXTURE)?;
        normalize_legacy_content_pack(&mut wire, &selected)?;
        let value = wire
            .get("content_pack")
            .cloned()
            .ok_or_else(|| invalid("content-pack fixture has no content_pack payload"))?;
        let content: ContentPack = serde_json::from_value(value)?;
        assert_eq!(
            content, selected,
            "published legacy content pack did not normalize to the current selected content",
        );
        Ok(Arc::new(content))
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
        assert_eq!(
            left.snapshot(),
            right.snapshot(),
            "legacy snapshot diverged after {label}"
        );
        assert_eq!(
            left.state_digest(),
            right.state_digest(),
            "legacy state digest diverged after {label}"
        );
        let left_v2 = left.snapshot_v2()?;
        let right_v2 = right.snapshot_v2()?;
        assert!(left_v2.prepared_transaction.is_none());
        assert!(right_v2.prepared_transaction.is_none());
        assert_eq!(
            serde_json::to_vec(&left_v2)?,
            serde_json::to_vec(&right_v2)?,
            "V2 snapshot bytes diverged after {label}"
        );
        assert_eq!(
            left_v2.mechanical_digest, right_v2.mechanical_digest,
            "mechanical digest diverged after {label}"
        );
        assert_eq!(
            left_v2.kernel_determinism_digest, right_v2.kernel_determinism_digest,
            "V2 kernel digest diverged after {label}"
        );
        assert_eq!(
            left_v2.ui, right_v2.ui,
            "UI projection diverged after {label}"
        );
        assert_eq!(
            left.battle_ui_projection(),
            right.battle_ui_projection(),
            "live UI projection diverged after {label}"
        );
        assert_eq!(
            left.live_resources(),
            right.live_resources(),
            "live resources diverged after {label}"
        );
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
        assert_eq!(
            serde_json::to_vec(&left_effects)?,
            serde_json::to_vec(&right_effects)?,
            "ordered effect bytes diverged after {label}"
        );
        assert_kernel_observation_equal(left, right, label)?;
        Ok(left_effects)
    }

    fn restore_from_wire(wire: &str, content: Arc<ContentPack>) -> TestResult<GameKernel> {
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

    fn simulated_battle_pair() -> TestResult<(SimulatedPair, Arc<ContentPack>)> {
        let mut host_game = forced_doubles_config()?;
        host_game.local_seat = seat(1);
        let mut guest_game = host_game.clone();
        guest_game.local_seat = seat(2);
        let host_seat = seat(1);
        let guest_seat = seat(2);
        let content = content_pack()?;
        let pair = SimulatedPair::new_battle(SimulatedBattlePairConfig {
            host_game,
            host_protocol: authority_protocol(host_seat, guest_seat, generation(1))?,
            guest_game,
            guest_protocol: replica_protocol(host_seat, guest_seat, generation(1))?,
            content: Arc::clone(&content),
            replay_seed: 0x4c554e41,
            initial_storage: BTreeMap::new(),
        })?;
        Ok((pair, content))
    }

    fn prime_simulated_battle(pair: &mut SimulatedPair) -> TestResult {
        // `new_battle` starts with the production protocol generation while
        // the fault network starts at zero. Reconnect once to synchronize the
        // live transport owner without starting a recovery transaction.
        pair.apply(PairOperation::Reconnect {
            endpoint: PairEndpoint::Host,
        })?;
        for endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            for _ in 0..3 {
                pair.press(endpoint, PhysicalKey::Enter)?;
            }
        }
        Ok(())
    }

    fn first_packet(
        snapshot: &RestorablePairSnapshotV2,
        kind: RestorablePacketKindV2,
        source: PairEndpoint,
        destination: PairEndpoint,
        packet_generation: ConnectionGeneration,
    ) -> TestResult<QueuedPacketSnapshotV2> {
        snapshot
            .network
            .packets
            .iter()
            .find(|packet| {
                packet.kind == kind
                    && packet.source == source
                    && packet.destination == destination
                    && packet.source_generation == packet_generation
                    && packet.destination_generation == packet_generation
            })
            .cloned()
            .ok_or_else(|| {
                invalid(format!(
                    "missing {kind:?} packet from {source:?} to {destination:?} at generation {}",
                    packet_generation.get().get()
                ))
            })
    }

    fn last_packet(
        snapshot: &RestorablePairSnapshotV2,
        kind: RestorablePacketKindV2,
        source: PairEndpoint,
        destination: PairEndpoint,
        packet_generation: ConnectionGeneration,
    ) -> TestResult<QueuedPacketSnapshotV2> {
        snapshot
            .network
            .packets
            .iter()
            .rev()
            .find(|packet| {
                packet.kind == kind
                    && packet.source == source
                    && packet.destination == destination
                    && packet.source_generation == packet_generation
                    && packet.destination_generation == packet_generation
            })
            .cloned()
            .ok_or_else(|| {
                invalid(format!(
                    "missing trailing {kind:?} packet from {source:?} to {destination:?} at generation {}",
                    packet_generation.get().get()
                ))
            })
    }

    fn packets_with_body(
        snapshot: &RestorablePairSnapshotV2,
        kind: RestorablePacketKindV2,
        source: PairEndpoint,
        destination: PairEndpoint,
        body: &CanonicalHexBytes,
    ) -> Vec<QueuedPacketSnapshotV2> {
        snapshot
            .network
            .packets
            .iter()
            .filter(|packet| {
                packet.kind == kind
                    && packet.source == source
                    && packet.destination == destination
                    && &packet.body == body
            })
            .cloned()
            .collect()
    }

    fn settle_pending_battle_presentations(pair: &mut SimulatedPair) -> TestResult {
        for _ in 0..64 {
            let snapshot = pair.snapshot_v2()?;
            let mut pending = Vec::new();
            pending.extend(
                snapshot
                    .host
                    .pending_presentations
                    .pending_barrier_ids
                    .iter()
                    .cloned()
                    .map(|event_id| (PairEndpoint::Host, event_id)),
            );
            pending.extend(
                snapshot
                    .guest
                    .pending_presentations
                    .pending_barrier_ids
                    .iter()
                    .cloned()
                    .map(|event_id| (PairEndpoint::Guest, event_id)),
            );
            if pending.is_empty() {
                return Ok(());
            }
            for (endpoint, event_id) in pending {
                pair.apply(PairOperation::BattlePresentationOutcome {
                    endpoint,
                    event_id,
                    outcome: PresentationSettlementOutcome::Settled,
                })?;
            }
        }
        Err(invalid(
            "Battle presentation barriers did not settle within the fixture bound",
        ))
    }

    fn assert_guest_recovery_fence_held(snapshot: &RestorablePairSnapshotV2) -> TestResult {
        let recovery = snapshot
            .guest
            .protocol
            .recovery
            .as_ref()
            .ok_or_else(|| invalid("replica snapshot omitted its recovery owner"))?;
        assert_eq!(recovery.fence.state, RecoveryFenceState::Held);
        assert!(recovery.phase.is_some());
        assert!(recovery.request_id.is_some());
        Ok(())
    }

    fn assert_pair_snapshot_equal(
        left: &RestorablePairSnapshotV2,
        right: &RestorablePairSnapshotV2,
        label: &str,
    ) -> TestResult {
        assert_eq!(
            serde_json::to_vec(left)?,
            serde_json::to_vec(right)?,
            "restorable pair snapshot bytes diverged after {label}",
        );
        assert_eq!(
            left.network.packets, right.network.packets,
            "packet queue/order diverged after {label}",
        );
        assert_eq!(
            left.host.mechanical_digest, right.host.mechanical_digest,
            "host mechanical digest diverged after {label}",
        );
        assert_eq!(
            left.guest.mechanical_digest, right.guest.mechanical_digest,
            "guest mechanical digest diverged after {label}",
        );
        assert_eq!(
            left.host.kernel_determinism_digest, right.host.kernel_determinism_digest,
            "host kernel digest diverged after {label}",
        );
        assert_eq!(
            left.guest.kernel_determinism_digest, right.guest.kernel_determinism_digest,
            "guest kernel digest diverged after {label}",
        );
        Ok(())
    }

    fn apply_same_pair_operation(
        uninterrupted: &mut SimulatedPair,
        restored: &mut SimulatedPair,
        operation: PairOperation,
        label: &str,
    ) -> TestResult {
        let uninterrupted_step = uninterrupted.apply(operation.clone())?;
        let restored_step = restored.apply(operation)?;
        assert_eq!(
            uninterrupted_step.sequence, restored_step.sequence,
            "pair sequence diverged after {label}",
        );
        assert_eq!(
            uninterrupted_step.operation, restored_step.operation,
            "operation identity diverged after {label}",
        );
        assert_eq!(
            serde_json::to_vec(&uninterrupted_step.generated_effects)?,
            serde_json::to_vec(&restored_step.generated_effects)?,
            "ordered effects diverged after {label}",
        );
        assert_eq!(
            uninterrupted_step.effects_digest, restored_step.effects_digest,
            "effect digest diverged after {label}",
        );
        let uninterrupted_snapshot = uninterrupted.snapshot_v2()?;
        let restored_snapshot = restored.snapshot_v2()?;
        assert_pair_snapshot_equal(&uninterrupted_snapshot, &restored_snapshot, label)
    }

    fn assert_zero_pair_resources(snapshot: &er_sim::PairSnapshot) {
        assert_eq!(
            snapshot.host.live_resources,
            LiveResourceSnapshot::default()
        );
        assert_eq!(
            snapshot.guest.live_resources,
            LiveResourceSnapshot::default()
        );
        assert!(snapshot.clock_timers.is_empty());
        assert!(snapshot.network.queued_packet_ids.is_empty());
        assert!(snapshot.network.disconnected_endpoints.is_empty());
        assert!(snapshot.network.suspended_endpoints.is_empty());
        assert!(snapshot.network.disposed);
        assert!(snapshot.presenter.pending_event_ids.is_empty());
        assert!(snapshot.presenter.settled_event_ids.is_empty());
        assert!(snapshot.presenter.disposed);
        assert!(snapshot.storage.keys.is_empty());
        assert!(snapshot.storage.pending_request_ids.is_empty());
        assert!(snapshot.storage.disposed);
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
        assert!(
            original_snapshot
                .scheduler
                .timers
                .iter()
                .any(|timer| timer.registration.timer_id == retry_timer_id)
        );
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
        malformed_content_hash.content_hash = alternate_content_hash(&decoded.content_hash)?;
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
        malformed_recovery
            .protocol
            .pending_recoveries
            .push(PendingRecoverySnapshotV2 {
                correlation_id: String::new(),
                bundle: None,
            });
        assert_rejected_without_mutating_live_owner(
            &uninterrupted,
            &baseline,
            malformed_recovery,
            Arc::clone(&content),
            "recovery correlation",
        )?;
        Ok(())
    }

    #[test]
    fn live_battle_pair_fault_queue_round_trip_is_atomic_and_deterministic() -> TestResult {
        let (mut pair, content) = simulated_battle_pair()?;
        prime_simulated_battle(&mut pair)?;

        let generation_one = generation(1);
        let initial = pair.snapshot_v2()?;
        let proposal = first_packet(
            &initial,
            RestorablePacketKindV2::CommandProposal,
            PairEndpoint::Guest,
            PairEndpoint::Host,
            generation_one,
        )?;

        // A frame-only fault against an opaque proposal must fail atomically:
        // no queue, RNG, sequence, or fault-script cursor mutation may leak.
        let before_failed_fault = serde_json::to_vec(&pair.snapshot_v2()?)?;
        let rejected_fault = pair.apply(PairOperation::Fault {
            operation: FaultOperation::Corrupt {
                packet_id: proposal.packet_id,
                corruption: FrameCorruption::DeleteField {
                    json_pointer: "/ctx/connectionGeneration".to_owned(),
                },
            },
        });
        assert!(rejected_fault.is_err());
        assert_eq!(
            serde_json::to_vec(&pair.snapshot_v2()?)?,
            before_failed_fault,
            "failed fault crossed the SimulatedPair atomic boundary",
        );

        pair.apply(PairOperation::Fault {
            operation: FaultOperation::Deliver {
                packet_id: proposal.packet_id,
            },
        })?;
        let turn = first_packet(
            &pair.snapshot_v2()?,
            RestorablePacketKindV2::AuthorityFrame,
            PairEndpoint::Host,
            PairEndpoint::Guest,
            generation_one,
        )?;
        pair.apply(PairOperation::Fault {
            operation: FaultOperation::Delay {
                packet_id: turn.packet_id,
                additional_ms: safe(100),
            },
        })?;
        let delayed_turn = first_packet(
            &pair.snapshot_v2()?,
            RestorablePacketKindV2::AuthorityFrame,
            PairEndpoint::Host,
            PairEndpoint::Guest,
            generation_one,
        )?;
        assert_eq!(delayed_turn.disposition, PacketDispositionV2::Delayed);
        assert!(delayed_turn.delivery_deadline_ms > delayed_turn.enqueued_at_ms);

        // Delivering the delayed TURN explicitly leaves the generated Battle
        // effects and the logical-control receipt in the production pump.
        pair.apply(PairOperation::Fault {
            operation: FaultOperation::Deliver {
                packet_id: turn.packet_id,
            },
        })?;
        let after_turn = pair.snapshot_v2()?;
        if !after_turn.network.packets.iter().any(|packet| {
            packet.kind == RestorablePacketKindV2::ControlReceipt
                && packet.source == PairEndpoint::Guest
                && packet.destination == PairEndpoint::Host
        }) {
            // FaultControlled presenters intentionally retain their own live
            // barrier state. Settle it through the public pair operation if
            // this Battle path emitted the receipt only after presentation.
            settle_pending_battle_presentations(&mut pair)?;
        }
        // Replica admission emits ordered admitted/material/control receipts;
        // the trailing receipt is the logical-control (`controlInstalled`)
        // acknowledgement, before any optional presentation settlement.
        let receipt = last_packet(
            &pair.snapshot_v2()?,
            RestorablePacketKindV2::ControlReceipt,
            PairEndpoint::Guest,
            PairEndpoint::Host,
            generation_one,
        )?;
        let receipt_body_before_corruption = receipt.body.clone();
        pair.apply(PairOperation::Fault {
            operation: FaultOperation::Delay {
                packet_id: receipt.packet_id,
                additional_ms: safe(100),
            },
        })?;
        let delayed_receipt = last_packet(
            &pair.snapshot_v2()?,
            RestorablePacketKindV2::ControlReceipt,
            PairEndpoint::Guest,
            PairEndpoint::Host,
            generation_one,
        )?;
        assert_eq!(delayed_receipt.disposition, PacketDispositionV2::Delayed);

        pair.apply(PairOperation::Fault {
            operation: FaultOperation::Corrupt {
                packet_id: receipt.packet_id,
                corruption: FrameCorruption::DeleteField {
                    json_pointer: "/ctx/connectionGeneration".to_owned(),
                },
            },
        })?;
        let corrupted_receipt = last_packet(
            &pair.snapshot_v2()?,
            RestorablePacketKindV2::ControlReceipt,
            PairEndpoint::Guest,
            PairEndpoint::Host,
            generation_one,
        )?;
        assert_ne!(
            corrupted_receipt.body, receipt_body_before_corruption,
            "production frame corruption did not change the queued receipt bytes",
        );
        let corrupted_receipt_body = corrupted_receipt.body.clone();

        // Keep both copies in the queue so the final checkpoint contains a
        // literal duplicate pair, rather than only a historical duplicate
        // counter that the closed V2 schema intentionally does not expose.
        pair.apply(PairOperation::Fault {
            operation: FaultOperation::Duplicate {
                packet_id: receipt.packet_id,
            },
        })?;
        let duplicated = packets_with_body(
            &pair.snapshot_v2()?,
            RestorablePacketKindV2::ControlReceipt,
            PairEndpoint::Guest,
            PairEndpoint::Host,
            &corrupted_receipt_body,
        );
        assert_eq!(duplicated.len(), 2);

        // Transport generation is not presentation ownership. Recovery fences
        // input while the exact local plan, pending identities, outcomes, and
        // presenter requests survive the rebind for deterministic continuation.
        let before_reconnect = pair.snapshot_v2()?;
        let guest_presentations_before = before_reconnect.guest.pending_presentations.clone();
        let guest_presenter_pending_before = before_reconnect
            .presenter
            .pending
            .iter()
            .filter(|entry| entry.endpoint == PairEndpoint::Guest)
            .cloned()
            .collect::<Vec<_>>();
        assert!(
            !guest_presentations_before.pending_barrier_ids.is_empty(),
            "mixed-fault fixture omitted the guest presentation rebind boundary",
        );
        assert!(
            !guest_presenter_pending_before.is_empty(),
            "mixed-fault fixture omitted the guest presenter request",
        );

        // A new generation fences the delayed/corrupted receipt copies while
        // the replica recovery transaction is visibly held.
        pair.apply(PairOperation::Reconnect {
            endpoint: PairEndpoint::Guest,
        })?;
        let checkpoint = pair.snapshot_v2()?;
        assert_eq!(
            checkpoint.guest.pending_presentations, guest_presentations_before,
            "guest reconnect changed the local presentation epoch",
        );
        let guest_presenter_pending_after = checkpoint
            .presenter
            .pending
            .iter()
            .filter(|entry| entry.endpoint == PairEndpoint::Guest)
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(
            guest_presenter_pending_after, guest_presenter_pending_before,
            "guest reconnect changed presenter-owned pending requests",
        );
        assert_guest_recovery_fence_held(&checkpoint)?;
        let current_generation = checkpoint
            .network
            .links
            .iter()
            .find(|link| link.endpoint == PairEndpoint::Guest)
            .map(|link| link.generation)
            .ok_or_else(|| invalid("pair snapshot omitted the guest network link"))?;
        assert_eq!(current_generation, generation(2));
        let stale_receipts = duplicated
            .iter()
            .map(|packet| packet.packet_id)
            .collect::<Vec<_>>();
        assert!(stale_receipts.iter().all(|packet_id| {
            checkpoint.network.packets.iter().any(|packet| {
                packet.packet_id == *packet_id
                    && packet.source_generation != current_generation
                    && packet.destination_generation != current_generation
            })
        }));
        let queued_corrupted_delayed = packets_with_body(
            &checkpoint,
            RestorablePacketKindV2::ControlReceipt,
            PairEndpoint::Guest,
            PairEndpoint::Host,
            &corrupted_receipt_body,
        );
        assert_eq!(queued_corrupted_delayed.len(), 2);
        assert!(
            queued_corrupted_delayed
                .iter()
                .all(|packet| packet.disposition == PacketDispositionV2::Delayed)
        );

        let wire = serde_json::to_string(&checkpoint)?;
        let decoded: RestorablePairSnapshotV2 = serde_json::from_str(&wire)?;
        assert_eq!(
            serde_json::to_vec(&checkpoint)?,
            serde_json::to_vec(&decoded)?,
            "live pair JSON round trip changed canonical snapshot bytes",
        );
        let mut uninterrupted = pair;
        let mut restored = SimulatedPair::from_snapshot(decoded, Arc::clone(&content))?;
        let uninterrupted_checkpoint = uninterrupted.snapshot_v2()?;
        let restored_checkpoint = restored.snapshot_v2()?;
        assert_pair_snapshot_equal(
            &uninterrupted_checkpoint,
            &restored_checkpoint,
            "live Battle restore",
        )?;

        // First reap both stale copies through the same fault boundary. Then
        // continue the held recovery request and bundle; every ordered effect,
        // queued packet body/order, and endpoint digest must remain identical.
        for packet_id in stale_receipts {
            apply_same_pair_operation(
                &mut uninterrupted,
                &mut restored,
                PairOperation::Fault {
                    operation: FaultOperation::Deliver { packet_id },
                },
                "stale-generation receipt reap",
            )?;
        }
        let recovery_request = first_packet(
            &uninterrupted.snapshot_v2()?,
            RestorablePacketKindV2::AuthorityFrame,
            PairEndpoint::Guest,
            PairEndpoint::Host,
            current_generation,
        )?;
        apply_same_pair_operation(
            &mut uninterrupted,
            &mut restored,
            PairOperation::Fault {
                operation: FaultOperation::Deliver {
                    packet_id: recovery_request.packet_id,
                },
            },
            "recovery request",
        )?;
        let recovery_bundle = first_packet(
            &uninterrupted.snapshot_v2()?,
            RestorablePacketKindV2::AuthorityFrame,
            PairEndpoint::Host,
            PairEndpoint::Guest,
            current_generation,
        )?;
        apply_same_pair_operation(
            &mut uninterrupted,
            &mut restored,
            PairOperation::Fault {
                operation: FaultOperation::Deliver {
                    packet_id: recovery_bundle.packet_id,
                },
            },
            "recovery bundle",
        )?;

        // The recovery bundle may leave a Battle presentation barrier active.
        // Settle it while both endpoint kernels are live; explicit teardown
        // must be the final lifecycle action because recovery cleanup can
        // otherwise publish a shared terminal after disposal.
        settle_pending_battle_presentations(&mut uninterrupted)?;
        settle_pending_battle_presentations(&mut restored)?;
        let uninterrupted_settled = uninterrupted.snapshot_v2()?;
        let restored_settled = restored.snapshot_v2()?;
        assert_pair_snapshot_equal(
            &uninterrupted_settled,
            &restored_settled,
            "post-recovery presentation settlement",
        )?;

        let uninterrupted_cleanup = uninterrupted.teardown("live Battle fault recovery test")?;
        let restored_cleanup = restored.teardown("live Battle fault recovery test")?;
        assert_zero_pair_resources(&uninterrupted_cleanup);
        assert_zero_pair_resources(&restored_cleanup);
        assert_eq!(
            uninterrupted_cleanup.host.live_resources,
            restored_cleanup.host.live_resources
        );
        assert_eq!(
            uninterrupted_cleanup.guest.live_resources,
            restored_cleanup.guest.live_resources
        );
        Ok(())
    }
}
