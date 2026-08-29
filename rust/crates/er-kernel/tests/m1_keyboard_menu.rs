use std::error::Error;

use er_kernel::{GameKernel, KernelConfig, KernelEffect, KernelError, KernelInput};
use er_types::{
    CancelPolicy, ChoiceListMenu, CommandMenu, GameButton, InputFocus, InputMap, InteractionMenu,
    KeyBinding, MenuGeneration, MenuOption, MenuOptionId, MenuState, OperationId, PhysicalKey,
    RawInputEvent, ReplacementMenu, SafeU53, SeatId, TimeClass, TimerId, TimerOwner, UiIntent,
    UiState, UiViewKind, UiViewModel,
};

type TestResult = Result<(), Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("M1 test value must fit in SafeU53")
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn timer(value: u64) -> TimerId {
    TimerId::new(safe(value))
}

fn binding(key: PhysicalKey, button: GameButton) -> KeyBinding {
    KeyBinding { key, button }
}

fn input_map() -> InputMap {
    let repeat_ms = safe(250);
    InputMap {
        keyboard: vec![
            binding(PhysicalKey::ArrowUp, GameButton::Up),
            binding(PhysicalKey::ArrowDown, GameButton::Down),
            binding(PhysicalKey::Enter, GameButton::Submit),
            binding(PhysicalKey::Space, GameButton::Action),
            binding(PhysicalKey::Escape, GameButton::Cancel),
            binding(PhysicalKey::KeyA, GameButton::Action),
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: repeat_ms,
        repeat_interval_ms: repeat_ms,
    }
}

fn menu_option(id: &str, enabled: bool, visible: bool) -> Result<MenuOption, Box<dyn Error>> {
    Ok(MenuOption {
        id: MenuOptionId::new(id)?,
        label_key: format!("menu.{id}"),
        enabled,
        visible,
    })
}

fn options(specs: &[(&str, bool, bool)]) -> Result<Vec<MenuOption>, Box<dyn Error>> {
    specs
        .iter()
        .map(|(id, enabled, visible)| menu_option(id, *enabled, *visible))
        .collect()
}

fn choice_menu(options: Vec<MenuOption>, cursor: u64, wrap: bool) -> MenuState {
    MenuState::ChoiceList(ChoiceListMenu {
        cursor: safe(cursor),
        page: safe(0),
        wrap,
        options,
        cancel: CancelPolicy::Disabled,
    })
}

fn command_menu(options: Vec<MenuOption>) -> Result<MenuState, Box<dyn Error>> {
    Ok(MenuState::Command(CommandMenu {
        operation_id: OperationId::new("op.command")?,
        control_id: "control.command".to_owned(),
        cursor: safe(0),
        options,
        cancel: CancelPolicy::Disabled,
    }))
}

fn replacement_menu(options: Vec<MenuOption>) -> Result<MenuState, Box<dyn Error>> {
    Ok(MenuState::Replacement(ReplacementMenu {
        operation_id: OperationId::new("op.replacement")?,
        control_id: "control.replacement".to_owned(),
        field_index: safe(0),
        cursor: safe(0),
        options,
        cancel: CancelPolicy::Disabled,
    }))
}

fn interaction_menu(options: Vec<MenuOption>) -> Result<MenuState, Box<dyn Error>> {
    Ok(MenuState::Interaction(InteractionMenu {
        operation_id: OperationId::new("op.interaction")?,
        control_id: "control.interaction".to_owned(),
        surface_class: "surface".to_owned(),
        operation_kind: "kind".to_owned(),
        choice: ChoiceListMenu {
            cursor: safe(0),
            page: safe(0),
            wrap: false,
            options,
            cancel: CancelPolicy::Disabled,
        },
    }))
}

fn kernel_with(menu: MenuState, owner_seat: Option<SeatId>, actionable: bool) -> GameKernel {
    GameKernel::new(KernelConfig {
        input_map: input_map(),
        initial_ui: UiState {
            generation: MenuGeneration::new(safe(1)),
            owner_seat,
            actionable,
            stack: vec![menu],
        },
        protocol: None,
    })
}

fn key_down(
    kernel: &mut GameKernel,
    seat: SeatId,
    code: PhysicalKey,
    printable: bool,
    browser_repeat: bool,
    focus: InputFocus,
) -> Result<Vec<KernelEffect>, KernelError> {
    kernel.step(KernelInput::RawInput {
        seat,
        event: RawInputEvent::KeyDown {
            code,
            printable,
            browser_repeat,
            focus,
        },
    })
}

fn key_up(
    kernel: &mut GameKernel,
    seat: SeatId,
    code: PhysicalKey,
) -> Result<Vec<KernelEffect>, KernelError> {
    kernel.step(KernelInput::RawInput {
        seat,
        event: RawInputEvent::KeyUp { code },
    })
}

fn focus_changed(
    kernel: &mut GameKernel,
    seat: SeatId,
    focus: InputFocus,
) -> Result<Vec<KernelEffect>, KernelError> {
    kernel.step(KernelInput::RawInput {
        seat,
        event: RawInputEvent::FocusChanged(focus),
    })
}

fn blur(kernel: &mut GameKernel, seat: SeatId) -> Result<Vec<KernelEffect>, KernelError> {
    kernel.step(KernelInput::RawInput {
        seat,
        event: RawInputEvent::WindowBlurred,
    })
}

fn timer_fired(
    kernel: &mut GameKernel,
    endpoint: SeatId,
    timer_id: TimerId,
) -> Result<Vec<KernelEffect>, KernelError> {
    kernel.step(KernelInput::TimerFired { endpoint, timer_id })
}

fn scheduled_delay(effects: &[KernelEffect], timer_id: TimerId) -> Option<SafeU53> {
    effects.iter().find_map(|effect| match effect {
        KernelEffect::ScheduleTimer {
            timer_id: scheduled,
            delay_ms,
            ..
        } if *scheduled == timer_id => Some(*delay_ms),
        _ => None,
    })
}

fn assert_scheduled(
    effects: &[KernelEffect],
    endpoint: SeatId,
    timer_id: TimerId,
    button: GameButton,
) {
    let expected_owner = TimerOwner::input_repeat(button);
    assert!(effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::ScheduleTimer {
                endpoint: effect_endpoint,
                timer_id: effect_timer,
                owner,
                delay_ms,
                time_class: TimeClass::HumanInput,
            } if *effect_endpoint == endpoint
                && *effect_timer == timer_id
                && owner == &expected_owner
                && *delay_ms == safe(250)
        )
    }));
}

fn cancelled(effects: &[KernelEffect], timer_id: TimerId) -> bool {
    effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::CancelTimer {
                timer_id: cancelled,
                ..
            } if *cancelled == timer_id
        )
    })
}

fn ui_changed_view(effects: &[KernelEffect], endpoint: SeatId) -> Option<UiViewModel> {
    effects.iter().find_map(|effect| match effect {
        KernelEffect::UiChanged {
            endpoint: effect_endpoint,
            view,
        } if *effect_endpoint == endpoint => Some(view.clone()),
        _ => None,
    })
}

fn assert_ui_changed(effects: &[KernelEffect], endpoint: SeatId, expected: &UiViewModel) {
    assert_eq!(ui_changed_view(effects, endpoint).as_ref(), Some(expected));
}

fn assert_no_ui_change(effects: &[KernelEffect], endpoint: SeatId) {
    assert!(ui_changed_view(effects, endpoint).is_none());
}

fn assert_ui_intent(effects: &[KernelEffect], endpoint: SeatId, expected: UiIntent) {
    assert!(effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::UiIntent {
                endpoint: effect_endpoint,
                intent,
            } if *effect_endpoint == endpoint && intent == &expected
        )
    }));
}

fn assert_terminal(kernel: &GameKernel, effects: &[KernelEffect], reason: &str) {
    assert!(effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::EnterSharedTerminal { terminal }
                if terminal.terminal_id == "authority-v2-terminal"
                    && terminal.reason.as_str() == reason
        )
    }));
    let view = kernel.ui_view();
    assert_eq!(view.kind, UiViewKind::Terminal);
    assert!(!view.actionable);
    assert_eq!(view.prompt_key.as_deref(), Some(reason));
    assert!(matches!(
        kernel.ui_state().stack.last(),
        Some(MenuState::Terminal(menu))
            if menu.terminal_id == "authority-v2-terminal"
                && menu.prompt_key.as_deref() == Some(reason)
    ));
    assert_eq!(kernel.live_resources(), Default::default());
}

#[test]
fn raw_keydown_keyup_moves_cursor_and_dispatches_command_submit() -> TestResult {
    let owner = seat(1);
    let mut kernel = kernel_with(
        choice_menu(
            options(&[("first", true, true), ("second", true, true)])?,
            0,
            false,
        ),
        Some(owner),
        true,
    );

    let moved = key_down(
        &mut kernel,
        owner,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;
    assert_eq!(scheduled_delay(&moved, timer(0)), Some(safe(250)));
    assert_scheduled(&moved, owner, timer(0), GameButton::Down);
    assert!(kernel.live_resources().timers.contains(&timer(0)));
    assert_eq!(kernel.ui_view().cursor, Some(safe(1)));
    let moved_view = kernel.ui_view();
    assert_ui_changed(&moved, owner, &moved_view);

    let released = key_up(&mut kernel, owner, PhysicalKey::ArrowDown)?;
    assert!(cancelled(&released, timer(0)));

    let command = command_menu(options(&[("command-a", true, true)])?)?;
    kernel.replace_menu(Some(owner), true, command);
    let submit_view = kernel.ui_view();
    let submitted = key_down(
        &mut kernel,
        owner,
        PhysicalKey::Enter,
        false,
        false,
        InputFocus::Game,
    )?;
    assert_ui_changed(&submitted, owner, &submit_view);
    assert_ui_intent(
        &submitted,
        owner,
        UiIntent::CommandSubmitted {
            seat: owner,
            generation: submit_view.generation,
            operation_id: OperationId::new("op.command")?,
            control_id: "control.command".to_owned(),
            option_id: MenuOptionId::new("command-a")?,
        },
    );
    assert!(scheduled_delay(&submitted, timer(1)).is_none());
    assert_terminal(
        &kernel,
        &submitted,
        "missing exact menu proposal plan for op.command / command-a",
    );

    let submit_released = key_up(&mut kernel, owner, PhysicalKey::Enter)?;
    assert!(submit_released.is_empty());
    Ok(())
}

#[test]
fn raw_submit_dispatches_replacement_and_interaction_paths() -> TestResult {
    let owner = seat(1);
    let menu_options = options(&[("selected", true, true)])?;
    let menus = vec![
        (
            command_menu(menu_options.clone())?,
            UiViewKind::Command,
            "op.command",
            "control.command",
        ),
        (
            replacement_menu(menu_options.clone())?,
            UiViewKind::Replacement,
            "op.replacement",
            "control.replacement",
        ),
        (
            interaction_menu(menu_options)?,
            UiViewKind::Interaction,
            "op.interaction",
            "control.interaction",
        ),
    ];

    for (menu, expected_kind, expected_operation, expected_control) in menus {
        let mut kernel = kernel_with(menu, Some(owner), true);
        let before = kernel.snapshot();
        let before_view = kernel.ui_view();
        assert_eq!(before_view.kind, expected_kind);
        let submitted = key_down(
            &mut kernel,
            owner,
            PhysicalKey::Enter,
            false,
            false,
            InputFocus::Game,
        )?;
        assert_ui_changed(&submitted, owner, &before_view);
        let expected_intent = match expected_kind {
            UiViewKind::Command => UiIntent::CommandSubmitted {
                seat: owner,
                generation: before_view.generation,
                operation_id: OperationId::new(expected_operation)?,
                control_id: expected_control.to_owned(),
                option_id: MenuOptionId::new("selected")?,
            },
            UiViewKind::Replacement => UiIntent::ReplacementSubmitted {
                seat: owner,
                generation: before_view.generation,
                operation_id: OperationId::new(expected_operation)?,
                control_id: expected_control.to_owned(),
                option_id: MenuOptionId::new("selected")?,
            },
            UiViewKind::Interaction => UiIntent::InteractionSubmitted {
                seat: owner,
                generation: before_view.generation,
                operation_id: OperationId::new(expected_operation)?,
                control_id: expected_control.to_owned(),
                option_id: MenuOptionId::new("selected")?,
            },
            other => return Err(format!("unexpected menu kind in test: {other:?}").into()),
        };
        assert_ui_intent(&submitted, owner, expected_intent);
        let terminal_reason =
            format!("missing exact menu proposal plan for {expected_operation} / selected");
        assert_terminal(&kernel, &submitted, &terminal_reason);
        assert_ne!(kernel.snapshot().ui, before.ui);

        let released = key_up(&mut kernel, owner, PhysicalKey::Enter)?;
        assert!(released.is_empty());
    }
    Ok(())
}

#[test]
fn repeat_uses_virtual_250ms_timer_and_keyup_cancels_it() -> TestResult {
    let owner = seat(1);
    let mut kernel = kernel_with(
        choice_menu(
            options(&[
                ("one", true, true),
                ("two", true, true),
                ("three", true, true),
            ])?,
            0,
            true,
        ),
        Some(owner),
        true,
    );

    let pressed = key_down(
        &mut kernel,
        owner,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;
    assert_eq!(scheduled_delay(&pressed, timer(0)), Some(safe(250)));
    assert_scheduled(&pressed, owner, timer(0), GameButton::Down);
    assert!(kernel.live_resources().timers.contains(&timer(0)));
    assert_eq!(kernel.ui_view().cursor, Some(safe(1)));

    let repeated = timer_fired(&mut kernel, owner, timer(0))?;
    assert_eq!(scheduled_delay(&repeated, timer(1)), Some(safe(250)));
    assert_scheduled(&repeated, owner, timer(1), GameButton::Down);
    assert!(kernel.live_resources().timers.contains(&timer(1)));
    assert_eq!(kernel.ui_view().cursor, Some(safe(2)));
    let repeated_view = kernel.ui_view();
    assert_ui_changed(&repeated, owner, &repeated_view);

    let released = key_up(&mut kernel, owner, PhysicalKey::ArrowDown)?;
    assert!(cancelled(&released, timer(1)));
    assert!(kernel.live_resources().timers.is_empty());
    assert!(matches!(
        timer_fired(&mut kernel, owner, timer(0)),
        Err(KernelError::Input(_))
    ));
    Ok(())
}

#[test]
fn browser_repeat_is_deduplicated_and_keyup_is_symmetric() -> TestResult {
    let owner = seat(1);
    let mut kernel = kernel_with(
        choice_menu(
            options(&[("one", true, true), ("two", true, true)])?,
            0,
            false,
        ),
        Some(owner),
        true,
    );

    let first = key_down(
        &mut kernel,
        owner,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;
    assert_eq!(scheduled_delay(&first, timer(0)), Some(safe(250)));
    assert_eq!(kernel.ui_view().cursor, Some(safe(1)));

    let browser_repeat = key_down(
        &mut kernel,
        owner,
        PhysicalKey::ArrowDown,
        false,
        true,
        InputFocus::Game,
    )?;
    assert!(scheduled_delay(&browser_repeat, timer(1)).is_none());
    assert_no_ui_change(&browser_repeat, owner);
    assert_eq!(kernel.ui_view().cursor, Some(safe(1)));

    let released = key_up(&mut kernel, owner, PhysicalKey::ArrowDown)?;
    assert!(cancelled(&released, timer(0)));
    let duplicate_release = key_up(&mut kernel, owner, PhysicalKey::ArrowDown)?;
    assert!(duplicate_release.is_empty());
    assert!(kernel.live_resources().timers.is_empty());
    Ok(())
}

#[test]
fn focus_suppresses_printable_keys_and_preserves_matching_keyup() -> TestResult {
    let owner = seat(1);
    let mut kernel = kernel_with(
        choice_menu(options(&[("one", true, true)])?, 0, false),
        Some(owner),
        true,
    );
    let before = kernel.snapshot();

    assert!(focus_changed(&mut kernel, owner, InputFocus::TextEntry)?.is_empty());
    let suppressed = key_down(
        &mut kernel,
        owner,
        PhysicalKey::KeyA,
        true,
        false,
        InputFocus::TextEntry,
    )?;
    assert!(suppressed.is_empty());
    assert!(focus_changed(&mut kernel, owner, InputFocus::Game)?.is_empty());
    let suppressed_release = key_up(&mut kernel, owner, PhysicalKey::KeyA)?;
    assert!(suppressed_release.is_empty());
    assert_eq!(kernel.snapshot().ui, before.ui);
    assert!(kernel.live_resources().timers.is_empty());

    let accepted = key_down(
        &mut kernel,
        owner,
        PhysicalKey::KeyA,
        true,
        false,
        InputFocus::Game,
    )?;
    assert_eq!(scheduled_delay(&accepted, timer(0)), Some(safe(250)));
    assert_scheduled(&accepted, owner, timer(0), GameButton::Action);
    assert!(kernel.live_resources().timers.contains(&timer(0)));
    assert!(focus_changed(&mut kernel, owner, InputFocus::TextEntry)?.is_empty());
    let suppressed_repeat = timer_fired(&mut kernel, owner, timer(0))?;
    assert_eq!(
        scheduled_delay(&suppressed_repeat, timer(1)),
        Some(safe(250))
    );
    assert_no_ui_change(&suppressed_repeat, owner);
    let accepted_release = key_up(&mut kernel, owner, PhysicalKey::KeyA)?;
    assert!(cancelled(&accepted_release, timer(1)));
    assert!(kernel.live_resources().timers.is_empty());
    Ok(())
}

#[test]
fn blur_cancels_all_owned_timers_without_synthetic_releases() -> TestResult {
    let owner = seat(1);
    let mut kernel = kernel_with(
        choice_menu(
            options(&[("one", true, true), ("two", true, true)])?,
            0,
            true,
        ),
        Some(owner),
        true,
    );

    let _ = key_down(
        &mut kernel,
        owner,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;
    let _ = key_down(
        &mut kernel,
        owner,
        PhysicalKey::ArrowUp,
        false,
        false,
        InputFocus::Game,
    )?;
    assert_eq!(kernel.live_resources().timers.len(), 2);
    let after_input = kernel.snapshot();

    let blurred = blur(&mut kernel, owner)?;
    assert!(cancelled(&blurred, timer(0)));
    assert!(cancelled(&blurred, timer(1)));
    assert_no_ui_change(&blurred, owner);
    assert!(kernel.live_resources().timers.is_empty());
    assert_eq!(kernel.snapshot().ui, after_input.ui);

    assert!(key_up(&mut kernel, owner, PhysicalKey::ArrowDown)?.is_empty());
    assert!(key_up(&mut kernel, owner, PhysicalKey::ArrowUp)?.is_empty());
    assert!(matches!(
        timer_fired(&mut kernel, owner, timer(0)),
        Err(KernelError::Input(_))
    ));
    Ok(())
}

#[test]
fn ownership_generation_and_actionability_reject_raw_events_without_mutation() -> TestResult {
    let owner = seat(1);
    let other_seat = seat(2);
    let menu = choice_menu(
        options(&[("one", true, true), ("two", true, true)])?,
        0,
        false,
    );

    let mut wrong_owner = kernel_with(menu.clone(), Some(owner), true);
    let wrong_before = wrong_owner.snapshot();
    let wrong_down = key_down(
        &mut wrong_owner,
        other_seat,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;
    assert!(wrong_down.is_empty());
    assert_no_ui_change(&wrong_down, other_seat);
    let wrong_up = key_up(&mut wrong_owner, other_seat, PhysicalKey::ArrowDown)?;
    assert!(wrong_up.is_empty());
    assert_no_ui_change(&wrong_up, other_seat);
    assert_eq!(wrong_owner.snapshot().ui, wrong_before.ui);
    assert!(wrong_owner.live_resources().timers.is_empty());

    let mut non_actionable = kernel_with(menu.clone(), Some(owner), false);
    let non_actionable_before = non_actionable.snapshot();
    let non_actionable_down = key_down(
        &mut non_actionable,
        owner,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;
    assert!(non_actionable_down.is_empty());
    assert_no_ui_change(&non_actionable_down, owner);
    let non_actionable_up = key_up(&mut non_actionable, owner, PhysicalKey::ArrowDown)?;
    assert!(non_actionable_up.is_empty());
    assert_no_ui_change(&non_actionable_up, owner);
    assert_eq!(non_actionable.snapshot().ui, non_actionable_before.ui);
    assert!(non_actionable.live_resources().timers.is_empty());

    let mut stale = kernel_with(menu, Some(owner), true);
    let stale_down = key_down(
        &mut stale,
        owner,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;
    assert_eq!(scheduled_delay(&stale_down, timer(0)), Some(safe(250)));
    assert_scheduled(&stale_down, owner, timer(0), GameButton::Down);
    assert!(stale.live_resources().timers.contains(&timer(0)));
    let old_generation = stale.ui_view().generation;
    let replacement = choice_menu(
        options(&[
            ("replacement-one", true, true),
            ("replacement-two", true, true),
        ])?,
        0,
        false,
    );
    let new_generation = stale.replace_menu(Some(owner), true, replacement);
    assert_ne!(new_generation, old_generation);
    let replaced = stale.snapshot();

    let stale_repeat = timer_fired(&mut stale, owner, timer(0))?;
    assert!(stale_repeat.is_empty());
    assert_no_ui_change(&stale_repeat, owner);
    assert!(stale.live_resources().timers.is_empty());
    assert_eq!(stale.snapshot().ui, replaced.ui);
    assert!(matches!(
        timer_fired(&mut stale, owner, timer(0)),
        Err(KernelError::Input(_))
    ));
    let stale_release = key_up(&mut stale, owner, PhysicalKey::ArrowDown)?;
    assert!(stale_release.is_empty());
    assert_no_ui_change(&stale_release, owner);
    assert!(stale.live_resources().timers.is_empty());
    assert_eq!(stale.snapshot().ui, replaced.ui);
    Ok(())
}

#[test]
fn hidden_and_disabled_choices_are_not_submitted_and_hidden_choices_are_skipped() -> TestResult {
    let owner = seat(1);
    let mut hidden_skip = kernel_with(
        choice_menu(
            options(&[
                ("visible-one", true, true),
                ("hidden", true, false),
                ("visible-two", true, true),
            ])?,
            0,
            false,
        ),
        Some(owner),
        true,
    );
    let moved = key_down(
        &mut hidden_skip,
        owner,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;
    assert_eq!(hidden_skip.ui_view().cursor, Some(safe(2)));
    assert_eq!(
        hidden_skip
            .ui_view()
            .options
            .get(2)
            .map(|option| (option.id.as_str(), option.selected)),
        Some(("visible-two", true))
    );
    let moved_view = hidden_skip.ui_view();
    assert_ui_changed(&moved, owner, &moved_view);
    assert!(cancelled(
        &key_up(&mut hidden_skip, owner, PhysicalKey::ArrowDown)?,
        timer(0)
    ));
    let valid_submit = key_down(
        &mut hidden_skip,
        owner,
        PhysicalKey::Enter,
        false,
        false,
        InputFocus::Game,
    )?;
    assert_ui_changed(&valid_submit, owner, &hidden_skip.ui_view());
    assert!(cancelled(
        &key_up(&mut hidden_skip, owner, PhysicalKey::Enter)?,
        timer(1)
    ));

    for (id, enabled, visible) in [("hidden-selected", true, false), ("disabled", false, true)] {
        let mut rejected = kernel_with(
            choice_menu(
                options(&[("valid", true, true), (id, enabled, visible)])?,
                1,
                false,
            ),
            Some(owner),
            true,
        );
        let before = rejected.snapshot();
        let submitted = key_down(
            &mut rejected,
            owner,
            PhysicalKey::Enter,
            false,
            false,
            InputFocus::Game,
        )?;
        assert!(submitted.is_empty());
        assert_no_ui_change(&submitted, owner);
        assert_eq!(rejected.snapshot().ui, before.ui);
        assert!(key_up(&mut rejected, owner, PhysicalKey::Enter)?.is_empty());
        assert!(rejected.live_resources().timers.is_empty());
    }
    Ok(())
}

#[test]
fn ui_view_is_an_immutable_cloned_projection() -> TestResult {
    let owner = seat(1);
    let kernel = kernel_with(
        command_menu(options(&[("one", true, true), ("two", true, true)])?)?,
        Some(owner),
        true,
    );
    let before_state = kernel.snapshot();
    let before_view = kernel.ui_view();

    let mut rendered = before_view.clone();
    rendered.cursor = Some(safe(99));
    rendered.prompt_key = Some("mutated.prompt".to_owned());
    rendered.options.clear();
    assert_eq!(kernel.ui_view(), before_view);
    assert_eq!(kernel.snapshot().ui, before_state.ui);

    let mut second_render = kernel.ui_view();
    if let Some(option) = second_render.options.first_mut() {
        option.label_key = "mutated.label".to_owned();
        option.selected = false;
    }
    assert_eq!(kernel.ui_view(), before_view);
    assert_eq!(kernel.snapshot().ui, before_state.ui);
    Ok(())
}

#[test]
fn ui_rejected_initial_press_rolls_back_scheduler_without_clock_effects() -> TestResult {
    let owner = seat(1);
    let mut kernel = kernel_with(
        choice_menu(
            options(&[("valid", true, true), ("disabled", false, true)])?,
            1,
            false,
        ),
        Some(owner),
        true,
    );

    let rejected = key_down(
        &mut kernel,
        owner,
        PhysicalKey::Enter,
        false,
        false,
        InputFocus::Game,
    )?;
    assert!(rejected.is_empty());
    assert!(kernel.live_resources().timers.is_empty());
    assert!(key_up(&mut kernel, owner, PhysicalKey::Enter)?.is_empty());

    kernel.replace_menu(
        Some(owner),
        true,
        command_menu(options(&[("command", true, true)])?)?,
    );
    let command_view = kernel.ui_view();
    let accepted = key_down(
        &mut kernel,
        owner,
        PhysicalKey::Enter,
        false,
        false,
        InputFocus::Game,
    )?;
    assert!(scheduled_delay(&accepted, timer(0)).is_none());
    assert!(scheduled_delay(&accepted, timer(1)).is_none());
    assert_ui_changed(&accepted, owner, &command_view);
    assert_ui_intent(
        &accepted,
        owner,
        UiIntent::CommandSubmitted {
            seat: owner,
            generation: command_view.generation,
            operation_id: OperationId::new("op.command")?,
            control_id: "control.command".to_owned(),
            option_id: MenuOptionId::new("command")?,
        },
    );
    assert_terminal(
        &kernel,
        &accepted,
        "missing exact menu proposal plan for op.command / command",
    );
    assert!(key_up(&mut kernel, owner, PhysicalKey::Enter)?.is_empty());
    Ok(())
}

#[test]
fn ui_rejected_repeat_rolls_back_fresh_timer_without_cancel_effect() -> TestResult {
    let owner = seat(1);
    let mut kernel = kernel_with(
        choice_menu(
            options(&[("one", true, true), ("two", true, true)])?,
            0,
            true,
        ),
        Some(owner),
        true,
    );

    let initial = key_down(
        &mut kernel,
        owner,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;
    assert_eq!(scheduled_delay(&initial, timer(0)), Some(safe(250)));

    kernel.replace_menu(
        Some(owner),
        false,
        choice_menu(options(&[("replacement", true, true)])?, 0, false),
    );
    let rejected = timer_fired(&mut kernel, owner, timer(0))?;
    assert!(rejected.is_empty());
    assert!(kernel.live_resources().timers.is_empty());
    assert!(key_up(&mut kernel, owner, PhysicalKey::ArrowDown)?.is_empty());
    assert!(matches!(
        timer_fired(&mut kernel, owner, timer(1)),
        Err(KernelError::Input(_))
    ));
    Ok(())
}

#[test]
fn wrong_endpoint_timer_fire_fails_closed_before_scheduler_consumption() -> TestResult {
    let owner = seat(1);
    let other = seat(2);
    let mut kernel = kernel_with(
        choice_menu(
            options(&[("one", true, true), ("two", true, true)])?,
            0,
            true,
        ),
        Some(owner),
        true,
    );
    key_down(
        &mut kernel,
        owner,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;

    assert!(matches!(
        timer_fired(&mut kernel, other, timer(0)),
        Err(KernelError::Input(_))
    ));
    let repeated = timer_fired(&mut kernel, owner, timer(0))?;
    assert_eq!(scheduled_delay(&repeated, timer(1)), Some(safe(250)));
    Ok(())
}

#[test]
fn dispose_cancels_each_real_input_timer_once_and_reports_zero_resources() -> TestResult {
    let owner = seat(1);
    let mut kernel = kernel_with(
        choice_menu(
            options(&[("one", true, true), ("two", true, true)])?,
            0,
            true,
        ),
        Some(owner),
        true,
    );
    key_down(
        &mut kernel,
        owner,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;
    key_down(
        &mut kernel,
        owner,
        PhysicalKey::ArrowUp,
        false,
        false,
        InputFocus::Game,
    )?;

    let disposed = kernel.dispose("test");
    assert_eq!(
        disposed
            .iter()
            .filter(|effect| matches!(effect, KernelEffect::CancelTimer { .. }))
            .count(),
        2
    );
    assert!(cancelled(&disposed, timer(0)));
    assert!(cancelled(&disposed, timer(1)));
    assert_eq!(kernel.live_resources(), Default::default());
    assert!(kernel.dispose("again").is_empty());
    assert!(matches!(
        kernel.step(KernelInput::RawInput {
            seat: owner,
            event: RawInputEvent::WindowFocused,
        }),
        Err(KernelError::Disposed)
    ));
    Ok(())
}

#[test]
fn no_protocol_snapshot_and_resources_retain_the_frozen_m1_shape() -> TestResult {
    let owner = seat(1);
    let mut kernel = kernel_with(
        choice_menu(
            options(&[("one", true, true), ("two", true, true)])?,
            0,
            true,
        ),
        Some(owner),
        true,
    );
    let frozen = er_types::KernelSnapshot {
        ui: kernel.snapshot().ui.clone(),
        state: serde_json::json!({}),
    };
    assert_eq!(kernel.snapshot(), frozen);
    assert_eq!(
        kernel.state_digest(),
        er_canonical::content_digest(&frozen)?
    );
    assert_eq!(kernel.live_resources(), Default::default());

    key_down(
        &mut kernel,
        owner,
        PhysicalKey::ArrowDown,
        false,
        false,
        InputFocus::Game,
    )?;
    assert_eq!(kernel.snapshot().state, frozen.state);
    let resources = kernel.live_resources();
    assert!(resources.timers.contains(&timer(0)));
    assert!(resources.presentations.is_empty());
    assert!(resources.waits.is_empty());
    assert!(resources.controls.is_empty());
    assert!(resources.delivery_leases.is_empty());
    assert!(resources.proposal_leases.is_empty());
    assert!(resources.recovery_transactions.is_empty());
    Ok(())
}

#[test]
fn replace_menu_is_inert_after_dispose() -> TestResult {
    let owner = seat(1);
    let mut kernel = kernel_with(
        command_menu(options(&[("command", true, true)])?)?,
        Some(owner),
        true,
    );
    let before_ui = kernel.ui_state().clone();

    kernel.dispose("replace-menu test");
    let generation = kernel.replace_menu(
        Some(owner),
        true,
        replacement_menu(options(&[("replacement", true, true)])?)?,
    );

    assert_eq!(generation, before_ui.generation);
    assert_eq!(kernel.ui_state(), &before_ui);
    assert_eq!(kernel.live_resources(), Default::default());
    Ok(())
}
