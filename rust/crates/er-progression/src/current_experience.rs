//! Pure primitives for pinned 399d normal Classic experience semantics.
//!
//! No runtime calls these functions yet. `neutral_defeat_award` excludes Exp
//! Share, Exp Balance, participant bonuses, Pokerus, held/global XP boosters,
//! ability/Moody/coordinator multipliers, overrides, Mystery encounters, Daily
//! and Sprint. Callers must establish that scope; no unknown mechanic is
//! silently classified as neutral here. This module owns no persistent state.
use er_types::SafeU53;
use er_types::run_ids::Experience;
use thiserror::Error;

use crate::GrowthRateDefinitionV1;
use crate::progression::{ProgressionError, current_growth_experience_for_level};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExperienceForm {
    Other,
    Mega,
    MegaX,
    MegaY,
    Primal,
    Gigantamax,
    Eternamax,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrdinaryExperienceBattle {
    Wild,
    Trainer,
}

/// Values at the source enemy's actual defeated-Pokemon boundary. `form` is
/// classified from getSpeciesForm().getFormSpriteKey(), not a base-species name.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DefeatedExperienceSource {
    pub base_experience: SafeU53,
    pub level: u16,
    pub form: ExperienceForm,
    pub battle: OrdinaryExperienceBattle,
}

/// `participant_count` is the full battle participant-set cardinality. It must
/// not be recomputed from living recipients, below-cap recipients or the field.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NeutralExperienceRecipient {
    pub level: u16,
    pub hp: u32,
    pub participated: bool,
    pub participant_count: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExperiencePosition {
    pub level: u16,
    pub total: Experience,
}

#[derive(Debug, Error)]
pub enum CurrentExperienceError {
    #[error("normal Classic requires wave 1..=200 and positive Pokemon levels")]
    Input,
    #[error("experience arithmetic is not a canonical safe integer")]
    Overflow,
    #[error("current growth content is invalid: {0}")]
    Growth(#[from] ProgressionError),
}

/// getMaxExpLevelForWave with normal Classic's identity difficulty wave,
/// ordinary battle cap enabled and no override. No clamp/fallback for modes or
/// waves outside this explicitly supported domain.
pub fn normal_classic_level_cap(wave: u16) -> Result<u16, CurrentExperienceError> {
    if !(1..=200).contains(&wave) {
        return Err(CurrentExperienceError::Input);
    }
    let difficulty_wave = (f64::from(wave) / 10.0).ceil() * 10.0;
    let base = (1.0 + difficulty_wave / 2.0 + (difficulty_wave / 25.0).powi(2)) * 1.2;
    Ok(((base / 2.0).ceil() * 2.0 + 2.0) as u16)
}

/// Source enemy value after the ordinary trainer adjustment, before recipient
/// distribution. Wild values may be fractional. Keeping this boundary explicit
/// makes the trainer-before-distribution floor independently testable.
pub fn defeated_experience_value(
    source: DefeatedExperienceSource,
) -> Result<f64, CurrentExperienceError> {
    if source.level == 0 {
        return Err(CurrentExperienceError::Input);
    }
    let mut base = source.base_experience.get() as f64;
    if source.form != ExperienceForm::Other {
        base *= 1.5;
    }
    let mut value = (base * f64::from(source.level)) / 5.0 + 1.0;
    if source.battle == OrdinaryExperienceBattle::Trainer {
        value = (value * 1.5).floor();
    }
    Ok(value)
}
/// getExpValue -> applyPartyExp -> the neutral field/bench Exp phase.
/// Preserve the source's binary64 evaluation and floor order, including the
/// trainer floor BEFORE multiplying by the reciprocal participant count.
pub fn neutral_defeat_award(
    wave: u16,
    source: DefeatedExperienceSource,
    recipient: NeutralExperienceRecipient,
) -> Result<Experience, CurrentExperienceError> {
    let cap = normal_classic_level_cap(wave)?;
    if source.level == 0 || recipient.level == 0 {
        return Err(CurrentExperienceError::Input);
    }
    if recipient.participant_count == 0
        || recipient.hp == 0
        || recipient.level >= cap
        || !recipient.participated
    {
        return Ok(Experience::ZERO);
    }
    let value = defeated_experience_value(source)?;

    let multiplier = 1.0 / f64::from(recipient.participant_count);
    let award = (value * multiplier).floor();
    if !award.is_finite() || !(0.0..=9_007_199_254_740_991.0).contains(&award) {
        return Err(CurrentExperienceError::Overflow);
    }
    Ok(Experience::new(
        SafeU53::new(award as u64).map_err(|_| CurrentExperienceError::Overflow)?,
    ))
}

/// Pure addExp result under the same normal Classic cap. The caller owns stats,
/// progression tasks, participation, authoritative mutation and presentation.
/// Existing levels are never lowered, and reaching the cap discards new excess
/// while retaining previously accumulated experience exactly as the source does.
pub fn add_normal_classic_experience(
    growth: &GrowthRateDefinitionV1,
    before: ExperiencePosition,
    earned: Experience,
    wave: u16,
) -> Result<ExperiencePosition, CurrentExperienceError> {
    let cap = normal_classic_level_cap(wave)?;
    if before.level == 0 {
        return Err(CurrentExperienceError::Input);
    }
    current_growth_experience_for_level(growth, before.level)?;
    let total = before
        .total
        .get()
        .get()
        .checked_add(earned.get().get())
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or(CurrentExperienceError::Overflow)?;
    let mut after = ExperiencePosition {
        level: before.level,
        total: Experience::new(total),
    };
    while after.level < cap
        && after.total >= current_growth_experience_for_level(growth, after.level + 1)?
    {
        after.level += 1;
    }
    if after.level >= cap {
        after.total = current_growth_experience_for_level(growth, after.level)?.max(before.total);
    }
    Ok(after)
}
