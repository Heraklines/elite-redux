use std::error::Error;
use std::sync::{Arc, OnceLock};

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_internal_event_v2::GameInternalEventKindV2;
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7, GameKernelV7Error,
};
use er_kernel::snapshot::{KernelSchedulerSnapshotV2, TimeClassPauseSnapshotV2};
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_state::m7_state::{DexState, ProfileStateV1, ProfileStatistics};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameButton, GameControlKindV2, SafeU53, SeatId, TimeClass, TimerId};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type Checkpoint = (Arc<PreparedGameContentV2>, CoreGameKernelSnapshotV7);

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn seat() -> SeatId {
    SeatId::new(safe(1))
}

fn key_down(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

fn press(kernel: &mut GameKernelV7, code: PhysicalKey) -> TestResult<GameKernelStepV7> {
    let step = kernel.raw_input(key_down(code.clone()))?;
    kernel.raw_input(RawInputEvent::KeyUp { code })?;
    Ok(step)
}

fn selected(kernel: &GameKernelV7) -> &str {
    kernel
        .current_control()
        .expect("current control")
        .menu
        .as_ref()
        .expect("current menu")
        .selected_option_id
        .as_str()
}

fn create_checkpoint() -> TestResult<Checkpoint> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let profile = ProfileStateV1 {
        schema_version: 1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: Default::default(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(safe(1))?,
        },
        dex: DexState::default(),
    };
    let mut kernel = GameKernelV7::natural_start(
        profile,
        "m9e-timer-natural".to_owned(),
        seat(),
        vec!["preview-slot".to_owned()],
        true,
        content.clone(),
        KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        None,
    )?;
    assert_eq!(
        kernel.current_control().expect("title control").kind,
        GameControlKindV2::Title
    );
    for _ in 0..3 {
        press(&mut kernel, PhysicalKey::Space)?;
    }
    let bound = kernel
        .current_control()
        .expect("starter control")
        .menu
        .as_ref()
        .expect("starter menu")
        .options
        .len()
        + 1;
    for _ in 0..bound {
        if selected(&kernel) == "bootstrap/starter/confirm" {
            break;
        }
        press(&mut kernel, PhysicalKey::ArrowDown)?;
    }
    assert_eq!(selected(&kernel), "bootstrap/starter/confirm");
    for _ in 0..4 {
        press(&mut kernel, PhysicalKey::Space)?;
    }
    let pending = kernel.snapshot()?.pending_presentations;
    for presentation in pending {
        kernel.settle_presentation(presentation.event_id)?;
    }
    assert_eq!(
        kernel.current_control().expect("battle control").kind,
        GameControlKindV2::BattleCommand
    );
    assert_eq!(selected(&kernel), "battle/command/fight");
    let snapshot = kernel.snapshot()?;
    assert!(snapshot.input_router.repeats.is_empty());
    assert!(snapshot.scheduler.timers.is_empty());
    Ok((content, snapshot))
}

fn checkpoint() -> TestResult<&'static Checkpoint> {
    static CHECKPOINT: OnceLock<Result<Checkpoint, String>> = OnceLock::new();
    CHECKPOINT
        .get_or_init(|| create_checkpoint().map_err(|error| error.to_string()))
        .as_ref()
        .map_err(|error| error.clone().into())
}

fn restore(snapshot: CoreGameKernelSnapshotV7) -> TestResult<GameKernelV7> {
    Ok(GameKernelV7::from_snapshot(
        snapshot,
        seat(),
        GameKernelRoleV7::Authority,
        checkpoint()?.0.clone(),
    )?)
}

fn active() -> TestResult<GameKernelV7> {
    restore(checkpoint()?.1.clone())
}

fn cursor_effects(step: &GameKernelStepV7) -> Vec<&str> {
    step.effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::UiChanged(control) => control
                .menu
                .as_ref()
                .map(|menu| menu.selected_option_id.as_str()),
            _ => None,
        })
        .collect()
}

#[test]
fn held_navigation_repeats_at_250ms_with_real_cursor_effects() -> TestResult {
    let mut kernel = active()?;
    let immediate = kernel.raw_input(key_down(PhysicalKey::ArrowDown))?;
    assert_eq!(cursor_effects(&immediate), ["battle/command/party"]);
    let before = kernel.snapshot()?;
    assert_eq!(before.input_router.repeats.len(), 1);
    assert!(kernel.advance_time(safe(249))?.effects.is_empty());
    assert_eq!(selected(&kernel), "battle/command/party");
    assert_eq!(
        kernel.snapshot()?.scheduler.timers[0].remaining_active_ms,
        safe(1)
    );
    let first = kernel.advance_time(safe(1))?;
    assert_eq!(first.internal_events, [GameInternalEventKindV2::TimerFired]);
    assert_eq!(cursor_effects(&first), ["battle/command/fight"]);
    assert_eq!(selected(&kernel), "battle/command/fight");
    let second = kernel.advance_time(safe(250))?;
    assert_eq!(cursor_effects(&second), ["battle/command/party"]);
    assert_eq!(selected(&kernel), "battle/command/party");
    let after = kernel.snapshot()?;
    assert_ne!(
        before.input_router.repeats[0].timer_id,
        after.input_router.repeats[0].timer_id
    );
    assert_eq!(
        after.input_router.repeats[0].timer_id,
        after.scheduler.timers[0].registration.timer_id
    );
    assert_eq!(after.scheduler.timers[0].remaining_active_ms, safe(250));
    Ok(())
}

#[test]
fn snapshot_resume_and_time_chunking_preserve_ordered_consequences() -> TestResult {
    let mut whole = active()?;
    whole.raw_input(key_down(PhysicalKey::ArrowDown))?;
    whole.advance_time(safe(100))?;
    let checkpoint = whole.snapshot()?;
    let mut resumed = restore(checkpoint.clone())?;
    let step = whole.advance_time(safe(650))?;
    let mut aggregate = GameKernelStepV7::default();
    for milliseconds in [150, 250, 250] {
        let chunk = resumed.advance_time(safe(milliseconds))?;
        aggregate.effects.extend(chunk.effects);
        aggregate.internal_events.extend(chunk.internal_events);
    }
    assert_eq!(step, aggregate);
    assert_eq!(
        cursor_effects(&step),
        [
            "battle/command/fight",
            "battle/command/party",
            "battle/command/fight"
        ]
    );
    let expected = whole.snapshot()?;
    let mut actual = resumed.snapshot()?;
    // Replay sequence counts external requests, so three chunks add two requests.
    assert_eq!(
        actual.replay_sequence.get(),
        expected.replay_sequence.get() + 2
    );
    actual.replay_sequence = expected.replay_sequence;
    assert_eq!(actual, expected);
    let mut same_trace = restore(checkpoint)?;
    assert_eq!(same_trace.advance_time(safe(650))?, step);
    assert_eq!(same_trace.snapshot()?, expected);
    Ok(())
}

#[test]
fn release_blur_text_focus_and_duplicate_sources_cancel_or_suppress_repeats() -> TestResult {
    for release in [
        RawInputEvent::KeyUp {
            code: PhysicalKey::ArrowDown,
        },
        RawInputEvent::WindowBlurred,
        RawInputEvent::FocusChanged(InputFocus::TextEntry),
    ] {
        let mut kernel = active()?;
        kernel.raw_input(key_down(PhysicalKey::ArrowDown))?;
        kernel.raw_input(release)?;
        assert!(kernel.snapshot()?.input_router.repeats.is_empty());
        assert!(kernel.snapshot()?.scheduler.timers.is_empty());
        assert!(kernel.advance_time(safe(500))?.effects.is_empty());
        assert_eq!(selected(&kernel), "battle/command/party");
    }
    let mut kernel = active()?;
    kernel.raw_input(key_down(PhysicalKey::ArrowDown))?;
    assert!(
        kernel
            .raw_input(RawInputEvent::GamepadDown { button: 13 })?
            .effects
            .is_empty()
    );
    assert_eq!(kernel.snapshot()?.input_router.repeats.len(), 1);
    kernel.raw_input(RawInputEvent::KeyUp {
        code: PhysicalKey::ArrowDown,
    })?;
    assert!(kernel.advance_time(safe(500))?.effects.is_empty());
    kernel.raw_input(RawInputEvent::GamepadUp { button: 13 })?;
    kernel.raw_input(RawInputEvent::GamepadDown { button: 13 })?;
    assert_eq!(selected(&kernel), "battle/command/fight");
    assert_eq!(
        cursor_effects(&kernel.advance_time(safe(250))?),
        ["battle/command/party"]
    );
    kernel.raw_input(RawInputEvent::GamepadUp { button: 13 })?;
    assert!(kernel.snapshot()?.scheduler.timers.is_empty());
    Ok(())
}

#[test]
fn menu_transition_retires_repeat_and_stale_snapshot_ownership_is_rejected() -> TestResult {
    let mut kernel = active()?;
    kernel.raw_input(key_down(PhysicalKey::ArrowDown))?;
    let owned = kernel.snapshot()?;
    let mut stale = owned.clone();
    let old = MenuInstanceId::new(SafeU53::ZERO);
    stale.input_router.repeats[0].menu_instance_id = old;
    stale.input_router.held_buttons[0].menu_instance_id = old;
    stale.input_router.pressed[0].menu_instance_id = Some(old);
    stale.input_router.locks[0].menu_instance_id = old;
    assert!(restore(stale).is_err());
    let mut missing = owned.clone();
    missing.scheduler.timers.clear();
    assert!(restore(missing).is_err());
    let mut duplicate = owned;
    let mut foreign_timer = duplicate.scheduler.timers[0].clone();
    foreign_timer.registration.endpoint = SeatId::new(safe(2));
    foreign_timer.registration.owner.owner_id = "foreign-runtime".to_owned();
    foreign_timer.registration.owner.reason = "foreign-purpose".to_owned();
    duplicate.scheduler.timers.push(foreign_timer);
    assert!(restore(duplicate).is_err());
    press(&mut kernel, PhysicalKey::ArrowUp)?;
    press(&mut kernel, PhysicalKey::Space)?;
    assert_eq!(
        kernel.current_control().expect("move control").kind,
        GameControlKindV2::BattleMove
    );
    assert!(kernel.snapshot()?.input_router.repeats.is_empty());
    assert!(kernel.snapshot()?.scheduler.timers.is_empty());
    let control = kernel.current_control().cloned();
    assert!(kernel.advance_time(safe(500))?.effects.is_empty());
    assert_eq!(kernel.current_control().cloned(), control);
    Ok(())
}

#[test]
fn pause_reasons_preserve_remaining_delay_until_last_reason_is_removed() -> TestResult {
    let mut kernel = active()?;
    kernel.raw_input(key_down(PhysicalKey::ArrowDown))?;
    kernel.advance_time(safe(100))?;
    let mut snapshot = kernel.snapshot()?;
    snapshot.scheduler.pauses.push(TimeClassPauseSnapshotV2 {
        endpoint: seat(),
        time_class: TimeClass::HumanInput,
        reasons: vec!["modal".to_owned(), "suspend".to_owned()],
    });
    let mut paused = restore(snapshot)?;
    assert!(paused.advance_time(safe(1000))?.effects.is_empty());
    let mut snapshot = paused.snapshot()?;
    assert_eq!(snapshot.scheduler.timers[0].remaining_active_ms, safe(150));
    snapshot.scheduler.pauses[0].reasons.remove(0);
    let mut paused = restore(snapshot)?;
    assert!(paused.advance_time(safe(1000))?.effects.is_empty());
    let mut snapshot = paused.snapshot()?;
    assert_eq!(snapshot.scheduler.timers[0].remaining_active_ms, safe(150));
    snapshot.scheduler.pauses.clear();
    let mut resumed = restore(snapshot)?;
    assert_eq!(
        cursor_effects(&resumed.advance_time(safe(150))?),
        ["battle/command/fight"]
    );
    Ok(())
}

#[test]
fn unequal_and_tied_deadlines_dispatch_in_chronological_timer_order() -> TestResult {
    for gap in [0, 100] {
        let mut kernel = active()?;
        kernel.raw_input(key_down(PhysicalKey::ArrowDown))?;
        kernel.advance_time(safe(gap))?;
        kernel.raw_input(key_down(PhysicalKey::ArrowUp))?;
        let next_id = kernel
            .snapshot()?
            .scheduler
            .next_timer_id
            .expect("fresh allocator")
            .get();
        let step = kernel.advance_time(safe(250))?;
        assert_eq!(
            cursor_effects(&step),
            ["battle/command/party", "battle/command/fight"]
        );
        assert_eq!(
            step.internal_events,
            [
                GameInternalEventKindV2::TimerFired,
                GameInternalEventKindV2::TimerFired
            ]
        );
        let snapshot = kernel.snapshot()?;
        let down = snapshot
            .input_router
            .repeats
            .iter()
            .find(|repeat| repeat.button == GameButton::Down)
            .expect("Down repeat");
        let up = snapshot
            .input_router
            .repeats
            .iter()
            .find(|repeat| repeat.button == GameButton::Up)
            .expect("Up repeat");
        assert_eq!(down.timer_id, TimerId::new(safe(next_id)));
        assert_eq!(up.timer_id, TimerId::new(safe(next_id + 1)));
        assert_eq!(
            snapshot.scheduler.timers[0].remaining_active_ms,
            safe(250 - gap)
        );
        assert_eq!(snapshot.scheduler.timers[1].remaining_active_ms, safe(250));
    }
    Ok(())
}

#[test]
fn exhausted_allocator_and_consequence_budget_fail_atomically() -> TestResult {
    let mut exhausted = checkpoint()?.1.clone();
    exhausted.scheduler.next_timer_id = None;
    let mut kernel = restore(exhausted.clone())?;
    assert_eq!(
        kernel.raw_input(key_down(PhysicalKey::ArrowDown)),
        Err(GameKernelV7Error::TimerAllocationExhausted)
    );
    assert_eq!(kernel.snapshot()?, exhausted);

    let mut kernel = active()?;
    kernel.raw_input(key_down(PhysicalKey::ArrowDown))?;
    let mut exhausted = kernel.snapshot()?;
    exhausted.scheduler.next_timer_id = None;
    let mut resumed = restore(exhausted.clone())?;
    assert_eq!(
        resumed.advance_time(safe(250)),
        Err(GameKernelV7Error::TimerAllocationExhausted)
    );
    assert_eq!(resumed.snapshot()?, exhausted);

    let before = kernel.snapshot()?;
    assert!(matches!(
        kernel.advance_time(safe(256250)),
        Err(GameKernelV7Error::TimerBudgetExceeded { limit: 1024, .. })
    ));
    assert_eq!(kernel.snapshot()?, before);
    let allowed = kernel.advance_time(safe(256000))?;
    assert_eq!(allowed.internal_events.len(), 1024);
    assert_eq!(cursor_effects(&allowed).len(), 1024);
    assert_eq!(selected(&kernel), "battle/command/party");
    assert_eq!(
        cursor_effects(&kernel.advance_time(safe(250))?),
        ["battle/command/fight"]
    );
    Ok(())
}

#[test]
fn invalid_directional_keyboard_and_gamepad_presses_preserve_full_snapshot() -> TestResult {
    for input in [
        key_down(PhysicalKey::ArrowLeft),
        key_down(PhysicalKey::ArrowRight),
        RawInputEvent::GamepadDown { button: 14 },
        RawInputEvent::GamepadDown { button: 15 },
    ] {
        let mut kernel = active()?;
        let before = kernel.snapshot()?;
        assert!(matches!(
            kernel.raw_input(input),
            Err(GameKernelV7Error::Runtime(_))
        ));
        assert_eq!(kernel.snapshot()?, before);
        assert!(kernel.advance_time(safe(500))?.effects.is_empty());
        kernel.raw_input(key_down(PhysicalKey::ArrowDown))?;
        assert_eq!(selected(&kernel), "battle/command/party");
        assert_eq!(
            cursor_effects(&kernel.advance_time(safe(250))?),
            ["battle/command/fight"]
        );
    }
    Ok(())
}

#[test]
fn unsupported_later_timer_rolls_back_earlier_real_navigation() -> TestResult {
    let mut kernel = active()?;
    kernel.raw_input(key_down(PhysicalKey::ArrowDown))?;
    let mut snapshot = kernel.snapshot()?;
    let mut unknown = snapshot.scheduler.timers[0].clone();
    unknown.registration.timer_id = TimerId::new(safe(100));
    unknown.registration.owner.owner_id = "future-runtime".to_owned();
    unknown.registration.owner.reason = "unsupported-purpose".to_owned();
    unknown.registration.time_class = TimeClass::Absolute;
    unknown.registration.delay_ms = safe(300);
    unknown.original_delay_ms = safe(300);
    unknown.remaining_active_ms = safe(300);
    snapshot.scheduler.timers.push(unknown);
    snapshot.scheduler.next_timer_id = Some(safe(101));
    let mut restored = restore(snapshot.clone())?;
    assert_eq!(
        restored.advance_time(safe(500)),
        Err(GameKernelV7Error::UnsupportedTimerPurpose {
            timer_id: TimerId::new(safe(100))
        })
    );
    assert_eq!(restored.snapshot()?, snapshot);
    let step = restored.advance_time(safe(250))?;
    assert_eq!(cursor_effects(&step), ["battle/command/fight"]);
    assert_eq!(restored.snapshot()?.scheduler.timers.len(), 2);
    Ok(())
}
