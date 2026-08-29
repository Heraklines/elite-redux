//! Deterministic raw-key navigation planning over explicit logical menu edges.

use std::collections::{BTreeMap, VecDeque};

use er_types::battle_ids::MenuInstanceId;
use er_types::{
    InputFocus, LogicalMenu, MenuOptionId, NavigationDirection, PhysicalKey, RawInputEvent,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavigationPlanV1 {
    pub menu_instance: MenuInstanceId,
    pub target: MenuOptionId,
    pub events: Vec<RawInputEvent>,
    pub expected_path: Vec<MenuOptionId>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum NavigationPlanErrorV1 {
    #[error("menu is invalid or menu instance is stale")]
    StaleMenu,
    #[error("navigation target is hidden, disabled, or unknown")]
    InvalidTarget,
    #[error("no directional path reaches the target")]
    NoPath,
    #[error("navigation plan exceeds its event bound")]
    Bounds,
}

pub fn plan_navigation_v1(
    menu: &LogicalMenu,
    expected_instance: MenuInstanceId,
    target: MenuOptionId,
    submit: bool,
    maximum_events: usize,
) -> Result<NavigationPlanV1, NavigationPlanErrorV1> {
    menu.validate()
        .map_err(|_| NavigationPlanErrorV1::StaleMenu)?;
    if menu.instance_id != expected_instance || maximum_events == 0 {
        return Err(NavigationPlanErrorV1::StaleMenu);
    }
    if !menu.contains_option(&target) || !menu.is_enabled(&target) {
        return Err(NavigationPlanErrorV1::InvalidTarget);
    }
    let start = menu.selected_option_id.clone();
    let directions = [
        NavigationDirection::Up,
        NavigationDirection::Down,
        NavigationDirection::Left,
        NavigationDirection::Right,
    ];
    let mut queue = VecDeque::from([start.clone()]);
    let mut parents = BTreeMap::<MenuOptionId, Option<(MenuOptionId, NavigationDirection)>>::new();
    parents.insert(start.clone(), None);
    while let Some(current) = queue.pop_front() {
        if current == target {
            break;
        }
        for direction in directions {
            if let Some(edge) = menu
                .navigation
                .iter()
                .find(|edge| edge.from == current && edge.direction == direction)
                && !parents.contains_key(&edge.to)
            {
                parents.insert(edge.to.clone(), Some((current.clone(), direction)));
                queue.push_back(edge.to.clone());
            }
        }
    }
    if !parents.contains_key(&target) {
        return Err(NavigationPlanErrorV1::NoPath);
    }
    let mut reversed = Vec::<(MenuOptionId, NavigationDirection)>::new();
    let mut cursor = target.clone();
    while let Some(Some((parent, direction))) = parents.get(&cursor).cloned() {
        reversed.push((cursor, direction));
        cursor = parent;
    }
    reversed.reverse();
    let edge_events = reversed
        .len()
        .checked_mul(2)
        .and_then(|count| count.checked_add(if submit { 2 } else { 0 }))
        .ok_or(NavigationPlanErrorV1::Bounds)?;
    if edge_events > maximum_events {
        return Err(NavigationPlanErrorV1::Bounds);
    }
    let mut events = Vec::with_capacity(edge_events);
    let mut expected_path = Vec::with_capacity(reversed.len() + 1);
    expected_path.push(start);
    for (option, direction) in reversed {
        let key = direction_key(direction);
        events.push(RawInputEvent::KeyDown {
            code: key.clone(),
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        });
        events.push(RawInputEvent::KeyUp { code: key });
        expected_path.push(option);
    }
    if submit {
        events.push(RawInputEvent::KeyDown {
            code: PhysicalKey::Space,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        });
        events.push(RawInputEvent::KeyUp {
            code: PhysicalKey::Space,
        });
    }
    Ok(NavigationPlanV1 {
        menu_instance: expected_instance,
        target,
        events,
        expected_path,
    })
}

fn direction_key(direction: NavigationDirection) -> PhysicalKey {
    match direction {
        NavigationDirection::Up => PhysicalKey::ArrowUp,
        NavigationDirection::Down => PhysicalKey::ArrowDown,
        NavigationDirection::Left => PhysicalKey::ArrowLeft,
        NavigationDirection::Right => PhysicalKey::ArrowRight,
    }
}
