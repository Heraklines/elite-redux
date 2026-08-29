//! Physical-input reducer and deterministic repeat ownership.

use std::collections::{BTreeMap, BTreeSet};

use er_protocol::{KernelScheduler, ScheduledTimer, SchedulerCommand, SchedulerError};
use er_types::battle_ids::MenuInstanceId;
use er_types::{
    ButtonEvent, GameButton, InputFocus, InputMap, InputRouterOutput, InputTimerCommand,
    KeyBinding, PhysicalKey, RawInputEvent, SafeU53, SeatId, TimeClass, TimerId, TimerOwner,
};
use thiserror::Error;

use crate::snapshot::{
    HeldLogicalButtonSnapshotV2, InputButtonLockSnapshotV2, InputRepeatSnapshotV2,
    InputRouterSnapshotV2, PhysicalInputSourceV2, PressedPhysicalInputSnapshotV2, SnapshotError,
};

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

/// The physical identity retained by the battle-only input path.
///
/// This type deliberately does not implement `Serialize`: it is scheduler/UI
/// bookkeeping, not a wire or campaign value.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) enum BattlePhysicalSource {
    Keyboard(PhysicalKey),
    Gamepad(u16),
}

impl BattlePhysicalSource {
    fn snapshot(&self) -> PhysicalInputSourceV2 {
        match self {
            Self::Keyboard(code) => PhysicalInputSourceV2::Keyboard(code.clone()),
            Self::Gamepad(button) => PhysicalInputSourceV2::Gamepad(*button),
        }
    }

    fn from_snapshot(source: PhysicalInputSourceV2) -> Self {
        match source {
            PhysicalInputSourceV2::Keyboard(code) => Self::Keyboard(code),
            PhysicalInputSourceV2::Gamepad(button) => Self::Gamepad(button),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BattleButtonEvent {
    Pressed {
        seat: SeatId,
        button: GameButton,
        menu_instance_id: MenuInstanceId,
    },
    Released {
        seat: SeatId,
        button: GameButton,
        menu_instance_id: MenuInstanceId,
    },
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct BattleInputOutput {
    pub events: Vec<BattleButtonEvent>,
    pub timers: Vec<InputTimerCommand>,
}

/// The battle router shares scheduler failure classification with the legacy
/// router while keeping its state and identity domain separate.
pub(crate) type BattleInputError = InputRouteError;

#[derive(Clone, Debug, Eq, PartialEq)]
struct BattleHeldContext {
    button: GameButton,
    menu_instance_id: MenuInstanceId,
    timer_id: Option<TimerId>,
    printable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct BattleLockContext {
    source: BattlePhysicalSource,
    menu_instance_id: MenuInstanceId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct BattleTimerContext {
    endpoint: SeatId,
    source: BattlePhysicalSource,
    button: GameButton,
    menu_instance_id: MenuInstanceId,
    printable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum BattlePhysicalPress {
    Accepted(BattleHeldContext),
    Blocked { printable: bool },
    Suppressed { printable: bool },
}

/// Menu-instance-bound raw input for M3 battle mode.
///
/// `InputRouter` above remains the M1/M2 compatibility implementation. This
/// router is intentionally not used by that path: a battle press carries its
/// seat, physical source, logical button, and receiving menu instance all the
/// way through repeat and key-up cleanup.
#[derive(Clone, Debug)]
pub(crate) struct BattleInputRouter {
    map: InputMap,
    pressed: BTreeMap<(SeatId, BattlePhysicalSource), BattlePhysicalPress>,
    suppressed: BTreeSet<(SeatId, PhysicalKey)>,
    held: BTreeMap<(SeatId, BattlePhysicalSource), BattleHeldContext>,
    locks: BTreeMap<(SeatId, GameButton), BattleLockContext>,
    timers: BTreeMap<TimerId, BattleTimerContext>,
    focus: InputFocus,
    disposed: bool,
}

impl BattleInputRouter {
    pub(crate) fn new(map: InputMap) -> Self {
        Self {
            map: normalize_map(map),
            pressed: BTreeMap::new(),
            suppressed: BTreeSet::new(),
            held: BTreeMap::new(),
            locks: BTreeMap::new(),
            timers: BTreeMap::new(),
            focus: InputFocus::Game,
            disposed: false,
        }
    }

    pub(crate) fn with_default_map() -> Self {
        Self::new(Self::default_map())
    }

    pub(crate) fn default_map() -> InputMap {
        InputMap {
            keyboard: vec![
                KeyBinding {
                    key: PhysicalKey::ArrowUp,
                    button: GameButton::Up,
                },
                KeyBinding {
                    key: PhysicalKey::ArrowDown,
                    button: GameButton::Down,
                },
                KeyBinding {
                    key: PhysicalKey::ArrowLeft,
                    button: GameButton::Left,
                },
                KeyBinding {
                    key: PhysicalKey::ArrowRight,
                    button: GameButton::Right,
                },
                KeyBinding {
                    key: PhysicalKey::Enter,
                    button: GameButton::Submit,
                },
                KeyBinding {
                    key: PhysicalKey::Space,
                    button: GameButton::Action,
                },
                KeyBinding {
                    key: PhysicalKey::Backspace,
                    button: GameButton::Cancel,
                },
            ],
            gamepad: Vec::new(),
            initial_repeat_delay_ms: FIXED_REPEAT_CADENCE_MS,
            repeat_interval_ms: FIXED_REPEAT_CADENCE_MS,
        }
    }

    /// Retained for crate-local diagnostics and integration tests that inspect
    /// the normalized repeat cadence and bindings.
    #[allow(dead_code)]
    pub(crate) fn input_map(&self) -> &InputMap {
        &self.map
    }

    /// Retained for crate-local lifecycle diagnostics and integration tests
    /// that verify held physical input is cleared.
    #[allow(dead_code)]
    pub(crate) fn held_count(&self) -> usize {
        self.held.len()
    }

    /// Retained for crate-local lifecycle diagnostics and integration tests
    /// that verify logical button locks are cleared.
    #[allow(dead_code)]
    pub(crate) fn lock_count(&self) -> usize {
        self.locks.len()
    }

    /// Retained for crate-local lifecycle diagnostics and integration tests
    /// that verify repeat timers are cleared.
    #[allow(dead_code)]
    pub(crate) fn repeat_count(&self) -> usize {
        self.timers.len()
    }

    pub(crate) fn owns_scheduled_timer(&self, scheduled: &ScheduledTimer) -> bool {
        self.timers.get(&scheduled.timer_id).is_some_and(|context| {
            scheduled.endpoint == context.endpoint
                && scheduled.owner == TimerOwner::input_repeat(context.button)
                && scheduled.delay_ms == self.map.repeat_interval_ms
                && scheduled.time_class == TimeClass::HumanInput
        })
    }

    /// Retained for crate-local input-state diagnostics and integration tests.
    #[allow(dead_code)]
    pub(crate) fn is_held(&self, seat: SeatId, button: GameButton) -> bool {
        self.locks.contains_key(&(seat, button))
    }

    pub(crate) fn handle(
        &mut self,
        endpoint: SeatId,
        menu_instance_id: MenuInstanceId,
        event: RawInputEvent,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleInputError> {
        match event {
            RawInputEvent::KeyDown {
                code,
                printable,
                browser_repeat: _,
                focus,
            } => {
                self.focus = focus;
                self.keyboard_down(endpoint, menu_instance_id, code, printable, scheduler)
            }
            RawInputEvent::KeyUp { code } => self.keyboard_up(endpoint, code, scheduler),
            RawInputEvent::GamepadDown { button } => {
                self.gamepad_down(endpoint, menu_instance_id, button, scheduler)
            }
            RawInputEvent::GamepadUp { button } => self.gamepad_up(endpoint, button, scheduler),
            RawInputEvent::FocusChanged(focus) => {
                self.focus = focus;
                Ok(BattleInputOutput::default())
            }
            RawInputEvent::WindowBlurred => Ok(self.clear(scheduler)),
            RawInputEvent::WindowFocused => {
                self.focus = InputFocus::Game;
                Ok(BattleInputOutput::default())
            }
        }
    }

    pub(crate) fn timer_fired(
        &mut self,
        fired: ScheduledTimer,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleInputError> {
        let timer_id = fired.timer_id;
        let Some(timer_context) = self.timers.get(&timer_id).cloned() else {
            return Err(InputRouteError::UnknownTimer { timer_id });
        };
        if fired.endpoint != timer_context.endpoint
            || fired.owner != TimerOwner::input_repeat(timer_context.button)
            || fired.time_class != TimeClass::HumanInput
            || scheduler.timer(timer_id).is_some()
        {
            return Err(InputRouteError::UnknownTimer { timer_id });
        }

        let held_key = (timer_context.endpoint, timer_context.source.clone());
        let Some(held) = self.held.get(&held_key) else {
            self.timers.remove(&timer_id);
            return Ok(BattleInputOutput::default());
        };
        if held.timer_id != Some(timer_id)
            || held.button != timer_context.button
            || held.menu_instance_id != timer_context.menu_instance_id
            || held.printable != timer_context.printable
        {
            return Err(InputRouteError::UnknownTimer { timer_id });
        }

        let events = if self.focus == InputFocus::TextEntry && timer_context.printable {
            Vec::new()
        } else {
            vec![BattleButtonEvent::Pressed {
                seat: timer_context.endpoint,
                button: timer_context.button,
                menu_instance_id: timer_context.menu_instance_id,
            }]
        };

        let command = match scheduler.schedule(
            timer_context.endpoint,
            TimerOwner::input_repeat(timer_context.button),
            self.map.repeat_interval_ms,
            TimeClass::HumanInput,
        ) {
            Ok(command) => command,
            Err(error) => {
                self.timers.remove(&timer_id);
                if let Some(held) = self.held.get_mut(&held_key) {
                    held.timer_id = None;
                }
                if let Some(BattlePhysicalPress::Accepted(pressed)) =
                    self.pressed.get_mut(&held_key)
                {
                    pressed.timer_id = None;
                }
                return Err(error.into());
            }
        };
        let SchedulerCommand::Schedule { timer } = command else {
            self.timers.remove(&timer_id);
            if let Some(held) = self.held.get_mut(&held_key) {
                held.timer_id = None;
            }
            if let Some(BattlePhysicalPress::Accepted(pressed)) = self.pressed.get_mut(&held_key) {
                pressed.timer_id = None;
            }
            return Err(InputRouteError::SchedulerInvariant);
        };

        self.timers.remove(&timer_id);
        self.timers.insert(
            timer.timer_id,
            BattleTimerContext {
                endpoint: timer.endpoint,
                source: timer_context.source,
                button: timer_context.button,
                menu_instance_id: timer_context.menu_instance_id,
                printable: timer_context.printable,
            },
        );
        if let Some(held) = self.held.get_mut(&held_key) {
            held.timer_id = Some(timer.timer_id);
        }
        if let Some(BattlePhysicalPress::Accepted(pressed)) = self.pressed.get_mut(&held_key) {
            pressed.timer_id = Some(timer.timer_id);
        }

        Ok(BattleInputOutput {
            events,
            timers: vec![InputTimerCommand::Schedule {
                timer_id: timer.timer_id,
                delay_ms: timer.delay_ms,
            }],
        })
    }

    pub(crate) fn clear(&mut self, scheduler: &mut KernelScheduler) -> BattleInputOutput {
        let timers = self
            .timers
            .keys()
            .copied()
            .filter_map(|timer_id| match scheduler.cancel(timer_id) {
                Some(SchedulerCommand::Cancel { timer_id, .. }) => {
                    Some(InputTimerCommand::Cancel { timer_id })
                }
                Some(_) | None => None,
            })
            .collect();
        self.pressed.clear();
        self.suppressed.clear();
        self.held.clear();
        self.locks.clear();
        self.timers.clear();
        BattleInputOutput {
            events: Vec::new(),
            timers,
        }
    }

    pub(crate) fn dispose(&mut self, scheduler: &mut KernelScheduler) -> BattleInputOutput {
        if self.disposed {
            return BattleInputOutput::default();
        }
        self.disposed = true;
        self.clear(scheduler)
    }

    /// Retained for crate-local lifecycle diagnostics and integration tests.
    #[allow(dead_code)]
    pub(crate) fn is_disposed(&self) -> bool {
        self.disposed
    }

    pub(crate) fn discard_timer(&mut self, timer_id: TimerId, scheduler: &mut KernelScheduler) {
        let _ = scheduler.cancel(timer_id);
        self.timers.remove(&timer_id);
        for held in self.held.values_mut() {
            if held.timer_id == Some(timer_id) {
                held.timer_id = None;
            }
        }
        for press in self.pressed.values_mut() {
            if let BattlePhysicalPress::Accepted(held) = press
                && held.timer_id == Some(timer_id)
            {
                held.timer_id = None;
            }
        }
    }

    fn keyboard_down(
        &mut self,
        endpoint: SeatId,
        menu_instance_id: MenuInstanceId,
        code: PhysicalKey,
        printable: bool,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleInputError> {
        let source = BattlePhysicalSource::Keyboard(code.clone());
        let key = (endpoint, source.clone());
        if self.pressed.contains_key(&key) {
            return Ok(BattleInputOutput::default());
        }
        if printable && self.focus == InputFocus::TextEntry {
            self.suppressed.insert((endpoint, code));
            self.pressed
                .insert(key, BattlePhysicalPress::Suppressed { printable });
            return Ok(BattleInputOutput::default());
        }
        let Some(button) = self.keyboard_button(&code) else {
            self.pressed
                .insert(key, BattlePhysicalPress::Blocked { printable });
            return Ok(BattleInputOutput::default());
        };
        self.accept_physical(
            endpoint,
            menu_instance_id,
            source,
            button,
            printable,
            scheduler,
        )
    }

    fn keyboard_up(
        &mut self,
        endpoint: SeatId,
        code: PhysicalKey,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleInputError> {
        let source = BattlePhysicalSource::Keyboard(code.clone());
        if self.suppressed.remove(&(endpoint, code)) {
            self.pressed.remove(&(endpoint, source));
            return Ok(BattleInputOutput::default());
        }
        self.release_physical(endpoint, source, scheduler)
    }

    fn gamepad_down(
        &mut self,
        endpoint: SeatId,
        menu_instance_id: MenuInstanceId,
        button_index: u16,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleInputError> {
        let source = BattlePhysicalSource::Gamepad(button_index);
        let key = (endpoint, source.clone());
        if self.pressed.contains_key(&key) {
            return Ok(BattleInputOutput::default());
        }
        let Some(button) = self.gamepad_button(button_index) else {
            self.pressed
                .insert(key, BattlePhysicalPress::Blocked { printable: false });
            return Ok(BattleInputOutput::default());
        };
        self.accept_physical(endpoint, menu_instance_id, source, button, false, scheduler)
    }

    fn gamepad_up(
        &mut self,
        endpoint: SeatId,
        button_index: u16,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleInputError> {
        self.release_physical(
            endpoint,
            BattlePhysicalSource::Gamepad(button_index),
            scheduler,
        )
    }

    fn keyboard_button(&self, code: &PhysicalKey) -> Option<GameButton> {
        self.map
            .keyboard
            .iter()
            .find(|binding| binding.key == *code)
            .map(|binding| binding.button)
    }

    fn gamepad_button(&self, button_index: u16) -> Option<GameButton> {
        self.map
            .gamepad
            .iter()
            .find(|binding| binding.button_index == button_index)
            .map(|binding| binding.button)
    }

    fn accept_physical(
        &mut self,
        endpoint: SeatId,
        menu_instance_id: MenuInstanceId,
        source: BattlePhysicalSource,
        button: GameButton,
        printable: bool,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleInputError> {
        let key = (endpoint, source.clone());
        if self.locks.contains_key(&(endpoint, button)) {
            self.pressed
                .insert(key, BattlePhysicalPress::Blocked { printable });
            return Ok(BattleInputOutput::default());
        }

        let command = scheduler.schedule(
            endpoint,
            TimerOwner::input_repeat(button),
            self.map.initial_repeat_delay_ms,
            TimeClass::HumanInput,
        )?;
        let SchedulerCommand::Schedule { timer } = command else {
            return Err(InputRouteError::SchedulerInvariant);
        };
        let held = BattleHeldContext {
            button,
            menu_instance_id,
            timer_id: Some(timer.timer_id),
            printable,
        };
        self.pressed
            .insert(key.clone(), BattlePhysicalPress::Accepted(held.clone()));
        self.held.insert(key, held);
        self.locks.insert(
            (endpoint, button),
            BattleLockContext {
                source: source.clone(),
                menu_instance_id,
            },
        );
        self.timers.insert(
            timer.timer_id,
            BattleTimerContext {
                endpoint,
                source,
                button,
                menu_instance_id,
                printable,
            },
        );
        Ok(BattleInputOutput {
            events: vec![BattleButtonEvent::Pressed {
                seat: endpoint,
                button,
                menu_instance_id,
            }],
            timers: vec![InputTimerCommand::Schedule {
                timer_id: timer.timer_id,
                delay_ms: timer.delay_ms,
            }],
        })
    }

    fn release_physical(
        &mut self,
        endpoint: SeatId,
        source: BattlePhysicalSource,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleInputError> {
        let key = (endpoint, source.clone());
        let Some(press) = self.pressed.remove(&key) else {
            return Ok(BattleInputOutput::default());
        };
        let BattlePhysicalPress::Accepted(held) = press else {
            return Ok(BattleInputOutput::default());
        };
        self.held.remove(&key);
        if self
            .locks
            .get(&(endpoint, held.button))
            .is_some_and(|lock| {
                lock.source == source && lock.menu_instance_id == held.menu_instance_id
            })
        {
            self.locks.remove(&(endpoint, held.button));
        }

        let timer_id = held.timer_id.or_else(|| {
            self.timers.iter().find_map(|(timer_id, context)| {
                (context.endpoint == endpoint
                    && context.source == source
                    && context.button == held.button)
                    .then_some(*timer_id)
            })
        });
        let timers = match timer_id {
            Some(timer_id) => {
                self.timers.remove(&timer_id);
                match scheduler.cancel(timer_id) {
                    Some(SchedulerCommand::Cancel { timer_id, .. }) => {
                        vec![InputTimerCommand::Cancel { timer_id }]
                    }
                    Some(_) | None => Vec::new(),
                }
            }
            None => Vec::new(),
        };
        Ok(BattleInputOutput {
            events: vec![BattleButtonEvent::Released {
                seat: endpoint,
                button: held.button,
                menu_instance_id: held.menu_instance_id,
            }],
            timers,
        })
    }

    /// Capture the complete battle-owned physical input graph.  Battle mode
    /// has one fixed production map; accepting another map here would make a
    /// restored physical source resolve to a different logical button.
    pub(crate) fn snapshot_v2(
        &self,
        scheduler: &KernelScheduler,
    ) -> Result<InputRouterSnapshotV2, SnapshotError> {
        self.validate_fixed_map()?;
        self.validate_live_state()?;
        let snapshot = self.snapshot_payload();
        snapshot.validate()?;
        validate_snapshot_map_bindings(&snapshot, &self.map)?;
        validate_scheduler_repeat_ownership(&snapshot, scheduler, &self.map)?;
        Ok(snapshot)
    }

    /// Construct a fresh router from an exact snapshot without mutating the
    /// scheduler or any existing owner.
    pub(crate) fn from_snapshot_v2(
        snapshot: InputRouterSnapshotV2,
        scheduler: &KernelScheduler,
    ) -> Result<Self, SnapshotError> {
        snapshot.validate()?;
        let map = Self::default_map();
        validate_snapshot_map_bindings(&snapshot, &map)?;
        validate_scheduler_repeat_ownership(&snapshot, scheduler, &map)?;

        let mut router = Self::new(map);
        router.focus = snapshot.focus;
        router.disposed = snapshot.disposed;

        for pressed in &snapshot.pressed {
            let source = BattlePhysicalSource::from_snapshot(pressed.source.clone());
            let key = (pressed.seat, source.clone());
            let press = if pressed.accepted {
                let button = pressed.logical_button.ok_or_else(|| {
                    input_snapshot_invalid(
                        "input_router.pressed",
                        "accepted physical input has no logical button",
                    )
                })?;
                let menu_instance_id = pressed.menu_instance_id.ok_or_else(|| {
                    input_snapshot_invalid(
                        "input_router.pressed",
                        "accepted physical input has no menu instance identity",
                    )
                })?;
                if !snapshot.held_buttons.iter().any(|held| {
                    held.seat == pressed.seat
                        && held.button == button
                        && held.source == pressed.source
                        && held.menu_instance_id == menu_instance_id
                }) {
                    return Err(input_snapshot_invalid(
                        "input_router.held_buttons",
                        "accepted physical input has no exact held owner",
                    ));
                }
                let timer_id = snapshot
                    .repeats
                    .iter()
                    .find(|repeat| {
                        repeat.seat == pressed.seat
                            && repeat.button == button
                            && repeat.source == pressed.source
                            && repeat.menu_instance_id == menu_instance_id
                    })
                    .map(|repeat| repeat.timer_id);
                BattlePhysicalPress::Accepted(BattleHeldContext {
                    button,
                    menu_instance_id,
                    timer_id,
                    printable: pressed.printable,
                })
            } else if matches!(&source, BattlePhysicalSource::Keyboard(code)
                if snapshot.suppressed_printable_keys.contains(code))
            {
                if !pressed.printable {
                    return Err(input_snapshot_invalid(
                        "input_router.suppressed_printable_keys",
                        "a suppressed printable key must retain printable=true",
                    ));
                }
                let BattlePhysicalSource::Keyboard(code) = &source else {
                    return Err(input_snapshot_invalid(
                        "input_router.suppressed_printable_keys",
                        "only keyboard sources can be suppressed",
                    ));
                };
                router.suppressed.insert((pressed.seat, code.clone()));
                BattlePhysicalPress::Suppressed {
                    printable: pressed.printable,
                }
            } else {
                BattlePhysicalPress::Blocked {
                    printable: pressed.printable,
                }
            };
            if router.pressed.insert(key, press).is_some() {
                return Err(input_snapshot_invalid(
                    "input_router.pressed",
                    "physical source identity was duplicated during restoration",
                ));
            }
        }

        for suppressed in &snapshot.suppressed_printable_keys {
            let matching = snapshot
                .pressed
                .iter()
                .filter(|pressed| {
                    pressed.source == PhysicalInputSourceV2::Keyboard(suppressed.clone())
                        && !pressed.accepted
                })
                .collect::<Vec<_>>();
            if matching.len() != 1 || !matching[0].printable {
                return Err(input_snapshot_invalid(
                    "input_router.suppressed_printable_keys",
                    "every suppressed key must have exactly one blocked physical press",
                ));
            }
        }

        for held in &snapshot.held_buttons {
            let source = BattlePhysicalSource::from_snapshot(held.source.clone());
            let key = (held.seat, source.clone());
            let Some(pressed) = snapshot.pressed.iter().find(|pressed| {
                pressed.seat == held.seat
                    && pressed.source == held.source
                    && pressed.accepted
                    && pressed.logical_button == Some(held.button)
                    && pressed.menu_instance_id == Some(held.menu_instance_id)
            }) else {
                return Err(input_snapshot_invalid(
                    "input_router.held_buttons",
                    "held logical button has no exact accepted physical press",
                ));
            };
            let timer_id = snapshot
                .repeats
                .iter()
                .find(|repeat| {
                    repeat.seat == held.seat
                        && repeat.button == held.button
                        && repeat.source == held.source
                        && repeat.menu_instance_id == held.menu_instance_id
                })
                .map(|repeat| repeat.timer_id);
            let context = BattleHeldContext {
                button: held.button,
                menu_instance_id: held.menu_instance_id,
                timer_id,
                printable: pressed.printable,
            };
            if router.held.insert(key, context).is_some() {
                return Err(input_snapshot_invalid(
                    "input_router.held_buttons",
                    "held source identity was duplicated during restoration",
                ));
            }
        }

        for lock in &snapshot.locks {
            let owners = snapshot
                .held_buttons
                .iter()
                .filter(|held| {
                    held.seat == lock.seat
                        && held.button == lock.button
                        && held.menu_instance_id == lock.menu_instance_id
                })
                .collect::<Vec<_>>();
            if owners.len() != 1 {
                return Err(input_snapshot_invalid(
                    "input_router.locks",
                    "every logical lock must identify exactly one held source",
                ));
            }
            let source = BattlePhysicalSource::from_snapshot(owners[0].source.clone());
            if router
                .locks
                .insert(
                    (lock.seat, lock.button),
                    BattleLockContext {
                        source,
                        menu_instance_id: lock.menu_instance_id,
                    },
                )
                .is_some()
            {
                return Err(input_snapshot_invalid(
                    "input_router.locks",
                    "a logical button has more than one lock owner",
                ));
            }
        }

        for repeat in &snapshot.repeats {
            let source = BattlePhysicalSource::from_snapshot(repeat.source.clone());
            let Some(held) = router.held.get(&(repeat.seat, source.clone())) else {
                return Err(input_snapshot_invalid(
                    "input_router.repeats",
                    "repeat timer has no exact held source",
                ));
            };
            if held.button != repeat.button || held.menu_instance_id != repeat.menu_instance_id {
                return Err(input_snapshot_invalid(
                    "input_router.repeats",
                    "repeat timer identity differs from its held source",
                ));
            }
            let context = BattleTimerContext {
                endpoint: repeat.seat,
                source,
                button: repeat.button,
                menu_instance_id: repeat.menu_instance_id,
                printable: held.printable,
            };
            if router.timers.insert(repeat.timer_id, context).is_some() {
                return Err(input_snapshot_invalid(
                    "input_router.repeats",
                    "repeat timer identity was duplicated during restoration",
                ));
            }
        }

        router.validate_live_state()?;
        Ok(router)
    }

    /// Restore into an existing router only after checking that its live map
    /// is the production map.  The candidate is built before assignment, so
    /// any rejection leaves the existing owner untouched.
    /// This in-place seam is retained for callers that already own a router;
    /// snapshot replay currently constructs candidates through
    /// `from_snapshot_v2`.
    #[allow(dead_code)]
    pub(crate) fn restore_snapshot_v2(
        &mut self,
        snapshot: InputRouterSnapshotV2,
        scheduler: &KernelScheduler,
    ) -> Result<(), SnapshotError> {
        self.validate_fixed_map()?;
        let candidate = Self::from_snapshot_v2(snapshot, scheduler)?;
        *self = candidate;
        Ok(())
    }

    fn snapshot_payload(&self) -> InputRouterSnapshotV2 {
        let mut held_buttons = self
            .held
            .iter()
            .map(|((seat, source), context)| HeldLogicalButtonSnapshotV2 {
                seat: *seat,
                button: context.button,
                source: source.snapshot(),
                menu_instance_id: context.menu_instance_id,
            })
            .collect::<Vec<_>>();
        held_buttons.sort_unstable_by_key(|held| {
            (
                held.seat,
                held.button,
                BattlePhysicalSource::from_snapshot(held.source.clone()),
            )
        });

        let mut locks = self
            .locks
            .iter()
            .map(|((seat, button), context)| InputButtonLockSnapshotV2 {
                seat: *seat,
                button: *button,
                menu_instance_id: context.menu_instance_id,
            })
            .collect::<Vec<_>>();
        locks.sort_unstable_by_key(|lock| (lock.seat, lock.button, lock.menu_instance_id));

        let mut repeats = self
            .timers
            .iter()
            .map(|(timer_id, context)| InputRepeatSnapshotV2 {
                seat: context.endpoint,
                button: context.button,
                source: context.source.snapshot(),
                menu_instance_id: context.menu_instance_id,
                timer_id: *timer_id,
            })
            .collect::<Vec<_>>();
        repeats.sort_unstable_by_key(|repeat| {
            (
                repeat.seat,
                repeat.button,
                BattlePhysicalSource::from_snapshot(repeat.source.clone()),
            )
        });

        let pressed = self
            .pressed
            .iter()
            .map(|((seat, source), press)| {
                let (logical_button, printable, accepted, menu_instance_id) = match press {
                    BattlePhysicalPress::Accepted(context) => (
                        Some(context.button),
                        context.printable,
                        true,
                        Some(context.menu_instance_id),
                    ),
                    BattlePhysicalPress::Blocked { printable }
                    | BattlePhysicalPress::Suppressed { printable } => {
                        (None, *printable, false, None)
                    }
                };
                PressedPhysicalInputSnapshotV2 {
                    seat: *seat,
                    source: source.snapshot(),
                    logical_button,
                    printable,
                    accepted,
                    menu_instance_id,
                }
            })
            .collect::<Vec<_>>();

        let mut suppressed_printable_keys = self
            .suppressed
            .iter()
            .map(|(_, code)| code.clone())
            .collect::<Vec<_>>();
        suppressed_printable_keys.sort_unstable();

        InputRouterSnapshotV2 {
            focus: self.focus,
            pressed,
            suppressed_printable_keys,
            held_buttons,
            locks,
            repeats,
            disposed: self.disposed,
        }
    }

    fn validate_fixed_map(&self) -> Result<(), SnapshotError> {
        if self.map != Self::default_map() {
            return Err(input_snapshot_invalid(
                "input_router.map",
                "production battle input map differs from the fixed default map",
            ));
        }
        Ok(())
    }

    fn validate_live_state(&self) -> Result<(), SnapshotError> {
        if self.disposed
            && (!self.pressed.is_empty()
                || !self.suppressed.is_empty()
                || !self.held.is_empty()
                || !self.locks.is_empty()
                || !self.timers.is_empty())
        {
            return Err(input_snapshot_invalid(
                "input_router.disposed",
                "disposed router cannot retain live input state",
            ));
        }

        for ((seat, source), press) in &self.pressed {
            match press {
                BattlePhysicalPress::Accepted(expected) => {
                    let Some(held) = self.held.get(&(*seat, source.clone())) else {
                        return Err(input_snapshot_invalid(
                            "input_router.pressed",
                            "accepted physical press has no held source",
                        ));
                    };
                    if held.button != expected.button
                        || held.menu_instance_id != expected.menu_instance_id
                        || held.printable != expected.printable
                    {
                        return Err(input_snapshot_invalid(
                            "input_router.pressed",
                            "accepted physical press differs from its held source",
                        ));
                    }
                }
                BattlePhysicalPress::Blocked { .. } => {
                    if self.held.contains_key(&(*seat, source.clone())) {
                        return Err(input_snapshot_invalid(
                            "input_router.pressed",
                            "blocked physical press retains a held source",
                        ));
                    }
                }
                BattlePhysicalPress::Suppressed { printable } => {
                    let BattlePhysicalSource::Keyboard(code) = source else {
                        return Err(input_snapshot_invalid(
                            "input_router.suppressed_printable_keys",
                            "only keyboard presses can be suppressed",
                        ));
                    };
                    if !*printable
                        || !self.suppressed.contains(&(*seat, code.clone()))
                        || self.held.contains_key(&(*seat, source.clone()))
                    {
                        return Err(input_snapshot_invalid(
                            "input_router.suppressed_printable_keys",
                            "suppressed key state is not retained exactly",
                        ));
                    }
                }
            }
        }

        for (seat, code) in &self.suppressed {
            let source = BattlePhysicalSource::Keyboard(code.clone());
            if !matches!(
                self.pressed.get(&(*seat, source)),
                Some(BattlePhysicalPress::Suppressed { printable: true })
            ) {
                return Err(input_snapshot_invalid(
                    "input_router.suppressed_printable_keys",
                    "suppressed key has no exact retained physical press",
                ));
            }
        }

        for ((seat, source), held) in &self.held {
            let Some(BattlePhysicalPress::Accepted(pressed)) =
                self.pressed.get(&(*seat, source.clone()))
            else {
                return Err(input_snapshot_invalid(
                    "input_router.held_buttons",
                    "held source has no accepted physical press",
                ));
            };
            if pressed.button != held.button
                || pressed.menu_instance_id != held.menu_instance_id
                || pressed.printable != held.printable
            {
                return Err(input_snapshot_invalid(
                    "input_router.held_buttons",
                    "held source differs from its accepted physical press",
                ));
            }
            let Some(lock) = self.locks.get(&(*seat, held.button)) else {
                return Err(input_snapshot_invalid(
                    "input_router.locks",
                    "held source has no logical button lock",
                ));
            };
            if lock.source != *source || lock.menu_instance_id != held.menu_instance_id {
                return Err(input_snapshot_invalid(
                    "input_router.locks",
                    "logical button lock differs from its held source",
                ));
            }
        }

        for ((seat, button), lock) in &self.locks {
            let Some(held) = self.held.get(&(*seat, lock.source.clone())) else {
                return Err(input_snapshot_invalid(
                    "input_router.locks",
                    "logical button lock has no held source",
                ));
            };
            if held.button != *button || held.menu_instance_id != lock.menu_instance_id {
                return Err(input_snapshot_invalid(
                    "input_router.locks",
                    "logical button lock identity differs from its held source",
                ));
            }
        }

        for (timer_id, timer) in &self.timers {
            let Some(held) = self.held.get(&(timer.endpoint, timer.source.clone())) else {
                return Err(input_snapshot_invalid(
                    "input_router.repeats",
                    "repeat timer has no held source",
                ));
            };
            if held.timer_id != Some(*timer_id)
                || held.button != timer.button
                || held.menu_instance_id != timer.menu_instance_id
                || held.printable != timer.printable
            {
                return Err(input_snapshot_invalid(
                    "input_router.repeats",
                    "repeat timer context differs from its held source",
                ));
            }
        }
        for ((seat, source), held) in &self.held {
            if let Some(timer_id) = held.timer_id {
                let Some(timer) = self.timers.get(&timer_id) else {
                    return Err(input_snapshot_invalid(
                        "input_router.repeats",
                        "held source references a missing repeat timer",
                    ));
                };
                if timer.endpoint != *seat
                    || timer.source != *source
                    || timer.button != held.button
                    || timer.menu_instance_id != held.menu_instance_id
                    || timer.printable != held.printable
                {
                    return Err(input_snapshot_invalid(
                        "input_router.repeats",
                        "held source repeat identity differs from its timer context",
                    ));
                }
            }
        }

        let snapshot = self.snapshot_payload();
        snapshot.validate()
    }
}

fn input_snapshot_invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn validate_scheduler_repeat_ownership(
    snapshot: &InputRouterSnapshotV2,
    scheduler: &KernelScheduler,
    map: &InputMap,
) -> Result<(), SnapshotError> {
    for repeat in &snapshot.repeats {
        let Some(scheduled) = scheduler.timer(repeat.timer_id) else {
            return Err(input_snapshot_invalid(
                "input_router.repeats",
                format!(
                    "repeat timer {} is absent from KernelScheduler",
                    repeat.timer_id
                ),
            ));
        };
        if scheduled.endpoint != repeat.seat
            || scheduled.owner != TimerOwner::input_repeat(repeat.button)
            || scheduled.delay_ms != map.repeat_interval_ms
            || scheduled.time_class != TimeClass::HumanInput
        {
            return Err(input_snapshot_invalid(
                "input_router.repeats",
                format!(
                    "repeat timer {} does not exactly match its KernelScheduler owner",
                    repeat.timer_id
                ),
            ));
        }
    }

    for scheduled in scheduler.live_timers() {
        if scheduled.owner.owner_id == "input-router" && scheduled.owner.reason == "input-repeat" {
            let Some(repeat) = snapshot
                .repeats
                .iter()
                .find(|repeat| repeat.timer_id == scheduled.timer_id)
            else {
                return Err(input_snapshot_invalid(
                    "scheduler.timers",
                    format!(
                        "input-router repeat timer {} has no router repeat context",
                        scheduled.timer_id
                    ),
                ));
            };
            if scheduled.owner != TimerOwner::input_repeat(repeat.button)
                || scheduled.endpoint != repeat.seat
                || scheduled.delay_ms != map.repeat_interval_ms
                || scheduled.time_class != TimeClass::HumanInput
            {
                return Err(input_snapshot_invalid(
                    "scheduler.timers",
                    format!(
                        "input-router timer {} has a mismatched repeat owner",
                        scheduled.timer_id
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn validate_snapshot_map_bindings(
    snapshot: &InputRouterSnapshotV2,
    map: &InputMap,
) -> Result<(), SnapshotError> {
    for pressed in &snapshot.pressed {
        if !pressed.accepted {
            continue;
        }
        let Some(button) = pressed.logical_button else {
            return Err(input_snapshot_invalid(
                "input_router.pressed",
                "accepted physical input has no logical button",
            ));
        };
        let mapped = match &pressed.source {
            PhysicalInputSourceV2::Keyboard(code) => map
                .keyboard
                .iter()
                .find(|binding| binding.key == *code)
                .map(|binding| binding.button),
            PhysicalInputSourceV2::Gamepad(button_index) => map
                .gamepad
                .iter()
                .find(|binding| binding.button_index == *button_index)
                .map(|binding| binding.button),
        };
        if mapped != Some(button) {
            return Err(input_snapshot_invalid(
                "input_router.pressed",
                "accepted physical input does not match the fixed production map",
            ));
        }
    }
    Ok(())
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
