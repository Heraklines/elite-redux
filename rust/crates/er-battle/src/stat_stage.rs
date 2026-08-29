//! Selected M3 stat-stage mutation and effective-stat mechanics.
//!
//! The oracle stores seven independent stages in the closed `[-6, 6]` range.
//! Stage ratios stay as JavaScript-number values until the final effective-stat
//! conversion.  The critical-hit policy is an explicit input because a
//! critical calculation changes the temporary stage used by a stat lookup; it
//! never mutates the stored stage.

use er_types::battle_model::{BattleStat, BattleStats, StatStages, StatusKind};
use thiserror::Error;

/// Lowest representable battle stat stage.
pub const MIN_STAT_STAGE: i8 = -6;

/// Highest representable battle stat stage.
pub const MAX_STAT_STAGE: i8 = 6;

/// Explicit stage handling for an effective-stat lookup.
///
/// `IgnoreNegative` is the critical-hit rule for an offensive stat and
/// `IgnorePositive` is the critical-hit rule for a defensive stat.  Neither
/// policy changes the stored stage.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StagePolicy {
    /// Use the stored stage as-is after the stage bound is applied.
    Normal,
    /// Ignore a negative stage for a critical offensive-stat lookup.
    IgnoreNegative,
    /// Ignore a positive stage for a critical defensive-stat lookup.
    IgnorePositive,
}

/// Descriptive alias for callers that want to name the critical policy.
pub type CriticalStagePolicy = StagePolicy;

/// The typed result of one stage mutation, suitable for a later transition
/// or presentation adapter to turn into its own mutation DTO.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StatStageMutation {
    /// The stage that was addressed.
    pub stat: BattleStat,
    /// The canonical stage before this mutation.
    pub before: i8,
    /// The requested relative change.
    pub delta: i8,
    /// The canonical stage after clamping.
    pub after: i8,
    /// Whether the canonical value changed.
    pub changed: bool,
}

/// Compatibility name for the mutation input consumed by later M3 lanes.
pub type StatStageMutationInput = StatStageMutation;

/// Input to an effective-stat calculation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EffectiveStatInput {
    /// The stat being looked up.
    pub stat: BattleStat,
    /// The unmodified battle stat value.
    pub base_stat: u32,
    /// The stored stage for this lookup.
    pub stage: i8,
    /// The status currently carried by the Pokémon.
    pub status: StatusKind,
    /// The explicit normal/critical stage policy for this lookup.
    pub stage_policy: StagePolicy,
}

/// Ordered evidence from an effective-stat calculation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EffectiveStatOutcome {
    /// The source stat value before stage application.
    pub base_stat: u32,
    /// The canonical stored stage.
    pub input_stage: i8,
    /// The temporary stage used by this lookup.
    pub applied_stage: i8,
    /// The uncropped floating-point stage ratio.
    pub stage_ratio: f64,
    /// Whether the JavaScript signed right shift was applied.
    pub paralysis_shifted: bool,
    /// The final `Math.max(Math.floor(value), 1)` result.
    pub value: u32,
}

/// Errors raised when an effective-stat input cannot be represented by the
/// selected finite M3 mechanics.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum StatStageError {
    /// Toxic and Sleep are representable state values but unsupported here.
    #[error("stat lookup for status {status:?} is outside the selected M3 status slice")]
    UnsupportedStatus { status: StatusKind },
    /// The JavaScript-number value at a required arithmetic boundary was not
    /// finite.
    #[error("effective stat arithmetic produced a non-finite value")]
    NonFiniteValue,
    /// A finite effective stat could not be materialized as a `u32`.
    #[error("effective stat exceeds the canonical u32 range")]
    EffectiveStatOverflow,
    /// Accuracy and Evasion have stages but no base value in `BattleStats`.
    #[error("effective battle stat {stat:?} has no selected base-stat input")]
    UnsupportedStat { stat: BattleStat },
}

/// Clamp one stored or requested stage to the oracle's closed range.
pub fn clamp_stage(stage: i8) -> i8 {
    stage.clamp(MIN_STAT_STAGE, MAX_STAT_STAGE)
}

/// Return the stage used by an effective-stat lookup without mutating storage.
pub fn apply_stage_policy(stage: i8, policy: StagePolicy) -> i8 {
    let stage = clamp_stage(stage);
    match policy {
        StagePolicy::Normal => stage,
        StagePolicy::IgnoreNegative => stage.max(0),
        StagePolicy::IgnorePositive => stage.min(0),
    }
}

/// Compute the selected-slice floating-point stage ratio.
///
/// The expression is evaluated in the same numerator/denominator order as
/// the oracle, with no intermediate floor or integer conversion.
pub fn stage_ratio(stage: i8) -> f64 {
    let stage = i16::from(clamp_stage(stage));
    let numerator = f64::from((2 + stage).max(2));
    let denominator = f64::from((2 - stage).max(2));
    (numerator / denominator).min(4.0)
}

/// Produce a typed stage mutation without changing a `StatStages` value.
pub fn stage_mutation(stat: BattleStat, current: i8, delta: i8) -> StatStageMutation {
    let before = clamp_stage(current);
    let requested = i16::from(before) + i16::from(delta);
    let after = requested.clamp(i16::from(MIN_STAT_STAGE), i16::from(MAX_STAT_STAGE)) as i8;
    StatStageMutation {
        stat,
        before,
        delta,
        after,
        changed: before != after,
    }
}

/// Apply one relative stage change and return the exact before/after input.
pub fn apply_stage_delta(
    stages: &mut StatStages,
    stat: BattleStat,
    delta: i8,
) -> StatStageMutation {
    let mutation = stage_mutation(stat, stage_for_stat(stages, stat), delta);
    set_stage(stages, stat, mutation.after);
    mutation
}

/// Read one of the seven canonical stages.
pub const fn stage_for_stat(stages: &StatStages, stat: BattleStat) -> i8 {
    match stat {
        BattleStat::Attack => stages.attack,
        BattleStat::Defense => stages.defense,
        BattleStat::SpecialAttack => stages.special_attack,
        BattleStat::SpecialDefense => stages.special_defense,
        BattleStat::Speed => stages.speed,
        BattleStat::Accuracy => stages.accuracy,
        BattleStat::Evasion => stages.evasion,
    }
}

/// Write one canonical stage after a caller has computed a mutation.
pub fn set_stage(stages: &mut StatStages, stat: BattleStat, stage: i8) {
    let stage = clamp_stage(stage);
    match stat {
        BattleStat::Attack => stages.attack = stage,
        BattleStat::Defense => stages.defense = stage,
        BattleStat::SpecialAttack => stages.special_attack = stage,
        BattleStat::SpecialDefense => stages.special_defense = stage,
        BattleStat::Speed => stages.speed = stage,
        BattleStat::Accuracy => stages.accuracy = stage,
        BattleStat::Evasion => stages.evasion = stage,
    }
}

/// Reproduce JavaScript's signed `>> 1` conversion at the frozen operation
/// point.  The result is a signed 32-bit integer represented as a `f64`.
pub fn js_signed_shift_right_one(value: f64) -> Result<f64, StatStageError> {
    if !value.is_finite() {
        return Err(StatStageError::NonFiniteValue);
    }

    let truncated = value.trunc();
    let mut modulo = truncated % 4_294_967_296.0;
    if modulo < 0.0 {
        modulo += 4_294_967_296.0;
    }
    let signed = if modulo >= 2_147_483_648.0 {
        modulo - 4_294_967_296.0
    } else {
        modulo
    };
    Ok((signed / 2.0).floor())
}

/// Calculate one effective stat with the source operation and floor order.
pub fn effective_stat(input: EffectiveStatInput) -> Result<EffectiveStatOutcome, StatStageError> {
    validate_status(input.status)?;
    let input_stage = clamp_stage(input.stage);
    let applied_stage = apply_stage_policy(input_stage, input.stage_policy);
    let stage_ratio = stage_ratio(applied_stage);
    let mut value = f64::from(input.base_stat);
    value *= stage_ratio;
    let paralysis_shifted =
        input.stat == BattleStat::Speed && input.status == StatusKind::Paralysis;
    if paralysis_shifted {
        value = js_signed_shift_right_one(value)?;
    }
    if !value.is_finite() {
        return Err(StatStageError::NonFiniteValue);
    }

    let floored = value.floor();
    if floored > f64::from(u32::MAX) {
        return Err(StatStageError::EffectiveStatOverflow);
    }
    let value = floored.max(1.0) as u32;

    Ok(EffectiveStatOutcome {
        base_stat: input.base_stat,
        input_stage,
        applied_stage,
        stage_ratio,
        paralysis_shifted,
        value,
    })
}

/// Calculate an effective stat directly from the M3A battle stat/stage DTOs.
pub fn effective_battle_stat(
    stats: &BattleStats,
    stages: &StatStages,
    stat: BattleStat,
    status: StatusKind,
    stage_policy: StagePolicy,
) -> Result<EffectiveStatOutcome, StatStageError> {
    effective_stat(EffectiveStatInput {
        stat,
        base_stat: base_stat_for_stat(stats, stat)?,
        stage: stage_for_stat(stages, stat),
        status,
        stage_policy,
    })
}

fn base_stat_for_stat(stats: &BattleStats, stat: BattleStat) -> Result<u32, StatStageError> {
    match stat {
        BattleStat::Attack => Ok(stats.attack),
        BattleStat::Defense => Ok(stats.defense),
        BattleStat::SpecialAttack => Ok(stats.special_attack),
        BattleStat::SpecialDefense => Ok(stats.special_defense),
        BattleStat::Speed => Ok(stats.speed),
        BattleStat::Accuracy | BattleStat::Evasion => Err(StatStageError::UnsupportedStat { stat }),
    }
}

fn validate_status(status: StatusKind) -> Result<(), StatStageError> {
    match status {
        StatusKind::None | StatusKind::Burn | StatusKind::Poison | StatusKind::Paralysis => Ok(()),
        StatusKind::Toxic | StatusKind::Sleep => Err(StatStageError::UnsupportedStatus { status }),
    }
}

/// Calculate a direct Speed value, including the paralysis shift.
pub fn effective_speed(
    base_stat: u32,
    stage: i8,
    status: StatusKind,
    stage_policy: StagePolicy,
) -> Result<EffectiveStatOutcome, StatStageError> {
    effective_stat(EffectiveStatInput {
        stat: BattleStat::Speed,
        base_stat,
        stage,
        status,
        stage_policy,
    })
}
