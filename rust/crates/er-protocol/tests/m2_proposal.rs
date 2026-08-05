use std::collections::BTreeSet;

use er_protocol::{
    ProposalAdmission, ProposalAdmissionLedger, ProposalFingerprintError, ProposalFingerprintInput,
    ProposalIdentity, ProposalJson, ProposalLeaseAction, ProposalLeaseConfig, ProposalLeaseManager,
    ProposalLeaseSpec, ProposalLeaseStart, SchedulerCommand, fingerprint_bargain,
    fingerprint_biome_shop_buy, fingerprint_biome_shop_leave, fingerprint_reward,
    proposal_fingerprint,
};
use er_types::{
    ConnectionGeneration, OperationId, ProposalMessage, SafeI53, SafeU53, SeatId, TimeClass,
    TimerId,
};
use serde_json::Value;

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn safe_u(value: u64) -> Result<SafeU53, er_types::SafeU53Error> {
    SafeU53::new(value)
}

fn safe_i(value: i64) -> Result<SafeI53, er_types::SafeI53Error> {
    SafeI53::new(value)
}

fn operation_id(value: &str) -> Result<OperationId, er_types::StringIdError> {
    OperationId::new(value)
}

fn proposal(
    operation_id_value: &str,
    fingerprint: &str,
    endpoint: u64,
    generation: u64,
) -> Result<ProposalMessage, Box<dyn std::error::Error>> {
    Ok(ProposalMessage {
        operation_id: operation_id(operation_id_value)?,
        fingerprint: fingerprint.to_owned(),
        from: SeatId::new(safe_u(1)?),
        to: SeatId::new(safe_u(endpoint)?),
        connection_generation: ConnectionGeneration::new(safe_u(generation)?),
        payload: Value::String("opaque-payload".to_owned()),
    })
}

fn lease_config() -> Result<ProposalLeaseConfig, Box<dyn std::error::Error>> {
    Ok(ProposalLeaseConfig {
        owner_prefix: "authority-v2:proposal:".to_owned(),
        retry_initial_ms: safe_u(250)?,
        retry_maximum_ms: safe_u(5_000)?,
        absolute_ceiling_ms: safe_u(1_200_000)?,
    })
}

fn scheduled_timer(action: &ProposalLeaseAction) -> Option<&er_protocol::ScheduledTimer> {
    match action {
        ProposalLeaseAction::Scheduler {
            command: SchedulerCommand::Schedule { timer },
        } => Some(timer),
        _ => None,
    }
}

fn sent_proposal(action: &ProposalLeaseAction) -> Option<&ProposalMessage> {
    match action {
        ProposalLeaseAction::Send { proposal } => Some(proposal),
        _ => None,
    }
}

fn cancelled_timer(action: &ProposalLeaseAction) -> Option<(SeatId, TimerId)> {
    match action {
        ProposalLeaseAction::Scheduler {
            command: SchedulerCommand::Cancel { endpoint, timer_id },
        } => Some((*endpoint, *timer_id)),
        _ => None,
    }
}

#[test]
fn fingerprints_are_byte_exact_and_preserve_nested_json_order() -> TestResult {
    let sequence = safe_u(42)?;
    let choice = safe_i(-3)?;
    let wire = ProposalJson::new(
        r#" { "z": 1, "a": { "second": 2, "first": 1 }, "array": [3, { "b": true, "a": null }] } "#,
    )?;
    let reward_surface = ProposalJson::new(r#"{"surfaceId":"modifier:me:graves:0","ordinal":0}"#)?;
    let expected = r#"[42,"reward",-3,{"z":1,"a":{"second":2,"first":1},"array":[3,{"b":true,"a":null}]},{"surfaceId":"modifier:me:graves:0","ordinal":0}]"#;

    assert_eq!(
        fingerprint_reward(
            sequence,
            "reward",
            choice,
            Some(&wire),
            Some(&reward_surface),
        )?,
        expected,
    );
    assert_eq!(
        proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
            sequence,
            label: "reward".to_owned(),
            choice,
            wire: Some(wire),
            reward_surface: Some(reward_surface),
        })?,
        expected,
    );
    Ok(())
}

#[test]
fn fingerprints_follow_javascript_object_key_order_and_duplicate_assignment() -> TestResult {
    let wire = ProposalJson::new(r#"{"2":"two","10":"ten","1":"one","x":1,"x":2,"01":3}"#)?;
    assert_eq!(
        fingerprint_reward(safe_u(4)?, "keys", safe_i(0)?, Some(&wire), None)?,
        r#"[4,"keys",0,{"1":"one","2":"two","10":"ten","x":2,"01":3},null]"#,
    );
    Ok(())
}

#[test]
fn biome_and_bargain_fingerprints_pin_their_sequence_bands() -> TestResult {
    let pinned = safe_u(12)?;
    assert_eq!(
        fingerprint_biome_shop_leave(pinned)?,
        r#"[7000012,"biomeShop",-1,null,null]"#,
    );
    assert_eq!(
        fingerprint_biome_shop_buy(
            pinned,
            safe_i(3)?,
            [safe_i(-4)?, safe_i(5)?, safe_i(6)?, safe_i(7)?],
        )?,
        r#"[7000012,"biomeShop",3,[-4,5,6,7],null]"#,
    );

    let outcome = ProposalJson::new(r#"{"offer":{"z":1,"a":2},"accepted":true}"#)?;
    assert_eq!(
        fingerprint_bargain(pinned, &outcome)?,
        r#"[7500012,"bargain",{"offer":{"z":1,"a":2},"accepted":true}]"#,
    );
    assert_eq!(
        proposal_fingerprint(&ProposalFingerprintInput::Bargain {
            sequence: pinned,
            outcome,
        })?,
        r#"[7500012,"bargain",{"offer":{"z":1,"a":2},"accepted":true}]"#,
    );
    Ok(())
}

#[test]
fn fingerprint_validation_rejects_empty_kind_invalid_json_and_offset_overflow() -> TestResult {
    assert_eq!(
        fingerprint_reward(safe_u(1)?, "", safe_i(0)?, None, None),
        Err(ProposalFingerprintError::EmptyKind),
    );
    assert!(matches!(
        ProposalJson::new("{bad"),
        Err(ProposalFingerprintError::InvalidJson { .. })
    ));
    let forged = serde_json::from_str::<ProposalJson>(r#""{bad""#)?;
    assert!(matches!(
        fingerprint_bargain(safe_u(1)?, &forged),
        Err(ProposalFingerprintError::InvalidJson { .. })
    ));
    assert_eq!(
        fingerprint_biome_shop_leave(SafeU53::MAX),
        Err(ProposalFingerprintError::SequenceOverflow),
    );
    assert_eq!(
        fingerprint_bargain(SafeU53::MAX, &ProposalJson::new("null")?),
        Err(ProposalFingerprintError::SequenceOverflow),
    );
    Ok(())
}

#[test]
fn admission_is_bounded_non_evicting_and_session_scoped() -> TestResult {
    assert_eq!(er_protocol::DEFAULT_PROPOSAL_CAPACITY, 8_192);
    assert!(matches!(
        ProposalAdmissionLedger::new(SafeU53::ZERO),
        Err(er_protocol::ProposalAdmissionError::InvalidCapacity)
    ));
    let mut ledger = ProposalAdmissionLedger::new(safe_u(1)?)?;
    let first = ProposalIdentity {
        operation_id: operation_id("OP/1")?,
        fingerprint: "buy".to_owned(),
    };
    let second = ProposalIdentity {
        operation_id: operation_id("OP/2")?,
        fingerprint: "leave".to_owned(),
    };
    assert_eq!(ledger.admit(&first), ProposalAdmission::Admitted);
    assert_eq!(ledger.admit(&first), ProposalAdmission::Duplicate);
    assert_eq!(
        ledger.admit(&ProposalIdentity {
            operation_id: first.operation_id.clone(),
            fingerprint: "reroll".to_owned(),
        }),
        ProposalAdmission::Conflict,
    );
    assert_eq!(ledger.admit(&second), ProposalAdmission::CapacityExhausted);
    assert_eq!(ledger.len(), safe_u(1)?);
    assert_eq!(ledger.fingerprint(&first.operation_id), Some("buy"));
    assert_eq!(ledger.diagnostics().fingerprints.len(), 1);

    ledger.reset();
    assert!(ledger.is_empty());
    assert_eq!(ledger.admit(&second), ProposalAdmission::Admitted);
    assert_eq!(ledger.len(), safe_u(1)?);
    ledger.dispose();
    ledger.dispose();
    assert_eq!(ledger.admit(&first), ProposalAdmission::Invalid);
    assert!(ledger.is_empty());
    assert!(ledger.diagnostics().disposed);
    assert!(ledger.diagnostics().fingerprints.is_empty());
    ledger.reset();
    assert_eq!(ledger.admit(&first), ProposalAdmission::Invalid);
    Ok(())
}

#[test]
fn lease_arms_with_immediate_send_and_connected_backoff_cap() -> TestResult {
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let retained = proposal("OP/1", "intent-a", 2, 1)?;
    let outcome = manager.arm(ProposalLeaseSpec {
        proposal: retained.clone(),
        absolute_ceiling_ms: None,
    });
    assert_eq!(outcome.result, ProposalLeaseStart::Retained);
    assert_eq!(outcome.actions.len(), 3);

    let absolute = scheduled_timer(&outcome.actions[0]);
    assert_eq!(
        absolute.map(|timer| timer.timer_id),
        Some(TimerId::new(safe_u(0)?))
    );
    assert_eq!(
        absolute.map(|timer| timer.endpoint),
        Some(SeatId::new(safe_u(2)?))
    );
    assert_eq!(
        absolute.map(|timer| timer.delay_ms),
        Some(safe_u(1_200_000)?)
    );
    assert_eq!(
        absolute.map(|timer| timer.time_class),
        Some(TimeClass::Absolute)
    );
    assert_eq!(
        absolute.map(|timer| timer.owner.owner_id.as_str()),
        Some("authority-v2:proposal:OP/1"),
    );
    assert_eq!(sent_proposal(&outcome.actions[1]), Some(&retained));
    let retry = scheduled_timer(&outcome.actions[2]);
    assert_eq!(
        retry.map(|timer| timer.timer_id),
        Some(TimerId::new(safe_u(1)?))
    );
    assert_eq!(retry.map(|timer| timer.delay_ms), Some(safe_u(250)?));
    assert_eq!(
        retry.map(|timer| timer.time_class),
        Some(TimeClass::Connected)
    );
    assert_eq!(manager.retained_count(), safe_u(1)?);
    assert_eq!(
        manager.diagnostics().timer_ids,
        BTreeSet::from([TimerId::new(safe_u(0)?), TimerId::new(safe_u(1)?)]),
    );

    let mut retry_timer = TimerId::new(safe_u(1)?);
    for (expected_delay, next_timer) in [
        (500_u64, 2_u64),
        (1_000, 3),
        (2_000, 4),
        (4_000, 5),
        (5_000, 6),
        (5_000, 7),
    ] {
        let actions = manager.timer_fired(retry_timer)?;
        assert_eq!(sent_proposal(&actions[0]), Some(&retained));
        let scheduled = scheduled_timer(&actions[1]);
        assert_eq!(
            scheduled.map(|timer| timer.timer_id),
            Some(TimerId::new(safe_u(next_timer)?))
        );
        assert_eq!(
            scheduled.map(|timer| timer.delay_ms),
            Some(safe_u(expected_delay)?)
        );
        assert_eq!(
            scheduled.map(|timer| timer.time_class),
            Some(TimeClass::Connected)
        );
        retry_timer = TimerId::new(safe_u(next_timer)?);
    }
    Ok(())
}

#[test]
fn invalid_lease_inputs_and_unknown_timers_are_side_effect_free() -> TestResult {
    let mut invalid_config = lease_config()?;
    invalid_config.retry_initial_ms = SafeU53::ZERO;
    assert!(matches!(
        ProposalLeaseManager::new(invalid_config),
        Err(er_protocol::ProposalLeaseError::InvalidProposal { .. })
    ));

    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let invalid = manager.arm(ProposalLeaseSpec {
        proposal: proposal("OP/invalid", "", 2, 1)?,
        absolute_ceiling_ms: None,
    });
    assert_eq!(invalid.result, ProposalLeaseStart::Invalid);
    assert!(invalid.actions.is_empty());
    assert_eq!(manager.retained_count(), SafeU53::ZERO);

    let invalid_ceiling = manager.arm(ProposalLeaseSpec {
        proposal: proposal("OP/invalid-ceiling", "intent-a", 2, 1)?,
        absolute_ceiling_ms: Some(SafeU53::ZERO),
    });
    assert_eq!(invalid_ceiling.result, ProposalLeaseStart::Invalid);
    assert!(invalid_ceiling.actions.is_empty());
    assert_eq!(manager.retained_count(), SafeU53::ZERO);

    let unknown = TimerId::new(safe_u(99)?);
    assert_eq!(
        manager.timer_fired(unknown),
        Err(er_protocol::ProposalLeaseError::UnknownTimer { timer_id: unknown })
    );
    assert!(manager.diagnostics().timer_ids.is_empty());
    Ok(())
}

#[test]
fn lease_tombstones_before_arm_and_cancels_both_timers() -> TestResult {
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let operation_id = operation_id("OP/committed")?;
    let (settled, actions) = manager.observe_committed(&operation_id);
    assert!(!settled);
    assert!(actions.is_empty());
    assert_eq!(
        manager.diagnostics().committed_tombstones,
        BTreeSet::from([operation_id.clone()]),
    );

    let committed_proposal = proposal("OP/committed", "intent-a", 2, 1)?;
    assert_eq!(
        manager
            .arm(ProposalLeaseSpec {
                proposal: committed_proposal,
                absolute_ceiling_ms: None,
            })
            .result,
        ProposalLeaseStart::AlreadyCommitted,
    );

    let retained = proposal("OP/live", "intent-a", 2, 1)?;
    assert_eq!(
        manager
            .arm(ProposalLeaseSpec {
                proposal: retained.clone(),
                absolute_ceiling_ms: None,
            })
            .result,
        ProposalLeaseStart::Retained,
    );
    let (settled, actions) = manager.observe_committed(&retained.operation_id);
    assert!(settled);
    assert_eq!(actions.len(), 2);
    assert_eq!(
        actions
            .iter()
            .filter_map(cancelled_timer)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            (SeatId::new(safe_u(2)?), TimerId::new(safe_u(0)?)),
            (SeatId::new(safe_u(2)?), TimerId::new(safe_u(1)?)),
        ]),
    );
    assert_eq!(manager.retained_count(), SafeU53::ZERO);
    assert!(manager.timer_fired(TimerId::new(safe_u(0)?)).is_err());
    assert_eq!(
        manager
            .arm(ProposalLeaseSpec {
                proposal: retained,
                absolute_ceiling_ms: None,
            })
            .result,
        ProposalLeaseStart::AlreadyCommitted,
    );
    Ok(())
}

#[test]
fn absolute_expiry_terminalizes_once_without_a_tombstone() -> TestResult {
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let retained = proposal("OP/expiry", "intent-a", 2, 1)?;
    let outcome = manager.arm(ProposalLeaseSpec {
        proposal: retained.clone(),
        absolute_ceiling_ms: Some(safe_u(1_000)?),
    });
    assert_eq!(outcome.result, ProposalLeaseStart::Retained);
    let actions = manager.timer_fired(TimerId::new(safe_u(0)?))?;
    assert_eq!(actions.len(), 2);
    assert_eq!(
        cancelled_timer(&actions[0]),
        Some((SeatId::new(safe_u(2)?), TimerId::new(safe_u(1)?))),
    );
    assert!(matches!(
        &actions[1],
        ProposalLeaseAction::Terminalize { operation_id, reason }
            if operation_id == &retained.operation_id
                && reason == "v2 proposal absolute ceiling"
    ));
    assert_eq!(manager.retained_count(), SafeU53::ZERO);
    assert!(manager.diagnostics().timer_ids.is_empty());
    assert!(manager.diagnostics().committed_tombstones.is_empty());
    assert!(manager.timer_fired(TimerId::new(safe_u(0)?)).is_err());
    assert_eq!(
        manager
            .arm(ProposalLeaseSpec {
                proposal: retained,
                absolute_ceiling_ms: None,
            })
            .result,
        ProposalLeaseStart::Retained,
    );
    Ok(())
}

#[test]
fn rearm_refreshes_the_opaque_proposal_and_rebinds_only_matching_participants() -> TestResult {
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let first = proposal("OP/first", "intent-a", 2, 1)?;
    let second = proposal("OP/second", "intent-b", 3, 1)?;
    assert_eq!(
        manager
            .arm(ProposalLeaseSpec {
                proposal: first.clone(),
                absolute_ceiling_ms: None,
            })
            .result,
        ProposalLeaseStart::Retained,
    );
    assert_eq!(
        manager
            .arm(ProposalLeaseSpec {
                proposal: second,
                absolute_ceiling_ms: None,
            })
            .result,
        ProposalLeaseStart::Retained,
    );

    let rebound = manager.rebind(
        SeatId::new(safe_u(2)?),
        ConnectionGeneration::new(safe_u(2)?),
    )?;
    assert_eq!(rebound.0, safe_u(1)?);
    assert_eq!(rebound.1.len(), 1);
    let rebound_proposal = sent_proposal(&rebound.1[0]);
    assert_eq!(
        rebound_proposal.map(|value| value.operation_id.as_str()),
        Some("OP/first")
    );
    assert_eq!(
        rebound_proposal.map(|value| value.connection_generation),
        Some(ConnectionGeneration::new(safe_u(2)?)),
    );
    assert_eq!(
        manager
            .rebind(
                SeatId::new(safe_u(2)?),
                ConnectionGeneration::new(safe_u(2)?)
            )?
            .0,
        SafeU53::ZERO
    );
    assert_eq!(
        manager
            .rebind(
                SeatId::new(safe_u(1)?),
                ConnectionGeneration::new(safe_u(2)?)
            )?
            .0,
        SafeU53::ZERO
    );
    assert_eq!(
        manager
            .rebind(
                SeatId::new(safe_u(2)?),
                ConnectionGeneration::new(safe_u(1)?)
            )?
            .0,
        SafeU53::ZERO
    );

    let refreshed = proposal("OP/first", "intent-a", 2, 3)?;
    let outcome = manager.arm(ProposalLeaseSpec {
        proposal: refreshed.clone(),
        absolute_ceiling_ms: None,
    });
    assert_eq!(outcome.result, ProposalLeaseStart::AlreadyRetained);
    assert_eq!(sent_proposal(&outcome.actions[0]), Some(&refreshed));
    assert_eq!(
        manager
            .arm(ProposalLeaseSpec {
                proposal: proposal("OP/first", "conflict", 2, 3)?,
                absolute_ceiling_ms: None,
            })
            .result,
        ProposalLeaseStart::Conflict,
    );
    Ok(())
}

#[test]
fn disposal_is_idempotent_and_clears_all_lease_resources() -> TestResult {
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let first = proposal("OP/first", "intent-a", 2, 1)?;
    let second = proposal("OP/second", "intent-b", 2, 1)?;
    manager.arm(ProposalLeaseSpec {
        proposal: first,
        absolute_ceiling_ms: None,
    });
    manager.arm(ProposalLeaseSpec {
        proposal: second,
        absolute_ceiling_ms: None,
    });
    let second_id = operation_id("OP/second")?;
    let _ = manager.observe_committed(&second_id);
    let actions = manager.dispose("test teardown");
    assert_eq!(actions.len(), 2);
    assert_eq!(manager.dispose("duplicate teardown"), Vec::new());
    let diagnostics = manager.diagnostics();
    assert!(diagnostics.disposed);
    assert!(diagnostics.live_operation_ids.is_empty());
    assert!(diagnostics.committed_tombstones.is_empty());
    assert!(diagnostics.timer_ids.is_empty());
    assert_eq!(manager.retained_count(), SafeU53::ZERO);
    let (retained_count, resend_actions) = manager.resend_retained();
    assert_eq!(retained_count, SafeU53::ZERO);
    assert!(resend_actions.is_empty());
    assert_eq!(
        manager
            .arm(ProposalLeaseSpec {
                proposal: proposal("OP/later", "intent-c", 2, 1)?,
                absolute_ceiling_ms: None,
            })
            .result,
        ProposalLeaseStart::Disposed,
    );
    assert!(matches!(
        manager.timer_fired(TimerId::new(safe_u(0)?)),
        Err(er_protocol::ProposalLeaseError::Disposed)
    ));
    Ok(())
}
