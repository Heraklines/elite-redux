//! Exact level-stat recomputation, ported from `src/field/pokemon.ts:calculateStats`.
//!
//! Parity rules:
//! - `floor((2 * base + iv) * level * 0.01)` per permanent stat, computed in
//!   `f64` exactly where the oracle uses JavaScript `Number`.
//! - HP adds `level + 10`; every other stat adds `5` before the nature factor.
//! - The nature factor applies to the post-increment value with `ceil` above
//!   `1.0` and `floor` below it, floored at `1` (`pokemon.ts:2169-2174`);
//!   neutral natures multiply by exactly `1.0`.
//! - Progression-owned flat bonuses are added after the nature factor, before
//!   the final clamp. Oracle evidence: the published progression fixture shows
//!   attack `27 -> 29` at level 16 under a neutral nature with an observed
//!   permanent attack bonus of `2`, while every other stat matches the bare
//!   formula.
//! - Final values clamp to at least `1` (`pokemon.ts:2178`).

use er_content::species::SpeciesBaseStats;
use er_state::pokemon_v2::PermanentStatBonuses;
use er_types::battle_model::BattleStats;

use crate::content::{NatureDefinition, NatureStat};

/// TypeScript nature factors (`getNatureStatMultiplier`): raised `+10%`,
/// lowered `-10%`, neutral exactly `1.0`.
const NATURE_RAISED: f64 = 1.1;
const NATURE_LOWERED: f64 = 0.9;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StatRecomputeError {
    LevelOutsideSupportedRange,
}

/// One axis of the six-entry permanent stat vector, in oracle order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StatAxis {
    Hp,
    Attack,
    Defense,
    SpecialAttack,
    SpecialDefense,
    Speed,
}

impl StatAxis {
    fn base(self, base: &SpeciesBaseStats) -> u32 {
        match self {
            Self::Hp => base.hp,
            Self::Attack => base.attack,
            Self::Defense => base.defense,
            Self::SpecialAttack => base.special_attack,
            Self::SpecialDefense => base.special_defense,
            Self::Speed => base.speed,
        }
    }

    fn bonus(self, bonuses: &PermanentStatBonuses) -> u32 {
        match self {
            Self::Hp => bonuses.hp,
            Self::Attack => bonuses.attack,
            Self::Defense => bonuses.defense,
            Self::SpecialAttack => bonuses.special_attack,
            Self::SpecialDefense => bonuses.special_defense,
            Self::Speed => bonuses.speed,
        }
    }

    fn nature_kind(self) -> Option<NatureStat> {
        match self {
            Self::Attack => Some(NatureStat::Attack),
            Self::Defense => Some(NatureStat::Defense),
            Self::SpecialAttack => Some(NatureStat::SpecialAttack),
            Self::SpecialDefense => Some(NatureStat::SpecialDefense),
            // HP has no nature axis in the frozen content table.
            Self::Hp | Self::Speed => None,
        }
    }
}

/// The exact nature factor for one axis under one frozen nature definition.
fn nature_factor(nature: &NatureDefinition, axis: StatAxis) -> f64 {
    let axis_kind = axis.nature_kind();
    if axis_kind.is_some() && nature.raised_stat == axis_kind {
        return NATURE_RAISED;
    }
    if axis_kind.is_some() && nature.lowered_stat == axis_kind {
        return NATURE_LOWERED;
    }
    1.0
}

/// Recomputes the complete six-entry stat vector for one Pokémon at `level`.
///
/// `ivs` are the six raw individual values in oracle axis order (HP, Attack,
/// Defense, Special Attack, Special Defense, Speed).
pub fn recompute_stats(
    base_stats: &SpeciesBaseStats,
    ivs: [u8; 6],
    level: u16,
    nature: &NatureDefinition,
    bonuses: &PermanentStatBonuses,
) -> Result<BattleStats, StatRecomputeError> {
    if !(1..=100).contains(&level) {
        // Production levels are hard-capped by game mode; the selected slice
        // never exceeds the classic cap of 100.
        return Err(StatRecomputeError::LevelOutsideSupportedRange);
    }
    const AXES: [StatAxis; 6] = [
        StatAxis::Hp,
        StatAxis::Attack,
        StatAxis::Defense,
        StatAxis::SpecialAttack,
        StatAxis::SpecialDefense,
        StatAxis::Speed,
    ];
    let mut values = [0u32; 6];
    for (index, axis) in AXES.iter().enumerate() {
        let raw =
            f64::from(axis.base(base_stats) * 2 + u32::from(ivs[index])) * f64::from(level) * 0.01;
        let mut value = raw.floor();
        if *axis == StatAxis::Hp {
            value += f64::from(level) + 10.0;
        } else {
            value += 5.0;
            let factor = nature_factor(nature, *axis);
            if factor != 1.0 {
                value = if factor > 1.0 {
                    (value * factor).ceil()
                } else {
                    (value * factor).floor()
                };
                if value < 1.0 {
                    value = 1.0;
                }
            }
        }
        value += f64::from(axis.bonus(bonuses));
        if value < 1.0 {
            value = 1.0;
        }
        values[index] = value as u32;
    }
    Ok(BattleStats {
        hp: values[0],
        attack: values[1],
        defense: values[2],
        special_attack: values[3],
        special_defense: values[4],
        speed: values[5],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::run_ids::NatureId;

    fn hardy() -> NatureDefinition {
        NatureDefinition {
            id: NatureId::new(0),
            key: "HARDY".to_owned(),
            raised_stat: None,
            lowered_stat: None,
        }
    }

    fn adamant() -> NatureDefinition {
        NatureDefinition {
            id: NatureId::new(3),
            key: "ADAMANT".to_owned(),
            raised_stat: Some(NatureStat::Attack),
            lowered_stat: Some(NatureStat::SpecialAttack),
        }
    }

    fn nacli_base() -> SpeciesBaseStats {
        SpeciesBaseStats {
            hp: 55,
            attack: 55,
            defense: 75,
            special_attack: 35,
            special_defense: 35,
            speed: 25,
        }
    }

    fn zero_bonuses() -> PermanentStatBonuses {
        PermanentStatBonuses {
            hp: 0,
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
        }
    }

    #[test]
    fn nacli_parity_vectors_match_published_fixture() {
        let ivs = [31u8; 6];
        let bare =
            recompute_stats(&nacli_base(), ivs, 16, &hardy(), &zero_bonuses()).expect("level 16");
        assert_eq!(
            [
                bare.hp,
                bare.attack,
                bare.defense,
                bare.special_attack,
                bare.special_defense,
                bare.speed
            ],
            [48, 27, 33, 21, 21, 17]
        );
        // Oracle evidence carries an observed permanent attack bonus of +2.
        let mut bonuses = zero_bonuses();
        bonuses.attack = 2;
        let level16 =
            recompute_stats(&nacli_base(), ivs, 16, &hardy(), &bonuses).expect("level 16");
        let level17 =
            recompute_stats(&nacli_base(), ivs, 17, &hardy(), &bonuses).expect("level 17");
        assert_eq!(
            [
                level16.hp,
                level16.attack,
                level16.defense,
                level16.special_attack,
                level16.special_defense,
                level16.speed
            ],
            [48, 29, 33, 21, 21, 17]
        );
        assert_eq!(
            [
                level17.hp,
                level17.attack,
                level17.defense,
                level17.special_attack,
                level17.special_defense,
                level17.speed
            ],
            [50, 30, 35, 22, 22, 18]
        );
    }

    #[test]
    fn raised_and_lowered_natures_use_exact_factors() {
        let stats = recompute_stats(&nacli_base(), [31u8; 6], 17, &adamant(), &zero_bonuses())
            .expect("level 17");
        // Bare attack 28 -> x1.1 ceil = 31; bare special attack 22 -> x0.9 floor = 19.
        assert_eq!(stats.attack, 31);
        assert_eq!(stats.special_attack, 19);
        // HP and untouched axes stay exact.
        assert_eq!(stats.hp, 50);
        assert_eq!(stats.defense, 35);
    }

    #[test]
    fn levels_outside_the_slice_are_typed_failures() {
        assert_eq!(
            recompute_stats(&nacli_base(), [31u8; 6], 0, &hardy(), &zero_bonuses()),
            Err(StatRecomputeError::LevelOutsideSupportedRange)
        );
    }
}
