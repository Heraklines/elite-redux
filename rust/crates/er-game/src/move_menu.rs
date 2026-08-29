//! Construction and selection of the exact four-slot M3 move graph.
//!
//! Move legality is supplied by the battle offer.  This module projects that
//! already typed evidence into four visible cells and classifies an accepted
//! move cursor as either an implicit submission or a target-selector route.
//! It never creates an operation ID or a command proposal.

use er_types::battle_command::{BattleCommandError, BattleTargetSelection, OfferedMoveCommand};
use er_types::battle_control::{BattleControl, BattleControlError, MoveSelectControl};
use er_types::battle_ids::{
    BattleSide, FieldSlot, MenuInstanceId, MoveId, MoveSlotIndex, PokemonId,
};
use er_types::battle_ui::{
    BattleMenu, BattleMenuError, BattleMenuOption, MenuNavigationEdge, MenuOptionLayout,
    MenuOptionVisibility, NavigationDirection,
};
use er_types::ids::{MenuOptionId, SeatId, StringIdError};
use thiserror::Error;

/// M3 always renders exactly four move cells.
pub const MOVE_SLOT_COUNT: usize = 4;

/// One rendered move cell and its retained legal-target evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MoveMenuEntry {
    pub move_id: Option<MoveId>,
    pub enabled: bool,
    pub legal_targets: Vec<BattleTargetSelection>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum MoveMenuEntryError {
    #[error("an empty move cell cannot be enabled")]
    EnabledEmptyCell,
    #[error("an enabled move cell must retain at least one legal target selection")]
    EnabledWithoutTargets,
    #[error("a move cell's target evidence is invalid: {0}")]
    InvalidTargetEvidence(#[from] BattleCommandError),
    #[error("an empty move cell cannot retain target evidence")]
    EmptyCellWithTargets,
}

impl MoveMenuEntry {
    /// Construct a cell from the current offer/PP projection.
    pub fn new(
        move_id: Option<MoveId>,
        enabled: bool,
        legal_targets: Vec<BattleTargetSelection>,
    ) -> Result<Self, MoveMenuEntryError> {
        let value = Self {
            move_id,
            enabled,
            legal_targets,
        };
        value.validate()?;
        Ok(value)
    }

    /// A visible empty placeholder.  Empty cells are disabled but remain in
    /// the graph and therefore remain navigation endpoints.
    pub const fn empty() -> Self {
        Self {
            move_id: None,
            enabled: false,
            legal_targets: Vec::new(),
        }
    }

    /// A present move that is visible but not selectable, for example a move
    /// with zero usable PP.
    pub const fn disabled(move_id: MoveId) -> Self {
        Self {
            move_id: Some(move_id),
            enabled: false,
            legal_targets: Vec::new(),
        }
    }

    /// A selectable move backed by one or more exact legal target selections.
    pub fn enabled(
        move_id: MoveId,
        legal_targets: Vec<BattleTargetSelection>,
    ) -> Result<Self, MoveMenuEntryError> {
        Self::new(Some(move_id), true, legal_targets)
    }

    /// Build a selectable cell directly from one retained legal offer.
    pub fn from_offer(
        move_id: MoveId,
        offer: &OfferedMoveCommand,
    ) -> Result<Self, MoveMenuEntryError> {
        Self::enabled(move_id, offer.legal_targets.clone())
    }

    pub fn validate(&self) -> Result<(), MoveMenuEntryError> {
        if self.move_id.is_none() {
            if self.enabled {
                return Err(MoveMenuEntryError::EnabledEmptyCell);
            }
            if !self.legal_targets.is_empty() {
                return Err(MoveMenuEntryError::EmptyCellWithTargets);
            }
        }
        if self.enabled && self.legal_targets.is_empty() {
            return Err(MoveMenuEntryError::EnabledWithoutTargets);
        }
        for target in &self.legal_targets {
            target.validate()?;
        }
        if !self.legal_targets.is_empty() {
            // OfferedMoveCommand owns the canonical ordering and duplicate
            // checks for alternatives.  The slot value is irrelevant here;
            // the target evidence rules are the same for every slot.
            OfferedMoveCommand::new(MoveSlotIndex::ZERO, self.legal_targets.clone())?;
        }
        Ok(())
    }
}

/// A selection route after a stable move option has been checked.
///
/// The route carries only typed move/target evidence.  The runtime still owns
/// construction of the operation-scoped `BattleCommand` and proposal.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MoveActivation {
    Immediate {
        move_slot: MoveSlotIndex,
        targets: BattleTargetSelection,
    },
    TargetSelect {
        move_slot: MoveSlotIndex,
        multiple: bool,
        candidate_targets: Vec<FieldSlot>,
    },
}

/// Fail-closed menu construction failures.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum MoveMenuError {
    #[error("menu option identity is invalid: {0}")]
    OptionId(#[from] StringIdError),
    #[error("move menu entry is invalid: {0}")]
    Entry(#[from] MoveMenuEntryError),
    #[error("move menu is invalid: {0}")]
    Menu(#[from] BattleMenuError),
    #[error("move control is invalid: {0}")]
    Control(#[from] BattleControlError),
    #[error("the move actor field slot must be player-side")]
    NonPlayerFieldSlot,
    #[error("move slot {value} is outside the frozen four-slot graph")]
    InvalidSlot { value: u8 },
}

/// Failures while activating the current move cursor.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum MoveSelectionError {
    #[error("menu option identity is invalid: {0}")]
    OptionId(#[from] StringIdError),
    #[error("move menu entry is invalid: {0}")]
    Entry(#[from] MoveMenuEntryError),
    #[error("move target evidence is invalid: {0}")]
    TargetEvidence(#[from] BattleCommandError),
    #[error("the selected option is not one of this actor's four move identities")]
    StaleSelection,
    #[error("the selected move cell is empty")]
    EmptyMove,
    #[error("the selected move cell is disabled")]
    DisabledMove,
    #[error("the move menu has no legal option; the caller must take the internal no-legal path")]
    NoLegalOption,
    #[error("the selected move has no legal target route")]
    NoLegalTarget,
    #[error("the selected move's legal target alternatives are not a supported M3 shape")]
    UnsupportedTargetShape,
    #[error("the selected move's target alternatives contain a duplicate candidate")]
    DuplicateTargetCandidate,
    #[error("move slot {value} is outside the frozen four-slot graph")]
    InvalidSlot { value: u8 },
}

/// Construct the frozen stable ID for one actor/slot pair.
pub fn move_option_id(
    actor: PokemonId,
    move_slot: MoveSlotIndex,
) -> Result<MenuOptionId, StringIdError> {
    MenuOptionId::new(format!("move/{}/slot/{}", actor, move_slot.get()))
}

/// The eight explicit edges in the four-cell move graph.
const MOVE_EDGES: [(u8, NavigationDirection, u8); 8] = [
    (0, NavigationDirection::Right, 1),
    (0, NavigationDirection::Down, 2),
    (1, NavigationDirection::Left, 0),
    (1, NavigationDirection::Down, 3),
    (2, NavigationDirection::Up, 0),
    (2, NavigationDirection::Right, 3),
    (3, NavigationDirection::Up, 1),
    (3, NavigationDirection::Left, 2),
];

fn slot_index(value: u8) -> Result<MoveSlotIndex, MoveMenuError> {
    MoveSlotIndex::new(value).map_err(|_| MoveMenuError::InvalidSlot { value })
}

fn selection_slot_index(value: u8) -> Result<MoveSlotIndex, MoveSelectionError> {
    MoveSlotIndex::new(value).map_err(|_| MoveSelectionError::InvalidSlot { value })
}

fn selected_slot(
    entries: &[MoveMenuEntry; MOVE_SLOT_COUNT],
    remembered_slot: Option<MoveSlotIndex>,
    first_summon: bool,
) -> MoveSlotIndex {
    if first_summon {
        return MoveSlotIndex::ZERO;
    }
    remembered_slot
        .filter(|slot| entries[usize::from(slot.get())].move_id.is_some())
        .unwrap_or(MoveSlotIndex::ZERO)
}

/// Build the exact four visible move cells and their no-wrap adjacency graph.
pub fn build_move_menu(
    instance_id: MenuInstanceId,
    owner_seat: SeatId,
    control_id: impl Into<String>,
    actor: PokemonId,
    entries: &[MoveMenuEntry; MOVE_SLOT_COUNT],
    remembered_slot: Option<MoveSlotIndex>,
    first_summon: bool,
) -> Result<BattleMenu, MoveMenuError> {
    for entry in entries {
        entry.validate()?;
    }

    let options = (0_u8..4)
        .map(|raw_slot| {
            let move_slot = slot_index(raw_slot)?;
            let option_id = move_option_id(actor, move_slot)?;
            let label_key = format!("label.{option_id}");
            Ok(BattleMenuOption::new(
                option_id.clone(),
                label_key,
                MenuOptionVisibility::Visible,
                entries[usize::from(raw_slot)].enabled,
                MenuOptionLayout::new(
                    option_id,
                    u16::from(raw_slot / 2),
                    u16::from(raw_slot % 2),
                    0,
                ),
            )
            .map_err(BattleMenuError::from)?)
        })
        .collect::<Result<Vec<_>, MoveMenuError>>()?;

    let mut navigation = Vec::with_capacity(MOVE_EDGES.len());
    for (from_raw, direction, to_raw) in MOVE_EDGES {
        navigation.push(MenuNavigationEdge::new(
            move_option_id(actor, slot_index(from_raw)?)?,
            direction,
            move_option_id(actor, slot_index(to_raw)?)?,
        ));
    }

    let selected_option_id =
        move_option_id(actor, selected_slot(entries, remembered_slot, first_summon))?;
    Ok(BattleMenu::new(
        instance_id,
        owner_seat,
        control_id,
        selected_option_id,
        options,
        navigation,
    )?)
}

/// Build a move control while retaining the exact previous command root for
/// M3 Cancel restoration.  `MoveSelectControl::new` performs the parent-shape,
/// actor, field, and selected-Fight checks.
#[allow(clippy::too_many_arguments)]
pub fn build_move_control(
    instance_id: MenuInstanceId,
    owner_seat: SeatId,
    control_id: impl Into<String>,
    actor: PokemonId,
    field_slot: FieldSlot,
    entries: &[MoveMenuEntry; MOVE_SLOT_COUNT],
    remembered_slot: Option<MoveSlotIndex>,
    first_summon: bool,
    cancel_to: BattleControl,
) -> Result<MoveSelectControl, MoveMenuError> {
    if field_slot.side != BattleSide::Player {
        return Err(MoveMenuError::NonPlayerFieldSlot);
    }
    let menu = build_move_menu(
        instance_id,
        owner_seat,
        control_id,
        actor,
        entries,
        remembered_slot,
        first_summon,
    )?;
    Ok(MoveSelectControl::new(
        actor,
        field_slot,
        menu,
        Box::new(cancel_to),
    )?)
}

/// Classify the current move selection without constructing a semantic
/// command.  Empty/disabled cells are rejected instead of being skipped.
pub fn select_move(
    menu: &BattleMenu,
    actor: PokemonId,
    entries: &[MoveMenuEntry; MOVE_SLOT_COUNT],
) -> Result<MoveActivation, MoveSelectionError> {
    for entry in entries {
        entry.validate()?;
    }
    if entries.iter().all(|entry| !entry.enabled) {
        return Err(MoveSelectionError::NoLegalOption);
    }

    let mut selected = None;
    for raw_slot in 0_u8..4 {
        let move_slot = selection_slot_index(raw_slot)?;
        if menu.selected_option_id == move_option_id(actor, move_slot)? {
            selected = Some(move_slot);
            break;
        }
    }
    let Some(move_slot) = selected else {
        return Err(MoveSelectionError::StaleSelection);
    };

    let Some(option) = menu.option(menu.selected_option_id.clone()) else {
        return Err(MoveSelectionError::StaleSelection);
    };
    if !option.visibility.is_visible() {
        return Err(MoveSelectionError::StaleSelection);
    }

    let entry = &entries[usize::from(move_slot.get())];
    if entry.move_id.is_none() {
        return Err(MoveSelectionError::EmptyMove);
    }
    if !entry.enabled || !option.enabled {
        return Err(MoveSelectionError::DisabledMove);
    }
    activation_from_targets(move_slot, &entry.legal_targets)
}

fn activation_from_targets(
    move_slot: MoveSlotIndex,
    legal_targets: &[BattleTargetSelection],
) -> Result<MoveActivation, MoveSelectionError> {
    if legal_targets.is_empty() {
        return Err(MoveSelectionError::NoLegalTarget);
    }
    for target in legal_targets {
        target.validate()?;
    }
    if legal_targets.len() == 1 {
        return match &legal_targets[0] {
            BattleTargetSelection::Implicit => Ok(MoveActivation::Immediate {
                move_slot,
                targets: BattleTargetSelection::Implicit,
            }),
            BattleTargetSelection::Selected(targets) => Ok(MoveActivation::TargetSelect {
                move_slot,
                multiple: targets.len() > 1,
                candidate_targets: targets.clone(),
            }),
        };
    }

    let mut candidates = Vec::with_capacity(legal_targets.len());
    for target in legal_targets {
        let BattleTargetSelection::Selected(targets) = target else {
            return Err(MoveSelectionError::UnsupportedTargetShape);
        };
        if targets.len() != 1 {
            return Err(MoveSelectionError::UnsupportedTargetShape);
        }
        candidates.push(targets[0]);
    }
    candidates.sort_unstable();
    for pair in candidates.windows(2) {
        if pair[0] == pair[1] {
            return Err(MoveSelectionError::DuplicateTargetCandidate);
        }
    }
    Ok(MoveActivation::TargetSelect {
        move_slot,
        multiple: false,
        candidate_targets: candidates,
    })
}
