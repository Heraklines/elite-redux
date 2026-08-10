//! Restorable V2 continuation-boundary coverage.
//!
//! The focused DTO checks and live production-pair continuations below cover
//! both closed-shape rejection evidence and owner-backed restoration.

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

    pub(super) fn battle_config_for_scenario(
        scenario_id: &str,
    ) -> TestResult<er_kernel::BattleGameConfig> {
        let fixture = published_case(scenario_id)?;
        battle_config(&fixture)
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
    use std::collections::BTreeMap;
    use std::sync::Arc;

    use er_content::pack::ContentPack;
    use er_kernel::{
        BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1,
    };
    use er_kernel::snapshot::PhysicalInputSourceV2;
    use er_protocol::{
        AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding, ProposalLeaseConfig,
        RecoveryTransactionConfig,
    };
    use er_sim::snapshot::{
        PairDeterminismDigest, RestorablePairSnapshotV2, RestorablePacketKindV2,
        RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION,
    };
    use er_kernel::snapshot::RestorableKernelSnapshotV2;
    use er_sim::{
        PairEndpoint, PairOperation, PairStep, SimulatedBattlePairConfig, SimulatedPair,
    };
    use er_types::battle_command::{
        AcceptedBattleCommand, BattleCommand, BattleTargetSelection, CommandFrontierStatus,
        ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1, scripted_enemy_command_operation_id,
    };
    use er_types::battle_control::BattleControl;
    use er_types::battle_ids::{
        BattlePresentationEventId, BattleSide, FieldSlot, MoveSlotIndex, PartyIndex, TurnIndex,
    };
    use er_types::battle_ui::PresentationSettlementOutcome;
    use er_types::{
        ConnectionGeneration, FrameContext, GameButton, InputFocus, MembershipRevision, PhysicalKey,
        RawInputEvent, SafeU53, SeatId, SessionId, TimeClass,
    };
    use serde_json::Value;

    type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

    const FORCED_REPLACEMENT_FIXTURE: &str =
        include_str!("../../../fixtures/m3/oracle/battle-cases/forced-replacement.json");

    fn invalid(message: impl Into<String>) -> Box<dyn std::error::Error> {
        std::io::Error::new(std::io::ErrorKind::InvalidData, message.into()).into()
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
        let wire: Value = serde_json::from_str(FORCED_REPLACEMENT_FIXTURE)?;
        let canonical = wire
            .get("initial_state")
            .and_then(|value| value.get("canonical"))
            .cloned()
            .ok_or_else(|| invalid("forced-replacement fixture has no initial canonical state"))?;
        let canonical_state = serde_json::from_value(canonical)?;
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
                    .ok_or_else(|| invalid(format!("player lead {pokemon_id} is not in the party")))?;
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
                    .ok_or_else(|| invalid(format!("enemy lead {pokemon_id} is not in the party")))?;
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
        let mut config = forced_doubles_config()?;
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
        Ok(SimulatedPair::new(SimulatedBattlePairConfig {
            host_game,
            host_protocol: authority_protocol(host, guest, generation(1))?,
            guest_game,
            guest_protocol: replica_protocol(host, guest, generation(1))?,
            content,
            replay_seed,
            initial_storage: BTreeMap::new(),
        })?)
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

    fn restore_from_wire(
        wire: &str,
        content: Arc<ContentPack>,
    ) -> TestResult<SimulatedPair> {
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
            left_v2.host.mechanical_digest,
            right_v2.host.mechanical_digest,
            "host mechanical digest diverged after {label}",
        );
        assert_eq!(
            left_v2.guest.mechanical_digest,
            right_v2.guest.mechanical_digest,
            "guest mechanical digest diverged after {label}",
        );
        assert_eq!(
            left_v2.host.kernel_determinism_digest,
            right_v2.host.kernel_determinism_digest,
            "host kernel digest diverged after {label}",
        );
        assert_eq!(
            left_v2.guest.kernel_determinism_digest,
            right_v2.guest.kernel_determinism_digest,
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
        let left_step = left.apply(operation.clone())?;
        let right_step = right.apply(operation)?;
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
        endpoint_snapshot.input_router.held_buttons.iter().any(|held| {
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

    fn endpoint_has_fight(
        snapshot: &RestorablePairSnapshotV2,
        endpoint: PairEndpoint,
    ) -> bool {
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
        let Some(battle) = endpoint_snapshot(snapshot, PairEndpoint::Host)
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
        let host_done = battle.command_state.frontier.iter().any(|entry| {
            entry.owner_seat == Some(seat(1)) && fight_status(&entry.status)
        });
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

    fn host_admission_with_blocking_presentation(
        snapshot: &RestorablePairSnapshotV2,
    ) -> bool {
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
        matches!(
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

    fn settle_all_presentations(
        left: &mut SimulatedPair,
        right: &mut SimulatedPair,
    ) -> TestResult {
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
            "held-submit-menu-down",
        )?;
        apply_same(
            &mut uninterrupted,
            &mut restored,
            raw_key_up(PairEndpoint::Host, PhysicalKey::Enter),
            "held-submit-menu-up",
        )?;
        apply_same(
            &mut uninterrupted,
            &mut restored,
            raw_key_down(PairEndpoint::Host, PhysicalKey::Enter),
            "held-target-select-down",
        )?;
        apply_same(
            &mut uninterrupted,
            &mut restored,
            raw_key_up(PairEndpoint::Host, PhysicalKey::Enter),
            "held-target-select-up",
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
    fn live_new_battle_snapshot_restores_doubles_proposal_admission_and_replacement() -> TestResult {
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
        assert_pair_observation_equal(
            &uninterrupted,
            &restored,
            "guest-proposal-pending-restore",
        )?;

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
        assert_pair_observation_equal(
            &uninterrupted,
            &restored,
            "replacement-menu-open-restore",
        )?;
        press_same(
            &mut uninterrupted,
            &mut restored,
            PairEndpoint::Host,
            PhysicalKey::ArrowDown,
            "replacement-menu-later-continuation",
        )?;
    }

    #[test]
    fn live_new_battle_terminal_snapshot_restores_before_zero_resource_teardown() -> TestResult {
        let content = content_pack()?;
        let game = forced_victory_config()?;
        let mut uninterrupted = new_battle_pair(game.clone(), Arc::clone(&content), 13)?;
        let mut restored = new_battle_pair(game, Arc::clone(&content), 13)?;
        assert_pair_observation_equal(&uninterrupted, &restored, "terminal-initial")?;

        for endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            for attempt in 0..8 {
                let snapshot = uninterrupted.snapshot_v2()?;
                if endpoint_commands_complete(&snapshot, endpoint) {
                    break;
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

        for tick in 0..256 {
            let snapshot = uninterrupted.snapshot_v2()?;
            if terminal_reached(&snapshot) {
                break;
            }
            if pending_battle_presentations(&snapshot).is_empty() {
                advance_same(
                    &mut uninterrupted,
                    &mut restored,
                    1,
                    &format!("terminal-progress-tick-{tick}"),
                )?;
            } else {
                settle_all_presentations(&mut uninterrupted, &mut restored)?;
            }
        }
        let terminal_snapshot = uninterrupted.snapshot_v2()?;
        assert!(
            terminal_reached(&terminal_snapshot),
            "terminal was not reached before explicit pair teardown",
        );
        assert!(terminal_snapshot.clock.timers.is_empty());
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
}
