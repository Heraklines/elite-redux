//! Public, fail-closed error surface for M3 battle resolution.

use er_canonical::CanonicalError;
use er_content::pack::ContentPackError;
use er_rng::phaser::RngError;
use er_state::digest::MechanicalDigestError;
use er_state::validation::StateValidationError;
use er_types::battle_model::CapabilitySubject;
use thiserror::Error;

use crate::legality::CommandLegalityError;

/// A failure found while validating the complete candidate transition.
#[derive(Debug, Error)]
pub enum BattleAfterStateFailure {
    #[error("candidate mechanical state is invalid: {0}")]
    State(#[source] StateValidationError),
    #[error("mutation evidence diverged from the candidate state at index {index}")]
    MutationEvidenceMismatch { index: usize },
    #[error("presentation sequence at index {index} is outside SafeU53")]
    PresentationSequenceOverflow { index: usize },
}

/// A resolver invariant failure that invalidates the whole staged transition.
#[derive(Debug, Error)]
pub enum BattleInvariantError {
    #[error("canonical state before battle resolution is invalid: {source}")]
    InvalidBeforeState {
        #[source]
        source: StateValidationError,
    },
    #[error("supported capability classification admitted an unsupported subject: {subject:?}")]
    UnsupportedEffectReached { subject: CapabilitySubject },
    #[error("candidate state after battle resolution is invalid: {source}")]
    InvalidAfterState {
        #[source]
        source: BattleAfterStateFailure,
    },
}

impl BattleInvariantError {
    pub fn invalid_before(source: StateValidationError) -> Self {
        Self::InvalidBeforeState { source }
    }

    pub fn invalid_after_state(source: StateValidationError) -> Self {
        Self::InvalidAfterState {
            source: BattleAfterStateFailure::State(source),
        }
    }

    pub fn mutation_evidence_mismatch(index: usize) -> Self {
        Self::InvalidAfterState {
            source: BattleAfterStateFailure::MutationEvidenceMismatch { index },
        }
    }

    pub fn presentation_sequence_overflow(index: usize) -> Self {
        Self::InvalidAfterState {
            source: BattleAfterStateFailure::PresentationSequenceOverflow { index },
        }
    }
}

/// Closed public error returned by both M3 battle resolvers.
#[derive(Debug, Error)]
pub enum BattleResolveError {
    #[error(transparent)]
    Invariant(#[from] BattleInvariantError),
    #[error(transparent)]
    Legality(CommandLegalityError),
    #[error(transparent)]
    Content(#[from] ContentPackError),
    #[error(transparent)]
    Rng(#[from] RngError),
    #[error(transparent)]
    Digest(#[from] MechanicalDigestError),
    #[error(transparent)]
    Canonical(#[from] CanonicalError),
}

impl From<CommandLegalityError> for BattleResolveError {
    fn from(source: CommandLegalityError) -> Self {
        match source {
            CommandLegalityError::State(source) => {
                BattleInvariantError::invalid_before(source).into()
            }
            CommandLegalityError::UnsupportedCapability { subject } => {
                BattleInvariantError::UnsupportedEffectReached { subject }.into()
            }
            CommandLegalityError::Content(source) => Self::Content(source),
            source => Self::Legality(source),
        }
    }
}
