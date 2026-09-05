//! Biome structure, Crossroads cadence, and route selection for the selected
//! M4 slice.
//!
//! Contract: `rust/contracts/m4-biome-encounter.md`. The structure roll is the
//! exact port of `src/data/elite-redux/er-biome-structure.ts:planErBiomeStructure`:
//! a local, addressable Phaser generator seeded with
//! `${run_seed}:er-biome-length:${start_wave}`, two inclusive `[7, 25]` draws,
//! and their maximum. Starts at or inside the finale-safety zone draw nothing.
//! Route selection validates both the node identity and the biome identity.

use er_rng::phaser::PhaserRdg;
use er_types::battle_ids::WaveIndex;
use er_types::run_ids::{BiomeId, RouteNodeId};

/// Minimum rolled biome length in waves (`BIOME_LENGTH_MIN`).
pub const BIOME_LENGTH_MIN: u16 = 7;
/// Maximum rolled biome length in waves and the hard cap (`BIOME_LENGTH_MAX`).
pub const BIOME_LENGTH_MAX: u16 = 25;
/// Waves before the run finale where variable length switches off.
pub const LATE_GAME_MARGIN: u16 = 30;
/// The classic mode final wave (`CLASSIC_FINAL_WAVE`).
pub const CLASSIC_FINAL_WAVE: u16 = 200;
/// First N in-biome waves run the global curve untouched (`NOTORIETY_FREE_WAVES`).
pub const NOTORIETY_FREE_WAVES: u16 = 10;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BiomeError {
    StartWaveOutsideSlice,
}

/// One pure structure plan as returned by the pinned TypeScript function.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BiomeStructurePlan {
    /// `None` means vanilla cadence (finale-safety fallback).
    pub length: Option<u16>,
    pub start_wave: WaveIndex,
}

fn late_game_threshold() -> u16 {
    CLASSIC_FINAL_WAVE - LATE_GAME_MARGIN
}

/// Port of `planErBiomeStructure(startWave, runSeed)`.
///
/// Consumes two draws from the addressed local stream so the structural
/// boundary cannot depend on unrelated RNG consumption before arena creation.
pub fn plan_er_biome_structure(
    start_wave: WaveIndex,
    run_seed: &str,
) -> Result<BiomeStructurePlan, BiomeError> {
    let start_value = start_wave.get().get();
    if start_value == 0 || start_value > u64::from(u16::MAX) {
        return Err(BiomeError::StartWaveOutsideSlice);
    }
    let start = start_value as u16;
    // Finale safety: never roll once at/inside the late zone or when the
    // biome's worst case could spill into it.
    if start >= late_game_threshold() || start + BIOME_LENGTH_MAX > late_game_threshold() {
        return Ok(BiomeStructurePlan {
            length: None,
            start_wave,
        });
    }
    let mut rng = PhaserRdg::from_seed(&format!("{run_seed}:er-biome-length:{start}"));
    let minimum = er_types::SafeU53::new(u64::from(BIOME_LENGTH_MIN)).expect("min");
    let maximum = er_types::SafeU53::new(u64::from(BIOME_LENGTH_MAX)).expect("max");
    let a = rng
        .integer_in_range(minimum, maximum)
        .map_err(|_| BiomeError::StartWaveOutsideSlice)?;
    let b = rng
        .integer_in_range(minimum, maximum)
        .map_err(|_| BiomeError::StartWaveOutsideSlice)?;
    Ok(BiomeStructurePlan {
        length: Some(a.get().max(b.get()) as u16),
        start_wave,
    })
}

/// Whether the Crossroads surface is offered at `wave` for a biome entered on
/// `start_wave`: every fifth in-biome wave, strictly before the biome cap.
///
/// Oracle evidence: Town entered on wave 1 raises the Crossroads at wave 10.
pub fn crossroads_due(start_wave: WaveIndex, wave: WaveIndex) -> bool {
    let start = start_wave.get().get();
    let current = wave.get().get();
    if current < start {
        return false;
    }
    let spent = (current - start + 1) as u16;
    spent.is_multiple_of(5)
}

/// Arms the overstay anchor exactly once, only when the player deliberately
/// stays past the free window. Returns `Some(anchor_wave)` on the first arm.
pub fn arm_overstay_anchor(
    existing: Option<WaveIndex>,
    start_wave: WaveIndex,
    wave: WaveIndex,
) -> Option<WaveIndex> {
    if existing.is_some() {
        return existing;
    }
    let spent = (wave.get().get() - start_wave.get().get() + 1) as u16;
    if spent >= NOTORIETY_FREE_WAVES {
        Some(wave)
    } else {
        existing
    }
}

/// One captured route option as offered by the authority.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RouteOption {
    pub route_node_id: RouteNodeId,
    pub biome: BiomeId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RouteSelectError {
    UnknownRouteNode,
    NodeBiomeMismatch,
    CurrentBiomeExcluded,
}

/// Validates a biome selection against the captured option set.
///
/// Both the route-node ID and the biome must match one captured option; the
/// destination may not equal the current biome (the oracle excludes current).
pub fn select_route(
    options: &[RouteOption],
    current_biome: BiomeId,
    route_node_id: RouteNodeId,
    biome: BiomeId,
) -> Result<RouteOption, RouteSelectError> {
    let option = options
        .iter()
        .find(|entry| entry.route_node_id == route_node_id)
        .ok_or(RouteSelectError::UnknownRouteNode)?;
    if option.biome != biome {
        return Err(RouteSelectError::NodeBiomeMismatch);
    }
    if biome == current_biome {
        return Err(RouteSelectError::CurrentBiomeExcluded);
    }
    Ok(*option)
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::SafeU53;

    fn wave(value: u64) -> WaveIndex {
        WaveIndex::new(SafeU53::new(value).expect("wave")).expect("positive wave")
    }

    #[test]
    fn town_structure_matches_the_captured_vector() {
        // Published fixture biomes/town-crossroads-route-v1.json asserts the
        // explicit vector: probe seed m4a-town-15, start wave 1, length 25.
        let plan = plan_er_biome_structure(wave(1), "m4a-town-15").expect("town structure");
        assert_eq!(plan.length, Some(25));
        assert_eq!(plan.start_wave.get().get(), 1);
    }

    #[test]
    fn determinism_is_addressed_by_seed_and_start_wave() {
        let first = plan_er_biome_structure(wave(1), "probe-a").expect("first");
        let second = plan_er_biome_structure(wave(1), "probe-a").expect("second");
        let other_seed = plan_er_biome_structure(wave(1), "probe-b").expect("other");
        let other_wave = plan_er_biome_structure(wave(2), "probe-a").expect("wave");
        assert_eq!(first, second);
        assert_ne!(first.length, other_seed.length);
        assert_ne!(first.length, other_wave.length);
    }

    #[test]
    fn lengths_stay_within_the_frozen_band() {
        for start in [1u64, 5, 40, 100] {
            let plan = plan_er_biome_structure(wave(start), "band-check").expect("plan");
            let length = plan.length.expect("rolled before the late zone");
            assert!((BIOME_LENGTH_MIN..=BIOME_LENGTH_MAX).contains(&length));
        }
    }

    #[test]
    fn finale_safety_disables_variable_length() {
        // At/inside threshold 170 and worst-case spillover both fall back.
        let at_threshold = plan_er_biome_structure(wave(170), "s").expect("170");
        assert_eq!(at_threshold.length, None);
        let spillover = plan_er_biome_structure(wave(146), "s").expect("146");
        assert_eq!(spillover.length, None); // 146 + 25 - 1 = 170 >= 170
        let just_safe = plan_er_biome_structure(wave(145), "s").expect("145");
        assert!(just_safe.length.is_some()); // worst case ends at 169 < 170
    }

    #[test]
    fn crossroads_rises_on_the_captured_cadence() {
        // Town entered wave 1 offers the Crossroads at wave 10.
        assert!(crossroads_due(wave(1), wave(10)));
        assert!(!crossroads_due(wave(1), wave(9)));
        assert!(!crossroads_due(wave(1), wave(11)));
    }

    #[test]
    fn overstay_arms_once_at_ten_spent_waves() {
        assert_eq!(arm_overstay_anchor(None, wave(1), wave(9)), None);
        assert_eq!(arm_overstay_anchor(None, wave(1), wave(10)), Some(wave(10)));
        // A second stay cannot move an armed anchor.
        assert_eq!(
            arm_overstay_anchor(Some(wave(10)), wave(1), wave(15)),
            Some(wave(10))
        );
    }

    #[test]
    fn route_selection_validates_both_identities() {
        let options = [RouteOption {
            route_node_id: RouteNodeId::new(SafeU53::new(1).expect("node")),
            biome: BiomeId::new(SafeU53::new(1).expect("biome")),
        }];
        let town = BiomeId::new(SafeU53::new(0).expect("town"));
        let plains = BiomeId::new(SafeU53::new(1).expect("plains"));
        assert!(select_route(&options, town, options[0].route_node_id, plains).is_ok());
        assert_eq!(
            select_route(&options, town, RouteNodeId::ZERO, plains),
            Err(RouteSelectError::UnknownRouteNode)
        );
        assert_eq!(
            select_route(&options, town, options[0].route_node_id, town),
            Err(RouteSelectError::NodeBiomeMismatch)
        );
        assert_eq!(
            select_route(&options, plains, options[0].route_node_id, plains),
            Err(RouteSelectError::CurrentBiomeExcluded)
        );
    }
}
