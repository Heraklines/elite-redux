//! Construction and selection of the explicit M3 target graph.
//!
//! Target candidates arrive from battle legality already filtered for live
//! occupancy and move-specific adjacency.  This module sorts and validates
//! those typed candidates, then emits only the frozen binary or multiple-target
//! graph.  It does not infer targets from a renderer rectangle and never wraps.

use er_types::battle_command::{BattleCommandError, BattleTargetSelection};
use er_types::battle_control::{BattleControl, BattleControlError, TargetSelectControl};
use er_types::battle_ids::{BattleSide, FieldSlot, MenuInstanceId, MoveSlotIndex, PokemonId};
use er_types::battle_ui::{
    BattleMenu, BattleMenuError, BattleMenuOption, MenuNavigationEdge, MenuOptionLayout,
    MenuOptionVisibility, NavigationDirection,
};
use er_types::ids::{MenuOptionId, SeatId, StringIdError};
use thiserror::Error;

/// Fail-closed target graph construction and activation failures.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TargetMenuError {
    #[error("menu option identity is invalid: {0}")]
    OptionId(#[from] StringIdError),
    #[error("target evidence is invalid: {0}")]
    TargetEvidence(#[from] BattleCommandError),
    #[error("target menu is invalid: {0}")]
    Menu(#[from] BattleMenuError),
    #[error("target control is invalid: {0}")]
    Control(#[from] BattleControlError),
    #[error("the target candidate set is empty")]
    NoLegalTargets,
    #[error("target candidate {slot:?} appears more than once")]
    DuplicateCandidate { slot: FieldSlot },
    #[error("the current target selection is not one of the supplied candidates")]
    StaleSelection,
    #[error("the current target option is disabled")]
    DisabledOption,
    #[error("the target actor field slot must be player-side")]
    NonPlayerFieldSlot,
}

/// Construct the frozen target option identity from a canonical field slot.
pub fn target_option_id(slot: FieldSlot) -> Result<MenuOptionId, StringIdError> {
    let side = match slot.side {
        BattleSide::Player => "player",
        BattleSide::Enemy => "enemy",
    };
    MenuOptionId::new(format!("target/{side}/{}", slot.position))
}

/// Canonicalize the live legal target vector without synthesizing any target.
///
/// Sorting is by the typed `FieldSlot` order (player side, then enemy side,
/// each by position).  Duplicate slots are rejected rather than silently
/// collapsed.
pub fn canonical_target_candidates(
    candidates: &[FieldSlot],
) -> Result<Vec<FieldSlot>, TargetMenuError> {
    if candidates.is_empty() {
        return Err(TargetMenuError::NoLegalTargets);
    }
    let mut canonical = candidates.to_vec();
    canonical.sort_unstable();
    for pair in canonical.windows(2) {
        if pair[0] == pair[1] {
            return Err(TargetMenuError::DuplicateCandidate { slot: pair[0] });
        }
    }
    Ok(canonical)
}

fn lowest_on_side(candidates: &[FieldSlot], side: BattleSide) -> Option<FieldSlot> {
    candidates
        .iter()
        .copied()
        .filter(|candidate| candidate.side == side)
        .min_by_key(|candidate| candidate.position)
}

fn same_side_position(
    candidates: &[FieldSlot],
    side: BattleSide,
    position: u8,
) -> Option<FieldSlot> {
    candidates
        .iter()
        .copied()
        .find(|candidate| candidate.side == side && candidate.position == position)
}

fn initial_selection(
    candidates: &[FieldSlot],
    requested_default: Option<FieldSlot>,
    remembered_enemy: Option<FieldSlot>,
) -> FieldSlot {
    requested_default
        .filter(|candidate| candidates.contains(candidate))
        .or_else(|| {
            remembered_enemy.filter(|candidate| {
                candidate.side == BattleSide::Enemy && candidates.contains(candidate)
            })
        })
        .or_else(|| lowest_on_side(candidates, BattleSide::Enemy))
        .unwrap_or(candidates[0])
}

fn binary_navigation(candidates: &[FieldSlot]) -> Result<Vec<MenuNavigationEdge>, TargetMenuError> {
    let first_enemy = lowest_on_side(candidates, BattleSide::Enemy);
    let first_player = lowest_on_side(candidates, BattleSide::Player);
    let mut navigation = Vec::new();

    for from in candidates.iter().copied() {
        // These are the complete cross-side rules.  There is deliberately no
        // reverse edge and no fallback to a neighboring position.
        match from.side {
            BattleSide::Player => {
                if let Some(to) = first_enemy {
                    navigation.push(MenuNavigationEdge::new(
                        target_option_id(from)?,
                        NavigationDirection::Up,
                        target_option_id(to)?,
                    ));
                }
            }
            BattleSide::Enemy => {
                if let Some(to) = first_player {
                    navigation.push(MenuNavigationEdge::new(
                        target_option_id(from)?,
                        NavigationDirection::Down,
                        target_option_id(to)?,
                    ));
                }
            }
        }

        // The horizontal rules intentionally use the typed field position,
        // not the option vector index.  Missing adjacent candidates mean no
        // edge; no wrap or skip is inferred.
        if from.position % 2 == 1 {
            if let Some(position) = from.position.checked_sub(1)
                && let Some(to) = same_side_position(candidates, from.side, position)
            {
                navigation.push(MenuNavigationEdge::new(
                    target_option_id(from)?,
                    NavigationDirection::Left,
                    target_option_id(to)?,
                ));
            }
        } else if let Some(position) = from.position.checked_add(1)
            && let Some(to) = same_side_position(candidates, from.side, position)
        {
            navigation.push(MenuNavigationEdge::new(
                target_option_id(from)?,
                NavigationDirection::Right,
                target_option_id(to)?,
            ));
        }
    }

    Ok(navigation)
}

/// Build the target menu from the already filtered legal candidate set.
#[allow(clippy::too_many_arguments)]
pub fn build_target_menu(
    instance_id: MenuInstanceId,
    owner_seat: SeatId,
    control_id: impl Into<String>,
    _actor: PokemonId,
    candidates: &[FieldSlot],
    multiple: bool,
    requested_default: Option<FieldSlot>,
    remembered_enemy: Option<FieldSlot>,
) -> Result<BattleMenu, TargetMenuError> {
    let candidates = canonical_target_candidates(candidates)?;
    let selected = initial_selection(&candidates, requested_default, remembered_enemy);
    let options = candidates
        .iter()
        .copied()
        .map(|slot| {
            let option_id = target_option_id(slot)?;
            let column = match slot.side {
                BattleSide::Player => 0,
                BattleSide::Enemy => 1,
            };
            Ok(BattleMenuOption::new(
                option_id.clone(),
                format!("label.{option_id}"),
                MenuOptionVisibility::Visible,
                true,
                MenuOptionLayout::new(option_id, u16::from(slot.position), column, 0),
            )
            .map_err(BattleMenuError::from)?)
        })
        .collect::<Result<Vec<_>, TargetMenuError>>()?;

    // A multiple-target move has no directional cursor behavior.  The action
    // submits the full candidate set; the menu still carries a stable visible
    // selection for the immutable projection.
    let navigation = if multiple {
        Vec::new()
    } else {
        binary_navigation(&candidates)?
    };

    Ok(BattleMenu::new(
        instance_id,
        owner_seat,
        control_id,
        target_option_id(selected)?,
        options,
        navigation,
    )?)
}

/// Build a target control while retaining the exact previous move control for
/// Cancel restoration.  The typed DTO validates that the parent retains the
/// selected move and the same actor/field frontier.
#[allow(clippy::too_many_arguments)]
pub fn build_target_control(
    instance_id: MenuInstanceId,
    owner_seat: SeatId,
    control_id: impl Into<String>,
    actor: PokemonId,
    field_slot: FieldSlot,
    move_slot: MoveSlotIndex,
    multiple: bool,
    candidates: &[FieldSlot],
    requested_default: Option<FieldSlot>,
    remembered_enemy: Option<FieldSlot>,
    cancel_to: BattleControl,
) -> Result<TargetSelectControl, TargetMenuError> {
    if field_slot.side != BattleSide::Player {
        return Err(TargetMenuError::NonPlayerFieldSlot);
    }
    let canonical = canonical_target_candidates(candidates)?;
    let menu = build_target_menu(
        instance_id,
        owner_seat,
        control_id,
        actor,
        &canonical,
        multiple,
        requested_default,
        remembered_enemy,
    )?;
    Ok(TargetSelectControl::new(
        actor,
        field_slot,
        move_slot,
        multiple,
        canonical,
        menu,
        Box::new(cancel_to),
    )?)
}

/// Select the current target cursor, rejecting a stale identity before any
/// semantic target value is returned.  Multiple-target action always returns
/// the complete canonical candidate set.
pub fn select_target(
    menu: &BattleMenu,
    _actor: PokemonId,
    candidates: &[FieldSlot],
    multiple: bool,
) -> Result<BattleTargetSelection, TargetMenuError> {
    let candidates = canonical_target_candidates(candidates)?;
    let option = menu
        .option(menu.selected_option_id.clone())
        .ok_or(TargetMenuError::StaleSelection)?;
    if !option.visibility.is_visible() {
        return Err(TargetMenuError::StaleSelection);
    }
    if !option.enabled {
        return Err(TargetMenuError::DisabledOption);
    }

    let mut selected = None;
    for candidate in candidates.iter().copied() {
        if target_option_id(candidate)? == menu.selected_option_id {
            selected = Some(candidate);
            break;
        }
    }
    let selected = selected.ok_or(TargetMenuError::StaleSelection)?;

    if multiple {
        return Ok(BattleTargetSelection::selected(candidates)?);
    }
    Ok(BattleTargetSelection::selected(vec![selected])?)
}

/// Convenience wrapper for the fully typed target control.
pub fn select_target_control(
    control: &TargetSelectControl,
) -> Result<BattleTargetSelection, TargetMenuError> {
    select_target(
        &control.menu,
        control.actor,
        &control.candidate_targets,
        control.multiple,
    )
}
