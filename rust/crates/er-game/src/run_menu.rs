//! Physical-button reducer for retained M4 run-surface controls.
//!
//! Raw keyboard/gamepad events are translated by the kernel input router into
//! [`ButtonEvent`] values. This reducer owns the canonical logical-menu graph:
//! directional edges update stable option identity, submit/action emits one
//! internal intent, and cancel follows the frozen [`CancelPolicy`]. No UI or
//! semantic action enters through an external boundary.

use er_types::SeatId;
use er_types::input::{ButtonEvent, GameButton};
use er_types::run_control::{GameControl, GameControlPlan, PresentationBarrier, SurfaceControl};
use er_types::run_ids::{RunInteractionSequence, RunSurfaceId};
use er_types::ui::CancelPolicy;
use er_types::ui_menu::{LogicalMenu, NavigationDirection};
use er_types::{MenuOptionId, StringIdError};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RunMenuIntentKind {
    Submit(MenuOptionId),
    Cancel(Option<MenuOptionId>),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunMenuIntent {
    pub seat: SeatId,
    pub surface_id: RunSurfaceId,
    pub interaction_sequence: RunInteractionSequence,
    pub kind: RunMenuIntentKind,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RunMenuError {
    #[error("run control plan is invalid: {0}")]
    InvalidPlan(#[from] er_types::run_control::GameControlPlanError),
    #[error("surface menu is invalid: {0}")]
    InvalidMenu(#[from] er_types::ui_menu::LogicalMenuError),
    #[error("input seat is not present in the control plan")]
    UnknownSeat,
    #[error("watcher seat cannot act")]
    WatcherInput,
    #[error("control is not a run surface")]
    NotSurface,
    #[error("surface is blocked by presentation")]
    PresentationBlocked,
    #[error("selected option is disabled")]
    DisabledOption,
    #[error("cancel target is invalid: {0}")]
    InvalidCancelOption(#[from] StringIdError),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunMenuReducer {
    plan: GameControlPlan,
}

impl RunMenuReducer {
    pub fn new(plan: GameControlPlan) -> Result<Self, RunMenuError> {
        plan.validate()?;
        for seat in &plan.seats {
            if let GameControl::Surface(surface) = &seat.control {
                surface.menu().validate()?;
            }
        }
        Ok(Self { plan })
    }

    pub fn plan(&self) -> &GameControlPlan {
        &self.plan
    }

    pub fn replace_plan(&mut self, plan: GameControlPlan) -> Result<(), RunMenuError> {
        let staged = Self::new(plan)?;
        *self = staged;
        Ok(())
    }

    pub fn apply_button(
        &mut self,
        seat: SeatId,
        event: ButtonEvent,
    ) -> Result<Option<RunMenuIntent>, RunMenuError> {
        let ButtonEvent::Pressed(button) = event else {
            return Ok(None);
        };
        let seat_plan = self
            .plan
            .seats
            .iter_mut()
            .find(|entry| entry.seat == seat)
            .ok_or(RunMenuError::UnknownSeat)?;
        if !seat_plan.owner {
            return Err(RunMenuError::WatcherInput);
        }
        if seat_plan.actionable_after == PresentationBarrier::BlocksHumanInput {
            return Err(RunMenuError::PresentationBlocked);
        }
        let GameControl::Surface(surface) = &mut seat_plan.control else {
            return Err(RunMenuError::NotSurface);
        };
        if let Some(direction) = direction(button) {
            let menu = menu_mut(surface);
            if let Some(edge) = menu
                .navigation
                .iter()
                .find(|edge| edge.from == menu.selected_option_id && edge.direction == direction)
            {
                menu.selected_option_id = edge.to.clone();
            }
            return Ok(None);
        }
        match button {
            GameButton::Submit | GameButton::Action => {
                let selected = surface.menu().selected_option_id.clone();
                let enabled = surface
                    .menu()
                    .options
                    .iter()
                    .find(|option| option.option_id == selected)
                    .is_some_and(|option| option.enabled);
                if !enabled {
                    return Err(RunMenuError::DisabledOption);
                }
                Ok(Some(intent(
                    seat,
                    surface,
                    RunMenuIntentKind::Submit(selected),
                )))
            }
            GameButton::Cancel => {
                let target = match &surface.menu().cancel {
                    CancelPolicy::Disabled => return Ok(None),
                    CancelPolicy::Close | CancelPolicy::Back => None,
                    CancelPolicy::Select(option) => Some(option.clone()),
                };
                Ok(Some(intent(
                    seat,
                    surface,
                    RunMenuIntentKind::Cancel(target),
                )))
            }
            _ => Ok(None),
        }
    }
}

fn direction(button: GameButton) -> Option<NavigationDirection> {
    match button {
        GameButton::Up => Some(NavigationDirection::Up),
        GameButton::Down => Some(NavigationDirection::Down),
        GameButton::Left => Some(NavigationDirection::Left),
        GameButton::Right => Some(NavigationDirection::Right),
        _ => None,
    }
}

fn menu_mut(surface: &mut SurfaceControl) -> &mut LogicalMenu {
    match surface {
        SurfaceControl::MoveLearn(control) => &mut control.menu,
        SurfaceControl::RewardShop(control) => &mut control.menu,
        SurfaceControl::BiomeMarket(control) => &mut control.menu,
        SurfaceControl::Crossroads(control) => &mut control.menu,
        SurfaceControl::BiomeSelect(control) => &mut control.menu,
    }
}

fn intent(seat: SeatId, surface: &SurfaceControl, kind: RunMenuIntentKind) -> RunMenuIntent {
    RunMenuIntent {
        seat,
        surface_id: surface.surface_id(),
        interaction_sequence: surface.interaction_sequence(),
        kind,
    }
}

#[cfg(test)]
mod tests {
    use er_types::SafeU53;
    use er_types::battle_ids::MenuInstanceId;
    use er_types::run_control::{CrossroadsControl, GameControl, SeatControlPlan};
    use er_types::ui_menu::{LogicalMenuOption, MenuNavigationEdge};

    use super::*;

    fn seat(value: u64) -> SeatId {
        SeatId::new(SafeU53::new(value).expect("seat"))
    }

    fn option(value: &str) -> MenuOptionId {
        MenuOptionId::new(value).expect("option")
    }

    fn reducer(blocked: bool) -> RunMenuReducer {
        let stay = option("crossroads/stay");
        let leave = option("crossroads/leave");
        let menu = LogicalMenu::new(
            MenuInstanceId::new(SafeU53::new(1).expect("menu")),
            seat(1),
            "control-1",
            stay.clone(),
            vec![
                LogicalMenuOption::new(stay.clone(), true, None).expect("stay"),
                LogicalMenuOption::new(leave.clone(), true, None).expect("leave"),
            ],
            vec![MenuNavigationEdge::new(
                stay,
                NavigationDirection::Down,
                leave,
            )],
            CancelPolicy::Disabled,
        )
        .expect("menu");
        let surface = SurfaceControl::Crossroads(CrossroadsControl::new(
            RunSurfaceId::new(SafeU53::new(1).expect("surface")),
            RunInteractionSequence::new(SafeU53::ZERO),
            menu,
        ));
        RunMenuReducer::new(
            GameControlPlan::new(
                vec![SeatControlPlan {
                    seat: seat(1),
                    owner: true,
                    control_id: "control-1".to_owned(),
                    menu_instance_id: MenuInstanceId::new(SafeU53::new(1).expect("menu")),
                    actionable_after: if blocked {
                        PresentationBarrier::BlocksHumanInput
                    } else {
                        PresentationBarrier::NonBlocking
                    },
                    control: GameControl::Surface(surface),
                }],
                "control-2".to_owned(),
                MenuInstanceId::new(SafeU53::new(2).expect("next-menu")),
            )
            .expect("plan"),
        )
        .expect("reducer")
    }

    #[test]
    fn direction_then_submit_uses_stable_option_identity() {
        let mut reducer = reducer(false);
        assert_eq!(
            reducer
                .apply_button(seat(1), ButtonEvent::Pressed(GameButton::Down))
                .expect("down"),
            None
        );
        let intent = reducer
            .apply_button(seat(1), ButtonEvent::Pressed(GameButton::Submit))
            .expect("submit")
            .expect("intent");
        assert_eq!(
            intent.kind,
            RunMenuIntentKind::Submit(option("crossroads/leave"))
        );
    }

    #[test]
    fn key_release_never_submits() {
        let mut reducer = reducer(false);
        assert_eq!(
            reducer
                .apply_button(seat(1), ButtonEvent::Released(GameButton::Submit))
                .expect("release"),
            None
        );
    }

    #[test]
    fn presentation_barrier_rejects_human_input() {
        let mut reducer = reducer(true);
        assert_eq!(
            reducer.apply_button(seat(1), ButtonEvent::Pressed(GameButton::Submit)),
            Err(RunMenuError::PresentationBlocked)
        );
    }
}
