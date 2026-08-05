use std::error::Error;

use er_protocol::{ScheduledTimer, SchedulerCommand};
use er_sim::{ClockEvent, VirtualClock, VirtualClockError};
use er_types::{SafeU53, SeatId, TimeClass, TimerId, TimerOwner};

type TestResult = Result<(), Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn timer(value: u64) -> TimerId {
    TimerId::new(safe(value))
}

fn schedule(
    endpoint: u64,
    timer_id: u64,
    delay_ms: u64,
    time_class: TimeClass,
) -> Result<SchedulerCommand, Box<dyn Error>> {
    Ok(SchedulerCommand::Schedule {
        timer: ScheduledTimer {
            endpoint: seat(endpoint),
            timer_id: timer(timer_id),
            owner: TimerOwner::new(
                format!("clock-owner-{timer_id}"),
                format!("clock-address-{timer_id}"),
                "clock-test",
            )?,
            delay_ms: safe(delay_ms),
            time_class,
        },
    })
}

fn cancel(endpoint: u64, timer_id: u64) -> SchedulerCommand {
    SchedulerCommand::Cancel {
        endpoint: seat(endpoint),
        timer_id: timer(timer_id),
    }
}

fn pause(endpoint: u64, time_class: TimeClass, reason: &str) -> SchedulerCommand {
    SchedulerCommand::PauseClass {
        endpoint: seat(endpoint),
        time_class,
        reason: reason.to_owned(),
    }
}

fn resume(endpoint: u64, time_class: TimeClass, reason: &str) -> SchedulerCommand {
    SchedulerCommand::ResumeClass {
        endpoint: seat(endpoint),
        time_class,
        reason: reason.to_owned(),
    }
}

fn fired(endpoint: u64, timer_id: u64) -> ClockEvent {
    ClockEvent::TimerFired {
        endpoint: seat(endpoint),
        timer_id: timer(timer_id),
    }
}

#[test]
fn equal_deadlines_fire_by_deadline_then_timer_id_and_remove_before_return() -> TestResult {
    let mut clock = VirtualClock::new();
    clock.apply(schedule(1, 20, 10, TimeClass::Connected)?)?;
    clock.apply(schedule(1, 3, 10, TimeClass::Connected)?)?;
    clock.apply(schedule(1, 2, 5, TimeClass::Connected)?)?;

    assert_eq!(clock.next_deadline_delta(), Some(safe(5)));
    assert!(clock.advance(safe(4))?.is_empty());
    assert_eq!(clock.next_deadline_delta(), Some(safe(1)));

    let events = clock.advance(safe(6))?;
    assert_eq!(events, vec![fired(1, 2), fired(1, 3), fired(1, 20)]);
    assert_eq!(clock.now(), safe(10));
    assert!(clock.pending_timers().is_empty());
    assert!(clock.timer(timer(2)).is_none());
    assert!(clock.timer(timer(3)).is_none());
    assert!(clock.timer(timer(20)).is_none());
    assert!(clock.sync()?.is_empty());
    Ok(())
}

#[test]
fn active_counters_are_per_endpoint_and_pause_reasons_are_nested_and_idempotent() -> TestResult {
    let mut clock = VirtualClock::new();
    clock.advance(safe(10))?;

    for time_class in [
        TimeClass::Connected,
        TimeClass::Recovery,
        TimeClass::Renderer,
        TimeClass::HumanInput,
        TimeClass::Absolute,
    ] {
        assert_eq!(clock.class_now(seat(1), time_class), safe(10));
        assert_eq!(clock.class_now(seat(2), time_class), safe(10));
    }

    clock.apply(pause(1, TimeClass::Connected, "disconnect"))?;
    clock.apply(pause(1, TimeClass::Connected, "disconnect"))?;
    clock.apply(pause(1, TimeClass::Connected, "modal"))?;
    assert!(clock.is_class_paused(seat(1), TimeClass::Connected));
    assert!(!clock.is_class_paused(seat(1), TimeClass::Absolute));

    clock.advance(safe(20))?;
    assert_eq!(clock.now(), safe(30));
    assert_eq!(clock.class_now(seat(1), TimeClass::Connected), safe(10));
    assert_eq!(clock.class_now(seat(2), TimeClass::Connected), safe(30));
    assert_eq!(clock.class_now(seat(1), TimeClass::Absolute), safe(30));

    clock.apply(resume(1, TimeClass::Connected, "disconnect"))?;
    assert!(clock.is_class_paused(seat(1), TimeClass::Connected));
    clock.apply(resume(1, TimeClass::Connected, "disconnect"))?;
    assert!(clock.is_class_paused(seat(1), TimeClass::Connected));
    clock.apply(resume(1, TimeClass::Connected, "modal"))?;
    assert!(!clock.is_class_paused(seat(1), TimeClass::Connected));

    clock.advance(safe(5))?;
    assert_eq!(clock.class_now(seat(1), TimeClass::Connected), safe(15));
    assert_eq!(clock.class_now(seat(1), TimeClass::Absolute), safe(35));
    Ok(())
}

#[test]
fn disconnect_and_suspend_pause_mechanical_classes_but_absolute_always_advances() -> TestResult {
    let mut clock = VirtualClock::new();
    clock.apply(schedule(1, 0, 10, TimeClass::Connected)?)?;
    clock.apply(schedule(1, 1, 10, TimeClass::Recovery)?)?;
    clock.apply(schedule(1, 2, 10, TimeClass::Renderer)?)?;
    clock.apply(schedule(1, 3, 10, TimeClass::HumanInput)?)?;
    clock.apply(schedule(1, 4, 10, TimeClass::Absolute)?)?;

    clock.apply(pause(1, TimeClass::Connected, "disconnect"))?;
    for time_class in [
        TimeClass::Recovery,
        TimeClass::Renderer,
        TimeClass::HumanInput,
    ] {
        clock.apply(pause(1, time_class, "suspend"))?;
    }
    clock.apply(pause(1, TimeClass::Absolute, "suspend"))?;
    assert!(!clock.is_class_paused(seat(1), TimeClass::Absolute));

    let events = clock.advance(safe(50))?;
    assert_eq!(events, vec![fired(1, 4)]);
    for timer_id in 0..4 {
        let snapshot = clock.timer(timer(timer_id));
        assert!(snapshot.is_some());
        if let Some(snapshot) = snapshot {
            assert_eq!(snapshot.remaining_active_ms, safe(10));
            assert!(snapshot.paused);
        }
    }
    assert_eq!(clock.class_now(seat(1), TimeClass::Connected), safe(0));
    assert_eq!(clock.class_now(seat(1), TimeClass::Recovery), safe(0));
    assert_eq!(clock.class_now(seat(1), TimeClass::Renderer), safe(0));
    assert_eq!(clock.class_now(seat(1), TimeClass::HumanInput), safe(0));
    assert_eq!(clock.class_now(seat(1), TimeClass::Absolute), safe(50));
    assert_eq!(clock.next_deadline_delta(), None);

    clock.apply(resume(1, TimeClass::Connected, "disconnect"))?;
    for time_class in [
        TimeClass::Recovery,
        TimeClass::Renderer,
        TimeClass::HumanInput,
    ] {
        clock.apply(resume(1, time_class, "suspend"))?;
    }
    assert_eq!(clock.next_deadline_delta(), Some(safe(10)));
    assert!(clock.advance(safe(9))?.is_empty());
    assert_eq!(clock.class_now(seat(1), TimeClass::Connected), safe(9));
    assert_eq!(clock.class_now(seat(1), TimeClass::Absolute), safe(59));

    assert_eq!(
        clock.advance(safe(1))?,
        vec![fired(1, 0), fired(1, 1), fired(1, 2), fired(1, 3)]
    );
    assert!(clock.pending_timers().is_empty());
    Ok(())
}

#[test]
fn cancellation_is_endpoint_checked_and_duplicate_schedule_is_rejected() -> TestResult {
    let mut clock = VirtualClock::new();
    let command = schedule(1, 9, 10, TimeClass::HumanInput)?;
    clock.apply(command.clone())?;
    assert_eq!(
        clock.apply(command),
        Err(VirtualClockError::DuplicateTimer { timer_id: timer(9) })
    );

    assert_eq!(
        clock.apply(cancel(2, 9)),
        Err(VirtualClockError::UnknownTimer { timer_id: timer(9) })
    );
    assert!(clock.timer(timer(9)).is_some());
    clock.apply(cancel(1, 9))?;
    assert!(clock.timer(timer(9)).is_none());
    assert!(clock.pending_timers().is_empty());
    assert!(clock.advance(safe(20))?.is_empty());
    assert_eq!(
        clock.apply(cancel(1, 9)),
        Err(VirtualClockError::UnknownTimer { timer_id: timer(9) })
    );
    Ok(())
}

#[test]
fn overflow_is_fallible_without_advancing_or_registering_a_timer() -> TestResult {
    let mut clock = VirtualClock::new();
    clock.advance(SafeU53::MAX)?;
    assert_eq!(clock.advance(safe(1)), Err(VirtualClockError::TimeOverflow));
    assert_eq!(clock.now(), SafeU53::MAX);
    assert_eq!(
        clock.apply(schedule(1, 1, 1, TimeClass::Absolute)?),
        Err(VirtualClockError::TimeOverflow)
    );
    assert!(clock.pending_timers().is_empty());
    Ok(())
}

#[test]
fn disposal_is_idempotent_and_leaves_zero_live_timers() -> TestResult {
    let mut clock = VirtualClock::new();
    clock.apply(schedule(1, 11, 25, TimeClass::Recovery)?)?;
    clock.apply(pause(1, TimeClass::Recovery, "suspend"))?;
    clock.advance(safe(4))?;
    assert_eq!(clock.pending_timers().len(), 1);

    clock.dispose();
    clock.dispose();
    assert!(clock.pending_timers().is_empty());
    assert!(clock.timer(timer(11)).is_none());
    assert_eq!(clock.now(), safe(4));
    assert_eq!(
        clock.apply(schedule(1, 12, 1, TimeClass::Absolute)?),
        Err(VirtualClockError::Disposed)
    );
    assert_eq!(clock.advance(safe(1)), Err(VirtualClockError::Disposed));
    assert_eq!(clock.sync(), Err(VirtualClockError::Disposed));
    Ok(())
}

#[test]
fn empty_pause_reasons_are_rejected_without_changing_class_state() -> TestResult {
    let mut clock = VirtualClock::new();
    assert_eq!(
        clock.apply(pause(1, TimeClass::Connected, "")),
        Err(VirtualClockError::InvalidCommand {
            reason: "pause reason must not be empty".to_owned(),
        })
    );
    assert!(!clock.is_class_paused(seat(1), TimeClass::Connected));
    clock.advance(safe(5))?;
    assert_eq!(clock.class_now(seat(1), TimeClass::Connected), safe(5));
    Ok(())
}
