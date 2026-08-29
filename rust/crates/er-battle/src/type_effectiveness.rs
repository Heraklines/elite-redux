//! Exact selected-slice type-chart composition.
//!
//! The base chart is deliberately pure. It validates the immutable selected
//! chart and canonical defender typing, composes one or two defender types,
//! and returns a closed exact multiplier. It does not inspect abilities or
//! consume RNG; a zero multiplier is the mechanical terminal immunity result
//! that callers must handle before later accuracy, critical, or damage draws.

use er_content::pack::{TypeChart, TypeChartError};
use er_state::pokemon::{TypingValidationError, validate_m3_typing};
use er_types::battle_model::{PokemonType, PokemonTyping, SingleTypeMultiplier};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The complete multiplier set reachable by one or two selected defender
/// types.
///
/// The representation is exact and contains no floating-point value. The
/// `Quarter` and `Four` variants are produced by dual-type composition.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EffectivenessMultiplier {
    Zero,
    Quarter,
    Half,
    One,
    Two,
    Four,
}

impl EffectivenessMultiplier {
    /// Convert one immutable content-chart multiplier into the closed result
    /// representation.
    pub const fn from_single_type(multiplier: SingleTypeMultiplier) -> Self {
        match multiplier {
            SingleTypeMultiplier::Zero => Self::Zero,
            SingleTypeMultiplier::Half => Self::Half,
            SingleTypeMultiplier::One => Self::One,
            SingleTypeMultiplier::Two => Self::Two,
        }
    }

    /// Return the exact power-of-two exponent, or `None` for immunity.
    pub const fn exponent(self) -> Option<i8> {
        match self {
            Self::Zero => None,
            Self::Quarter => Some(-2),
            Self::Half => Some(-1),
            Self::One => Some(0),
            Self::Two => Some(1),
            Self::Four => Some(2),
        }
    }

    /// Return the exact numerator and denominator for consumers that need a
    /// numeric damage calculation without storing a floating-point multiplier.
    pub const fn ratio(self) -> (u8, u8) {
        match self {
            Self::Zero => (0, 1),
            Self::Quarter => (1, 4),
            Self::Half => (1, 2),
            Self::One => (1, 1),
            Self::Two => (2, 1),
            Self::Four => (4, 1),
        }
    }

    /// Whether the multiplier is a native type immunity.
    pub const fn is_immune(self) -> bool {
        matches!(self, Self::Zero)
    }

    /// Whether the multiplier is exactly neutral.
    pub const fn is_neutral(self) -> bool {
        matches!(self, Self::One)
    }

    /// Whether the multiplier is a non-immune resistance.
    pub const fn is_resistant(self) -> bool {
        matches!(self, Self::Quarter | Self::Half)
    }

    /// Whether the defender is weak to the attack.
    pub const fn is_weak(self) -> bool {
        self.is_super_effective()
    }

    /// Whether the multiplier is super-effective.
    pub const fn is_super_effective(self) -> bool {
        matches!(self, Self::Two | Self::Four)
    }

    /// Whether the multiplier is not super-effective, including immunity.
    pub const fn is_non_super_effective(self) -> bool {
        !self.is_super_effective()
    }

    /// Compose two exact powers of two, returning `None` if the product is
    /// outside this closed representation.
    pub const fn compose(self, other: Self) -> Option<Self> {
        if self.is_immune() || other.is_immune() {
            return Some(Self::Zero);
        }

        let Some(left) = self.exponent() else {
            return Some(Self::Zero);
        };
        let Some(right) = other.exponent() else {
            return Some(Self::Zero);
        };
        let Some(exponent) = left.checked_add(right) else {
            return None;
        };

        match exponent {
            -2 => Some(Self::Quarter),
            -1 => Some(Self::Half),
            0 => Some(Self::One),
            1 => Some(Self::Two),
            2 => Some(Self::Four),
            _ => None,
        }
    }
}

/// The semantic class of a composed type multiplier.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EffectivenessClass {
    Immune,
    Resistant,
    Neutral,
    SuperEffective,
}

impl EffectivenessClass {
    const fn from_multiplier(multiplier: EffectivenessMultiplier) -> Self {
        if multiplier.is_immune() {
            Self::Immune
        } else if multiplier.is_resistant() {
            Self::Resistant
        } else if multiplier.is_neutral() {
            Self::Neutral
        } else {
            Self::SuperEffective
        }
    }
}

/// A validated, composed type-effectiveness result.
///
/// `multiplier == EffectivenessMultiplier::Zero` is the native immunity
/// terminal. Callers should return that result before invoking any later
/// accuracy, critical, variance, or damage RNG operation. This result does
/// not itself implement or decide any ability policy such as Wonder Guard.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypeEffectiveness {
    /// The exact selected-slice multiplier.
    pub multiplier: EffectivenessMultiplier,
}

impl TypeEffectiveness {
    /// Construct a result from a closed exact multiplier.
    pub const fn new(multiplier: EffectivenessMultiplier) -> Self {
        Self { multiplier }
    }

    /// Return the semantic class used by downstream ability and damage code.
    pub const fn class(self) -> EffectivenessClass {
        EffectivenessClass::from_multiplier(self.multiplier)
    }

    /// Whether this result is the native type-immunity terminal.
    pub const fn is_immune(self) -> bool {
        self.multiplier.is_immune()
    }

    /// Whether this result is exactly neutral.
    pub const fn is_neutral(self) -> bool {
        self.multiplier.is_neutral()
    }

    /// Whether this result is a non-immune resistance.
    pub const fn is_resistant(self) -> bool {
        self.multiplier.is_resistant()
    }

    /// Whether the defender is weak to the attack.
    pub const fn is_weak(self) -> bool {
        self.multiplier.is_weak()
    }

    /// Whether this result is super-effective.
    pub const fn is_super_effective(self) -> bool {
        self.multiplier.is_super_effective()
    }

    /// Whether this result is not super-effective, for an ability policy such
    /// as Wonder Guard to inspect without being implemented here.
    pub const fn is_non_super_effective(self) -> bool {
        self.multiplier.is_non_super_effective()
    }

    /// Whether mechanics may continue past the native type check.
    pub const fn allows_follow_up_resolution(self) -> bool {
        !self.is_immune()
    }
}

/// Errors raised when selected type-effectiveness inputs cannot be evaluated
/// without weakening the exact selected-slice contract.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum TypeEffectivenessError {
    #[error("selected type chart is invalid: {0}")]
    InvalidChart(#[source] TypeChartError),
    #[error("defender typing is invalid for selected M3 content: {0}")]
    InvalidDefenderTyping(#[source] TypingValidationError),
    #[error("attack type {attack:?} is outside selected M3 content")]
    UnsupportedAttackType { attack: PokemonType },
    #[error(
        "type multiplier composition {left:?} x {right:?} is outside the closed representation"
    )]
    CompositionOutOfRange {
        left: EffectivenessMultiplier,
        right: EffectivenessMultiplier,
    },
}

/// Compose one or two single-type content multipliers in defender order.
///
/// Composition is commutative, but the function preserves the caller's
/// supplied order and never rounds between defender types.
pub fn compose_type_multipliers(
    primary: SingleTypeMultiplier,
    secondary: Option<SingleTypeMultiplier>,
) -> Option<EffectivenessMultiplier> {
    let first = EffectivenessMultiplier::from_single_type(primary);
    let Some(secondary) = secondary else {
        return Some(first);
    };
    let second = EffectivenessMultiplier::from_single_type(secondary);
    first.compose(second)
}

/// Resolve the exact selected-slice effectiveness of one damaging attack type
/// against one canonical one- or two-type defender.
///
/// The move pipeline must not call this chart for an ordinary status-category
/// move: the pinned oracle treats those moves as neutral unless an explicitly
/// selected immunity-respecting attribute says otherwise.
pub fn resolve_type_effectiveness(
    chart: &TypeChart,
    attack_type: PokemonType,
    defender_typing: &PokemonTyping,
) -> Result<TypeEffectiveness, TypeEffectivenessError> {
    chart
        .validate()
        .map_err(TypeEffectivenessError::InvalidChart)?;
    validate_m3_typing(defender_typing).map_err(TypeEffectivenessError::InvalidDefenderTyping)?;
    if !matches!(
        attack_type,
        PokemonType::Normal
            | PokemonType::Fire
            | PokemonType::Poison
            | PokemonType::Grass
            | PokemonType::Electric
    ) {
        return Err(TypeEffectivenessError::UnsupportedAttackType {
            attack: attack_type,
        });
    }

    let primary = chart.multiplier(attack_type, defender_typing.primary);
    let secondary = defender_typing
        .secondary
        .map(|defender_type| chart.multiplier(attack_type, defender_type));
    let combined = compose_type_multipliers(primary, secondary).ok_or(
        TypeEffectivenessError::CompositionOutOfRange {
            left: EffectivenessMultiplier::from_single_type(primary),
            right: secondary.map_or(
                EffectivenessMultiplier::One,
                EffectivenessMultiplier::from_single_type,
            ),
        },
    )?;
    Ok(TypeEffectiveness::new(combined))
}
