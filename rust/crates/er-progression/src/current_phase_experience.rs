//! Resolved numeric boundary of the pinned field and bench XP phases.
//!
//! Callers supply actual ordered global boosters and already queried ability,
//! Moody and coordinator results. This does not query those owners, apply XP,
//! advance levels, award coordinator effects, or settle pending battle ownership.
use thiserror::Error;

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlobalExperienceBooster {
    /// Constructor argument from the actual source modifier, before * 0.01.
    pub boost_percent: f64,
    pub stacks: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ResolvedExperiencePhase {
    Field {
        ability: f64,
        moody: f64,
        coordinator: f64,
    },
    /// The source bench phase does not call Moody or coordinator consumers.
    Party { ability: f64 },
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum PhaseExperienceError {
    #[error("resolved XP phase input is outside the admitted source domain")]
    Input,
    #[error("resolved XP arithmetic exceeds the finite nonnegative safe-integer domain")]
    Overflow,
}

fn admitted(value: f64) -> bool {
    value.is_finite() && (0.0..=MAX_SAFE_INTEGER).contains(&value)
}

pub fn resolve_phase_experience(
    phase_argument: f64,
    boosters: &[GlobalExperienceBooster],
    phase: ResolvedExperiencePhase,
) -> Result<f64, PhaseExperienceError> {
    let factors = match phase {
        ResolvedExperiencePhase::Field {
            ability,
            moody,
            coordinator,
        } => [ability, moody, coordinator],
        ResolvedExperiencePhase::Party { ability } => [ability, 1.0, 1.0],
    };
    if !admitted(phase_argument) || factors.iter().any(|value| !admitted(*value)) {
        return Err(PhaseExperienceError::Input);
    }
    for booster in boosters {
        if !admitted(booster.boost_percent) {
            return Err(PhaseExperienceError::Input);
        }
        let multiplier = booster.boost_percent * 0.01;
        let maximum = if multiplier < 0.6 {
            99
        } else if multiplier < 1.0 {
            30
        } else {
            10
        };
        if booster.stacks > maximum {
            return Err(PhaseExperienceError::Input);
        }
    }
    let mut amount = phase_argument;
    for booster in boosters {
        let multiplier = booster.boost_percent * 0.01;
        amount = (amount * (1.0 + f64::from(booster.stacks) * multiplier)).floor();
        if !admitted(amount) {
            return Err(PhaseExperienceError::Overflow);
        }
    }
    // Preserve the source expression's grouping: build the field product first.
    let multiplier = match phase {
        ResolvedExperiencePhase::Field {
            ability,
            moody,
            coordinator,
        } => ability * moody * coordinator,
        ResolvedExperiencePhase::Party { ability } => ability,
    };
    amount = (amount * multiplier).floor();
    if !admitted(multiplier) || !admitted(amount) {
        return Err(PhaseExperienceError::Overflow);
    }
    Ok(amount)
}
