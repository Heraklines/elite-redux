//! M3A-07 owns canonical field topology and occupancy state.
//!
//! Field slots carry only a stable `PokemonId`; the complete Pokémon record
//! remains in one of the two party vectors.  The slot vector is a canonical
//! sorted wire representation, so admission rejects duplicate, missing, or
//! out-of-order topology rather than repairing it.

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

pub use er_types::battle_ids::{BattleSide, FieldSlot, MAX_FIELD_POSITION, PokemonId};

use crate::format::{BattleFormat, FormatTopologyError, canonical_slots, validate_slot};

/// One canonical field position and its optional occupant identity.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldSlotState {
    pub slot: FieldSlot,
    pub occupant: Option<PokemonId>,
}

impl FieldSlotState {
    pub const fn new(slot: FieldSlot, occupant: Option<PokemonId>) -> Self {
        Self { slot, occupant }
    }
}

/// Errors raised by field-local topology and occupancy checks.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum FieldStateError {
    #[error("field slot {slot:?} exceeds the shared topology bound {max}")]
    SlotPositionOutOfRange { slot: FieldSlot, max: u8 },
    #[error("field slots must be sorted by canonical side-then-position order")]
    UnsortedSlots,
    #[error("field slot {slot:?} appears more than once")]
    DuplicateSlot { slot: FieldSlot },
    #[error("Pokémon {pokemon:?} occupies more than one field slot")]
    DuplicateOccupant { pokemon: PokemonId },
    #[error("field state has {actual} slots but format requires {expected}")]
    SlotCountMismatch { expected: usize, actual: usize },
    #[error("field slot closure does not match the format at index {index}")]
    SlotClosureMismatch { index: usize },
    #[error("field slot {slot:?} is outside the format capacity")]
    SlotOutsideFormat { slot: FieldSlot },
    #[error("format topology is invalid: {0}")]
    Format(#[from] FormatTopologyError),
}

/// Canonical field occupancy for one battle.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FieldState {
    pub slots: Vec<FieldSlotState>,
}

impl FieldState {
    /// Construct a field state after checking canonical ordering and unique
    /// slot/occupant identity.  Format closure is checked separately with
    /// [`Self::new_for_format`] or [`Self::validate_for_format`].
    pub fn new(slots: Vec<FieldSlotState>) -> Result<Self, FieldStateError> {
        let state = Self { slots };
        state.validate()?;
        Ok(state)
    }

    /// Construct a field state whose slot vector is exactly closed over the
    /// supplied format.
    pub fn new_for_format(
        format: &BattleFormat,
        slots: Vec<FieldSlotState>,
    ) -> Result<Self, FieldStateError> {
        let state = Self::new(slots)?;
        state.validate_for_format(format)?;
        Ok(state)
    }

    /// Construct the canonical empty occupancy for a valid topology.
    pub fn empty_for_format(format: &BattleFormat) -> Result<Self, FieldStateError> {
        let slots = canonical_slots(format)?
            .into_iter()
            .map(|slot| FieldSlotState::new(slot, None))
            .collect();
        Self::new_for_format(format, slots)
    }

    /// Validate intrinsic field ordering and uniqueness constraints.
    pub fn validate(&self) -> Result<(), FieldStateError> {
        let mut occupants = std::collections::BTreeSet::new();
        for (index, entry) in self.slots.iter().enumerate() {
            if entry.slot.position > MAX_FIELD_POSITION {
                return Err(FieldStateError::SlotPositionOutOfRange {
                    slot: entry.slot,
                    max: MAX_FIELD_POSITION,
                });
            }
            if let Some(previous) = index.checked_sub(1).and_then(|i| self.slots.get(i)) {
                match previous.slot.cmp(&entry.slot) {
                    std::cmp::Ordering::Greater => {
                        return Err(FieldStateError::UnsortedSlots);
                    }
                    std::cmp::Ordering::Equal => {
                        return Err(FieldStateError::DuplicateSlot { slot: entry.slot });
                    }
                    std::cmp::Ordering::Less => {}
                }
            }
            if let Some(pokemon) = entry.occupant
                && !occupants.insert(pokemon)
            {
                return Err(FieldStateError::DuplicateOccupant { pokemon });
            }
        }
        Ok(())
    }

    /// Validate exact one-entry-per-slot closure against a format.
    pub fn validate_for_format(&self, format: &BattleFormat) -> Result<(), FieldStateError> {
        self.validate()?;
        let expected = canonical_slots(format)?;
        if self.slots.len() != expected.len() {
            return Err(FieldStateError::SlotCountMismatch {
                expected: expected.len(),
                actual: self.slots.len(),
            });
        }
        for (index, (actual, expected_slot)) in self.slots.iter().zip(expected).enumerate() {
            if actual.slot != expected_slot {
                return Err(FieldStateError::SlotClosureMismatch { index });
            }
        }
        Ok(())
    }

    /// Return the identity in a canonical slot after checking its capacity.
    pub fn occupant(
        &self,
        format: &BattleFormat,
        slot: FieldSlot,
    ) -> Result<Option<PokemonId>, FieldStateError> {
        validate_slot(format, slot).map_err(|error| match error {
            FormatTopologyError::SlotOutsideCapacity { slot } => {
                FieldStateError::SlotOutsideFormat { slot }
            }
            other => FieldStateError::Format(other),
        })?;
        Ok(self
            .slots
            .iter()
            .find(|entry| entry.slot == slot)
            .and_then(|entry| entry.occupant))
    }
}

impl<'de> Deserialize<'de> for FieldState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct FieldStateWire {
            slots: Vec<FieldSlotState>,
        }

        let wire = FieldStateWire::deserialize(deserializer)?;
        Self::new(wire.slots).map_err(serde::de::Error::custom)
    }
}
