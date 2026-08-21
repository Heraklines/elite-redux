//! M4 run error taxonomy. Every failure is explicit and fail-closed.

use crate::capability::UnsupportedReasonCode;
use crate::rng_audit::RunRngError;
use er_state::validation_v2::StateValidationErrorV2;
use thiserror::Error;

/// Errors returned by pure run transitions and content preflight.
#[derive(Debug, Error)]
pub enum RunError {
    #[error("invalid state: {0}")]
    InvalidState(#[source] StateValidationErrorV2),
    #[error("invalid run stage")]
    InvalidStage,
    #[error("wrong source battle")]
    WrongSourceBattle,
    #[error("battle is already settled")]
    AlreadySettled,
    #[error("unsupported run content: {0}")]
    UnsupportedContent(UnsupportedReasonCode),
    #[error("invalid run action")]
    InvalidAction,
    #[error("insufficient money")]
    InsufficientMoney,
    #[error("invalid run target")]
    InvalidTarget,
    #[error("stale action ordinal")]
    StaleOrdinal,
    #[error("numeric overflow")]
    Overflow,
    #[error("evolution would trigger")]
    EvolutionWouldTrigger,
    #[error("encounter unavailable")]
    EncounterUnavailable,
    #[error("run RNG error: {0}")]
    Rng(#[source] RunRngError),
    #[error("content validation failed: {0}")]
    Content(#[source] crate::content::RunContentError),
}
