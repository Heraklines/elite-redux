//! Mechanics-facing commands after immediate legality revalidation.
//!
//! The public wire DTOs retain proposal provenance and target-selection shape
//! in `er-types`. Resolution uses these normalized values only after
//! `legality` has checked the complete current state and immutable content
//! pack. In particular, an implicit target has already been expanded to its
//! one concrete field slot here.

use er_types::OperationId;
use er_types::battle_ids::{FieldSlot, MoveId, MoveSlotIndex, PartyIndex, PokemonId};

/// One command whose actor, source slot, content IDs, PP, target set, and
/// switch destination were legal in the state immediately before resolution.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NormalizedBattleCommand {
    Fight {
        operation_id: OperationId,
        actor: PokemonId,
        field_slot: FieldSlot,
        move_slot: MoveSlotIndex,
        move_id: MoveId,
        targets: Vec<FieldSlot>,
    },
    Switch {
        operation_id: OperationId,
        actor: PokemonId,
        field_slot: FieldSlot,
        party_slot: PartyIndex,
        incoming: PokemonId,
    },
}

impl NormalizedBattleCommand {
    pub(crate) fn fight(
        operation_id: OperationId,
        actor: PokemonId,
        field_slot: FieldSlot,
        move_slot: MoveSlotIndex,
        move_id: MoveId,
        targets: Vec<FieldSlot>,
    ) -> Self {
        Self::Fight {
            operation_id,
            actor,
            field_slot,
            move_slot,
            move_id,
            targets,
        }
    }

    pub(crate) fn switch(
        operation_id: OperationId,
        actor: PokemonId,
        field_slot: FieldSlot,
        party_slot: PartyIndex,
        incoming: PokemonId,
    ) -> Self {
        Self::Switch {
            operation_id,
            actor,
            field_slot,
            party_slot,
            incoming,
        }
    }

    pub fn operation_id(&self) -> &OperationId {
        match self {
            Self::Fight { operation_id, .. } | Self::Switch { operation_id, .. } => operation_id,
        }
    }

    pub const fn actor(&self) -> PokemonId {
        match self {
            Self::Fight { actor, .. } | Self::Switch { actor, .. } => *actor,
        }
    }

    pub const fn field_slot(&self) -> FieldSlot {
        match self {
            Self::Fight { field_slot, .. } | Self::Switch { field_slot, .. } => *field_slot,
        }
    }
}

/// A complete, canonical command frontier ready for mechanics resolution.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NormalizedCommandSet {
    entries: Vec<NormalizedBattleCommand>,
}

impl NormalizedCommandSet {
    pub(crate) fn new(entries: Vec<NormalizedBattleCommand>) -> Self {
        Self { entries }
    }

    pub fn entries(&self) -> &[NormalizedBattleCommand] {
        &self.entries
    }

    pub fn into_entries(self) -> Vec<NormalizedBattleCommand> {
        self.entries
    }
}
