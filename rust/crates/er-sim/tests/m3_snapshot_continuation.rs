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
        Ok(Arc::new(serde_json::from_value(published_content_pack()?)?))
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
            left_v2.kernel_determinism_digest,
            right_v2.kernel_determinism_digest,
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

    fn restore_from_wire(
        wire: &str,
        content: Arc<ContentPack>,
    ) -> TestResult<GameKernel> {
        let snapshot: RestorableKernelSnapshotV2 = serde_json::from_str(wire)?;
        Ok(GameKernel::from_snapshot(snapshot, content)?)
    }

    #[test]
    fn live_raw_key_snapshot_continues_held_fight_before_keyup() -> TestResult {
        let fixture = published_case("physical-hit")?;
        let content = content_pack()?;
        let (wire, mut uninterrupted) = {
            let mut original = new_kernel(&fixture)?;
            let held_effects = raw_key_down(&mut original, PhysicalKey::Enter)?;
            assert!(held_effects.len() >= 1);
            assert!(matches!(control(&original)?, BattleControl::MoveSelect(_)));

            let snapshot = original.snapshot_v2()?;
            assert!(snapshot.input_router.pressed.len() == 1);
            assert!(!snapshot.input_router.held_buttons.is_empty());
            assert!(!snapshot.input_router.locks.is_empty());
            assert!(!snapshot.input_router.repeats.is_empty());
            assert!(snapshot
                .scheduler
                .timers
                .iter()
                .any(|timer| timer.registration.owner.owner_id == "input-router"));
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
                raw_input(seat, RawInputEvent::KeyUp {
                    code: PhysicalKey::Enter,
                }),
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
                raw_input(seat, RawInputEvent::KeyUp {
                    code: PhysicalKey::Enter,
                }),
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
            assert!(snapshot.pending_presentations.pending_barrier_ids.is_empty());
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
    include!("m3_raw_key_coop.rs");

    use er_content::pack::ContentPack;
    use er_kernel::snapshot::RestorableKernelSnapshotV2;

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
            "co-op snapshot JSON round trip changed canonical bytes",
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

    fn battle_presentation_events(effects: &[KernelEffect]) -> Vec<BattlePresentationEventId> {
        effects
            .iter()
            .filter_map(|effect| match effect {
                KernelEffect::PresentBattle { event, .. } => Some(event.event_id.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn live_doubles_snapshot_covers_proposal_admission_and_pending_presentation() -> TestResult {
        let mut pair = BattlePair::new(forced_doubles_config()?, generation(1))?;
        pair.connect()?;
        for endpoint in [Endpoint::Host, Endpoint::Guest] {
            for _ in 0..3 {
                pair.raw_press(endpoint, PhysicalKey::Enter)?;
            }
        }

        let proposal_index = pair
            .first_proposal_index()
            .ok_or_else(|| invalid("guest raw command collection emitted no proposal"))?;
        let proposal = match pair.packet_at(proposal_index)? {
            Packet::Proposal { proposal, .. } => proposal,
            _ => return Err(invalid("proposal queue entry was not a proposal")),
        };

        let guest_snapshot = pair.guest.snapshot_v2()?;
        let guest_leases = guest_snapshot
            .protocol
            .proposal_leases
            .as_ref()
            .ok_or_else(|| invalid("replica snapshot omitted proposal leases"))?;
        assert!(!guest_leases.leases.is_empty());
        assert!(!guest_leases.timer_targets.is_empty());
        let (guest_wire, _) = snapshot_wire(&guest_snapshot)?;
        let mut guest_uninterrupted = pair.guest.clone();
        let mut guest_restored = restore_from_wire(&guest_wire, content_pack()?)?;
        assert_kernel_observation_equal(
            &guest_uninterrupted,
            &guest_restored,
            "guest-proposal-pending-restore",
        )?;

        let host_before_snapshot = pair.host.snapshot_v2()?;
        let (host_before_wire, _) = snapshot_wire(&host_before_snapshot)?;
        let mut host_uninterrupted = pair.host.clone();
        let mut host_before_restored =
            restore_from_wire(&host_before_wire, content_pack()?)?;
        assert_kernel_observation_equal(
            &host_uninterrupted,
            &host_before_restored,
            "host-before-proposal-restore",
        )?;
        let admission_effects = step_same_input(
            &mut host_uninterrupted,
            &mut host_before_restored,
            KernelInput::ProposalReceived {
                endpoint: Endpoint::Host.seat(),
                proposal: proposal.clone(),
            },
            "host-proposal-admission",
        )?;
        assert!(admission_effects
            .iter()
            .any(|effect| matches!(effect, KernelEffect::SendFrame { .. })));

        let host_snapshot = host_uninterrupted.snapshot_v2()?;
        assert!(host_snapshot.protocol.proposal_admission.is_some());
        assert!(
            !host_snapshot
                .pending_presentations
                .pending_barrier_ids
                .is_empty(),
                "authority proposal admission did not leave a public presentation barrier"
        );
        let (host_wire, _) = snapshot_wire(&host_snapshot)?;
        let mut host_restored = restore_from_wire(&host_wire, content_pack()?)?;
        assert_kernel_observation_equal(
            &host_uninterrupted,
            &host_restored,
            "host-admission-presentation-restore",
        )?;

        // Keep the pair pump as the independent production transport witness;
        // the endpoint continuation above admitted the same public proposal
        // directly, and this pump now supplies its emitted raw frame.
        pair.deliver_packet_at(proposal_index)?;
        assert_eq!(
            pair.authority_entry_count(Endpoint::Host, AuthorityEntryKind::TurnCommit),
            1,
            "proposal admission did not produce exactly one authority TURN entry",
        );

        let frame_index = pair
            .first_authority_frame_index()
            .ok_or_else(|| invalid("authority admission emitted no TURN frame"))?;
        let raw_frame = match pair.packet_at(frame_index)? {
            Packet::Frame { raw, .. } => raw,
            _ => return Err(invalid("authority queue entry was not a frame")),
        };
        let guest_effects = step_same_input(
            &mut guest_uninterrupted,
            &mut guest_restored,
            KernelInput::RawNetworkFrame {
                endpoint: Endpoint::Guest.seat(),
                frame: raw_frame,
            },
            "guest-turn-frame-delivery",
        )?;
        let guest_events = battle_presentation_events(&guest_effects);
        for event_id in guest_events {
            step_same_input(
                &mut guest_uninterrupted,
                &mut guest_restored,
                KernelInput::BattlePresentationOutcome {
                    endpoint: Endpoint::Guest.seat(),
                    event_id,
                    outcome: PresentationSettlementOutcome::Settled,
                },
                "guest-presentation-settlement",
            )?;
        }

        // The quiescent public boundary exposes the pending barrier IDs, not
        // an impossible private half-transaction; settlement is the public
        // continuation input for those IDs.
        let host_events = host_snapshot
            .pending_presentations
            .pending_barrier_ids
            .clone();
        for event_id in host_events {
            step_same_input(
                &mut host_uninterrupted,
                &mut host_restored,
                KernelInput::BattlePresentationOutcome {
                    endpoint: Endpoint::Host.seat(),
                    event_id,
                    outcome: PresentationSettlementOutcome::Settled,
                },
                "host-presentation-settlement",
            )?;
        }
        Ok(())
    }
}
