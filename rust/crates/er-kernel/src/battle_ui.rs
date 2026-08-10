//! Battle-only raw-input and exact-menu-graph adapter.

use er_protocol::KernelScheduler;
use er_types::{ButtonEvent, InputMap, InputTimerCommand, RawInputEvent, SeatId, TimerId};
use er_types::battle_ids::MenuInstanceId;
use er_types::battle_ui::BattleUiProjection;
use thiserror::Error;

use crate::input_router::{
    BattleButtonEvent, BattleInputError, BattleInputOutput, BattleInputRouter, InputRouteError,
};
use crate::ui_reducer::{BattleUiIntent, BattleUiReducer, BattleUiReject, BattleUiReduction};

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct BattleUiOutput {
    pub buttons: Vec<BattleButtonEvent>,
    pub intents: Vec<BattleUiIntent>,
    pub timers: Vec<InputTimerCommand>,
    pub rejection: Option<BattleUiReject>,
    pub projection_changed: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub(crate) enum BattleUiAdapterError {
    #[error("battle input failed: {0}")]
    Input(#[from] BattleInputError),
    #[error("battle UI reduction failed: {0}")]
    Ui(#[from] BattleUiReject),
    #[error("battle UI adapter is disposed")]
    Disposed,
    #[error("battle UI projection belongs to a different local seat")]
    LocalSeatMismatch,
}

/// Composes menu-instance-bound physical input with the exact graph reducer.
///
/// The adapter is kernel-internal. Its output contains no serializable
/// semantic command and no operation-construction helper; the game runtime
/// consumes only the private option-ID intent after validating the captured
/// menu instance again at its own boundary.
#[derive(Clone, Debug)]
pub(crate) struct BattleUiAdapter {
    local_seat: SeatId,
    input: BattleInputRouter,
    reducer: BattleUiReducer,
    disposed: bool,
}

impl BattleUiAdapter {
    pub(crate) fn new(
        local_seat: SeatId,
        projection: BattleUiProjection,
        input_map: InputMap,
    ) -> Result<Self, BattleUiAdapterError> {
        if projection.seat_control.seat != local_seat {
            return Err(BattleUiAdapterError::LocalSeatMismatch);
        }
        Ok(Self {
            local_seat,
            input: BattleInputRouter::new(input_map),
            reducer: BattleUiReducer::new(projection)?,
            disposed: false,
        })
    }

    pub(crate) fn with_default_map(
        local_seat: SeatId,
        projection: BattleUiProjection,
    ) -> Result<Self, BattleUiAdapterError> {
        if projection.seat_control.seat != local_seat {
            return Err(BattleUiAdapterError::LocalSeatMismatch);
        }
        Ok(Self {
            local_seat,
            input: BattleInputRouter::with_default_map(),
            reducer: BattleUiReducer::new(projection)?,
            disposed: false,
        })
    }

    pub(crate) fn projection(&self) -> &BattleUiProjection {
        self.reducer.projection()
    }

    pub(crate) fn current_menu_instance_id(&self) -> Option<MenuInstanceId> {
        self.reducer.current_menu_instance_id()
    }

    pub(crate) fn input(&self) -> &BattleInputRouter {
        &self.input
    }

    pub(crate) fn install_projection(
        &mut self,
        projection: BattleUiProjection,
    ) -> Result<(), BattleUiAdapterError> {
        self.ensure_live()?;
        if projection.seat_control.seat != self.local_seat {
            return Err(BattleUiAdapterError::LocalSeatMismatch);
        }
        self.reducer.install(projection)?;
        Ok(())
    }

    /// Capture one raw input event as menu-instance-bound button work.
    ///
    /// This is the routing half of the battle UI boundary. It deliberately
    /// stops at [`BattleInputOutput`]; the captured button events are consumed
    /// by a later FIFO `Button`/`Ui` step through [`Self::reduce_one_button`].
    /// The ownership and actionability gate stays before physical input state
    /// changes so rejected presses cannot arm a held key or repeat timer.
    pub(crate) fn route_raw_input(
        &mut self,
        seat: SeatId,
        event: RawInputEvent,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleUiAdapterError> {
        self.ensure_live()?;
        self.validate_raw_input(seat, &event)?;
        self.route_raw_input_unchecked(seat, event, scheduler)
    }

    pub(crate) fn handle_raw_input(
        &mut self,
        seat: SeatId,
        event: RawInputEvent,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleUiOutput, BattleUiAdapterError> {
        let routed = match self.route_raw_input(seat, event, scheduler) {
            Ok(routed) => routed,
            Err(BattleUiAdapterError::Ui(rejection)) => {
                return Ok(BattleUiOutput {
                    rejection: Some(rejection),
                    ..BattleUiOutput::default()
                });
            }
            Err(error) => return Err(error),
        };
        Ok(self.consume_routed(routed, scheduler))
    }

    /// Capture one owned repeat timer as menu-instance-bound button work.
    ///
    /// Timer routing intentionally does not reject the current menu before
    /// producing its captured event: the held key belongs to the menu that
    /// armed it, and the later UI reduction must make the exact stale-instance
    /// or actionability decision. Any route failure still discards the old
    /// timer registration and clears its held-key link deterministically.
    pub(crate) fn route_timer_fired(
        &mut self,
        endpoint: SeatId,
        timer_id: TimerId,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleUiAdapterError> {
        self.ensure_live()?;
        if endpoint != self.local_seat {
            return Err(BattleUiAdapterError::Ui(BattleUiReject::WrongSeat));
        }
        self.route_timer_fired_unchecked(endpoint, timer_id, scheduler)
    }

    pub(crate) fn timer_fired(
        &mut self,
        endpoint: SeatId,
        timer_id: TimerId,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleUiOutput, BattleUiAdapterError> {
        let routed = match self.route_timer_fired(endpoint, timer_id, scheduler) {
            Ok(routed) => routed,
            Err(BattleUiAdapterError::Ui(rejection)) => {
                return Ok(BattleUiOutput {
                    rejection: Some(rejection),
                    ..BattleUiOutput::default()
                });
            }
            Err(error) => return Err(error),
        };
        Ok(self.consume_routed(routed, scheduler))
    }

    /// Reduce exactly one button event captured by the input router.
    ///
    /// This method owns only the `Button -> Ui` boundary. It never creates a
    /// game intent, queues protocol work, or invokes a downstream reducer.
    /// Release events are passed through to the UI reducer so they retain its
    /// exact `UnsupportedButton` rejection; compatibility wrappers skip them
    /// because key-up remains input cleanup rather than a UI action.
    pub(crate) fn reduce_one_button(
        &mut self,
        event: BattleButtonEvent,
    ) -> Result<BattleUiReduction, BattleUiReject> {
        match event {
            BattleButtonEvent::Pressed {
                seat,
                button,
                menu_instance_id,
            } => self
                .reducer
                .reduce_at(seat, menu_instance_id, ButtonEvent::Pressed(button)),
            BattleButtonEvent::Released {
                seat,
                button,
                menu_instance_id,
            } => self
                .reducer
                .reduce_at(seat, menu_instance_id, ButtonEvent::Released(button)),
        }
    }

    fn validate_raw_input(
        &self,
        seat: SeatId,
        event: &RawInputEvent,
    ) -> Result<(), BattleUiAdapterError> {
        if seat != self.local_seat {
            return Err(BattleUiAdapterError::Ui(BattleUiReject::WrongSeat));
        }
        let is_press = matches!(
            event,
            RawInputEvent::KeyDown { .. } | RawInputEvent::GamepadDown { .. }
        );
        if is_press
            && (self.reducer.owner_seat() != Some(seat) || !self.reducer.is_actionable())
        {
            return Err(BattleUiAdapterError::Ui(BattleUiReject::NonActionable));
        }
        Ok(())
    }

    fn route_raw_input_unchecked(
        &mut self,
        seat: SeatId,
        event: RawInputEvent,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleUiAdapterError> {
        let menu_instance_id = self
            .reducer
            .current_menu_instance_id()
            .unwrap_or(MenuInstanceId::ZERO);
        Ok(self
            .input
            .handle(seat, menu_instance_id, event, scheduler)?)
    }

    fn route_timer_fired_unchecked(
        &mut self,
        endpoint: SeatId,
        timer_id: TimerId,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleInputOutput, BattleUiAdapterError> {
        let Some(scheduled) = scheduler.timer(timer_id).cloned() else {
            return Err(InputRouteError::UnknownTimer { timer_id }.into());
        };
        if scheduled.endpoint != endpoint || !self.input.owns_scheduled_timer(&scheduled) {
            return Err(InputRouteError::UnknownTimer { timer_id }.into());
        }
        let fired = scheduler
            .fired(timer_id)
            .map_err(InputRouteError::from)?;
        let routed = match self.input.timer_fired(fired, scheduler) {
            Ok(routed) => routed,
            Err(error) => {
                self.input.discard_timer(timer_id, scheduler);
                return Err(error.into());
            }
        };
        Ok(routed)
    }

    pub(crate) fn clear_input(
        &mut self,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleUiOutput, BattleUiAdapterError> {
        self.ensure_live()?;
        let routed = self.input.clear(scheduler);
        Ok(BattleUiOutput {
            timers: routed.timers,
            ..BattleUiOutput::default()
        })
    }

    pub(crate) fn dispose(&mut self, scheduler: &mut KernelScheduler) -> BattleUiOutput {
        if self.disposed {
            return BattleUiOutput::default();
        }
        self.disposed = true;
        let routed = self.input.clear(scheduler);
        BattleUiOutput {
            timers: routed.timers,
            ..BattleUiOutput::default()
        }
    }

    pub(crate) fn is_disposed(&self) -> bool {
        self.disposed
    }

    fn ensure_live(&self) -> Result<(), BattleUiAdapterError> {
        if self.disposed {
            Err(BattleUiAdapterError::Disposed)
        } else {
            Ok(())
        }
    }

    fn consume_routed(
        &mut self,
        routed: BattleInputOutput,
        scheduler: &mut KernelScheduler,
    ) -> BattleUiOutput {
        let mut output = BattleUiOutput {
            buttons: routed.events.clone(),
            timers: routed.timers.clone(),
            ..BattleUiOutput::default()
        };

        for event in routed.events {
            let BattleButtonEvent::Pressed { .. } = event else {
                continue;
            };
            let reduction = self.reduce_one_button(event);
            match reduction {
                Ok(BattleUiReduction { changed, intents }) => {
                    output.projection_changed |= changed;
                    output.intents.extend(intents);
                }
                Err(rejection) => {
                    output.rejection = Some(rejection);
                    for timer in &routed.timers {
                        if let InputTimerCommand::Schedule { timer_id, .. } = timer {
                            self.input.discard_timer(*timer_id, scheduler);
                        }
                    }
                    output.timers.clear();
                    break;
                }
            }
        }

        output
    }
}
