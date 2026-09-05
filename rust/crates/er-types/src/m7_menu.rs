//! Canonical M7 menus whose options own typed game actions.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::battle_ids::MenuInstanceId;
use crate::m7_action::{GameActionError, GameActionV1};
use crate::ui::CancelPolicy;
use crate::ui_menu::{
    LogicalMenu, LogicalMenuError, LogicalMenuOption, MenuNavigationEdge, MenuOptionLayout,
};
use crate::{MenuOptionId, SeatId};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameMenuOptionV2 {
    pub option_id: MenuOptionId,
    pub enabled: bool,
    pub visible: bool,
    pub action: GameActionV1,
    pub layout: Option<MenuOptionLayout>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum GameMenuCancelV2 {
    Disabled,
    Select { option_id: MenuOptionId },
    Back { action: Box<GameActionV1> },
    Close { action: Box<GameActionV1> },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameMenuV2 {
    pub instance_id: MenuInstanceId,
    pub owner_seat: SeatId,
    pub control_id: String,
    pub selected_option_id: MenuOptionId,
    pub options: Vec<GameMenuOptionV2>,
    pub navigation: Vec<MenuNavigationEdge>,
    pub cancel: GameMenuCancelV2,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameMenuError {
    #[error("game menu option action is invalid: {0}")]
    Action(#[from] GameActionError),
    #[error("game menu option layout identity differs from its option identity")]
    LayoutIdentity,
    #[error("game menu contains a hidden selected or navigation option")]
    HiddenNavigation,
    #[error("game menu cancel selection is absent or disabled")]
    InvalidCancelSelection,
    #[error("logical menu projection is invalid: {0}")]
    Logical(#[from] LogicalMenuError),
    #[error("logical menu option projection is invalid: {0}")]
    LogicalOption(String),
}

impl GameMenuOptionV2 {
    pub fn new(
        option_id: MenuOptionId,
        enabled: bool,
        visible: bool,
        action: GameActionV1,
        layout: Option<MenuOptionLayout>,
    ) -> Result<Self, GameMenuError> {
        let value = Self {
            option_id,
            enabled,
            visible,
            action,
            layout,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), GameMenuError> {
        self.action.validate()?;
        if self
            .layout
            .as_ref()
            .is_some_and(|layout| layout.option_id != self.option_id)
        {
            return Err(GameMenuError::LayoutIdentity);
        }
        Ok(())
    }
}

impl GameMenuV2 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        instance_id: MenuInstanceId,
        owner_seat: SeatId,
        control_id: impl Into<String>,
        selected_option_id: MenuOptionId,
        mut options: Vec<GameMenuOptionV2>,
        mut navigation: Vec<MenuNavigationEdge>,
        cancel: GameMenuCancelV2,
    ) -> Result<Self, GameMenuError> {
        options.sort_unstable_by(|left, right| left.option_id.cmp(&right.option_id));
        navigation.sort_unstable_by(|left, right| {
            left.from
                .cmp(&right.from)
                .then_with(|| left.direction.cmp(&right.direction))
                .then_with(|| left.to.cmp(&right.to))
        });
        let value = Self {
            instance_id,
            owner_seat,
            control_id: control_id.into(),
            selected_option_id,
            options,
            navigation,
            cancel,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), GameMenuError> {
        for option in &self.options {
            option.validate()?;
        }
        let visible_ids: BTreeSet<&MenuOptionId> = self
            .options
            .iter()
            .filter(|option| option.visible)
            .map(|option| &option.option_id)
            .collect();
        let visible = |id: &MenuOptionId| visible_ids.contains(id);
        if !visible(&self.selected_option_id)
            || self
                .navigation
                .iter()
                .any(|edge| !visible(&edge.from) || !visible(&edge.to))
        {
            return Err(GameMenuError::HiddenNavigation);
        }
        match &self.cancel {
            GameMenuCancelV2::Select { option_id }
                if !self.options.iter().any(|option| {
                    option.option_id == *option_id && option.visible && option.enabled
                }) =>
            {
                return Err(GameMenuError::InvalidCancelSelection);
            }
            GameMenuCancelV2::Back { action } | GameMenuCancelV2::Close { action } => {
                action.validate()?;
            }
            GameMenuCancelV2::Disabled | GameMenuCancelV2::Select { .. } => {}
        }
        self.logical_menu()?;
        Ok(())
    }

    pub fn selected_action(&self) -> Option<&GameActionV1> {
        self.options
            .iter()
            .find(|option| {
                option.option_id == self.selected_option_id && option.visible && option.enabled
            })
            .map(|option| &option.action)
    }

    pub fn cancel_action(&self) -> Option<&GameActionV1> {
        match &self.cancel {
            GameMenuCancelV2::Select { option_id } => self
                .options
                .iter()
                .find(|option| option.option_id == *option_id && option.visible && option.enabled)
                .map(|option| &option.action),
            GameMenuCancelV2::Back { action } | GameMenuCancelV2::Close { action } => Some(action),
            GameMenuCancelV2::Disabled => None,
        }
    }

    /// Projects renderer-visible identity/navigation without exposing canonical actions.
    pub fn logical_menu(&self) -> Result<LogicalMenu, GameMenuError> {
        let options = self
            .options
            .iter()
            .filter(|option| option.visible)
            .map(|option| {
                LogicalMenuOption::new(
                    option.option_id.clone(),
                    option.enabled,
                    option.layout.clone(),
                )
                .map_err(|error| GameMenuError::LogicalOption(error.to_string()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let cancel = match &self.cancel {
            GameMenuCancelV2::Disabled => CancelPolicy::Disabled,
            GameMenuCancelV2::Select { option_id } => CancelPolicy::Select(option_id.clone()),
            GameMenuCancelV2::Back { .. } => CancelPolicy::Back,
            GameMenuCancelV2::Close { .. } => CancelPolicy::Close,
        };
        LogicalMenu::new(
            self.instance_id,
            self.owner_seat,
            self.control_id.clone(),
            self.selected_option_id.clone(),
            options,
            self.navigation.clone(),
            cancel,
        )
        .map_err(GameMenuError::from)
    }
}
