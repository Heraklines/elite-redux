//! Construction and selection of the reduced M3 command-root graph.
//!
//! This module owns only logical menu data.  Operation identities, command
//! proposals, and allocator high-water marks remain owned by the runtime and
//! admission layers.  In particular, a caller supplies the already allocated
//! menu instance and the already validated control identity.

use er_types::battle_command::{BattleCommandError, BattleCommandOffer};
use er_types::battle_control::{BattleControl, BattleControlError, CommandRootControl};
use er_types::battle_ids::{BattleSide, FieldSlot, MenuInstanceId, PokemonId};
use er_types::battle_ui::{
    BattleMenu, BattleMenuError, BattleMenuOption, MenuNavigationEdge, MenuOptionLayout,
    MenuOptionVisibility, NavigationDirection,
};
use er_types::ids::{MenuOptionId, SeatId, StringIdError};
use thiserror::Error;

/// The two command options supported by M3.
pub const COMMAND_FIGHT_OPTION_ID: &str = "command/fight";
pub const COMMAND_SWITCH_OPTION_ID: &str = "command/switch";

/// The root cursor can retain either of the two stable option identities.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub enum CommandRootSelection {
    /// The deterministic fresh-entry selection.
    #[default]
    Fight,
    Switch,
}

impl CommandRootSelection {
    pub const fn option_id(self) -> &'static str {
        match self {
            Self::Fight => COMMAND_FIGHT_OPTION_ID,
            Self::Switch => COMMAND_SWITCH_OPTION_ID,
        }
    }
}

/// The root's legality projection.  A visible option can be disabled; it is
/// never removed and navigation never skips over it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CommandMenuAvailability {
    pub fight: bool,
    pub switch: bool,
}

impl CommandMenuAvailability {
    pub const fn new(fight: bool, switch: bool) -> Self {
        Self { fight, switch }
    }

    pub fn from_offer(offer: &BattleCommandOffer) -> Self {
        Self {
            fight: !offer.fight.is_empty(),
            switch: !offer.switches.is_empty(),
        }
    }

    pub const fn has_legal_option(self) -> bool {
        self.fight || self.switch
    }
}

/// A command-root choice after the current stable selection was checked.
///
/// This is intentionally not a `BattleCommand`; converting it into a semantic
/// command requires the owning runtime's actor, operation, and menu context.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum CommandChoice {
    Fight,
    Switch,
}

/// Fail-closed construction and selection failures for the command root.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CommandMenuError {
    #[error("menu option identity is invalid: {0}")]
    OptionId(#[from] StringIdError),
    #[error("command offer is invalid: {0}")]
    Offer(#[from] BattleCommandError),
    #[error("command menu is invalid: {0}")]
    Menu(#[from] BattleMenuError),
    #[error("command control is invalid: {0}")]
    Control(#[from] BattleControlError),
    #[error("the command actor field slot must be player-side")]
    NonPlayerFieldSlot,
    #[error("the command offer contains no legal Fight or Switch option")]
    NoLegalOption,
    #[error("the selected command option is not one of the frozen root identities")]
    StaleSelection,
    #[error("the selected command option is disabled")]
    DisabledOption,
}

/// Construct a typed stable command option ID without exposing any operation
/// or proposal construction path.
pub fn command_option_id(selection: CommandRootSelection) -> Result<MenuOptionId, StringIdError> {
    MenuOptionId::new(selection.option_id())
}

/// Build the exact two-node root graph from the current legal offer.
pub fn build_command_menu(
    instance_id: MenuInstanceId,
    owner_seat: SeatId,
    control_id: impl Into<String>,
    offer: &BattleCommandOffer,
    selected: CommandRootSelection,
) -> Result<BattleMenu, CommandMenuError> {
    offer.validate()?;
    build_command_menu_with_availability(
        instance_id,
        owner_seat,
        control_id,
        CommandMenuAvailability::from_offer(offer),
        selected,
    )
}

/// Build the exact two-node root graph from an already validated legality
/// projection.  This seam is useful to the runtime after it has retained an
/// offer and avoids making the menu builder responsible for mechanical state.
pub fn build_command_menu_with_availability(
    instance_id: MenuInstanceId,
    owner_seat: SeatId,
    control_id: impl Into<String>,
    availability: CommandMenuAvailability,
    selected: CommandRootSelection,
) -> Result<BattleMenu, CommandMenuError> {
    if !availability.has_legal_option() {
        return Err(CommandMenuError::NoLegalOption);
    }

    let fight = command_option_id(CommandRootSelection::Fight)?;
    let switch = command_option_id(CommandRootSelection::Switch)?;
    let options = vec![
        BattleMenuOption::new(
            fight.clone(),
            format!("label.{COMMAND_FIGHT_OPTION_ID}"),
            MenuOptionVisibility::Visible,
            availability.fight,
            MenuOptionLayout::new(fight.clone(), 0, 0, 0),
        )
        .map_err(BattleMenuError::from)?,
        BattleMenuOption::new(
            switch.clone(),
            format!("label.{COMMAND_SWITCH_OPTION_ID}"),
            MenuOptionVisibility::Visible,
            availability.switch,
            MenuOptionLayout::new(switch.clone(), 1, 0, 0),
        )
        .map_err(BattleMenuError::from)?,
    ];

    // This table is the complete frozen root adjacency graph.  Missing
    // directions are intentional no-ops; do not derive more edges from the
    // row/column metadata.
    let navigation = vec![
        MenuNavigationEdge::new(fight.clone(), NavigationDirection::Down, switch.clone()),
        MenuNavigationEdge::new(switch, NavigationDirection::Up, fight.clone()),
    ];

    let selected_option_id = MenuOptionId::new(selected.option_id())?;
    Ok(BattleMenu::new(
        instance_id,
        owner_seat,
        control_id,
        selected_option_id,
        options,
        navigation,
    )?)
}

/// Build a command-root control while retaining the caller's typed actor and
/// field identity.  The field-side check prevents an enemy slot from entering
/// the human command UI.
pub fn build_command_root_control(
    instance_id: MenuInstanceId,
    owner_seat: SeatId,
    control_id: impl Into<String>,
    actor: PokemonId,
    field_slot: FieldSlot,
    offer: &BattleCommandOffer,
    selected: CommandRootSelection,
) -> Result<CommandRootControl, CommandMenuError> {
    if field_slot.side != BattleSide::Player {
        return Err(CommandMenuError::NonPlayerFieldSlot);
    }
    let menu = build_command_menu(instance_id, owner_seat, control_id, offer, selected)?;
    Ok(CommandRootControl::new(actor, field_slot, menu)?)
}

/// The command root has no main Cancel edge in M3.  This helper validates the
/// current stable option and enabled state before the runtime opens a submenu.
pub fn select_command(menu: &BattleMenu) -> Result<CommandChoice, CommandMenuError> {
    let option = menu
        .option(menu.selected_option_id.clone())
        .ok_or(CommandMenuError::StaleSelection)?;
    if !option.visibility.is_visible() {
        return Err(CommandMenuError::StaleSelection);
    }
    if !option.enabled {
        return Err(CommandMenuError::DisabledOption);
    }
    match menu.selected_option_id.as_str() {
        COMMAND_FIGHT_OPTION_ID => Ok(CommandChoice::Fight),
        COMMAND_SWITCH_OPTION_ID => Ok(CommandChoice::Switch),
        _ => Err(CommandMenuError::StaleSelection),
    }
}

/// Return the typed root control from a generic control only when the active
/// graph is the command root.  This keeps semantic dispatch in the runtime.
pub fn command_root(control: &BattleControl) -> Option<&CommandRootControl> {
    match control {
        BattleControl::CommandRoot(value) => Some(value),
        _ => None,
    }
}
