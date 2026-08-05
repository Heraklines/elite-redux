//! Physical-input reducer and deterministic repeat ownership.

use std::collections::{BTreeMap, BTreeSet};

use er_types::{
    ButtonEvent, GameButton, InputFocus, InputMap, InputRouterOutput, InputTimerCommand,
    PhysicalKey, RawInputEvent, SafeU53, TimerId,
};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PhysicalPress {
    Accepted(GameButton),
    Blocked,
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
    timer_buttons: BTreeMap<TimerId, GameButton>,
    printable_timers: BTreeSet<TimerId>,
    next_timer_id: SafeU53,
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
            next_timer_id: SafeU53::ZERO,
            focus: InputFocus::Game,
        }
    }

    pub fn input_map(&self) -> &InputMap {
        &self.map
    }

    pub fn replace_map(&mut self, map: InputMap) -> InputRouterOutput {
        let output = self.clear();
        self.map = normalize_map(map);
        output
    }

    pub fn handle(&mut self, event: RawInputEvent) -> Result<InputRouterOutput, InputRouteError> {
        match event {
            RawInputEvent::KeyDown {
                code,
                printable,
                browser_repeat: _,
                focus,
            } => {
                self.focus = focus;
                self.keyboard_down(code, printable)
            }
            RawInputEvent::KeyUp { code } => self.keyboard_up(code),
            RawInputEvent::GamepadDown { button } => self.gamepad_down(button),
            RawInputEvent::GamepadUp { button } => self.gamepad_up(button),
            RawInputEvent::FocusChanged(focus) => {
                self.focus = focus;
                Ok(InputRouterOutput::default())
            }
            RawInputEvent::WindowBlurred => Ok(self.clear()),
            RawInputEvent::WindowFocused => {
                self.focus = InputFocus::Game;
                Ok(InputRouterOutput::default())
            }
        }
    }

    pub fn timer_fired(&mut self, timer_id: TimerId) -> Result<InputRouterOutput, InputRouteError> {
        let Some(&button) = self.timer_buttons.get(&timer_id) else {
            return Err(InputRouteError::UnknownTimer { timer_id });
        };

        if !self.held_buttons.contains(&button) {
            let _ = self.timer_buttons.remove(&timer_id);
            self.printable_timers.remove(&timer_id);
            return Ok(InputRouterOutput {
                events: Vec::new(),
                timers: vec![InputTimerCommand::Cancel { timer_id }],
            });
        }

        let events = if self.focus == InputFocus::TextEntry
            && self.printable_timers.contains(&timer_id)
        {
            Vec::new()
        } else {
            vec![ButtonEvent::Pressed(button)]
        };
        Ok(InputRouterOutput {
            events,
            timers: vec![InputTimerCommand::Schedule {
                timer_id,
                delay_ms: self.map.repeat_interval_ms,
            }],
        })
    }

    pub fn is_held(&self, button: GameButton) -> bool {
        self.held_buttons.contains(&button)
    }

    pub fn clear(&mut self) -> InputRouterOutput {
        let timers = self
            .timer_buttons
            .keys()
            .copied()
            .map(|timer_id| InputTimerCommand::Cancel { timer_id })
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
        code: PhysicalKey,
        printable: bool,
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

        let output = self.accept_button(button, printable)?;
        self.keyboard_presses
            .insert(code, PhysicalPress::Accepted(button));
        Ok(output)
    }

    fn keyboard_up(&mut self, code: PhysicalKey) -> Result<InputRouterOutput, InputRouteError> {
        if self.suppressed_keys.remove(&code) {
            return Ok(InputRouterOutput::default());
        }

        match self.keyboard_presses.remove(&code) {
            Some(PhysicalPress::Accepted(button)) => Ok(self.release_button(button)),
            Some(PhysicalPress::Blocked) | None => Ok(InputRouterOutput::default()),
        }
    }

    fn gamepad_down(&mut self, button_index: u16) -> Result<InputRouterOutput, InputRouteError> {
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

        let output = self.accept_button(button, false)?;
        self.gamepad_presses
            .insert(button_index, PhysicalPress::Accepted(button));
        Ok(output)
    }

    fn gamepad_up(&mut self, button_index: u16) -> Result<InputRouterOutput, InputRouteError> {
        match self.gamepad_presses.remove(&button_index) {
            Some(PhysicalPress::Accepted(button)) => Ok(self.release_button(button)),
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
        button: GameButton,
        printable: bool,
    ) -> Result<InputRouterOutput, InputRouteError> {
        let timer_id = self.allocate_timer(button)?;
        self.held_buttons.insert(button);
        if printable {
            self.printable_timers.insert(timer_id);
        }
        Ok(InputRouterOutput {
            events: vec![ButtonEvent::Pressed(button)],
            timers: vec![InputTimerCommand::Schedule {
                timer_id,
                delay_ms: self.map.initial_repeat_delay_ms,
            }],
        })
    }

    fn release_button(&mut self, button: GameButton) -> InputRouterOutput {
        if !self.held_buttons.remove(&button) {
            return InputRouterOutput::default();
        }

        let timer_id = self.timer_buttons.iter().find_map(|(timer_id, timer_button)| {
            if *timer_button == button {
                Some(*timer_id)
            } else {
                None
            }
        });
        let timers = match timer_id {
            Some(timer_id) => {
                let _ = self.timer_buttons.remove(&timer_id);
                self.printable_timers.remove(&timer_id);
                vec![InputTimerCommand::Cancel { timer_id }]
            }
            None => Vec::new(),
        };
        InputRouterOutput {
            events: vec![ButtonEvent::Released(button)],
            timers,
        }
    }

    fn allocate_timer(&mut self, button: GameButton) -> Result<TimerId, InputRouteError> {
        let next_value = self
            .next_timer_id
            .get()
            .checked_add(1)
            .ok_or(InputRouteError::TimerIdExhausted)?;
        let next_timer_id = SafeU53::new(next_value).map_err(|_| InputRouteError::TimerIdExhausted)?;
        let timer_id = TimerId::new(self.next_timer_id);
        self.next_timer_id = next_timer_id;
        self.timer_buttons.insert(timer_id, button);
        Ok(timer_id)
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum InputRouteError {
    #[error("input repeat timer {timer_id} is not owned by the router")]
    UnknownTimer { timer_id: TimerId },
    #[error("input repeat timer identifiers are exhausted")]
    TimerIdExhausted,
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::{GamepadBinding, KeyBinding};

    fn safe(value: u64) -> SafeU53 {
        match SafeU53::new(value) {
            Ok(value) => value,
            Err(_) => SafeU53::ZERO,
        }
    }

    fn timer(value: u64) -> TimerId {
        TimerId::new(safe(value))
    }

    fn input_map(
        keyboard: Vec<(PhysicalKey, GameButton)>,
        gamepad: Vec<(u16, GameButton)>,
    ) -> InputMap {
        input_map_with_timing(keyboard, gamepad, safe(250), safe(250))
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

    #[test]
    fn new_normalizes_repeat_cadence_and_preserves_bindings() -> Result<(), InputRouteError> {
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
            router.handle(RawInputEvent::KeyDown {
                code: PhysicalKey::KeyA,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            })?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Action)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(0),
                    delay_ms: safe(250),
                }],
            }
        );
        assert_eq!(
            router.timer_fired(timer(0))?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Action)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(0),
                    delay_ms: safe(250),
                }],
            }
        );
        Ok(())
    }

    #[test]
    fn replace_map_normalizes_repeat_cadence_and_preserves_bindings() -> Result<(), InputRouteError> {
        let mut router = InputRouter::new(input_map(Vec::new(), Vec::new()));

        assert_eq!(
            router.replace_map(input_map_with_timing(
                vec![(PhysicalKey::KeyB, GameButton::Cancel)],
                vec![(9, GameButton::Menu)],
                safe(999),
                safe(0),
            )),
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
            router.handle(RawInputEvent::GamepadDown { button: 9 })?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Menu)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(0),
                    delay_ms: safe(250),
                }],
            }
        );
        assert_eq!(
            router.timer_fired(timer(0))?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Menu)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(0),
                    delay_ms: safe(250),
                }],
            }
        );
        Ok(())
    }

    #[test]
    fn maps_keyboard_and_gamepad_with_immediate_press_and_initial_timer() -> Result<(), InputRouteError> {
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            vec![(7, GameButton::Submit)],
        ));

        assert_eq!(
            router.handle(RawInputEvent::KeyDown {
                code: PhysicalKey::KeyA,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            })?,
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
            router.handle(RawInputEvent::KeyUp {
                code: PhysicalKey::KeyA,
            })?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Action)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(0) }],
            }
        );

        assert_eq!(
            router.handle(RawInputEvent::GamepadDown { button: 7 })?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Submit)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(1),
                    delay_ms: safe(250),
                }],
            }
        );
        assert_eq!(
            router.handle(RawInputEvent::GamepadUp { button: 7 })?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Submit)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(1) }],
            }
        );
        Ok(())
    }

    #[test]
    fn duplicate_bindings_resolve_to_the_first_mapping() -> Result<(), InputRouteError> {
        let mut router = InputRouter::new(input_map(
            vec![
                (PhysicalKey::KeyA, GameButton::Action),
                (PhysicalKey::KeyA, GameButton::Cancel),
            ],
            vec![(3, GameButton::Submit), (3, GameButton::Cancel)],
        ));

        let output = router.handle(RawInputEvent::KeyDown {
            code: PhysicalKey::KeyA,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        })?;
        assert_eq!(output.events, vec![ButtonEvent::Pressed(GameButton::Action)]);
        assert_eq!(
            router.handle(RawInputEvent::KeyUp {
                code: PhysicalKey::KeyA,
            })?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Action)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(0) }],
            }
        );

        let output = router.handle(RawInputEvent::GamepadDown { button: 3 })?;
        assert_eq!(output.events, vec![ButtonEvent::Pressed(GameButton::Submit)]);
        Ok(())
    }

    #[test]
    fn logical_lock_deduplicates_keyboard_gamepad_and_browser_repeat() -> Result<(), InputRouteError> {
        let mut router = InputRouter::new(input_map(
            vec![
                (PhysicalKey::KeyA, GameButton::Action),
                (PhysicalKey::KeyB, GameButton::Action),
            ],
            vec![(1, GameButton::Action)],
        ));

        let press = router.handle(RawInputEvent::KeyDown {
            code: PhysicalKey::KeyA,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        })?;
        assert_eq!(press.events, vec![ButtonEvent::Pressed(GameButton::Action)]);
        assert_eq!(
            router.handle(RawInputEvent::KeyDown {
                code: PhysicalKey::KeyA,
                printable: false,
                browser_repeat: true,
                focus: InputFocus::Game,
            })?,
            InputRouterOutput::default()
        );
        assert_eq!(
            router.handle(RawInputEvent::KeyDown {
                code: PhysicalKey::KeyB,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            })?,
            InputRouterOutput::default()
        );
        assert_eq!(
            router.handle(RawInputEvent::GamepadDown { button: 1 })?,
            InputRouterOutput::default()
        );

        assert_eq!(
            router.handle(RawInputEvent::KeyUp {
                code: PhysicalKey::KeyB,
            })?,
            InputRouterOutput::default()
        );
        assert!(router.is_held(GameButton::Action));
        assert_eq!(
            router.handle(RawInputEvent::KeyUp {
                code: PhysicalKey::KeyA,
            })?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Action)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(0) }],
            }
        );
        assert_eq!(
            router.handle(RawInputEvent::GamepadUp { button: 1 })?,
            InputRouterOutput::default()
        );
        Ok(())
    }

    #[test]
    fn timer_repeats_while_held_and_is_cancelled_by_keyup() -> Result<(), InputRouteError> {
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));
        router.handle(RawInputEvent::KeyDown {
            code: PhysicalKey::KeyA,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        })?;

        assert_eq!(
            router.timer_fired(timer(0))?,
            InputRouterOutput {
                events: vec![ButtonEvent::Pressed(GameButton::Action)],
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(0),
                    delay_ms: safe(250),
                }],
            }
        );
        assert_eq!(
            router.handle(RawInputEvent::KeyUp {
                code: PhysicalKey::KeyA,
            })?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Action)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(0) }],
            }
        );
        assert_eq!(
            router.timer_fired(timer(0)),
            Err(InputRouteError::UnknownTimer { timer_id: timer(0) })
        );
        Ok(())
    }

    #[test]
    fn text_entry_suppression_has_matching_keyup_after_focus_changes() -> Result<(), InputRouteError> {
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));
        assert_eq!(
            router.handle(RawInputEvent::KeyDown {
                code: PhysicalKey::KeyA,
                printable: true,
                browser_repeat: false,
                focus: InputFocus::TextEntry,
            })?,
            InputRouterOutput::default()
        );
        assert_eq!(
            router.handle(RawInputEvent::FocusChanged(InputFocus::Game))?,
            InputRouterOutput::default()
        );
        assert_eq!(
            router.handle(RawInputEvent::KeyUp {
                code: PhysicalKey::KeyA,
            })?,
            InputRouterOutput::default()
        );
        assert!(!router.is_held(GameButton::Action));
        assert_eq!(
            router.handle(RawInputEvent::KeyUp {
                code: PhysicalKey::KeyA,
            })?,
            InputRouterOutput::default()
        );
        Ok(())
    }

    #[test]
    fn accepted_printable_key_releases_after_focus_moves_to_text_entry()
    -> Result<(), InputRouteError> {
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));
        router.handle(RawInputEvent::KeyDown {
            code: PhysicalKey::KeyA,
            printable: true,
            browser_repeat: false,
            focus: InputFocus::Game,
        })?;
        router.handle(RawInputEvent::FocusChanged(InputFocus::TextEntry))?;

        assert_eq!(
            router.timer_fired(timer(0))?,
            InputRouterOutput {
                events: Vec::new(),
                timers: vec![InputTimerCommand::Schedule {
                    timer_id: timer(0),
                    delay_ms: safe(250),
                }],
            }
        );
        assert_eq!(
            router.handle(RawInputEvent::KeyUp {
                code: PhysicalKey::KeyA,
            })?,
            InputRouterOutput {
                events: vec![ButtonEvent::Released(GameButton::Action)],
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(0) }],
            }
        );
        Ok(())
    }

    #[test]
    fn unmatched_keyup_is_a_noop_and_does_not_remove_another_lock() -> Result<(), InputRouteError> {
        let mut router = InputRouter::new(input_map(
            vec![
                (PhysicalKey::KeyA, GameButton::Action),
                (PhysicalKey::KeyB, GameButton::Cancel),
            ],
            Vec::new(),
        ));
        router.handle(RawInputEvent::KeyDown {
            code: PhysicalKey::KeyA,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        })?;

        assert_eq!(
            router.handle(RawInputEvent::KeyUp {
                code: PhysicalKey::KeyB,
            })?,
            InputRouterOutput::default()
        );
        assert!(router.is_held(GameButton::Action));
        assert_eq!(
            router.timer_fired(timer(0))?.events,
            vec![ButtonEvent::Pressed(GameButton::Action)]
        );
        Ok(())
    }

    #[test]
    fn blur_and_map_replacement_cancel_without_synthetic_release() -> Result<(), InputRouteError> {
        let mut router = InputRouter::new(input_map(
            vec![
                (PhysicalKey::KeyA, GameButton::Action),
                (PhysicalKey::KeyB, GameButton::Cancel),
                (PhysicalKey::KeyC, GameButton::Submit),
            ],
            Vec::new(),
        ));
        router.handle(RawInputEvent::KeyDown {
            code: PhysicalKey::KeyA,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        })?;
        router.handle(RawInputEvent::KeyDown {
            code: PhysicalKey::KeyB,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        })?;
        router.handle(RawInputEvent::KeyDown {
            code: PhysicalKey::KeyC,
            printable: true,
            browser_repeat: false,
            focus: InputFocus::TextEntry,
        })?;

        assert_eq!(
            router.handle(RawInputEvent::WindowBlurred)?,
            InputRouterOutput {
                events: Vec::new(),
                timers: vec![
                    InputTimerCommand::Cancel { timer_id: timer(0) },
                    InputTimerCommand::Cancel { timer_id: timer(1) },
                ],
            }
        );
        assert!(!router.is_held(GameButton::Action));
        assert!(!router.is_held(GameButton::Cancel));
        assert_eq!(
            router.handle(RawInputEvent::KeyUp {
                code: PhysicalKey::KeyA,
            })?,
            InputRouterOutput::default()
        );

        router.handle(RawInputEvent::KeyDown {
            code: PhysicalKey::KeyA,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        })?;
        assert_eq!(
            router.replace_map(input_map(
                vec![(PhysicalKey::KeyA, GameButton::Submit)],
                Vec::new(),
            )),
            InputRouterOutput {
                events: Vec::new(),
                timers: vec![InputTimerCommand::Cancel { timer_id: timer(2) }],
            }
        );
        assert!(!router.is_held(GameButton::Action));
        Ok(())
    }

    #[test]
    fn timer_id_exhaustion_is_fallible_and_does_not_accept_the_press() {
        let mut router = InputRouter::new(input_map(
            vec![(PhysicalKey::KeyA, GameButton::Action)],
            Vec::new(),
        ));
        router.next_timer_id = SafeU53::MAX;

        assert_eq!(
            router.handle(RawInputEvent::KeyDown {
                code: PhysicalKey::KeyA,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            }),
            Err(InputRouteError::TimerIdExhausted)
        );
        assert!(!router.is_held(GameButton::Action));
        assert_eq!(
            router.handle(RawInputEvent::KeyUp {
                code: PhysicalKey::KeyA,
            }),
            Ok(InputRouterOutput::default())
        );
    }
}
