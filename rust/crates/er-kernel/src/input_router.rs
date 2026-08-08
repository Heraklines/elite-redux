//! Physical-input reducer and deterministic repeat ownership.

use std::collections::{BTreeMap, BTreeSet};

use er_protocol::{KernelScheduler, ScheduledTimer, SchedulerCommand, SchedulerError};
use er_types::{
    ButtonEvent, GameButton, InputFocus, InputMap, InputRouterOutput, InputTimerCommand,
    PhysicalKey, RawInputEvent, SafeU53, SeatId, TimeClass, TimerId, TimerOwner,
};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PhysicalPress {
    Accepted(GameButton),
    Blocked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TimerContext {
    endpoint: SeatId,
    button: GameButton,
}

const FIXED_REPEAT_CADENCE_MS: SafeU53 = match SafeU53::new(250) {
    Ok(value) => value,
    Err(_) => SafeU53::ZERO,
};

fn normalize_map(mut map: InputMap) -> InputMap {
    map.initial_repeat_delay_ms = FIXED_REPEAT_CADENCE_MS;
    map.repeat_interval_ms = FIXED_REPEAT_CADENCE_MS;
    map
}

#[derive(Clone, Debug)]
pub struct InputRouter {
    map: InputMap,
    held_buttons: BTreeSet<GameButton>,
    suppressed_keys: BTreeSet<PhysicalKey>,
    keyboard_presses: BTreeMap<PhysicalKey, PhysicalPress>,
    gamepad_presses: BTreeMap<u16, PhysicalPress>,
    timer_buttons: BTreeMap<TimerId, TimerContext>,
    printable_timers: BTreeSet<TimerId>,
    focus: InputFocus,
}

impl InputRouter {
    pub fn new(map: InputMap) -> Self {
        Self {
            map: normalize_map(map),
            held_buttons: BTreeSet::new(),
            suppressed_keys: BTreeSet::new(),
            keyboard_presses: BTreeMap::new(),
            gamepad_presses: BTreeMap::new(),
            timer_buttons: BTreeMap::new(),
            printable_timers: BTreeSet::new(),
            focus: InputFocus::Game,
        }
    }

    pub fn input_map(&self) -> &InputMap {
        &self.map
    }

    pub fn replace_map(
        &mut self,
        map: InputMap,
        scheduler: &mut KernelScheduler,
    ) -> InputRouterOutput {
        let output = self.clear(scheduler);
        self.map = normalize_map(map);
        output
    }

    pub fn handle(
        &mut self,
        endpoint: SeatId,
        event: RawInputEvent,
        scheduler: &mut KernelScheduler,
    ) -> Result<InputRouterOutput, InputRouteError> {
        match event {
            RawInputEvent::KeyDown {
                code,
                printable,
                browser_repeat: _,
                focus,
            } => {
                self.focus = focus;
                self.keyboard_down(endpoint, code, printable, scheduler)
            }
            RawInputEvent::KeyUp { code } => self.keyboard_up(code, scheduler),
            RawInputEvent::GamepadDown { button } => self.gamepad_down(endpoint, button, scheduler),
            RawInputEvent::GamepadUp { button } => self.gamepad_up(button, scheduler),
            RawInputEvent::FocusChanged(focus) => {
                self.focus = focus;
                Ok(InputRouterOutput::default())
            }
            RawInputEvent::WindowBlurred => Ok(self.clear(scheduler)),
            RawInputEvent::WindowFocused => {
                self.focus = InputFocus::Game;
                Ok(InputRouterOutput::default())
            }
        }
    }

    pub fn timer_fired(
        &mut self,
        fired: ScheduledTimer,
        scheduler: &mut KernelScheduler,
    ) -> Result<InputRouterOutput, InputRouteError> {
        let timer_id = fired.timer_id;
        let Some(&timer_context) = self.timer_buttons.get(&timer_id) else {
            return Err(InputRouteError::UnknownTimer { timer_id });
        };
        if fired.endpoint != timer_context.endpoint
            || fired.owner != TimerOwner::input_repeat(timer_context.button)
            || fired.time_class != TimeClass::HumanInput
            || scheduler.timer(timer_id).is_some()
        {
            return Err(InputRouteError::UnknownTimer { timer_id });
        }

        let button = timer_context.button;
        if !self.held_buttons.contains(&button) {
            self.timer_buttons.remove(&timer_id);
            self.printable_timers.remove(&timer_id);
            return Ok(InputRouterOutput::default());
        }

        let events =
            if self.focus == InputFocus::TextEntry && self.printable_timers.contains(&timer_id) {
                Vec::new()
            } else {
                vec![ButtonEvent::Pressed(button)]
            };

        let command = match scheduler.schedule(
            fired.endpoint,
            TimerOwner::input_repeat(button),
            self.map.repeat_interval_ms,
            TimeClass::HumanInput,
        ) {
            Ok(command) => command,
            Err(error) => {
                self.timer_buttons.remove(&timer_id);
                self.printable_timers.remove(&timer_id);
                return Err(error.into());
            }
        };
        let SchedulerCommand::Schedule { timer } = command else {
            self.timer_buttons.remove(&timer_id);
            self.printable_timers.remove(&timer_id);
            return Err(InputRouteError::SchedulerInvariant);
        };

        self.timer_buttons.remove(&timer_id);
        self.timer_buttons.insert(
            timer.timer_id,
            TimerContext {
                endpoint: timer.endpoint,
                button,
            },
        );
        if self.printable_timers.remove(&timer_id) {
            self.printable_timers.insert(timer.timer_id);
        }

        Ok(InputRouterOutput {
            events,
            timers: vec![InputTimerCommand::Schedule {
                timer_id: timer.timer_id,
                delay_ms: timer.delay_ms,
            }],
        })
    }

    pub fn is_held(&self, button: GameButton) -> bool {
        self.held_buttons.contains(&button)
    }

    pub fn clear(&mut self, scheduler: &mut KernelScheduler) -> InputRouterOutput {
        let timer_ids = self.timer_buttons.keys().copied().collect::<Vec<_>>();
        let timers = timer_ids
            .into_iter()
            .filter_map(|timer_id| match scheduler.cancel(timer_id) {
                Some(SchedulerCommand::Cancel { timer_id, .. }) => {
                    Some(InputTimerCommand::Cancel { timer_id })
                }
                Some(_) | None => None,
            })
            .collect();
        self.held_buttons.clear();
        self.suppressed_keys.clear();
        self.keyboard_presses.clear();
        self.gamepad_presses.clear();
        self.timer_buttons.clear();
        self.printable_timers.clear();
        InputRouterOutput {
            events: Vec::new(),
            timers,
        }
    }

    fn keyboard_down(
        &mut self,
        endpoint: SeatId,
        code: PhysicalKey,
        printable: bool,
        scheduler: &mut KernelScheduler,
    ) -> Result<InputRouterOutput, InputRouteError> {
        if self.suppressed_keys.contains(&code) || self.keyboard_presses.contains_key(&code) {
            return Ok(InputRouterOutput::default());
        }

        if printable && self.focus == InputFocus::TextEntry {
            self.suppressed_keys.insert(code);
            return Ok(InputRouterOutput::default());
        }

        let Some(button) = self.keyboard_button(&code) else {
            return Ok(InputRouterOutput::default());
        };
        if self.held_buttons.contains(&button) {
            self.keyboard_presses.insert(code, PhysicalPress::Blocked);
            return Ok(InputRouterOutput::default());
        }

        let output = self.accept_button(endpoint, button, printable, scheduler)?;
        self.keyboard_presses
            .insert(code, PhysicalPress::Accepted(button));
        Ok(output)
    }

    fn keyboard_up(
        &mut self,
        code: PhysicalKey,
        scheduler: &mut KernelScheduler,
    ) -> Result<InputRouterOutput, InputRouteError> {
        if self.suppressed_keys.remove(&code) {
            return Ok(InputRouterOutput::default());
        }

        match self.keyboard_presses.remove(&code) {
            Some(PhysicalPress::Accepted(button)) => Ok(self.release_button(button, scheduler)),
            Some(PhysicalPress::Blocked) | None => Ok(InputRouterOutput::default()),
        }
    }

    fn gamepad_down(
        &mut self,
        endpoint: SeatId,
        button_index: u16,
        scheduler: &mut KernelScheduler,
    ) -> Result<InputRouterOutput, InputRouteError> {
        if self.gamepad_presses.contains_key(&button_index) {
            return Ok(InputRouterOutput::default());
        }

        let Some(button) = self.gamepad_button(button_index) else {
            return Ok(InputRouterOutput::default());
        };
        if self.held_buttons.contains(&button) {
            self.gamepad_presses
                .insert(button_index, PhysicalPress::Blocked);
            return Ok(InputRouterOutput::default());
        }

        let output = self.accept_button(endpoint, button, false, scheduler)?;
        self.gamepad_presses
            .insert(button_index, PhysicalPress::Accepted(button));
        Ok(output)
    }

    fn gamepad_up(
        &mut self,
        button_index: u16,
        scheduler: &mut KernelScheduler,
    ) -> Result<InputRouterOutput, InputRouteError> {
        match self.gamepad_presses.remove(&button_index) {
            Some(PhysicalPress::Accepted(button)) => Ok(self.release_button(button, scheduler)),
            Some(PhysicalPress::Blocked) | None => Ok(InputRouterOutput::default()),
        }
    }

    fn keyboard_button(&self, code: &PhysicalKey) -> Option<GameButton> {
        self.map
            .keyboard
            .iter()
            .find(|binding| binding.key.eq(code))
            .map(|binding| binding.button)
    }

    fn gamepad_button(&self, button_index: u16) -> Option<GameButton> {
        self.map
            .gamepad
            .iter()
            .find(|binding| binding.button_index == button_index)
            .map(|binding| binding.button)
    }

    fn accept_button(
        &mut self,
        endpoint: SeatId,
        button: GameButton,
        printable: bool,
        scheduler: &mut KernelScheduler,
    ) -> Result<InputRouterOutput, InputRouteError> {
        let command = scheduler.schedule(
            endpoint,
            TimerOwner::input_repeat(button),
            self.map.initial_repeat_delay_ms,
            TimeClass::HumanInput,
        )?;
        let SchedulerCommand::Schedule { timer } = command else {
            return Err(InputRouteError::SchedulerInvariant);
        };
        let timer_id = timer.timer_id;
        self.held_buttons.insert(button);
        if printable {
            self.printable_timers.insert(timer_id);
        }
        self.timer_buttons
            .insert(timer_id, TimerContext { endpoint, button });
        Ok(InputRouterOutput {
            events: vec![ButtonEvent::Pressed(button)],
            timers: vec![InputTimerCommand::Schedule {
                timer_id,
                delay_ms: timer.delay_ms,
            }],
        })
    }

    fn release_button(
        &mut self,
        button: GameButton,
        scheduler: &mut KernelScheduler,
    ) -> InputRouterOutput {
        if !self.held_buttons.remove(&button) {
            return InputRouterOutput::default();
        }

        let timer_id = self
            .timer_buttons
            .iter()
            .find_map(|(timer_id, timer_context)| {
                (timer_context.button == button).then_some(*timer_id)
            });
        let timers = match timer_id {
            Some(timer_id) => {
                self.timer_buttons.remove(&timer_id);
                self.printable_timers.remove(&timer_id);
                match scheduler.cancel(timer_id) {
                    Some(SchedulerCommand::Cancel { timer_id, .. }) => {
                        vec![InputTimerCommand::Cancel { timer_id }]
                    }
                    Some(_) | None => Vec::new(),
                }
            }
            None => Vec::new(),
        };
        InputRouterOutput {
            events: vec![ButtonEvent::Released(button)],
            timers,
        }
    }

    pub(crate) fn discard_timer(&mut self, timer_id: TimerId, scheduler: &mut KernelScheduler) {
        let _ = scheduler.cancel(timer_id);
        self.timer_buttons.remove(&timer_id);
        self.printable_timers.remove(&timer_id);
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum InputRouteError {
    #[error("input repeat timer {timer_id} is not owned by the router")]
    UnknownTimer { timer_id: TimerId },
    #[error("input repeat timer identifiers are exhausted")]
    TimerIdExhausted,
    #[error("input scheduler returned an unexpected command")]
    SchedulerInvariant,
    #[error("input scheduler rejected the transition: {0}")]
    Scheduler(SchedulerError),
}

impl From<SchedulerError> for InputRouteError {
    fn from(error: SchedulerError) -> Self {
        match error {
            SchedulerError::TimerIdExhausted => Self::TimerIdExhausted,
            SchedulerError::UnknownTimer { timer_id } => Self::UnknownTimer { timer_id },
            other => Self::Scheduler(other),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::{GamepadBinding, KeyBinding};

    fn safe(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("input-router test value must fit in SafeU53")
    }

    fn timer(value: u64) -> TimerId {
        TimerId::new(safe(value))
    }

    fn input_map(
        keyboard: Vec<(PhysicalKey, GameButton)>,
        gamepad: Vec<(u16, GameButton)>,
    ) -> InputMap {
        input_map_with_timing(keyboard, gamepad, safe(1_000), safe(2_000))
    }

    fn input_map_with_timing(
        keyboard: Vec<(PhysicalKey, GameButton)>,
        gamepad: Vec<(u16, GameButton)>,
        initial_repeat_delay_ms: SafeU53,
        repeat_interval_ms: SafeU53,
    ) -> InputMap {
        InputMap {
            keyboard: keyboard
                .into_iter()
                .map(|(key, button)| KeyBinding { key, button })
                .collect(),
            gamepad: gamepad
                .into_iter()
                .map(|(button_index, button)| GamepadBinding {
                    button_index,
                    button,
                })
                .collect(),
            initial_repeat_delay_ms,
            repeat_interval_ms,
        }
    }

    fn key_down() -> RawInputEvent {
        RawInputEvent::KeyDown {
            code: PhysicalKey::KeyA,
            printable: true,
            browser_repeat: false,
            focus: InputFocus::Game,
        }
    }

    fn key_down_for(code: PhysicalKey, printable: bool, focus: InputFocus) -> RawInputEvent {
        RawInputEvent::KeyDown {
            code,
            printable,
            browser_repeat: false,
            focus,
        }
    }

    fn fire(
        router: &mut InputRouter,
        scheduler: &mut KernelScheduler,
        timer_id: TimerId,
    ) -> Result<InputRouterOutput, InputRouteError> {
        let fired = scheduler.fired(timer_id).map_err(InputRouteError::from)?;
        router.timer_fired(fired, scheduler)
    }

    #[test]
    fn scheduler_owns_first_id_and_repeat_gets_fresh_id() -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));

        assert_eq!(
            router.handle(endpoint, key_down(), &mut scheduler)?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Action)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(0),
                    delay_ms: safe(250),
                }],
            }
        );
        let fired = scheduler.fired(timer(0)).map_err(InputRouteError::from)?;
        let repeated = router.timer_fired(fired, &mut scheduler)?;
        assert_eq!(
            repeated.timers,
            vec![InputTimerCommand::Schedule {
                timer_id: timer(1),
                delay_ms: safe(250),
            }]
        );
        assert!(scheduler.timer(timer(0)).is_none());
        assert!(scheduler.timer(timer(1)).is_some());

        let released = router.handle(
            endpoint,
            RawInputEvent::KeyUp {
                code: PhysicalKey::KeyA,
            },
            &mut scheduler,
        )?;
        assert_eq!(
            released.timers,
            vec![InputTimerCommand::Cancel { timer_id: timer(1) }]
        );
        assert!(scheduler.live_timers().is_empty());
        Ok(())
    }

    #[test]
    fn scheduler_collision_does_not_overwrite_another_owner() -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        scheduler
            .schedule(
                endpoint,
                TimerOwner::new("other", "other/address", "other-reason")
                    .map_err(|_| InputRouteError::SchedulerInvariant)?,
                safe(10),
                TimeClass::Absolute,
            )
            .map_err(InputRouteError::from)?;
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));

        let output = router.handle(endpoint, key_down(), &mut scheduler)?;
        assert_eq!(
            output.timers,
            vec![InputTimerCommand::Schedule {
                timer_id: timer(1),
                delay_ms: safe(250),
            }]
        );
        assert_eq!(
            scheduler
                .timer(timer(0))
                .map(|timer| timer.owner.owner_id.as_str()),
            Some("other")
        );
        Ok(())
    }

    #[test]
    fn wrong_owner_fired_input_fails_closed() -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));
        router.handle(endpoint, key_down(), &mut scheduler)?;
        let mut fired = scheduler.fired(timer(0)).map_err(InputRouteError::from)?;
        fired.owner = TimerOwner::new("other", "other/address", "other-reason")
            .map_err(|_| InputRouteError::SchedulerInvariant)?;

        assert_eq!(
            router.timer_fired(fired, &mut scheduler),
            Err(InputRouteError::UnknownTimer { timer_id: timer(0) })
        );
        assert!(router.is_held(GameButton::Action));
        assert!(scheduler.live_timers().is_empty());
        Ok(())
    }

    #[test]
    fn blur_and_map_replacement_cancel_real_scheduler_timers() -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(
            vec![
                (PhysicalKey::KeyA, GameButton::Action),
                (PhysicalKey::KeyB, GameButton::Cancel),
            ],
            Vec::new(),
        ));
        router.handle(endpoint, key_down(), &mut scheduler)?;
        router.handle(
            endpoint,
            RawInputEvent::KeyDown {
                code: PhysicalKey::KeyB,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
            &mut scheduler,
        )?;
        let cleared = router.clear(&mut scheduler);
        assert_eq!(
            cleared.timers,
            vec![
                InputTimerCommand::Cancel { timer_id: timer(0) },
                InputTimerCommand::Cancel { timer_id: timer(1) },
            ]
        );
        assert!(scheduler.live_timers().is_empty());
        assert_eq!(
            router.replace_map(input_map(Vec::new(), Vec::new()), &mut scheduler),
            InputRouterOutput::default()
        );
        Ok(())
    }

    #[test]
    fn new_normalizes_repeat_cadence_and_preserves_bindings() -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map_with_timing(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            vec![(7, GameButton::Submit)],
            safe(0),
            safe(1_000),
        ));

        assert_eq!(router.input_map().initial_repeat_delay_ms, safe(250));
        assert_eq!(router.input_map().repeat_interval_ms, safe(250));
        assert_eq!(
            router.input_map().keyboard,
            vec![KeyBinding {
                key: PhysicalKey::KeyA,
                button: GameButton::Action,
            }]
        );
        assert_eq!(
            router.input_map().gamepad,
            vec![GamepadBinding {
                button_index: 7,
                button: GameButton::Submit,
            }]
        );

        assert_eq!(
            router.handle(
                endpoint,
                key_down_for(PhysicalKey::KeyA, false, InputFocus::Game),
                &mut scheduler,
            )?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Action)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(0),
                    delay_ms: safe(250),
                }],
            }
        );
        assert_eq!(
            fire(&mut router, &mut scheduler, timer(0))?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Action)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(1),
                    delay_ms: safe(250),
                }],
            }
        );
        Ok(())
    }

    #[test]
    fn replace_map_normalizes_repeat_cadence_and_preserves_bindings() -> Result<(), InputRouteError>
    {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(Vec::new(), Vec::new()));

        assert_eq!(
            router.replace_map(
                input_map_with_timing(
                    vec![(PhysicalKey::KeyB, GameButton::Cancel)],
                    vec![(9, GameButton::Menu)],
                    safe(999),
                    safe(0),
                ),
                &mut scheduler,
            ),
            InputRouterOutput::default()
        );
        assert_eq!(router.input_map().initial_repeat_delay_ms, safe(250));
        assert_eq!(router.input_map().repeat_interval_ms, safe(250));
        assert_eq!(
            router.input_map().keyboard,
            vec![KeyBinding {
                key: PhysicalKey::KeyB,
                button: GameButton::Cancel,
            }]
        );
        assert_eq!(
            router.input_map().gamepad,
            vec![GamepadBinding {
                button_index: 9,
                button: GameButton::Menu,
            }]
        );

        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::GamepadDown { button: 9 },
                &mut scheduler,
            )?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Menu)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(0),
                    delay_ms: safe(250),
                }],
            }
        );
        assert_eq!(
            fire(&mut router, &mut scheduler, timer(0))?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Menu)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(1),
                    delay_ms: safe(250),
                }],
            }
        );
        Ok(())
    }

    #[test]
    fn maps_keyboard_and_gamepad_with_immediate_press_and_initial_timer()
    -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            vec![(7, GameButton::Submit)],
        ));

        assert_eq!(
            router.handle(
                endpoint,
                key_down_for(PhysicalKey::KeyA, false, InputFocus::Game),
                &mut scheduler,
            )?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Action)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(0),
                    delay_ms: safe(250),
                }],
            }
        );
        assert!(router.is_held(GameButton::Action));
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyA,
                },
                &mut scheduler,
            )?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Action)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(0) }],
            }
        );

        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::GamepadDown { button: 7 },
                &mut scheduler,
            )?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Submit)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(1),
                    delay_ms: safe(250),
                }],
            }
        );
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::GamepadUp { button: 7 },
                &mut scheduler,
            )?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Submit)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(1) }],
            }
        );
        Ok(())
    }

    #[test]
    fn duplicate_bindings_resolve_to_the_first_mapping() -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(
            vec![
                (PhysicalKey::KeyA, GameButton::Action),
                (PhysicalKey::KeyA, GameButton::Cancel),
            ],
            vec![(3, GameButton::Submit), (3, GameButton::Cancel)],
        ));

        let output = router.handle(
            endpoint,
            key_down_for(PhysicalKey::KeyA, false, InputFocus::Game),
            &mut scheduler,
        )?;
        assert_eq!(
            output.events,
            vec![ButtonEvent::Pressed(GameButton::Action)]
        );
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyA,
                },
                &mut scheduler,
            )?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Action)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(0) }],
            }
        );

        let output = router.handle(
            endpoint,
            RawInputEvent::GamepadDown { button: 3 },
            &mut scheduler,
        )?;
        assert_eq!(
            output.events,
            vec![ButtonEvent::Pressed(GameButton::Submit)]
        );
        Ok(())
    }

    #[test]
    fn logical_lock_deduplicates_multiple_keys_gamepad_and_browser_repeat()
    -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(
            vec![
                (PhysicalKey::KeyA, GameButton::Action),
                (PhysicalKey::KeyB, GameButton::Action),
            ],
            vec![(1, GameButton::Action)],
        ));

        let press = router.handle(
            endpoint,
            key_down_for(PhysicalKey::KeyA, false, InputFocus::Game),
            &mut scheduler,
        )?;
        assert_eq!(press.events, vec![ButtonEvent::Pressed(GameButton::Action)]);
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyDown {
                    code: PhysicalKey::KeyA,
                    printable: false,
                    browser_repeat: true,
                    focus: InputFocus::Game,
                },
                &mut scheduler,
            )?,
            InputRouterOutput::default()
        );
        assert_eq!(
            router.handle(
                endpoint,
                key_down_for(PhysicalKey::KeyB, false, InputFocus::Game),
                &mut scheduler,
            )?,
            InputRouterOutput::default()
        );
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::GamepadDown { button: 1 },
                &mut scheduler,
            )?,
            InputRouterOutput::default()
        );

        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyB,
                },
                &mut scheduler,
            )?,
            InputRouterOutput::default()
        );
        assert!(router.is_held(GameButton::Action));
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyA,
                },
                &mut scheduler,
            )?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Action)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(0) }],
            }
        );
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::GamepadUp { button: 1 },
                &mut scheduler,
            )?,
            InputRouterOutput::default()
        );
        Ok(())
    }

    #[test]
    fn timer_repeats_while_held_and_is_cancelled_by_keyup() -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));
        router.handle(
            endpoint,
            key_down_for(PhysicalKey::KeyA, false, InputFocus::Game),
            &mut scheduler,
        )?;

        assert_eq!(
            fire(&mut router, &mut scheduler, timer(0))?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Action)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(1),
                    delay_ms: safe(250),
                }],
            }
        );
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyA,
                },
                &mut scheduler,
            )?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Action)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(1) }],
            }
        );
        assert_eq!(
            fire(&mut router, &mut scheduler, timer(0)),
            Err(InputRouteError::UnknownTimer { timer_id: timer(0) })
        );
        Ok(())
    }

    #[test]
    fn text_entry_suppression_has_matching_keyup_after_focus_changes() -> Result<(), InputRouteError>
    {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));
        assert_eq!(
            router.handle(
                endpoint,
                key_down_for(PhysicalKey::KeyA, true, InputFocus::TextEntry),
                &mut scheduler,
            )?,
            InputRouterOutput::default()
        );
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::FocusChanged(InputFocus::Game),
                &mut scheduler,
            )?,
            InputRouterOutput::default()
        );
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyA,
                },
                &mut scheduler,
            )?,
            InputRouterOutput::default()
        );
        assert!(!router.is_held(GameButton::Action));
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyA,
                },
                &mut scheduler,
            )?,
            InputRouterOutput::default()
        );
        Ok(())
    }

    #[test]
    fn accepted_printable_key_releases_after_focus_moves_to_text_entry()
    -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));
        router.handle(
            endpoint,
            key_down_for(PhysicalKey::KeyA, true, InputFocus::Game),
            &mut scheduler,
        )?;
        router.handle(
            endpoint,
            RawInputEvent::FocusChanged(InputFocus::TextEntry),
            &mut scheduler,
        )?;

        assert_eq!(
            fire(&mut router, &mut scheduler, timer(0))?,
            InputRouterOutput {
                events: Vec::new(),
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(1),
                    delay_ms: safe(250),
                }],
            }
        );
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyA,
                },
                &mut scheduler,
            )?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Action)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(1) }],
            }
        );
        Ok(())
    }

    #[test]
    fn unmatched_keyup_is_a_noop_and_does_not_remove_another_lock() -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(
            vec![
                (PhysicalKey::KeyA, GameButton::Action),
                (PhysicalKey::KeyB, GameButton::Cancel),
            ],
            Vec::new(),
        ));
        router.handle(
            endpoint,
            key_down_for(PhysicalKey::KeyA, false, InputFocus::Game),
            &mut scheduler,
        )?;

        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyB,
                },
                &mut scheduler,
            )?,
            InputRouterOutput::default()
        );
        assert!(router.is_held(GameButton::Action));
        assert_eq!(
            fire(&mut router, &mut scheduler, timer(0))?.events,
            vec![ButtonEvent::Pressed(GameButton::Action)]
        );
        Ok(())
    }

    #[test]
    fn scheduler_rejection_is_fail_atomic_for_initial_repeat_timer() {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        scheduler.dispose();
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));

        assert_eq!(
            router.handle(
                endpoint,
                key_down_for(PhysicalKey::KeyA, false, InputFocus::Game),
                &mut scheduler,
            ),
            Err(InputRouteError::Scheduler(SchedulerError::Disposed))
        );
        assert!(!router.is_held(GameButton::Action));
        assert!(scheduler.live_timers().is_empty());
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyA,
                },
                &mut scheduler,
            ),
            Ok(InputRouterOutput::default())
        );
    }

    #[test]
    fn scheduler_rejection_is_fail_atomic_for_repeat_reschedule() -> Result<(), InputRouteError> {
        let endpoint = SeatId::ZERO;
        let mut scheduler = KernelScheduler::new();
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));
        router.handle(
            endpoint,
            key_down_for(PhysicalKey::KeyA, false, InputFocus::Game),
            &mut scheduler,
        )?;
        let fired = scheduler.fired(timer(0)).map_err(InputRouteError::from)?;
        scheduler.dispose();

        assert_eq!(
            router.timer_fired(fired, &mut scheduler),
            Err(InputRouteError::Scheduler(SchedulerError::Disposed))
        );
        assert!(router.is_held(GameButton::Action));
        assert!(scheduler.live_timers().is_empty());
        assert_eq!(
            router.handle(
                endpoint,
                RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyA,
                },
                &mut scheduler,
            )?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Action)],
                timers: Vec::new(),
            }
        );
        Ok(())
    }

    #[test]
    fn scheduler_exhaustion_error_maps_to_input_error() {
        assert_eq!(
            InputRouteError::from(SchedulerError::TimerIdExhausted),
            InputRouteError::TimerIdExhausted
        );
    }
}
