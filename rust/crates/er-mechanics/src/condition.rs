use serde::{Deserialize, Serialize};

use er_types::SafeU53;
use er_types::mechanics::{MechanicScope, MechanicSourceId};

use crate::ids::{ConditionNodeId, ValueNodeId};
use crate::value::ComparisonOperator;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MechanicsRngStream {
    Battle,
    Run,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MechanicsRngReason {
    Accuracy,
    CriticalHit,
    DamageVariance,
    SecondaryEffect,
    SpeedTie,
    MultiHitCount,
    AbilityChance,
    ItemChance,
    StatusDuration,
    VolatileDuration,
    RandomTarget,
    RandomMove,
    RandomItem,
    RandomStat,
    RandomSelector,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Relation {
    SelfActor,
    SelfTarget,
    Ally,
    Opponent,
    Adjacent,
    SameSide,
    SourceOwner,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresenceKind {
    Active,
    Fainted,
    Grounded,
    MajorStatus,
    Volatile,
    Ability,
    HeldItem,
    MoveFlag,
    Weather,
    Terrain,
    SideCondition,
    ArenaTag,
    BattlerTag,
    PositionalTag,
    MechanicInstance,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ConditionNode {
    Always,
    Never,
    Not {
        child: ConditionNodeId,
    },
    All {
        children: Vec<ConditionNodeId>,
    },
    Any {
        children: Vec<ConditionNodeId>,
    },
    Compare {
        left: ValueNodeId,
        operator: ComparisonOperator,
        right: ValueNodeId,
    },
    Relation {
        relation: Relation,
    },
    Presence {
        presence: PresenceKind,
        id: Option<SafeU53>,
    },
    SourceIs {
        source: MechanicSourceId,
    },
    ScopeIs {
        scope: MechanicScope,
    },
    Chance {
        numerator: u32,
        denominator: u32,
        stream: MechanicsRngStream,
        reason: MechanicsRngReason,
    },
}

impl ConditionNode {
    pub fn condition_references(&self) -> impl Iterator<Item = ConditionNodeId> + '_ {
        let children = match self {
            Self::Not { child } => std::slice::from_ref(child),
            Self::All { children } | Self::Any { children } => children.as_slice(),
            _ => &[],
        };
        children.iter().copied()
    }

    pub fn value_references(&self) -> impl Iterator<Item = ValueNodeId> + '_ {
        let references = match self {
            Self::Compare { left, right, .. } => [Some(*left), Some(*right)],
            _ => [None, None],
        };
        references.into_iter().flatten()
    }

    pub fn validate_scalars(&self) -> Result<(), ConditionNodeError> {
        match self {
            Self::All { children } | Self::Any { children } if children.is_empty() => {
                Err(ConditionNodeError::EmptyBooleanGroup)
            }
            Self::Chance {
                numerator,
                denominator,
                ..
            } if *denominator == 0 => Err(ConditionNodeError::ZeroChanceDenominator),
            Self::Chance {
                numerator,
                denominator,
                ..
            } if numerator > denominator => Err(ConditionNodeError::ChanceAboveOne {
                numerator: *numerator,
                denominator: *denominator,
            }),
            Self::SourceIs { source } => source
                .validate()
                .map_err(|_| ConditionNodeError::InvalidSource),
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ConditionNodeError {
    #[error("boolean condition group must not be empty")]
    EmptyBooleanGroup,
    #[error("chance denominator must be positive")]
    ZeroChanceDenominator,
    #[error("chance {numerator}/{denominator} exceeds one")]
    ChanceAboveOne { numerator: u32, denominator: u32 },
    #[error("condition source identity is invalid")]
    InvalidSource,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ConditionArena(pub Vec<ConditionNode>);

impl ConditionArena {
    pub fn get(&self, id: ConditionNodeId) -> Option<&ConditionNode> {
        self.0.get(id.index())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}
