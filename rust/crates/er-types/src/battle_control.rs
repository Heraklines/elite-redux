//! M3A-10 owns dependency-leaf logical battle-control DTOs.

use std::collections::BTreeSet;

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::battle_ids::{
    BattleId, FaintOccurrenceId, FieldSlot, MenuInstanceId, MoveSlotIndex, PartyIndex, PokemonId,
    TurnIndex, WaveIndex,
};
use crate::battle_model::{BattleOutcome, FaintSource};
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
    #[error("invalid cancel restoration: {0}")]
    CancelRestoration(#[from] CancelRestorationError),
    #[error("waiting control must retain at least one operation identity")]
    EmptyWaitingOperations,
    #[error("waiting operation identities contain a duplicate")]
    DuplicateWaitingOperation,
    #[error("waiting operation identities are not in canonical order")]
    UnsortedWaitingOperations,
    #[error("complete control cannot carry the ongoing outcome")]
    OngoingCompleteOutcome,
    #[error("battle control_id does not match its contextual identity")]
    ControlIdMismatch,
    #[error("decision operation_id does not match its contextual identity")]
    DecisionOperationIdMismatch,
    #[error("command control field_slot must be player-side")]
    CommandFieldMustBePlayer,
    #[error("replacement control field_slot must be player-side")]
    ReplacementFieldMustBePlayer,
    #[error("replacement source wave does not match the plan/projection wave")]
    ReplacementSourceWaveMismatch,
    #[error("replacement source resolved_turn does not match the plan/projection turn")]
    ReplacementSourceTurnMismatch,
    #[error("replacement owner and menu owner must match the plan/projection seat")]
    ReplacementSeatMismatch,
}

/// Closed failures for the frozen per-control Cancel restoration graph.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum CancelRestorationError {
    #[error("TargetSelect cancel restoration must reference MoveSelect")]
    TargetSelectRequiresMoveSelect,
    #[error("MoveSelect cancel restoration must reference CommandRoot")]
    MoveSelectRequiresCommandRoot,
    #[error("PartySelect cancel restoration must reference CommandRoot")]
    PartySelectRequiresCommandRoot,
    #[error("PartyOptionSelect cancel restoration must reference PartySelect or ReplacementSelect")]
    PartyOptionSelectRequiresPartyOrReplacement,
    #[error("cancel restoration changes the owning seat")]
    OwnerSeatMismatch,
    #[error("cancel restoration changes the actor")]
    ActorMismatch,
    #[error("cancel restoration changes the field slot")]
    FieldSlotMismatch,
    #[error("cancel restoration changes the stable battle/wave/turn control coordinates")]
    StableCoordinatesMismatch,
    #[error("TargetSelect cancel restoration does not retain its selected move")]
    TargetSelectedMoveMismatch,
    #[error("MoveSelect cancel restoration does not restore selected Fight")]
    CommandFightNotSelected,
    #[error("PartySelect cancel restoration does not restore selected Switch")]
    CommandSwitchNotSelected,
    #[error("PartyOptionSelect cancel restoration does not retain its selected party slot")]
    PartyOptionSelectedSlotMismatch,
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
            seat.control.validate_control_ids(
                self.battle_id,
                self.wave,
                self.turn,
                seat.seat,
                seat.decision_operation_id.as_ref(),
            )?;

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
        self.validate_basic()?;
        self.validate_cancel_at_depth(0)
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
        self.validate_basic()?;
        self.validate_cancel_at_depth(0)
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
        self.validate_basic()?;
        self.validate_cancel_at_depth(0)
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
        self.validate_basic()?;
        self.validate_cancel_at_depth(0)
    }
}

/// Forced replacement selection for one exact faint occurrence.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplacementSelectControl {
    pub occurrence: FaintOccurrenceId,
    pub source: FaintSource,
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub owner_seat: SeatId,
    pub menu: BattleMenu,
    pub last_left_option_id: crate::ids::MenuOptionId,
    pub last_right_option_id: crate::ids::MenuOptionId,
}

impl ReplacementSelectControl {
    // The frozen replacement-control schema carries eight independent identity,
    // topology, ownership, menu, and navigation-memory fields.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        occurrence: FaintOccurrenceId,
        source: FaintSource,
        actor: PokemonId,
        field_slot: FieldSlot,
        owner_seat: SeatId,
        menu: BattleMenu,
        last_left_option_id: crate::ids::MenuOptionId,
        last_right_option_id: crate::ids::MenuOptionId,
    ) -> Result<Self, BattleControlError> {
        let value = Self {
            occurrence,
            source,
            actor,
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
            source: FaintSource,
            actor: PokemonId,
            field_slot: FieldSlot,
            owner_seat: SeatId,
            menu: BattleMenu,
            last_left_option_id: crate::ids::MenuOptionId,
            last_right_option_id: crate::ids::MenuOptionId,
        }

        let value = ReplacementSelectControlWire::deserialize(deserializer)?;
        Self::new(
            value.occurrence,
            value.source,
            value.actor,
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
        self.validate_at_depth(0)
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

    pub(crate) fn validate_control_ids(
        &self,
        battle_id: BattleId,
        wave: WaveIndex,
        turn: TurnIndex,
        seat: SeatId,
        decision_operation_id: Option<&OperationId>,
    ) -> Result<(), BattleControlError> {
        self.validate_control_ids_with_context(&ControlIdentityContext {
            battle_id,
            wave,
            turn,
            seat,
            decision_operation_id,
        })
    }

    fn validate_at_depth(&self, depth: usize) -> Result<(), BattleControlError> {
        match self {
            Self::CommandRoot(value) => value.validate_basic(),
            Self::MoveSelect(value) => {
                value.validate_basic()?;
                value.validate_cancel_at_depth(depth)
            }
            Self::TargetSelect(value) => {
                value.validate_basic()?;
                value.validate_cancel_at_depth(depth)
            }
            Self::PartySelect(value) => {
                value.validate_basic()?;
                value.validate_cancel_at_depth(depth)
            }
            Self::PartyOptionSelect(value) => {
                value.validate_basic()?;
                value.validate_cancel_at_depth(depth)
            }
            Self::ReplacementSelect(value) => value.validate_basic(),
            Self::Waiting(value) => value.validate(),
            Self::Complete(outcome) => {
                if *outcome == BattleOutcome::Ongoing {
                    Err(BattleControlError::OngoingCompleteOutcome)
                } else {
                    Ok(())
                }
            }
        }
    }

    fn validate_control_ids_with_context(
        &self,
        context: &ControlIdentityContext<'_>,
    ) -> Result<(), BattleControlError> {
        match self {
            Self::CommandRoot(value) => {
                validate_command_control_identity(&value.menu, value.field_slot, "command", context)
            }
            Self::MoveSelect(value) => {
                validate_command_control_identity(&value.menu, value.field_slot, "move", context)?;
                value.cancel_to.validate_control_ids_with_context(context)
            }
            Self::TargetSelect(value) => {
                validate_command_control_identity(
                    &value.menu,
                    value.field_slot,
                    "target",
                    context,
                )?;
                value.cancel_to.validate_control_ids_with_context(context)
            }
            Self::PartySelect(value) => {
                validate_command_control_identity(&value.menu, value.field_slot, "party", context)?;
                value.cancel_to.validate_control_ids_with_context(context)
            }
            Self::PartyOptionSelect(value) => {
                let kind = format!("party-option/{}", value.selected_party_slot.get());
                match value.cancel_to.as_ref() {
                    Self::PartySelect(_) => {
                        validate_command_control_identity(
                            &value.menu,
                            value.field_slot,
                            &kind,
                            context,
                        )?;
                    }
                    Self::ReplacementSelect(restored) => {
                        validate_replacement_control_identity(
                            &value.menu,
                            restored.source,
                            value.field_slot,
                            restored.owner_seat,
                            &kind,
                            context,
                        )?;
                    }
                    _ => return Err(BattleControlError::ControlIdMismatch),
                }
                value.cancel_to.validate_control_ids_with_context(context)
            }
            Self::ReplacementSelect(value) => validate_replacement_control_identity(
                &value.menu,
                value.source,
                value.field_slot,
                value.owner_seat,
                "replacement",
                context,
            ),
            Self::Waiting(_) | Self::Complete(_) => Ok(()),
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

struct ControlIdentityContext<'a> {
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
    seat: SeatId,
    decision_operation_id: Option<&'a OperationId>,
}

fn validate_command_control_identity(
    menu: &BattleMenu,
    field_slot: FieldSlot,
    kind: &str,
    context: &ControlIdentityContext<'_>,
) -> Result<(), BattleControlError> {
    if field_slot.side != crate::battle_ids::BattleSide::Player {
        return Err(BattleControlError::CommandFieldMustBePlayer);
    }
    let expected_operation_id = format!(
        "battle/{}/wave/{}/turn/{}/command/player/{}/seat/{}",
        context.battle_id, context.wave, context.turn, field_slot.position, context.seat,
    );
    if context.decision_operation_id.map(OperationId::as_str)
        != Some(expected_operation_id.as_str())
    {
        return Err(BattleControlError::DecisionOperationIdMismatch);
    }
    let expected_control_id = format!(
        "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/{}",
        context.battle_id, context.wave, context.turn, field_slot.position, context.seat, kind,
    );
    if menu.control_id.as_str() != expected_control_id.as_str() {
        return Err(BattleControlError::ControlIdMismatch);
    }
    Ok(())
}

fn validate_replacement_control_identity(
    menu: &BattleMenu,
    source: FaintSource,
    field_slot: FieldSlot,
    owner_seat: SeatId,
    kind: &str,
    context: &ControlIdentityContext<'_>,
) -> Result<(), BattleControlError> {
    if field_slot.side != crate::battle_ids::BattleSide::Player {
        return Err(BattleControlError::ReplacementFieldMustBePlayer);
    }
    if source.wave != context.wave {
        return Err(BattleControlError::ReplacementSourceWaveMismatch);
    }
    if source.resolved_turn != context.turn {
        return Err(BattleControlError::ReplacementSourceTurnMismatch);
    }
    if owner_seat != context.seat || menu.owner_seat != context.seat {
        return Err(BattleControlError::ReplacementSeatMismatch);
    }
    let expected_operation_id = format!(
        "RC/e{}/b{}/w{}/t{}/o{}/f{}/s{}",
        source.epoch,
        context.battle_id,
        source.wave,
        source.resolved_turn,
        source.turn_occurrence,
        field_slot.position,
        owner_seat,
    );
    if context.decision_operation_id.map(OperationId::as_str)
        != Some(expected_operation_id.as_str())
    {
        return Err(BattleControlError::DecisionOperationIdMismatch);
    }
    let expected_control_id = format!("{expected_operation_id}/control/{kind}");
    if menu.control_id.as_str() != expected_control_id.as_str() {
        return Err(BattleControlError::ControlIdMismatch);
    }
    Ok(())
}

fn stable_control_prefix(control_id: &str) -> &str {
    control_id
        .split_once("/control/")
        .map_or(control_id, |(prefix, _)| prefix)
}

fn validate_cancel_history(
    cancel_to: &BattleControl,
    depth: usize,
) -> Result<(), BattleControlError> {
    if depth >= MAX_CANCEL_HISTORY_DEPTH {
        return Err(BattleControlError::CancelHistoryTooDeep);
    }
    cancel_to.validate_at_depth(depth + 1)
}

fn validate_restoration_coordinates(
    current_menu: &BattleMenu,
    current_field_slot: FieldSlot,
    restored_menu: &BattleMenu,
    restored_field_slot: FieldSlot,
) -> Result<(), CancelRestorationError> {
    if current_menu.owner_seat != restored_menu.owner_seat {
        return Err(CancelRestorationError::OwnerSeatMismatch);
    }
    if current_field_slot != restored_field_slot {
        return Err(CancelRestorationError::FieldSlotMismatch);
    }
    if stable_control_prefix(&current_menu.control_id)
        != stable_control_prefix(&restored_menu.control_id)
    {
        return Err(CancelRestorationError::StableCoordinatesMismatch);
    }
    Ok(())
}

fn validate_restoration_actor(
    current_actor: PokemonId,
    restored_actor: PokemonId,
) -> Result<(), CancelRestorationError> {
    if current_actor != restored_actor {
        return Err(CancelRestorationError::ActorMismatch);
    }
    Ok(())
}

fn retains_party_slot(menu: &BattleMenu, selected_party_slot: PartyIndex) -> bool {
    let expected_slot = selected_party_slot.get().to_string();
    let mut segments = menu.selected_option_id.as_str().split('/');
    matches!(
        (
            segments.next(),
            segments.next(),
            segments.next(),
            segments.next(),
            segments.next(),
        ),
        (Some("party"), Some(pokemon_id), Some("slot"), Some(slot), None)
            if !pokemon_id.is_empty() && slot == expected_slot.as_str()
    )
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

    fn validate_cancel_at_depth(&self, depth: usize) -> Result<(), BattleControlError> {
        validate_cancel_history(&self.cancel_to, depth)?;
        let BattleControl::CommandRoot(restored) = self.cancel_to.as_ref() else {
            return Err(CancelRestorationError::MoveSelectRequiresCommandRoot.into());
        };
        validate_restoration_coordinates(
            &self.menu,
            self.field_slot,
            &restored.menu,
            restored.field_slot,
        )?;
        validate_restoration_actor(self.actor, restored.actor)?;
        if restored.menu.selected_option_id.as_str() != "command/fight" {
            return Err(CancelRestorationError::CommandFightNotSelected.into());
        }
        Ok(())
    }
}

impl TargetSelectControl {
    fn validate_basic(&self) -> Result<(), BattleControlError> {
        validate_field_slot_vector(&self.candidate_targets)?;
        self.menu.validate().map_err(BattleControlError::from)
    }

    fn validate_cancel_at_depth(&self, depth: usize) -> Result<(), BattleControlError> {
        validate_cancel_history(&self.cancel_to, depth)?;
        let BattleControl::MoveSelect(restored) = self.cancel_to.as_ref() else {
            return Err(CancelRestorationError::TargetSelectRequiresMoveSelect.into());
        };
        validate_restoration_coordinates(
            &self.menu,
            self.field_slot,
            &restored.menu,
            restored.field_slot,
        )?;
        validate_restoration_actor(self.actor, restored.actor)?;
        let selected_move = format!("move/{}/slot/{}", self.actor, self.move_slot.get());
        if restored.menu.selected_option_id.as_str() != selected_move.as_str() {
            return Err(CancelRestorationError::TargetSelectedMoveMismatch.into());
        }
        Ok(())
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

    fn validate_cancel_at_depth(&self, depth: usize) -> Result<(), BattleControlError> {
        validate_cancel_history(&self.cancel_to, depth)?;
        let BattleControl::CommandRoot(restored) = self.cancel_to.as_ref() else {
            return Err(CancelRestorationError::PartySelectRequiresCommandRoot.into());
        };
        validate_restoration_coordinates(
            &self.menu,
            self.field_slot,
            &restored.menu,
            restored.field_slot,
        )?;
        validate_restoration_actor(self.actor, restored.actor)?;
        if restored.menu.selected_option_id.as_str() != "command/switch" {
            return Err(CancelRestorationError::CommandSwitchNotSelected.into());
        }
        Ok(())
    }
}

impl PartyOptionSelectControl {
    fn validate_basic(&self) -> Result<(), BattleControlError> {
        self.menu.validate().map_err(BattleControlError::from)
    }

    fn validate_cancel_at_depth(&self, depth: usize) -> Result<(), BattleControlError> {
        validate_cancel_history(&self.cancel_to, depth)?;
        let restored_menu = match self.cancel_to.as_ref() {
            BattleControl::PartySelect(restored) => {
                validate_restoration_coordinates(
                    &self.menu,
                    self.field_slot,
                    &restored.menu,
                    restored.field_slot,
                )?;
                validate_restoration_actor(self.actor, restored.actor)?;
                &restored.menu
            }
            BattleControl::ReplacementSelect(restored) => {
                validate_restoration_coordinates(
                    &self.menu,
                    self.field_slot,
                    &restored.menu,
                    restored.field_slot,
                )?;
                validate_restoration_actor(self.actor, restored.actor)?;
                &restored.menu
            }
            _ => {
                return Err(
                    CancelRestorationError::PartyOptionSelectRequiresPartyOrReplacement.into(),
                );
            }
        };
        if !retains_party_slot(restored_menu, self.selected_party_slot) {
            return Err(CancelRestorationError::PartyOptionSelectedSlotMismatch.into());
        }
        Ok(())
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
    use crate::battle_ids::{AuthorityEpoch, BattleSide, MenuInstanceId};
    use crate::ids::{MenuOptionId, OperationId, SafeU53, SeatId};

    fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
        Ok(SafeU53::new(value)?)
    }

    fn field_slot(position: u8) -> FieldSlot {
        FieldSlot {
            side: BattleSide::Player,
            position,
        }
    }

    fn menu(
        instance_id: u64,
        owner_seat: u64,
        control_id: &str,
        selected_option_id: &str,
    ) -> Result<BattleMenu, Box<dyn Error>> {
        let option_id = MenuOptionId::new(selected_option_id)?;
        let option = BattleMenuOption::new(
            option_id.clone(),
            "menu.option",
            MenuOptionVisibility::Visible,
            true,
            MenuOptionLayout::new(option_id.clone(), 0, 0, 0),
        )?;
        Ok(BattleMenu::new(
            MenuInstanceId::new(safe(instance_id)?),
            SeatId::new(safe(owner_seat)?),
            control_id,
            option_id,
            vec![option],
            Vec::new(),
        )?)
    }

    fn root_with(
        instance_id: u64,
        owner_seat: u64,
        actor: u64,
        position: u8,
        control_id: &str,
        selected_option_id: &str,
    ) -> Result<BattleControl, Box<dyn Error>> {
        Ok(BattleControl::CommandRoot(CommandRootControl::new(
            PokemonId::new(safe(actor)?),
            field_slot(position),
            menu(instance_id, owner_seat, control_id, selected_option_id)?,
        )?))
    }

    fn root(instance_id: u64, control_id: &str) -> Result<BattleControl, Box<dyn Error>> {
        root_with(instance_id, 1, 7, 0, control_id, "command/fight")
    }

    fn move_control(
        instance_id: u64,
        control_id: &str,
        selected_option_id: &str,
        cancel_to: BattleControl,
    ) -> Result<BattleControl, Box<dyn Error>> {
        Ok(BattleControl::MoveSelect(MoveSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            menu(instance_id, 1, control_id, selected_option_id)?,
            Box::new(cancel_to),
        )?))
    }

    fn party_control(
        instance_id: u64,
        control_id: &str,
        selected_option_id: &str,
        cancel_to: BattleControl,
    ) -> Result<BattleControl, Box<dyn Error>> {
        let selected_option_id = MenuOptionId::new(selected_option_id)?;
        Ok(BattleControl::PartySelect(PartySelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            menu(instance_id, 1, control_id, selected_option_id.as_str())?,
            selected_option_id.clone(),
            selected_option_id,
            Box::new(cancel_to),
        )?))
    }

    fn replacement_control(
        instance_id: u64,
        control_id: &str,
        selected_option_id: &str,
    ) -> Result<BattleControl, Box<dyn Error>> {
        replacement_control_with(
            instance_id,
            control_id,
            selected_option_id,
            9,
            FaintSource {
                epoch: AuthorityEpoch::new(safe(3)?),
                wave: WaveIndex::new(safe(1)?)?,
                resolved_turn: TurnIndex::new(safe(1)?)?,
                turn_occurrence: 4,
            },
            7,
            field_slot(0),
            1,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn replacement_control_with(
        instance_id: u64,
        control_id: &str,
        selected_option_id: &str,
        occurrence: u64,
        source: FaintSource,
        actor: u64,
        field_slot: FieldSlot,
        owner_seat: u64,
    ) -> Result<BattleControl, Box<dyn Error>> {
        let selected_option_id = MenuOptionId::new(selected_option_id)?;
        Ok(BattleControl::ReplacementSelect(
            ReplacementSelectControl::new(
                FaintOccurrenceId::new(safe(occurrence)?),
                source,
                PokemonId::new(safe(actor)?),
                field_slot,
                SeatId::new(safe(owner_seat)?),
                menu(
                    instance_id,
                    owner_seat,
                    control_id,
                    selected_option_id.as_str(),
                )?,
                selected_option_id.clone(),
                selected_option_id,
            )?,
        ))
    }

    fn replacement_operation_id(control: &BattleControl) -> Option<String> {
        let replacement = match control {
            BattleControl::ReplacementSelect(value) => value,
            BattleControl::PartyOptionSelect(value) => match value.cancel_to.as_ref() {
                BattleControl::ReplacementSelect(restored) => restored,
                _ => return None,
            },
            _ => return None,
        };
        Some(format!(
            "RC/e{}/b1/w{}/t{}/o{}/f{}/s{}",
            replacement.source.epoch,
            replacement.source.wave,
            replacement.source.resolved_turn,
            replacement.source.turn_occurrence,
            replacement.field_slot.position,
            replacement.owner_seat,
        ))
    }

    fn plan(
        control: BattleControl,
        next_menu_instance_id: u64,
    ) -> Result<BattleControlPlan, BattleControlPlanError> {
        let decision_operation_id = if control.requires_decision_operation() {
            Some(
                OperationId::new(replacement_operation_id(&control).unwrap_or_else(|| {
                    "battle/1/wave/1/turn/1/command/player/0/seat/1".to_owned()
                }))
                .expect("test operation ID is non-empty"),
            )
        } else {
            None
        };
        plan_with_operation(control, next_menu_instance_id, decision_operation_id)
    }

    fn plan_with_operation(
        control: BattleControl,
        next_menu_instance_id: u64,
        decision_operation_id: Option<OperationId>,
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
                decision_operation_id,
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
        assert!(
            plan(
                root(2, "battle/1/wave/1/turn/1/control/player/0/seat/1/command")?,
                2
            )
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn contextual_control_ids_are_exact() -> Result<(), Box<dyn Error>> {
        assert!(matches!(
            plan(
                root(1, "battle/01/wave/1/turn/1/control/player/0/seat/1/command",)?,
                2,
            ),
            Err(BattleControlPlanError::Control(
                BattleControlError::ControlIdMismatch
            ))
        ));

        let battle_id = BattleId::new(safe(1)?);
        let wave = WaveIndex::new(safe(1)?)?;
        let turn = TurnIndex::new(safe(1)?)?;
        let seat = SeatId::new(safe(1)?);
        let operation_id = OperationId::new("RC/e3/b1/w1/t1/o4/f0/s1")?;
        let replacement = replacement_control(
            1,
            "RC/e3/b1/w1/t1/o4/f0/s1/control/replacement",
            "party/42/slot/3",
        )?;
        assert!(
            replacement
                .validate_control_ids(battle_id, wave, turn, seat, Some(&operation_id))
                .is_ok()
        );

        let wrong_suffix = replacement_control(
            1,
            "RC/e3/b1/w1/t1/o4/f0/s1/control/party-option/3",
            "party/42/slot/3",
        )?;
        assert_eq!(
            wrong_suffix.validate_control_ids(battle_id, wave, turn, seat, Some(&operation_id)),
            Err(BattleControlError::ControlIdMismatch)
        );
        Ok(())
    }

    #[test]
    fn command_decision_operation_identity_rejects_each_mutated_coordinate()
    -> Result<(), Box<dyn Error>> {
        let control_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/command";
        let exact = OperationId::new("battle/1/wave/1/turn/1/command/player/0/seat/1")?;
        assert!(plan_with_operation(root(1, control_id)?, 2, Some(exact)).is_ok());

        for mutated in [
            "battle/2/wave/1/turn/1/command/player/0/seat/1",
            "battle/1/wave/2/turn/1/command/player/0/seat/1",
            "battle/1/wave/1/turn/2/command/player/0/seat/1",
            "battle/1/wave/1/turn/1/command/player/1/seat/1",
            "battle/1/wave/1/turn/1/command/player/0/seat/2",
            "turn/e1/w1/t1/command/player/0",
        ] {
            assert_eq!(
                plan_with_operation(root(1, control_id)?, 2, Some(OperationId::new(mutated)?),),
                Err(BattleControlPlanError::Control(
                    BattleControlError::DecisionOperationIdMismatch
                )),
                "mutated command operation {mutated} must be rejected"
            );
        }

        let enemy_side = BattleControl::CommandRoot(CommandRootControl::new(
            PokemonId::new(safe(7)?),
            FieldSlot {
                side: BattleSide::Enemy,
                position: 0,
            },
            menu(1, 1, control_id, "command/fight")?,
        )?);
        assert_eq!(
            plan_with_operation(
                enemy_side,
                2,
                Some(OperationId::new(
                    "battle/1/wave/1/turn/1/command/player/0/seat/1",
                )?),
            ),
            Err(BattleControlPlanError::Control(
                BattleControlError::CommandFieldMustBePlayer
            ))
        );

        let mut invalid_wire = plan(root(1, control_id)?, 2)?;
        invalid_wire.seats[0].decision_operation_id = Some(OperationId::new(
            "battle/2/wave/1/turn/1/command/player/0/seat/1",
        )?);
        let encoded = serde_json::to_string(&invalid_wire)?;
        assert!(serde_json::from_str::<BattleControlPlan>(&encoded).is_err());
        Ok(())
    }

    #[test]
    fn replacement_decision_operation_identity_rejects_each_mutated_coordinate()
    -> Result<(), Box<dyn Error>> {
        let exact = "RC/e3/b1/w1/t1/o4/f0/s1";
        assert!(
            plan_with_operation(
                replacement_control(
                    1,
                    &format!("{exact}/control/replacement"),
                    "party/42/slot/3",
                )?,
                2,
                Some(OperationId::new(exact)?),
            )
            .is_ok()
        );

        for mutated in [
            "RC/e4/b1/w1/t1/o4/f0/s1",
            "RC/e3/b2/w1/t1/o4/f0/s1",
            "RC/e3/b1/w2/t1/o4/f0/s1",
            "RC/e3/b1/w1/t2/o4/f0/s1",
            "RC/e3/b1/w1/t1/o5/f0/s1",
            "RC/e3/b1/w1/t1/o4/f1/s1",
            "RC/e3/b1/w1/t1/o4/f0/s2",
        ] {
            assert_eq!(
                plan_with_operation(
                    replacement_control(
                        1,
                        &format!("{mutated}/control/replacement"),
                        "party/42/slot/3",
                    )?,
                    2,
                    Some(OperationId::new(mutated)?),
                ),
                Err(BattleControlPlanError::Control(
                    BattleControlError::DecisionOperationIdMismatch
                )),
                "mutated replacement operation {mutated} must be rejected"
            );
        }
        Ok(())
    }

    #[test]
    fn replacement_context_rejects_source_and_side_mismatches() -> Result<(), Box<dyn Error>> {
        let wave_two_source = FaintSource {
            epoch: AuthorityEpoch::new(safe(3)?),
            wave: WaveIndex::new(safe(2)?)?,
            resolved_turn: TurnIndex::new(safe(1)?)?,
            turn_occurrence: 4,
        };
        assert_eq!(
            plan_with_operation(
                replacement_control_with(
                    1,
                    "RC/e3/b1/w2/t1/o4/f0/s1/control/replacement",
                    "party/42/slot/3",
                    9,
                    wave_two_source,
                    7,
                    field_slot(0),
                    1,
                )?,
                2,
                Some(OperationId::new("RC/e3/b1/w2/t1/o4/f0/s1")?),
            ),
            Err(BattleControlPlanError::Control(
                BattleControlError::ReplacementSourceWaveMismatch
            ))
        );

        let turn_two_source = FaintSource {
            epoch: AuthorityEpoch::new(safe(3)?),
            wave: WaveIndex::new(safe(1)?)?,
            resolved_turn: TurnIndex::new(safe(2)?)?,
            turn_occurrence: 4,
        };
        assert_eq!(
            plan_with_operation(
                replacement_control_with(
                    1,
                    "RC/e3/b1/w1/t2/o4/f0/s1/control/replacement",
                    "party/42/slot/3",
                    9,
                    turn_two_source,
                    7,
                    field_slot(0),
                    1,
                )?,
                2,
                Some(OperationId::new("RC/e3/b1/w1/t2/o4/f0/s1")?),
            ),
            Err(BattleControlPlanError::Control(
                BattleControlError::ReplacementSourceTurnMismatch
            ))
        );

        let source = FaintSource {
            epoch: AuthorityEpoch::new(safe(3)?),
            wave: WaveIndex::new(safe(1)?)?,
            resolved_turn: TurnIndex::new(safe(1)?)?,
            turn_occurrence: 4,
        };
        assert_eq!(
            plan_with_operation(
                replacement_control_with(
                    1,
                    "RC/e3/b1/w1/t1/o4/f0/s1/control/replacement",
                    "party/42/slot/3",
                    9,
                    source,
                    7,
                    FieldSlot {
                        side: BattleSide::Enemy,
                        position: 0,
                    },
                    1,
                )?,
                2,
                Some(OperationId::new("RC/e3/b1/w1/t1/o4/f0/s1")?),
            ),
            Err(BattleControlPlanError::Control(
                BattleControlError::ReplacementFieldMustBePlayer
            ))
        );
        Ok(())
    }

    #[test]
    fn replacement_global_occurrence_is_serialized_but_never_drives_operation_identity()
    -> Result<(), Box<dyn Error>> {
        let control_id = "RC/e3/b1/w1/t1/o4/f0/s1/control/replacement";
        let original = replacement_control(1, control_id, "party/42/slot/3")?;
        let original_json = serde_json::to_string(&original)?;
        assert!(plan(original, 2).is_ok());

        let mut changed = replacement_control(1, control_id, "party/42/slot/3")?;
        let BattleControl::ReplacementSelect(replacement) = &mut changed else {
            unreachable!("test helper always builds ReplacementSelect");
        };
        replacement.occurrence = FaintOccurrenceId::new(safe(10)?);
        let changed_json = serde_json::to_string(&changed)?;
        assert_ne!(original_json, changed_json);
        assert!(changed_json.contains(r#""occurrence":10"#));
        assert!(changed_json.contains(r#""turn_occurrence":4"#));
        assert!(plan(changed, 2).is_ok());
        Ok(())
    }

    #[test]
    fn replacement_source_and_actor_are_required_on_the_wire() -> Result<(), Box<dyn Error>> {
        let replacement = replacement_control(
            1,
            "RC/e3/b1/w1/t1/o4/f0/s1/control/replacement",
            "party/42/slot/3",
        )?;
        for missing in ["source", "actor"] {
            let mut wire = serde_json::to_value(&replacement)?;
            let removed = wire
                .get_mut("value")
                .and_then(serde_json::Value::as_object_mut)
                .expect("replacement wire value is an object")
                .remove(missing);
            assert!(removed.is_some(), "test fixture contains {missing}");
            assert!(
                serde_json::from_value::<BattleControl>(wire).is_err(),
                "missing {missing} must be rejected"
            );
        }
        Ok(())
    }

    #[test]
    fn cancel_restoration_accepts_only_the_frozen_edges() -> Result<(), Box<dyn Error>> {
        let command_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/command";
        let move_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/move";
        let target_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/target";
        let party_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/party";
        let party_option_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/party-option/3";

        let move_select = move_control(2, move_id, "move/7/slot/2", root(1, command_id)?)?;
        let target_select = BattleControl::TargetSelect(TargetSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            MoveSlotIndex::new(2)?,
            false,
            vec![FieldSlot {
                side: BattleSide::Enemy,
                position: 0,
            }],
            menu(3, 1, target_id, "target/enemy/0")?,
            Box::new(move_select),
        )?);
        assert!(target_select.validate().is_ok());

        let party_select = party_control(
            5,
            party_id,
            "party/42/slot/3",
            root_with(4, 1, 7, 0, command_id, "command/switch")?,
        )?;
        let party_option = BattleControl::PartyOptionSelect(PartyOptionSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            PartyIndex::new(3)?,
            menu(6, 1, party_option_id, "party-option/send-out")?,
            Box::new(party_select),
        )?);
        assert!(party_option.validate().is_ok());

        let replacement_operation = "RC/e3/b1/w1/t1/o4/f0/s1";
        let replacement = replacement_control(
            7,
            &format!("{replacement_operation}/control/replacement"),
            "party/42/slot/3",
        )?;
        let replacement_party_option =
            BattleControl::PartyOptionSelect(PartyOptionSelectControl::new(
                PokemonId::new(safe(7)?),
                field_slot(0),
                PartyIndex::new(3)?,
                menu(
                    8,
                    1,
                    &format!("{replacement_operation}/control/party-option/3"),
                    "party-option/send-out",
                )?,
                Box::new(replacement),
            )?);
        assert!(replacement_party_option.validate().is_ok());
        Ok(())
    }

    #[test]
    fn replacement_party_option_restoration_retains_the_fainted_actor() -> Result<(), Box<dyn Error>>
    {
        let replacement_operation = "RC/e3/b1/w1/t1/o4/f0/s1";
        let mut replacement = replacement_control(
            1,
            &format!("{replacement_operation}/control/replacement"),
            "party/42/slot/3",
        )?;
        let BattleControl::ReplacementSelect(restored) = &mut replacement else {
            unreachable!("test helper always builds ReplacementSelect");
        };
        restored.actor = PokemonId::new(safe(8)?);

        let error = PartyOptionSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            PartyIndex::new(3)?,
            menu(
                2,
                1,
                &format!("{replacement_operation}/control/party-option/3"),
                "party-option/send-out",
            )?,
            Box::new(replacement),
        );
        assert_eq!(
            error.expect_err("replacement restoration must retain the fainted actor"),
            BattleControlError::CancelRestoration(CancelRestorationError::ActorMismatch)
        );
        Ok(())
    }

    #[test]
    fn replacement_party_option_uses_the_nested_source_for_exact_operation_context()
    -> Result<(), Box<dyn Error>> {
        let replacement_operation = "RC/e3/b1/w1/t1/o4/f0/s1";
        let mut replacement = replacement_control(
            1,
            &format!("{replacement_operation}/control/replacement"),
            "party/42/slot/3",
        )?;
        let BattleControl::ReplacementSelect(restored) = &mut replacement else {
            unreachable!("test helper always builds ReplacementSelect");
        };
        restored.source.epoch = AuthorityEpoch::new(safe(4)?);

        let party_option = BattleControl::PartyOptionSelect(PartyOptionSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            PartyIndex::new(3)?,
            menu(
                2,
                1,
                &format!("{replacement_operation}/control/party-option/3"),
                "party-option/send-out",
            )?,
            Box::new(replacement),
        )?);
        assert_eq!(
            plan_with_operation(
                party_option,
                3,
                Some(OperationId::new(replacement_operation)?),
            ),
            Err(BattleControlPlanError::Control(
                BattleControlError::DecisionOperationIdMismatch
            ))
        );
        Ok(())
    }

    #[test]
    fn cancel_restoration_rejects_wrong_variants_on_the_same_frontier() -> Result<(), Box<dyn Error>>
    {
        let command_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/command";
        let move_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/move";
        let target_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/target";
        let party_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/party";
        let party_option_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/party-option/3";

        let wrong_target = TargetSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            MoveSlotIndex::new(2)?,
            false,
            vec![FieldSlot {
                side: BattleSide::Enemy,
                position: 0,
            }],
            menu(2, 1, target_id, "target/enemy/0")?,
            Box::new(root(1, command_id)?),
        );
        assert_eq!(
            wrong_target.expect_err("TargetSelect must reject CommandRoot restoration"),
            BattleControlError::CancelRestoration(
                CancelRestorationError::TargetSelectRequiresMoveSelect
            )
        );

        let prior_move = move_control(4, move_id, "move/7/slot/2", root(3, command_id)?)?;
        let wrong_move = MoveSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            menu(5, 1, move_id, "move/7/slot/2")?,
            Box::new(prior_move.clone()),
        );
        assert_eq!(
            wrong_move.expect_err("MoveSelect must reject MoveSelect restoration"),
            BattleControlError::CancelRestoration(
                CancelRestorationError::MoveSelectRequiresCommandRoot
            )
        );

        let selected_party = MenuOptionId::new("party/42/slot/3")?;
        let wrong_party = PartySelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            menu(6, 1, party_id, selected_party.as_str())?,
            selected_party.clone(),
            selected_party,
            Box::new(prior_move.clone()),
        );
        assert_eq!(
            wrong_party.expect_err("PartySelect must reject MoveSelect restoration"),
            BattleControlError::CancelRestoration(
                CancelRestorationError::PartySelectRequiresCommandRoot
            )
        );

        let wrong_party_option = PartyOptionSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            PartyIndex::new(3)?,
            menu(7, 1, party_option_id, "party-option/send-out")?,
            Box::new(prior_move),
        );
        assert_eq!(
            wrong_party_option.expect_err("PartyOptionSelect must reject MoveSelect restoration"),
            BattleControlError::CancelRestoration(
                CancelRestorationError::PartyOptionSelectRequiresPartyOrReplacement
            )
        );
        Ok(())
    }

    #[test]
    fn cancel_restoration_retains_coordinates_and_parent_selection() -> Result<(), Box<dyn Error>> {
        let command_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/command";
        let move_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/move";

        let owner_error = MoveSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            menu(2, 1, move_id, "move/7/slot/2")?,
            Box::new(root_with(1, 2, 7, 0, command_id, "command/fight")?),
        );
        assert_eq!(
            owner_error.expect_err("restoration must retain the owner seat"),
            BattleControlError::CancelRestoration(CancelRestorationError::OwnerSeatMismatch)
        );

        let actor_error = MoveSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            menu(4, 1, move_id, "move/7/slot/2")?,
            Box::new(root_with(3, 1, 8, 0, command_id, "command/fight")?),
        );
        assert_eq!(
            actor_error.expect_err("restoration must retain the actor"),
            BattleControlError::CancelRestoration(CancelRestorationError::ActorMismatch)
        );

        let field_error = MoveSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            menu(6, 1, move_id, "move/7/slot/2")?,
            Box::new(root_with(5, 1, 7, 1, command_id, "command/fight")?),
        );
        assert_eq!(
            field_error.expect_err("restoration must retain the field slot"),
            BattleControlError::CancelRestoration(CancelRestorationError::FieldSlotMismatch)
        );

        let stable_error = MoveSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            menu(
                8,
                1,
                "battle/2/wave/1/turn/1/control/player/0/seat/1/move",
                "move/7/slot/2",
            )?,
            Box::new(root(7, command_id)?),
        );
        assert_eq!(
            stable_error.expect_err("restoration must retain stable coordinates"),
            BattleControlError::CancelRestoration(
                CancelRestorationError::StableCoordinatesMismatch
            )
        );

        let fight_error = MoveSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            menu(10, 1, move_id, "move/7/slot/2")?,
            Box::new(root_with(9, 1, 7, 0, command_id, "command/switch")?),
        );
        assert_eq!(
            fight_error.expect_err("MoveSelect must restore selected Fight"),
            BattleControlError::CancelRestoration(CancelRestorationError::CommandFightNotSelected)
        );
        Ok(())
    }

    #[test]
    fn cancel_restoration_retains_move_and_party_slots() -> Result<(), Box<dyn Error>> {
        let command_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/command";
        let move_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/move";
        let target_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/target";
        let party_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/party";
        let party_option_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/party-option/3";

        let wrong_move = move_control(2, move_id, "move/7/slot/1", root(1, command_id)?)?;
        let target_error = TargetSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            MoveSlotIndex::new(2)?,
            false,
            vec![FieldSlot {
                side: BattleSide::Enemy,
                position: 0,
            }],
            menu(3, 1, target_id, "target/enemy/0")?,
            Box::new(wrong_move),
        );
        assert_eq!(
            target_error.expect_err("TargetSelect must retain its selected move"),
            BattleControlError::CancelRestoration(
                CancelRestorationError::TargetSelectedMoveMismatch
            )
        );

        let selected_party = MenuOptionId::new("party/42/slot/3")?;
        let switch_error = PartySelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            menu(5, 1, party_id, selected_party.as_str())?,
            selected_party.clone(),
            selected_party,
            Box::new(root(4, command_id)?),
        );
        assert_eq!(
            switch_error.expect_err("PartySelect must restore selected Switch"),
            BattleControlError::CancelRestoration(CancelRestorationError::CommandSwitchNotSelected)
        );

        let wrong_party_slot = party_control(
            7,
            party_id,
            "party/42/slot/2",
            root_with(6, 1, 7, 0, command_id, "command/switch")?,
        )?;
        let party_slot_error = PartyOptionSelectControl::new(
            PokemonId::new(safe(7)?),
            field_slot(0),
            PartyIndex::new(3)?,
            menu(8, 1, party_option_id, "party-option/send-out")?,
            Box::new(wrong_party_slot),
        );
        assert_eq!(
            party_slot_error.expect_err("PartyOptionSelect must retain the selected party slot"),
            BattleControlError::CancelRestoration(
                CancelRestorationError::PartyOptionSelectedSlotMismatch
            )
        );
        Ok(())
    }

    #[test]
    fn invalid_cancel_wires_are_rejected_and_history_stays_bounded() -> Result<(), Box<dyn Error>> {
        let command_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/command";
        let move_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/move";
        let target_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/target";
        let invalid_wire = BattleControl::TargetSelect(TargetSelectControl {
            actor: PokemonId::new(safe(7)?),
            field_slot: field_slot(0),
            move_slot: MoveSlotIndex::new(2)?,
            multiple: false,
            candidate_targets: vec![FieldSlot {
                side: BattleSide::Enemy,
                position: 0,
            }],
            menu: menu(2, 1, target_id, "target/enemy/0")?,
            cancel_to: Box::new(root(1, command_id)?),
        });
        let encoded = serde_json::to_string(&invalid_wire)?;
        assert!(serde_json::from_str::<BattleControl>(&encoded).is_err());

        let mut too_deep = root(1, command_id)?;
        for instance_id in 2..=5 {
            too_deep = BattleControl::MoveSelect(MoveSelectControl {
                actor: PokemonId::new(safe(7)?),
                field_slot: field_slot(0),
                menu: menu(instance_id, 1, move_id, "move/7/slot/2")?,
                cancel_to: Box::new(too_deep),
            });
        }
        assert_eq!(
            too_deep.validate(),
            Err(BattleControlError::CancelHistoryTooDeep)
        );
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
