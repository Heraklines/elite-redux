use std::collections::BTreeSet;

use er_protocol::{
    KernelScheduler, ProposalAdmission, ProposalAdmissionLedger, ProposalFingerprintError,
    ProposalFingerprintInput, ProposalIdentity, ProposalJson, ProposalLeaseAction,
    ProposalLeaseConfig, ProposalLeaseError, ProposalLeaseManager, ProposalLeaseSpec,
    ProposalLeaseStart, ScheduledTimer, SchedulerCommand, SchedulerError, fingerprint_bargain,
    fingerprint_biome_shop_buy, fingerprint_biome_shop_leave, fingerprint_reward,
    proposal_fingerprint,
};
use er_types::{
    ConnectionGeneration, OperationId, ProposalMessage, SafeI53, SafeU53, SeatId, TimeClass,
    TimerId, TimerOwner,
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

fn scheduled_timer(action: &ProposalLeaseAction) -> Option<&ScheduledTimer> {
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

fn timer_owner(operation_id: &str, reason: &str) -> TimerOwner {
    TimerOwner {
        owner_id: format!("authority-v2:proposal:{operation_id}"),
        address: operation_id.to_owned(),
        reason: reason.to_owned(),
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
fn fingerprints_follow_js_key_order_duplicate_assignment_and_numbers() -> TestResult {
    let wire = ProposalJson::new(
        r#"{"2":"two","10":"ten","1":"one","x":1,"x":2,"01":3,"negativeZero":-0,"overflow":1e400}"#,
    )?;
    assert_eq!(
        fingerprint_reward(safe_u(4)?, "keys", safe_i(0)?, Some(&wire), None)?,
        r#"[4,"keys",0,{"1":"one","2":"two","10":"ten","x":2,"01":3,"negativeZero":0,"overflow":null},null]"#,
    );

    let surrogate = ProposalJson::new(r#"{"lone":"\ud800","pair":"\ud83d\ude00"}"#)?;
    assert_eq!(
        fingerprint_reward(safe_u(4)?, "", safe_i(0)?, Some(&surrogate), None)?,
        r#"[4,"",0,{"lone":"\ud800","pair":"😀"},null]"#,
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
fn fingerprint_validation_rejects_invalid_inputs_and_overflow() -> TestResult {
    assert_eq!(
        fingerprint_reward(safe_u(1)?, "", safe_i(0)?, None, None)?,
        r#"[1,"",0,null,null]"#,
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

    ledger.reset();
    assert_eq!(ledger.admit(&second), ProposalAdmission::Admitted);
    ledger.dispose();
    ledger.dispose();
    assert_eq!(ledger.admit(&first), ProposalAdmission::Invalid);
    assert!(ledger.diagnostics().disposed);
    assert!(ledger.diagnostics().fingerprints.is_empty());
    Ok(())
}

#[test]
fn arm_uses_scheduler_ids_and_schedules_before_immediate_send() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let retained = proposal("OP/1", "intent-a", 2, 1)?;

    let outcome = manager.arm(
        ProposalLeaseSpec {
            proposal: retained.clone(),
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    assert_eq!(outcome.result, ProposalLeaseStart::Retained);
    assert_eq!(outcome.actions.len(), 3);
    let absolute = scheduled_timer(&outcome.actions[0]).expect("absolute schedule");
    let retry = scheduled_timer(&outcome.actions[1]).expect("retry schedule");
    assert_eq!(
        (absolute.timer_id, retry.timer_id),
        (TimerId::new(safe_u(0)?), TimerId::new(safe_u(1)?)),
    );
    assert_eq!(absolute.endpoint, retained.from);
    assert_eq!(retry.endpoint, retained.from);
    assert_eq!(absolute.time_class, TimeClass::Absolute);
    assert_eq!(retry.time_class, TimeClass::Connected);
    assert_eq!(
        absolute.owner,
        timer_owner("OP/1", "v2 proposal absolute ceiling")
    );
    assert_eq!(retry.owner, timer_owner("OP/1", "v2 proposal retry"));
    assert_eq!(sent_proposal(&outcome.actions[2]), Some(&retained));
    assert_eq!(
        scheduler.live_timers(),
        vec![(*absolute).clone(), (*retry).clone()]
    );
    assert_eq!(
        manager.diagnostics().timer_ids,
        BTreeSet::from([absolute.timer_id, retry.timer_id]),
    );
    Ok(())
}

#[test]
fn scheduler_allocation_is_shared_across_managers_and_max_id_is_not_forged() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut first = ProposalLeaseManager::new(lease_config()?)?;
    let mut second = ProposalLeaseManager::new(lease_config()?)?;

    first.arm(
        ProposalLeaseSpec {
            proposal: proposal("OP/first", "intent-a", 2, 1)?,
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    second.arm(
        ProposalLeaseSpec {
            proposal: proposal("OP/second", "intent-b", 3, 1)?,
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    assert_eq!(
        scheduler
            .live_timers()
            .iter()
            .map(|timer| timer.timer_id)
            .collect::<Vec<_>>(),
        vec![
            TimerId::new(safe_u(0)?),
            TimerId::new(safe_u(1)?),
            TimerId::new(safe_u(2)?),
            TimerId::new(safe_u(3)?),
        ],
    );

    let forged_max = ScheduledTimer {
        endpoint: SeatId::new(safe_u(1)?),
        timer_id: TimerId::new(SafeU53::MAX),
        owner: timer_owner("OP/first", "v2 proposal retry"),
        delay_ms: safe_u(250)?,
        time_class: TimeClass::Connected,
    };
    assert_eq!(
        first.timer_fired(forged_max, &mut scheduler),
        Err(ProposalLeaseError::UnknownTimer {
            timer_id: TimerId::new(SafeU53::MAX),
        }),
    );
    assert_eq!(first.retained_count(), safe_u(1)?);
    Ok(())
}

#[test]
fn arm_scheduler_failure_maps_error_and_rolls_back_proposal_state() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let _ = scheduler.dispose();

    let error = manager
        .arm(
            ProposalLeaseSpec {
                proposal: proposal("OP/disposed", "intent-a", 2, 1)?,
                absolute_ceiling_ms: None,
            },
            &mut scheduler,
        )
        .expect_err("disposed scheduler must fail");
    assert_eq!(
        error,
        ProposalLeaseError::Scheduler(SchedulerError::Disposed)
    );
    assert_eq!(manager.retained_count(), SafeU53::ZERO);
    assert!(manager.diagnostics().timer_ids.is_empty());
    assert!(scheduler.live_timers().is_empty());
    Ok(())
}

#[test]
fn retry_firing_requires_exact_removed_timer_and_is_atomic_on_identity_failure() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let retained = proposal("OP/retry", "intent-a", 2, 1)?;
    let outcome = manager.arm(
        ProposalLeaseSpec {
            proposal: retained.clone(),
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    let retry_id = scheduled_timer(&outcome.actions[1])
        .expect("retry schedule")
        .timer_id;
    let retry = scheduler.timer(retry_id).cloned().expect("live retry");
    assert_eq!(retry.delay_ms, safe_u(250)?);
    let removed = scheduler.fired(retry_id)?;
    let before = manager.diagnostics();

    let mut forged = removed.clone();
    forged.endpoint = retained.to;
    assert!(matches!(
        manager.timer_fired(forged, &mut scheduler),
        Err(ProposalLeaseError::InvalidProposal { .. })
    ));

    let mut forged_owner = removed.clone();
    forged_owner.owner.reason = "wrong-owner".to_owned();
    assert!(matches!(
        manager.timer_fired(forged_owner, &mut scheduler),
        Err(ProposalLeaseError::InvalidProposal { .. })
    ));

    let mut forged_class = removed.clone();
    forged_class.time_class = TimeClass::Absolute;
    assert!(matches!(
        manager.timer_fired(forged_class, &mut scheduler),
        Err(ProposalLeaseError::InvalidProposal { .. })
    ));

    let mut forged_delay = removed.clone();
    forged_delay.delay_ms = safe_u(999)?;
    assert!(matches!(
        manager.timer_fired(forged_delay, &mut scheduler),
        Err(ProposalLeaseError::InvalidProposal { .. })
    ));
    assert_eq!(manager.diagnostics(), before);
    assert!(scheduler.timer(retry_id).is_none());

    let expected_delay = safe_u(500)?;
    let actions = manager.timer_fired(removed.clone(), &mut scheduler)?;
    assert!(matches!(
        actions.as_slice(),
        [
            ProposalLeaseAction::Scheduler {
                command: SchedulerCommand::Schedule { timer }
            },
            ProposalLeaseAction::Send { proposal }
        ] if timer.delay_ms == expected_delay && proposal == &retained
    ));
    assert_eq!(manager.diagnostics().timer_ids.len(), 2);
    assert!(scheduler.timer(retry_id).is_none());

    let mut next_retry_id = scheduled_timer(&actions[0])
        .expect("next retry schedule")
        .timer_id;
    let mut retry_ids = BTreeSet::from([retry_id, next_retry_id]);
    for expected_delay in [1_000, 2_000, 4_000, 5_000, 5_000, 5_000] {
        let fired = scheduler.fired(next_retry_id)?;
        let actions = manager.timer_fired(fired, &mut scheduler)?;
        let next = scheduled_timer(&actions[0]).expect("capped retry schedule");
        assert_eq!(next.delay_ms, safe_u(expected_delay)?);
        assert_eq!(sent_proposal(&actions[1]), Some(&retained));
        assert!(retry_ids.insert(next.timer_id));
        next_retry_id = next.timer_id;
    }

    assert_eq!(
        manager.timer_fired(removed, &mut scheduler),
        Err(ProposalLeaseError::UnknownTimer { timer_id: retry_id }),
    );
    Ok(())
}

#[test]
fn retry_scheduler_failure_leaves_lease_state_unchanged_after_consumption() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let outcome = manager.arm(
        ProposalLeaseSpec {
            proposal: proposal("OP/retry-failure", "intent-a", 2, 1)?,
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    let retry_id = scheduled_timer(&outcome.actions[1])
        .expect("retry schedule")
        .timer_id;
    let removed = scheduler.fired(retry_id)?;
    let before = manager.diagnostics();
    let _ = scheduler.dispose();

    assert_eq!(
        manager.timer_fired(removed, &mut scheduler),
        Err(ProposalLeaseError::Scheduler(SchedulerError::Disposed)),
    );
    assert_eq!(manager.diagnostics(), before);
    assert!(scheduler.live_timers().is_empty());
    Ok(())
}

#[test]
fn stale_and_duplicate_observations_are_tombstoned_once_and_cancel_live_timers() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let operation_id = operation_id("OP/observed")?;

    let (settled, actions) = manager.observe_committed(&operation_id, &mut scheduler);
    assert!(!settled);
    assert!(actions.is_empty());
    assert!(
        manager
            .diagnostics()
            .committed_tombstones
            .contains(&operation_id)
    );
    let duplicate = manager.observe_committed(&operation_id, &mut scheduler);
    assert_eq!(duplicate, (false, Vec::new()));

    let retained = proposal("OP/observed", "intent-a", 2, 1)?;
    let outcome = manager.arm(
        ProposalLeaseSpec {
            proposal: retained.clone(),
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    assert_eq!(outcome.result, ProposalLeaseStart::AlreadyCommitted);
    assert_eq!(manager.retained_count(), SafeU53::ZERO);

    let live = proposal("OP/live", "intent-a", 2, 1)?;
    let live_outcome = manager.arm(
        ProposalLeaseSpec {
            proposal: live.clone(),
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    assert_eq!(live_outcome.result, ProposalLeaseStart::Retained);
    let (settled, cancel_actions) = manager.observe_committed(&live.operation_id, &mut scheduler);
    assert!(settled);
    assert_eq!(cancel_actions.len(), 2);
    assert_eq!(
        cancel_actions
            .iter()
            .filter_map(cancelled_timer)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            (live.from, TimerId::new(safe_u(0)?)),
            (live.from, TimerId::new(safe_u(1)?)),
        ]),
    );
    assert!(scheduler.live_timers().is_empty());

    let duplicate = manager.observe_committed(&live.operation_id, &mut scheduler);
    assert_eq!(duplicate, (false, Vec::new()));
    let late_arm = manager.arm(
        ProposalLeaseSpec {
            proposal: live,
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    assert_eq!(late_arm.result, ProposalLeaseStart::AlreadyCommitted);
    Ok(())
}

#[test]
fn absolute_expiry_cancels_retry_through_scheduler_and_terminalizes_once() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let retained = proposal("OP/expiry", "intent-a", 2, 1)?;
    let outcome = manager.arm(
        ProposalLeaseSpec {
            proposal: retained.clone(),
            absolute_ceiling_ms: Some(safe_u(1_000)?),
        },
        &mut scheduler,
    )?;
    let absolute_id = scheduled_timer(&outcome.actions[0])
        .expect("absolute schedule")
        .timer_id;
    let absolute = scheduler.fired(absolute_id)?;
    let actions = manager.timer_fired(absolute, &mut scheduler)?;
    assert_eq!(
        actions
            .iter()
            .filter_map(cancelled_timer)
            .collect::<Vec<_>>(),
        vec![(retained.from, TimerId::new(safe_u(1)?))],
    );
    assert!(matches!(
        actions.as_slice(),
        [
            ProposalLeaseAction::Scheduler {
                command: SchedulerCommand::Cancel { .. }
            },
            ProposalLeaseAction::Terminalize { operation_id, reason }
        ] if operation_id == &retained.operation_id
            && reason == "v2 proposal absolute ceiling"
    ));
    assert!(scheduler.live_timers().is_empty());
    assert_eq!(manager.retained_count(), SafeU53::ZERO);

    let duplicate = manager.timer_fired(
        ScheduledTimer {
            endpoint: retained.from,
            timer_id: absolute_id,
            owner: timer_owner("OP/expiry", "v2 proposal absolute ceiling"),
            delay_ms: safe_u(1_000)?,
            time_class: TimeClass::Absolute,
        },
        &mut scheduler,
    );
    assert_eq!(
        duplicate,
        Err(ProposalLeaseError::UnknownTimer {
            timer_id: absolute_id
        })
    );
    Ok(())
}

#[test]
fn equal_absolute_and_retry_deadline_terminalizes_before_retry_resend() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let retained = proposal("OP/deadline-boundary", "intent-a", 2, 1)?;
    let outcome = manager.arm(
        ProposalLeaseSpec {
            proposal: retained.clone(),
            absolute_ceiling_ms: Some(safe_u(250)?),
        },
        &mut scheduler,
    )?;
    let absolute_id = scheduled_timer(&outcome.actions[0])
        .expect("absolute schedule")
        .timer_id;
    let retry_id = scheduled_timer(&outcome.actions[1])
        .expect("retry schedule")
        .timer_id;
    let retry = scheduler.timer(retry_id).cloned().expect("live retry");
    assert_eq!(retry.delay_ms, safe_u(250)?);

    let absolute = scheduler.fired(absolute_id)?;
    assert_eq!(absolute.delay_ms, safe_u(250)?);
    let actions = manager.timer_fired(absolute, &mut scheduler)?;
    assert_eq!(
        actions
            .iter()
            .filter_map(cancelled_timer)
            .collect::<Vec<_>>(),
        vec![(retained.from, retry_id)],
    );
    assert!(!actions.iter().any(|action| sent_proposal(action).is_some()));
    assert!(matches!(
        actions.as_slice(),
        [
            ProposalLeaseAction::Scheduler {
                command: SchedulerCommand::Cancel { .. }
            },
            ProposalLeaseAction::Terminalize { operation_id, reason }
        ] if operation_id == &retained.operation_id
            && reason == "v2 proposal absolute ceiling"
    ));
    assert!(scheduler.live_timers().is_empty());
    assert_eq!(manager.retained_count(), SafeU53::ZERO);
    assert_eq!(
        manager.timer_fired(retry, &mut scheduler),
        Err(ProposalLeaseError::UnknownTimer { timer_id: retry_id }),
    );
    Ok(())
}

#[test]
fn rebind_resends_monotonically_without_moving_sender_local_timers() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let retained = proposal("OP/rebind", "intent-a", 2, 1)?;
    let outcome = manager.arm(
        ProposalLeaseSpec {
            proposal: retained.clone(),
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    let timer_ids = outcome
        .actions
        .iter()
        .filter_map(scheduled_timer)
        .map(|timer| timer.timer_id)
        .collect::<BTreeSet<_>>();
    let before_timers = scheduler.live_timers();

    let (count, actions) = manager.rebind(retained.to, ConnectionGeneration::new(safe_u(2)?))?;
    assert_eq!(count, safe_u(1)?);
    assert_eq!(actions.len(), 1);
    let rebound = sent_proposal(&actions[0]).expect("rebind resend");
    assert_eq!(rebound.to, retained.to);
    assert_eq!(rebound.from, retained.from);
    assert_eq!(
        rebound.connection_generation,
        ConnectionGeneration::new(safe_u(2)?)
    );
    assert_eq!(scheduler.live_timers(), before_timers);
    assert_eq!(
        scheduler
            .live_timers()
            .iter()
            .map(|timer| timer.timer_id)
            .collect::<BTreeSet<_>>(),
        timer_ids,
    );
    assert!(
        scheduler
            .live_timers()
            .iter()
            .all(|timer| timer.endpoint == retained.from)
    );

    let (stale_count, stale_actions) =
        manager.rebind(retained.to, ConnectionGeneration::new(safe_u(1)?))?;
    assert_eq!(stale_count, SafeU53::ZERO);
    assert!(stale_actions.is_empty());

    let stale_arm = manager.arm(
        ProposalLeaseSpec {
            proposal: proposal("OP/rebind", "intent-a", 3, 1)?,
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    assert_eq!(stale_arm.result, ProposalLeaseStart::Invalid);
    assert!(stale_arm.actions.is_empty());
    let (_, resend_actions) = manager.resend_retained();
    assert_eq!(resend_actions.len(), 1);
    assert_eq!(
        sent_proposal(&resend_actions[0])
            .expect("retained resend")
            .connection_generation,
        ConnectionGeneration::new(safe_u(2)?),
    );
    assert_eq!(scheduler.live_timers(), before_timers);
    Ok(())
}

#[test]
fn rearm_refreshes_destination_without_moving_sender_owned_timers() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let first = proposal("OP/rebind-destination", "intent-a", 2, 1)?;
    manager.arm(
        ProposalLeaseSpec {
            proposal: first.clone(),
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;

    let refreshed = proposal("OP/rebind-destination", "intent-a", 3, 1)?;
    let outcome = manager.arm(
        ProposalLeaseSpec {
            proposal: refreshed.clone(),
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    assert_eq!(outcome.result, ProposalLeaseStart::AlreadyRetained);
    assert_eq!(sent_proposal(&outcome.actions[0]), Some(&refreshed));

    let stale = manager.arm(
        ProposalLeaseSpec {
            proposal: proposal("OP/rebind-destination", "intent-a", 3, 0)?,
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    assert_eq!(stale.result, ProposalLeaseStart::Invalid);
    assert!(stale.actions.is_empty());
    let (settled, actions) = manager.observe_committed(&refreshed.operation_id, &mut scheduler);
    assert!(settled);
    assert_eq!(
        actions
            .iter()
            .filter_map(cancelled_timer)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            (first.from, TimerId::new(safe_u(0)?)),
            (first.from, TimerId::new(safe_u(1)?)),
        ]),
    );
    Ok(())
}

#[test]
fn rearm_rejects_sender_swap_at_equal_and_newer_generation_atomically() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let retained = proposal("OP/rearm-sender", "intent-a", 2, 1)?;

    let initial = manager.arm(
        ProposalLeaseSpec {
            proposal: retained.clone(),
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    assert_eq!(initial.result, ProposalLeaseStart::Retained);
    let diagnostics_before = manager.diagnostics();
    let timers_before = scheduler.live_timers();

    for generation in [1, 2] {
        let mut swapped = retained.clone();
        swapped.from = SeatId::new(safe_u(9)?);
        swapped.connection_generation = ConnectionGeneration::new(safe_u(generation)?);

        let outcome = manager.arm(
            ProposalLeaseSpec {
                proposal: swapped,
                absolute_ceiling_ms: None,
            },
            &mut scheduler,
        )?;
        assert_eq!(outcome.result, ProposalLeaseStart::Invalid);
        assert!(outcome.actions.is_empty());
        assert_eq!(manager.diagnostics(), diagnostics_before);
        assert_eq!(scheduler.live_timers(), timers_before);
    }

    let (resent, actions) = manager.resend_retained();
    assert_eq!(resent, safe_u(1)?);
    assert_eq!(actions.len(), 1);
    assert_eq!(sent_proposal(&actions[0]), Some(&retained));
    assert_eq!(manager.diagnostics(), diagnostics_before);
    assert_eq!(scheduler.live_timers(), timers_before);

    Ok(())
}

#[test]
fn disposal_is_idempotent_and_clears_only_owned_scheduler_timers() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut manager = ProposalLeaseManager::new(lease_config()?)?;
    let first = proposal("OP/first", "intent-a", 2, 1)?;
    manager.arm(
        ProposalLeaseSpec {
            proposal: first.clone(),
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    let unrelated = scheduler.schedule(
        SeatId::new(safe_u(9)?),
        TimerOwner {
            owner_id: "other-owner".to_owned(),
            address: "other".to_owned(),
            reason: "other".to_owned(),
        },
        safe_u(1)?,
        TimeClass::Absolute,
    )?;
    assert!(matches!(unrelated, SchedulerCommand::Schedule { .. }));

    let actions = manager.dispose("test teardown", &mut scheduler);
    assert_eq!(actions.len(), 2);
    assert_eq!(
        actions
            .iter()
            .filter_map(cancelled_timer)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            (first.from, TimerId::new(safe_u(0)?)),
            (first.from, TimerId::new(safe_u(1)?)),
        ]),
    );
    assert_eq!(scheduler.live_timers().len(), 1);
    assert_eq!(
        manager.dispose("duplicate teardown", &mut scheduler),
        Vec::new()
    );
    let diagnostics = manager.diagnostics();
    assert!(diagnostics.disposed);
    assert!(diagnostics.live_operation_ids.is_empty());
    assert!(diagnostics.committed_tombstones.is_empty());
    assert!(diagnostics.timer_ids.is_empty());
    assert_eq!(manager.retained_count(), SafeU53::ZERO);
    assert_eq!(manager.resend_retained(), (SafeU53::ZERO, Vec::new()));
    Ok(())
}
