//! Pure progression mechanics for the selected M4 slice.
//!
//! Contract: `rust/contracts/m4-progression.md`. Every function is total over
//! its inputs, consumes zero RNG, and returns closed typed evidence. The
//! caller stages results into a `PreparedRunTransition`; nothing here mutates
//! canonical state directly.

use er_types::battle_ids::{MoveId, SpeciesId};
use er_types::run_ids::Experience;
use er_types::SafeU53;

use crate::content::{GrowthRateKind, SpeciesProgressionDefinition};
use crate::experience;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProgressionError {
    LevelOutsideSupportedRange,
    CapBelowCurrentLevel,
    ExperienceOverflow,
}

/// One atomic experience award resolved against the level-cap threshold.
///
/// The oracle clamps the post-award total to the cap-level threshold exactly
/// as the published fixture shows: experience `4329`, award `70`, cap `17`
/// produces `4330` and a single level gain (`16 -> 17`).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExperienceGain {
    pub before: Experience,
    pub after: Experience,
    pub level_before: u16,
    pub level_after: u16,
}

impl ExperienceGain {
    /// The number of level boundaries crossed by this award.
    pub fn levels_gained(&self) -> u16 {
        self.level_after - self.level_before
    }
}

fn experience_from_u64(value: u64) -> Result<Experience, ProgressionError> {
    let inner = SafeU53::new(value).map_err(|_| ProgressionError::ExperienceOverflow)?;
    Ok(Experience::new(inner))
}

/// Applies one floored experience award under the active level cap.
///
/// The award is added with checked arithmetic (overflow is a typed failure,
/// never silent saturation), then the total is clamped to
/// `total_exp(cap_level)`. Levels advance across every threshold boundary
/// crossed, never past the cap itself.
pub fn apply_experience_award(
    before: Experience,
    award: Experience,
    level_before: u16,
    cap_level: u16,
    growth_rate: &GrowthRateKind,
) -> Result<ExperienceGain, ProgressionError> {
    if level_before == 0 || level_before > 100 || cap_level < level_before {
        return Err(ProgressionError::CapBelowCurrentLevel);
    }
    let capped = experience::level_total_exp(cap_level, growth_rate)
        .map_err(|_| ProgressionError::LevelOutsideSupportedRange)?;
    let candidate = before
        .get()
        .get()
        .checked_add(award.get().get())
        .ok_or(ProgressionError::ExperienceOverflow)?;
    let after_value = candidate.min(capped);
    let mut level_after = level_before;
    while level_after < cap_level {
        let next_threshold = experience::level_total_exp(level_after + 1, growth_rate)
            .map_err(|_| ProgressionError::LevelOutsideSupportedRange)?;
        if after_value >= next_threshold {
            level_after += 1;
        } else {
            break;
        }
    }
    Ok(ExperienceGain {
        before,
        after: experience_from_u64(after_value)?,
        level_before,
        level_after,
    })
}

/// Discovers every level-up move in `(old_level, new_level]` in oracle order.
///
/// Oracle order is the frozen content declaration order
/// (`SpeciesProgressionDefinition.level_moves`), which the content validator
/// already requires to be ascending by level.
pub fn discover_level_moves(
    species: &SpeciesProgressionDefinition,
    old_level: u16,
    new_level: u16,
) -> Vec<MoveId> {
    species
        .level_moves
        .iter()
        .filter(|entry| entry.level > old_level && entry.level <= new_level)
        .map(|entry| entry.move_id)
        .collect()
}

/// Returns the first evolution candidate reachable at `new_level`, if any.
///
/// A candidate aborts the complete progression preflight before anything
/// becomes visible; execution is deferred, never converted into a no-op.
pub fn evolution_candidate(
    species: &SpeciesProgressionDefinition,
    new_level: u16,
) -> Option<SpeciesId> {
    species
        .evolutions
        .iter()
        .find(|definition| new_level >= definition.minimum_level)
        .map(|definition| definition.target_species_id)
}

/// The growth-rate kind declared by every frozen progression definition in
/// this slice. The content validator fails closed on any other id.
pub const SLICE_GROWTH_KIND: GrowthRateKind = GrowthRateKind::MediumSlow;

/// Friendship delta applied on every level boundary. Oracle evidence:
/// friendship `50 -> 53` across the single parity level-up.
pub const LEVEL_UP_FRIENDSHIP_DELTA: u16 = 3;

/// Friendship after `levels_gained` boundaries, saturating at `u16::MAX`.
pub fn friendship_after_level_up(before: u16, levels_gained: u16) -> u16 {
    before.saturating_add(levels_gained.saturating_mul(LEVEL_UP_FRIENDSHIP_DELTA))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::{EvolutionDefinition, LevelMoveDefinition};
    use er_types::battle_ids::SpeciesId as SpeciesIdType;
    use er_types::run_ids::GrowthRateId;

    fn exp(value: u64) -> Experience {
        Experience::new(SafeU53::new(value).expect("safe exp"))
    }

    fn move_id(value: u64) -> MoveId {
        MoveId::new(SafeU53::new(value).expect("safe move"))
    }

    fn species_id(value: u64) -> SpeciesIdType {
        SpeciesIdType::new(SafeU53::new(value).expect("safe species"))
    }

    /// Mirrors the frozen Nacli entry in
    /// `rust/fixtures/m4/oracle/run-content-pack-v1.json`.
    fn nacli_progression() -> SpeciesProgressionDefinition {
        SpeciesProgressionDefinition {
            species_id: species_id(932),
            key: "NACLI".to_owned(),
            growth_rate: GrowthRateId::new(3),
            base_experience: 56,
            parity_level_before: 16,
            parity_level_after: 17,
            level_moves: vec![LevelMoveDefinition {
                level: 17,
                move_id: move_id(34),
            }],
            current_moves: [move_id(1), move_id(52), move_id(77), move_id(78)],
            evolutions: vec![EvolutionDefinition {
                target_species_id: species_id(933),
                minimum_level: 23,
            }],
        }
    }

    #[test]
    fn award_clamps_to_cap_threshold_like_the_oracle() {
        let gain =
            apply_experience_award(exp(4329), exp(70), 16, 17, &SLICE_GROWTH_KIND).expect("award");
        assert_eq!(gain.after.get().get(), 4330);
        assert_eq!(gain.level_before, 16);
        assert_eq!(gain.level_after, 17);
        assert_eq!(gain.levels_gained(), 1);
    }

    #[test]
    fn awards_below_the_next_threshold_keep_the_level() {
        let gain =
            apply_experience_award(exp(3600), exp(10), 16, 100, &SLICE_GROWTH_KIND).expect("award");
        assert_eq!(gain.after.get().get(), 3610);
        assert_eq!(gain.level_after, 16);
    }

    #[test]
    fn cap_below_current_level_is_rejected() {
        assert_eq!(
            apply_experience_award(exp(5000), exp(1), 17, 16, &SLICE_GROWTH_KIND),
            Err(ProgressionError::CapBelowCurrentLevel)
        );
    }

    #[test]
    fn level_moves_are_discovered_in_declaration_order() {
        let species = nacli_progression();
        let candidates = discover_level_moves(&species, 16, 17);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].get().get(), 34);
        assert!(discover_level_moves(&species, 17, 17).is_empty());
    }

    #[test]
    fn evolution_candidate_is_visible_but_not_executed() {
        let species = nacli_progression();
        assert!(evolution_candidate(&species, 16).is_none());
        assert_eq!(
            evolution_candidate(&species, 23).map(|target| target.get().get()),
            Some(933)
        );
    }

    #[test]
    fn friendship_uses_the_observed_delta() {
        assert_eq!(friendship_after_level_up(50, 1), 53);
        assert_eq!(friendship_after_level_up(u16::MAX, 3), u16::MAX);
    }
}
