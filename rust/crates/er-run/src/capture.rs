//! Deterministic capture, Poké Ball, and party ownership mechanics.
use std::collections::BTreeSet;

use er_state::m7_state::PokemonStateV5;
use er_types::battle_ids::PokemonId;
use serde::{Deserialize, Serialize};

pub const MAX_PER_TYPE_POKEBALLS_V1: u8 = 99;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PokeballTypeV1 {
    Poke,
    Great,
    Ultra,
    Rogue,
    Master,
    Luxury,
    Silver,
    Golden,
}

pub const fn pokeball_atlas_key_v1(ball: PokeballTypeV1) -> &'static str {
    match ball {
        PokeballTypeV1::Poke => "pb",
        PokeballTypeV1::Great => "gb",
        PokeballTypeV1::Ultra => "ub",
        PokeballTypeV1::Rogue => "rb",
        PokeballTypeV1::Master => "mb",
        PokeballTypeV1::Luxury => "lb",
        PokeballTypeV1::Silver => "sb",
        PokeballTypeV1::Golden => "goldb",
    }
}

pub const fn pokeball_name_key_v1(ball: PokeballTypeV1) -> &'static str {
    match ball {
        PokeballTypeV1::Poke => "pokeball:pokeBall",
        PokeballTypeV1::Great => "pokeball:greatBall",
        PokeballTypeV1::Ultra => "pokeball:ultraBall",
        PokeballTypeV1::Rogue => "pokeball:rogueBall",
        PokeballTypeV1::Master => "pokeball:masterBall",
        PokeballTypeV1::Luxury => "pokeball:luxuryBall",
        PokeballTypeV1::Silver => "pokeball:silverBall",
        PokeballTypeV1::Golden => "pokeball:goldenBall",
    }
}

pub const fn pokeball_tint_v1(ball: PokeballTypeV1) -> u32 {
    match ball {
        PokeballTypeV1::Poke | PokeballTypeV1::Rogue => 0xd52929,
        PokeballTypeV1::Great => 0x94b4de,
        PokeballTypeV1::Ultra => 0xe6cd31,
        PokeballTypeV1::Master => 0xa441bd,
        PokeballTypeV1::Luxury => 0xffde6a,
        PokeballTypeV1::Silver => 0xc0c0c0,
        PokeballTypeV1::Golden => 0xffd700,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CatchMultipliersV1 {
    pub poke: i64,
    pub great: i64,
    pub ultra: i64,
    pub rogue: i64,
    pub luxury: i64,
}

pub const fn pokeball_catch_multiplier_v1(ball: PokeballTypeV1, values: CatchMultipliersV1) -> i64 {
    match ball {
        PokeballTypeV1::Poke => values.poke,
        PokeballTypeV1::Great => values.great,
        PokeballTypeV1::Ultra => values.ultra,
        PokeballTypeV1::Rogue => values.rogue,
        PokeballTypeV1::Master | PokeballTypeV1::Golden => -1,
        PokeballTypeV1::Luxury => values.luxury,
        PokeballTypeV1::Silver => values.ultra,
    }
}

pub fn critical_capture_chance_v1(
    fresh_start: bool,
    daily: bool,
    dex_count: u32,
    charm_multiplier: u32,
    breakpoints: &[(u32, u32)],
    modified_catch_rate: u32,
) -> u32 {
    if fresh_start {
        return 0;
    }
    let mut dex_multiplier = 0;
    for (count, multiplier) in breakpoints {
        if dex_count > *count {
            dex_multiplier = *multiplier;
        }
    }
    if daily {
        dex_multiplier = breakpoints.last().map_or(0, |(_, multiplier)| *multiplier);
    }
    charm_multiplier
        .checked_mul(dex_multiplier)
        .and_then(|value| value.checked_mul(modified_catch_rate.min(255)))
        .map_or(0, |value| value / 6)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PokeballPresentationStepV1 {
    Fall { duration_ms: u32 },
    Bounce { duration_ms: u32 },
    CriticalShake { direction: i8, duration_ms: u32 },
    Delay { duration_ms: u32 },
    Complete,
}

pub fn pokeball_bounce_plan_v1(
    base_duration_ms: u32,
    critical: bool,
) -> Vec<PokeballPresentationStepV1> {
    let mut plan = Vec::new();
    if critical {
        plan.push(PokeballPresentationStepV1::Delay { duration_ms: 500 });
        for _ in 0..4 {
            plan.push(PokeballPresentationStepV1::CriticalShake {
                direction: -1,
                duration_ms: 125,
            });
            plan.push(PokeballPresentationStepV1::CriticalShake {
                direction: 1,
                duration_ms: 125,
            });
        }
        plan.push(PokeballPresentationStepV1::CriticalShake {
            direction: 0,
            duration_ms: 60,
        });
        plan.push(PokeballPresentationStepV1::Delay { duration_ms: 500 });
    }
    let mut numerator = 1_u32;
    while numerator > 0 {
        plan.push(PokeballPresentationStepV1::Fall {
            duration_ms: base_duration_ms.saturating_mul(numerator),
        });
        numerator /= 2;
        if numerator > 0 {
            plan.push(PokeballPresentationStepV1::Bounce {
                duration_ms: base_duration_ms.saturating_mul(numerator),
            });
        }
    }
    plan.push(PokeballPresentationStepV1::Complete);
    plan
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PokeballInventoryV1 {
    pub counts: Vec<(PokeballTypeV1, u8)>,
}

impl PokeballInventoryV1 {
    pub fn count(&self, ball: PokeballTypeV1) -> u8 {
        self.counts
            .iter()
            .find(|(candidate, _)| *candidate == ball)
            .map_or(0, |(_, count)| *count)
    }

    pub fn add(&mut self, ball: PokeballTypeV1, amount: u8) -> u8 {
        let entry = if let Some(index) = self
            .counts
            .iter()
            .position(|(candidate, _)| *candidate == ball)
        {
            &mut self.counts[index].1
        } else {
            self.counts.push((ball, 0));
            let last = self.counts.len() - 1;
            &mut self.counts[last].1
        };
        *entry = entry
            .checked_add(amount)
            .unwrap_or(MAX_PER_TYPE_POKEBALLS_V1)
            .min(MAX_PER_TYPE_POKEBALLS_V1);
        *entry
    }

    pub fn consume(&mut self, ball: PokeballTypeV1) -> bool {
        let Some((_, count)) = self
            .counts
            .iter_mut()
            .find(|(candidate, _)| *candidate == ball)
        else {
            return false;
        };
        let Some(next) = count.checked_sub(1) else {
            return false;
        };
        *count = next;
        true
    }
}

pub fn add_captured_pokemon_to_party_v1(
    party: &mut Vec<PokemonStateV5>,
    pokemon: PokemonStateV5,
    party_limit: usize,
) -> Result<(), Box<PokemonStateV5>> {
    if party.len() >= party_limit || party.iter().any(|member| member.id == pokemon.id) {
        return Err(Box::new(pokemon));
    }
    party.push(pokemon);
    Ok(())
}

pub fn should_add_encounter_pokemon_to_party_v1(party_len: usize, party_limit: usize) -> bool {
    party_len < party_limit
}

pub fn locally_owned_party_v1(
    party: &[PokemonStateV5],
    local_owner: Option<er_types::SeatId>,
) -> Vec<PokemonId> {
    party
        .iter()
        .filter(|pokemon| pokemon.owner_seat == local_owner)
        .map(|pokemon| pokemon.id)
        .collect()
}

pub fn party_luck_value_v1(party: &[PokemonStateV5]) -> u32 {
    party
        .iter()
        .map(|pokemon| u32::from(pokemon.variant) + u32::from(pokemon.shiny))
        .sum()
}

pub fn party_has_inaccurate_move_v1(accuracies: &[Option<u8>]) -> bool {
    accuracies
        .iter()
        .any(|accuracy| accuracy.is_some_and(|value| value < 100))
}

pub fn tactical_party_gate_v1(party: &[PokemonStateV5]) -> bool {
    !party.is_empty() && party.iter().any(|pokemon| !pokemon.fainted)
}

pub fn party_line_mega_stones_v1(lines: &[(u32, Option<String>)]) -> BTreeSet<String> {
    lines
        .iter()
        .filter_map(|(_, stone)| stone.clone())
        .collect()
}

pub fn should_grant_fun_capture_progress_v1(is_fun_mode: bool, is_rental: bool) -> bool {
    !is_fun_mode && !is_rental
}

pub fn migrate_party_v1_9_0(party: Vec<PokemonStateV5>) -> Vec<PokemonStateV5> {
    party
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pokeball_identity_critical_chance_and_presentation_are_deterministic() {
        assert_eq!(pokeball_atlas_key_v1(PokeballTypeV1::Ultra), "ub");
        assert_eq!(pokeball_tint_v1(PokeballTypeV1::Master), 0xa441bd);
        assert_eq!(
            critical_capture_chance_v1(false, false, 150, 1, &[(0, 1), (100, 2)], 120),
            40
        );
        assert_eq!(
            critical_capture_chance_v1(true, false, 999, 5, &[(0, 3)], 255),
            0
        );
        let plan = pokeball_bounce_plan_v1(100, true);
        assert!(matches!(
            plan.last(),
            Some(PokeballPresentationStepV1::Complete)
        ));
        assert_eq!(
            plan.iter()
                .filter(|step| matches!(step, PokeballPresentationStepV1::CriticalShake { .. }))
                .count(),
            9
        );
    }

    #[test]
    fn pokeball_inventory_is_bounded_and_consumed_once() {
        let mut inventory = PokeballInventoryV1 { counts: Vec::new() };
        assert_eq!(inventory.add(PokeballTypeV1::Poke, 98), 98);
        assert_eq!(inventory.add(PokeballTypeV1::Poke, 5), 99);
        assert!(inventory.consume(PokeballTypeV1::Poke));
        assert_eq!(inventory.count(PokeballTypeV1::Poke), 98);
        assert!(!inventory.consume(PokeballTypeV1::Great));
    }
}
