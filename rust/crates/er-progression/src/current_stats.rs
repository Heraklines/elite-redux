//! Pinned Pokemon.calculateStats arithmetic after source-owned base-stat resolution.
//! This is not an admission check for modifiers, fusion, challenges or abilities.
//! Callers must resolve those before using this ordinary, unmodified path.

use er_content::species::SpeciesBaseStats;
use er_state::m7_state::PokemonStateV5;
use er_types::battle_model::{BattleStat, BattleStats};

use crate::{NatureDefinitionV1, progression::ProgressionError};

/// Match binary64 multiplication order and the source's asymmetric nature rounding.
/// Historical progression retains its separate arithmetic.
pub fn calculate_current_unmodified_stats(
    pokemon: &PokemonStateV5,
    base: SpeciesBaseStats,
    nature: &NatureDefinitionV1,
) -> Result<BattleStats, ProgressionError> {
    if pokemon.level == 0 || pokemon.effective_nature != nature.id {
        return Err(ProgressionError::Content);
    }
    let level = f64::from(pokemon.level);
    let initial = |base: u32, index: usize| {
        ((2.0 * f64::from(base) + f64::from(pokemon.ivs[index].get())) * level * 0.01)
            .floor()
    };
    let other = |base, index, stat| {
        let value = initial(base, index) + 5.0;
        let value = if nature.increased_stat == nature.decreased_stat {
            value
        } else if nature.increased_stat == Some(stat) {
            (value * 1.1).ceil().max(1.0)
        } else if nature.decreased_stat == Some(stat) {
            (value * 0.9).floor().max(1.0)
        } else {
            value
        };
        represented_stat(value)
    };
    Ok(BattleStats {
        hp: represented_stat(initial(base.hp, 0) + level + 10.0)?,
        attack: other(base.attack, 1, BattleStat::Attack)?,
        defense: other(base.defense, 2, BattleStat::Defense)?,
        special_attack: other(base.special_attack, 3, BattleStat::SpecialAttack)?,
        special_defense: other(base.special_defense, 4, BattleStat::SpecialDefense)?,
        speed: other(base.speed, 5, BattleStat::Speed)?,
    })
}

/// Source HP restoration uses old maximum HP and actual HP, not the faint flag.
/// It keeps zero HP at zero, adds maximum-HP growth only to living Pokemon and
/// clamps an existing HP value when the new maximum decreases.
pub fn current_hp_after_stat_calculation(hp: u32, old_max: u32, new_max: u32) -> Result<u32, ProgressionError> {
    if new_max == 0 { return Err(ProgressionError::Content); }
    if hp > new_max { return Ok(new_max); }
    if hp != 0 && old_max != 0 && new_max > old_max {
        return hp.checked_add(new_max - old_max).ok_or(ProgressionError::Overflow);
    }
    Ok(hp)
}

fn represented_stat(value: f64) -> Result<u32, ProgressionError> {
    let value = value.clamp(1.0, 9_007_199_254_740_991.0);
    // Canonical BattleStats currently has u32 storage. Reject rather than
    // saturating a valid source result that this schema cannot represent.
    if !value.is_finite() || value > f64::from(u32::MAX) || value.fract() != 0.0 {
        return Err(ProgressionError::Overflow);
    }
    Ok(value as u32)
}
