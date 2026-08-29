use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_types::ids::JS_MAX_SAFE_INTEGER;

use crate::ids::ValueNodeId;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExactRatio {
    pub numerator: i64,
    pub denominator: u64,
}

impl ExactRatio {
    pub const ONE: Self = Self {
        numerator: 1,
        denominator: 1,
    };

    pub const fn new(numerator: i64, denominator: u64) -> Result<Self, ExactRatioError> {
        if denominator == 0 {
            return Err(ExactRatioError::ZeroDenominator);
        }
        if denominator > JS_MAX_SAFE_INTEGER {
            return Err(ExactRatioError::DenominatorOutsideSafeInteger { denominator });
        }
        if numerator < -(JS_MAX_SAFE_INTEGER as i64) || numerator > JS_MAX_SAFE_INTEGER as i64 {
            return Err(ExactRatioError::NumeratorOutsideSafeInteger { numerator });
        }
        Ok(Self {
            numerator,
            denominator,
        })
    }

    pub const fn validate(self) -> Result<(), ExactRatioError> {
        match Self::new(self.numerator, self.denominator) {
            Ok(_) => Ok(()),
            Err(error) => Err(error),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ExactRatioError {
    #[error("ratio denominator must be positive")]
    ZeroDenominator,
    #[error("ratio numerator {numerator} is outside the JavaScript-safe range")]
    NumeratorOutsideSafeInteger { numerator: i64 },
    #[error("ratio denominator {denominator} is outside the JavaScript-safe range")]
    DenominatorOutsideSafeInteger { denominator: u64 },
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ComparisonOperator {
    Equal,
    NotEqual,
    Less,
    LessOrEqual,
    Greater,
    GreaterOrEqual,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ArithmeticOperator {
    Add,
    Subtract,
    Multiply,
    DivideFloor,
    Minimum,
    Maximum,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValueField {
    CurrentHp,
    MaximumHp,
    Level,
    CurrentTurn,
    CurrentWave,
    MovePower,
    MovePpRemaining,
    HitIndex,
    HitCount,
    DamageDealt,
    DamageTaken,
    StatStage,
    MechanicCounter,
    RemainingTurns,
    PartySize,
    ActiveTargetCount,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ValueNode {
    Signed {
        value: i64,
    },
    Unsigned {
        value: u64,
    },
    Ratio {
        value: ExactRatio,
    },
    QueryInput,
    Field {
        field: ValueField,
    },
    Arithmetic {
        operator: ArithmeticOperator,
        left: ValueNodeId,
        right: ValueNodeId,
    },
    MultiplyRatio {
        value: ValueNodeId,
        ratio: ExactRatio,
    },
    Clamp {
        value: ValueNodeId,
        minimum: ValueNodeId,
        maximum: ValueNodeId,
    },
    JavaScriptFloor {
        value: ValueNodeId,
    },
    JavaScriptCeil {
        value: ValueNodeId,
    },
    JavaScriptRound {
        value: ValueNodeId,
    },
}

impl ValueNode {
    pub fn references(&self) -> impl Iterator<Item = ValueNodeId> + '_ {
        let mut references = [None, None, None];
        match self {
            Self::Arithmetic { left, right, .. } => {
                references[0] = Some(*left);
                references[1] = Some(*right);
            }
            Self::MultiplyRatio { value, .. }
            | Self::JavaScriptFloor { value }
            | Self::JavaScriptCeil { value }
            | Self::JavaScriptRound { value } => references[0] = Some(*value),
            Self::Clamp {
                value,
                minimum,
                maximum,
            } => {
                references[0] = Some(*value);
                references[1] = Some(*minimum);
                references[2] = Some(*maximum);
            }
            Self::Signed { .. }
            | Self::Unsigned { .. }
            | Self::Ratio { .. }
            | Self::QueryInput
            | Self::Field { .. } => {}
        }
        references.into_iter().flatten()
    }

    pub fn validate_scalars(&self) -> Result<(), ValueNodeError> {
        match self {
            Self::Signed { value } if value.unsigned_abs() > JS_MAX_SAFE_INTEGER => {
                Err(ValueNodeError::SignedOutsideSafeInteger { value: *value })
            }
            Self::Unsigned { value } if *value > JS_MAX_SAFE_INTEGER => {
                Err(ValueNodeError::UnsignedOutsideSafeInteger { value: *value })
            }
            Self::Ratio { value } | Self::MultiplyRatio { ratio: value, .. } => {
                value.validate().map_err(ValueNodeError::Ratio)
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ValueNodeError {
    #[error("signed value {value} is outside the JavaScript-safe range")]
    SignedOutsideSafeInteger { value: i64 },
    #[error("unsigned value {value} is outside the JavaScript-safe range")]
    UnsignedOutsideSafeInteger { value: u64 },
    #[error("invalid exact ratio: {0}")]
    Ratio(#[source] ExactRatioError),
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QueryValueKind {
    Boolean,
    SignedInteger,
    UnsignedInteger,
    Ratio,
    TypeId,
    CategoryId,
    TargetId,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum QueryModifier {
    Set { value: ValueNodeId },
    Add { value: ValueNodeId },
    Multiply { ratio: ExactRatio },
    Minimum { value: ValueNodeId },
    Maximum { value: ValueNodeId },
    Cancel,
    ReplaceType { type_id: u8 },
    ReplaceCategory { category_id: u8 },
    ReplaceTarget { target_id: u8 },
}
