//! M3A-07 owns canonical field and side-condition state.
//!
//! The serializable condition values themselves are dependency-leaf DTOs in
//! `er-types`.  This module re-exports those exact values and provides only
//! the state-local admission checks for the M3 neutral condition boundary.

use thiserror::Error;

pub use er_types::battle_model::{
    AbilitySuppressionSource, ArenaConditionScope, ArenaConditionState,
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};

/// Errors raised when condition state is checked without a content pack.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ConditionStateError {
    #[error("active weather kind {kind:?} is outside the selected M3 condition slice")]
    UnsupportedWeather { kind: WeatherKind },
    #[error("active terrain kind {kind:?} is outside the selected M3 condition slice")]
    UnsupportedTerrain { kind: TerrainKind },
    #[error("arena conditions are outside the selected M3 condition slice")]
    UnsupportedArenaConditions,
    #[error("global ability suppression is outside the selected M3 condition slice")]
    UnsupportedGlobalAbilitySuppression,
}

/// Validate the closed weather shape for the selected M3 mechanics slice.
///
/// Unsupported oracle codes remain representable and are deliberately not
/// normalized.  They are rejected here at the M3 load boundary.
pub fn validate_m3_weather(weather: &WeatherState) -> Result<(), ConditionStateError> {
    if weather.kind != WeatherKind::None {
        return Err(ConditionStateError::UnsupportedWeather {
            kind: weather.kind.clone(),
        });
    }
    Ok(())
}

/// Validate the closed terrain shape for the selected M3 mechanics slice.
pub fn validate_m3_terrain(terrain: &TerrainState) -> Result<(), ConditionStateError> {
    if terrain.kind != TerrainKind::None {
        return Err(ConditionStateError::UnsupportedTerrain {
            kind: terrain.kind.clone(),
        });
    }
    Ok(())
}

/// Validate the neutral arena-condition list required by M3 initialization.
///
/// The list is intentionally not rewritten.  In particular, `Both` scope is
/// preserved by the shared closed DTO and any active condition fails closed.
pub fn validate_m3_arena_conditions(
    arena_conditions: &[ArenaConditionState],
) -> Result<(), ConditionStateError> {
    if arena_conditions.is_empty() {
        Ok(())
    } else {
        Err(ConditionStateError::UnsupportedArenaConditions)
    }
}

/// Validate the explicit disabled global-ability-suppression state required
/// by M3 initialization.
pub fn validate_m3_global_ability_suppression(
    suppression: &GlobalAbilitySuppressionState,
) -> Result<(), ConditionStateError> {
    if !suppression.ignore_abilities && suppression.source.is_none() {
        Ok(())
    } else {
        Err(ConditionStateError::UnsupportedGlobalAbilitySuppression)
    }
}

/// Validate all M3-loadable field conditions without erasing unsupported
/// values from the representable schema.
pub fn validate_m3_conditions(
    weather: &WeatherState,
    terrain: &TerrainState,
    arena_conditions: &[ArenaConditionState],
    global_ability_suppression: &GlobalAbilitySuppressionState,
) -> Result<(), ConditionStateError> {
    validate_m3_weather(weather)?;
    validate_m3_terrain(terrain)?;
    validate_m3_arena_conditions(arena_conditions)?;
    validate_m3_global_ability_suppression(global_ability_suppression)?;
    Ok(())
}
