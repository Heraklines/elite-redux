//! The frozen ordinary physical/special damage path.
//!
//! This module accepts already-resolved battle values.  It deliberately does
//! not resolve a type chart or import a modifier hook: those are separate
//! capability boundaries owned by the content and resolver lanes.  Every
//! Number-valued operation remains in the source order recorded by the M3
//! damage oracle.

use crate::js_math::{JsMathError, js_floor, js_max, safe_integer_from_f64};
use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::RngRuntime;
use er_rng::phaser::RngError;
use er_types::SafeU53;
use er_types::battle_model::MoveCategory;
use thiserror::Error;

const DAMAGE_VARIANCE_MINIMUM: u64 = 85;
const DAMAGE_VARIANCE_CARDINALITY: u64 = 16;
const DAMAGE_VARIANCE_DENOMINATOR: f64 = 100.0;

/// The resolved multiplier slots accepted by the ordinary damage path.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DamageModifier {
    Target,
    Critical,
    Stab,
    Effectiveness,
    Field,
}

/// A typed failure at the ordinary damage boundary.
#[derive(Debug, Error)]
pub enum DamageError {
    #[error("ordinary damage requires a positive level")]
    InvalidLevel,
    #[error("status-category moves are not ordinary damage inputs")]
    StatusCategory,
    #[error("ordinary damage requires a finite positive power")]
    InvalidPower,
    #[error("ordinary damage requires a finite positive offensive stat")]
    InvalidOffensiveStat,
    #[error("ordinary damage requires a finite positive defensive stat")]
    InvalidDefensiveStat,
    #[error("{modifier:?} damage multiplier must be finite and positive")]
    InvalidPositiveMultiplier { modifier: DamageModifier },
    #[error("{modifier:?} damage multiplier must be finite and non-negative")]
    InvalidNonNegativeMultiplier { modifier: DamageModifier },
    #[error("ordinary damage arithmetic produced a non-finite Number")]
    NonFiniteArithmetic,
    #[error("ordinary damage result is not a non-negative safe integer")]
    InvalidDamageInteger,
    #[error("ordinary damage variance range is outside SafeU53")]
    InvalidVarianceRange,
    #[error(transparent)]
    JsMath(#[from] JsMathError),
    #[error(transparent)]
    Rng(#[from] RngError),
}

/// Resolved inputs for one ordinary, single damage calculation.
///
/// `power`, the two effective stats, and every multiplier are deliberately
/// supplied rather than reconstructed from content IDs.  The default
/// constructor describes the neutral single-target path; builder methods add
/// only the supported resolved factors. The move pipeline remains responsible
/// for proving these values came from a capability-validated selected move and
/// for rejecting every non-neutral arena or modifier hook before construction.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DamageInput {
    pub level: u32,
    pub category: MoveCategory,
    pub power: f64,
    pub offensive_stat: f64,
    pub defensive_stat: f64,
    pub target_multiplier: f64,
    pub critical_multiplier: f64,
    pub stab_multiplier: f64,
    pub effectiveness_multiplier: f64,
    pub burned: bool,
    pub field_multiplier: f64,
}

impl DamageInput {
    /// Creates a neutral, unburned, single-target damage input.
    pub const fn new(
        level: u32,
        category: MoveCategory,
        power: f64,
        offensive_stat: f64,
        defensive_stat: f64,
    ) -> Self {
        Self {
            level,
            category,
            power,
            offensive_stat,
            defensive_stat,
            target_multiplier: 1.0,
            critical_multiplier: 1.0,
            stab_multiplier: 1.0,
            effectiveness_multiplier: 1.0,
            burned: false,
            field_multiplier: 1.0,
        }
    }

    pub const fn with_target_multiplier(mut self, multiplier: f64) -> Self {
        self.target_multiplier = multiplier;
        self
    }

    pub const fn with_critical_multiplier(mut self, multiplier: f64) -> Self {
        self.critical_multiplier = multiplier;
        self
    }

    pub const fn with_stab_multiplier(mut self, multiplier: f64) -> Self {
        self.stab_multiplier = multiplier;
        self
    }

    /// Supplies the already-composed closed type-chart modifier.
    ///
    /// This slot is after STAB in the frozen chain. It must not absorb an arena
    /// attack-type multiplier, whose earlier source position is unsupported by
    /// the selected neutral-arena slice.
    pub const fn with_effectiveness_multiplier(mut self, multiplier: f64) -> Self {
        self.effectiveness_multiplier = multiplier;
        self
    }

    /// Alias that names the source's damage-chain type multiplier.
    pub const fn with_type_multiplier(self, multiplier: f64) -> Self {
        self.with_effectiveness_multiplier(multiplier)
    }

    pub const fn with_burned(mut self, burned: bool) -> Self {
        self.burned = burned;
        self
    }

    /// Supplies the requested field multiplier used at the second conversion
    /// boundary.  The neutral value is `1`.
    pub const fn with_field_multiplier(mut self, multiplier: f64) -> Self {
        self.field_multiplier = multiplier;
        self
    }

    /// Validates the fail-closed resolved-input boundary without touching RNG.
    pub fn validate(&self) -> Result<(), DamageError> {
        if self.level == 0 {
            return Err(DamageError::InvalidLevel);
        }
        if matches!(self.category, MoveCategory::Status) {
            return Err(DamageError::StatusCategory);
        }
        if !self.power.is_finite() || self.power <= 0.0 {
            return Err(DamageError::InvalidPower);
        }
        if !self.offensive_stat.is_finite() || self.offensive_stat <= 0.0 {
            return Err(DamageError::InvalidOffensiveStat);
        }
        if !self.defensive_stat.is_finite() || self.defensive_stat <= 0.0 {
            return Err(DamageError::InvalidDefensiveStat);
        }
        validate_positive_multiplier(self.target_multiplier, DamageModifier::Target)?;
        validate_positive_multiplier(self.critical_multiplier, DamageModifier::Critical)?;
        validate_positive_multiplier(self.stab_multiplier, DamageModifier::Stab)?;
        validate_nonnegative_multiplier(
            self.effectiveness_multiplier,
            DamageModifier::Effectiveness,
        )?;
        validate_nonnegative_multiplier(self.field_multiplier, DamageModifier::Field)?;
        Ok(())
    }

    /// Calculates this resolved input through the exact battle variance seam.
    pub fn calculate(&self, runtime: &mut RngRuntime) -> Result<DamageResult, DamageError> {
        calculate_damage(self, runtime)
    }
}

/// The exact variance draw and Number multiplier used by one damage result.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DamageVariance {
    pub roll: SafeU53,
    pub multiplier: f64,
}

/// Result of one ordinary damage calculation.
///
/// An effectiveness multiplier of zero produces a no-effect result with zero
/// damage and no variance entry.  All other ordinary damage results have both
/// conversion boundaries represented by `pre_field_damage` and `damage`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DamageResult {
    pub damage: SafeU53,
    pub pre_field_damage: SafeU53,
    pub base_damage: f64,
    pub variance: Option<DamageVariance>,
    pub target_multiplier: f64,
    pub critical_multiplier: f64,
    pub random_multiplier: f64,
    pub stab_multiplier: f64,
    pub effectiveness_multiplier: f64,
    pub burn_multiplier: f64,
    pub field_multiplier: f64,
    pub no_effect: bool,
}

impl DamageResult {
    pub const fn is_no_effect(self) -> bool {
        self.no_effect
    }

    pub const fn damage_value(self) -> u64 {
        self.damage.get()
    }
}

/// Applies the JavaScript `toDmgValue(value) = Math.max(Math.floor(value), 1)`
/// boundary and returns the exact safe integer admitted by the kernel.
pub fn to_dmg_value(value: f64) -> Result<SafeU53, DamageError> {
    let floored = js_floor(value);
    let minimum_applied = js_max(floored, 1.0);
    let integer = safe_integer_from_f64(minimum_applied)?;
    let integer = u64::try_from(integer).map_err(|_| DamageError::InvalidDamageInteger)?;
    SafeU53::new(integer).map_err(|_| DamageError::InvalidDamageInteger)
}

/// Resolves one ordinary physical or special damage result.
pub fn calculate_damage(
    input: &DamageInput,
    runtime: &mut RngRuntime,
) -> Result<DamageResult, DamageError> {
    input.validate()?;

    let burn_multiplier = if input.burned && matches!(input.category, MoveCategory::Physical) {
        0.5
    } else {
        1.0
    };

    // Type immunity is a causal early return: it precedes base damage,
    // critical selection, variance, and every integer conversion.
    if input.effectiveness_multiplier == 0.0 {
        return Ok(DamageResult {
            damage: SafeU53::ZERO,
            pre_field_damage: SafeU53::ZERO,
            base_damage: 0.0,
            variance: None,
            target_multiplier: input.target_multiplier,
            critical_multiplier: input.critical_multiplier,
            random_multiplier: 1.0,
            stab_multiplier: input.stab_multiplier,
            effectiveness_multiplier: input.effectiveness_multiplier,
            burn_multiplier,
            field_multiplier: input.field_multiplier,
            no_effect: true,
        });
    }

    // Stage the runtime as well as the arithmetic.  If a later Number or
    // integer boundary rejects, the caller observes no live draw or audit
    // sequence allocation.
    let mut staged_runtime = runtime.clone();
    let cardinality =
        SafeU53::new(DAMAGE_VARIANCE_CARDINALITY).map_err(|_| DamageError::InvalidVarianceRange)?;
    let minimum =
        SafeU53::new(DAMAGE_VARIANCE_MINIMUM).map_err(|_| DamageError::InvalidVarianceRange)?;
    let roll = staged_runtime.pokemon_rand_battle_seed_int(
        cardinality,
        minimum,
        RngReason::DamageVariance,
        RngCallsiteId::damage_variance(),
    )?;
    let random_multiplier = (roll.get() as f64) / DAMAGE_VARIANCE_DENOMINATOR;
    if !random_multiplier.is_finite() {
        return Err(DamageError::NonFiniteArithmetic);
    }

    // Keep the source expression order literal.  The intermediate level
    // Number is intentionally not folded into the later products.
    let level_multiplier = (2.0 * f64::from(input.level)) / 5.0 + 2.0;
    let mut base_damage = level_multiplier * input.power;
    base_damage *= input.offensive_stat;
    base_damage /= input.defensive_stat;
    base_damage /= 50.0;
    base_damage += 2.0;
    if !base_damage.is_finite() {
        return Err(DamageError::NonFiniteArithmetic);
    }

    let mut damage_value = base_damage;
    damage_value *= input.target_multiplier;
    damage_value *= input.critical_multiplier;
    damage_value *= random_multiplier;
    damage_value *= input.stab_multiplier;
    damage_value *= input.effectiveness_multiplier;
    damage_value *= burn_multiplier;
    if !damage_value.is_finite() {
        return Err(DamageError::NonFiniteArithmetic);
    }

    let pre_field_damage = to_dmg_value(damage_value)?;
    let field_value = (pre_field_damage.get() as f64) * input.field_multiplier;
    let damage = to_dmg_value(field_value)?;

    let result = DamageResult {
        damage,
        pre_field_damage,
        base_damage,
        variance: Some(DamageVariance {
            roll,
            multiplier: random_multiplier,
        }),
        target_multiplier: input.target_multiplier,
        critical_multiplier: input.critical_multiplier,
        random_multiplier,
        stab_multiplier: input.stab_multiplier,
        effectiveness_multiplier: input.effectiveness_multiplier,
        burn_multiplier,
        field_multiplier: input.field_multiplier,
        no_effect: false,
    };
    *runtime = staged_runtime;
    Ok(result)
}

/// Descriptive alias for callers that prefer the resolver vocabulary.
pub fn resolve_damage(
    input: &DamageInput,
    runtime: &mut RngRuntime,
) -> Result<DamageResult, DamageError> {
    calculate_damage(input, runtime)
}

fn validate_positive_multiplier(value: f64, modifier: DamageModifier) -> Result<(), DamageError> {
    if !value.is_finite() || value <= 0.0 {
        return Err(DamageError::InvalidPositiveMultiplier { modifier });
    }
    Ok(())
}

fn validate_nonnegative_multiplier(
    value: f64,
    modifier: DamageModifier,
) -> Result<(), DamageError> {
    if !value.is_finite() || value < 0.0 {
        return Err(DamageError::InvalidNonNegativeMultiplier { modifier });
    }
    Ok(())
}
