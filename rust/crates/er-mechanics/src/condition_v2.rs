//! Mechanics IR V2: condition arena and value arena.
//!
//! V2 extends the V1 DAG with typed predicates for ability sources, held-item
//! state, mechanic instances, scheduled events, action locks, guard chains,
//! and transform overlays, per `rust/contracts/m6-mechanics-ir.md`. Chance is
//! still the only generic condition that draws RNG; a false branch consumes no
//! later draw.

use er_types::{AbilitySourceKindV1, BehaviorUnitKind, RngDomainV1, RngReasonV2, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Node identifiers local to a program's arenas.
#[derive(
    Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct ConditionNodeId(pub u16);

impl ConditionNodeId {
    pub const fn index(self) -> usize {
        self.0 as usize
    }
}

/// Value-node identifiers local to a program's value arena.
#[derive(
    Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct ValueNodeId(pub u16);

impl ValueNodeId {
    pub const fn index(self) -> usize {
        self.0 as usize
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ComparisonOperatorV2 {
    LessThan,
    LessOrEqual,
    Equal,
    NotEqual,
    GreaterOrEqual,
    GreaterThan,
}

/// Typed predicates added in V2.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ConditionPredicateV2 {
    AbilitySource {
        source_kind: AbilitySourceKindV1,
    },
    AbilitySuppressed {
        suppressed: bool,
    },
    HeldItemPresent {
        registry_key: String,
        min_stacks: u32,
    },
    HeldItemConsumed {
        consumed: bool,
    },
    ItemTransferable {
        transferable: bool,
    },
    MechanicInstanceKind {
        unit_kind: BehaviorUnitKind,
    },
    MechanicCounterAtLeast {
        counter: u32,
    },
    ScheduledEventPending {
        event_id: u64,
    },
    ActionLockActive {
        lock_active: bool,
    },
    GuardChainDepth {
        depth: u32,
    },
    RedirectStateActive {
        active: bool,
    },
    TransformOverlayActive {
        active: bool,
    },
    MoveCopyHistoryCount {
        count: u32,
    },
    SpecialDamageCounter {
        counter: u32,
    },
}

/// V2 condition DAG nodes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ConditionNodeV2 {
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
        operator: ComparisonOperatorV2,
        right: ValueNodeId,
    },
    Predicate {
        predicate: ConditionPredicateV2,
    },
    /// The only generic RNG-drawing condition. A false result consumes no
    /// downstream draw.
    Chance {
        site_ordinal: u32,
        reason: RngReasonV2,
        domain: RngDomainV1,
        numerator: u32,
        denominator: u32,
    },
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ConditionNodeErrorV2 {
    #[error("boolean condition group must not be empty")]
    EmptyBooleanGroup,
    #[error("chance denominator must be positive")]
    ZeroChanceDenominator,
    #[error("chance numerator exceeds denominator")]
    ChanceAboveOne,
    #[error("chance domain must be battle-mechanical")]
    NonMechanicalChanceDomain,
}

impl ConditionNodeV2 {
    pub fn condition_references(&self) -> impl Iterator<Item = ConditionNodeId> + '_ {
        let children: &[ConditionNodeId] = match self {
            Self::Not { child } => std::slice::from_ref(child),
            Self::All { children } | Self::Any { children } => children.as_slice(),
            _ => &[],
        };
        children.iter().copied()
    }

    pub fn value_references(&self) -> Vec<ValueNodeId> {
        match self {
            Self::Compare { left, right, .. } => vec![*left, *right],
            _ => Vec::new(),
        }
    }

    pub fn validate_scalars(&self) -> Result<(), ConditionNodeErrorV2> {
        match self {
            Self::All { children } | Self::Any { children } if children.is_empty() => {
                Err(ConditionNodeErrorV2::EmptyBooleanGroup)
            }
            Self::Chance {
                denominator,
                numerator,
                domain,
                ..
            } => {
                if *denominator == 0 {
                    Err(ConditionNodeErrorV2::ZeroChanceDenominator)
                } else if *numerator > *denominator {
                    Err(ConditionNodeErrorV2::ChanceAboveOne)
                } else if *domain != RngDomainV1::BattleMechanical {
                    Err(ConditionNodeErrorV2::NonMechanicalChanceDomain)
                } else {
                    Ok(())
                }
            }
            _ => Ok(()),
        }
    }
}

/// Indexed condition arena with iterative reachability and cycle detection.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ConditionArenaV2(pub Vec<ConditionNodeV2>);

impl ConditionArenaV2 {
    pub const MAX_DEPTH: usize = 32;

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Iterative validation from roots: scalar checks, reference bounds, and
    /// cycle detection with bounded depth.
    pub fn validate(&self, roots: &[u16]) -> Result<(), ConditionArenaErrorV2> {
        for (index, node) in self.0.iter().enumerate() {
            node.validate_scalars()
                .map_err(|source| ConditionArenaErrorV2::Node { index, source })?;
            for child in node.condition_references() {
                if child.index() >= self.0.len() {
                    return Err(ConditionArenaErrorV2::ReferenceOutOfBounds { index });
                }
            }
        }
        // Iterative DFS with color marking: 0 unseen, 1 in-stack, 2 done.
        let mut color = vec![0u8; self.0.len()];
        for root in roots {
            let mut stack = vec![(*root, 0usize)];
            while let Some((node, depth)) = stack.pop() {
                if depth > Self::MAX_DEPTH {
                    return Err(ConditionArenaErrorV2::DepthExceeded);
                }
                match color[node as usize] {
                    1 => return Err(ConditionArenaErrorV2::Cycle),
                    2 => continue,
                    _ => {}
                }
                color[node as usize] = 1;
                let children: Vec<u16> = self.0[node as usize]
                    .condition_references()
                    .map(|id| id.0)
                    .collect();
                let mut pushed = false;
                for child in children.iter().rev() {
                    match color[usize::from(*child)] {
                        1 => return Err(ConditionArenaErrorV2::Cycle),
                        2 => {}
                        _ => {
                            stack.push((node, depth + 1));
                            stack.push((*child, depth + 1));
                            pushed = true;
                            break;
                        }
                    }
                }
                if !pushed {
                    color[node as usize] = 2;
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ConditionArenaErrorV2 {
    #[error("condition node {index} is invalid: {source}")]
    Node {
        index: usize,
        source: ConditionNodeErrorV2,
    },
    #[error("condition node {index} references out of bounds")]
    ReferenceOutOfBounds { index: usize },
    #[error("condition arena contains a cycle")]
    Cycle,
    #[error("condition arena depth exceeds the frozen ceiling")]
    DepthExceeded,
}

/// Exact-ratio operand used by damage/heal/recoil operations.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExactRatioV2 {
    pub numerator: i32,
    /// Positive, nonzero.
    pub denominator: u32,
}

impl ExactRatioV2 {
    pub fn validate(&self) -> Result<(), ValueErrorV2> {
        if self.denominator == 0 {
            return Err(ValueErrorV2::InvalidRatio);
        }
        Ok(())
    }
}

/// JavaScript-number operation node: explicit conversion at a frozen rounding
/// point. No FMA, reassociation, or saturation.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum JsNumberOpV2 {
    FloorDivide { divisor: u32 },
    MultiplyRoundDown { operand_permille: u32 },
    ClampMin { minimum: i64 },
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ValueErrorV2 {
    #[error("exact ratio denominator must be positive")]
    InvalidRatio,
    #[error("constant exceeds the safe-integer bound")]
    ConstantAboveSafeInteger,
    #[error("value root is out of bounds")]
    RootOutOfBounds,
}

/// V2 value nodes: safe integers, exact ratios, JS-number operations, and
/// references into mechanic-instance counters.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ValueNodeV2 {
    Constant { value: i64 },
    ExactRatio { ratio: ExactRatioV2 },
    JsNumber { operation: JsNumberOpV2 },
    InstanceCounter,
    BehaviorOrdinal { ordinal: u32 },
    HpCurrent,
    HpMax,
    TurnIndex,
    WaveIndex,
    Level,
}

impl ValueNodeV2 {
    pub fn validate(&self) -> Result<(), ValueErrorV2> {
        match self {
            Self::ExactRatio { ratio } => ratio.validate(),
            Self::Constant { .. } => Ok(()),
            _ => Ok(()),
        }
    }

    /// Safe-integer bound check for constants.
    pub fn constant(value: i64) -> Result<Self, ValueErrorV2> {
        if value.unsigned_abs() > SafeU53::MAX.get() {
            return Err(ValueErrorV2::ConstantAboveSafeInteger);
        }
        Ok(Self::Constant { value })
    }
}

/// Value arena with per-node validation.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ValueArenaV2(pub Vec<ValueNodeV2>);

impl ValueArenaV2 {
    pub fn validate(&self, roots: &[u16]) -> Result<(), ValueErrorV2> {
        for root in roots {
            let index = *root as usize;
            self.0
                .get(index)
                .ok_or(ValueErrorV2::RootOutOfBounds)?
                .validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ArenaValidationError {
    #[error("value arena is empty but a root was declared")]
    MissingRoot,
}
