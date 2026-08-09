//! M3A-07 owns supported single and double battle formats.
//!
//! `BattleFormat`, `FieldSlot`, and the closed topology values are owned by
//! `er-types` (M3A-02).  This module deliberately re-exports those values and
//! adds the state-layer helpers that describe M3 ownership and slot closure.

use thiserror::Error;

pub use er_types::battle_ids::{
    AdjacencyEdge, BattleFormat, BattleFormatError, BattleSide, FieldSlot, MAX_BATTLE_CAPACITY,
    MAX_FIELD_POSITION,
};
pub use er_types::{SafeU53, SeatId};

/// Errors raised while deriving canonical state topology from a format.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum FormatTopologyError {
    #[error("format is not a canonical topology: {0}")]
    InvalidFormat(#[from] BattleFormatError),
    #[error("format fields are not in canonical order")]
    NonCanonicalFormat,
    #[error("format {player_capacity}/{enemy_capacity} is outside the supported M3 topology")]
    UnsupportedM3Format {
        player_capacity: u8,
        enemy_capacity: u8,
    },
    #[error("field slot {slot:?} is outside the format capacity")]
    SlotOutsideCapacity { slot: FieldSlot },
}

/// Validate a public format value without silently normalizing its vectors.
pub fn validate_format(format: &BattleFormat) -> Result<(), FormatTopologyError> {
    let canonical = BattleFormat::new(
        format.player_capacity,
        format.enemy_capacity,
        format.adjacency.clone(),
    )
    .map_err(FormatTopologyError::InvalidFormat)?;
    if canonical != *format {
        return Err(FormatTopologyError::NonCanonicalFormat);
    }
    Ok(())
}

/// Return every representable slot in canonical side-then-position order.
pub fn canonical_slots(format: &BattleFormat) -> Result<Vec<FieldSlot>, FormatTopologyError> {
    validate_format(format)?;
    let mut slots = Vec::with_capacity(
        usize::from(format.player_capacity) + usize::from(format.enemy_capacity),
    );
    for position in 0..format.player_capacity {
        slots.push(FieldSlot {
            side: BattleSide::Player,
            position,
        });
    }
    for position in 0..format.enemy_capacity {
        slots.push(FieldSlot {
            side: BattleSide::Enemy,
            position,
        });
    }
    Ok(slots)
}

/// Return the player slots in canonical order.
pub fn canonical_player_slots(
    format: &BattleFormat,
) -> Result<Vec<FieldSlot>, FormatTopologyError> {
    Ok(canonical_slots(format)?
        .into_iter()
        .filter(|slot| slot.side == BattleSide::Player)
        .collect())
}

/// Return the enemy slots in canonical order.
pub fn canonical_enemy_slots(format: &BattleFormat) -> Result<Vec<FieldSlot>, FormatTopologyError> {
    Ok(canonical_slots(format)?
        .into_iter()
        .filter(|slot| slot.side == BattleSide::Enemy)
        .collect())
}

/// Validate a slot against the capacities encoded by a format.
pub fn validate_slot(format: &BattleFormat, slot: FieldSlot) -> Result<(), FormatTopologyError> {
    validate_format(format)?;
    let capacity = match slot.side {
        BattleSide::Player => format.player_capacity,
        BattleSide::Enemy => format.enemy_capacity,
    };
    if slot.position < capacity {
        Ok(())
    } else {
        Err(FormatTopologyError::SlotOutsideCapacity { slot })
    }
}

/// Validate that a format is one of the two M3-loadable topologies.
pub fn validate_m3_supported(format: &BattleFormat) -> Result<(), FormatTopologyError> {
    validate_format(format)?;
    match (format.player_capacity, format.enemy_capacity) {
        (1, 1) | (2, 2) => format
            .validate_m3_supported()
            .map_err(FormatTopologyError::InvalidFormat),
        (player_capacity, enemy_capacity) => Err(FormatTopologyError::UnsupportedM3Format {
            player_capacity,
            enemy_capacity,
        }),
    }
}

/// Return the human authority seats for a supported M3 format.
pub fn human_seats(format: &BattleFormat) -> Result<Vec<SeatId>, FormatTopologyError> {
    validate_m3_supported(format)?;
    match (format.player_capacity, format.enemy_capacity) {
        (1, 1) => Ok(vec![seat_id(1)]),
        (2, 2) => Ok(vec![seat_id(1), seat_id(2)]),
        (player_capacity, enemy_capacity) => Err(FormatTopologyError::UnsupportedM3Format {
            player_capacity,
            enemy_capacity,
        }),
    }
}

/// Return the fixed M3 owner for a player slot, or `None` for an enemy slot.
pub fn owner_seat_for(
    format: &BattleFormat,
    slot: FieldSlot,
) -> Result<Option<SeatId>, FormatTopologyError> {
    validate_m3_supported(format)?;
    validate_slot(format, slot)?;
    match slot.side {
        BattleSide::Player => Ok(Some(seat_id(u64::from(slot.position) + 1))),
        BattleSide::Enemy => Ok(None),
    }
}

/// Return whether a slot is a player-owned slot in the selected M3 format.
pub fn is_human_slot(format: &BattleFormat, slot: FieldSlot) -> Result<bool, FormatTopologyError> {
    Ok(owner_seat_for(format, slot)?.is_some())
}

fn seat_id(value: u64) -> SeatId {
    match SafeU53::new(value) {
        Ok(value) => SeatId::new(value),
        Err(_) => SeatId::ZERO,
    }
}
