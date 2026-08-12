//! Forced replacement menu construction for the frozen M3 battle UI.
//!
//! Replacement identity is copied from the unresolved faint queue head.  The
//! global occurrence ID is used only to locate that stored occurrence; the
//! operation/control identity is derived from its `FaintSource`, including the
//! source-local turn occurrence.  When no same-owner legal candidate exists,
//! this module returns the internal deterministic decision and installs no
//! menu.

use er_battle::replacement::{
    ReplacementError, StoredFaintSource, legal_replacement_candidates, stored_faint_source,
};
use er_state::battle::BattleState;
use er_types::battle_command::{BattleCommandError, replacement_operation_id};
use er_types::battle_control::{BattleControlError, ReplacementSelectControl};
use er_types::battle_ids::{BattleSide, FaintOccurrenceId, FieldSlot, MenuInstanceId, PokemonId};
use er_types::battle_model::{FaintSource, ReplacementProgress};
use er_types::battle_ui::{BattleMenu, BattleMenuError, BattleMenuOptionError};
use er_types::ids::{OperationId, SeatId};
use thiserror::Error;

use crate::party_menu::{
    PartyColumn, PartyMenuError, build_party_graph_parts, build_party_navigation, is_memory_option,
    party_column, selected_matches_memory,
};

/// Fail-closed failures raised while projecting a forced replacement menu.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ReplacementMenuError {
    #[error("stored replacement identity is invalid: {0}")]
    Replacement(#[source] ReplacementError),
    #[error("replacement party graph is invalid: {0}")]
    Party(#[source] PartyMenuError),
    #[error("replacement menu graph is invalid: {0}")]
    Menu(#[source] BattleMenuError),
    #[error("replacement menu option is invalid: {0}")]
    Option(#[source] BattleMenuOptionError),
    #[error("replacement control is invalid: {0}")]
    Control(#[source] BattleControlError),
    #[error("replacement operation identity is invalid: {0}")]
    Operation(#[source] BattleCommandError),
    #[error("replacement menu instance identity is stale")]
    StaleMenuInstance,
    #[error("replacement menu identity does not match the stored faint occurrence")]
    StaleReplacementIdentity,
    #[error("replacement menu graph or selection is stale")]
    StaleMenuState,
    #[error("replacement progress is {actual:?}, not Pending or NoLegalReplacement")]
    ProgressNotPending { actual: ReplacementProgress },
    #[error("replacement menu cannot be projected for a non-player field")]
    NonPlayerReplacement,
}

impl From<ReplacementError> for ReplacementMenuError {
    fn from(value: ReplacementError) -> Self {
        Self::Replacement(value)
    }
}

impl From<PartyMenuError> for ReplacementMenuError {
    fn from(value: PartyMenuError) -> Self {
        Self::Party(value)
    }
}

impl From<BattleMenuError> for ReplacementMenuError {
    fn from(value: BattleMenuError) -> Self {
        Self::Menu(value)
    }
}

impl From<BattleMenuOptionError> for ReplacementMenuError {
    fn from(value: BattleMenuOptionError) -> Self {
        Self::Option(value)
    }
}

impl From<BattleControlError> for ReplacementMenuError {
    fn from(value: BattleControlError) -> Self {
        Self::Control(value)
    }
}

impl From<BattleCommandError> for ReplacementMenuError {
    fn from(value: BattleCommandError) -> Self {
        Self::Operation(value)
    }
}

/// Result of projecting a stored replacement decision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReplacementMenuResult {
    /// A selectable replacement menu for the exact stored faint occurrence.
    Menu(ReplacementSelectControl),
    /// The internal no-legal-replacement decision.  No public menu or
    /// externally supplied proposal is created for this variant.
    NoLegalReplacement {
        occurrence: FaintOccurrenceId,
        source: FaintSource,
        actor: PokemonId,
        field_slot: FieldSlot,
        owner_seat: SeatId,
    },
}

/// Name used by callers that refer to this value as a menu projection.
pub type ReplacementMenuBuild = ReplacementMenuResult;

impl ReplacementMenuResult {
    /// Return the occurrence identity carried by either projection result.
    pub const fn occurrence(&self) -> FaintOccurrenceId {
        match self {
            Self::Menu(control) => control.occurrence,
            Self::NoLegalReplacement { occurrence, .. } => *occurrence,
        }
    }
}

/// Build the forced replacement picker or return the internal no-legal path.
pub fn build_replacement_menu(
    battle: &BattleState,
    occurrence: FaintOccurrenceId,
    menu_instance_id: MenuInstanceId,
) -> Result<ReplacementMenuResult, ReplacementMenuError> {
    let stored = stored_faint_source(battle, occurrence)?;
    if stored.field_slot.side != BattleSide::Player || stored.owner_seat.is_none() {
        return Err(ReplacementMenuError::NonPlayerReplacement);
    }
    if stored.replacement != ReplacementProgress::Pending
        && stored.replacement != ReplacementProgress::NoLegalReplacement
    {
        return Err(ReplacementMenuError::ProgressNotPending {
            actual: stored.replacement,
        });
    }
    let owner_seat = stored
        .owner_seat
        .ok_or(ReplacementMenuError::NonPlayerReplacement)?;
    if legal_replacement_candidates(battle, occurrence)?.is_empty() {
        return Ok(ReplacementMenuResult::NoLegalReplacement {
            occurrence: stored.occurrence,
            source: stored.source,
            actor: stored.actor,
            field_slot: stored.field_slot,
            owner_seat,
        });
    }
    if stored.replacement != ReplacementProgress::Pending {
        return Err(ReplacementMenuError::StaleReplacementIdentity);
    }

    let parts = build_party_graph_parts(battle, owner_seat, false)?;
    let navigation = build_party_navigation(
        &parts.party_option_ids,
        &parts.active_option_ids,
        &parts.bench_option_ids,
        &parts.selected_option_id,
        &parts.last_left_option_id,
        &parts.last_right_option_id,
    )?;
    let operation_id = replacement_operation_id_for_stored(battle, stored)?;
    let control_id = format!("{operation_id}/control/replacement");
    let menu = BattleMenu::new(
        menu_instance_id,
        owner_seat,
        control_id,
        parts.selected_option_id,
        parts.options,
        navigation,
    )?;
    let control = ReplacementSelectControl::new(
        stored.occurrence,
        stored.source,
        stored.actor,
        stored.field_slot,
        owner_seat,
        menu,
        parts.last_left_option_id,
        parts.last_right_option_id,
    )?;
    validate_replacement_control(battle, &control, Some(menu_instance_id))?;
    Ok(ReplacementMenuResult::Menu(control))
}

/// Compatibility name for callers that describe the operation as a menu
/// projection.
pub fn project_replacement_menu(
    battle: &BattleState,
    occurrence: FaintOccurrenceId,
    menu_instance_id: MenuInstanceId,
) -> Result<ReplacementMenuResult, ReplacementMenuError> {
    build_replacement_menu(battle, occurrence, menu_instance_id)
}

/// Apply one exact directional edge to a forced replacement picker.
pub fn navigate_replacement_menu(
    battle: &BattleState,
    control: &ReplacementSelectControl,
    expected_instance_id: MenuInstanceId,
    direction: er_types::battle_ui::NavigationDirection,
) -> Result<ReplacementSelectControl, ReplacementMenuError> {
    let stored = validate_replacement_control(battle, control, Some(expected_instance_id))?;
    let parts = build_party_graph_parts(battle, control.owner_seat, false)?;
    let Some(edge) =
        control.menu.navigation.iter().find(|edge| {
            edge.from == control.menu.selected_option_id && edge.direction == direction
        })
    else {
        return Ok(control.clone());
    };

    let selected_option_id = edge.to.clone();
    let mut last_left_option_id = control.last_left_option_id.clone();
    let mut last_right_option_id = control.last_right_option_id.clone();
    match party_column(
        &selected_option_id,
        &parts.active_option_ids,
        &parts.bench_option_ids,
    ) {
        PartyColumn::Active => last_left_option_id = selected_option_id.clone(),
        PartyColumn::Bench => last_right_option_id = selected_option_id.clone(),
        PartyColumn::Cancel => {}
    }
    let navigation = build_party_navigation(
        &parts.party_option_ids,
        &parts.active_option_ids,
        &parts.bench_option_ids,
        &selected_option_id,
        &last_left_option_id,
        &last_right_option_id,
    )?;
    let menu = BattleMenu::new(
        control.menu.instance_id,
        control.menu.owner_seat,
        control.menu.control_id.clone(),
        selected_option_id,
        control.menu.options.clone(),
        navigation,
    )?;
    let next = ReplacementSelectControl::new(
        stored.occurrence,
        stored.source,
        stored.actor,
        stored.field_slot,
        stored
            .owner_seat
            .ok_or(ReplacementMenuError::NonPlayerReplacement)?,
        menu,
        last_left_option_id,
        last_right_option_id,
    )?;
    validate_replacement_control(battle, &next, Some(expected_instance_id))?;
    Ok(next)
}

/// Build the exact REPLACEMENT decision-window operation from stored identity.
pub fn replacement_operation_id_for_occurrence(
    battle: &BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<OperationId, ReplacementMenuError> {
    let stored = stored_faint_source(battle, occurrence)?;
    replacement_operation_id_for_stored(battle, stored)
}

fn replacement_operation_id_for_stored(
    battle: &BattleState,
    stored: StoredFaintSource,
) -> Result<OperationId, ReplacementMenuError> {
    let owner_seat = stored
        .owner_seat
        .ok_or(ReplacementMenuError::NonPlayerReplacement)?;
    Ok(replacement_operation_id(
        stored.source.epoch,
        battle.battle_id,
        stored.source.wave,
        stored.source.resolved_turn,
        stored.source.turn_occurrence,
        stored.field_slot,
        owner_seat,
    )?)
}

/// Validate a replacement control against the current queue head and exact
/// graph.  This is the identity fence used before opening its option submenu.
pub(crate) fn validate_replacement_control(
    battle: &BattleState,
    control: &ReplacementSelectControl,
    expected_instance_id: Option<MenuInstanceId>,
) -> Result<StoredFaintSource, ReplacementMenuError> {
    control.validate()?;
    if expected_instance_id.is_some_and(|expected| control.menu.instance_id != expected) {
        return Err(ReplacementMenuError::StaleMenuInstance);
    }
    let stored = stored_faint_source(battle, control.occurrence)?;
    if stored.source != control.source
        || stored.actor != control.actor
        || stored.field_slot != control.field_slot
        || stored.owner_seat != Some(control.owner_seat)
    {
        return Err(ReplacementMenuError::StaleReplacementIdentity);
    }
    if stored.replacement != ReplacementProgress::Pending {
        return Err(ReplacementMenuError::ProgressNotPending {
            actual: stored.replacement,
        });
    }
    let parts = build_party_graph_parts(battle, control.owner_seat, false)?;
    if control.menu.options != parts.options {
        return Err(ReplacementMenuError::StaleMenuState);
    }
    if !parts
        .party_option_ids
        .contains(&control.menu.selected_option_id)
        && control.menu.selected_option_id.as_str() != crate::party_menu::PARTY_CANCEL_OPTION_ID
    {
        return Err(ReplacementMenuError::StaleMenuState);
    }
    if !is_memory_option(&control.last_left_option_id, &parts.active_option_ids, true)
        || !is_memory_option(&control.last_right_option_id, &parts.bench_option_ids, true)
    {
        return Err(ReplacementMenuError::StaleMenuState);
    }
    if !selected_matches_memory(
        &control.menu.selected_option_id,
        &parts.active_option_ids,
        &parts.bench_option_ids,
        &control.last_left_option_id,
        &control.last_right_option_id,
    ) {
        return Err(ReplacementMenuError::StaleMenuState);
    }
    let expected_navigation = build_party_navigation(
        &parts.party_option_ids,
        &parts.active_option_ids,
        &parts.bench_option_ids,
        &control.menu.selected_option_id,
        &control.last_left_option_id,
        &control.last_right_option_id,
    )?;
    if control.menu.navigation != expected_navigation {
        return Err(ReplacementMenuError::StaleMenuState);
    }
    let operation_id = replacement_operation_id_for_stored(battle, stored)?;
    let expected_control_id = format!("{operation_id}/control/replacement");
    if control.menu.control_id != expected_control_id {
        return Err(ReplacementMenuError::StaleReplacementIdentity);
    }
    Ok(stored)
}
