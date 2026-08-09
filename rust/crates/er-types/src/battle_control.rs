//! M3A-10 owns dependency-leaf logical battle-control DTOs.

use std::collections::BTreeSet;

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::battle_ids::{
    BattleId, FaintOccurrenceId, FieldSlot, MenuInstanceId, MoveSlotIndex, PartyIndex, PokemonId,
    TurnIndex, WaveIndex,
};
use crate::battle_model::BattleOutcome;
use crate::ids::{OperationId, SafeU53, SeatId};

pub use crate::battle_ui::{
    BattleMenu, BattleMenuError, BattleMenuOption, BattleMenuOptionError, MenuNavigation,
    MenuNavigationEdge, MenuNavigationError, MenuOptionLayout, MenuOptionVisibility,
    NavigationDirection,
};

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// The frozen wire/schema version for a complete battle-control plan.
pub const BATTLE_CONTROL_PLAN_SCHEMA_VERSION: u32 = 1;

/// The maximum number of recursive `cancel_to` links retained in one control.
pub const MAX_CANCEL_HISTORY_DEPTH: usize = 3;

/// Errors raised by a logical control or its bounded restoration history.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BattleControlError {
    #[error("invalid battle menu: {0}")]
    Menu(#[from] BattleMenuError),
    #[error("target candidate vector must not be empty")]
    EmptyTargetCandidates,
    #[error("target candidate vector contains a duplicate field slot")]
    DuplicateTargetCandidate,
    #[error("target candidate vector is not in canonical field-slot order")]
    UnsortedTargetCandidates,
    #[error("remembered party option is not a visible menu option")]
    InvalidRememberedOption,
    #[error("replacement control owner_seat must equal its menu owner_seat")]
    ReplacementOwnerMismatch,
    #[error("cancel history exceeds the maximum depth of three")]
    CancelHistoryTooDeep,
    #[error("cancel history changes the battle/turn/seat/actor frontier")]
    CancelHistoryFrontierMismatch,
    #[error("waiting control must retain at least one operation identity")]
    EmptyWaitingOperations,
    #[error("waiting operation identities contain a duplicate")]
    DuplicateWaitingOperation,
    #[error("waiting operation identities are not in canonical order")]
    UnsortedWaitingOperations,
    #[error("complete control cannot carry the ongoing outcome")]
    OngoingCompleteOutcome,
}

/// A complete logical battle-control graph for one endpoint seat.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum BattleControl {
    CommandRoot(CommandRootControl),
    MoveSelect(MoveSelectControl),
    TargetSelect(TargetSelectControl),
    PartySelect(PartySelectControl),
    PartyOptionSelect(PartyOptionSelectControl),
    ReplacementSelect(ReplacementSelectControl),
    Waiting(WaitingControl),
    Complete(BattleOutcome),
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BattleControlPlanError {
    #[error("unsupported BattleControlPlan schema version {actual}; expected {expected}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("BattleControlPlan must contain at least one human seat")]
    EmptySeats,
    #[error("seat controls are not in canonical seat order")]
    UnsortedSeats,
    #[error("seat controls contain a duplicate seat")]
    DuplicateSeat,
    #[error("menu allocators are not in canonical seat order")]
    UnsortedAllocators,
    #[error("menu allocators contain a duplicate seat")]
    DuplicateAllocatorSeat,
    #[error("the plan seat vector and allocator seat vector differ")]
    SeatAllocatorMismatch,
    #[error("an actionable control must carry a decision operation identity")]
    MissingDecisionOperation,
    #[error("waiting or complete controls must not carry a decision operation identity")]
    UnexpectedDecisionOperation,
    #[error("a seat control's menu owner does not match the seat entry")]
    MenuOwnerMismatch,
    #[error("a menu instance ID is not below its owning seat's allocator high-water mark")]
    MenuInstanceAtOrAboveAllocator,
    #[error("a seat contains a duplicate menu instance ID")]
    DuplicateMenuInstance,
    #[error("invalid control: {0}")]
    Control(#[from] BattleControlError),
    #[error("invalid allocator: {0}")]
    Allocator(#[from] SeatMenuInstanceAllocatorError),
}

/// Errors raised by a per-seat menu high-water mark.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SeatMenuInstanceAllocatorError {
    #[error("menu allocator next_menu_instance_id must be greater than zero")]
    ZeroNextMenuInstanceId,
}

/// The exact next menu-instance value owned by one seat.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeatMenuInstanceAllocator {
    pub seat: SeatId,
    pub next_menu_instance_id: MenuInstanceId,
}

impl SeatMenuInstanceAllocator {
    pub fn new(
        seat: SeatId,
        next_menu_instance_id: MenuInstanceId,
    ) -> Result<Self, SeatMenuInstanceAllocatorError> {
        let value = Self {
            seat,
            next_menu_instance_id,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), SeatMenuInstanceAllocatorError> {
        if self.next_menu_instance_id.get() == SafeU53::ZERO {
            return Err(SeatMenuInstanceAllocatorError::ZeroNextMenuInstanceId);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for SeatMenuInstanceAllocator {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct SeatMenuInstanceAllocatorWire {
            seat: SeatId,
            next_menu_instance_id: MenuInstanceId,
        }

        let value = SeatMenuInstanceAllocatorWire::deserialize(deserializer)?;
        Self::new(value.seat, value.next_menu_instance_id).map_err(serde::de::Error::custom)
    }
}

/// One seat's decision operation and complete logical control.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SeatBattleControl {
    pub seat: SeatId,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub decision_operation_id: Option<OperationId>,
    pub control: BattleControl,
}

impl SeatBattleControl {
    pub fn new(
        seat: SeatId,
        decision_operation_id: Option<OperationId>,
        control: BattleControl,
    ) -> Self {
        Self {
            seat,
            decision_operation_id,
            control,
        }
    }

    pub fn validate(&self) -> Result<(), BattleControlError> {
        self.control.validate()
    }
}

/// The complete authority-issued per-seat control plan.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BattleControlPlan {
    pub schema_version: u32,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub turn: TurnIndex,
    pub seats: Vec<SeatBattleControl>,
    pub menu_allocators: Vec<SeatMenuInstanceAllocator>,
}

impl BattleControlPlan {
    /// Builds the canonical seat-sorted plan and validates all cross-field
    /// allocator, control, and menu-instance invariants.
    pub fn new(
        schema_version: u32,
        battle_id: BattleId,
        wave: WaveIndex,
        turn: TurnIndex,
        mut seats: Vec<SeatBattleControl>,
        mut menu_allocators: Vec<SeatMenuInstanceAllocator>,
    ) -> Result<Self, BattleControlPlanError> {
        seats.sort_unstable_by_key(|first| first.seat);
        menu_allocators.sort_unstable_by_key(|first| first.seat);
        let value = Self {
            schema_version,
            battle_id,
            wave,
            turn,
            seats,
            menu_allocators,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleControlPlanError> {
        if self.schema_version != BATTLE_CONTROL_PLAN_SCHEMA_VERSION {
            return Err(BattleControlPlanError::SchemaVersion {
                expected: BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.seats.is_empty() {
            return Err(BattleControlPlanError::EmptySeats);
        }

        for pair in self.seats.windows(2) {
            if pair[0].seat == pair[1].seat {
                return Err(BattleControlPlanError::DuplicateSeat);
            }
            if pair[0].seat > pair[1].seat {
                return Err(BattleControlPlanError::UnsortedSeats);
            }
        }
        for pair in self.menu_allocators.windows(2) {
            if pair[0].seat == pair[1].seat {
                return Err(BattleControlPlanError::DuplicateAllocatorSeat);
            }
            if pair[0].seat > pair[1].seat {
                return Err(BattleControlPlanError::UnsortedAllocators);
            }
        }
        if self.seats.len() != self.menu_allocators.len()
            || self
                .seats
                .iter()
                .zip(&self.menu_allocators)
                .any(|(seat, allocator)| seat.seat != allocator.seat)
        {
            return Err(BattleControlPlanError::SeatAllocatorMismatch);
        }

        for seat in &self.seats {
            seat.validate()?;
            let Some(allocator) = self
                .menu_allocators
                .binary_search_by(|candidate| candidate.seat.cmp(&seat.seat))
                .ok()
                .map(|index| &self.menu_allocators[index])
            else {
                return Err(BattleControlPlanError::SeatAllocatorMismatch);
            };
            allocator.validate()?;

            if seat.control.requires_decision_operation() != seat.decision_operation_id.is_some() {
                return if seat.control.requires_decision_operation() {
                    Err(BattleControlPlanError::MissingDecisionOperation)
                } else {
                    Err(BattleControlPlanError::UnexpectedDecisionOperation)
                };
            }
            if seat
                .control
                .owner_seat()
                .is_some_and(|owner_seat| owner_seat != seat.seat)
            {
                return Err(BattleControlPlanError::MenuOwnerMismatch);
            }

            let mut menu_ids = Vec::new();
            seat.control.menu_instance_ids(&mut menu_ids);
            let mut unique_ids = BTreeSet::new();
            for menu_id in menu_ids {
                if !unique_ids.insert(menu_id) {
                    return Err(BattleControlPlanError::DuplicateMenuInstance);
                }
                if menu_id >= allocator.next_menu_instance_id {
                    return Err(BattleControlPlanError::MenuInstanceAtOrAboveAllocator);
                }
            }
        }

        Ok(())
    }

    pub fn seat(&self, seat: SeatId) -> Option<&SeatBattleControl> {
        self.seats
            .binary_search_by(|candidate| candidate.seat.cmp(&seat))
            .ok()
            .map(|index| &self.seats[index])
    }

    pub fn allocator(&self, seat: SeatId) -> Option<&SeatMenuInstanceAllocator> {
        self.menu_allocators
            .binary_search_by(|candidate| candidate.seat.cmp(&seat))
            .ok()
            .map(|index| &self.menu_allocators[index])
    }
}

impl<'de> Deserialize<'de> for BattleControlPlan {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct BattleControlPlanWire {
            schema_version: u32,
            battle_id: BattleId,
            wave: WaveIndex,
            turn: TurnIndex,
            seats: Vec<SeatBattleControl>,
            menu_allocators: Vec<SeatMenuInstanceAllocator>,
        }

        let value = BattleControlPlanWire::deserialize(deserializer)?;
        Self::new(
            value.schema_version,
            value.battle_id,
            value.wave,
            value.turn,
            value.seats,
            value.menu_allocators,
        )
        .map_err(serde::de::Error::custom)
    }
}

/// Root Fight/Switch command control.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandRootControl {
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub menu: BattleMenu,
}

impl CommandRootControl {
    pub fn new(
        actor: PokemonId,
        field_slot: FieldSlot,
        menu: BattleMenu,
    ) -> Result<Self, BattleControlError> {
        let value = Self {
            actor,
            field_slot,
            menu,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleControlError> {
        self.menu.validate().map_err(BattleControlError::from)
    }
}

/// Four-slot move selection control with bounded restoration history.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MoveSelectControl {
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub menu: BattleMenu,
    pub cancel_to: Box<BattleControl>,
}

impl MoveSelectControl {
    pub fn new(
        actor: PokemonId,
        field_slot: FieldSlot,
        menu: BattleMenu,
        cancel_to: Box<BattleControl>,
    ) -> Result<Self, BattleControlError> {
        let value = Self {
            actor,
            field_slot,
            menu,
            cancel_to,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleControlError> {
        self.menu.validate()?;
        self.cancel_to.validate()
    }
}

/// Target selection control with a canonical candidate field-slot vector.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TargetSelectControl {
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub move_slot: MoveSlotIndex,
    pub multiple: bool,
    pub candidate_targets: Vec<FieldSlot>,
    pub menu: BattleMenu,
    pub cancel_to: Box<BattleControl>,
}

impl TargetSelectControl {
    pub fn new(
        actor: PokemonId,
        field_slot: FieldSlot,
        move_slot: MoveSlotIndex,
        multiple: bool,
        mut candidate_targets: Vec<FieldSlot>,
        menu: BattleMenu,
        cancel_to: Box<BattleControl>,
    ) -> Result<Self, BattleControlError> {
        candidate_targets.sort_unstable();
        let value = Self {
            actor,
            field_slot,
            move_slot,
            multiple,
            candidate_targets,
            menu,
            cancel_to,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleControlError> {
        validate_field_slot_vector(&self.candidate_targets)?;
        self.menu.validate()?;
        self.cancel_to.validate()
    }
}

/// Voluntary party selection control with active/bench column memory.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PartySelectControl {
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub menu: BattleMenu,
    pub last_left_option_id: crate::ids::MenuOptionId,
    pub last_right_option_id: crate::ids::MenuOptionId,
    pub cancel_to: Box<BattleControl>,
}

impl PartySelectControl {
    pub fn new(
        actor: PokemonId,
        field_slot: FieldSlot,
        menu: BattleMenu,
        last_left_option_id: crate::ids::MenuOptionId,
        last_right_option_id: crate::ids::MenuOptionId,
        cancel_to: Box<BattleControl>,
    ) -> Result<Self, BattleControlError> {
        let value = Self {
            actor,
            field_slot,
            menu,
            last_left_option_id,
            last_right_option_id,
            cancel_to,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleControlError> {
        validate_party_memory(
            &self.menu,
            &self.last_left_option_id,
            &self.last_right_option_id,
        )?;
        self.cancel_to.validate()
    }
}

/// The explicit Send Out/Cancel submenu for one selected party slot.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PartyOptionSelectControl {
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub selected_party_slot: PartyIndex,
    pub menu: BattleMenu,
    pub cancel_to: Box<BattleControl>,
}

impl PartyOptionSelectControl {
    pub fn new(
        actor: PokemonId,
        field_slot: FieldSlot,
        selected_party_slot: PartyIndex,
        menu: BattleMenu,
        cancel_to: Box<BattleControl>,
    ) -> Result<Self, BattleControlError> {
        let value = Self {
            actor,
            field_slot,
            selected_party_slot,
            menu,
            cancel_to,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleControlError> {
        self.menu.validate()?;
        self.cancel_to.validate()
    }
}

/// Forced replacement selection for one exact faint occurrence.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplacementSelectControl {
    pub occurrence: FaintOccurrenceId,
    pub field_slot: FieldSlot,
    pub owner_seat: SeatId,
    pub menu: BattleMenu,
    pub last_left_option_id: crate::ids::MenuOptionId,
    pub last_right_option_id: crate::ids::MenuOptionId,
}

impl ReplacementSelectControl {
    pub fn new(
        occurrence: FaintOccurrenceId,
        field_slot: FieldSlot,
        owner_seat: SeatId,
        menu: BattleMenu,
        last_left_option_id: crate::ids::MenuOptionId,
        last_right_option_id: crate::ids::MenuOptionId,
    ) -> Result<Self, BattleControlError> {
        let value = Self {
            occurrence,
            field_slot,
            owner_seat,
            menu,
            last_left_option_id,
            last_right_option_id,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleControlError> {
        if self.owner_seat != self.menu.owner_seat {
            return Err(BattleControlError::ReplacementOwnerMismatch);
        }
        validate_party_memory(
            &self.menu,
            &self.last_left_option_id,
            &self.last_right_option_id,
        )
    }
}

impl<'de> Deserialize<'de> for MoveSelectControl {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct MoveSelectControlWire {
            actor: PokemonId,
            field_slot: FieldSlot,
            menu: BattleMenu,
            cancel_to: Box<BattleControl>,
        }

        let value = MoveSelectControlWire::deserialize(deserializer)?;
        Self::new(value.actor, value.field_slot, value.menu, value.cancel_to)
            .map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for TargetSelectControl {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct TargetSelectControlWire {
            actor: PokemonId,
            field_slot: FieldSlot,
            move_slot: MoveSlotIndex,
            multiple: bool,
            candidate_targets: Vec<FieldSlot>,
            menu: BattleMenu,
            cancel_to: Box<BattleControl>,
        }

        let value = TargetSelectControlWire::deserialize(deserializer)?;
        Self::new(
            value.actor,
            value.field_slot,
            value.move_slot,
            value.multiple,
            value.candidate_targets,
            value.menu,
            value.cancel_to,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for PartySelectControl {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct PartySelectControlWire {
            actor: PokemonId,
            field_slot: FieldSlot,
            menu: BattleMenu,
            last_left_option_id: crate::ids::MenuOptionId,
            last_right_option_id: crate::ids::MenuOptionId,
            cancel_to: Box<BattleControl>,
        }

        let value = PartySelectControlWire::deserialize(deserializer)?;
        Self::new(
            value.actor,
            value.field_slot,
            value.menu,
            value.last_left_option_id,
            value.last_right_option_id,
            value.cancel_to,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for PartyOptionSelectControl {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct PartyOptionSelectControlWire {
            actor: PokemonId,
            field_slot: FieldSlot,
            selected_party_slot: PartyIndex,
            menu: BattleMenu,
            cancel_to: Box<BattleControl>,
        }

        let value = PartyOptionSelectControlWire::deserialize(deserializer)?;
        Self::new(
            value.actor,
            value.field_slot,
            value.selected_party_slot,
            value.menu,
            value.cancel_to,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for ReplacementSelectControl {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct ReplacementSelectControlWire {
            occurrence: FaintOccurrenceId,
            field_slot: FieldSlot,
            owner_seat: SeatId,
            menu: BattleMenu,
            last_left_option_id: crate::ids::MenuOptionId,
            last_right_option_id: crate::ids::MenuOptionId,
        }

        let value = ReplacementSelectControlWire::deserialize(deserializer)?;
        Self::new(
            value.occurrence,
            value.field_slot,
            value.owner_seat,
            value.menu,
            value.last_left_option_id,
            value.last_right_option_id,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for WaitingControl {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct WaitingControlWire {
            reason: WaitingReason,
            operation_ids: Vec<OperationId>,
        }

        let value = WaitingControlWire::deserialize(deserializer)?;
        Self::new(value.reason, value.operation_ids).map_err(serde::de::Error::custom)
    }
}

/// A non-actionable control waiting for one or more exact operation IDs.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WaitingControl {
    pub reason: WaitingReason,
    pub operation_ids: Vec<OperationId>,
}

impl WaitingControl {
    pub fn new(
        reason: WaitingReason,
        mut operation_ids: Vec<OperationId>,
    ) -> Result<Self, BattleControlError> {
        operation_ids.sort_unstable();
        let value = Self {
            reason,
            operation_ids,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleControlError> {
        if self.operation_ids.is_empty() {
            return Err(BattleControlError::EmptyWaitingOperations);
        }
        for pair in self.operation_ids.windows(2) {
            if pair[0] == pair[1] {
                return Err(BattleControlError::DuplicateWaitingOperation);
            }
            if pair[0] > pair[1] {
                return Err(BattleControlError::UnsortedWaitingOperations);
            }
        }
        Ok(())
    }
}

/// The closed reasons for a non-actionable waiting control.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WaitingReason {
    PartnerCommand,
    AuthorityEntry,
    ReplacementOwner,
    RecoveryFence,
}

impl BattleControl {
    pub fn validate(&self) -> Result<(), BattleControlError> {
        self.validate_at_depth(0, None)
    }

    pub fn owner_seat(&self) -> Option<SeatId> {
        match self {
            Self::CommandRoot(value) => Some(value.menu.owner_seat),
            Self::MoveSelect(value) => Some(value.menu.owner_seat),
            Self::TargetSelect(value) => Some(value.menu.owner_seat),
            Self::PartySelect(value) => Some(value.menu.owner_seat),
            Self::PartyOptionSelect(value) => Some(value.menu.owner_seat),
            Self::ReplacementSelect(value) => Some(value.owner_seat),
            Self::Waiting(_) | Self::Complete(_) => None,
        }
    }

    pub const fn requires_decision_operation(&self) -> bool {
        !matches!(self, Self::Waiting(_) | Self::Complete(_))
    }

    pub const fn is_actionable(&self) -> bool {
        self.requires_decision_operation()
    }

    pub fn complete(outcome: BattleOutcome) -> Result<Self, BattleControlError> {
        if outcome == BattleOutcome::Ongoing {
            return Err(BattleControlError::OngoingCompleteOutcome);
        }
        Ok(Self::Complete(outcome))
    }

    fn validate_at_depth(
        &self,
        depth: usize,
        parent_frontier: Option<&ControlFrontier>,
    ) -> Result<(), BattleControlError> {
        match self {
            Self::CommandRoot(value) => value.validate_basic()?,
            Self::MoveSelect(value) => value.validate_basic()?,
            Self::TargetSelect(value) => value.validate_basic()?,
            Self::PartySelect(value) => value.validate_basic()?,
            Self::PartyOptionSelect(value) => value.validate_basic()?,
            Self::ReplacementSelect(value) => value.validate_basic()?,
            Self::Waiting(value) => {
                value.validate()?;
                if parent_frontier.is_some() {
                    return Err(BattleControlError::CancelHistoryFrontierMismatch);
                }
                return Ok(());
            }
            Self::Complete(outcome) => {
                if *outcome == BattleOutcome::Ongoing {
                    return Err(BattleControlError::OngoingCompleteOutcome);
                }
                if parent_frontier.is_some() {
                    return Err(BattleControlError::CancelHistoryFrontierMismatch);
                }
                return Ok(());
            }
        }

        let frontier = self.control_frontier();
        if parent_frontier.is_some_and(|parent| frontier.as_ref() != Some(parent)) {
            return Err(BattleControlError::CancelHistoryFrontierMismatch);
        }
        let Some(cancel_to) = self.cancel_to() else {
            return Ok(());
        };
        if depth >= MAX_CANCEL_HISTORY_DEPTH {
            return Err(BattleControlError::CancelHistoryTooDeep);
        }
        cancel_to.validate_at_depth(depth + 1, frontier.as_ref())
    }

    fn control_frontier(&self) -> Option<ControlFrontier> {
        let (menu, actor) = match self {
            Self::CommandRoot(value) => (&value.menu, Some(value.actor)),
            Self::MoveSelect(value) => (&value.menu, Some(value.actor)),
            Self::TargetSelect(value) => (&value.menu, Some(value.actor)),
            Self::PartySelect(value) => (&value.menu, Some(value.actor)),
            Self::PartyOptionSelect(value) => (&value.menu, Some(value.actor)),
            Self::ReplacementSelect(value) => (&value.menu, None),
            Self::Waiting(_) | Self::Complete(_) => return None,
        };
        Some(ControlFrontier {
            owner_seat: menu.owner_seat,
            actor,
            stable_control_prefix: stable_control_prefix(&menu.control_id),
        })
    }

    fn cancel_to(&self) -> Option<&BattleControl> {
        match self {
            Self::MoveSelect(value) => Some(&value.cancel_to),
            Self::TargetSelect(value) => Some(&value.cancel_to),
            Self::PartySelect(value) => Some(&value.cancel_to),
            Self::PartyOptionSelect(value) => Some(&value.cancel_to),
            Self::CommandRoot(_)
            | Self::ReplacementSelect(_)
            | Self::Waiting(_)
            | Self::Complete(_) => None,
        }
    }

    fn menu_instance_ids(&self, ids: &mut Vec<MenuInstanceId>) {
        match self {
            Self::CommandRoot(value) => ids.push(value.menu.instance_id),
            Self::MoveSelect(value) => {
                ids.push(value.menu.instance_id);
                value.cancel_to.menu_instance_ids(ids);
            }
            Self::TargetSelect(value) => {
                ids.push(value.menu.instance_id);
                value.cancel_to.menu_instance_ids(ids);
            }
            Self::PartySelect(value) => {
                ids.push(value.menu.instance_id);
                value.cancel_to.menu_instance_ids(ids);
            }
            Self::PartyOptionSelect(value) => {
                ids.push(value.menu.instance_id);
                value.cancel_to.menu_instance_ids(ids);
            }
            Self::ReplacementSelect(value) => ids.push(value.menu.instance_id),
            Self::Waiting(_) | Self::Complete(_) => {}
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ControlFrontier {
    owner_seat: SeatId,
    actor: Option<PokemonId>,
    stable_control_prefix: String,
}

fn stable_control_prefix(control_id: &str) -> String {
    control_id
        .split_once("/control/")
        .map_or_else(|| control_id.to_owned(), |(prefix, _)| prefix.to_owned())
}

fn validate_field_slot_vector(candidates: &[FieldSlot]) -> Result<(), BattleControlError> {
    if candidates.is_empty() {
        return Err(BattleControlError::EmptyTargetCandidates);
    }
    for pair in candidates.windows(2) {
        if pair[0] == pair[1] {
            return Err(BattleControlError::DuplicateTargetCandidate);
        }
        if pair[0] > pair[1] {
            return Err(BattleControlError::UnsortedTargetCandidates);
        }
    }
    Ok(())
}

fn validate_party_memory(
    menu: &BattleMenu,
    last_left_option_id: &crate::ids::MenuOptionId,
    last_right_option_id: &crate::ids::MenuOptionId,
) -> Result<(), BattleControlError> {
    menu.validate()?;
    if !menu.is_visible(last_left_option_id) || !menu.is_visible(last_right_option_id) {
        return Err(BattleControlError::InvalidRememberedOption);
    }
    Ok(())
}

impl<'de> Deserialize<'de> for BattleControl {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(
            tag = "kind",
            content = "value",
            rename_all = "SCREAMING_SNAKE_CASE",
            deny_unknown_fields
        )]
        enum BattleControlWire {
            CommandRoot(CommandRootControl),
            MoveSelect(MoveSelectControl),
            TargetSelect(TargetSelectControl),
            PartySelect(PartySelectControl),
            PartyOptionSelect(PartyOptionSelectControl),
            ReplacementSelect(ReplacementSelectControl),
            Waiting(WaitingControl),
            Complete(BattleOutcome),
        }

        let value = match BattleControlWire::deserialize(deserializer)? {
            BattleControlWire::CommandRoot(value) => Self::CommandRoot(value),
            BattleControlWire::MoveSelect(value) => Self::MoveSelect(value),
            BattleControlWire::TargetSelect(value) => Self::TargetSelect(value),
            BattleControlWire::PartySelect(value) => Self::PartySelect(value),
            BattleControlWire::PartyOptionSelect(value) => Self::PartyOptionSelect(value),
            BattleControlWire::ReplacementSelect(value) => Self::ReplacementSelect(value),
            BattleControlWire::Waiting(value) => Self::Waiting(value),
            BattleControlWire::Complete(value) => Self::Complete(value),
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

impl CommandRootControl {
    fn validate_basic(&self) -> Result<(), BattleControlError> {
        self.validate()
    }
}

impl MoveSelectControl {
    fn validate_basic(&self) -> Result<(), BattleControlError> {
        self.menu.validate().map_err(BattleControlError::from)
    }
}

impl TargetSelectControl {
    fn validate_basic(&self) -> Result<(), BattleControlError> {
        validate_field_slot_vector(&self.candidate_targets)?;
        self.menu.validate().map_err(BattleControlError::from)
    }
}

impl PartySelectControl {
    fn validate_basic(&self) -> Result<(), BattleControlError> {
        validate_party_memory(
            &self.menu,
            &self.last_left_option_id,
            &self.last_right_option_id,
        )
    }
}

impl PartyOptionSelectControl {
    fn validate_basic(&self) -> Result<(), BattleControlError> {
        self.menu.validate().map_err(BattleControlError::from)
    }
}

impl ReplacementSelectControl {
    fn validate_basic(&self) -> Result<(), BattleControlError> {
        self.validate()
    }
}

#[cfg(test)]
mod tests {
    use std::error::Error;

    use super::*;
    use crate::battle_ids::{BattleSide, MenuInstanceId};
    use crate::ids::{MenuOptionId, OperationId, SafeU53, SeatId};

    fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
        Ok(SafeU53::new(value)?)
    }

    fn menu(instance_id: u64, control_id: &str) -> Result<BattleMenu, Box<dyn Error>> {
        let option_id = MenuOptionId::new("command/fight")?;
        let option = BattleMenuOption::new(
            option_id.clone(),
            "menu.fight",
            MenuOptionVisibility::Visible,
            true,
            MenuOptionLayout::new(option_id.clone(), 0, 0, 0),
        )?;
        Ok(BattleMenu::new(
            MenuInstanceId::new(safe(instance_id)?),
            SeatId::new(safe(1)?),
            control_id,
            option_id,
            vec![option],
            Vec::new(),
        )?)
    }

    fn root(instance_id: u64, control_id: &str) -> Result<BattleControl, Box<dyn Error>> {
        Ok(BattleControl::CommandRoot(CommandRootControl::new(
            PokemonId::new(safe(7)?),
            FieldSlot {
                side: BattleSide::Player,
                position: 0,
            },
            menu(instance_id, control_id)?,
        )?))
    }

    fn move_control(
        instance_id: u64,
        control_id: &str,
        cancel_to: BattleControl,
    ) -> Result<BattleControl, Box<dyn Error>> {
        Ok(BattleControl::MoveSelect(MoveSelectControl::new(
            PokemonId::new(safe(7)?),
            FieldSlot {
                side: BattleSide::Player,
                position: 0,
            },
            menu(instance_id, control_id)?,
            Box::new(cancel_to),
        )?))
    }

    fn plan(
        control: BattleControl,
        next_menu_instance_id: u64,
    ) -> Result<BattleControlPlan, BattleControlPlanError> {
        BattleControlPlan::new(
            BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
            BattleId::new(SafeU53::new(1).expect("test ID is safe")),
            WaveIndex::new(SafeU53::new(1).expect("test index is safe"))
                .expect("test wave is positive"),
            TurnIndex::new(SafeU53::new(1).expect("test index is safe"))
                .expect("test turn is positive"),
            vec![SeatBattleControl::new(
                SeatId::new(SafeU53::new(1).expect("test seat is safe")),
                if control.requires_decision_operation() {
                    Some(
                        OperationId::new("turn/e1/w1/t1/command/player/0")
                            .expect("test operation ID is non-empty"),
                    )
                } else {
                    None
                },
                control,
            )],
            vec![
                SeatMenuInstanceAllocator::new(
                    SeatId::new(SafeU53::new(1).expect("test seat is safe")),
                    MenuInstanceId::new(
                        SafeU53::new(next_menu_instance_id).expect("test allocator is safe"),
                    ),
                )
                .expect("test allocator is positive"),
            ],
        )
    }

    #[test]
    fn plan_is_complete_per_seat_and_checks_allocator_high_water() -> Result<(), Box<dyn Error>> {
        let control_plan = plan(
            root(1, "battle/1/wave/1/turn/1/control/player/0/seat/1/command")?,
            2,
        )?;
        assert_eq!(control_plan.seats.len(), 1);
        assert_eq!(control_plan.menu_allocators.len(), 1);
        assert!(control_plan.seat(SeatId::new(safe(1)?)).is_some());
        assert!(control_plan.allocator(SeatId::new(safe(1)?)).is_some());
        assert!(matches!(
            plan(
                root(2, "battle/1/wave/1/turn/1/control/player/0/seat/1/command")?,
                2
            )
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn cancel_history_is_bounded_and_same_frontier() -> Result<(), Box<dyn Error>> {
        let control_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/move";
        let first = move_control(
            2,
            control_id,
            root(1, "battle/1/wave/1/turn/1/control/player/0/seat/1/command")?,
        )?;
        let second = move_control(3, control_id, first)?;
        let third = move_control(4, control_id, second)?;
        assert!(plan(third.clone(), 5).is_ok());

        let too_deep = move_control(5, control_id, third)?;
        assert!(matches!(
            plan(too_deep, 6),
            Err(BattleControlPlanError::Control(
                BattleControlError::CancelHistoryTooDeep
            ))
        ));

        let mismatched = move_control(
            2,
            "battle/2/wave/1/turn/1/control/player/0/seat/1/move",
            root(1, "battle/1/wave/1/turn/1/control/player/0/seat/1/command")?,
        )?;
        assert!(matches!(
            plan(mismatched, 3),
            Err(BattleControlPlanError::Control(
                BattleControlError::CancelHistoryFrontierMismatch
            ))
        ));
        Ok(())
    }

    #[test]
    fn waiting_and_complete_controls_are_closed() -> Result<(), Box<dyn Error>> {
        let waiting = WaitingControl::new(
            WaitingReason::PartnerCommand,
            vec![OperationId::new("turn/e1/w1/t1/command/player/0")?],
        )?;
        let waiting_plan = plan(BattleControl::Waiting(waiting), 1)?;
        assert!(waiting_plan.seats[0].decision_operation_id.is_none());
        assert!(matches!(
            BattleControl::complete(BattleOutcome::Ongoing),
            Err(BattleControlError::OngoingCompleteOutcome)
        ));
        assert!(
            serde_json::from_str::<BattleControl>(
                r#"{"kind":"COMPLETE","value":"VICTORY","extra":true}"#
            )
            .is_err()
        );
        Ok(())
    }
}
