//! Shared logical menu graphs for M4 run surfaces.
//!
//! Option identity and explicit directional edges are canonical. Renderer
//! geometry is optional metadata and never participates in graph identity.

use std::cmp::Ordering;

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::battle_ids::MenuInstanceId;
use crate::ids::{MenuOptionId, SafeU53, SeatId};
use crate::ui::CancelPolicy;

/// The four explicit directional edges accepted by the raw-key reducer.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NavigationDirection {
    Up,
    Down,
    Left,
    Right,
}

/// One explicit edge in a stable option graph.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MenuNavigationEdge {
    pub from: MenuOptionId,
    pub direction: NavigationDirection,
    pub to: MenuOptionId,
}

impl MenuNavigationEdge {
    pub const fn new(from: MenuOptionId, direction: NavigationDirection, to: MenuOptionId) -> Self {
        Self {
            from,
            direction,
            to,
        }
    }
}

fn compare_navigation_edges(first: &MenuNavigationEdge, second: &MenuNavigationEdge) -> Ordering {
    first
        .from
        .cmp(&second.from)
        .then(first.direction.cmp(&second.direction))
        .then(first.to.cmp(&second.to))
}

/// Errors from a standalone canonical graph.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum MenuNavigationError {
    #[error("navigation edges contain a duplicate (from, direction) key")]
    DuplicateEdgeKey,
    #[error("navigation edges are not in canonical option/direction order")]
    UnsortedEdges,
}

/// A selected option and its explicit graph edges.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MenuNavigation {
    pub selected_option_id: MenuOptionId,
    pub edges: Vec<MenuNavigationEdge>,
}

impl MenuNavigation {
    pub fn new(
        selected_option_id: MenuOptionId,
        mut edges: Vec<MenuNavigationEdge>,
    ) -> Result<Self, MenuNavigationError> {
        edges.sort_unstable_by(compare_navigation_edges);
        let value = Self {
            selected_option_id,
            edges,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), MenuNavigationError> {
        for pair in self.edges.windows(2) {
            if pair[0].from == pair[1].from && pair[0].direction == pair[1].direction {
                return Err(MenuNavigationError::DuplicateEdgeKey);
            }
            if compare_navigation_edges(&pair[0], &pair[1]) == Ordering::Greater {
                return Err(MenuNavigationError::UnsortedEdges);
            }
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for MenuNavigation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct MenuNavigationWire {
            selected_option_id: MenuOptionId,
            edges: Vec<MenuNavigationEdge>,
        }

        let value = MenuNavigationWire::deserialize(deserializer)?;
        Self::new(value.selected_option_id, value.edges).map_err(serde::de::Error::custom)
    }
}

/// Noncanonical renderer geometry attached to an option identity.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MenuOptionLayout {
    pub option_id: MenuOptionId,
    pub row: u16,
    pub column: u16,
    pub page: u16,
}

impl MenuOptionLayout {
    pub const fn new(option_id: MenuOptionId, row: u16, column: u16, page: u16) -> Self {
        Self {
            option_id,
            row,
            column,
            page,
        }
    }

    pub const fn geometry(&self) -> (u16, u16, u16) {
        (self.page, self.row, self.column)
    }
}

/// One stable option. Layout is optional and does not affect option identity.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LogicalMenuOption {
    pub option_id: MenuOptionId,
    pub enabled: bool,
    pub layout: Option<MenuOptionLayout>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum LogicalMenuOptionError {
    #[error("menu option layout identity does not match option_id")]
    LayoutIdentityMismatch,
}

impl LogicalMenuOption {
    pub fn new(
        option_id: MenuOptionId,
        enabled: bool,
        layout: Option<MenuOptionLayout>,
    ) -> Result<Self, LogicalMenuOptionError> {
        let value = Self {
            option_id,
            enabled,
            layout,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), LogicalMenuOptionError> {
        if self
            .layout
            .as_ref()
            .is_some_and(|layout| layout.option_id != self.option_id)
        {
            return Err(LogicalMenuOptionError::LayoutIdentityMismatch);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for LogicalMenuOption {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct LogicalMenuOptionWire {
            option_id: MenuOptionId,
            enabled: bool,
            layout: Option<MenuOptionLayout>,
        }

        let value = LogicalMenuOptionWire::deserialize(deserializer)?;
        Self::new(value.option_id, value.enabled, value.layout).map_err(serde::de::Error::custom)
    }
}

/// Complete logical surface menu graph.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LogicalMenu {
    pub instance_id: MenuInstanceId,
    pub owner_seat: SeatId,
    pub control_id: String,
    pub selected_option_id: MenuOptionId,
    pub options: Vec<LogicalMenuOption>,
    pub navigation: Vec<MenuNavigationEdge>,
    pub cancel: CancelPolicy,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum LogicalMenuError {
    #[error("menu instance_id must be greater than zero")]
    ZeroInstanceId,
    #[error("menu control_id must not be empty")]
    EmptyControlId,
    #[error("menu must contain at least one option")]
    EmptyOptions,
    #[error("menu options are not in canonical option-id order")]
    UnsortedOptions,
    #[error("menu contains a duplicate option identity")]
    DuplicateOption,
    #[error("selected option is not present in the menu")]
    MissingSelectedOption,
    #[error("cancel option is not present in the menu")]
    UnknownCancelOption,
    #[error("navigation edge references an unknown option")]
    UnknownNavigationEndpoint,
    #[error("navigation edges contain a duplicate (from, direction) key")]
    DuplicateNavigationEdge,
    #[error("navigation edges are not in canonical option/direction order")]
    UnsortedNavigation,
    #[error("invalid menu option: {0}")]
    Option(#[from] LogicalMenuOptionError),
}

impl LogicalMenu {
    pub fn new(
        instance_id: MenuInstanceId,
        owner_seat: SeatId,
        control_id: impl Into<String>,
        selected_option_id: MenuOptionId,
        mut options: Vec<LogicalMenuOption>,
        mut navigation: Vec<MenuNavigationEdge>,
        cancel: CancelPolicy,
    ) -> Result<Self, LogicalMenuError> {
        options.sort_unstable_by(|first, second| first.option_id.cmp(&second.option_id));
        navigation.sort_unstable_by(compare_navigation_edges);
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

    pub fn validate(&self) -> Result<(), LogicalMenuError> {
        if self.instance_id.get() == SafeU53::ZERO {
            return Err(LogicalMenuError::ZeroInstanceId);
        }
        if self.control_id.is_empty() {
            return Err(LogicalMenuError::EmptyControlId);
        }
        if self.options.is_empty() {
            return Err(LogicalMenuError::EmptyOptions);
        }

        for pair in self.options.windows(2) {
            if pair[0].option_id == pair[1].option_id {
                return Err(LogicalMenuError::DuplicateOption);
            }
            if pair[0].option_id > pair[1].option_id {
                return Err(LogicalMenuError::UnsortedOptions);
            }
        }

        for option in &self.options {
            option.validate()?;
        }

        if !self.contains_option(&self.selected_option_id) {
            return Err(LogicalMenuError::MissingSelectedOption);
        }

        if let CancelPolicy::Select(option_id) = &self.cancel
            && !self.contains_option(option_id)
        {
            return Err(LogicalMenuError::UnknownCancelOption);
        }

        for pair in self.navigation.windows(2) {
            if pair[0].from == pair[1].from && pair[0].direction == pair[1].direction {
                return Err(LogicalMenuError::DuplicateNavigationEdge);
            }
            if compare_navigation_edges(&pair[0], &pair[1]) == Ordering::Greater {
                return Err(LogicalMenuError::UnsortedNavigation);
            }
        }

        for edge in &self.navigation {
            if !self.contains_option(&edge.from) || !self.contains_option(&edge.to) {
                return Err(LogicalMenuError::UnknownNavigationEndpoint);
            }
        }
        Ok(())
    }
    pub fn option(&self, option_id: MenuOptionId) -> Option<&LogicalMenuOption> {
        self.options
            .binary_search_by(|option| option.option_id.cmp(&option_id))
            .ok()
            .map(|index| &self.options[index])
    }

    pub fn contains_option(&self, option_id: &MenuOptionId) -> bool {
        self.option(option_id.clone()).is_some()
    }

    pub fn is_enabled(&self, option_id: &MenuOptionId) -> bool {
        self.option(option_id.clone())
            .is_some_and(|option| option.enabled)
    }
}

impl<'de> Deserialize<'de> for LogicalMenu {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct LogicalMenuWire {
            instance_id: MenuInstanceId,
            owner_seat: SeatId,
            control_id: String,
            selected_option_id: MenuOptionId,
            options: Vec<LogicalMenuOption>,
            navigation: Vec<MenuNavigationEdge>,
            cancel: CancelPolicy,
        }

        let value = LogicalMenuWire::deserialize(deserializer)?;
        Self::new(
            value.instance_id,
            value.owner_seat,
            value.control_id,
            value.selected_option_id,
            value.options,
            value.navigation,
            value.cancel,
        )
        .map_err(serde::de::Error::custom)
    }
}
