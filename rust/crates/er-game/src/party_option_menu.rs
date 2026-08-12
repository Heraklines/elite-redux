//! Explicit Send Out/Cancel submenu construction for party decisions.
//!
//! Opening this submenu is an accepted graph transition only.  The submenu
//! never emits a command or replacement proposal; the runtime's typed action
//! reducer owns that boundary.  Cancel restores the exact parent graph with a
//! fresh menu instance and therefore cannot resurrect an old held-input key.

use er_state::battle::BattleState;
use er_types::battle_control::{
    BattleControl, BattleControlError, PartyOptionSelectControl, PartySelectControl,
    ReplacementSelectControl,
};
use er_types::battle_ids::{MenuInstanceId, PartyIndex, PokemonId};
use er_types::battle_ui::{
    BattleMenu, BattleMenuError, BattleMenuOption, BattleMenuOptionError, MenuNavigationEdge,
    MenuOptionLayout, MenuOptionVisibility, NavigationDirection,
};
use er_types::ids::{MenuOptionId, SeatId, StringIdError};
use thiserror::Error;

use crate::party_menu::{
    PARTY_CANCEL_OPTION_ID, PartyMenuError, parse_party_option_id, validate_party_control,
};

/// Stable identity of the Send Out submenu option.
pub const PARTY_OPTION_SEND_OUT_ID: &str = "party-option/send-out";

/// Stable identity of the submenu's own Cancel option.
pub const PARTY_OPTION_CANCEL_ID: &str = "party-option/cancel";

/// Fail-closed failures raised while opening or restoring the option submenu.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PartyOptionMenuError {
    #[error("party menu is invalid: {0}")]
    Party(#[source] PartyMenuError),
    #[error("replacement menu is invalid: {0}")]
    Replacement(#[source] crate::replacement_menu::ReplacementMenuError),
    #[error("party-option menu graph is invalid: {0}")]
    Menu(#[source] BattleMenuError),
    #[error("party-option menu option is invalid: {0}")]
    Option(#[source] BattleMenuOptionError),
    #[error("party-option control is invalid: {0}")]
    Control(#[source] BattleControlError),
    #[error("party-option ID is invalid: {0}")]
    OptionId(#[source] StringIdError),
    #[error("party-option parent must be a PartySelect or ReplacementSelect control")]
    InvalidParent,
    #[error("the selected party option is Cancel or is not an actual party member")]
    NotPartySelection,
    #[error("the selected party member is visible but disabled")]
    DisabledSelection,
    #[error(
        "the selected party slot {party_slot:?} does not contain {expected:?}; found {actual:?}"
    )]
    PartyIdentityMismatch {
        party_slot: PartyIndex,
        expected: PokemonId,
        actual: PokemonId,
    },
    #[error("party-option control ID is not the exact parent-derived identity")]
    ControlIdMismatch,
    #[error("party-option menu instance identity is stale")]
    StaleMenuInstance,
    #[error("new party-option menu instance must be greater than its parent")]
    MenuInstanceRegression,
    #[error("party-option menu graph or selection is stale")]
    StaleMenuState,
}

impl From<PartyMenuError> for PartyOptionMenuError {
    fn from(value: PartyMenuError) -> Self {
        Self::Party(value)
    }
}

impl From<crate::replacement_menu::ReplacementMenuError> for PartyOptionMenuError {
    fn from(value: crate::replacement_menu::ReplacementMenuError) -> Self {
        Self::Replacement(value)
    }
}

impl From<BattleMenuError> for PartyOptionMenuError {
    fn from(value: BattleMenuError) -> Self {
        Self::Menu(value)
    }
}

impl From<BattleMenuOptionError> for PartyOptionMenuError {
    fn from(value: BattleMenuOptionError) -> Self {
        Self::Option(value)
    }
}

impl From<BattleControlError> for PartyOptionMenuError {
    fn from(value: BattleControlError) -> Self {
        Self::Control(value)
    }
}

impl From<StringIdError> for PartyOptionMenuError {
    fn from(value: StringIdError) -> Self {
        Self::OptionId(value)
    }
}

/// Construct the two-node Send Out/Cancel graph.
fn build_option_menu(
    instance_id: MenuInstanceId,
    owner_seat: SeatId,
    control_id: String,
    selected_option_id: MenuOptionId,
) -> Result<BattleMenu, PartyOptionMenuError> {
    let send_out = MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID)?;
    let cancel = MenuOptionId::new(PARTY_OPTION_CANCEL_ID)?;
    let options = vec![
        BattleMenuOption::new(
            send_out.clone(),
            "label.party-option/send-out",
            MenuOptionVisibility::Visible,
            true,
            MenuOptionLayout::new(send_out.clone(), 0, 0, 0),
        )?,
        BattleMenuOption::new(
            cancel.clone(),
            "label.party-option/cancel",
            MenuOptionVisibility::Visible,
            true,
            MenuOptionLayout::new(cancel.clone(), 1, 0, 0),
        )?,
    ];
    let navigation = vec![
        MenuNavigationEdge::new(send_out.clone(), NavigationDirection::Up, cancel.clone()),
        MenuNavigationEdge::new(send_out.clone(), NavigationDirection::Down, cancel.clone()),
        MenuNavigationEdge::new(cancel.clone(), NavigationDirection::Up, send_out.clone()),
        MenuNavigationEdge::new(cancel.clone(), NavigationDirection::Down, send_out),
    ];
    Ok(BattleMenu::new(
        instance_id,
        owner_seat,
        control_id,
        selected_option_id,
        options,
        navigation,
    )?)
}

/// Open the submenu from a voluntary party picker after checking its current
/// menu instance, selected identity, and battle-backed enabled state.
pub fn open_party_option_menu(
    battle: &BattleState,
    parent: &PartySelectControl,
    expected_parent_instance_id: MenuInstanceId,
    new_instance_id: MenuInstanceId,
) -> Result<PartyOptionSelectControl, PartyOptionMenuError> {
    let parts = validate_party_control(battle, parent, Some(expected_parent_instance_id))?;
    let (_pokemon, party_slot) = selected_party_member(battle, &parent.menu, &parts.options)?;
    if !parent
        .menu
        .option(parent.menu.selected_option_id.clone())
        .is_some_and(|option| option.enabled)
    {
        return Err(PartyOptionMenuError::DisabledSelection);
    }
    validate_new_instance(parent.menu.instance_id, new_instance_id)?;
    let control_id = voluntary_option_control_id(&parent.menu.control_id, party_slot)?;
    let menu = build_option_menu(
        new_instance_id,
        parent.menu.owner_seat,
        control_id,
        MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID)?,
    )?;
    let control = PartyOptionSelectControl::new(
        parent.actor,
        parent.field_slot,
        party_slot,
        menu,
        Box::new(BattleControl::PartySelect(parent.clone())),
    )?;
    validate_option_control(battle, &control, Some(new_instance_id))?;
    Ok(control)
}

/// Open the submenu from an exact forced-replacement picker.
pub fn open_replacement_option_menu(
    battle: &BattleState,
    parent: &ReplacementSelectControl,
    expected_parent_instance_id: MenuInstanceId,
    new_instance_id: MenuInstanceId,
) -> Result<PartyOptionSelectControl, PartyOptionMenuError> {
    crate::replacement_menu::validate_replacement_control(
        battle,
        parent,
        Some(expected_parent_instance_id),
    )?;
    let (_pokemon, party_slot) = selected_party_member(battle, &parent.menu, &[])?;
    if !parent
        .menu
        .option(parent.menu.selected_option_id.clone())
        .is_some_and(|option| option.enabled)
    {
        return Err(PartyOptionMenuError::DisabledSelection);
    }
    validate_new_instance(parent.menu.instance_id, new_instance_id)?;
    let control_id = replacement_option_control_id(&parent.menu.control_id, party_slot)?;
    let menu = build_option_menu(
        new_instance_id,
        parent.owner_seat,
        control_id,
        MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID)?,
    )?;
    let control = PartyOptionSelectControl::new(
        parent.actor,
        parent.field_slot,
        party_slot,
        menu,
        Box::new(BattleControl::ReplacementSelect(parent.clone())),
    )?;
    validate_option_control(battle, &control, Some(new_instance_id))?;
    Ok(control)
}

/// Dispatch submenu opening while keeping the parent variant typed.
pub fn open_party_option_menu_from_control(
    battle: &BattleState,
    parent: &BattleControl,
    expected_parent_instance_id: MenuInstanceId,
    new_instance_id: MenuInstanceId,
) -> Result<PartyOptionSelectControl, PartyOptionMenuError> {
    match parent {
        BattleControl::PartySelect(value) => {
            open_party_option_menu(battle, value, expected_parent_instance_id, new_instance_id)
        }
        BattleControl::ReplacementSelect(value) => open_replacement_option_menu(
            battle,
            value,
            expected_parent_instance_id,
            new_instance_id,
        ),
        _ => Err(PartyOptionMenuError::InvalidParent),
    }
}

/// Restore the exact parent graph after submenu Cancel.
pub fn restore_parent_menu(
    battle: &BattleState,
    control: &PartyOptionSelectControl,
    expected_instance_id: MenuInstanceId,
    new_instance_id: MenuInstanceId,
) -> Result<BattleControl, PartyOptionMenuError> {
    control.validate()?;
    if control.menu.instance_id != expected_instance_id {
        return Err(PartyOptionMenuError::StaleMenuInstance);
    }
    validate_new_instance(control.menu.instance_id, new_instance_id)?;

    match control.cancel_to.as_ref() {
        BattleControl::PartySelect(parent) => {
            validate_party_control(battle, parent, None)?;
            validate_option_control(battle, control, Some(expected_instance_id))?;
            let restored = rebind_party_parent(parent, new_instance_id)?;
            Ok(BattleControl::PartySelect(restored))
        }
        BattleControl::ReplacementSelect(parent) => {
            crate::replacement_menu::validate_replacement_control(battle, parent, None)?;
            validate_option_control(battle, control, Some(expected_instance_id))?;
            let restored = rebind_replacement_parent(parent, new_instance_id)?;
            Ok(BattleControl::ReplacementSelect(restored))
        }
        _ => Err(PartyOptionMenuError::InvalidParent),
    }
}

/// Compatibility alias used by callers that name the action Cancel path.
pub fn cancel_party_option_menu(
    battle: &BattleState,
    control: &PartyOptionSelectControl,
    expected_instance_id: MenuInstanceId,
    new_instance_id: MenuInstanceId,
) -> Result<BattleControl, PartyOptionMenuError> {
    restore_parent_menu(battle, control, expected_instance_id, new_instance_id)
}

fn selected_party_member(
    battle: &BattleState,
    menu: &BattleMenu,
    expected_options: &[BattleMenuOption],
) -> Result<(PokemonId, PartyIndex), PartyOptionMenuError> {
    let selected = menu.selected_option_id.clone();
    if selected.as_str() == PARTY_CANCEL_OPTION_ID {
        return Err(PartyOptionMenuError::NotPartySelection);
    }
    let (pokemon, party_slot) = parse_party_option_id(&selected)?;
    let Some(member) = battle.player_party.get(usize::from(party_slot.get())) else {
        return Err(PartyOptionMenuError::NotPartySelection);
    };
    if member.id != pokemon {
        return Err(PartyOptionMenuError::PartyIdentityMismatch {
            party_slot,
            expected: member.id,
            actual: pokemon,
        });
    }
    if !expected_options.is_empty()
        && !expected_options
            .iter()
            .any(|option| option.option_id == selected)
    {
        return Err(PartyOptionMenuError::StaleMenuState);
    }
    Ok((pokemon, party_slot))
}

fn validate_option_control(
    battle: &BattleState,
    control: &PartyOptionSelectControl,
    expected_instance_id: Option<MenuInstanceId>,
) -> Result<(), PartyOptionMenuError> {
    if expected_instance_id.is_some_and(|expected| control.menu.instance_id != expected) {
        return Err(PartyOptionMenuError::StaleMenuInstance);
    }
    let selected = control.menu.selected_option_id.as_str();
    if selected != PARTY_OPTION_SEND_OUT_ID && selected != PARTY_OPTION_CANCEL_ID {
        return Err(PartyOptionMenuError::StaleMenuState);
    }
    let parent = control.cancel_to.as_ref();
    let expected_control_id = match parent {
        BattleControl::PartySelect(value) => {
            let (_, party_slot) = selected_party_member(battle, &value.menu, &[])?;
            validate_new_instance(value.menu.instance_id, control.menu.instance_id)?;
            if party_slot != control.selected_party_slot {
                return Err(PartyOptionMenuError::StaleMenuState);
            }
            voluntary_option_control_id(&value.menu.control_id, party_slot)?
        }
        BattleControl::ReplacementSelect(value) => {
            let (_, party_slot) = selected_party_member(battle, &value.menu, &[])?;
            validate_new_instance(value.menu.instance_id, control.menu.instance_id)?;
            if party_slot != control.selected_party_slot {
                return Err(PartyOptionMenuError::StaleMenuState);
            }
            replacement_option_control_id(&value.menu.control_id, party_slot)?
        }
        _ => return Err(PartyOptionMenuError::InvalidParent),
    };
    if control.menu.control_id != expected_control_id {
        return Err(PartyOptionMenuError::ControlIdMismatch);
    }
    let expected = build_option_menu(
        control.menu.instance_id,
        control.menu.owner_seat,
        expected_control_id,
        control.menu.selected_option_id.clone(),
    )?;
    if control.menu.options != expected.options || control.menu.navigation != expected.navigation {
        return Err(PartyOptionMenuError::StaleMenuState);
    }
    Ok(())
}

fn rebind_party_parent(
    parent: &PartySelectControl,
    instance_id: MenuInstanceId,
) -> Result<PartySelectControl, PartyOptionMenuError> {
    let menu = BattleMenu::new(
        instance_id,
        parent.menu.owner_seat,
        parent.menu.control_id.clone(),
        parent.menu.selected_option_id.clone(),
        parent.menu.options.clone(),
        parent.menu.navigation.clone(),
    )?;
    Ok(PartySelectControl::new(
        parent.actor,
        parent.field_slot,
        menu,
        parent.last_left_option_id.clone(),
        parent.last_right_option_id.clone(),
        parent.cancel_to.clone(),
    )?)
}

fn rebind_replacement_parent(
    parent: &ReplacementSelectControl,
    instance_id: MenuInstanceId,
) -> Result<ReplacementSelectControl, PartyOptionMenuError> {
    let menu = BattleMenu::new(
        instance_id,
        parent.menu.owner_seat,
        parent.menu.control_id.clone(),
        parent.menu.selected_option_id.clone(),
        parent.menu.options.clone(),
        parent.menu.navigation.clone(),
    )?;
    Ok(ReplacementSelectControl::new(
        parent.occurrence,
        parent.source,
        parent.actor,
        parent.field_slot,
        parent.owner_seat,
        menu,
        parent.last_left_option_id.clone(),
        parent.last_right_option_id.clone(),
    )?)
}

fn validate_new_instance(
    previous: MenuInstanceId,
    next: MenuInstanceId,
) -> Result<(), PartyOptionMenuError> {
    if next <= previous {
        return Err(PartyOptionMenuError::MenuInstanceRegression);
    }
    Ok(())
}

fn voluntary_option_control_id(
    parent_control_id: &str,
    party_slot: PartyIndex,
) -> Result<String, PartyOptionMenuError> {
    let Some(prefix) = parent_control_id.strip_suffix("/party") else {
        return Err(PartyOptionMenuError::ControlIdMismatch);
    };
    Ok(format!("{prefix}/party-option/{}", party_slot.get()))
}

fn replacement_option_control_id(
    parent_control_id: &str,
    party_slot: PartyIndex,
) -> Result<String, PartyOptionMenuError> {
    let Some(prefix) = parent_control_id.strip_suffix("/control/replacement") else {
        return Err(PartyOptionMenuError::ControlIdMismatch);
    };
    Ok(format!(
        "{prefix}/control/party-option/{}",
        party_slot.get()
    ))
}
