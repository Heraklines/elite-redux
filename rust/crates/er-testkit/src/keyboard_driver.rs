//! Representative raw-keystroke driver with no semantic-choice bypass API.

use er_kernel::{GameKernel, KernelError};
use er_types::{
    InputFocus, KernelEffect, KernelInput, PhysicalKey, RawInputEvent, SafeU53, SeatId,
};

#[derive(Debug)]
pub struct KeyboardDriver<'kernel> {
    kernel: &'kernel mut GameKernel,
    seat: SeatId,
    focus: InputFocus,
}

impl<'kernel> KeyboardDriver<'kernel> {
    pub fn new(kernel: &'kernel mut GameKernel, seat: SeatId) -> Self {
        Self {
            kernel,
            seat,
            focus: InputFocus::Game,
        }
    }

    pub fn key_down(
        &mut self,
        code: PhysicalKey,
        printable: bool,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        self.kernel.step(KernelInput::RawInput {
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
        self.kernel.step(KernelInput::RawInput {
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
        _duration_ms: SafeU53,
    ) -> Result<Vec<KernelEffect>, KernelError> {
        self.press(code)
    }

    pub fn blur(&mut self) -> Result<Vec<KernelEffect>, KernelError> {
        self.kernel.step(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::WindowBlurred,
        })
    }

    pub fn focus(&mut self, focus: InputFocus) -> Result<Vec<KernelEffect>, KernelError> {
        self.focus = focus;
        self.kernel.step(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::FocusChanged(focus),
        })
    }

    pub fn kernel(&self) -> &GameKernel {
        self.kernel
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
