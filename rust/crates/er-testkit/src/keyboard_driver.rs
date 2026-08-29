//! Representative raw-keystroke driver with no semantic-choice bypass API.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

use er_kernel::{GameKernel, KernelError, LiveResourceSnapshot};
use er_types::{
    InputFocus, KernelEffect, KernelInput, PhysicalKey, RawInputEvent, SafeU53, SeatId, TimeClass,
    TimerId, UiViewModel,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DriverHoldState {
    pub key: PhysicalKey,
    pub remaining_ms: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DetachedKeyboardDriverState {
    pub seat: SeatId,
    pub focus: InputFocus,
    pub pressed_keys: Vec<PhysicalKey>,
    pub active_holds: Vec<DriverHoldState>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct DetachedKeyboardStateData {
    focus: InputFocus,
    pressed_keys: BTreeSet<PhysicalKey>,
    active_holds: BTreeMap<PhysicalKey, SafeU53>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DetachedKeyboardDriver {
    seat: SeatId,
    state: RefCell<DetachedKeyboardStateData>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KeyHoldPlan {
    pub key_down: RawInputEvent,
    pub duration_ms: SafeU53,
    pub key_up: RawInputEvent,
}

impl DetachedKeyboardDriver {
    pub fn new(seat: SeatId) -> Self {
        Self {
            seat,
            state: RefCell::new(DetachedKeyboardStateData {
                focus: InputFocus::Game,
                pressed_keys: BTreeSet::new(),
                active_holds: BTreeMap::new(),
            }),
        }
    }

    pub fn seat(&self) -> SeatId {
        self.seat
    }

    pub fn input_focus(&self) -> InputFocus {
        self.state.borrow().focus
    }

    pub fn key_down(&self, code: PhysicalKey, printable: bool) -> RawInputEvent {
        self.state.borrow_mut().pressed_keys.insert(code.clone());
        RawInputEvent::KeyDown {
            code,
            printable,
            browser_repeat: false,
            focus: self.input_focus(),
        }
    }

    pub fn key_up(&self, code: PhysicalKey) -> RawInputEvent {
        let mut state = self.state.borrow_mut();
        state.pressed_keys.remove(&code);
        state.active_holds.remove(&code);
        RawInputEvent::KeyUp { code }
    }

    pub fn press(&self, code: PhysicalKey) -> [RawInputEvent; 2] {
        [
            self.key_down(code.clone(), is_printable(&code)),
            self.key_up(code),
        ]
    }

    pub fn hold_for(&self, code: PhysicalKey, duration_ms: SafeU53) -> KeyHoldPlan {
        KeyHoldPlan {
            key_down: RawInputEvent::KeyDown {
                code: code.clone(),
                printable: is_printable(&code),
                browser_repeat: false,
                focus: self.input_focus(),
            },
            duration_ms,
            key_up: RawInputEvent::KeyUp { code },
        }
    }

    pub fn blur(&self) -> RawInputEvent {
        let mut state = self.state.borrow_mut();
        state.pressed_keys.clear();
        state.active_holds.clear();
        RawInputEvent::WindowBlurred
    }

    pub fn focus(&mut self, focus: InputFocus) -> RawInputEvent {
        self.state.get_mut().focus = focus;
        RawInputEvent::FocusChanged(focus)
    }

    pub fn export_state(&self) -> DetachedKeyboardDriverState {
        let state = self.state.borrow();
        DetachedKeyboardDriverState {
            seat: self.seat,
            focus: state.focus,
            pressed_keys: state.pressed_keys.iter().cloned().collect(),
            active_holds: state
                .active_holds
                .iter()
                .map(|(key, remaining_ms)| DriverHoldState {
                    key: key.clone(),
                    remaining_ms: *remaining_ms,
                })
                .collect(),
        }
    }

    pub fn restorable_state(&self) -> DetachedKeyboardDriverState {
        self.export_state()
    }

    pub fn from_state(
        state: DetachedKeyboardDriverState,
    ) -> Result<Self, DetachedKeyboardDriverError> {
        state.validate()?;
        let pressed_keys = state.pressed_keys.into_iter().collect();
        let active_holds = state
            .active_holds
            .into_iter()
            .map(|hold| (hold.key, hold.remaining_ms))
            .collect();
        Ok(Self {
            seat: state.seat,
            state: RefCell::new(DetachedKeyboardStateData {
                focus: state.focus,
                pressed_keys,
                active_holds,
            }),
        })
    }

    pub fn from_restorable_state(
        state: DetachedKeyboardDriverState,
    ) -> Result<Self, DetachedKeyboardDriverError> {
        Self::from_state(state)
    }

    pub fn restore_state(
        &mut self,
        state: DetachedKeyboardDriverState,
    ) -> Result<(), DetachedKeyboardDriverError> {
        let restored = Self::from_state(state)?;
        *self = restored;
        Ok(())
    }

    pub fn pressed_keys(&self) -> BTreeSet<PhysicalKey> {
        self.state.borrow().pressed_keys.clone()
    }

    pub fn active_holds(&self) -> Vec<DriverHoldState> {
        self.export_state().active_holds
    }

    /// Record a hold after the key-down boundary has been applied. This is a
    /// neutral owner operation; it emits no synthetic input event.
    pub fn set_active_hold(
        &self,
        key: PhysicalKey,
        remaining_ms: SafeU53,
    ) -> Result<(), DetachedKeyboardDriverError> {
        if remaining_ms == SafeU53::ZERO {
            return Err(DetachedKeyboardDriverError::InvalidState {
                reason: "active hold duration must be positive".to_owned(),
            });
        }
        let mut state = self.state.borrow_mut();
        if !state.pressed_keys.contains(&key) {
            return Err(DetachedKeyboardDriverError::InvalidState {
                reason: "an active hold must reference a pressed key".to_owned(),
            });
        }
        state.active_holds.insert(key, remaining_ms);
        Ok(())
    }

    /// Clear a neutral hold record at the key-up boundary.
    pub fn clear_active_hold(&self, key: &PhysicalKey) {
        self.state.borrow_mut().active_holds.remove(key);
    }

    /// Decrement neutral holds as pair time advances, dropping exactly the
    /// holds that reach zero.
    pub fn advance_active_holds(&self, delta_ms: SafeU53) {
        let mut state = self.state.borrow_mut();
        let mut expired = Vec::new();
        for (key, remaining_ms) in &mut state.active_holds {
            let next = remaining_ms.get().saturating_sub(delta_ms.get());
            *remaining_ms = SafeU53::new(next).expect("saturated active hold remains SafeU53");
            if *remaining_ms == SafeU53::ZERO {
                expired.push(key.clone());
            }
        }
        for key in expired {
            state.active_holds.remove(&key);
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DetachedKeyboardDriverError {
    InvalidState { reason: String },
}

impl std::fmt::Display for DetachedKeyboardDriverError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidState { reason } => {
                write!(formatter, "keyboard driver state is invalid: {reason}")
            }
        }
    }
}

impl std::error::Error for DetachedKeyboardDriverError {}

pub trait DetachedKeyboardDriverRestorable {
    fn export_state(&self) -> DetachedKeyboardDriverState;

    fn restorable_state(&self) -> DetachedKeyboardDriverState {
        self.export_state()
    }

    fn from_state(
        state: DetachedKeyboardDriverState,
    ) -> Result<DetachedKeyboardDriver, DetachedKeyboardDriverError>
    where
        Self: Sized;

    fn from_restorable_state(
        state: DetachedKeyboardDriverState,
    ) -> Result<DetachedKeyboardDriver, DetachedKeyboardDriverError>
    where
        Self: Sized,
    {
        Self::from_state(state)
    }

    fn restore_state(
        &mut self,
        state: DetachedKeyboardDriverState,
    ) -> Result<(), DetachedKeyboardDriverError>;

    fn pressed_keys(&self) -> BTreeSet<PhysicalKey>;

    fn active_holds(&self) -> Vec<DriverHoldState>;

    fn set_active_hold(
        &self,
        key: PhysicalKey,
        remaining_ms: SafeU53,
    ) -> Result<(), DetachedKeyboardDriverError>;

    fn clear_active_hold(&self, key: &PhysicalKey);

    fn advance_active_holds(&self, delta_ms: SafeU53);
}

impl DetachedKeyboardDriverRestorable for DetachedKeyboardDriver {
    fn export_state(&self) -> DetachedKeyboardDriverState {
        let state = self.state.borrow();
        DetachedKeyboardDriverState {
            seat: self.seat,
            focus: state.focus,
            pressed_keys: state.pressed_keys.iter().cloned().collect(),
            active_holds: state
                .active_holds
                .iter()
                .map(|(key, remaining_ms)| DriverHoldState {
                    key: key.clone(),
                    remaining_ms: *remaining_ms,
                })
                .collect(),
        }
    }

    fn from_state(
        state: DetachedKeyboardDriverState,
    ) -> Result<DetachedKeyboardDriver, DetachedKeyboardDriverError> {
        state.validate()?;
        let pressed_keys = state.pressed_keys.into_iter().collect();
        let active_holds = state
            .active_holds
            .into_iter()
            .map(|hold| (hold.key, hold.remaining_ms))
            .collect();
        Ok(DetachedKeyboardDriver {
            seat: state.seat,
            state: RefCell::new(DetachedKeyboardStateData {
                focus: state.focus,
                pressed_keys,
                active_holds,
            }),
        })
    }

    fn restore_state(
        &mut self,
        state: DetachedKeyboardDriverState,
    ) -> Result<(), DetachedKeyboardDriverError> {
        let restored = DetachedKeyboardDriver::from_state(state)?;
        *self = restored;
        Ok(())
    }

    fn pressed_keys(&self) -> BTreeSet<PhysicalKey> {
        self.state.borrow().pressed_keys.clone()
    }

    fn active_holds(&self) -> Vec<DriverHoldState> {
        self.export_state().active_holds
    }

    fn set_active_hold(
        &self,
        key: PhysicalKey,
        remaining_ms: SafeU53,
    ) -> Result<(), DetachedKeyboardDriverError> {
        if remaining_ms == SafeU53::ZERO {
            return Err(DetachedKeyboardDriverError::InvalidState {
                reason: "active hold duration must be positive".to_owned(),
            });
        }
        let mut state = self.state.borrow_mut();
        if !state.pressed_keys.contains(&key) {
            return Err(DetachedKeyboardDriverError::InvalidState {
                reason: "an active hold must reference a pressed key".to_owned(),
            });
        }
        state.active_holds.insert(key, remaining_ms);
        Ok(())
    }

    fn clear_active_hold(&self, key: &PhysicalKey) {
        self.state.borrow_mut().active_holds.remove(key);
    }

    fn advance_active_holds(&self, delta_ms: SafeU53) {
        let mut state = self.state.borrow_mut();
        let mut expired = Vec::new();
        for (key, remaining_ms) in &mut state.active_holds {
            let next = remaining_ms.get().saturating_sub(delta_ms.get());
            *remaining_ms = SafeU53::new(next).expect("saturated active hold remains SafeU53");
            if *remaining_ms == SafeU53::ZERO {
                expired.push(key.clone());
            }
        }
        for key in expired {
            state.active_holds.remove(&key);
        }
    }
}

impl DetachedKeyboardDriverState {
    pub fn validate(&self) -> Result<(), DetachedKeyboardDriverError> {
        if self.pressed_keys.windows(2).any(|pair| pair[0] >= pair[1]) {
            return Err(DetachedKeyboardDriverError::InvalidState {
                reason: "pressed keys must be strictly sorted and unique".to_owned(),
            });
        }
        if self
            .active_holds
            .windows(2)
            .any(|pair| pair[0].key >= pair[1].key)
        {
            return Err(DetachedKeyboardDriverError::InvalidState {
                reason: "active holds must be strictly sorted and unique by key".to_owned(),
            });
        }
        if self.active_holds.iter().any(|hold| {
            hold.remaining_ms == SafeU53::ZERO || !self.pressed_keys.contains(&hold.key)
        }) {
            return Err(DetachedKeyboardDriverError::InvalidState {
                reason: "active holds must have positive duration and a pressed key".to_owned(),
            });
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PendingTimer {
    endpoint: SeatId,
    remaining_ms: SafeU53,
}

#[derive(Debug)]
pub struct KeyboardDriver<'kernel> {
    kernel: &'kernel mut GameKernel,
    seat: SeatId,
    focus: InputFocus,
    pending_timers: BTreeMap<TimerId, PendingTimer>,
    held_keys: BTreeSet<PhysicalKey>,
}

impl<'kernel> KeyboardDriver<'kernel> {
    pub fn new(kernel: &'kernel mut GameKernel, seat: SeatId) -> Self {
        Self {
            kernel,
            seat,
            focus: InputFocus::Game,
            pending_timers: BTreeMap::new(),
            held_keys: BTreeSet::new(),
        }
    }

    pub fn key_down(
        &mut self,
        code: PhysicalKey,
        printable: bool,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let effects = self.step_kernel(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::KeyDown {
                code: code.clone(),
                printable,
                browser_repeat: false,
                focus: self.focus,
            },
        })?;
        self.held_keys.insert(code);
        Ok(effects)
    }

    pub fn key_up(&mut self, code: PhysicalKey) -> Result<Vec<KernelEffect>, KernelError> {
        let effects = self.step_kernel(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::KeyUp { code: code.clone() },
        })?;
        self.held_keys.remove(&code);
        Ok(effects)
    }

    pub fn press(&mut self, code: PhysicalKey) -> Result<Vec<KernelEffect>, KernelError> {
        let printable = is_printable(&code);
        let mut effects = self.key_down(code.clone(), printable)?;
        effects.extend(self.key_up(code)?);
        Ok(effects)
    }

    pub fn hold_for(
        &mut self,
        code: PhysicalKey,
        duration_ms: SafeU53,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        let mut effects = self.key_down(code.clone(), is_printable(&code))?;
        effects.extend(self.drive_timers(duration_ms)?);
        effects.extend(self.key_up(code)?);
        Ok(effects)
    }

    pub fn blur(&mut self) -> Result<Vec<KernelEffect>, KernelError> {
        let effects = self.step_kernel(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::WindowBlurred,
        })?;
        self.held_keys.clear();
        Ok(effects)
    }

    pub fn focus(&mut self, focus: InputFocus) -> Result<Vec<KernelEffect>, KernelError> {
        let effects = self.step_kernel(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::FocusChanged(focus),
        })?;
        self.focus = focus;
        Ok(effects)
    }

    pub fn ui_view(&self) -> UiViewModel {
        self.kernel.ui_view()
    }

    pub fn live_resources(&self) -> LiveResourceSnapshot {
        self.kernel.live_resources()
    }

    fn step_kernel(&mut self, input: KernelInput) -> Result<Vec<KernelEffect>, KernelError> {
        let effects = self.kernel.step(input)?;
        self.remember_timer_effects(&effects);
        Ok(effects)
    }

    fn drive_timers(&mut self, duration_ms: SafeU53) -> Result<Vec<KernelEffect>, KernelError> {
        let mut remaining_ms = duration_ms.get();
        let mut effects = Vec::new();

        while let Some((timer_id, timer)) = self.next_pending_timer() {
            let delay_ms = timer.remaining_ms.get();
            if delay_ms > remaining_ms {
                break;
            }

            self.advance_pending_timers(delay_ms);
            remaining_ms -= delay_ms;
            self.pending_timers.remove(&timer_id);

            effects.extend(self.step_kernel(KernelInput::TimerFired {
                endpoint: timer.endpoint,
                timer_id,
            })?);
        }

        self.advance_pending_timers(remaining_ms);
        Ok(effects)
    }

    fn next_pending_timer(&self) -> Option<(TimerId, PendingTimer)> {
        self.pending_timers
            .iter()
            .min_by(|(left_id, left), (right_id, right)| {
                left.remaining_ms
                    .cmp(&right.remaining_ms)
                    .then_with(|| left_id.cmp(right_id))
            })
            .map(|(timer_id, timer)| (*timer_id, *timer))
    }

    fn advance_pending_timers(&mut self, elapsed_ms: u64) {
        for timer in self.pending_timers.values_mut() {
            let remaining_ms = timer.remaining_ms.get().saturating_sub(elapsed_ms);
            timer.remaining_ms = match SafeU53::new(remaining_ms) {
                Ok(value) => value,
                Err(_) => SafeU53::ZERO,
            };
        }
    }

    fn remember_timer_effects(&mut self, effects: &[KernelEffect]) {
        for effect in effects {
            match effect {
                KernelEffect::ScheduleTimer {
                    endpoint,
                    timer_id,
                    delay_ms,
                    time_class,
                    ..
                } if *time_class == TimeClass::HumanInput && *delay_ms != SafeU53::ZERO => {
                    self.pending_timers.insert(
                        *timer_id,
                        PendingTimer {
                            endpoint: *endpoint,
                            remaining_ms: *delay_ms,
                        },
                    );
                }
                KernelEffect::CancelTimer { timer_id, .. } => {
                    self.pending_timers.remove(timer_id);
                }
                _ => {}
            }
        }
    }
}

fn is_printable(code: &PhysicalKey) -> bool {
    matches!(
        code,
        PhysicalKey::Space
            | PhysicalKey::KeyA
            | PhysicalKey::KeyB
            | PhysicalKey::KeyC
            | PhysicalKey::KeyD
            | PhysicalKey::KeyE
            | PhysicalKey::KeyF
            | PhysicalKey::KeyN
            | PhysicalKey::KeyR
            | PhysicalKey::KeyT
            | PhysicalKey::Unknown(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::TimerOwner;

    fn safe_u53(value: u64) -> SafeU53 {
        match SafeU53::new(value) {
            Ok(value) => value,
            Err(_) => SafeU53::ZERO,
        }
    }

    #[test]
    fn press_classifies_printable_physical_keys() {
        assert!(is_printable(&PhysicalKey::Space));
        assert!(is_printable(&PhysicalKey::KeyA));
        assert!(is_printable(&PhysicalKey::Unknown("?".to_owned())));
        assert!(!is_printable(&PhysicalKey::ArrowUp));
        assert!(!is_printable(&PhysicalKey::Enter));
    }

    #[test]
    fn pending_timers_are_ordered_by_due_time_then_id() {
        let mut kernel = GameKernel::default();
        let mut driver = KeyboardDriver::new(&mut kernel, SeatId::ZERO);
        let first_id = TimerId::new(safe_u53(1));
        let second_id = TimerId::new(safe_u53(2));

        driver.pending_timers.insert(
            second_id,
            PendingTimer {
                endpoint: SeatId::ZERO,
                remaining_ms: safe_u53(50),
            },
        );
        driver.pending_timers.insert(
            first_id,
            PendingTimer {
                endpoint: SeatId::ZERO,
                remaining_ms: safe_u53(50),
            },
        );

        assert_eq!(
            driver.next_pending_timer().map(|(timer_id, _)| timer_id),
            Some(first_id)
        );

        driver.advance_pending_timers(25);
        assert_eq!(
            driver
                .next_pending_timer()
                .map(|(timer_id, timer)| (timer_id, timer.remaining_ms)),
            Some((first_id, safe_u53(25)))
        );
    }

    #[test]
    fn zero_delay_human_input_timers_are_not_pending_but_positive_timers_are() {
        let mut kernel = GameKernel::default();
        let mut driver = KeyboardDriver::new(&mut kernel, SeatId::ZERO);
        let zero_id = TimerId::new(safe_u53(1));
        let positive_id = TimerId::new(safe_u53(2));
        let effects = [
            KernelEffect::ScheduleTimer {
                endpoint: SeatId::ZERO,
                timer_id: zero_id,
                owner: protocol_timer_owner(),
                delay_ms: SafeU53::ZERO,
                time_class: TimeClass::HumanInput,
            },
            KernelEffect::ScheduleTimer {
                endpoint: SeatId::ZERO,
                timer_id: positive_id,
                owner: protocol_timer_owner(),
                delay_ms: safe_u53(25),
                time_class: TimeClass::HumanInput,
            },
        ];

        driver.remember_timer_effects(&effects);

        assert!(!driver.pending_timers.contains_key(&zero_id));
        assert_eq!(
            driver.pending_timers.get(&positive_id),
            Some(&PendingTimer {
                endpoint: SeatId::ZERO,
                remaining_ms: safe_u53(25),
            })
        );
    }

    #[test]
    fn held_keys_are_persistent_per_seat_and_clear_on_symmetric_release_or_blur() {
        let mut host_kernel = GameKernel::default();
        let mut guest_kernel = GameKernel::default();
        let host_seat = SeatId::new(safe_u53(1));
        let guest_seat = SeatId::new(safe_u53(2));
        let mut host = KeyboardDriver::new(&mut host_kernel, host_seat);
        let mut guest = KeyboardDriver::new(&mut guest_kernel, guest_seat);

        host.key_down(PhysicalKey::ArrowDown, false)
            .expect("host keydown should reach the raw kernel boundary");
        guest
            .key_down(PhysicalKey::ArrowDown, false)
            .expect("guest keydown should reach the raw kernel boundary");
        assert!(host.held_keys.contains(&PhysicalKey::ArrowDown));
        assert!(guest.held_keys.contains(&PhysicalKey::ArrowDown));

        host.key_up(PhysicalKey::ArrowDown)
            .expect("host keyup should reach the raw kernel boundary");
        assert!(host.held_keys.is_empty());
        assert!(guest.held_keys.contains(&PhysicalKey::ArrowDown));

        host.key_down(PhysicalKey::ArrowUp, false)
            .expect("host second keydown should reach the raw kernel boundary");
        host.blur()
            .expect("host blur should reach the raw environment boundary");
        assert!(host.held_keys.is_empty());
        assert!(guest.held_keys.contains(&PhysicalKey::ArrowDown));

        guest
            .key_up(PhysicalKey::ArrowDown)
            .expect("guest keyup should reach the raw kernel boundary");
        assert!(guest.held_keys.is_empty());
    }

    fn protocol_timer_owner() -> TimerOwner {
        match TimerOwner::new("protocol-test", "protocol/test", "test") {
            Ok(owner) => owner,
            Err(error) => TimerOwner {
                owner_id: "invalid-protocol-test-owner".to_owned(),
                address: "invalid-protocol-test-address".to_owned(),
                reason: error.to_string(),
            },
        }
    }
}
