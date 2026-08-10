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

    pub(crate) fn handle_raw_input(
        &mut self,
        seat: SeatId,
        event: RawInputEvent,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleUiOutput, BattleUiAdapterError> {
        self.ensure_live()?;
        if seat != self.local_seat {
            return Ok(BattleUiOutput {
                rejection: Some(BattleUiReject::WrongSeat),
                ..BattleUiOutput::default()
            });
        }

        let is_press = matches!(
            &event,
            RawInputEvent::KeyDown { .. } | RawInputEvent::GamepadDown { .. }
        );
        let menu_instance_id = self.reducer.current_menu_instance_id();
        if is_press {
            if self.reducer.owner_seat() != Some(seat) {
                return Ok(BattleUiOutput {
                    rejection: Some(BattleUiReject::NonActionable),
                    ..BattleUiOutput::default()
                });
            }
            if !self.reducer.is_actionable() {
                return Ok(BattleUiOutput {
                    rejection: Some(BattleUiReject::NonActionable),
                    ..BattleUiOutput::default()
                });
            }
        }
        let menu_instance_id = menu_instance_id.unwrap_or(MenuInstanceId::ZERO);
        let routed = self
            .input
            .handle(seat, menu_instance_id, event, scheduler)?;
        Ok(self.consume_routed(routed, scheduler))
    }

    pub(crate) fn timer_fired(
        &mut self,
        endpoint: SeatId,
        timer_id: TimerId,
        scheduler: &mut KernelScheduler,
    ) -> Result<BattleUiOutput, BattleUiAdapterError> {
        self.ensure_live()?;
        if endpoint != self.local_seat {
            return Ok(BattleUiOutput {
                rejection: Some(BattleUiReject::WrongSeat),
                ..BattleUiOutput::default()
            });
        }
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
        Ok(self.consume_routed(routed, scheduler))
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
            let BattleButtonEvent::Pressed {
                seat,
                button,
                menu_instance_id,
            } = event
            else {
                continue;
            };
            let reduction = self
                .reducer
                .reduce_at(seat, menu_instance_id, ButtonEvent::Pressed(button));
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
