//! Restorable V2 continuation-boundary coverage.
//!
//! The focused DTO checks and live production-pair continuations below cover
//! both closed-shape rejection evidence and owner-backed restoration.

use std::error::Error;

use er_kernel::snapshot::{
    HeldLogicalButtonSnapshotV2, InputRepeatSnapshotV2, InputRouterSnapshotV2,
    KernelSchedulerSnapshotV2, PendingPresentationsSnapshotV1, PhysicalInputSourceV2,
    PresentationOutcomeSnapshotV1, PresentationPlanSnapshotV1, PressedPhysicalInputSnapshotV2,
    RestorableTimerSnapshotV2, TimeClassPauseSnapshotV2,
};
use er_protocol::snapshot::{PendingRecoverySnapshotV2, StagedPeerRebindSnapshotV2};
use er_sim::PairEndpoint;
use er_sim::snapshot::{
    FaultNetworkSnapshotV2, NetworkLinkSnapshotV2, PacketDispositionV2, PacketReorderStateV2,
    PairPresenterOutcomeSnapshotV2, PairPresenterTombstoneSnapshotV2, PresenterSnapshotV2,
    QueuedPacketSnapshotV2,
};
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
fn presenter_snapshot_rejects_an_orphan_terminal_tombstone() -> TestResult {
    let event = battle_event()?;
    let mut snapshot = PresenterSnapshotV2 {
        pending: Vec::new(),
        outcomes: vec![PairPresenterOutcomeSnapshotV2 {
            endpoint: PairEndpoint::Host,
            outcome: PresentationOutcomeSnapshotV1 {
                event_id: event.event_id.clone(),
                outcome: PresentationSettlementOutcome::Settled,
            },
        }],
        tombstones: vec![PairPresenterTombstoneSnapshotV2 {
            endpoint: PairEndpoint::Host,
            event_id: event.event_id,
        }],
        disposed: true,
    };
    snapshot.validate()?;
    snapshot.outcomes.clear();
    assert!(snapshot.validate().is_err());
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

// Keep the production fixture/configuration construction in one place.  The
// raw-key helper is an integration-test module rather than a library API, so
// including it here lets this test exercise exactly the same new_battle
// boundary without adding a semantic command adapter or changing ownership of
// the helper file.
mod live_local_production {
    include!("m3_raw_key_local.rs");

    use er_content::pack::ContentPack;
    use er_kernel::snapshot::RestorableKernelSnapshotV2;

    fn content_pack() -> TestResult<Arc<ContentPack>> {
        let catalog = load_m3_fixture_catalog()?;
        if !catalog.is_evidence_published() {
            return Err(invalid_data("M3 oracle evidence is not published").into());
        }
        let mut artifact =
            catalog.load_published_supporting_artifact::<Value>("content-pack-v1")?;
        let selected = er_content::pack::selected_content_pack()?;
        super::live_coop_production::normalize_legacy_content_pack(&mut artifact, &selected)?;
        let value = artifact
            .get("content_pack")
            .cloned()
            .ok_or_else(|| invalid_data("published content artifact has no content_pack"))?;
        let pack: ContentPack = serde_json::from_value(value)?;
        if pack != selected {
            return Err(invalid_data(
                "published legacy content pack did not normalize to the current selected content",
            )
            .into());
        }
        Ok(Arc::new(pack))
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
            "snapshot JSON round trip changed canonical bytes",
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
            "legacy snapshot diverged after {label}",
        );
        assert_eq!(
            left.state_digest(),
            right.state_digest(),
            "legacy state digest diverged after {label}",
        );
        let left_v2 = left.snapshot_v2()?;
        let right_v2 = right.snapshot_v2()?;
        assert!(left_v2.prepared_transaction.is_none());
        assert!(right_v2.prepared_transaction.is_none());
        assert_eq!(
            serde_json::to_vec(&left_v2)?,
            serde_json::to_vec(&right_v2)?,
            "V2 snapshot bytes diverged after {label}",
        );
        assert_eq!(
            left_v2.mechanical_digest, right_v2.mechanical_digest,
            "mechanical digest diverged after {label}",
        );
        assert_eq!(
            left_v2.kernel_determinism_digest, right_v2.kernel_determinism_digest,
            "V2 kernel digest diverged after {label}",
        );
        assert_eq!(
            left_v2.ui, right_v2.ui,
            "V2 UI projection diverged after {label}",
        );
        assert_eq!(
            left.battle_ui_projection(),
            right.battle_ui_projection(),
            "live UI projection diverged after {label}",
        );
        assert_eq!(
            left.live_resources(),
            right.live_resources(),
            "live resources diverged after {label}",
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
            "ordered effect bytes diverged after {label}",
        );
        assert_kernel_observation_equal(left, right, label)?;
        Ok(left_effects)
    }

    fn raw_input(seat: SeatId, event: RawInputEvent) -> KernelInput {
        KernelInput::RawInput { seat, event }
    }

    fn restore_from_wire(wire: &str, content: Arc<ContentPack>) -> TestResult<GameKernel> {
        let snapshot: RestorableKernelSnapshotV2 = serde_json::from_str(wire)?;
        Ok(GameKernel::from_snapshot(snapshot, content)?)
    }

    pub(super) fn content_pack_for_pair() -> TestResult<Arc<ContentPack>> {
        content_pack()
    }

    #[test]
    fn live_raw_key_snapshot_continues_held_fight_before_keyup() -> TestResult {
        let fixture = published_case("physical-hit")?;
        let content = content_pack()?;
        let (wire, mut uninterrupted) = {
            let mut original = new_kernel(&fixture)?;
            let held_effects = raw_key_down(&mut original, PhysicalKey::Enter)?;
            assert!(!held_effects.is_empty());
            assert!(matches!(control(&original)?, BattleControl::MoveSelect(_)));

            let snapshot = original.snapshot_v2()?;
            assert!(snapshot.input_router.pressed.len() == 1);
            assert!(!snapshot.input_router.held_buttons.is_empty());
            assert!(!snapshot.input_router.locks.is_empty());
            assert!(!snapshot.input_router.repeats.is_empty());
            assert!(
                snapshot
                    .scheduler
                    .timers
                    .iter()
                    .any(|timer| timer.registration.owner.owner_id == "input-router")
            );
            assert!(snapshot.prepared_transaction.is_none());
            let (wire, _) = snapshot_wire(&snapshot)?;

            // The uninterrupted branch is only a continuation oracle.  The
            // original owner itself is dropped before the JSON restore.
            (wire, original.clone())
        };
        let mut restored = restore_from_wire(&wire, content)?;
        assert_kernel_observation_equal(&uninterrupted, &restored, "restore-before-keyup")?;

        let seat = seat(1)?;
        let later_inputs = [
            (
                raw_input(
                    seat,
                    RawInputEvent::KeyUp {
                        code: PhysicalKey::Enter,
                    },
                ),
                "held-enter-keyup",
            ),
            (
                raw_input(
                    seat,
                    RawInputEvent::KeyDown {
                        code: PhysicalKey::Enter,
                        printable: false,
                        browser_repeat: false,
                        focus: InputFocus::Game,
                    },
                ),
                "fresh-enter-fight",
            ),
            (
                raw_input(
                    seat,
                    RawInputEvent::KeyUp {
                        code: PhysicalKey::Enter,
                    },
                ),
                "fresh-enter-keyup",
            ),
        ];
        let mut pending_events = Vec::new();
        for (input, label) in later_inputs {
            let effects = step_same_input(&mut uninterrupted, &mut restored, input, label)?;
            pending_events.extend(presentation_events(&effects));
        }
        assert!(!pending_events.is_empty());
        for event in pending_events {
            step_same_input(
                &mut uninterrupted,
                &mut restored,
                KernelInput::BattlePresentationOutcome {
                    endpoint: seat,
                    event_id: event.event_id,
                    outcome: PresentationSettlementOutcome::Settled,
                },
                "presentation-settlement",
            )?;
        }
        Ok(())
    }

    #[test]
    fn live_terminal_snapshot_restoration_is_absorbing_and_resource_free() -> TestResult {
        let fixture = published_case("victory")?;
        let content = content_pack()?;
        let (wire, mut uninterrupted) = {
            let mut original = new_kernel(&fixture)?;
            let mut effects = Vec::new();
            effects.extend(raw_press(&mut original, PhysicalKey::Enter)?);
            effects.extend(raw_press(&mut original, PhysicalKey::Enter)?);
            let events = presentation_events(&effects);
            assert!(!events.is_empty());
            effects.extend(settle_presentations(&mut original, &events)?);
            assert!(matches!(control(&original)?, BattleControl::Complete(_)));
            assert_eq!(original.live_resources(), Default::default());

            let snapshot = original.snapshot_v2()?;
            assert!(snapshot.game.completed || snapshot.terminal.is_some());
            assert!(
                snapshot
                    .pending_presentations
                    .pending_barrier_ids
                    .is_empty()
            );
            assert!(snapshot.prepared_transaction.is_none());
            let (wire, _) = snapshot_wire(&snapshot)?;
            (wire, original.clone())
        };
        assert_eq!(uninterrupted.live_resources(), Default::default());
        let mut restored = restore_from_wire(&wire, content)?;
        assert_eq!(restored.live_resources(), Default::default());
        assert_kernel_observation_equal(&uninterrupted, &restored, "terminal-restore")?;

        let seat = seat(1)?;
        for (input, label) in [
            (
                raw_input(
                    seat,
                    RawInputEvent::KeyDown {
                        code: PhysicalKey::Space,
                        printable: false,
                        browser_repeat: false,
                        focus: InputFocus::Game,
                    },
                ),
                "terminal-space-down",
            ),
            (
                raw_input(
                    seat,
                    RawInputEvent::KeyUp {
                        code: PhysicalKey::Space,
                    },
                ),
                "terminal-space-up",
            ),
        ] {
            let effects = step_same_input(&mut uninterrupted, &mut restored, input, label)?;
            assert!(effects.is_empty(), "terminal kernel accepted {label}");
            assert_eq!(uninterrupted.live_resources(), Default::default());
            assert_eq!(restored.live_resources(), Default::default());
        }
        Ok(())
    }
}

mod live_coop_production {
    use std::collections::{BTreeMap, BTreeSet};
    use std::error::Error;
    use std::sync::Arc;

    use er_canonical::{canonicalize, content_digest};
    use er_content::pack::ContentPack;
    use er_kernel::snapshot::PhysicalInputSourceV2;
    use er_kernel::snapshot::RestorableKernelSnapshotV2;
    use er_kernel::{
        BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1,
    };
    use er_protocol::{
        AckStage, AuthorityEntryBody, AuthorityEntryKind, AuthorityLogConfig, AuthorityReceiptBody,
        AuthorityReplicaConfig, BackoffPolicy, FrameType, NetworkFrame, NetworkPayload,
        PeerBinding, ProposalLeaseConfig, ProposalMessage, RawFrame, RecoveryTransactionConfig,
    };
    use er_sim::snapshot::{
        FaultOperationV2, FrameCorruptionV2, PacketDispositionV2, PairDeterminismDigest,
        PairKernelTraceRecorder, PairOperationV2, QueuedPacketSnapshotV2,
        RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION, RestorablePacketKindV2, RestorablePairSnapshotV2,
    };
    use er_sim::{PairEndpoint, PairOperation, PairStep, SimulatedBattlePairConfig, SimulatedPair};
    use er_state::snapshot::GameState;
    use er_types::battle_command::{
        AcceptedBattleCommand, BattleCommand, BattleTargetSelection, CommandFrontierStatus,
        ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1, scripted_enemy_command_operation_id,
    };
    use er_types::battle_control::BattleControl;
    use er_types::battle_ids::{
        BattlePresentationEventId, BattleSide, CanonicalHexBytes, FieldSlot, MoveId, MoveSlotIndex,
        PartyIndex, TurnIndex,
    };
    use er_types::battle_ui::PresentationSettlementOutcome;
    use er_types::{
        ConnectionGeneration, FrameContext, GameButton, InputFocus, MembershipRevision,
        OperationId, PhysicalKey, RawInputEvent, RecoveryFenceState, SafeU53, SeatId, SessionId,
        TimeClass,
    };
    use serde::{Deserialize, Serialize, de::DeserializeOwned};
    use serde_json::Value;

    type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

    const M3_CONTINUATION_SUITE_SCHEMA_VERSION: u32 = 1;
    const M3_CONTINUATION_REPORT_SCHEMA_VERSION: u32 = 1;
    const M3_CONTINUATION_SUITE_ID: &str = "pokerogue-redux/m3/native-wasm-continuation/v1";
    const REQUIRED_CONTINUATION_BOUNDARIES: [&str; 10] = [
        "held-fight-before-keyup",
        "doubles-one-command-pending",
        "guest-proposal-delivery-pending",
        "turn-packet-delayed",
        "control-receipt-delayed",
        "replacement-menu-open",
        "recovery-fence-held",
        "blocking-presentation-pending",
        "terminal-before-teardown",
        "mixed-network-fault-queue",
    ];

    #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct M3ContinuationScenarioV1 {
        boundary_id: String,
        trace: er_sim::snapshot::PairKernelTraceV2,
    }

    #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct M3ContinuationSuiteV1 {
        schema_version: u32,
        suite_id: String,
        content_pack: ContentPack,
        scenarios: Vec<M3ContinuationScenarioV1>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize)]
    #[serde(deny_unknown_fields)]
    struct M3ContinuationScenarioReportV1 {
        boundary_id: String,
        trace_digest: String,
        initial_snapshot_digest: String,
        initial_pair_determinism_digest: PairDeterminismDigest,
        operation_count: SafeU53,
        replayed_operation_count: SafeU53,
        host_rng_draw_count: SafeU53,
        guest_rng_draw_count: SafeU53,
        final_entry_digest: String,
        final_pair_determinism_digest: PairDeterminismDigest,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize)]
    #[serde(deny_unknown_fields)]
    struct M3ContinuationReportV1 {
        schema_version: u32,
        suite_id: String,
        suite_digest: String,
        content_hash: String,
        scenario_count: SafeU53,
        scenarios: Vec<M3ContinuationScenarioReportV1>,
    }

    fn safe_len(length: usize, field: &str) -> TestResult<SafeU53> {
        SafeU53::new(u64::try_from(length)?)
            .map_err(|error| invalid(format!("{field} length is not JS-safe: {error}")))
    }

    impl M3ContinuationSuiteV1 {
        fn validate(&self) -> TestResult {
            if self.schema_version != M3_CONTINUATION_SUITE_SCHEMA_VERSION {
                return Err(invalid(format!(
                    "schema_version is {}, expected {}",
                    self.schema_version, M3_CONTINUATION_SUITE_SCHEMA_VERSION
                )));
            }
            if self.suite_id != M3_CONTINUATION_SUITE_ID {
                return Err(invalid(format!(
                    "suite_id is {:?}, expected {:?}",
                    self.suite_id, M3_CONTINUATION_SUITE_ID
                )));
            }
            self.content_pack.validate()?;
            if self.scenarios.len() != REQUIRED_CONTINUATION_BOUNDARIES.len() {
                return Err(invalid(format!(
                    "scenario count is {}, expected {}",
                    self.scenarios.len(),
                    REQUIRED_CONTINUATION_BOUNDARIES.len()
                )));
            }

            let mut seen = BTreeSet::new();
            for (index, (scenario, expected_id)) in self
                .scenarios
                .iter()
                .zip(REQUIRED_CONTINUATION_BOUNDARIES)
                .enumerate()
            {
                if scenario.boundary_id != expected_id {
                    return Err(invalid(format!(
                        "scenario {index} is {:?}, expected {expected_id:?}",
                        scenario.boundary_id
                    )));
                }
                if !seen.insert(scenario.boundary_id.as_str()) {
                    return Err(invalid(format!(
                        "duplicate boundary_id {:?}",
                        scenario.boundary_id
                    )));
                }
                scenario.trace.validate()?;
                if scenario.trace.entries.is_empty() {
                    return Err(invalid(format!(
                        "boundary {:?} has no continuation operations",
                        scenario.boundary_id
                    )));
                }
                let initial = &scenario.trace.initial_snapshot;
                if initial.host.content_hash != self.content_pack.hash
                    || initial.guest.content_hash != self.content_pack.hash
                {
                    return Err(invalid(format!(
                        "boundary {:?} content identity differs from the suite content pack",
                        scenario.boundary_id
                    )));
                }
            }
            Ok(())
        }
    }

    fn canonical_suite_json(suite: &M3ContinuationSuiteV1) -> TestResult<String> {
        suite.validate()?;
        Ok(canonicalize(suite)?)
    }

    fn parse_suite_json(input: &str) -> TestResult<M3ContinuationSuiteV1> {
        let suite: M3ContinuationSuiteV1 = serde_json::from_str(input)?;
        suite.validate()?;
        Ok(suite)
    }

    fn replay_suite(suite: &M3ContinuationSuiteV1) -> TestResult<M3ContinuationReportV1> {
        suite.validate()?;
        let content = Arc::new(suite.content_pack.clone());
        let mut scenarios = Vec::with_capacity(suite.scenarios.len());

        for scenario in &suite.scenarios {
            let replay = scenario.trace.replay_simulated_pair(Arc::clone(&content))?;
            if let Some(divergence) = replay.first_divergence {
                return Err(invalid(format!(
                    "M3 continuation diverged at {}, operation {}, time {} ms, path {}, code {}",
                    scenario.boundary_id,
                    divergence.sequence,
                    divergence.virtual_time_ms,
                    divergence.path,
                    divergence.code,
                )));
            }

            let final_entry = scenario.trace.entries.last().ok_or_else(|| {
                invalid(format!(
                    "boundary {:?} has no final entry",
                    scenario.boundary_id
                ))
            })?;
            let host_rng_draw_count = scenario
                .trace
                .entries
                .iter()
                .try_fold(0usize, |total, entry| {
                    total.checked_add(entry.host.rng_audit.len())
                })
                .ok_or_else(|| {
                    invalid(format!(
                        "boundary {:?} host RNG count overflowed",
                        scenario.boundary_id
                    ))
                })?;
            let guest_rng_draw_count = scenario
                .trace
                .entries
                .iter()
                .try_fold(0usize, |total, entry| {
                    total.checked_add(entry.guest.rng_audit.len())
                })
                .ok_or_else(|| {
                    invalid(format!(
                        "boundary {:?} guest RNG count overflowed",
                        scenario.boundary_id
                    ))
                })?;
            scenarios.push(M3ContinuationScenarioReportV1 {
                boundary_id: scenario.boundary_id.clone(),
                trace_digest: content_digest(&scenario.trace)?,
                initial_snapshot_digest: content_digest(&scenario.trace.initial_snapshot)?,
                initial_pair_determinism_digest: PairDeterminismDigest::compute(
                    &scenario.trace.initial_snapshot,
                )?,
                operation_count: safe_len(scenario.trace.entries.len(), "scenario operations")?,
                replayed_operation_count: replay.replayed_entries,
                host_rng_draw_count: safe_len(host_rng_draw_count, "host RNG draws")?,
                guest_rng_draw_count: safe_len(guest_rng_draw_count, "guest RNG draws")?,
                final_entry_digest: content_digest(final_entry)?,
                final_pair_determinism_digest: final_entry.pair_after.clone(),
            });
        }

        Ok(M3ContinuationReportV1 {
            schema_version: M3_CONTINUATION_REPORT_SCHEMA_VERSION,
            suite_id: suite.suite_id.clone(),
            suite_digest: content_digest(suite)?,
            content_hash: suite.content_pack.hash.to_string(),
            scenario_count: safe_len(scenarios.len(), "report scenarios")?,
            scenarios,
        })
    }

    fn replay_suite_json(input: &str) -> TestResult<String> {
        Ok(canonicalize(&replay_suite(&parse_suite_json(input)?)?)?)
    }

    const FORCED_REPLACEMENT_FIXTURE: &str =
        include_str!("../../../fixtures/m3/oracle/battle-cases/forced-replacement.json");
    const LEGACY_ORACLE_CONTENT_DIGEST: &str =
        "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
    const LEGACY_ORACLE_CONTENT_HASH: &str =
        "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

    fn invalid(message: impl Into<String>) -> Box<dyn std::error::Error> {
        std::io::Error::new(std::io::ErrorKind::InvalidData, message.into()).into()
    }

    fn normalize_nested_kind(object: &mut Value, path: &str, field_name: &str) -> TestResult {
        let object = object
            .as_object_mut()
            .ok_or_else(|| invalid(format!("{path} is not an object")))?;
        let kind = object
            .get(field_name)
            .cloned()
            .ok_or_else(|| invalid(format!("{path}.{field_name} is missing")))?;
        let normalized = match kind {
            Value::String(_) => kind,
            Value::Object(nested) => {
                if nested.len() != 1 || !nested.contains_key("kind") {
                    return Err(invalid(format!(
                        "{path}.{field_name} has an unsupported nested kind shape"
                    )));
                }
                let tag = nested
                    .get("kind")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid(format!("{path}.{field_name}.kind is not a string")))?;
                Value::String(tag.to_owned())
            }
            other => {
                return Err(invalid(format!(
                    "{path}.{field_name} has unsupported value {other}"
                )));
            }
        };
        object.insert(field_name.to_owned(), normalized);
        Ok(())
    }

    fn normalize_adjacent_kind(object: &mut Value, path: &str, field_name: &str) -> TestResult {
        let object = object
            .as_object_mut()
            .ok_or_else(|| invalid(format!("{path} is not an object")))?;
        let kind = object
            .get(field_name)
            .cloned()
            .ok_or_else(|| invalid(format!("{path}.{field_name} is missing")))?;
        let normalized = match kind {
            Value::String(tag) => serde_json::json!({"kind": tag}),
            Value::Object(nested) => Value::Object(nested),
            other => {
                return Err(invalid(format!(
                    "{path}.{field_name} has unsupported value {other}"
                )));
            }
        };
        let adjacent = normalized
            .as_object()
            .ok_or_else(|| invalid(format!("{path}.{field_name} is not an object")))?;
        let tag = adjacent
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid(format!("{path}.{field_name}.kind is not a string")))?;
        let valid_shape = match tag {
            "NONE" => adjacent.len() == 1,
            "UNSUPPORTED_ORACLE_CODE" => {
                adjacent.len() == 2
                    && adjacent
                        .get("value")
                        .and_then(Value::as_u64)
                        .is_some_and(|value| u16::try_from(value).is_ok())
            }
            _ => false,
        };
        if !valid_shape {
            return Err(invalid(format!(
                "{path}.{field_name} has an invalid adjacent kind object"
            )));
        }
        object.insert(field_name.to_owned(), normalized);
        Ok(())
    }

    fn normalize_legacy_type_chart(pack: &mut Value, selected: &ContentPack) -> TestResult {
        let chart = pack
            .get_mut("type_chart")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| invalid("published content type chart is invalid"))?;
        let entries = chart
            .get_mut("entries")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| invalid("published content type-chart entries are invalid"))?;
        let expected_entries = serde_json::to_value(&selected.type_chart.entries)?
            .as_array()
            .cloned()
            .ok_or_else(|| invalid("selected content type-chart entries are invalid"))?;
        if entries.len() != expected_entries.len() {
            return Err(invalid(format!(
                "published content type-chart entry count is {}, expected {}",
                entries.len(),
                expected_entries.len()
            )));
        }

        let legacy_entries = entries.clone();
        for (index, expected) in expected_entries.iter().enumerate() {
            if legacy_entries
                .iter()
                .filter(|entry| *entry == expected)
                .count()
                != 1
            {
                return Err(invalid(format!(
                    "published content type-chart does not contain selected entry at index {index}"
                )));
            }
        }
        *entries = expected_entries;
        Ok(())
    }

    pub(crate) fn normalize_legacy_content_pack(
        artifact: &mut Value,
        selected: &ContentPack,
    ) -> TestResult {
        selected.validate()?;
        let (provenance_hash, provenance_oracle_sha) = {
            let provenance = artifact
                .get("provenance")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid("published content artifact provenance is missing"))?;
            let hash = provenance
                .get("content_pack_hash")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("published content provenance hash is missing"))?;
            let oracle_sha = provenance
                .get("oracle_game_sha")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("published content provenance oracle SHA is missing"))?;
            (hash.to_owned(), oracle_sha.to_owned())
        };
        let (pack_hash, pack_oracle_sha) = {
            let pack = artifact
                .get("content_pack")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid("published content artifact content_pack is missing"))?;
            let hash = pack
                .get("hash")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("published content pack hash is missing"))?;
            let oracle_sha = pack
                .get("oracle_game_sha")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("published content pack oracle SHA is missing"))?;
            (hash.to_owned(), oracle_sha.to_owned())
        };
        if pack_hash != LEGACY_ORACLE_CONTENT_HASH
            || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
            || pack_oracle_sha != selected.oracle_game_sha
            || provenance_oracle_sha != selected.oracle_game_sha
        {
            return Err(invalid(
                "published content artifact is not the exact supported legacy identity",
            ));
        }

        let pack = artifact
            .get_mut("content_pack")
            .ok_or_else(|| invalid("published content artifact content_pack is missing"))?;
        normalize_legacy_type_chart(pack, selected)?;
        let manifest = pack
            .get_mut("capability_manifest")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| invalid("published content capability manifest is invalid"))?;
        let entries = manifest
            .get_mut("entries")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| invalid("published content capability entries are invalid"))?;
        for (index, entry) in entries.iter_mut().enumerate() {
            let subject = entry.get_mut("subject").ok_or_else(|| {
                invalid(format!(
                    "published content capability entry {index} subject is missing"
                ))
            })?;
            let subject_kind = subject
                .get("kind")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| {
                    invalid(format!(
                        "published content capability entry {index} subject kind is not a string"
                    ))
                })?;
            if matches!(subject_kind.as_str(), "WEATHER" | "TERRAIN") {
                normalize_adjacent_kind(
                    subject,
                    &format!("content_pack.capability_manifest.entries[{index}].subject"),
                    "value",
                )?;
            }
        }
        pack.as_object_mut()
            .ok_or_else(|| invalid("published content pack is not an object"))?
            .insert("hash".to_owned(), Value::String(selected.hash.to_string()));
        Ok(())
    }

    fn normalize_legacy_content_identity(
        document: &Value,
        state: &mut Value,
        content: &ContentPack,
    ) -> TestResult {
        let canonical = state
            .get_mut("canonical")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| invalid("initial_state.canonical is not an object"))?;
        let fixture_hash = canonical
            .get("content_hash")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("initial_state.canonical.content_hash is missing"))?
            .to_owned();
        let expected_hash = document
            .get("expected_final_state")
            .and_then(|value| value.get("canonical"))
            .and_then(|value| value.get("content_hash"))
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("expected_final_state.canonical.content_hash is missing"))?;
        if expected_hash != fixture_hash {
            return Err(invalid(
                "published state content hashes disagree between initial and expected final state",
            ));
        }
        let provenance = document
            .get("provenance")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("published fixture provenance is missing"))?;
        let provenance_hash = provenance
            .get("content_pack_hash")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("published fixture provenance hash is missing"))?;
        let provenance_oracle_sha = provenance
            .get("oracle_game_sha")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("published fixture provenance oracle SHA is missing"))?;
        if provenance_oracle_sha != content.oracle_game_sha {
            return Err(invalid(
                "published fixture provenance oracle SHA disagrees with selected content",
            ));
        }

        let selected = er_content::pack::selected_content_pack()?;
        let selected_hash = content.hash.as_str();
        let selected_digest = selected_hash
            .strip_prefix("blake3-v1:")
            .ok_or_else(|| invalid("selected content hash has no blake3-v1 prefix"))?;
        if fixture_hash == selected_hash {
            if content != &selected || provenance_hash != selected_digest {
                return Err(invalid(
                    "selected fixture content identity does not match the current selected content",
                ));
            }
            return Ok(());
        }
        if fixture_hash != LEGACY_ORACLE_CONTENT_HASH
            || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
            || content != &selected
        {
            return Err(invalid(
                "fixture content identity is neither the current selected pair nor the exact published legacy pair",
            ));
        }
        canonical.insert(
            "content_hash".to_owned(),
            Value::String(selected_hash.to_owned()),
        );
        Ok(())
    }

    fn normalize_legacy_initial_state(state: &mut Value) -> TestResult {
        let canonical = state
            .get_mut("canonical")
            .ok_or_else(|| invalid("initial_state.canonical is missing"))?;
        let battle = canonical
            .get_mut("battle")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| invalid("initial_state canonical battle value is invalid"))?;

        let format_slots = battle
            .get("format")
            .and_then(Value::as_object)
            .and_then(|format| format.get("slots"))
            .cloned()
            .ok_or_else(|| invalid("initial_state canonical battle format slots are missing"))?;
        let field_slots = battle
            .get("field")
            .and_then(Value::as_object)
            .and_then(|field| field.get("slots"))
            .cloned()
            .ok_or_else(|| invalid("initial_state canonical battle field slots are missing"))?;
        if !format_slots.is_array() || !field_slots.is_array() {
            return Err(invalid(
                "initial_state canonical format.slots and field.slots must be arrays",
            ));
        }
        if format_slots != field_slots {
            return Err(invalid(
                "initial_state canonical format.slots does not equal field.slots",
            ));
        }
        let format = battle
            .get_mut("format")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| invalid("initial_state canonical battle format is invalid"))?;
        if format.remove("slots").is_none() {
            return Err(invalid(
                "initial_state canonical battle format slots could not be removed",
            ));
        }

        for party_name in ["player_party", "enemy_party"] {
            let party = battle
                .get_mut(party_name)
                .and_then(Value::as_array_mut)
                .ok_or_else(|| {
                    invalid(format!(
                        "initial_state canonical battle {party_name} is invalid"
                    ))
                })?;
            for (index, pokemon) in party.iter_mut().enumerate() {
                let status = pokemon.get_mut("status").ok_or_else(|| {
                    invalid(format!(
                        "initial_state canonical battle {party_name}[{index}] status is missing"
                    ))
                })?;
                normalize_nested_kind(
                    status,
                    &format!("initial_state canonical battle {party_name}[{index}] status"),
                    "kind",
                )?;
            }
        }
        for condition_name in ["weather", "terrain"] {
            let condition = battle.get_mut(condition_name).ok_or_else(|| {
                invalid(format!(
                    "initial_state canonical battle {condition_name} is missing"
                ))
            })?;
            normalize_adjacent_kind(
                condition,
                &format!("initial_state canonical battle {condition_name}"),
                "kind",
            )?;
        }
        Ok(())
    }

    fn safe(value: u64) -> SafeU53 {
        SafeU53::new(value).unwrap_or(SafeU53::ZERO)
    }

    fn seat(value: u64) -> SeatId {
        SeatId::new(safe(value))
    }

    fn generation(value: u64) -> ConnectionGeneration {
        ConnectionGeneration::new(safe(value))
    }

    fn content_pack() -> TestResult<Arc<ContentPack>> {
        super::live_local_production::content_pack_for_pair()
    }

    fn context(
        sender_seat_id: SeatId,
        authority_seat_id: SeatId,
        connection_generation: ConnectionGeneration,
    ) -> TestResult<FrameContext> {
        Ok(FrameContext {
            session_id: SessionId::new("m3c11-live-pair-session")?,
            run_id: er_types::RunId::new("m3c11-live-pair-run")?,
            session_epoch: safe(1),
            seat_map_id: "m3c11-live-pair-seat-map".to_owned(),
            membership_revision: MembershipRevision::new(safe(1)),
            sender_seat_id,
            authority_seat_id,
            connection_generation,
        })
    }

    fn authority_protocol(
        host: SeatId,
        guest: SeatId,
        connection_generation: ConnectionGeneration,
    ) -> TestResult<BattleProtocolConfig> {
        Ok(BattleProtocolConfig {
            role: BattleProtocolRoleConfig::Authority {
                log: AuthorityLogConfig {
                    local_context: context(host, host, connection_generation)?,
                    peer_bindings: vec![PeerBinding {
                        seat_id: guest,
                        connection_generation,
                    }],
                    owner_id: "m3c11-live-pair:authority".to_owned(),
                    retain_capacity: safe(32),
                    delivery_backoff: BackoffPolicy {
                        initial_ms: safe(1),
                        maximum_ms: safe(64),
                        factor_numerator: safe(2),
                        factor_denominator: safe(1),
                    },
                    delivery_time_class: TimeClass::Connected,
                    max_delivery_attempts: Some(safe(8)),
                },
                proposal_capacity: safe(64),
            },
        })
    }

    fn replica_protocol(
        host: SeatId,
        guest: SeatId,
        connection_generation: ConnectionGeneration,
    ) -> TestResult<BattleProtocolConfig> {
        let guest_context = context(guest, host, connection_generation)?;
        Ok(BattleProtocolConfig {
            role: BattleProtocolRoleConfig::Replica {
                replica: AuthorityReplicaConfig {
                    receipt_context: guest_context.clone(),
                    authority_seat_id: host,
                    authority_connection_generation: connection_generation,
                },
                proposal_leases: ProposalLeaseConfig {
                    owner_prefix: "m3c11-live-pair:proposal:".to_owned(),
                    retry_initial_ms: safe(1),
                    retry_maximum_ms: safe(64),
                    absolute_ceiling_ms: safe(1_200_000),
                },
                recovery: RecoveryTransactionConfig {
                    local_context: guest_context,
                    request_timeout_ms: safe(300_000),
                    control_timeout_ms: safe(30_000),
                    pacing_ms: safe(16),
                    timer_owner_id: "m3c11-live-pair:recovery".to_owned(),
                },
            },
        })
    }

    fn forced_doubles_config() -> TestResult<BattleGameConfig> {
        let content = content_pack()?;
        forced_doubles_config_with_content(&content)
    }

    fn forced_doubles_config_with_content(content: &ContentPack) -> TestResult<BattleGameConfig> {
        let wire: Value = serde_json::from_str(FORCED_REPLACEMENT_FIXTURE)?;
        let mut initial_state = wire
            .get("initial_state")
            .cloned()
            .ok_or_else(|| invalid("forced-replacement fixture has no initial state"))?;
        normalize_legacy_initial_state(&mut initial_state)?;
        normalize_legacy_content_identity(&wire, &mut initial_state, content)?;
        let canonical = initial_state
            .get("canonical")
            .cloned()
            .ok_or_else(|| invalid("forced-replacement fixture has no initial canonical state"))?;
        let canonical_state: GameState = serde_json::from_value(canonical)?;
        let battle = canonical_state
            .battle
            .clone()
            .ok_or_else(|| invalid("forced-replacement fixture has no active battle"))?;
        if battle.format.player_capacity != 2 || battle.format.enemy_capacity != 2 {
            return Err(invalid(
                "forced-replacement fixture is not the required two-seat doubles topology",
            ));
        }

        let mut run_state = canonical_state.clone();
        run_state.battle = None;
        run_state.next_battle_id = battle.battle_id;

        let player_leads = (0..battle.format.player_capacity)
            .map(|position| -> TestResult<PartyIndex> {
                let slot = FieldSlot::new(BattleSide::Player, position)?;
                let pokemon_id = battle
                    .field
                    .occupant(&battle.format, slot)?
                    .ok_or_else(|| invalid(format!("player lead slot {position} is empty")))?;
                let party_index = battle
                    .player_party
                    .iter()
                    .position(|pokemon| pokemon.id == pokemon_id)
                    .ok_or_else(|| {
                        invalid(format!("player lead {pokemon_id} is not in the party"))
                    })?;
                Ok(PartyIndex::try_from(party_index as u64)?)
            })
            .collect::<TestResult<Vec<_>>>()?;
        let enemy_leads = (0..battle.format.enemy_capacity)
            .map(|position| -> TestResult<PartyIndex> {
                let slot = FieldSlot::new(BattleSide::Enemy, position)?;
                let pokemon_id = battle
                    .field
                    .occupant(&battle.format, slot)?
                    .ok_or_else(|| invalid(format!("enemy lead slot {position} is empty")))?;
                let party_index = battle
                    .enemy_party
                    .iter()
                    .position(|pokemon| pokemon.id == pokemon_id)
                    .ok_or_else(|| {
                        invalid(format!("enemy lead {pokemon_id} is not in the party"))
                    })?;
                Ok(PartyIndex::try_from(party_index as u64)?)
            })
            .collect::<TestResult<Vec<_>>>()?;

        let next_turn_value = battle
            .turn
            .get()
            .get()
            .checked_add(1)
            .ok_or_else(|| invalid("forced-replacement next turn overflowed"))?;
        let next_turn = TurnIndex::new(safe(next_turn_value))?;
        let mut scripted_commands = Vec::new();
        for (turn_offset, turn) in [battle.turn, next_turn].into_iter().enumerate() {
            for position in 0..battle.format.enemy_capacity {
                let field_slot = FieldSlot::new(BattleSide::Enemy, position)?;
                let actor = battle
                    .field
                    .occupant(&battle.format, field_slot)?
                    .ok_or_else(|| invalid(format!("enemy actor slot {position} is empty")))?;
                let target_position = position.min(battle.format.player_capacity.saturating_sub(1));
                let target = FieldSlot::new(BattleSide::Player, target_position)?;
                let command = BattleCommand::fight(
                    actor,
                    MoveSlotIndex::ZERO,
                    BattleTargetSelection::selected(vec![target])?,
                )?;
                let script_cursor = safe(
                    u64::try_from(turn_offset)? * u64::from(battle.format.enemy_capacity)
                        + u64::from(position),
                );
                let operation_id = scripted_enemy_command_operation_id(
                    battle.battle_id,
                    battle.wave,
                    turn,
                    field_slot,
                    script_cursor,
                )?;
                scripted_commands.push(ScriptedEnemyBattleCommandV1::new(
                    operation_id,
                    battle.battle_id,
                    battle.wave,
                    turn,
                    script_cursor,
                    actor,
                    field_slot,
                    command,
                )?);
            }
        }

        Ok(BattleGameConfig {
            run_state,
            start: BattleStartV1 {
                schema_version: 1,
                format: battle.format.clone(),
                player_party: battle.player_party.clone(),
                enemy_party: battle.enemy_party.clone(),
                player_leads,
                enemy_leads,
            },
            local_seat: seat(1),
            wave_seed: battle.wave_seed.clone(),
            scripted_enemy_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, scripted_commands)?,
        })
    }

    fn forced_victory_config() -> TestResult<BattleGameConfig> {
        let content = content_pack()?;
        forced_victory_config_with_content(&content)
    }

    fn forced_victory_config_with_content(content: &ContentPack) -> TestResult<BattleGameConfig> {
        let mut config = forced_doubles_config_with_content(content)?;
        let player_capacity = usize::from(config.start.format.player_capacity);
        let enemy_capacity = usize::from(config.start.format.enemy_capacity);
        let player_leads = config.start.player_leads.clone();
        if config.start.enemy_party.len() != enemy_capacity
            || config.start.enemy_leads.len() != enemy_capacity
        {
            return Err(invalid(
                "forced-victory fixture must have exactly the active enemy leads and no reserves",
            ));
        }
        if player_leads.len() != player_capacity
            || player_leads.iter().copied().collect::<BTreeSet<_>>().len() != player_capacity
        {
            return Err(invalid(
                "forced-victory fixture must have one distinct player lead per active slot",
            ));
        }

        let status_move = MoveId::try_from_u64(589)?;
        let damaging_move = MoveId::try_from_u64(1)?;
        for lead in player_leads {
            let party_index = usize::from(lead.get());
            let pokemon = config
                .start
                .player_party
                .get_mut(party_index)
                .ok_or_else(|| {
                    invalid(format!(
                        "forced-victory player lead {} is outside the party",
                        lead.get()
                    ))
                })?;
            let first_move = pokemon.moves[0].map(|slot| slot.move_id);
            let second_move = pokemon.moves[1].map(|slot| slot.move_id);
            if first_move != Some(status_move) || second_move != Some(damaging_move) {
                return Err(invalid(format!(
                    "forced-victory player lead {} must retain fixture moves 589 then 1",
                    lead.get()
                )));
            }
            pokemon.moves.swap(0, 1);
        }
        for pokemon in &mut config.start.enemy_party {
            pokemon.hp = 1;
            pokemon.fainted = false;
        }
        Ok(config)
    }

    fn new_battle_pair(
        game: BattleGameConfig,
        content: Arc<ContentPack>,
        replay_seed: u64,
    ) -> TestResult<SimulatedPair> {
        let host = seat(1);
        let guest = seat(2);
        let mut host_game = game.clone();
        host_game.local_seat = host;
        let mut guest_game = game;
        guest_game.local_seat = guest;
        let mut pair = SimulatedPair::new_battle(SimulatedBattlePairConfig {
            host_game,
            host_protocol: authority_protocol(host, guest, generation(1))?,
            guest_game,
            guest_protocol: replica_protocol(host, guest, generation(1))?,
            content,
            replay_seed,
            initial_storage: BTreeMap::new(),
        })?;
        // Battle protocol construction starts at generation one, while the
        // simulated transport starts at zero. Establish the connected
        // generation before any trace operation takes its pre-operation
        // snapshot; this bootstrap is fixture setup, not continuation input.
        pair.apply(PairOperation::Reconnect {
            endpoint: PairEndpoint::Host,
        })?;
        Ok(pair)
    }

    fn snapshot_wire(pair: &SimulatedPair) -> TestResult<String> {
        let snapshot = pair.snapshot_v2()?;
        assert_eq!(
            snapshot.schema_version,
            RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION
        );
        assert!(snapshot.host.prepared_transaction.is_none());
        assert!(snapshot.guest.prepared_transaction.is_none());
        snapshot.validate()?;
        let digest = PairDeterminismDigest::compute(&snapshot)?;
        let wire = serde_json::to_string(&snapshot)?;
        let value: Value = serde_json::from_str(&wire)?;
        assert_eq!(
            value.get("schema_version").and_then(Value::as_u64),
            Some(u64::from(RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION))
        );
        let decoded: RestorablePairSnapshotV2 = serde_json::from_str(&wire)?;
        decoded.validate()?;
        assert_eq!(
            serde_json::to_vec(&snapshot)?,
            serde_json::to_vec(&decoded)?,
            "complete V2 snapshot JSON changed during its wire round trip",
        );
        assert_eq!(
            digest,
            PairDeterminismDigest::compute(&decoded)?,
            "pair determinism digest changed during its wire round trip",
        );
        Ok(wire)
    }

    fn restore_from_wire(wire: &str, content: Arc<ContentPack>) -> TestResult<SimulatedPair> {
        let snapshot: RestorablePairSnapshotV2 = serde_json::from_str(wire)?;
        snapshot.validate()?;
        Ok(SimulatedPair::from_snapshot_v2(snapshot, content)?)
    }

    fn destroy_and_restore(
        pair: SimulatedPair,
        content: Arc<ContentPack>,
    ) -> TestResult<SimulatedPair> {
        let wire = snapshot_wire(&pair)?;
        drop(pair);
        restore_from_wire(&wire, content)
    }

    fn assert_pair_observation_equal(
        left: &SimulatedPair,
        right: &SimulatedPair,
        label: &str,
    ) -> TestResult {
        let left_legacy = left.snapshot()?;
        let right_legacy = right.snapshot()?;
        assert_eq!(
            serde_json::to_vec(&left_legacy)?,
            serde_json::to_vec(&right_legacy)?,
            "ordered legacy pair snapshot bytes diverged after {label}",
        );

        let left_v2 = left.snapshot_v2()?;
        let right_v2 = right.snapshot_v2()?;
        left_v2.validate()?;
        right_v2.validate()?;
        assert_eq!(
            serde_json::to_vec(&left_v2)?,
            serde_json::to_vec(&right_v2)?,
            "complete V2 snapshot bytes diverged after {label}",
        );
        assert_eq!(
            PairDeterminismDigest::compute(&left_v2)?,
            PairDeterminismDigest::compute(&right_v2)?,
            "pair determinism digest diverged after {label}",
        );
        assert_eq!(
            left_v2.host.mechanical_digest, right_v2.host.mechanical_digest,
            "host mechanical digest diverged after {label}",
        );
        assert_eq!(
            left_v2.guest.mechanical_digest, right_v2.guest.mechanical_digest,
            "guest mechanical digest diverged after {label}",
        );
        assert_eq!(
            left_v2.host.kernel_determinism_digest, right_v2.host.kernel_determinism_digest,
            "host kernel digest diverged after {label}",
        );
        assert_eq!(
            left_v2.guest.kernel_determinism_digest, right_v2.guest.kernel_determinism_digest,
            "guest kernel digest diverged after {label}",
        );
        Ok(())
    }

    fn apply_same(
        left: &mut SimulatedPair,
        right: &mut SimulatedPair,
        operation: PairOperation,
        label: &str,
    ) -> TestResult<PairStep> {
        let left_step = left.apply(operation.clone()).map_err(|error| {
            invalid(format!(
                "{label}: uninterrupted pair operation failed: {error}"
            ))
        })?;
        let right_step = right.apply(operation).map_err(|error| {
            invalid(format!("{label}: restored pair operation failed: {error}"))
        })?;
        assert_eq!(
            serde_json::to_vec(&left_step.generated_effects)?,
            serde_json::to_vec(&right_step.generated_effects)?,
            "ordered generated effects diverged after {label}",
        );
        assert_eq!(
            left_step.effects_digest, right_step.effects_digest,
            "effects digest diverged after {label}",
        );
        assert_eq!(
            serde_json::to_vec(&left_step.snapshot)?,
            serde_json::to_vec(&right_step.snapshot)?,
            "PairStep snapshot bytes diverged after {label}",
        );
        assert_pair_observation_equal(left, right, label)?;
        Ok(left_step)
    }

    fn raw_key_down(endpoint: PairEndpoint, code: PhysicalKey) -> PairOperation {
        PairOperation::RawInput {
            endpoint,
            event: RawInputEvent::KeyDown {
                code,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
        }
    }

    fn raw_key_up(endpoint: PairEndpoint, code: PhysicalKey) -> PairOperation {
        PairOperation::RawInput {
            endpoint,
            event: RawInputEvent::KeyUp { code },
        }
    }

    fn press_same(
        left: &mut SimulatedPair,
        right: &mut SimulatedPair,
        endpoint: PairEndpoint,
        code: PhysicalKey,
        label: &str,
    ) -> TestResult {
        apply_same(left, right, raw_key_down(endpoint, code.clone()), label)?;
        apply_same(left, right, raw_key_up(endpoint, code), label)?;
        Ok(())
    }

    fn advance_same(
        left: &mut SimulatedPair,
        right: &mut SimulatedPair,
        delta_ms: u64,
        label: &str,
    ) -> TestResult {
        apply_same(
            left,
            right,
            PairOperation::AdvanceTime {
                delta_ms: safe(delta_ms),
            },
            label,
        )?;
        Ok(())
    }

    fn endpoint_snapshot(
        snapshot: &RestorablePairSnapshotV2,
        endpoint: PairEndpoint,
    ) -> &RestorableKernelSnapshotV2 {
        match endpoint {
            PairEndpoint::Host => &snapshot.host,
            PairEndpoint::Guest => &snapshot.guest,
        }
    }

    fn held_button(
        snapshot: &RestorablePairSnapshotV2,
        endpoint: PairEndpoint,
        button: GameButton,
        key: PhysicalKey,
    ) -> bool {
        let endpoint_snapshot = endpoint_snapshot(snapshot, endpoint);
        endpoint_snapshot
            .input_router
            .held_buttons
            .iter()
            .any(|held| {
                held.seat == endpoint_snapshot.runtime_identity.local_seat
                    && held.button == button
                    && held.source == PhysicalInputSourceV2::Keyboard(key.clone())
            })
    }

    fn driver_key_down(
        snapshot: &RestorablePairSnapshotV2,
        endpoint: PairEndpoint,
        key: PhysicalKey,
    ) -> bool {
        let driver = match endpoint {
            PairEndpoint::Host => &snapshot.host_driver,
            PairEndpoint::Guest => &snapshot.guest_driver,
        };
        driver.pressed_keys.iter().any(|pressed| pressed == &key)
    }

    fn fight_status(status: &CommandFrontierStatus) -> bool {
        match status {
            CommandFrontierStatus::Retained { command, .. }
            | CommandFrontierStatus::Admitted { command, .. } => match command {
                AcceptedBattleCommand::Human { proposal, .. } => {
                    matches!(&proposal.command, BattleCommand::Fight { .. })
                }
                AcceptedBattleCommand::ScriptedEnemy { .. } => false,
            },
            CommandFrontierStatus::Pending => false,
        }
    }

    fn endpoint_has_fight(snapshot: &RestorablePairSnapshotV2, endpoint: PairEndpoint) -> bool {
        let owner = endpoint_snapshot(snapshot, endpoint)
            .runtime_identity
            .local_seat;
        endpoint_snapshot(snapshot, PairEndpoint::Host)
            .game
            .state
            .battle
            .as_ref()
            .map(|battle| {
                battle
                    .command_state
                    .frontier
                    .iter()
                    .any(|entry| entry.owner_seat == Some(owner) && fight_status(&entry.status))
            })
            .unwrap_or(false)
    }

    fn endpoint_commands_complete(
        snapshot: &RestorablePairSnapshotV2,
        endpoint: PairEndpoint,
    ) -> bool {
        let owner = endpoint_snapshot(snapshot, endpoint)
            .runtime_identity
            .local_seat;
        let mut found = false;
        // A replica retains its own proposal before the authority receives it,
        // so completion is endpoint-local until the corresponding wire packet
        // is delivered.  Inspect the runtime being driven rather than the
        // authority's potentially stale frontier.
        let Some(battle) = endpoint_snapshot(snapshot, endpoint)
            .game
            .state
            .battle
            .as_ref()
        else {
            return false;
        };
        for entry in &battle.command_state.frontier {
            if entry.owner_seat == Some(owner) {
                found = true;
                if matches!(entry.status, CommandFrontierStatus::Pending) {
                    return false;
                }
            }
        }
        found
    }

    fn one_doubles_command_pending(snapshot: &RestorablePairSnapshotV2) -> bool {
        let Some(battle) = snapshot.host.game.state.battle.as_ref() else {
            return false;
        };
        let host_done = battle
            .command_state
            .frontier
            .iter()
            .any(|entry| entry.owner_seat == Some(seat(1)) && fight_status(&entry.status));
        let guest_pending = battle.command_state.frontier.iter().any(|entry| {
            entry.owner_seat == Some(seat(2))
                && matches!(entry.status, CommandFrontierStatus::Pending)
        });
        host_done && guest_pending
    }

    fn guest_proposal_pending(snapshot: &RestorablePairSnapshotV2) -> bool {
        let lease_live = snapshot
            .guest
            .protocol
            .proposal_leases
            .as_ref()
            .is_some_and(|leases| !leases.leases.is_empty() && !leases.timer_targets.is_empty());
        let packet_queued = snapshot.network.packets.iter().any(|packet| {
            packet.source == PairEndpoint::Guest
                && matches!(packet.kind, RestorablePacketKindV2::CommandProposal)
        });
        lease_live && packet_queued
    }

    fn proposal_result_packet_matches(
        packet: &QueuedPacketSnapshotV2,
        expected_operation_id: &OperationId,
        expected_fingerprint: &str,
    ) -> bool {
        if packet.kind != RestorablePacketKindV2::AuthorityFrame {
            return false;
        }
        let Ok(frame) =
            decode_canonical_network_frame_packet(&packet.body, "proposal result authority frame")
        else {
            return false;
        };
        if frame.frame_type != FrameType::AuthorityEntry
            || frame.context.connection_generation != generation(1)
        {
            return false;
        }
        let Ok(entry) = serde_json::from_value::<AuthorityEntryBody>(frame.body) else {
            return false;
        };
        if entry.kind != AuthorityEntryKind::TurnCommit {
            return false;
        }
        let Ok(material) = serde_json::from_value::<er_game::material::BattleTurnMaterialV1>(
            entry.material.payload.clone(),
        ) else {
            return false;
        };
        if material.commands.validate().is_err() {
            return false;
        }
        let Ok(turn_result_operation_id) = er_types::battle_command::turn_result_operation_id(
            material.battle_id,
            material.wave,
            material.resolved_turn,
        ) else {
            return false;
        };
        turn_result_operation_id != *expected_operation_id
            && entry.operation_id == turn_result_operation_id
            && material.operation_id == turn_result_operation_id
            && material
                .commands
                .entries
                .iter()
                .filter(|command| {
                    matches!(
                        command,
                        AcceptedBattleCommand::Human {
                            proposal,
                            fingerprint,
                        } if &proposal.operation_id == expected_operation_id
                            && fingerprint.as_str() == expected_fingerprint
                            && proposal.fingerprint().as_str() == expected_fingerprint
                    )
                })
                .count()
                == 1
    }

    fn guest_proposal_admitted_with_delivery_pending(
        snapshot: &RestorablePairSnapshotV2,
        expected_operation_id: &OperationId,
        expected_fingerprint: &str,
    ) -> TestResult<bool> {
        let Some(admission) = snapshot.host.protocol.proposal_admission.as_ref() else {
            return Ok(false);
        };
        let admission_matches = admission
            .fingerprints
            .iter()
            .filter(|entry| {
                entry.operation_id == *expected_operation_id
                    && entry.fingerprint == expected_fingerprint
            })
            .count()
            == 1;
        if !admission_matches {
            return Ok(false);
        }

        let Some(leases) = snapshot.guest.protocol.proposal_leases.as_ref() else {
            return Ok(false);
        };
        let Some(lease) = leases
            .leases
            .iter()
            .find(|lease| lease.operation_id == *expected_operation_id)
        else {
            return Ok(false);
        };
        if !leases
            .timer_targets
            .iter()
            .any(|target| target.operation_id == *expected_operation_id)
        {
            return Ok(false);
        }
        let proposal: ProposalMessage = match decode_canonical_packet(
            &lease.proposal.canonical_envelope_bytes,
            "proposal lease envelope",
        ) {
            Ok(proposal) => proposal,
            Err(_) => return Ok(false),
        };
        if lease.proposal.operation_id != *expected_operation_id
            || proposal.operation_id != *expected_operation_id
            || proposal.fingerprint != expected_fingerprint
        {
            return Ok(false);
        }

        let result_packet_matches = snapshot.network.packets.iter().any(|packet| {
            packet.source == PairEndpoint::Host
                && packet.destination == PairEndpoint::Guest
                && packet.source_generation == generation(1)
                && packet.destination_generation == generation(1)
                && packet.kind == RestorablePacketKindV2::AuthorityFrame
                && proposal_result_packet_matches(
                    packet,
                    expected_operation_id,
                    expected_fingerprint,
                )
        });
        Ok(result_packet_matches)
    }

    fn host_admission_with_blocking_presentation(snapshot: &RestorablePairSnapshotV2) -> bool {
        let admission_live = snapshot
            .host
            .protocol
            .proposal_admission
            .as_ref()
            .is_some_and(|admission| !admission.fingerprints.is_empty());
        admission_live
            && !snapshot
                .host
                .pending_presentations
                .blocking_barrier_ids
                .is_empty()
    }

    fn replacement_menu_open(snapshot: &RestorablePairSnapshotV2) -> bool {
        snapshot.host.ui.actionable
            && matches!(
                &snapshot.host.ui.seat_control.control,
                BattleControl::ReplacementSelect(_)
            )
    }

    fn terminal_reached(snapshot: &RestorablePairSnapshotV2) -> bool {
        snapshot.host.terminal.is_some()
            && snapshot.guest.terminal.is_some()
            && snapshot.host.disposed
            && snapshot.guest.disposed
    }

    fn pending_battle_presentations(
        snapshot: &RestorablePairSnapshotV2,
    ) -> Vec<(PairEndpoint, BattlePresentationEventId)> {
        let mut pending = Vec::new();
        for (endpoint, endpoint_snapshot) in [
            (PairEndpoint::Host, &snapshot.host),
            (PairEndpoint::Guest, &snapshot.guest),
        ] {
            pending.extend(
                endpoint_snapshot
                    .pending_presentations
                    .pending_barrier_ids
                    .iter()
                    .cloned()
                    .map(|event_id| (endpoint, event_id)),
            );
        }
        pending
    }

    fn settle_all_presentations(left: &mut SimulatedPair, right: &mut SimulatedPair) -> TestResult {
        for _ in 0..64 {
            let snapshot = left.snapshot_v2()?;
            let pending = pending_battle_presentations(&snapshot);
            if pending.is_empty() {
                return Ok(());
            }
            for (endpoint, event_id) in pending {
                apply_same(
                    left,
                    right,
                    PairOperation::BattlePresentationOutcome {
                        endpoint,
                        event_id,
                        outcome: PresentationSettlementOutcome::Settled,
                    },
                    "presentation-settlement",
                )?;
            }
        }
        Err(invalid(
            "presentation settlement exceeded the deterministic boundary bound",
        ))
    }

    fn selected_content_pack_for_continuation() -> TestResult<Arc<ContentPack>> {
        Ok(Arc::new(er_content::pack::selected_content_pack()?))
    }

    fn apply_trace_operation(pair: &mut SimulatedPair, operation: PairOperationV2) -> TestResult {
        let _observation = pair.apply_trace_operation_v2(operation)?;
        Ok(())
    }

    fn raw_key_down_v2(endpoint: PairEndpoint, code: PhysicalKey) -> PairOperationV2 {
        PairOperationV2::RawInput {
            endpoint,
            event: RawInputEvent::KeyDown {
                code,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
        }
    }

    fn raw_key_up_v2(endpoint: PairEndpoint, code: PhysicalKey) -> PairOperationV2 {
        PairOperationV2::RawInput {
            endpoint,
            event: RawInputEvent::KeyUp { code },
        }
    }

    fn raw_press_v2(
        pair: &mut SimulatedPair,
        endpoint: PairEndpoint,
        code: PhysicalKey,
    ) -> TestResult {
        apply_trace_operation(pair, raw_key_down_v2(endpoint, code.clone()))?;
        apply_trace_operation(pair, raw_key_up_v2(endpoint, code))?;
        Ok(())
    }

    fn advance_time_v2(pair: &mut SimulatedPair, delta_ms: u64) -> TestResult {
        apply_trace_operation(
            pair,
            PairOperationV2::AdvanceTime {
                delta_ms: safe(delta_ms),
            },
        )
    }

    fn prime_trace_pair(pair: &mut SimulatedPair) -> TestResult {
        // `new_battle_pair` establishes generation one before trace capture.
        for endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            for _ in 0..3 {
                raw_press_v2(pair, endpoint, PhysicalKey::Enter)?;
            }
        }
        Ok(())
    }

    fn reach_one_doubles_command_pending(pair: &mut SimulatedPair) -> TestResult {
        for attempt in 0..8 {
            if one_doubles_command_pending(&pair.snapshot_v2()?) {
                return Ok(());
            }
            raw_press_v2(pair, PairEndpoint::Host, PhysicalKey::Enter)?;
            if attempt == 7 {
                break;
            }
        }
        Err(invalid(
            "raw physical host input did not expose the doubles one-command-pending boundary",
        ))
    }

    fn reach_guest_proposal_pending(pair: &mut SimulatedPair) -> TestResult {
        reach_one_doubles_command_pending(pair)?;
        for _ in 0..8 {
            if guest_proposal_pending(&pair.snapshot_v2()?) {
                return Ok(());
            }
            raw_press_v2(pair, PairEndpoint::Guest, PhysicalKey::Enter)?;
        }
        Err(invalid(
            "raw physical guest input did not expose the proposal-delivery-pending boundary",
        ))
    }

    fn reach_guest_proposal_admitted_with_delivery_pending(
        pair: &mut SimulatedPair,
    ) -> TestResult<(OperationId, String)> {
        reach_guest_proposal_pending(pair)?;
        let proposal_packet = first_packet_v2(
            &pair.snapshot_v2()?,
            RestorablePacketKindV2::CommandProposal,
            PairEndpoint::Guest,
            PairEndpoint::Host,
            generation(1),
        )?;
        let proposal = decode_canonical_proposal_packet(&proposal_packet.body, "guest proposal")?;
        let proposal_identity = (proposal.operation_id.clone(), proposal.fingerprint.clone());
        apply_trace_operation(
            pair,
            PairOperationV2::Fault {
                operation: FaultOperationV2::Deliver {
                    packet_id: proposal_packet.packet_id,
                },
            },
        )?;
        for tick in 0..128 {
            let snapshot = pair.snapshot_v2()?;
            if guest_proposal_admitted_with_delivery_pending(
                &snapshot,
                &proposal_identity.0,
                &proposal_identity.1,
            )? {
                return Ok(proposal_identity);
            }
            if pending_battle_presentations(&snapshot).is_empty() {
                advance_time_v2(pair, 1)?;
            } else {
                settle_all_presentations_v2(pair)?;
            }
            if tick == 127 {
                break;
            }
        }
        Err(invalid(
            "guest proposal was not admitted with its canonical Authority TURN delivery pending",
        ))
    }

    fn settle_all_presentations_v2(pair: &mut SimulatedPair) -> TestResult {
        for _ in 0..64 {
            let pending = pending_battle_presentations(&pair.snapshot_v2()?);
            if pending.is_empty() {
                return Ok(());
            }
            for (endpoint, event_id) in pending {
                apply_trace_operation(
                    pair,
                    PairOperationV2::BattlePresentationOutcome {
                        endpoint,
                        event_id,
                        outcome: PresentationSettlementOutcome::Settled,
                    },
                )?;
            }
        }
        Err(invalid(
            "V2 presentation settlement exceeded the deterministic boundary bound",
        ))
    }

    fn reach_replacement_menu_open(pair: &mut SimulatedPair) -> TestResult {
        reach_guest_proposal_pending(pair)?;
        for tick in 0..256 {
            let snapshot = pair.snapshot_v2()?;
            if replacement_menu_open(&snapshot) {
                return Ok(());
            }
            if pending_battle_presentations(&snapshot).is_empty() {
                advance_time_v2(pair, 1)?;
            } else {
                settle_all_presentations_v2(pair)?;
            }
            if tick == 255 {
                break;
            }
        }
        Err(invalid(
            "raw production pair did not expose the replacement-menu-open boundary",
        ))
    }

    fn reach_blocking_presentation_pending(pair: &mut SimulatedPair) -> TestResult {
        reach_guest_proposal_pending(pair)?;
        for tick in 0..128 {
            if host_admission_with_blocking_presentation(&pair.snapshot_v2()?) {
                return Ok(());
            }
            advance_time_v2(pair, 1)?;
            if tick == 127 {
                break;
            }
        }
        Err(invalid(
            "raw production pair did not expose the blocking-presentation boundary",
        ))
    }

    fn decode_canonical_packet<T>(body: &CanonicalHexBytes, field: &str) -> TestResult<T>
    where
        T: DeserializeOwned + Serialize,
    {
        let encoded = body.as_str().as_bytes();
        if !encoded.len().is_multiple_of(2) {
            return Err(invalid(format!("{field} has an odd-length hex payload")));
        }
        let bytes = encoded
            .chunks_exact(2)
            .map(|pair| {
                let high = match pair[0] {
                    b'0'..=b'9' => pair[0] - b'0',
                    b'a'..=b'f' => pair[0] - b'a' + 10,
                    _ => return Err(invalid(format!("{field} has invalid hex"))),
                };
                let low = match pair[1] {
                    b'0'..=b'9' => pair[1] - b'0',
                    b'a'..=b'f' => pair[1] - b'a' + 10,
                    _ => return Err(invalid(format!("{field} has invalid hex"))),
                };
                Ok((high << 4) | low)
            })
            .collect::<TestResult<Vec<_>>>()?;
        let decoded = serde_json::from_slice::<T>(&bytes)?;
        let recanonical = er_canonical::canonical_bytes(&decoded)?;
        if recanonical != bytes {
            return Err(invalid(format!("{field} is not canonical JSON")));
        }
        Ok(decoded)
    }

    fn decode_canonical_proposal_packet(
        body: &CanonicalHexBytes,
        field: &str,
    ) -> TestResult<ProposalMessage> {
        match decode_canonical_packet::<NetworkPayload>(body, field)? {
            NetworkPayload::Proposal(proposal) => Ok(proposal),
            NetworkPayload::Frame(_) => Err(invalid(format!(
                "{field} carried a frame payload instead of a proposal envelope"
            ))),
        }
    }

    fn decode_canonical_frame_packet_value(
        body: &CanonicalHexBytes,
        field: &str,
    ) -> TestResult<Value> {
        match decode_canonical_packet::<NetworkPayload>(body, field)? {
            NetworkPayload::Frame(RawFrame::JsonValue(value)) => Ok(value),
            NetworkPayload::Frame(RawFrame::JsonText(text)) => Ok(serde_json::from_str(&text)?),
            NetworkPayload::Proposal(_) => Err(invalid(format!(
                "{field} carried a proposal payload instead of a raw frame"
            ))),
        }
    }

    fn decode_canonical_network_frame_packet(
        body: &CanonicalHexBytes,
        field: &str,
    ) -> TestResult<NetworkFrame> {
        let value = decode_canonical_frame_packet_value(body, field)?;
        Ok(serde_json::from_value(value)?)
    }

    fn is_guest_host_generation_one_control_receipt(packet: &QueuedPacketSnapshotV2) -> bool {
        packet.kind == RestorablePacketKindV2::ControlReceipt
            && packet.source == PairEndpoint::Guest
            && packet.destination == PairEndpoint::Host
            && packet.source_generation == generation(1)
            && packet.destination_generation == generation(1)
    }

    fn is_guest_host_generation_one_control_installed_receipt(
        packet: &QueuedPacketSnapshotV2,
    ) -> bool {
        if !is_guest_host_generation_one_control_receipt(packet) {
            return false;
        }
        let Ok(frame) =
            decode_canonical_network_frame_packet(&packet.body, "control-installed receipt")
        else {
            return false;
        };
        if frame.frame_type != FrameType::AuthorityReceipt {
            return false;
        }
        match serde_json::from_value::<AuthorityReceiptBody>(frame.body) {
            Ok(receipt) => receipt.stage == AckStage::ControlInstalled,
            Err(_) => false,
        }
    }

    fn first_packet_v2(
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

    fn last_packet_v2(
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

    fn packets_with_body_v2(
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
                    && packet.body.as_str() == body.as_str()
            })
            .cloned()
            .collect()
    }

    fn recovery_fence_held(
        snapshot: &RestorablePairSnapshotV2,
        stale_receipt_id: SafeU53,
        stale_receipt_body: &CanonicalHexBytes,
    ) -> bool {
        let Some(guest_generation) = snapshot
            .network
            .links
            .iter()
            .find(|link| link.endpoint == PairEndpoint::Guest)
            .map(|link| link.generation)
        else {
            return false;
        };
        if guest_generation != generation(2) {
            return false;
        }
        let Some(recovery) = snapshot.guest.protocol.recovery.as_ref() else {
            return false;
        };
        let Some(replica) = snapshot.guest.protocol.authority_replica.as_ref() else {
            return false;
        };
        let Some(captured_frontier) = recovery.captured_frontier else {
            return false;
        };
        let Some(captured_state) = recovery.captured_state else {
            return false;
        };
        let local_context = &recovery.config.local_context;
        let expected_request_id = format!(
            "m3-recovery/rebind/{}/{}/{}/{}",
            local_context.sender_seat_id,
            local_context.connection_generation.get().get(),
            replica.authority_generation.get().get(),
            captured_state.control,
        );
        if recovery.fence.state != RecoveryFenceState::Held
            || recovery.phase.is_none()
            || recovery.request_id.as_deref() != Some(expected_request_id.as_str())
            || captured_frontier != captured_state.control
            || captured_state != replica.frontier
            || replica.authority_generation != generation(2)
            || snapshot.guest.protocol.frame_context.context != *local_context
            || replica.receipt_context != *local_context
            || local_context.connection_generation != generation(2)
        {
            return false;
        }

        let stale_receipts = snapshot
            .network
            .packets
            .iter()
            .filter(|packet| {
                is_guest_host_generation_one_control_receipt(packet)
                    && packet.packet_id == stale_receipt_id
                    && packet.body.as_str() == stale_receipt_body.as_str()
                    && packet.disposition == PacketDispositionV2::Delayed
            })
            .collect::<Vec<_>>();
        stale_receipts.len() == 1
    }

    fn mixed_fault_queue(
        snapshot: &RestorablePairSnapshotV2,
        stale_packet_ids: [SafeU53; 2],
        corrupted_body: &CanonicalHexBytes,
    ) -> bool {
        let Some(guest_generation) = snapshot
            .network
            .links
            .iter()
            .find(|link| link.endpoint == PairEndpoint::Guest)
            .map(|link| link.generation)
        else {
            return false;
        };
        if guest_generation != generation(2) {
            return false;
        }
        let expected_ids = stale_packet_ids.into_iter().collect::<BTreeSet<_>>();
        if expected_ids.len() != 2 {
            return false;
        }
        let packets = snapshot
            .network
            .packets
            .iter()
            .filter(|packet| {
                is_guest_host_generation_one_control_receipt(packet)
                    && packet.disposition == PacketDispositionV2::Delayed
                    && packet.body.as_str() == corrupted_body.as_str()
            })
            .collect::<Vec<_>>();
        let actual_ids = packets
            .iter()
            .map(|packet| packet.packet_id)
            .collect::<BTreeSet<_>>();
        packets.len() == 2 && actual_ids == expected_ids
    }

    fn control_receipt_delayed_with_installed_control(
        pair: &SimulatedPair,
        snapshot: &RestorablePairSnapshotV2,
        receipt_id: SafeU53,
    ) -> TestResult<bool> {
        let Some(receipt) = snapshot.network.packets.iter().find(|packet| {
            packet.packet_id == receipt_id
                && is_guest_host_generation_one_control_receipt(packet)
                && packet.disposition == PacketDispositionV2::Delayed
        }) else {
            return Ok(false);
        };
        if receipt.delivery_deadline_ms <= receipt.enqueued_at_ms {
            return Ok(false);
        }
        let Some(replica) = snapshot.guest.protocol.authority_replica.as_ref() else {
            return Ok(false);
        };
        let Some(recovery) = snapshot.guest.protocol.recovery.as_ref() else {
            return Ok(false);
        };
        let frame: NetworkFrame =
            match decode_canonical_network_frame_packet(&receipt.body, "delayed control receipt") {
                Ok(frame) => frame,
                Err(_) => return Ok(false),
            };
        if frame.version != 2
            || frame.frame_type != FrameType::AuthorityReceipt
            || frame.context != replica.receipt_context
            || frame.context != snapshot.guest.protocol.frame_context.context
            || frame.context != recovery.config.local_context
            || frame.context.connection_generation != generation(1)
        {
            return Ok(false);
        }
        let receipt_body: AuthorityReceiptBody = match serde_json::from_value(frame.body) {
            Ok(body) => body,
            Err(_) => return Ok(false),
        };
        if receipt_body.stage != AckStage::ControlInstalled {
            return Ok(false);
        }
        let Some(receipt_control_id) = receipt_body.control_id.as_deref() else {
            return Ok(false);
        };
        let Some(installed) = replica.installed_controls.iter().find(|control| {
            control.revision == receipt_body.revision
                && control.identity.operation_id == receipt_body.operation_id
                && control.control_id.as_str() == receipt_control_id
        }) else {
            return Ok(false);
        };
        if installed.identity.revision != installed.revision
            || installed.identity.next_control_id.as_str() != installed.control_id.as_str()
            || installed.revision > replica.frontier.control
        {
            return Ok(false);
        }
        let live = pair.snapshot()?;
        Ok(live.network.queued_packet_ids.contains(&receipt_id))
    }

    fn trace_boundary_with_live_predicate(
        boundary_id: &str,
        pair: &mut SimulatedPair,
        predicate: impl Fn(&SimulatedPair, &RestorablePairSnapshotV2) -> TestResult<bool>,
        operations: Vec<PairOperationV2>,
    ) -> TestResult<M3ContinuationScenarioV1> {
        if operations.is_empty() {
            return Err(invalid(format!(
                "continuation boundary {boundary_id:?} has no later operation"
            )));
        }
        let initial_snapshot = pair.snapshot_v2()?;
        assert!(
            predicate(pair, &initial_snapshot)?,
            "live production pair did not satisfy continuation boundary {boundary_id}"
        );
        let mut recorder = PairKernelTraceRecorder::new(initial_snapshot)?;
        for operation in operations {
            let observation = pair.apply_trace_operation_v2(operation.clone())?;
            recorder.record_observation(operation, observation)?;
        }
        let trace = recorder.finish()?;
        assert!(
            !trace.entries.is_empty(),
            "continuation boundary {boundary_id} produced an empty trace"
        );
        Ok(M3ContinuationScenarioV1 {
            boundary_id: boundary_id.to_owned(),
            trace,
        })
    }

    fn trace_boundary(
        boundary_id: &str,
        pair: &mut SimulatedPair,
        predicate: impl Fn(&RestorablePairSnapshotV2) -> bool,
        operations: Vec<PairOperationV2>,
    ) -> TestResult<M3ContinuationScenarioV1> {
        trace_boundary_with_live_predicate(
            boundary_id,
            pair,
            |_, snapshot| Ok(predicate(snapshot)),
            operations,
        )
    }

    fn assert_zero_resource_teardown(snapshot: &er_sim::PairSnapshot) {
        assert_eq!(snapshot.host.live_resources, Default::default());
        assert_eq!(snapshot.guest.live_resources, Default::default());
        assert!(snapshot.clock_timers.is_empty());
        assert!(snapshot.network.queued_packet_ids.is_empty());
        assert!(snapshot.network.disconnected_endpoints.is_empty());
        assert!(snapshot.network.suspended_endpoints.is_empty());
        assert!(snapshot.network.disposed);
        assert!(snapshot.presenter.pending_event_ids.is_empty());
        assert!(snapshot.presenter.settled_event_ids.is_empty());
        assert!(snapshot.presenter.disposed);
    }

    #[test]
    fn live_new_battle_snapshot_restores_held_action_and_fight_before_keyup() -> TestResult {
        let content = content_pack()?;
        let game = forced_doubles_config()?;
        let mut uninterrupted = new_battle_pair(game.clone(), Arc::clone(&content), 11)?;
        let mut restored = new_battle_pair(game, Arc::clone(&content), 11)?;
        assert_pair_observation_equal(&uninterrupted, &restored, "initial")?;

        apply_same(
            &mut uninterrupted,
            &mut restored,
            raw_key_down(PairEndpoint::Host, PhysicalKey::Space),
            "held-action-down",
        )?;
        let action_snapshot = uninterrupted.snapshot_v2()?;
        assert!(held_button(
            &action_snapshot,
            PairEndpoint::Host,
            GameButton::Action,
            PhysicalKey::Space,
        ));
        assert!(driver_key_down(
            &action_snapshot,
            PairEndpoint::Host,
            PhysicalKey::Space,
        ));
        assert!(!action_snapshot.host.scheduler.timers.is_empty());
        restored = destroy_and_restore(restored, Arc::clone(&content))?;
        assert_pair_observation_equal(
            &uninterrupted,
            &restored,
            "held-action-before-keyup-restore",
        )?;
        apply_same(
            &mut uninterrupted,
            &mut restored,
            raw_key_up(PairEndpoint::Host, PhysicalKey::Space),
            "held-action-keyup",
        )?;

        apply_same(
            &mut uninterrupted,
            &mut restored,
            raw_key_down(PairEndpoint::Host, PhysicalKey::Enter),
            "held-move-select-down",
        )?;
        apply_same(
            &mut uninterrupted,
            &mut restored,
            raw_key_up(PairEndpoint::Host, PhysicalKey::Enter),
            "held-move-select-up",
        )?;
        apply_same(
            &mut uninterrupted,
            &mut restored,
            raw_key_down(PairEndpoint::Host, PhysicalKey::Enter),
            "held-fight-down",
        )?;
        let fight_snapshot = uninterrupted.snapshot_v2()?;
        assert!(held_button(
            &fight_snapshot,
            PairEndpoint::Host,
            GameButton::Submit,
            PhysicalKey::Enter,
        ));
        assert!(driver_key_down(
            &fight_snapshot,
            PairEndpoint::Host,
            PhysicalKey::Enter,
        ));
        assert!(
            endpoint_has_fight(&fight_snapshot, PairEndpoint::Host),
            "the held Fight command was not retained/admitted before Enter keyup",
        );
        restored = destroy_and_restore(restored, Arc::clone(&content))?;
        assert_pair_observation_equal(
            &uninterrupted,
            &restored,
            "held-fight-before-keyup-restore",
        )?;
        apply_same(
            &mut uninterrupted,
            &mut restored,
            raw_key_up(PairEndpoint::Host, PhysicalKey::Enter),
            "held-fight-keyup",
        )?;
        Ok(())
    }

    #[test]
    fn live_new_battle_snapshot_restores_doubles_proposal_admission_and_replacement() -> TestResult
    {
        let content = content_pack()?;
        let game = forced_doubles_config()?;
        let mut uninterrupted = new_battle_pair(game.clone(), Arc::clone(&content), 12)?;
        let mut restored = new_battle_pair(game, Arc::clone(&content), 12)?;
        assert_pair_observation_equal(&uninterrupted, &restored, "doubles-initial")?;

        for attempt in 0..8 {
            let snapshot = uninterrupted.snapshot_v2()?;
            if one_doubles_command_pending(&snapshot) {
                break;
            }
            press_same(
                &mut uninterrupted,
                &mut restored,
                PairEndpoint::Host,
                PhysicalKey::Enter,
                &format!("host-command-{attempt}"),
            )?;
        }
        let snapshot = uninterrupted.snapshot_v2()?;
        assert!(
            one_doubles_command_pending(&snapshot),
            "doubles did not expose one collected host command with the guest command pending",
        );
        restored = destroy_and_restore(restored, Arc::clone(&content))?;
        assert_pair_observation_equal(
            &uninterrupted,
            &restored,
            "doubles-one-command-pending-restore",
        )?;

        for attempt in 0..8 {
            let snapshot = uninterrupted.snapshot_v2()?;
            if guest_proposal_pending(&snapshot) {
                break;
            }
            press_same(
                &mut uninterrupted,
                &mut restored,
                PairEndpoint::Guest,
                PhysicalKey::Enter,
                &format!("guest-command-{attempt}"),
            )?;
        }
        let snapshot = uninterrupted.snapshot_v2()?;
        assert!(
            guest_proposal_pending(&snapshot),
            "guest command did not leave a live proposal lease and queued proposal",
        );
        restored = destroy_and_restore(restored, Arc::clone(&content))?;
        assert_pair_observation_equal(&uninterrupted, &restored, "guest-proposal-pending-restore")?;

        for tick in 0..128 {
            let snapshot = uninterrupted.snapshot_v2()?;
            if host_admission_with_blocking_presentation(&snapshot) {
                break;
            }
            advance_same(
                &mut uninterrupted,
                &mut restored,
                1,
                &format!("proposal-admission-tick-{tick}"),
            )?;
        }
        let snapshot = uninterrupted.snapshot_v2()?;
        assert!(
            host_admission_with_blocking_presentation(&snapshot),
            "guest proposal was not admitted into a host blocking presentation",
        );
        restored = destroy_and_restore(restored, Arc::clone(&content))?;
        assert_pair_observation_equal(
            &uninterrupted,
            &restored,
            "proposal-admission-presentation-restore",
        )?;

        for tick in 0..256 {
            let snapshot = uninterrupted.snapshot_v2()?;
            if replacement_menu_open(&snapshot) {
                break;
            }
            if pending_battle_presentations(&snapshot).is_empty() {
                advance_same(
                    &mut uninterrupted,
                    &mut restored,
                    1,
                    &format!("replacement-progress-tick-{tick}"),
                )?;
            } else {
                settle_all_presentations(&mut uninterrupted, &mut restored)?;
            }
        }
        let snapshot = uninterrupted.snapshot_v2()?;
        assert!(
            replacement_menu_open(&snapshot),
            "forced-replacement fixture never exposed its replacement menu",
        );
        restored = destroy_and_restore(restored, Arc::clone(&content))?;
        assert_pair_observation_equal(&uninterrupted, &restored, "replacement-menu-open-restore")?;
        press_same(
            &mut uninterrupted,
            &mut restored,
            PairEndpoint::Host,
            PhysicalKey::Enter,
            "replacement-menu-submit-continuation",
        )?;
        Ok(())
    }

    #[test]
    fn live_new_battle_terminal_snapshot_restores_before_zero_resource_teardown() -> TestResult {
        let content = content_pack()?;
        let game = forced_victory_config()?;
        let mut uninterrupted = new_battle_pair(game.clone(), Arc::clone(&content), 13)?;
        let mut restored = new_battle_pair(game, Arc::clone(&content), 13)?;
        assert_pair_observation_equal(&uninterrupted, &restored, "terminal-initial")?;

        let mut guest_target_redirected = false;
        for endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            for attempt in 0..8 {
                let snapshot = uninterrupted.snapshot_v2()?;
                if endpoint_commands_complete(&snapshot, endpoint) {
                    break;
                }
                if endpoint == PairEndpoint::Guest
                    && !guest_target_redirected
                    && matches!(
                        &endpoint_snapshot(&snapshot, endpoint).ui.seat_control.control,
                        BattleControl::TargetSelect(control)
                            if control.menu.selected_option_id.as_str() == "target/enemy/0"
                    )
                {
                    press_same(
                        &mut uninterrupted,
                        &mut restored,
                        endpoint,
                        PhysicalKey::ArrowRight,
                        "terminal-guest-target-enemy-one",
                    )?;
                    let redirected = uninterrupted.snapshot_v2()?;
                    assert!(
                        matches!(
                            &endpoint_snapshot(&redirected, endpoint).ui.seat_control.control,
                            BattleControl::TargetSelect(control)
                                if control.menu.selected_option_id.as_str() == "target/enemy/1"
                        ),
                        "forced-victory guest target did not move to the second enemy"
                    );
                    guest_target_redirected = true;
                    continue;
                }
                press_same(
                    &mut uninterrupted,
                    &mut restored,
                    endpoint,
                    PhysicalKey::Enter,
                    &format!("terminal-{endpoint:?}-command-{attempt}"),
                )?;
            }
        }
        assert!(
            guest_target_redirected,
            "forced-victory fixture never exposed the guest's exact enemy-zero target default"
        );

        for tick in 0..512 {
            let snapshot = uninterrupted.snapshot_v2()?;
            if terminal_reached(&snapshot) {
                break;
            }
            if !pending_battle_presentations(&snapshot).is_empty() {
                settle_all_presentations(&mut uninterrupted, &mut restored)?;
            } else if let Some(endpoint) = [PairEndpoint::Host, PairEndpoint::Guest]
                .into_iter()
                .find(|endpoint| {
                    endpoint_snapshot(&snapshot, *endpoint).ui.actionable
                        && !endpoint_commands_complete(&snapshot, *endpoint)
                })
            {
                press_same(
                    &mut uninterrupted,
                    &mut restored,
                    endpoint,
                    PhysicalKey::Enter,
                    &format!("terminal-progress-{endpoint:?}-command-{tick}"),
                )?;
            } else {
                advance_same(
                    &mut uninterrupted,
                    &mut restored,
                    1,
                    &format!("terminal-progress-tick-{tick}"),
                )?;
            }
        }
        let terminal_snapshot = uninterrupted.snapshot_v2()?;
        assert!(
            terminal_reached(&terminal_snapshot),
            "terminal was not reached before explicit pair teardown",
        );
        assert!(terminal_snapshot.clock.timers.is_empty());
        assert!(terminal_snapshot.presenter.disposed);
        assert!(
            !terminal_snapshot.presenter.outcomes.is_empty(),
            "terminal snapshot erased settled presentation evidence",
        );
        assert_eq!(
            terminal_snapshot.presenter.outcomes.len(),
            terminal_snapshot.presenter.tombstones.len(),
            "terminal presenter outcomes and tombstones diverged",
        );
        let _terminal_wire = snapshot_wire(&uninterrupted)?;
        let before_teardown = uninterrupted.snapshot()?;
        assert_zero_resource_teardown(&before_teardown);

        restored = destroy_and_restore(restored, Arc::clone(&content))?;
        assert_pair_observation_equal(
            &uninterrupted,
            &restored,
            "terminal-before-teardown-restore",
        )?;
        apply_same(
            &mut uninterrupted,
            &mut restored,
            PairOperation::AdvanceTime {
                delta_ms: SafeU53::ZERO,
            },
            "terminal-absorbing-zero-time",
        )?;

        let uninterrupted_teardown = uninterrupted.teardown("m3c11-terminal-teardown")?;
        let restored_teardown = restored.teardown("m3c11-terminal-teardown")?;
        assert_eq!(
            serde_json::to_vec(&uninterrupted_teardown)?,
            serde_json::to_vec(&restored_teardown)?,
            "ordered teardown snapshots diverged after terminal restoration",
        );
        assert_zero_resource_teardown(&uninterrupted_teardown);
        assert_zero_resource_teardown(&restored_teardown);
        Ok(())
    }

    fn build_hosted_continuation_suite(
        content: Arc<ContentPack>,
    ) -> TestResult<M3ContinuationSuiteV1> {
        let forced_doubles_config = || forced_doubles_config_with_content(content.as_ref());
        let forced_victory_config = || forced_victory_config_with_content(content.as_ref());
        let mut scenarios = Vec::with_capacity(REQUIRED_CONTINUATION_BOUNDARIES.len());

        {
            let mut pair = new_battle_pair(forced_doubles_config()?, Arc::clone(&content), 1101)?;
            apply_trace_operation(
                &mut pair,
                raw_key_down_v2(PairEndpoint::Host, PhysicalKey::Space),
            )?;
            apply_trace_operation(
                &mut pair,
                raw_key_up_v2(PairEndpoint::Host, PhysicalKey::Space),
            )?;
            apply_trace_operation(
                &mut pair,
                raw_key_down_v2(PairEndpoint::Host, PhysicalKey::Enter),
            )?;
            apply_trace_operation(
                &mut pair,
                raw_key_up_v2(PairEndpoint::Host, PhysicalKey::Enter),
            )?;
            apply_trace_operation(
                &mut pair,
                raw_key_down_v2(PairEndpoint::Host, PhysicalKey::Enter),
            )?;
            scenarios.push(trace_boundary(
                "held-fight-before-keyup",
                &mut pair,
                |snapshot| {
                    held_button(
                        snapshot,
                        PairEndpoint::Host,
                        GameButton::Submit,
                        PhysicalKey::Enter,
                    ) && driver_key_down(snapshot, PairEndpoint::Host, PhysicalKey::Enter)
                        && endpoint_has_fight(snapshot, PairEndpoint::Host)
                },
                vec![raw_key_up_v2(PairEndpoint::Host, PhysicalKey::Enter)],
            )?);
        }

        {
            let mut pair = new_battle_pair(forced_doubles_config()?, Arc::clone(&content), 1102)?;
            reach_one_doubles_command_pending(&mut pair)?;
            scenarios.push(trace_boundary(
                "doubles-one-command-pending",
                &mut pair,
                one_doubles_command_pending,
                vec![
                    raw_key_down_v2(PairEndpoint::Guest, PhysicalKey::Enter),
                    raw_key_up_v2(PairEndpoint::Guest, PhysicalKey::Enter),
                ],
            )?);
        }

        {
            let mut pair = new_battle_pair(forced_doubles_config()?, Arc::clone(&content), 1103)?;
            let (proposal_operation_id, proposal_fingerprint) =
                reach_guest_proposal_admitted_with_delivery_pending(&mut pair)?;
            let pending_snapshot = pair.snapshot_v2()?;
            let continuation = if let Some(packet) =
                pending_snapshot.network.packets.iter().find(|packet| {
                    packet.source == PairEndpoint::Host
                        && packet.destination == PairEndpoint::Guest
                        && packet.source_generation == generation(1)
                        && packet.destination_generation == generation(1)
                        && packet.kind == RestorablePacketKindV2::AuthorityFrame
                        && proposal_result_packet_matches(
                            packet,
                            &proposal_operation_id,
                            &proposal_fingerprint,
                        )
                }) {
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Deliver {
                        packet_id: packet.packet_id,
                    },
                }
            } else {
                return Err(invalid(
                    "guest proposal boundary omitted its exact queued Authority TURN result",
                ));
            };
            scenarios.push(trace_boundary_with_live_predicate(
                "guest-proposal-delivery-pending",
                &mut pair,
                move |_, snapshot| {
                    guest_proposal_admitted_with_delivery_pending(
                        snapshot,
                        &proposal_operation_id,
                        &proposal_fingerprint,
                    )
                },
                vec![continuation],
            )?);
        }

        {
            let mut pair = new_battle_pair(forced_doubles_config()?, Arc::clone(&content), 1104)?;
            prime_trace_pair(&mut pair)?;
            let proposal = first_packet_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::CommandProposal,
                PairEndpoint::Guest,
                PairEndpoint::Host,
                generation(1),
            )?;
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Deliver {
                        packet_id: proposal.packet_id,
                    },
                },
            )?;
            let turn = first_packet_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::AuthorityFrame,
                PairEndpoint::Host,
                PairEndpoint::Guest,
                generation(1),
            )?;
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Delay {
                        packet_id: turn.packet_id,
                        additional_ms: safe(100),
                    },
                },
            )?;
            let turn_id = turn.packet_id;
            scenarios.push(trace_boundary(
                "turn-packet-delayed",
                &mut pair,
                move |snapshot| {
                    snapshot.network.packets.iter().any(|packet| {
                        packet.packet_id == turn_id
                            && packet.kind == RestorablePacketKindV2::AuthorityFrame
                            && packet.source == PairEndpoint::Host
                            && packet.destination == PairEndpoint::Guest
                            && packet.disposition == PacketDispositionV2::Delayed
                            && packet.delivery_deadline_ms > packet.enqueued_at_ms
                    })
                },
                vec![PairOperationV2::Fault {
                    operation: FaultOperationV2::Deliver { packet_id: turn_id },
                }],
            )?);
        }

        {
            let mut pair = new_battle_pair(forced_doubles_config()?, Arc::clone(&content), 1105)?;
            prime_trace_pair(&mut pair)?;
            let proposal = first_packet_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::CommandProposal,
                PairEndpoint::Guest,
                PairEndpoint::Host,
                generation(1),
            )?;
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Deliver {
                        packet_id: proposal.packet_id,
                    },
                },
            )?;
            let turn = first_packet_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::AuthorityFrame,
                PairEndpoint::Host,
                PairEndpoint::Guest,
                generation(1),
            )?;
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Deliver {
                        packet_id: turn.packet_id,
                    },
                },
            )?;
            settle_all_presentations_v2(&mut pair)?;
            let receipt = pair
                .snapshot_v2()?
                .network
                .packets
                .iter()
                .rev()
                .find(|packet| {
                    is_guest_host_generation_one_control_installed_receipt(packet)
                })
                .cloned()
                .ok_or_else(|| {
                    invalid(
                        "settled authority frame emitted no generation-one ControlInstalled receipt",
                    )
                })?;
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Delay {
                        packet_id: receipt.packet_id,
                        additional_ms: safe(100),
                    },
                },
            )?;
            let receipt_id = receipt.packet_id;
            scenarios.push(trace_boundary_with_live_predicate(
                "control-receipt-delayed",
                &mut pair,
                move |pair, snapshot| {
                    control_receipt_delayed_with_installed_control(pair, snapshot, receipt_id)
                },
                vec![PairOperationV2::Fault {
                    operation: FaultOperationV2::Deliver {
                        packet_id: receipt_id,
                    },
                }],
            )?);
        }

        {
            let mut pair = new_battle_pair(forced_doubles_config()?, Arc::clone(&content), 1106)?;
            reach_replacement_menu_open(&mut pair)?;
            scenarios.push(trace_boundary(
                "replacement-menu-open",
                &mut pair,
                replacement_menu_open,
                vec![
                    raw_key_down_v2(PairEndpoint::Host, PhysicalKey::ArrowDown),
                    raw_key_up_v2(PairEndpoint::Host, PhysicalKey::ArrowDown),
                ],
            )?);
        }

        {
            let mut pair = new_battle_pair(forced_doubles_config()?, Arc::clone(&content), 1107)?;
            prime_trace_pair(&mut pair)?;
            let proposal = first_packet_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::CommandProposal,
                PairEndpoint::Guest,
                PairEndpoint::Host,
                generation(1),
            )?;
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Deliver {
                        packet_id: proposal.packet_id,
                    },
                },
            )?;
            let turn = first_packet_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::AuthorityFrame,
                PairEndpoint::Host,
                PairEndpoint::Guest,
                generation(1),
            )?;
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Deliver {
                        packet_id: turn.packet_id,
                    },
                },
            )?;
            if !pair
                .snapshot_v2()?
                .network
                .packets
                .iter()
                .any(is_guest_host_generation_one_control_receipt)
            {
                settle_all_presentations_v2(&mut pair)?;
            }
            let receipt = last_packet_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::ControlReceipt,
                PairEndpoint::Guest,
                PairEndpoint::Host,
                generation(1),
            )?;
            let stale_receipt_id = receipt.packet_id;
            let stale_receipt_body = receipt.body.clone();
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Delay {
                        packet_id: receipt.packet_id,
                        additional_ms: safe(100),
                    },
                },
            )?;
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Reconnect {
                    endpoint: PairEndpoint::Guest,
                },
            )?;
            scenarios.push(trace_boundary(
                "recovery-fence-held",
                &mut pair,
                move |snapshot| {
                    recovery_fence_held(snapshot, stale_receipt_id, &stale_receipt_body)
                },
                vec![PairOperationV2::AdvanceTime { delta_ms: safe(1) }],
            )?);
        }

        {
            let mut pair = new_battle_pair(forced_doubles_config()?, Arc::clone(&content), 1108)?;
            reach_blocking_presentation_pending(&mut pair)?;
            let (endpoint, event_id) = pending_battle_presentations(&pair.snapshot_v2()?)
                .into_iter()
                .next()
                .ok_or_else(|| invalid("blocking-presentation boundary omitted its event"))?;
            scenarios.push(trace_boundary(
                "blocking-presentation-pending",
                &mut pair,
                host_admission_with_blocking_presentation,
                vec![PairOperationV2::BattlePresentationOutcome {
                    endpoint,
                    event_id,
                    outcome: PresentationSettlementOutcome::Settled,
                }],
            )?);
        }

        {
            let mut pair = new_battle_pair(forced_victory_config()?, Arc::clone(&content), 1109)?;
            let mut guest_target_redirected = false;
            for endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
                for _ in 0..8 {
                    let snapshot = pair.snapshot_v2()?;
                    if endpoint_commands_complete(&snapshot, endpoint) {
                        break;
                    }
                    if endpoint == PairEndpoint::Guest
                        && !guest_target_redirected
                        && matches!(
                            &endpoint_snapshot(&snapshot, endpoint).ui.seat_control.control,
                            BattleControl::TargetSelect(control)
                                if control.menu.selected_option_id.as_str() == "target/enemy/0"
                        )
                    {
                        raw_press_v2(&mut pair, endpoint, PhysicalKey::ArrowRight)?;
                        let redirected = pair.snapshot_v2()?;
                        assert!(
                            matches!(
                                &endpoint_snapshot(&redirected, endpoint).ui.seat_control.control,
                                BattleControl::TargetSelect(control)
                                    if control.menu.selected_option_id.as_str() == "target/enemy/1"
                            ),
                            "hosted forced-victory guest target did not move to the second enemy"
                        );
                        guest_target_redirected = true;
                        continue;
                    }
                    raw_press_v2(&mut pair, endpoint, PhysicalKey::Enter)?;
                }
                assert!(
                    endpoint_commands_complete(&pair.snapshot_v2()?, endpoint),
                    "terminal fixture did not complete {endpoint:?} command selection"
                );
            }
            assert!(
                guest_target_redirected,
                "hosted forced-victory fixture never exposed the guest's exact enemy-zero target default"
            );
            for tick in 0..512 {
                let snapshot = pair.snapshot_v2()?;
                if terminal_reached(&snapshot) {
                    break;
                }
                if !pending_battle_presentations(&snapshot).is_empty() {
                    settle_all_presentations_v2(&mut pair)?;
                } else if let Some(endpoint) = [PairEndpoint::Host, PairEndpoint::Guest]
                    .into_iter()
                    .find(|endpoint| {
                        endpoint_snapshot(&snapshot, *endpoint).ui.actionable
                            && !endpoint_commands_complete(&snapshot, *endpoint)
                    })
                {
                    raw_press_v2(&mut pair, endpoint, PhysicalKey::Enter)?;
                } else {
                    advance_time_v2(&mut pair, 1)?;
                }
                if tick == 511 {
                    break;
                }
            }
            scenarios.push(trace_boundary(
                "terminal-before-teardown",
                &mut pair,
                terminal_reached,
                vec![PairOperationV2::AdvanceTime {
                    delta_ms: SafeU53::ZERO,
                }],
            )?);
        }

        {
            let mut pair = new_battle_pair(forced_doubles_config()?, Arc::clone(&content), 1110)?;
            prime_trace_pair(&mut pair)?;
            let proposal = first_packet_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::CommandProposal,
                PairEndpoint::Guest,
                PairEndpoint::Host,
                generation(1),
            )?;
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Deliver {
                        packet_id: proposal.packet_id,
                    },
                },
            )?;
            let turn = first_packet_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::AuthorityFrame,
                PairEndpoint::Host,
                PairEndpoint::Guest,
                generation(1),
            )?;
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Deliver {
                        packet_id: turn.packet_id,
                    },
                },
            )?;
            if !pair
                .snapshot_v2()?
                .network
                .packets
                .iter()
                .any(is_guest_host_generation_one_control_receipt)
            {
                settle_all_presentations_v2(&mut pair)?;
            }
            let receipt = last_packet_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::ControlReceipt,
                PairEndpoint::Guest,
                PairEndpoint::Host,
                generation(1),
            )?;
            let original_body = receipt.body.clone();
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Delay {
                        packet_id: receipt.packet_id,
                        additional_ms: safe(100),
                    },
                },
            )?;
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Corrupt {
                        packet_id: receipt.packet_id,
                        corruption: FrameCorruptionV2::DeleteField {
                            json_pointer: "/ctx/connectionGeneration".to_owned(),
                        },
                    },
                },
            )?;
            let corrupted = last_packet_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::ControlReceipt,
                PairEndpoint::Guest,
                PairEndpoint::Host,
                generation(1),
            )?;
            let original_frame =
                decode_canonical_frame_packet_value(&original_body, "original control receipt")?;
            let corrupted_frame =
                decode_canonical_frame_packet_value(&corrupted.body, "corrupted control receipt")?;
            assert!(
                original_frame
                    .pointer("/ctx/connectionGeneration")
                    .is_some(),
                "original control receipt omitted its connection generation"
            );
            assert!(
                corrupted_frame
                    .pointer("/ctx/connectionGeneration")
                    .is_none(),
                "corrupted control receipt retained connectionGeneration"
            );
            let mut expected_corrupted_frame = original_frame.clone();
            expected_corrupted_frame
                .get_mut("ctx")
                .and_then(Value::as_object_mut)
                .and_then(|context| context.remove("connectionGeneration"));
            assert_eq!(
                corrupted_frame, expected_corrupted_frame,
                "production corruption changed fields beyond /ctx/connectionGeneration"
            );
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Fault {
                    operation: FaultOperationV2::Duplicate {
                        packet_id: receipt.packet_id,
                    },
                },
            )?;
            let duplicated = packets_with_body_v2(
                &pair.snapshot_v2()?,
                RestorablePacketKindV2::ControlReceipt,
                PairEndpoint::Guest,
                PairEndpoint::Host,
                &corrupted.body,
            );
            assert_eq!(duplicated.len(), 2);
            let duplicate_packet_id = duplicated
                .iter()
                .map(|packet| packet.packet_id)
                .find(|packet_id| *packet_id != receipt.packet_id)
                .ok_or_else(|| invalid("fault duplicate did not receive a distinct packet ID"))?;
            let stale_packet_ids = [receipt.packet_id, duplicate_packet_id];
            apply_trace_operation(
                &mut pair,
                PairOperationV2::Reconnect {
                    endpoint: PairEndpoint::Guest,
                },
            )?;
            let corrupted_body_for_predicate = corrupted.body.clone();
            scenarios.push(trace_boundary(
                "mixed-network-fault-queue",
                &mut pair,
                move |snapshot| {
                    mixed_fault_queue(snapshot, stale_packet_ids, &corrupted_body_for_predicate)
                },
                vec![PairOperationV2::AdvanceTime { delta_ms: safe(1) }],
            )?);
        }

        let suite = M3ContinuationSuiteV1 {
            schema_version: M3_CONTINUATION_SUITE_SCHEMA_VERSION,
            suite_id: M3_CONTINUATION_SUITE_ID.to_owned(),
            content_pack: (*content).clone(),
            scenarios,
        };
        suite.validate()?;
        Ok(suite)
    }

    fn emit_hosted_continuation_artifacts(suite_json: &str, report_json: &str) -> TestResult {
        let Some(directory) = std::env::var_os("M3_CONTINUATION_ARTIFACT_DIR") else {
            return Ok(());
        };
        let directory = std::path::PathBuf::from(directory);
        std::fs::create_dir_all(&directory)?;
        std::fs::write(directory.join("suite.json"), suite_json.as_bytes())?;
        std::fs::write(
            directory.join("native-continuation-report.json"),
            report_json.as_bytes(),
        )?;
        Ok(())
    }

    fn hosted_m3_native_wasm_continuation_suite_emits_artifacts_on_sized_thread() -> TestResult {
        let content = selected_content_pack_for_continuation()?;
        let suite = build_hosted_continuation_suite(Arc::clone(&content))?;
        assert_eq!(
            suite.scenarios.len(),
            REQUIRED_CONTINUATION_BOUNDARIES.len()
        );
        assert_eq!(
            suite
                .scenarios
                .iter()
                .map(|scenario| scenario.boundary_id.as_str())
                .collect::<Vec<_>>(),
            REQUIRED_CONTINUATION_BOUNDARIES.to_vec(),
        );
        assert!(
            suite
                .scenarios
                .iter()
                .all(|scenario| !scenario.trace.entries.is_empty())
        );

        let suite_json = canonical_suite_json(&suite)?;
        let parsed_suite = parse_suite_json(&suite_json)?;
        let reparsed_suite_json = canonical_suite_json(&parsed_suite)?;
        assert_eq!(
            suite_json.as_bytes(),
            reparsed_suite_json.as_bytes(),
            "canonical suite bytes changed after parse/re-canonicalize",
        );

        let report_json = replay_suite_json(&suite_json)?;
        let replayed_report_json = replay_suite_json(&reparsed_suite_json)?;
        assert_eq!(
            report_json.as_bytes(),
            replayed_report_json.as_bytes(),
            "native continuation report bytes were not reproducible",
        );

        let report: Value = serde_json::from_str(&report_json)?;
        assert_eq!(
            report.get("scenario_count").and_then(Value::as_u64),
            Some(u64::try_from(REQUIRED_CONTINUATION_BOUNDARIES.len())?),
        );
        assert_eq!(
            report.get("content_hash").and_then(Value::as_str),
            Some(content.hash.as_str()),
        );
        let report_scenarios = report
            .get("scenarios")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("native continuation report omitted scenarios"))?;
        assert_eq!(
            report_scenarios.len(),
            REQUIRED_CONTINUATION_BOUNDARIES.len()
        );
        for (index, (scenario, expected_id)) in report_scenarios
            .iter()
            .zip(REQUIRED_CONTINUATION_BOUNDARIES)
            .enumerate()
        {
            assert_eq!(
                scenario.get("boundary_id").and_then(Value::as_str),
                Some(expected_id),
                "report scenario {index} has the wrong boundary id",
            );
            let operation_count = scenario
                .get("operation_count")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    invalid(format!("report scenario {index} omitted operation_count"))
                })?;
            let replayed_operation_count = scenario
                .get("replayed_operation_count")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    invalid(format!(
                        "report scenario {index} omitted replayed_operation_count"
                    ))
                })?;
            assert_eq!(
                operation_count, replayed_operation_count,
                "replayed operation count diverged for report scenario {index}",
            );
            assert_eq!(
                operation_count,
                u64::try_from(suite.scenarios[index].trace.entries.len())?,
                "report operation count diverged from the native trace for report scenario {index}",
            );
        }

        emit_hosted_continuation_artifacts(&suite_json, &report_json)?;
        Ok(())
    }

    #[test]
    fn hosted_m3_native_wasm_continuation_suite_emits_artifacts() -> TestResult {
        let result = std::thread::Builder::new()
            .name("m3-continuation-harness".to_owned())
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                hosted_m3_native_wasm_continuation_suite_emits_artifacts_on_sized_thread()
                    .map_err(|error| error.to_string())
            })
            .map_err(|error| format!("spawn sized M3 continuation harness thread: {error}"))?
            .join()
            .map_err(|_| "sized M3 continuation harness thread panicked".to_owned())?;
        result.map_err(|error| -> Box<dyn Error> { error.into() })
    }
}
