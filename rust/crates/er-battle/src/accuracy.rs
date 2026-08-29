//! Closed accuracy resolution for the selected M3 battle slice.
//!
//! The caller supplies the already-resolved move accuracy, stat stages, and
//! causal eligibility gate.  This module does not inspect battle state or
//! resolve type effectiveness; those decisions belong to the surrounding
//! pipeline.  A live accuracy roll always goes through `RngRuntime`, which is
//! the sole owner of battle-stream mutation and audit allocation.

use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::RngRuntime;
use er_rng::phaser::RngError;
use er_types::SafeU53;
use er_types::battle_model::MoveAccuracy;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The only accuracy roll cardinality in the ordinary selected slice.
pub const ACCURACY_DRAW_CARDINALITY: u64 = 100;

/// Closed causal gates supplied by the caller before accuracy resolution.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccuracyGate {
    /// The target is present and the move may consult ordinary accuracy.
    Eligible,
    /// Type/ability resolution already produced a no-effect target result.
    NoEffect,
    /// The action cannot currently resolve against this target.
    Ineligible(AccuracyIneligibleReason),
    /// The caller reached a mechanic outside this closed module.
    Unsupported(AccuracyUnsupportedReason),
}

/// Typed ineligible branches that do not consume an accuracy draw.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccuracyIneligibleReason {
    SourceInactive,
    TargetInactive,
    SourceMoveUnavailable,
    TargetUnavailable,
}

/// Typed unsupported branches.  These are errors, not silent hit results.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccuracyUnsupportedReason {
    AccuracyBypass,
    CustomAccuracyModifier,
    FixedDamage,
    OneHitKo,
    MultiHit,
    UnsupportedTargeting,
}

/// Why ordinary accuracy was skipped without a draw.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccuracySkipReason {
    AlwaysHits,
    NoEffect,
    Ineligible(AccuracyIneligibleReason),
}

/// Explicit closed input for one target's accuracy gate.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AccuracyContext {
    pub move_accuracy: MoveAccuracy,
    pub source_accuracy_stage: i8,
    pub target_evasion_stage: i8,
    pub gate: AccuracyGate,
}

impl AccuracyContext {
    /// Creates a context from the normalized content accuracy representation.
    pub const fn new(
        move_accuracy: MoveAccuracy,
        source_accuracy_stage: i8,
        target_evasion_stage: i8,
        gate: AccuracyGate,
    ) -> Self {
        Self {
            move_accuracy,
            source_accuracy_stage,
            target_evasion_stage,
            gate,
        }
    }

    /// Creates an ordinary percentage-accuracy context.
    pub const fn ordinary(
        accuracy_percent: u8,
        source_accuracy_stage: i8,
        target_evasion_stage: i8,
        gate: AccuracyGate,
    ) -> Self {
        Self::new(
            MoveAccuracy::Percent(accuracy_percent),
            source_accuracy_stage,
            target_evasion_stage,
            gate,
        )
    }

    /// Creates a normalized always-hit context.
    pub const fn always_hits(
        source_accuracy_stage: i8,
        target_evasion_stage: i8,
        gate: AccuracyGate,
    ) -> Self {
        Self::new(
            MoveAccuracy::AlwaysHits,
            source_accuracy_stage,
            target_evasion_stage,
            gate,
        )
    }

    /// Validates values that are normally guaranteed by the selected state.
    pub fn validate(&self) -> Result<(), AccuracyContextError> {
        if let MoveAccuracy::Percent(accuracy) = &self.move_accuracy
            && !(1..=100).contains(accuracy)
        {
            return Err(AccuracyContextError::InvalidBaseAccuracy {
                accuracy: *accuracy,
            });
        }
        if !(-6..=6).contains(&self.source_accuracy_stage) {
            return Err(AccuracyContextError::InvalidSourceAccuracyStage {
                stage: self.source_accuracy_stage,
            });
        }
        if !(-6..=6).contains(&self.target_evasion_stage) {
            return Err(AccuracyContextError::InvalidTargetEvasionStage {
                stage: self.target_evasion_stage,
            });
        }
        Ok(())
    }

    /// Resolves the context through the single battle RNG/audit owner.
    pub fn resolve(&self, runtime: &mut RngRuntime) -> Result<AccuracyDecision, AccuracyError> {
        resolve_accuracy(self, runtime)
    }

    /// Evaluates a previously audited integer draw without mutating RNG state.
    ///
    /// This is useful for deterministic replay/audit consumers.  Production
    /// resolution should use [`AccuracyContext::resolve`], which obtains the
    /// draw from `RngRuntime` and records its closed reason and callsite.
    pub fn evaluate_draw(&self, draw: SafeU53) -> Result<AccuracyDecision, AccuracyError> {
        let plan = self.plan()?;
        match plan {
            AccuracyPlan::Skipped(decision) => Ok(decision),
            AccuracyPlan::Roll(plan) => {
                if draw.get() >= ACCURACY_DRAW_CARDINALITY {
                    return Err(AccuracyError::InvalidDraw { draw: draw.get() });
                }
                let cardinality = accuracy_draw_cardinality()?;
                Ok(decision_from_roll(plan, draw, cardinality))
            }
        }
    }

    fn plan(&self) -> Result<AccuracyPlan, AccuracyError> {
        self.validate()?;

        match self.gate {
            AccuracyGate::Unsupported(reason) => {
                return Err(AccuracyError::Unsupported { reason });
            }
            AccuracyGate::NoEffect => {
                return Ok(AccuracyPlan::Skipped(AccuracyDecision::Skipped(
                    AccuracySkipEvidence {
                        reason: AccuracySkipReason::NoEffect,
                        move_accuracy: self.move_accuracy.clone(),
                        source_accuracy_stage: self.source_accuracy_stage,
                        target_evasion_stage: self.target_evasion_stage,
                    },
                )));
            }
            AccuracyGate::Ineligible(reason) => {
                return Ok(AccuracyPlan::Skipped(AccuracyDecision::Skipped(
                    AccuracySkipEvidence {
                        reason: AccuracySkipReason::Ineligible(reason),
                        move_accuracy: self.move_accuracy.clone(),
                        source_accuracy_stage: self.source_accuracy_stage,
                        target_evasion_stage: self.target_evasion_stage,
                    },
                )));
            }
            AccuracyGate::Eligible => {}
        }

        if matches!(&self.move_accuracy, MoveAccuracy::AlwaysHits) {
            return Ok(AccuracyPlan::Skipped(AccuracyDecision::Skipped(
                AccuracySkipEvidence {
                    reason: AccuracySkipReason::AlwaysHits,
                    move_accuracy: self.move_accuracy.clone(),
                    source_accuracy_stage: self.source_accuracy_stage,
                    target_evasion_stage: self.target_evasion_stage,
                },
            )));
        }

        let MoveAccuracy::Percent(accuracy_percent) = &self.move_accuracy else {
            return Err(AccuracyError::InvalidContext(
                AccuracyContextError::InvalidAccuracyEncoding,
            ));
        };

        // The oracle caps the source ACC stage at +6 before comparing it with
        // target EVA.  Target EVA is intentionally not capped at this point;
        // the selected state validator supplies its [-6, +6] storage bound.
        let source_stage = self.source_accuracy_stage.min(6);
        let raw_difference = source_stage - self.target_evasion_stage;
        let stage_difference = raw_difference.clamp(-6, 6);

        let stage_multiplier = if stage_difference == 0 {
            1.0
        } else if stage_difference > 0 {
            let capped_difference = f64::from(stage_difference);
            (3.0 + capped_difference) / 3.0
        } else {
            let capped_difference = f64::from(-stage_difference);
            3.0 / (3.0 + capped_difference)
        };
        let threshold = f64::from(*accuracy_percent) * stage_multiplier;
        if !stage_multiplier.is_finite() || !threshold.is_finite() {
            return Err(AccuracyError::InvalidContext(
                AccuracyContextError::NonFiniteCalculation,
            ));
        }

        Ok(AccuracyPlan::Roll(AccuracyRollPlan {
            move_accuracy: self.move_accuracy.clone(),
            source_accuracy_stage: self.source_accuracy_stage,
            target_evasion_stage: self.target_evasion_stage,
            stage_difference,
            stage_multiplier,
            threshold,
        }))
    }
}

/// A successful or failed ordinary accuracy roll and all formula evidence.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AccuracyRollEvidence {
    pub move_accuracy: MoveAccuracy,
    pub source_accuracy_stage: i8,
    pub target_evasion_stage: i8,
    pub stage_difference: i8,
    pub stage_multiplier: f64,
    pub threshold: f64,
    pub draw_minimum: SafeU53,
    pub draw_cardinality: SafeU53,
    pub draw: SafeU53,
    pub consumed: bool,
    pub reason: RngReason,
    pub callsite_id: RngCallsiteId,
}

/// Evidence for a no-draw accuracy branch.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AccuracySkipEvidence {
    pub reason: AccuracySkipReason,
    pub move_accuracy: MoveAccuracy,
    pub source_accuracy_stage: i8,
    pub target_evasion_stage: i8,
}

/// Typed accuracy outcome consumed by later move-effect stages.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    content = "evidence",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
pub enum AccuracyDecision {
    Hit(AccuracyRollEvidence),
    Miss(AccuracyRollEvidence),
    Skipped(AccuracySkipEvidence),
}

impl AccuracyDecision {
    /// Returns true only for an ordinary hit or an always-hit bypass.
    pub fn is_hit(&self) -> bool {
        match self {
            Self::Hit(_) => true,
            Self::Miss(_) => false,
            Self::Skipped(evidence) => {
                matches!(evidence.reason, AccuracySkipReason::AlwaysHits)
            }
        }
    }

    pub fn is_miss(&self) -> bool {
        matches!(self, Self::Miss(_))
    }

    pub fn draw(&self) -> Option<SafeU53> {
        match self {
            Self::Hit(evidence) | Self::Miss(evidence) => Some(evidence.draw),
            Self::Skipped(_) => None,
        }
    }

    pub fn threshold(&self) -> Option<f64> {
        match self {
            Self::Hit(evidence) | Self::Miss(evidence) => Some(evidence.threshold),
            Self::Skipped(_) => None,
        }
    }

    pub fn roll_evidence(&self) -> Option<&AccuracyRollEvidence> {
        match self {
            Self::Hit(evidence) | Self::Miss(evidence) => Some(evidence),
            Self::Skipped(_) => None,
        }
    }

    pub fn skipped_evidence(&self) -> Option<&AccuracySkipEvidence> {
        match self {
            Self::Skipped(evidence) => Some(evidence),
            Self::Hit(_) | Self::Miss(_) => None,
        }
    }
}

/// Context validation failures are typed so invalid input cannot become a hit.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AccuracyContextError {
    #[error("ordinary accuracy must be in 1..=100, got {accuracy}")]
    InvalidBaseAccuracy { accuracy: u8 },
    #[error("source accuracy stage {stage} is outside [-6, 6]")]
    InvalidSourceAccuracyStage { stage: i8 },
    #[error("target evasion stage {stage} is outside [-6, 6]")]
    InvalidTargetEvasionStage { stage: i8 },
    #[error("move accuracy encoding is not an ordinary or always-hit value")]
    InvalidAccuracyEncoding,
    #[error("accuracy arithmetic produced a non-finite Number")]
    NonFiniteCalculation,
}

/// Fail-closed accuracy resolution error.
#[derive(Debug, Error)]
pub enum AccuracyError {
    #[error("invalid accuracy context: {0}")]
    InvalidContext(#[from] AccuracyContextError),
    #[error("accuracy branch {reason:?} is outside the selected slice")]
    Unsupported { reason: AccuracyUnsupportedReason },
    #[error("accuracy draw {draw} is outside the [0, 100) range")]
    InvalidDraw { draw: u64 },
    #[error("accuracy RNG range {value} is outside SafeU53")]
    RangeOverflow { value: u64 },
    #[error(transparent)]
    Rng(#[from] RngError),
}

#[derive(Debug)]
enum AccuracyPlan {
    Skipped(AccuracyDecision),
    Roll(AccuracyRollPlan),
}

#[derive(Debug)]
struct AccuracyRollPlan {
    move_accuracy: MoveAccuracy,
    source_accuracy_stage: i8,
    target_evasion_stage: i8,
    stage_difference: i8,
    stage_multiplier: f64,
    threshold: f64,
}

/// Resolves one target accuracy check in the frozen source order.
pub fn resolve_accuracy(
    context: &AccuracyContext,
    runtime: &mut RngRuntime,
) -> Result<AccuracyDecision, AccuracyError> {
    match context.plan()? {
        AccuracyPlan::Skipped(decision) => Ok(decision),
        AccuracyPlan::Roll(plan) => {
            let cardinality = accuracy_draw_cardinality()?;
            let draw = runtime.battle_rand_seed_int(
                cardinality,
                SafeU53::ZERO,
                RngReason::Accuracy,
                RngCallsiteId::accuracy(),
            )?;
            Ok(decision_from_roll(plan, draw, cardinality))
        }
    }
}

fn accuracy_draw_cardinality() -> Result<SafeU53, AccuracyError> {
    SafeU53::new(ACCURACY_DRAW_CARDINALITY).map_err(|_| AccuracyError::RangeOverflow {
        value: ACCURACY_DRAW_CARDINALITY,
    })
}

fn decision_from_roll(
    plan: AccuracyRollPlan,
    draw: SafeU53,
    draw_cardinality: SafeU53,
) -> AccuracyDecision {
    let evidence = AccuracyRollEvidence {
        move_accuracy: plan.move_accuracy,
        source_accuracy_stage: plan.source_accuracy_stage,
        target_evasion_stage: plan.target_evasion_stage,
        stage_difference: plan.stage_difference,
        stage_multiplier: plan.stage_multiplier,
        threshold: plan.threshold,
        draw_minimum: SafeU53::ZERO,
        draw_cardinality,
        draw,
        consumed: true,
        reason: RngReason::Accuracy,
        callsite_id: RngCallsiteId::accuracy(),
    };
    if (draw.get() as f64) < evidence.threshold {
        AccuracyDecision::Hit(evidence)
    } else {
        AccuracyDecision::Miss(evidence)
    }
}
