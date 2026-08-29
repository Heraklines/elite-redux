//! Canonical Pokémon state and state-local invariants for M3.
//!
//! The leaf value types in this module are owned by `er-types` (M3A-02).  This
//! module deliberately re-exports those types instead of creating parallel
//! IDs or enums.  Battle-wide checks such as party membership, field
//! occupancy, content lookup, and owner-seat legality belong to later state
//! lanes.

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use er_types::SeatId;
pub use er_types::battle_ids::{AbilityId, MoveId, PokemonId, SpeciesId};
pub use er_types::battle_model::{
    AbilityLoadout, BattleStat, BattleStats, MoveSlotState, PokemonType, PokemonTyping, StatStages,
    StatusKind, StatusState,
};

/// The fixed number of move slots in a canonical Pokémon record.
pub const MOVE_SLOT_COUNT: usize = 4;

/// The fixed number of passive ability slots in a canonical Pokémon record.
pub const PASSIVE_ABILITY_SLOT_COUNT: usize = 3;

/// The lower bound for every canonical stat stage.
pub const MIN_STAT_STAGE: i8 = -6;

/// The upper bound for every canonical stat stage.
pub const MAX_STAT_STAGE: i8 = 6;

/// The inclusive upper bound for PP Ups in the selected M3 state.
pub const MAX_PP_UPS: u8 = 3;

/// The position of a type in effective typing.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TypingPosition {
    Primary,
    Secondary,
}

/// State-local errors for effective typing.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum TypingValidationError {
    #[error("effective typing repeats {pokemon_type:?}")]
    DuplicateType { pokemon_type: PokemonType },
    #[error("{position:?} Stellar typing is outside the selected M3 content")]
    StellarUnsupported { position: TypingPosition },
}

/// State-local errors for seven stat stages.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum StatStagesValidationError {
    #[error("{stat:?} stage {value} is outside [{min}, {max}]")]
    OutOfRange {
        stat: BattleStat,
        value: i8,
        min: i8,
        max: i8,
    },
}

/// State-local errors for status and its preserved companion fields.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum StatusValidationError {
    #[error("{kind:?} status must have toxic_turn_count == 0, got {value}")]
    ToxicTurnCountNotZero { kind: StatusKind, value: u16 },
    #[error("{kind:?} status must not carry sleep_turns_remaining")]
    SleepSubstateNotAllowed { kind: StatusKind },
    #[error("{kind:?} status mechanics are outside the selected M3 content")]
    UnsupportedStatus { kind: StatusKind },
}

/// State-local errors for the active and passive ability layout.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AbilityLoadoutValidationError {
    #[error("passive ability slot {slot} is empty but is marked suppressed")]
    EmptyPassiveSuppressed { slot: usize },
    #[error("ability suppression flags are outside the selected M3 content")]
    SuppressionUnsupported,
}

/// State-local errors for PP metadata and finite maximum-PP calculation.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum PpValidationError {
    #[error("PP Ups value {value} is outside 0..=3")]
    PpUpsOutOfRange { value: u8 },
    #[error("a max-PP override must be positive")]
    ZeroMaxPpOverride,
    #[error("selected move base PP must be positive")]
    ZeroBasePp,
    #[error("computed maximum PP does not fit in u16")]
    MaximumPpOverflow,
    #[error("PP used {pp_used} exceeds maximum PP {max_pp}")]
    PpUsedExceedsMaximum { pp_used: u16, max_pp: u16 },
}

/// Errors when checking a fixed move-slot collection against resolved content.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MoveSlotsValidationError {
    #[error("move slot {slot} is populated without a resolved base PP")]
    MissingBasePp { slot: usize },
    #[error("empty move slot {slot} has an unexpected resolved base PP")]
    UnexpectedBasePp { slot: usize },
    #[error("move slot {slot} is invalid: {source}")]
    InvalidSlot {
        slot: usize,
        #[source]
        source: PpValidationError,
    },
}

/// Errors for a canonical Pokémon record that can be checked without a
/// battle party, field, or immutable content pack.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum PokemonStateError {
    #[error("effective typing is invalid: {0}")]
    Typing(#[from] TypingValidationError),
    #[error("status is invalid: {0}")]
    Status(#[from] StatusValidationError),
    #[error("stat stages are invalid: {0}")]
    StatStages(#[from] StatStagesValidationError),
    #[error("ability loadout is invalid: {0}")]
    AbilityLoadout(#[from] AbilityLoadoutValidationError),
    #[error("maximum HP must be positive")]
    ZeroMaxHp,
    #[error("HP {hp} exceeds maximum HP {max_hp}")]
    HpExceedsMaximum { hp: u32, max_hp: u32 },
    #[error("fainted must be true exactly when HP is zero")]
    FaintedMismatch { hp: u32, fainted: bool },
    #[error("BattleStats.hp {stats_hp} must equal max_hp {max_hp}")]
    StatsHpMismatch { stats_hp: u32, max_hp: u32 },
    #[error("move slot {slot} is invalid: {source}")]
    MoveSlot {
        slot: usize,
        #[source]
        source: PpValidationError,
    },
    #[error("move slots are invalid: {0}")]
    MoveSlots(#[from] MoveSlotsValidationError),
}

/// The canonical M3 battle Pokémon record.
///
/// All fields are effective battle-boundary values.  Species base data and
/// other immutable content are intentionally not duplicated here.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PokemonState {
    pub id: PokemonId,
    pub owner_seat: Option<SeatId>,
    pub species_id: SpeciesId,
    pub form_index: u16,
    pub level: u16,
    pub types: PokemonTyping,
    pub stats: BattleStats,
    pub hp: u32,
    pub max_hp: u32,
    pub status: StatusState,
    pub stat_stages: StatStages,
    pub moves: [Option<MoveSlotState>; MOVE_SLOT_COUNT],
    pub abilities: AbilityLoadout,
    pub fainted: bool,
}

impl PokemonState {
    /// Construct a loadable M3 record and check every state-local invariant.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: PokemonId,
        owner_seat: Option<SeatId>,
        species_id: SpeciesId,
        form_index: u16,
        level: u16,
        types: PokemonTyping,
        stats: BattleStats,
        hp: u32,
        max_hp: u32,
        status: StatusState,
        stat_stages: StatStages,
        moves: [Option<MoveSlotState>; MOVE_SLOT_COUNT],
        abilities: AbilityLoadout,
        fainted: bool,
    ) -> Result<Self, PokemonStateError> {
        let state = Self {
            id,
            owner_seat,
            species_id,
            form_index,
            level,
            types,
            stats,
            hp,
            max_hp,
            status,
            stat_stages,
            moves,
            abilities,
            fainted,
        };
        state.validate()?;
        Ok(state)
    }

    /// Alias for callers that use the fallible-constructor naming convention.
    #[allow(clippy::too_many_arguments)]
    pub fn try_new(
        id: PokemonId,
        owner_seat: Option<SeatId>,
        species_id: SpeciesId,
        form_index: u16,
        level: u16,
        types: PokemonTyping,
        stats: BattleStats,
        hp: u32,
        max_hp: u32,
        status: StatusState,
        stat_stages: StatStages,
        moves: [Option<MoveSlotState>; MOVE_SLOT_COUNT],
        abilities: AbilityLoadout,
        fainted: bool,
    ) -> Result<Self, PokemonStateError> {
        Self::new(
            id,
            owner_seat,
            species_id,
            form_index,
            level,
            types,
            stats,
            hp,
            max_hp,
            status,
            stat_stages,
            moves,
            abilities,
            fainted,
        )
    }

    /// Validate representable canonical shape, including deferred enum values.
    ///
    /// Toxic, Sleep, Stellar typing, and structural suppression remain
    /// representable in the wire schema, but are rejected by [`Self::validate`]
    /// for the selected M3 mechanics slice.
    pub fn validate_representable(&self) -> Result<(), PokemonStateError> {
        validate_typing(&self.types)?;
        validate_status_state(&self.status)?;
        validate_stat_stages(&self.stat_stages)?;
        validate_ability_loadout(&self.abilities)?;
        validate_hp_and_faint(self.stats, self.hp, self.max_hp, self.fainted)?;

        for (slot, move_slot) in self.moves.iter().enumerate() {
            if let Some(move_slot) = move_slot {
                validate_move_slot_metadata(move_slot)
                    .map_err(|source| PokemonStateError::MoveSlot { slot, source })?;
            }
        }
        Ok(())
    }

    /// Validate the state-local subset of the selected M3 load boundary.
    ///
    /// The caller must still validate IDs against immutable content and
    /// owners/occupants against a battle format in the later owned lanes.
    pub fn validate(&self) -> Result<(), PokemonStateError> {
        self.validate_representable()?;
        validate_m3_typing(&self.types)?;
        validate_m3_status_state(&self.status)?;
        validate_m3_ability_loadout(&self.abilities)?;
        Ok(())
    }

    /// Validate the record and its PP usage against one resolved base-PP
    /// value per occupied move slot.
    pub fn validate_with_base_pps(
        &self,
        base_pps: [Option<u16>; MOVE_SLOT_COUNT],
    ) -> Result<(), PokemonStateError> {
        self.validate()?;
        validate_move_slots(&self.moves, base_pps)?;
        Ok(())
    }

    /// Validate a representable record and its PP usage without rejecting
    /// deferred Toxic/Sleep, Stellar, or suppression values.
    pub fn validate_representable_with_base_pps(
        &self,
        base_pps: [Option<u16>; MOVE_SLOT_COUNT],
    ) -> Result<(), PokemonStateError> {
        self.validate_representable()?;
        validate_move_slots(&self.moves, base_pps)?;
        Ok(())
    }
}

fn validate_hp_and_faint(
    stats: BattleStats,
    hp: u32,
    max_hp: u32,
    fainted: bool,
) -> Result<(), PokemonStateError> {
    if max_hp == 0 {
        return Err(PokemonStateError::ZeroMaxHp);
    }
    if hp > max_hp {
        return Err(PokemonStateError::HpExceedsMaximum { hp, max_hp });
    }
    if fainted != (hp == 0) {
        return Err(PokemonStateError::FaintedMismatch { hp, fainted });
    }
    if stats.hp != max_hp {
        return Err(PokemonStateError::StatsHpMismatch {
            stats_hp: stats.hp,
            max_hp,
        });
    }
    Ok(())
}

/// Validate that effective typing has one primary and at most one distinct
/// secondary type.  Stellar is accepted here because the shared wire enum
/// intentionally preserves deferred typing values.
pub fn validate_typing(typing: &PokemonTyping) -> Result<(), TypingValidationError> {
    if typing.secondary == Some(typing.primary) {
        return Err(TypingValidationError::DuplicateType {
            pokemon_type: typing.primary,
        });
    }
    Ok(())
}

/// Validate effective typing for the selected M3 mechanics slice.
pub fn validate_m3_typing(typing: &PokemonTyping) -> Result<(), TypingValidationError> {
    validate_typing(typing)?;
    if typing.primary == PokemonType::Stellar {
        return Err(TypingValidationError::StellarUnsupported {
            position: TypingPosition::Primary,
        });
    }
    if typing.secondary == Some(PokemonType::Stellar) {
        return Err(TypingValidationError::StellarUnsupported {
            position: TypingPosition::Secondary,
        });
    }
    Ok(())
}

/// Validate the seven canonical stat stages and their fixed order.
pub fn validate_stat_stages(stages: &StatStages) -> Result<(), StatStagesValidationError> {
    let values = [
        (BattleStat::Attack, stages.attack),
        (BattleStat::Defense, stages.defense),
        (BattleStat::SpecialAttack, stages.special_attack),
        (BattleStat::SpecialDefense, stages.special_defense),
        (BattleStat::Speed, stages.speed),
        (BattleStat::Accuracy, stages.accuracy),
        (BattleStat::Evasion, stages.evasion),
    ];
    for (stat, value) in values {
        if !(MIN_STAT_STAGE..=MAX_STAT_STAGE).contains(&value) {
            return Err(StatStagesValidationError::OutOfRange {
                stat,
                value,
                min: MIN_STAT_STAGE,
                max: MAX_STAT_STAGE,
            });
        }
    }
    Ok(())
}

/// Validate the preserved status companion fields for all representable
/// status kinds.  Unsupported kinds are intentionally not coerced or erased.
pub fn validate_status_state(status: &StatusState) -> Result<(), StatusValidationError> {
    match status.kind {
        StatusKind::None | StatusKind::Paralysis => {
            if status.toxic_turn_count != 0 {
                return Err(StatusValidationError::ToxicTurnCountNotZero {
                    kind: status.kind,
                    value: status.toxic_turn_count,
                });
            }
            if status.sleep_turns_remaining.is_some() {
                return Err(StatusValidationError::SleepSubstateNotAllowed { kind: status.kind });
            }
        }
        StatusKind::Burn | StatusKind::Poison => {
            if status.sleep_turns_remaining.is_some() {
                return Err(StatusValidationError::SleepSubstateNotAllowed { kind: status.kind });
            }
        }
        StatusKind::Toxic | StatusKind::Sleep => {
            // These values are retained as representable deferred state.  The
            // pinned oracle did not establish a sanitizer cross-field rule for
            // their companions, so validation must not invent one.
        }
    }
    Ok(())
}

/// Validate that status mechanics are in the selected M3 capability closure.
pub fn validate_m3_status_state(status: &StatusState) -> Result<(), StatusValidationError> {
    validate_status_state(status)?;
    if matches!(status.kind, StatusKind::Toxic | StatusKind::Sleep) {
        return Err(StatusValidationError::UnsupportedStatus { kind: status.kind });
    }
    Ok(())
}

/// Validate the four-slot ability layout without applying content lookup.
pub fn validate_ability_loadout(
    abilities: &AbilityLoadout,
) -> Result<(), AbilityLoadoutValidationError> {
    for (slot, (passive, suppressed)) in abilities
        .passives
        .iter()
        .zip(abilities.passive_suppressed.iter())
        .enumerate()
    {
        if passive.is_none() && *suppressed {
            return Err(AbilityLoadoutValidationError::EmptyPassiveSuppressed { slot });
        }
    }
    Ok(())
}

/// Validate the selected M3 structural ability-suppression policy.
pub fn validate_m3_ability_loadout(
    abilities: &AbilityLoadout,
) -> Result<(), AbilityLoadoutValidationError> {
    validate_ability_loadout(abilities)?;
    if abilities.active_suppressed || abilities.passive_suppressed.iter().any(|value| *value) {
        return Err(AbilityLoadoutValidationError::SuppressionUnsupported);
    }
    Ok(())
}

/// Convert a source max-PP override into canonical state metadata.  The
/// TypeScript `0` sentinel is absence, not a valid canonical override.
pub const fn normalize_max_pp_override(override_value: Option<u16>) -> Option<u16> {
    match override_value {
        Some(0) | None => None,
        Some(value) => Some(value),
    }
}

/// Calculate finite maximum PP using the pinned M3 formula.
pub fn calculate_max_pp(
    base_pp: u16,
    pp_ups: u8,
    max_pp_override: Option<u16>,
) -> Result<u16, PpValidationError> {
    if pp_ups > MAX_PP_UPS {
        return Err(PpValidationError::PpUpsOutOfRange { value: pp_ups });
    }
    if base_pp == 0 {
        return Err(PpValidationError::ZeroBasePp);
    }
    if let Some(max_pp) = normalize_max_pp_override(max_pp_override) {
        return Ok(max_pp);
    }

    let pp_bonus = u32::from((base_pp / 5).max(1));
    let maximum = u32::from(base_pp) + u32::from(pp_ups) * pp_bonus;
    u16::try_from(maximum).map_err(|_| PpValidationError::MaximumPpOverflow)
}

/// Validate metadata that is independent of the immutable move definition.
pub fn validate_move_slot_metadata(slot: &MoveSlotState) -> Result<(), PpValidationError> {
    if slot.pp_ups > MAX_PP_UPS {
        return Err(PpValidationError::PpUpsOutOfRange { value: slot.pp_ups });
    }
    if slot.max_pp_override == Some(0) {
        return Err(PpValidationError::ZeroMaxPpOverride);
    }
    Ok(())
}

/// Validate a move slot's PP usage against the resolved finite base PP.
pub fn validate_move_slot(slot: &MoveSlotState, base_pp: u16) -> Result<u16, PpValidationError> {
    validate_move_slot_metadata(slot)?;
    let max_pp = calculate_max_pp(base_pp, slot.pp_ups, slot.max_pp_override)?;
    if slot.pp_used > max_pp {
        return Err(PpValidationError::PpUsedExceedsMaximum {
            pp_used: slot.pp_used,
            max_pp,
        });
    }
    Ok(max_pp)
}

/// Return whether a valid finite-PP move can still be selected this turn.
pub fn move_slot_is_usable(slot: &MoveSlotState, base_pp: u16) -> Result<bool, PpValidationError> {
    let max_pp = validate_move_slot(slot, base_pp)?;
    Ok(slot.pp_used < max_pp)
}

/// Validate all four move slots against content-resolved base PP values.
pub fn validate_move_slots(
    moves: &[Option<MoveSlotState>; MOVE_SLOT_COUNT],
    base_pps: [Option<u16>; MOVE_SLOT_COUNT],
) -> Result<(), MoveSlotsValidationError> {
    for (slot, (move_slot, base_pp)) in moves.iter().zip(base_pps).enumerate() {
        match (move_slot, base_pp) {
            (None, None) => {}
            (None, Some(_)) => return Err(MoveSlotsValidationError::UnexpectedBasePp { slot }),
            (Some(_), None) => return Err(MoveSlotsValidationError::MissingBasePp { slot }),
            (Some(move_slot), Some(base_pp)) => {
                validate_move_slot(move_slot, base_pp)
                    .map_err(|source| MoveSlotsValidationError::InvalidSlot { slot, source })?;
            }
        }
    }
    Ok(())
}
