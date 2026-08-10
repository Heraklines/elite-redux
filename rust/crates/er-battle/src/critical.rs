//! Closed critical-hit resolution for the selected M3 battle slice.
//!
//! The caller supplies the already-resolved critical stage and causal gate.
//! This module does not inspect move attributes, abilities, or damage state.
//! A supported live roll always goes through `RngRuntime`, which owns battle
//! stream mutation and first-divergence audit evidence.

use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::RngRuntime;
use er_rng::phaser::RngError;
use er_types::SafeU53;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Critical denominators selected by the frozen oracle stage table.
pub const CRITICAL_ODDS: [u64; 4] = [24, 8, 2, 1];

/// Ordinary critical damage multiplier in the selected neutral slice.
pub const CRITICAL_HIT_MULTIPLIER: f64 = 1.5;

/// Closed causal gates supplied by the caller before critical resolution.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CriticalGate {
    /// The preceding hit check succeeded and the move may critically hit.
    Eligible,
    /// The preceding pipeline produced no effect or an ineligible target.
    NoEffect,
    /// The move or target is known not to reach critical resolution.
    Ineligible(CriticalIneligibleReason),
    /// The caller reached a critical mechanic outside this closed module.
    Unsupported(CriticalUnsupportedReason),
}

/// Typed no-draw branches that are outside a critical roll's eligibility.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CriticalIneligibleReason {
    SourceInactive,
    TargetInactive,
    MoveUnavailable,
    SignatureFollowUp,
    StatusMove,
}

/// Typed critical mechanics that must be selected explicitly before support.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CriticalUnsupportedReason {
    CriticalBlock,
    GuaranteedCritical,
    CustomCriticalMultiplier,
    CustomCriticalStage,
    FixedDamage,
    OneHitKo,
    MultiHit,
    UnsupportedMoveMode,
}

/// Why critical resolution was skipped without consuming a draw.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CriticalSkipReason {
    NoEffect,
    Ineligible(CriticalIneligibleReason),
}

/// Explicit closed input for one post-hit critical decision.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CriticalContext {
    /// The already-resolved oracle critical stage.  `new` accepts only [0, 3].
    pub critical_stage: i8,
    pub gate: CriticalGate,
}

impl CriticalContext {
    /// Creates a context from an already-resolved selected-slice stage.
    pub const fn new(critical_stage: i8, gate: CriticalGate) -> Self {
        Self {
            critical_stage,
            gate,
        }
    }

    /// Creates the ordinary stage-zero critical context.
    pub const fn ordinary() -> Self {
        Self::new(0, CriticalGate::Eligible)
    }

    /// Creates a context for an explicit selected-slice stage.
    pub const fn with_stage(critical_stage: i8, gate: CriticalGate) -> Self {
        Self::new(critical_stage, gate)
    }

    /// Applies the oracle's explicit clamp to a raw assembled critical stage.
    ///
    /// Callers that need fail-closed input validation should use [`Self::new`]
    /// and supply the already-resolved stage.  This constructor is the only
    /// place where an out-of-range raw oracle stage is intentionally reduced.
    pub fn from_oracle_stage(raw_stage: i8, gate: CriticalGate) -> Self {
        let critical_stage = raw_stage.clamp(0, 3);
        Self::new(critical_stage, gate)
    }

    /// Validates the closed stage domain before a gate or RNG operation.
    pub fn validate(&self) -> Result<(), CriticalContextError> {
        if !(0..=3).contains(&self.critical_stage) {
            return Err(CriticalContextError::StageOutOfRange {
                stage: self.critical_stage,
            });
        }
        Ok(())
    }

    /// Resolves the context through the single battle RNG/audit owner.
    pub fn resolve(&self, runtime: &mut RngRuntime) -> Result<CriticalDecision, CriticalError> {
        resolve_critical(self, runtime)
    }

    /// Evaluates a previously audited integer draw without mutating RNG state.
    ///
    /// Production resolution should use [`CriticalContext::resolve`], which
    /// obtains the draw from `RngRuntime` and records its reason and callsite.
    pub fn evaluate_draw(&self, draw: SafeU53) -> Result<CriticalDecision, CriticalError> {
        match self.plan()? {
            CriticalPlan::Skipped(decision) => Ok(decision),
            CriticalPlan::Roll(plan) => {
                if draw.get() >= plan.draw_cardinality.get() {
                    return Err(CriticalError::InvalidDraw {
                        draw: draw.get(),
                        cardinality: plan.draw_cardinality.get(),
                    });
                }
                Ok(decision_from_roll(plan, draw))
            }
        }
    }

    fn plan(&self) -> Result<CriticalPlan, CriticalError> {
        self.validate()?;

        match self.gate {
            CriticalGate::Unsupported(reason) => {
                return Err(CriticalError::Unsupported { reason });
            }
            CriticalGate::NoEffect => {
                return Ok(CriticalPlan::Skipped(CriticalDecision::Skipped(
                    CriticalSkipEvidence {
                        critical_stage: self.critical_stage,
                        reason: CriticalSkipReason::NoEffect,
                        multiplier: 1.0,
                    },
                )));
            }
            CriticalGate::Ineligible(reason) => {
                return Ok(CriticalPlan::Skipped(CriticalDecision::Skipped(
                    CriticalSkipEvidence {
                        critical_stage: self.critical_stage,
                        reason: CriticalSkipReason::Ineligible(reason),
                        multiplier: 1.0,
                    },
                )));
            }
            CriticalGate::Eligible => {}
        }

        let draw_cardinality = critical_draw_cardinality(self.critical_stage)?;
        Ok(CriticalPlan::Roll(CriticalRollPlan {
            critical_stage: self.critical_stage,
            draw_cardinality,
        }))
    }
}

/// Evidence for a no-draw critical branch.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CriticalSkipEvidence {
    pub critical_stage: i8,
    pub reason: CriticalSkipReason,
    pub multiplier: f64,
}

/// Evidence for a critical or noncritical roll and its exact audit seam.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CriticalRollEvidence {
    pub critical_stage: i8,
    pub draw_minimum: SafeU53,
    pub draw_cardinality: SafeU53,
    pub draw: SafeU53,
    pub consumed: bool,
    pub critical: bool,
    pub multiplier: f64,
    pub reason: RngReason,
    pub callsite_id: RngCallsiteId,
}

/// Typed critical outcome consumed by the damage pipeline.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    content = "evidence",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
pub enum CriticalDecision {
    Critical(CriticalRollEvidence),
    NonCritical(CriticalRollEvidence),
    Skipped(CriticalSkipEvidence),
}

impl CriticalDecision {
    /// Returns true only when the selected critical draw returned zero.
    pub fn is_critical(&self) -> bool {
        matches!(self, Self::Critical(_))
    }

    pub fn is_noncritical(&self) -> bool {
        matches!(self, Self::NonCritical(_))
    }

    pub fn multiplier(&self) -> f64 {
        match self {
            Self::Critical(evidence) | Self::NonCritical(evidence) => evidence.multiplier,
            Self::Skipped(evidence) => evidence.multiplier,
        }
    }

    pub fn draw(&self) -> Option<SafeU53> {
        match self {
            Self::Critical(evidence) | Self::NonCritical(evidence) => Some(evidence.draw),
            Self::Skipped(_) => None,
        }
    }

    pub fn roll_evidence(&self) -> Option<&CriticalRollEvidence> {
        match self {
            Self::Critical(evidence) | Self::NonCritical(evidence) => Some(evidence),
            Self::Skipped(_) => None,
        }
    }

    pub fn skipped_evidence(&self) -> Option<&CriticalSkipEvidence> {
        match self {
            Self::Skipped(evidence) => Some(evidence),
            Self::Critical(_) | Self::NonCritical(_) => None,
        }
    }
}

/// Context validation failure for a critical decision.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum CriticalContextError {
    #[error("critical stage {stage} is outside [0, 3]")]
    StageOutOfRange { stage: i8 },
}

/// Fail-closed critical resolution error.
#[derive(Debug, Error)]
pub enum CriticalError {
    #[error("invalid critical context: {0}")]
    InvalidContext(#[from] CriticalContextError),
    #[error("critical branch {reason:?} is outside the selected slice")]
    Unsupported { reason: CriticalUnsupportedReason },
    #[error("critical draw {draw} is outside the [0, {cardinality}) range")]
    InvalidDraw { draw: u64, cardinality: u64 },
    #[error("critical RNG range {value} is outside SafeU53")]
    RangeOverflow { value: u64 },
    #[error(transparent)]
    Rng(#[from] RngError),
}

#[derive(Debug)]
enum CriticalPlan {
    Skipped(CriticalDecision),
    Roll(CriticalRollPlan),
}

#[derive(Debug)]
struct CriticalRollPlan {
    critical_stage: i8,
    draw_cardinality: SafeU53,
}

fn critical_draw_cardinality(stage: i8) -> Result<SafeU53, CriticalError> {
    let odds = match stage {
        0 => CRITICAL_ODDS[0],
        1 => CRITICAL_ODDS[1],
        2 => CRITICAL_ODDS[2],
        3 => CRITICAL_ODDS[3],
        _ => {
            return Err(CriticalError::InvalidContext(
                CriticalContextError::StageOutOfRange { stage },
            ));
        }
    };
    SafeU53::new(odds).map_err(|_| CriticalError::RangeOverflow { value: odds })
}

/// Resolves one post-hit critical decision using the selected odds table.
pub fn resolve_critical(
    context: &CriticalContext,
    runtime: &mut RngRuntime,
) -> Result<CriticalDecision, CriticalError> {
    let plan = context.plan()?;
    match plan {
        CriticalPlan::Skipped(decision) => Ok(decision),
        CriticalPlan::Roll(plan) => {
            let draw = runtime.battle_rand_seed_int(
                plan.draw_cardinality,
                SafeU53::ZERO,
                RngReason::CriticalHit,
                RngCallsiteId::critical_hit(),
            )?;
            Ok(decision_from_roll(plan, draw))
        }
    }
}

fn decision_from_roll(plan: CriticalRollPlan, draw: SafeU53) -> CriticalDecision {
    let critical = draw == SafeU53::ZERO;
    let evidence = CriticalRollEvidence {
        critical_stage: plan.critical_stage,
        draw_minimum: SafeU53::ZERO,
        draw_cardinality: plan.draw_cardinality,
        draw,
        consumed: plan.draw_cardinality.get() > 1,
        critical,
        multiplier: if critical {
            CRITICAL_HIT_MULTIPLIER
        } else {
            1.0
        },
        reason: RngReason::CriticalHit,
        callsite_id: RngCallsiteId::critical_hit(),
    };
    if critical {
        CriticalDecision::Critical(evidence)
    } else {
        CriticalDecision::NonCritical(evidence)
    }
}
