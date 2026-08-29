//! Battle-only raw-input and exact-menu-graph adapter.

use er_protocol::KernelScheduler;
use er_types::battle_ids::MenuInstanceId;
use er_types::battle_ui::BattleUiProjection;
use er_types::{ButtonEvent, InputMap, InputTimerCommand, RawInputEvent, SeatId, TimerId};
use thiserror::Error;

use crate::input_router::{
    BattleButtonEvent, BattleInputError, BattleInputOutput, BattleInputRouter, InputRouteError,
};
use crate::snapshot::{InputRouterSnapshotV2, SnapshotError};
use crate::ui_reducer::{BattleUiIntent, BattleUiReducer, BattleUiReduction, BattleUiReject};

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

/// The exact owner boundary used by the kernel snapshot bridge.  The public
/// endpoint DTO stores these fields in separate locations, but restoration
/// must pass them through one fail-atomic UI-owner constructor.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BattleUiAdapterSnapshot {
    pub(crate) local_seat: SeatId,
    pub(crate) projection: BattleUiProjection,
    pub(crate) input_router: InputRouterSnapshotV2,
    pub(crate) disposed: bool,
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
    // Retained staged constructor for custom-map adapter callers; production
    // kernel construction currently enters through `with_default_map`.
    #[allow(dead_code)]
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

    // Retained staged menu-instance inspection seam; internal routing reads
    // the reducer directly while the adapter API remains available to callers.
    #[allow(dead_code)]
    pub(crate) fn current_menu_instance_id(&self) -> Option<MenuInstanceId> {
        self.reducer.current_menu_instance_id()
    }

    pub(crate) fn input(&self) -> &BattleInputRouter {
        &self.input
    }

    pub(crate) fn snapshot_v2(
        &self,
        scheduler: &KernelScheduler,
    ) -> Result<BattleUiAdapterSnapshot, SnapshotError> {
        if self.projection().seat_control.seat != self.local_seat {
            return Err(ui_snapshot_invalid(
                "ui.local_seat",
                "projection seat differs from the adapter local seat",
            ));
        }
        self.projection()
            .validate()
            .map_err(|error| ui_snapshot_invalid("ui.projection", error.to_string()))?;
        let input_router = self.input.snapshot_v2(scheduler)?;
        if input_router.disposed != self.disposed {
            return Err(ui_snapshot_invalid(
                "ui.disposed",
                "adapter and input-router disposal flags differ",
            ));
        }
        Ok(BattleUiAdapterSnapshot {
            local_seat: self.local_seat,
            projection: self.projection().clone(),
            input_router,
            disposed: self.disposed,
        })
    }

    /// Build every UI owner from validated snapshot parts before returning a
    /// value.  No existing adapter is mutated if projection, router, seat, or
    /// disposal validation fails.
    pub(crate) fn from_snapshot_v2(
        snapshot: BattleUiAdapterSnapshot,
        scheduler: &KernelScheduler,
    ) -> Result<Self, SnapshotError> {
        if snapshot.projection.seat_control.seat != snapshot.local_seat {
            return Err(ui_snapshot_invalid(
                "ui.local_seat",
                "projection seat differs from the snapshot local seat",
            ));
        }
        snapshot
            .projection
            .validate()
            .map_err(|error| ui_snapshot_invalid("ui.projection", error.to_string()))?;
        if snapshot.input_router.disposed != snapshot.disposed {
            return Err(ui_snapshot_invalid(
                "ui.disposed",
                "adapter and input-router disposal flags differ",
            ));
        }

        let reducer = BattleUiReducer::new(snapshot.projection.clone())
            .map_err(|error| ui_snapshot_invalid("ui.projection", error.to_string()))?;
        let input = BattleInputRouter::from_snapshot_v2(snapshot.input_router, scheduler)?;
        Ok(Self {
            local_seat: snapshot.local_seat,
            input,
            reducer,
            disposed: snapshot.disposed,
        })
    }

    pub(crate) fn from_snapshot_parts_v2(
        local_seat: SeatId,
        projection: BattleUiProjection,
        input_router: InputRouterSnapshotV2,
        disposed: bool,
        scheduler: &KernelScheduler,
    ) -> Result<Self, SnapshotError> {
        Self::from_snapshot_v2(
            BattleUiAdapterSnapshot {
                local_seat,
                projection,
                input_router,
                disposed,
            },
            scheduler,
        )
    }

    // Retained staged in-place snapshot restore seam; the kernel bridge
    // currently rebuilds the adapter through `from_snapshot_parts_v2`.
    #[allow(dead_code)]
    pub(crate) fn restore_snapshot_v2(
        &mut self,
        snapshot: BattleUiAdapterSnapshot,
        scheduler: &KernelScheduler,
    ) -> Result<(), SnapshotError> {
        let candidate = Self::from_snapshot_v2(snapshot, scheduler)?;
        *self = candidate;
        Ok(())
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

    // Retained staged one-call input wrapper; the production kernel uses
    // split routing followed by queued UI reduction.
    #[allow(dead_code)]
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

    // Retained staged one-call timer wrapper; the production kernel uses
    // split routing followed by queued UI reduction.
    #[allow(dead_code)]
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
        if is_press && (self.reducer.owner_seat() != Some(seat) || !self.reducer.is_actionable()) {
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
        let fired = scheduler.fired(timer_id).map_err(InputRouteError::from)?;
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
        let routed = self.input.dispose(scheduler);
        BattleUiOutput {
            timers: routed.timers,
            ..BattleUiOutput::default()
        }
    }

    // Retained staged lifecycle inspection seam; kernel teardown calls
    // `dispose` directly without querying this flag.
    #[allow(dead_code)]
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

    // Supports the retained one-call wrappers above; production input follows
    // the kernel's split routing and queued reduction path.
    #[allow(dead_code)]
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

fn ui_snapshot_invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}
