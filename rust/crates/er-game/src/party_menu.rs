//! Voluntary party-selection menu construction for the frozen M3 battle UI.
//!
//! The party picker is deliberately a graph builder, not a cursor policy.  It
//! materializes every party entry (including entries that cannot currently be
//! selected), then records only the explicit M3 navigation edges.  The
//! renderer's layout is never consulted when a direction is reduced.

use er_state::battle::BattleState;
use er_state::field::FieldStateError;
use er_state::format::{FormatTopologyError, owner_seat_for, validate_slot};
use er_types::battle_control::{BattleControl, BattleControlError, PartySelectControl};
use er_types::battle_ids::{BattleSide, FieldSlot, MenuInstanceId, PartyIndex, PokemonId};
use er_types::battle_ui::{
    BattleMenu, BattleMenuError, BattleMenuOption, BattleMenuOptionError, MenuNavigationEdge,
    MenuOptionLayout, MenuOptionVisibility, NavigationDirection,
};
use er_types::ids::{MenuOptionId, SeatId, StringIdError};
use thiserror::Error;

/// Stable identity of the visible party cancel option.
pub const PARTY_CANCEL_OPTION_ID: &str = "party/cancel";

/// Stable control-graph kind for voluntary party selection.
pub const PARTY_CONTROL_KIND: &str = "party";

/// Fail-closed failures raised while building or reducing a party menu.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PartyMenuError {
    #[error("party menu field is invalid: {0}")]
    Field(#[source] FieldStateError),
    #[error("party menu topology is invalid: {0}")]
    Format(#[source] FormatTopologyError),
    #[error("party menu graph is invalid: {0}")]
    Menu(#[source] BattleMenuError),
    #[error("party control is invalid: {0}")]
    Control(#[source] BattleControlError),
    #[error("party option ID is invalid: {0}")]
    OptionId(#[source] StringIdError),
    #[error("party option ID {value:?} is not in the canonical party/<pokemon>/slot/<slot> form")]
    MalformedPartyOption { value: String },
    #[error("party menu option is invalid: {0}")]
    Option(#[source] BattleMenuOptionError),
    #[error("party menu contains more than six members")]
    TooManyPartyMembers,
    #[error("party menu contains duplicate Pokémon identity {pokemon:?}")]
    DuplicatePokemon { pokemon: PokemonId },
    #[error("party menu actor {actor:?} is not the occupant of player slot {field_slot:?}")]
    ActorNotOnField {
        actor: PokemonId,
        field_slot: FieldSlot,
    },
    #[error("party menu actor {actor:?} is not a living Pokémon")]
    ActorNotLiving { actor: PokemonId },
    #[error(
        "party menu owner {actual:?} does not own player slot {field_slot:?}; expected {expected:?}"
    )]
    OwnerMismatch {
        actual: SeatId,
        expected: SeatId,
        field_slot: FieldSlot,
    },
    #[error("party menu requires a player field slot, got {field_slot:?}")]
    NonPlayerField { field_slot: FieldSlot },
    #[error("party menu control ID is stale: expected {expected:?}, got {actual:?}")]
    ControlIdMismatch { expected: String, actual: String },
    #[error("party menu instance identity is stale")]
    StaleMenuInstance,
    #[error("party menu selection or graph is stale")]
    StaleMenuState,
    #[error("party menu navigation edge is stale")]
    StaleNavigation,
    #[error("party option is not an actual party member")]
    NotPartyOption,
    #[error("party option is visible but disabled")]
    DisabledOption,
    #[error("new party menu instance must be greater than the previous instance")]
    MenuInstanceRegression,
    #[error("party menu cannot be empty when a party decision is required")]
    EmptyParty,
    #[error("party menu cancel parent is not the exact Switch command root")]
    InvalidCancelParent,
}

impl From<FieldStateError> for PartyMenuError {
    fn from(value: FieldStateError) -> Self {
        Self::Field(value)
    }
}

impl From<FormatTopologyError> for PartyMenuError {
    fn from(value: FormatTopologyError) -> Self {
        Self::Format(value)
    }
}

impl From<BattleMenuError> for PartyMenuError {
    fn from(value: BattleMenuError) -> Self {
        Self::Menu(value)
    }
}

impl From<BattleMenuOptionError> for PartyMenuError {
    fn from(value: BattleMenuOptionError) -> Self {
        Self::Option(value)
    }
}

impl From<BattleControlError> for PartyMenuError {
    fn from(value: BattleControlError) -> Self {
        Self::Control(value)
    }
}

impl From<StringIdError> for PartyMenuError {
    fn from(value: StringIdError) -> Self {
        Self::OptionId(value)
    }
}

/// Whether an actual party entry is on the field or on the bench.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PartyColumn {
    Active,
    Bench,
    Cancel,
}

/// Canonical graph ingredients shared by voluntary and replacement menus.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PartyGraphParts {
    pub options: Vec<BattleMenuOption>,
    pub party_option_ids: Vec<MenuOptionId>,
    pub active_option_ids: Vec<MenuOptionId>,
    pub bench_option_ids: Vec<MenuOptionId>,
    pub selected_option_id: MenuOptionId,
    pub last_left_option_id: MenuOptionId,
    pub last_right_option_id: MenuOptionId,
}

/// Return the stable party option ID for one typed party entry.
pub fn party_option_id(
    pokemon: PokemonId,
    party_slot: PartyIndex,
) -> Result<MenuOptionId, PartyMenuError> {
    Ok(MenuOptionId::new(format!(
        "party/{pokemon}/slot/{}",
        party_slot.get()
    ))?)
}

/// Return the stable party cancel option ID.
pub fn party_cancel_option_id() -> Result<MenuOptionId, PartyMenuError> {
    Ok(MenuOptionId::new(PARTY_CANCEL_OPTION_ID)?)
}

/// Parse a stable party option ID without accepting legacy flat indices.
pub(crate) fn parse_party_option_id(
    option_id: &MenuOptionId,
) -> Result<(PokemonId, PartyIndex), PartyMenuError> {
    let value = option_id.as_str();
    let mut parts = value.split('/');
    let (Some(kind), Some(pokemon), Some(slot_kind), Some(slot), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return Err(PartyMenuError::MalformedPartyOption {
            value: value.to_owned(),
        });
    };
    if kind != "party" || slot_kind != "slot" || pokemon.is_empty() || slot.is_empty() {
        return Err(PartyMenuError::MalformedPartyOption {
            value: value.to_owned(),
        });
    }
    let pokemon =
        parse_canonical_decimal(pokemon).ok_or_else(|| PartyMenuError::MalformedPartyOption {
            value: value.to_owned(),
        })?;
    let slot =
        parse_canonical_decimal(slot).ok_or_else(|| PartyMenuError::MalformedPartyOption {
            value: value.to_owned(),
        })?;
    let pokemon =
        PokemonId::try_from(pokemon).map_err(|_| PartyMenuError::MalformedPartyOption {
            value: value.to_owned(),
        })?;
    let slot = PartyIndex::try_from(slot).map_err(|_| PartyMenuError::MalformedPartyOption {
        value: value.to_owned(),
    })?;
    Ok((pokemon, slot))
}

fn parse_canonical_decimal(value: &str) -> Option<u64> {
    if value.is_empty() || (value.len() > 1 && value.starts_with('0')) {
        return None;
    }
    if !value.bytes().all(|digit| digit.is_ascii_digit()) {
        return None;
    }
    value.parse::<u64>().ok()
}

/// Build all party options and the two column-memory identities.
///
/// `cancel_enabled` is false for forced replacement menus, whose main Cancel
/// node remains visible but cannot be activated.
pub(crate) fn build_party_graph_parts(
    battle: &BattleState,
    owner_seat: SeatId,
    cancel_enabled: bool,
) -> Result<PartyGraphParts, PartyMenuError> {
    validate_party_inventory(battle)?;

    let active_ids = active_party_ids(battle);
    let mut options = Vec::with_capacity(battle.player_party.len() + 1);
    let mut party_option_ids = Vec::with_capacity(battle.player_party.len());
    let mut active_option_ids = Vec::new();
    let mut bench_option_ids = Vec::new();

    for (index, pokemon) in battle.player_party.iter().enumerate() {
        let party_slot =
            PartyIndex::try_from(index as u64).map_err(|_| PartyMenuError::TooManyPartyMembers)?;
        let option_id = party_option_id(pokemon.id, party_slot)?;
        let active = active_ids.contains(&pokemon.id);
        if active {
            active_option_ids.push(option_id.clone());
        } else {
            bench_option_ids.push(option_id.clone());
        }
        party_option_ids.push(option_id.clone());

        let enabled = pokemon.owner_seat == Some(owner_seat)
            && !pokemon.fainted
            && pokemon.hp != 0
            && !active;
        let column = if active { 0 } else { 1 };
        let row = u16::try_from(index).map_err(|_| PartyMenuError::TooManyPartyMembers)?;
        options.push(BattleMenuOption::new(
            option_id.clone(),
            format!("label.party/{}/slot/{}", pokemon.id, party_slot.get()),
            MenuOptionVisibility::Visible,
            enabled,
            MenuOptionLayout::new(option_id, row, column, 0),
        )?);
    }

    let cancel = party_cancel_option_id()?;
    options.push(BattleMenuOption::new(
        cancel.clone(),
        "label.party/cancel",
        MenuOptionVisibility::Visible,
        cancel_enabled,
        MenuOptionLayout::new(cancel.clone(), 0, 2, 0),
    )?);
    options.sort_unstable_by(|first, second| first.option_id.cmp(&second.option_id));

    let selected_option_id = party_option_ids
        .first()
        .cloned()
        .unwrap_or_else(|| cancel.clone());
    let last_left_option_id = active_option_ids
        .first()
        .cloned()
        .unwrap_or_else(|| cancel.clone());
    let last_right_option_id = bench_option_ids
        .first()
        .cloned()
        .unwrap_or_else(|| cancel.clone());

    Ok(PartyGraphParts {
        options,
        party_option_ids,
        active_option_ids,
        bench_option_ids,
        selected_option_id,
        last_left_option_id,
        last_right_option_id,
    })
}

/// Materialize the exact graph for a selected party identity and memories.
pub(crate) fn build_party_navigation(
    party_option_ids: &[MenuOptionId],
    active_option_ids: &[MenuOptionId],
    bench_option_ids: &[MenuOptionId],
    selected_option_id: &MenuOptionId,
    last_left_option_id: &MenuOptionId,
    last_right_option_id: &MenuOptionId,
) -> Result<Vec<MenuNavigationEdge>, PartyMenuError> {
    let cancel = party_cancel_option_id()?;
    if !party_option_ids.contains(selected_option_id) && selected_option_id != &cancel {
        return Err(PartyMenuError::StaleMenuState);
    }
    if !party_option_ids.contains(last_left_option_id) && last_left_option_id != &cancel {
        return Err(PartyMenuError::StaleMenuState);
    }
    if !party_option_ids.contains(last_right_option_id) && last_right_option_id != &cancel {
        return Err(PartyMenuError::StaleMenuState);
    }

    let mut edges = Vec::new();
    for (index, option_id) in party_option_ids.iter().enumerate() {
        if index == 0 {
            edges.push(MenuNavigationEdge::new(
                option_id.clone(),
                NavigationDirection::Up,
                cancel.clone(),
            ));
        } else {
            edges.push(MenuNavigationEdge::new(
                option_id.clone(),
                NavigationDirection::Up,
                party_option_ids[index - 1].clone(),
            ));
        }

        if let Some(next) = party_option_ids.get(index + 1) {
            edges.push(MenuNavigationEdge::new(
                option_id.clone(),
                NavigationDirection::Down,
                next.clone(),
            ));
        } else {
            edges.push(MenuNavigationEdge::new(
                option_id.clone(),
                NavigationDirection::Down,
                cancel.clone(),
            ));
        }
    }

    if !party_option_ids.is_empty() {
        edges.push(MenuNavigationEdge::new(
            cancel.clone(),
            NavigationDirection::Up,
            party_option_ids.last().cloned().unwrap_or(cancel.clone()),
        ));
        edges.push(MenuNavigationEdge::new(
            cancel.clone(),
            NavigationDirection::Down,
            party_option_ids.first().cloned().unwrap_or(cancel.clone()),
        ));
    }

    if last_left_option_id != &cancel {
        for option_id in bench_option_ids {
            edges.push(MenuNavigationEdge::new(
                option_id.clone(),
                NavigationDirection::Left,
                last_left_option_id.clone(),
            ));
        }
        edges.push(MenuNavigationEdge::new(
            cancel.clone(),
            NavigationDirection::Left,
            last_left_option_id.clone(),
        ));
    }

    for option_id in active_option_ids {
        edges.push(MenuNavigationEdge::new(
            option_id.clone(),
            NavigationDirection::Right,
            if last_right_option_id == &cancel {
                cancel.clone()
            } else {
                last_right_option_id.clone()
            },
        ));
    }

    edges.sort_unstable_by(|first, second| {
        first
            .from
            .cmp(&second.from)
            .then(first.direction.cmp(&second.direction))
            .then(first.to.cmp(&second.to))
    });
    Ok(edges)
}

/// Construct a voluntary party picker and its exact Switch cancel history.
pub fn build_party_select(
    battle: &BattleState,
    actor: PokemonId,
    field_slot: FieldSlot,
    owner_seat: SeatId,
    menu_instance_id: MenuInstanceId,
    cancel_to: BattleControl,
) -> Result<PartySelectControl, PartyMenuError> {
    validate_party_context(battle, actor, field_slot, owner_seat)?;
    validate_switch_cancel_parent(battle, actor, field_slot, owner_seat, &cancel_to)?;

    let parts = build_party_graph_parts(battle, owner_seat, true)?;
    if parts.party_option_ids.is_empty() {
        return Err(PartyMenuError::EmptyParty);
    }
    let navigation = build_party_navigation(
        &parts.party_option_ids,
        &parts.active_option_ids,
        &parts.bench_option_ids,
        &parts.selected_option_id,
        &parts.last_left_option_id,
        &parts.last_right_option_id,
    )?;
    let control_id = expected_party_control_id(battle, field_slot, owner_seat);
    let menu = BattleMenu::new(
        menu_instance_id,
        owner_seat,
        control_id,
        parts.selected_option_id,
        parts.options,
        navigation,
    )?;
    let control = PartySelectControl::new(
        actor,
        field_slot,
        menu,
        parts.last_left_option_id,
        parts.last_right_option_id,
        Box::new(cancel_to),
    )?;
    validate_party_control(battle, &control, Some(menu_instance_id))?;
    Ok(control)
}

/// Compatibility name for callers that describe the result as a party menu.
pub fn build_party_menu(
    battle: &BattleState,
    actor: PokemonId,
    field_slot: FieldSlot,
    owner_seat: SeatId,
    menu_instance_id: MenuInstanceId,
    cancel_to: BattleControl,
) -> Result<PartySelectControl, PartyMenuError> {
    build_party_select(
        battle,
        actor,
        field_slot,
        owner_seat,
        menu_instance_id,
        cancel_to,
    )
}

/// Apply one exact graph edge to a voluntary party menu.
///
/// The menu instance is retained for ordinary directional traversal.  The
/// caller supplies the instance it accepted the input against; a mismatch is
/// a stale-input rejection and cannot alter selection or memory.
pub fn navigate_party_menu(
    battle: &BattleState,
    control: &PartySelectControl,
    expected_instance_id: MenuInstanceId,
    direction: NavigationDirection,
) -> Result<PartySelectControl, PartyMenuError> {
    let parts = validate_party_control(battle, control, Some(expected_instance_id))?;
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
    let next = PartySelectControl::new(
        control.actor,
        control.field_slot,
        menu,
        last_left_option_id,
        last_right_option_id,
        control.cancel_to.clone(),
    )?;
    validate_party_control(battle, &next, Some(expected_instance_id))?;
    Ok(next)
}

/// Validate a party control against the current battle and exact graph.
///
/// This is `pub(crate)` so the option submenu cannot turn a stale menu into a
/// semantic switch.  It is intentionally stricter than `PartySelectControl::validate`:
/// it checks the current battle inventory, graph, control identity, memories,
/// and instance fence together.
pub(crate) fn validate_party_control(
    battle: &BattleState,
    control: &PartySelectControl,
    expected_instance_id: Option<MenuInstanceId>,
) -> Result<PartyGraphParts, PartyMenuError> {
    control.validate()?;
    if expected_instance_id.is_some_and(|expected| control.menu.instance_id != expected) {
        return Err(PartyMenuError::StaleMenuInstance);
    }
    validate_party_context(
        battle,
        control.actor,
        control.field_slot,
        control.menu.owner_seat,
    )?;

    let expected_control_id =
        expected_party_control_id(battle, control.field_slot, control.menu.owner_seat);
    if control.menu.control_id != expected_control_id {
        return Err(PartyMenuError::ControlIdMismatch {
            expected: expected_control_id,
            actual: control.menu.control_id.clone(),
        });
    }

    let parts = build_party_graph_parts(battle, control.menu.owner_seat, true)?;
    if control.menu.options != parts.options {
        return Err(PartyMenuError::StaleMenuState);
    }
    if !parts
        .party_option_ids
        .contains(&control.menu.selected_option_id)
        && control.menu.selected_option_id.as_str() != PARTY_CANCEL_OPTION_ID
    {
        return Err(PartyMenuError::StaleMenuState);
    }
    if !is_memory_option(&control.last_left_option_id, &parts.active_option_ids, true)
        || !is_memory_option(&control.last_right_option_id, &parts.bench_option_ids, true)
    {
        return Err(PartyMenuError::StaleMenuState);
    }
    if !selected_matches_memory(
        &control.menu.selected_option_id,
        &parts.active_option_ids,
        &parts.bench_option_ids,
        &control.last_left_option_id,
        &control.last_right_option_id,
    ) {
        return Err(PartyMenuError::StaleMenuState);
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
        return Err(PartyMenuError::StaleNavigation);
    }
    Ok(parts)
}

pub(crate) fn party_column(
    option_id: &MenuOptionId,
    active_option_ids: &[MenuOptionId],
    bench_option_ids: &[MenuOptionId],
) -> PartyColumn {
    if option_id.as_str() == PARTY_CANCEL_OPTION_ID {
        PartyColumn::Cancel
    } else if active_option_ids.contains(option_id) {
        PartyColumn::Active
    } else if bench_option_ids.contains(option_id) {
        PartyColumn::Bench
    } else {
        PartyColumn::Cancel
    }
}

pub(crate) fn is_memory_option(
    option_id: &MenuOptionId,
    column_options: &[MenuOptionId],
    allow_cancel: bool,
) -> bool {
    (allow_cancel && option_id.as_str() == PARTY_CANCEL_OPTION_ID)
        || column_options.contains(option_id)
}

pub(crate) fn selected_matches_memory(
    selected_option_id: &MenuOptionId,
    active_option_ids: &[MenuOptionId],
    bench_option_ids: &[MenuOptionId],
    last_left_option_id: &MenuOptionId,
    last_right_option_id: &MenuOptionId,
) -> bool {
    if selected_option_id.as_str() == PARTY_CANCEL_OPTION_ID {
        return true;
    }
    (active_option_ids.contains(selected_option_id) && last_left_option_id == selected_option_id)
        || (bench_option_ids.contains(selected_option_id)
            && last_right_option_id == selected_option_id)
}

pub(crate) fn expected_party_control_id(
    battle: &BattleState,
    field_slot: FieldSlot,
    owner_seat: SeatId,
) -> String {
    format!(
        "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/{}",
        battle.battle_id,
        battle.wave,
        battle.turn,
        field_slot.position,
        owner_seat,
        PARTY_CONTROL_KIND,
    )
}

pub(crate) fn validate_party_inventory(battle: &BattleState) -> Result<(), PartyMenuError> {
    if battle.player_party.len() > usize::from(PartyIndex::MAX_VALUE) + 1 {
        return Err(PartyMenuError::TooManyPartyMembers);
    }
    battle
        .field
        .validate_for_format(&battle.format)
        .map_err(PartyMenuError::Field)?;

    for (index, pokemon) in battle.player_party.iter().enumerate() {
        if battle.player_party[..index]
            .iter()
            .any(|candidate| candidate.id == pokemon.id)
        {
            return Err(PartyMenuError::DuplicatePokemon {
                pokemon: pokemon.id,
            });
        }
        if battle
            .enemy_party
            .iter()
            .any(|candidate| candidate.id == pokemon.id)
        {
            return Err(PartyMenuError::DuplicatePokemon {
                pokemon: pokemon.id,
            });
        }
    }
    for entry in &battle.field.slots {
        let Some(occupant) = entry.occupant else {
            continue;
        };
        let party = match entry.slot.side {
            BattleSide::Player => &battle.player_party,
            BattleSide::Enemy => &battle.enemy_party,
        };
        if !party.iter().any(|pokemon| pokemon.id == occupant) {
            return Err(PartyMenuError::ActorNotOnField {
                actor: occupant,
                field_slot: entry.slot,
            });
        }
    }
    Ok(())
}

pub(crate) fn validate_party_context(
    battle: &BattleState,
    actor: PokemonId,
    field_slot: FieldSlot,
    owner_seat: SeatId,
) -> Result<(), PartyMenuError> {
    validate_party_inventory(battle)?;
    validate_slot(&battle.format, field_slot)?;
    if field_slot.side != BattleSide::Player {
        return Err(PartyMenuError::NonPlayerField { field_slot });
    }
    let expected = owner_seat_for(&battle.format, field_slot)?
        .ok_or(PartyMenuError::NonPlayerField { field_slot })?;
    if expected != owner_seat {
        return Err(PartyMenuError::OwnerMismatch {
            actual: owner_seat,
            expected,
            field_slot,
        });
    }
    let occupant = battle
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == field_slot)
        .and_then(|entry| entry.occupant);
    if occupant != Some(actor) {
        return Err(PartyMenuError::ActorNotOnField { actor, field_slot });
    }
    let Some(actor_state) = battle
        .player_party
        .iter()
        .find(|pokemon| pokemon.id == actor)
    else {
        return Err(PartyMenuError::ActorNotOnField { actor, field_slot });
    };
    if actor_state.owner_seat != Some(owner_seat) {
        return Err(PartyMenuError::OwnerMismatch {
            actual: owner_seat,
            expected: actor_state.owner_seat.unwrap_or(owner_seat),
            field_slot,
        });
    }
    if actor_state.fainted || actor_state.hp == 0 {
        return Err(PartyMenuError::ActorNotLiving { actor });
    }
    Ok(())
}

fn active_party_ids(battle: &BattleState) -> Vec<PokemonId> {
    battle
        .field
        .slots
        .iter()
        .filter(|entry| entry.slot.side == BattleSide::Player)
        .filter_map(|entry| entry.occupant)
        .collect()
}

fn validate_switch_cancel_parent(
    battle: &BattleState,
    actor: PokemonId,
    field_slot: FieldSlot,
    owner_seat: SeatId,
    cancel_to: &BattleControl,
) -> Result<(), PartyMenuError> {
    let BattleControl::CommandRoot(root) = cancel_to else {
        return Err(PartyMenuError::InvalidCancelParent);
    };
    if root.actor != actor
        || root.field_slot != field_slot
        || root.menu.owner_seat != owner_seat
        || root.menu.selected_option_id.as_str() != "command/switch"
    {
        return Err(PartyMenuError::InvalidCancelParent);
    }
    let expected = format!(
        "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/command",
        battle.battle_id, battle.wave, battle.turn, field_slot.position, owner_seat,
    );
    if root.menu.control_id != expected {
        return Err(PartyMenuError::InvalidCancelParent);
    }
    Ok(())
}
