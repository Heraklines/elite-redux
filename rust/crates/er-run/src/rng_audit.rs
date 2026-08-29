//! Closed, deterministic run RNG audit records for the M4 run surfaces.
//!
//! A run draw is evidence, not a request to draw. Authority records these
//! values while generating a surface; replicas validate and adopt the record
//! without touching an RNG owner.

use er_rng::phaser::RunRngState;
use er_types::SafeU53;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// M4 run-owned RNG streams. The stream is part of the audit identity.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunRngStream {
    Run,
    Reward,
    Market,
    Biome,
    Encounter,
    Progression,
}

/// Closed reasons admitted by the M4 run-content slice.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunRngReason {
    RewardTier,
    RewardLuckUpgrade,
    RewardPoolIndex,
    RewardReroll,
    MarketStock,
    BiomeLength,
    RouteExtra,
    RoutePoolIndex,
    EncounterSelection,
    EncounterMaterialization,
    GrowthGeneration,
    StatGeneration,
}

/// Public Phaser helper represented by one run audit entry.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunRngPublicApi {
    RandSeedInt,
    IntegerInRange,
    Pick,
}

/// Whether the authority used an addressed stream or a retained ambient one.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunRngDomain {
    AuthorityAddressed,
    ExactAmbientState,
}

/// Validation failures for a typed run audit record/log.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RunRngError {
    #[error("run RNG sequence must be {expected}, got {actual}")]
    Sequence { expected: SafeU53, actual: SafeU53 },
    #[error("run RNG cardinality must be positive")]
    ZeroCardinality,
    #[error("run RNG result {result} is outside [{minimum}, {maximum}]")]
    ResultOutOfRange {
        minimum: SafeU53,
        maximum: SafeU53,
        result: SafeU53,
    },
    #[error("non-consuming run RNG draw changed its state")]
    NonConsumingStateChange,
    #[error("consuming run RNG draw has no changed state")]
    ConsumingStateUnchanged,
    #[error("run RNG primitive draw count is invalid for a non-consuming draw")]
    NonConsumingPrimitiveDraw,
    #[error("run RNG state is invalid: {0}")]
    State(String),
    #[error("run RNG sequence exhausted")]
    SequenceOverflow,
}

/// One complete typed run draw and its exact state frontier.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RunRngDraw {
    pub sequence: SafeU53,
    pub stream: RunRngStream,
    pub reason: RunRngReason,
    pub public_api: RunRngPublicApi,
    pub domain: RunRngDomain,
    pub minimum: SafeU53,
    pub cardinality: SafeU53,
    pub result: SafeU53,
    pub consumed: bool,
    pub primitive_draw_count: u8,
    pub before_state: RunRngState,
    pub after_state: RunRngState,
}

impl RunRngDraw {
    /// Constructs one draw and validates its closed range/state invariants.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        sequence: SafeU53,
        stream: RunRngStream,
        reason: RunRngReason,
        public_api: RunRngPublicApi,
        domain: RunRngDomain,
        minimum: SafeU53,
        cardinality: SafeU53,
        result: SafeU53,
        consumed: bool,
        primitive_draw_count: u8,
        before_state: RunRngState,
        after_state: RunRngState,
    ) -> Result<Self, RunRngError> {
        let draw = Self {
            sequence,
            stream,
            reason,
            public_api,
            domain,
            minimum,
            cardinality,
            result,
            consumed,
            primitive_draw_count,
            before_state,
            after_state,
        };
        draw.validate()?;
        Ok(draw)
    }

    /// Revalidates the draw before it is accepted into a material record.
    pub fn validate(&self) -> Result<(), RunRngError> {
        if self.cardinality == SafeU53::ZERO {
            return Err(RunRngError::ZeroCardinality);
        }
        let maximum = u64::from(self.minimum)
            .checked_add(u64::from(self.cardinality) - 1)
            .ok_or(RunRngError::ResultOutOfRange {
                minimum: self.minimum,
                maximum: SafeU53::MAX,
                result: self.result,
            })?;
        let maximum = SafeU53::new(maximum).map_err(|_| RunRngError::ResultOutOfRange {
            minimum: self.minimum,
            maximum: SafeU53::MAX,
            result: self.result,
        })?;
        let result = u64::from(self.result);
        if result < u64::from(self.minimum) || result > u64::from(maximum) {
            return Err(RunRngError::ResultOutOfRange {
                minimum: self.minimum,
                maximum,
                result: self.result,
            });
        }
        self.before_state
            .rdg
            .validate()
            .map_err(|error| RunRngError::State(error.to_string()))?;
        self.after_state
            .rdg
            .validate()
            .map_err(|error| RunRngError::State(error.to_string()))?;
        if self.consumed {
            if self.primitive_draw_count == 0 || self.before_state == self.after_state {
                return Err(RunRngError::ConsumingStateUnchanged);
            }
        } else if self.primitive_draw_count != 0 {
            return Err(RunRngError::NonConsumingPrimitiveDraw);
        } else if self.before_state != self.after_state {
            return Err(RunRngError::NonConsumingStateChange);
        }
        Ok(())
    }

    pub const fn is_authority_addressed(&self) -> bool {
        matches!(self.domain, RunRngDomain::AuthorityAddressed)
    }
}

/// Monotonic, append-only run draw audit owner.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RunRngAuditLog {
    draws: Vec<RunRngDraw>,
    next_sequence: Option<SafeU53>,
}

impl RunRngAuditLog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn draws(&self) -> &[RunRngDraw] {
        &self.draws
    }

    pub fn into_draws(self) -> Vec<RunRngDraw> {
        self.draws
    }

    pub fn push(&mut self, draw: RunRngDraw) -> Result<(), RunRngError> {
        draw.validate()?;
        if let Some(expected) = self.next_sequence {
            if draw.sequence != expected {
                return Err(RunRngError::Sequence {
                    expected,
                    actual: draw.sequence,
                });
            }
        }
        let next = u64::from(draw.sequence)
            .checked_add(1)
            .ok_or(RunRngError::SequenceOverflow)?;
        self.next_sequence = Some(SafeU53::new(next).map_err(|_| RunRngError::SequenceOverflow)?);
        self.draws.push(draw);
        Ok(())
    }
}
