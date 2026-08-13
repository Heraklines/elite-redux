use er_protocol::{KernelScheduler, ScheduledTimer, SchedulerCommand, SchedulerError, TimerSpec};
use er_types::{SafeU53, SafeU53Error, SeatId, TimeClass, TimerId, TimerOwner};
use serde_json::json;

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn safe(value: u64) -> Result<SafeU53, SafeU53Error> {
    SafeU53::new(value)
}

fn seat(value: u64) -> Result<SeatId, SafeU53Error> {
    safe(value).map(SeatId::new)
}

fn timer(value: u64) -> Result<TimerId, SafeU53Error> {
    safe(value).map(TimerId::new)
}

fn owner(owner_id: &str, address: &str, reason: &str) -> TimerOwner {
    TimerOwner {
        owner_id: owner_id.to_owned(),
        address: address.to_owned(),
        reason: reason.to_owned(),
    }
}

fn scheduled_timer(
    endpoint: SeatId,
    timer_id: TimerId,
    timer_owner: TimerOwner,
    delay_ms: SafeU53,
    time_class: TimeClass,
) -> ScheduledTimer {
    ScheduledTimer {
        endpoint,
        timer_id,
        owner: timer_owner,
        delay_ms,
        time_class,
    }
}

fn timer_spec(
    endpoint: SeatId,
    timer_owner: TimerOwner,
    delay_ms: SafeU53,
    time_class: TimeClass,
) -> TimerSpec {
    TimerSpec {
        endpoint,
        owner: timer_owner,
        delay_ms,
        time_class,
    }
}

#[test]
fn schedule_allocates_deterministic_ids_and_preserves_complete_metadata() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let first = scheduled_timer(
        seat(2)?,
        timer(0)?,
        owner("delivery", "delivery/2/17", "redelivery backoff"),
        safe(250)?,
        TimeClass::Connected,
    );
    let second = scheduled_timer(
        seat(1)?,
        timer(1)?,
        owner("recovery", "recovery/request", "recovery deadline"),
        safe(300_000)?,
        TimeClass::Recovery,
    );

    assert_eq!(
        scheduler.schedule(
            first.endpoint,
            first.owner.clone(),
            first.delay_ms,
            first.time_class,
        )?,
        SchedulerCommand::Schedule {
            timer: first.clone(),
        }
    );
    assert_eq!(scheduler.timer(first.timer_id), Some(&first));

    assert_eq!(
        scheduler.schedule(
            second.endpoint,
            second.owner.clone(),
            second.delay_ms,
            second.time_class,
        )?,
        SchedulerCommand::Schedule {
            timer: second.clone(),
        }
    );
    assert_eq!(scheduler.timer(second.timer_id), Some(&second));
    assert_eq!(scheduler.live_timers(), vec![first, second]);
    assert_eq!(scheduler.pending_timer_count(), safe(2)?);
    Ok(())
}

#[test]
fn schedule_batch_allocates_in_input_order_and_preserves_metadata() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let specs = vec![
        timer_spec(
            seat(2)?,
            owner("delivery", "delivery/2/17", "redelivery backoff"),
            safe(250)?,
            TimeClass::Connected,
        ),
        timer_spec(
            seat(1)?,
            owner("recovery", "recovery/request", "recovery deadline"),
            safe(300_000)?,
            TimeClass::Recovery,
        ),
    ];

    assert_eq!(
        scheduler.schedule_batch(specs),
        Ok(vec![
            SchedulerCommand::Schedule {
                timer: scheduled_timer(
                    seat(2)?,
                    timer(0)?,
                    owner("delivery", "delivery/2/17", "redelivery backoff"),
                    safe(250)?,
                    TimeClass::Connected,
                ),
            },
            SchedulerCommand::Schedule {
                timer: scheduled_timer(
                    seat(1)?,
                    timer(1)?,
                    owner("recovery", "recovery/request", "recovery deadline"),
                    safe(300_000)?,
                    TimeClass::Recovery,
                ),
            },
        ])
    );
    assert_eq!(
        scheduler.live_timers(),
        vec![
            scheduled_timer(
                seat(2)?,
                timer(0)?,
                owner("delivery", "delivery/2/17", "redelivery backoff"),
                safe(250)?,
                TimeClass::Connected,
            ),
            scheduled_timer(
                seat(1)?,
                timer(1)?,
                owner("recovery", "recovery/request", "recovery deadline"),
                safe(300_000)?,
                TimeClass::Recovery,
            ),
        ]
    );
    Ok(())
}

#[test]
fn schedule_batch_empty_does_not_consume_an_id() -> TestResult {
    let mut scheduler = KernelScheduler::new();

    assert_eq!(scheduler.schedule_batch(Vec::new())?, Vec::new());
    assert_eq!(scheduler.pending_timer_count(), SafeU53::ZERO);
    assert_eq!(
        scheduler.schedule(
            seat(1)?,
            owner("owner", "address", "reason"),
            safe(1)?,
            TimeClass::Absolute,
        )?,
        SchedulerCommand::Schedule {
            timer: scheduled_timer(
                seat(1)?,
                timer(0)?,
                owner("owner", "address", "reason"),
                safe(1)?,
                TimeClass::Absolute,
            ),
        }
    );
    Ok(())
}

#[test]
fn schedule_batch_rejects_disposed_scheduler_without_mutation() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    assert_eq!(scheduler.dispose(), Vec::new());

    let spec = timer_spec(
        seat(1)?,
        owner("owner", "address", "reason"),
        safe(1)?,
        TimeClass::Absolute,
    );
    assert_eq!(
        scheduler.schedule_batch(vec![spec]),
        Err(SchedulerError::Disposed)
    );
    assert_eq!(scheduler.live_timers(), Vec::new());
    assert_eq!(scheduler.pending_timer_count(), SafeU53::ZERO);
    assert!(scheduler.is_disposed());
    Ok(())
}

#[test]
fn scheduler_commands_keep_the_frozen_serde_shape() -> TestResult {
    let spec = timer_spec(
        seat(3)?,
        owner("input-router", "input-repeat/UP", "input-repeat"),
        safe(250)?,
        TimeClass::HumanInput,
    );
    let expected_spec = json!({
        "endpoint": 3,
        "owner": {
            "ownerId": "input-router",
            "address": "input-repeat/UP",
            "reason": "input-repeat"
        },
        "delayMs": 250,
        "timeClass": "humanInput"
    });
    let encoded_spec = serde_json::to_value(&spec)?;
    assert_eq!(encoded_spec, expected_spec);
    let decoded_spec = serde_json::from_value::<TimerSpec>(encoded_spec)?;
    assert_eq!(decoded_spec, spec);

    let command = SchedulerCommand::Schedule {
        timer: scheduled_timer(
            seat(3)?,
            timer(4)?,
            spec.owner.clone(),
            spec.delay_ms,
            spec.time_class,
        ),
    };
    let expected = json!({
        "kind": "SCHEDULE",
        "timer": {
            "endpoint": 3,
            "timerId": 4,
            "owner": {
                "ownerId": "input-router",
                "address": "input-repeat/UP",
                "reason": "input-repeat"
            },
            "delayMs": 250,
            "timeClass": "humanInput"
        }
    });

    let encoded = serde_json::to_value(&command)?;
    assert_eq!(encoded, expected);
    let decoded = serde_json::from_value::<SchedulerCommand>(encoded)?;
    assert_eq!(decoded, command);
    Ok(())
}

#[test]
fn fired_removes_before_return_and_keeps_remaining_timer_order() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let first = scheduled_timer(
        seat(1)?,
        timer(0)?,
        owner("same-owner", "first", "first reason"),
        safe(10)?,
        TimeClass::Renderer,
    );
    let second = scheduled_timer(
        seat(1)?,
        timer(1)?,
        owner("same-owner", "second", "second reason"),
        safe(20)?,
        TimeClass::Renderer,
    );
    let third = scheduled_timer(
        seat(1)?,
        timer(2)?,
        owner("other-owner", "third", "third reason"),
        safe(30)?,
        TimeClass::Absolute,
    );
    scheduler.schedule(
        first.endpoint,
        first.owner.clone(),
        first.delay_ms,
        first.time_class,
    )?;
    scheduler.schedule(
        second.endpoint,
        second.owner.clone(),
        second.delay_ms,
        second.time_class,
    )?;
    scheduler.schedule(
        third.endpoint,
        third.owner.clone(),
        third.delay_ms,
        third.time_class,
    )?;

    assert_eq!(scheduler.fired(second.timer_id)?, second);
    assert_eq!(scheduler.timer(timer(1)?), None);
    assert_eq!(scheduler.pending_timer_count(), safe(2)?);
    assert_eq!(
        scheduler.fired(timer(1)?),
        Err(SchedulerError::UnknownTimer {
            timer_id: timer(1)?
        })
    );
    assert_eq!(
        scheduler.cancel(first.timer_id),
        Some(SchedulerCommand::Cancel {
            endpoint: first.endpoint,
            timer_id: first.timer_id,
        })
    );
    assert_eq!(scheduler.cancel(first.timer_id), None);
    assert_eq!(scheduler.live_timers(), vec![third]);
    Ok(())
}

#[test]
fn cancelled_and_fired_ids_are_never_recycled() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let endpoint = seat(1)?;

    assert_eq!(
        scheduler.schedule(
            endpoint,
            owner("cancelled", "cancelled", "cancelled"),
            safe(10)?,
            TimeClass::Absolute,
        )?,
        SchedulerCommand::Schedule {
            timer: scheduled_timer(
                endpoint,
                timer(0)?,
                owner("cancelled", "cancelled", "cancelled"),
                safe(10)?,
                TimeClass::Absolute,
            ),
        }
    );
    assert_eq!(
        scheduler.cancel(timer(0)?),
        Some(SchedulerCommand::Cancel {
            endpoint,
            timer_id: timer(0)?,
        })
    );

    assert_eq!(
        scheduler.schedule(
            endpoint,
            owner("fired", "fired", "fired"),
            safe(20)?,
            TimeClass::Absolute,
        )?,
        SchedulerCommand::Schedule {
            timer: scheduled_timer(
                endpoint,
                timer(1)?,
                owner("fired", "fired", "fired"),
                safe(20)?,
                TimeClass::Absolute,
            ),
        }
    );
    assert_eq!(
        scheduler.fired(timer(1)?)?,
        scheduled_timer(
            endpoint,
            timer(1)?,
            owner("fired", "fired", "fired"),
            safe(20)?,
            TimeClass::Absolute,
        )
    );

    assert_eq!(
        scheduler.schedule(
            endpoint,
            owner("fresh", "fresh", "fresh"),
            safe(30)?,
            TimeClass::Absolute,
        )?,
        SchedulerCommand::Schedule {
            timer: scheduled_timer(
                endpoint,
                timer(2)?,
                owner("fresh", "fresh", "fresh"),
                safe(30)?,
                TimeClass::Absolute,
            ),
        }
    );
    Ok(())
}

#[test]
fn cancel_owner_is_idempotent_and_orders_commands_by_timer_id() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    for (endpoint, owner_id, address) in [
        (seat(2)?, "owner-a", "a/first"),
        (seat(2)?, "owner-b", "b/only"),
        (seat(1)?, "owner-a", "a/second"),
    ] {
        scheduler.schedule(
            endpoint,
            owner(owner_id, address, "test"),
            safe(100)?,
            TimeClass::Connected,
        )?;
    }

    assert_eq!(
        scheduler.cancel_owner("owner-a"),
        vec![
            SchedulerCommand::Cancel {
                endpoint: seat(2)?,
                timer_id: timer(0)?,
            },
            SchedulerCommand::Cancel {
                endpoint: seat(1)?,
                timer_id: timer(2)?,
            },
        ]
    );
    assert_eq!(scheduler.cancel_owner("owner-a"), Vec::new());
    assert_eq!(scheduler.pending_timer_count(), safe(1)?);
    assert_eq!(scheduler.live_timers()[0].timer_id, timer(1)?);
    Ok(())
}

#[test]
fn absolute_pause_and_resume_ignore_empty_reasons() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let endpoint = seat(1)?;

    assert_eq!(
        scheduler.pause_class(endpoint, TimeClass::Absolute, ""),
        Ok(None)
    );
    assert_eq!(
        scheduler.resume_class(endpoint, TimeClass::Absolute, ""),
        Ok(None)
    );

    scheduler.dispose();
    assert_eq!(
        scheduler.pause_class(endpoint, TimeClass::Absolute, ""),
        Ok(None)
    );
    assert_eq!(
        scheduler.resume_class(endpoint, TimeClass::Absolute, ""),
        Ok(None)
    );
    Ok(())
}

#[test]
fn explicit_pause_reasons_compose_per_endpoint_and_class() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let endpoint = seat(1)?;
    let other_endpoint = seat(2)?;

    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Connected));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Recovery));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Renderer));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::HumanInput));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Absolute));

    assert_eq!(
        scheduler.pause_class(endpoint, TimeClass::Connected, "disconnect"),
        Ok(Some(SchedulerCommand::PauseClass {
            endpoint,
            time_class: TimeClass::Connected,
            reason: "disconnect".to_owned(),
        }))
    );
    assert_eq!(
        scheduler.pause_class(endpoint, TimeClass::Connected, "disconnect"),
        Ok(None)
    );
    assert_eq!(
        scheduler.pause_class(endpoint, TimeClass::Connected, "hidden"),
        Ok(Some(SchedulerCommand::PauseClass {
            endpoint,
            time_class: TimeClass::Connected,
            reason: "hidden".to_owned(),
        }))
    );
    assert!(scheduler.is_class_paused(endpoint, TimeClass::Connected));
    assert!(!scheduler.is_class_paused(other_endpoint, TimeClass::Connected));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Recovery));

    assert_eq!(
        scheduler.resume_class(endpoint, TimeClass::Connected, "disconnect"),
        Ok(Some(SchedulerCommand::ResumeClass {
            endpoint,
            time_class: TimeClass::Connected,
            reason: "disconnect".to_owned(),
        }))
    );
    assert!(scheduler.is_class_paused(endpoint, TimeClass::Connected));
    assert_eq!(
        scheduler.resume_class(endpoint, TimeClass::Connected, "missing"),
        Ok(None)
    );
    assert_eq!(
        scheduler.resume_class(endpoint, TimeClass::Connected, "hidden"),
        Ok(Some(SchedulerCommand::ResumeClass {
            endpoint,
            time_class: TimeClass::Connected,
            reason: "hidden".to_owned(),
        }))
    );
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Connected));
    assert_eq!(
        scheduler.resume_class(endpoint, TimeClass::Connected, "hidden"),
        Ok(None)
    );

    assert_eq!(
        scheduler.pause_class(endpoint, TimeClass::Absolute, "safety"),
        Ok(None)
    );
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Absolute));
    assert_eq!(
        scheduler.resume_class(endpoint, TimeClass::Absolute, "safety"),
        Ok(None)
    );
    assert_eq!(
        scheduler.pause_class(endpoint, TimeClass::Renderer, ""),
        Err(SchedulerError::EmptyPauseReason)
    );
    Ok(())
}

#[test]
fn connection_and_suspension_controls_have_class_specific_effects() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let endpoint = seat(7)?;

    assert_eq!(
        scheduler.set_connected(endpoint, false)?,
        vec![SchedulerCommand::PauseClass {
            endpoint,
            time_class: TimeClass::Connected,
            reason: "disconnected".to_owned(),
        }]
    );
    assert_eq!(scheduler.set_connected(endpoint, false)?, Vec::new());
    assert!(scheduler.is_class_paused(endpoint, TimeClass::Connected));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Recovery));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Renderer));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::HumanInput));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Absolute));

    assert_eq!(
        scheduler.set_suspended(endpoint, true)?,
        vec![
            SchedulerCommand::PauseClass {
                endpoint,
                time_class: TimeClass::Connected,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::PauseClass {
                endpoint,
                time_class: TimeClass::Recovery,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::PauseClass {
                endpoint,
                time_class: TimeClass::Renderer,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::PauseClass {
                endpoint,
                time_class: TimeClass::HumanInput,
                reason: "suspended".to_owned(),
            },
        ]
    );
    assert_eq!(scheduler.set_suspended(endpoint, true)?, Vec::new());
    for time_class in [
        TimeClass::Connected,
        TimeClass::Recovery,
        TimeClass::Renderer,
        TimeClass::HumanInput,
    ] {
        assert!(scheduler.is_class_paused(endpoint, time_class));
    }
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Absolute));

    assert_eq!(
        scheduler.set_suspended(endpoint, false)?,
        vec![
            SchedulerCommand::ResumeClass {
                endpoint,
                time_class: TimeClass::Connected,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::ResumeClass {
                endpoint,
                time_class: TimeClass::Recovery,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::ResumeClass {
                endpoint,
                time_class: TimeClass::Renderer,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::ResumeClass {
                endpoint,
                time_class: TimeClass::HumanInput,
                reason: "suspended".to_owned(),
            },
        ]
    );
    assert!(scheduler.is_class_paused(endpoint, TimeClass::Connected));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Recovery));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Renderer));
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::HumanInput));

    assert_eq!(
        scheduler.set_connected(endpoint, true)?,
        vec![SchedulerCommand::ResumeClass {
            endpoint,
            time_class: TimeClass::Connected,
            reason: "disconnected".to_owned(),
        }]
    );
    assert!(!scheduler.is_class_paused(endpoint, TimeClass::Connected));
    assert_eq!(scheduler.set_connected(endpoint, true)?, Vec::new());
    Ok(())
}

#[test]
fn dispose_cancels_all_live_resources_and_rejects_future_transitions() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    scheduler.schedule(
        seat(1)?,
        owner("first", "first", "first"),
        safe(10)?,
        TimeClass::Connected,
    )?;
    scheduler.schedule(
        seat(2)?,
        owner("second", "second", "second"),
        safe(20)?,
        TimeClass::Absolute,
    )?;
    let _ = scheduler.pause_class(seat(1)?, TimeClass::Connected, "manual")?;

    assert_eq!(
        scheduler.dispose(),
        vec![
            SchedulerCommand::Cancel {
                endpoint: seat(1)?,
                timer_id: timer(0)?,
            },
            SchedulerCommand::Cancel {
                endpoint: seat(2)?,
                timer_id: timer(1)?,
            },
        ]
    );
    assert!(scheduler.is_disposed());
    assert_eq!(scheduler.dispose(), Vec::new());
    assert_eq!(scheduler.live_timers(), Vec::new());
    assert_eq!(scheduler.pending_timer_count(), SafeU53::ZERO);
    assert_eq!(scheduler.timer(timer(0)?), None);
    assert!(!scheduler.is_class_paused(seat(1)?, TimeClass::Connected));
    assert_eq!(scheduler.cancel(timer(0)?), None);
    assert_eq!(scheduler.cancel_owner("first"), Vec::new());
    assert_eq!(
        scheduler.schedule(
            seat(1)?,
            owner("later", "later", "later"),
            safe(1)?,
            TimeClass::Connected,
        ),
        Err(SchedulerError::Disposed)
    );
    assert_eq!(
        scheduler.pause_class(seat(1)?, TimeClass::Connected, "later"),
        Err(SchedulerError::Disposed)
    );
    assert_eq!(
        scheduler.resume_class(seat(1)?, TimeClass::Connected, "later"),
        Err(SchedulerError::Disposed)
    );
    assert_eq!(
        scheduler.set_connected(seat(1)?, false),
        Err(SchedulerError::Disposed)
    );
    assert_eq!(
        scheduler.set_suspended(seat(1)?, true),
        Err(SchedulerError::Disposed)
    );
    assert_eq!(
        scheduler.fired(timer(1)?),
        Err(SchedulerError::UnknownTimer {
            timer_id: timer(1)?
        })
    );
    Ok(())
}
