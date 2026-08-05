//! Representative raw-keystroke driver with no semantic-choice bypass API.

use std::collections::BTreeMap;

use er_kernel::{GameKernel, KernelError};
use er_types::{
    InputFocus, KernelEffect, KernelInput, PhysicalKey, RawInputEvent, SafeU53, SeatId, TimeClass,
    TimerId, TimerOwner,
};

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
}

impl<'kernel> KeyboardDriver<'kernel> {
    pub fn new(kernel: &'kernel mut GameKernel, seat: SeatId) -> Self {
        Self {
            kernel,
            seat,
            focus: InputFocus::Game,
            pending_timers: BTreeMap::new(),
        }
    }

    pub fn key_down(
        &mut self,
        code: PhysicalKey,
        printable: bool,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        self.step_kernel(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::KeyDown {
                code,
                printable,
                browser_repeat: false,
                focus: self.focus,
            },
        })
    }

    pub fn key_up(&mut self, code: PhysicalKey) -> Result<Vec<KernelEffect>, KernelError> {
        self.step_kernel(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::KeyUp { code },
        })
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
        self.step_kernel(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::WindowBlurred,
        })
    }

    pub fn focus(&mut self, focus: InputFocus) -> Result<Vec<KernelEffect>, KernelError> {
        let effects = self.step_kernel(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::FocusChanged(focus),
        })?;
        self.focus = focus;
        Ok(effects)
    }

    pub fn kernel(&self) -> &GameKernel {
        self.kernel
    }

    fn step_kernel(&mut self, input: KernelInput) -> Result<Vec<KernelEffect>, KernelError> {
        let effects = self.kernel.step(input)?;
        self.remember_timer_effects(&effects);
        Ok(effects)
    }

    fn drive_timers(
        &mut self,
        duration_ms: SafeU53,
    ) -> Result<Vec<KernelEffect>, KernelError> {
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
                } if *time_class == TimeClass::Virtual && *delay_ms != SafeU53::ZERO => {
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
    fn zero_delay_virtual_timers_are_not_pending_but_positive_timers_are() {
        let mut kernel = GameKernel::default();
        let mut driver = KeyboardDriver::new(&mut kernel, SeatId::ZERO);
        let zero_id = TimerId::new(safe_u53(1));
        let positive_id = TimerId::new(safe_u53(2));
        let effects = [
            KernelEffect::ScheduleTimer {
                endpoint: SeatId::ZERO,
                timer_id: zero_id,
                owner: TimerOwner::Protocol,
                delay_ms: SafeU53::ZERO,
                time_class: TimeClass::Virtual,
            },
            KernelEffect::ScheduleTimer {
                endpoint: SeatId::ZERO,
                timer_id: positive_id,
                owner: TimerOwner::Protocol,
                delay_ms: safe_u53(25),
                time_class: TimeClass::Virtual,
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
}
