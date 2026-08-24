//! Mechanics IR V2 selectors, query modifiers, operations, and scheduled events.
//!
//! Selectors are immutable DAGs that always produce canonical ordered vectors.
//! Query operations are read-only. Trigger operations stage typed mutations;
//! neither form may mutate live state directly.

use er_types::mechanics::MechanicScope;
use er_types::{BehaviorUnitId, RngSiteId, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::condition_v2::{ExactRatioV2, ValueNodeId};
use crate::v2::{MechanicHookV2, MechanicQueryV2};

/// Selector-node identifiers are local to one mechanics program.
#[derive(
    Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct SelectorNodeIdV2(pub u16);

impl SelectorNodeIdV2 {
    pub const ZERO: Self = Self(0);

    pub const fn index(self) -> usize {
        self.0 as usize
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SelectorPredicateV2 {
    Active,
    Fainted,
    Healthy,
    Ally,
    Enemy,
    Adjacent,
    Bench,
    HasHeldItem,
    HasMechanicInstance,
}

/// Closed selector vocabulary. Multi-target selectors preserve canonical
/// topology/party order; no collection iteration order can escape here.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum SelectorNodeV2 {
    Actor,
    Source,
    Target,
    CommandTarget,
    LastAttacker,
    AllySide,
    EnemySide,
    ActiveBattlers,
    PartyMembers {
        fainted: bool,
    },
    Bench,
    AdjacentAllies,
    AdjacentEnemies,
    MechanicOwner,
    MechanicTarget,
    StoredTargets,
    ScheduledEventOwner,
    ScheduledEventTarget,
    Filter {
        input: SelectorNodeIdV2,
        predicate: SelectorPredicateV2,
    },
    Union {
        inputs: Vec<SelectorNodeIdV2>,
    },
    Intersect {
        left: SelectorNodeIdV2,
        right: SelectorNodeIdV2,
    },
    Distinct {
        input: SelectorNodeIdV2,
    },
    SortCanonical {
        input: SelectorNodeIdV2,
    },
    First {
        input: SelectorNodeIdV2,
    },
    Last {
        input: SelectorNodeIdV2,
    },
    Ordinal {
        input: SelectorNodeIdV2,
        ordinal: u16,
    },
    All {
        input: SelectorNodeIdV2,
    },
    /// Audited random selection from the current canonical candidate order.
    RandomOne {
        input: SelectorNodeIdV2,
        rng_site: RngSiteId,
    },
    PromoteTarget {
        input: SelectorNodeIdV2,
    },
    RedirectReplacement {
        input: SelectorNodeIdV2,
    },
}

impl SelectorNodeV2 {
    fn references(&self) -> Vec<SelectorNodeIdV2> {
        match self {
            Self::Filter { input, .. }
            | Self::Distinct { input }
            | Self::SortCanonical { input }
            | Self::First { input }
            | Self::Last { input }
            | Self::Ordinal { input, .. }
            | Self::All { input }
            | Self::RandomOne { input, .. }
            | Self::PromoteTarget { input }
            | Self::RedirectReplacement { input } => vec![*input],
            Self::Union { inputs } => inputs.clone(),
            Self::Intersect { left, right } => vec![*left, *right],
            _ => Vec::new(),
        }
    }

    fn validate_scalars(&self) -> Result<(), SelectorErrorV2> {
        if matches!(self, Self::Union { inputs } if inputs.is_empty()) {
            return Err(SelectorErrorV2::EmptyUnion);
        }
        Ok(())
    }

    pub fn rng_site(&self) -> Option<&RngSiteId> {
        match self {
            Self::RandomOne { rng_site, .. } => Some(rng_site),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SelectorArenaV2(pub Vec<SelectorNodeV2>);

impl SelectorArenaV2 {
    pub const MAX_DEPTH: usize = 16;

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn validate(&self, roots: &[SelectorNodeIdV2]) -> Result<(), SelectorErrorV2> {
        for (index, node) in self.0.iter().enumerate() {
            node.validate_scalars()?;
            if node
                .references()
                .iter()
                .any(|reference| reference.index() >= self.0.len())
            {
                return Err(SelectorErrorV2::ReferenceOutOfBounds { index });
            }
        }

        let mut color = vec![0u8; self.0.len()];
        for root in roots {
            if root.index() >= self.0.len() {
                return Err(SelectorErrorV2::RootOutOfBounds);
            }
            let mut stack = vec![(root.index(), 0usize, false)];
            while let Some((index, depth, exiting)) = stack.pop() {
                if depth > Self::MAX_DEPTH {
                    return Err(SelectorErrorV2::DepthExceeded);
                }
                if exiting {
                    color[index] = 2;
                    continue;
                }
                match color[index] {
                    1 => return Err(SelectorErrorV2::Cycle),
                    2 => continue,
                    _ => {}
                }
                color[index] = 1;
                stack.push((index, depth, true));
                for child in self.0[index].references().into_iter().rev() {
                    stack.push((child.index(), depth + 1, false));
                }
            }
        }
        Ok(())
    }

    pub fn rng_sites(&self) -> impl Iterator<Item = &RngSiteId> {
        self.0.iter().filter_map(SelectorNodeV2::rng_site)
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SelectorErrorV2 {
    #[error("selector union must not be empty")]
    EmptyUnion,
    #[error("selector root is out of bounds")]
    RootOutOfBounds,
    #[error("selector node {index} references out of bounds")]
    ReferenceOutOfBounds { index: usize },
    #[error("selector arena contains a cycle")]
    Cycle,
    #[error("selector arena depth exceeds the frozen ceiling")]
    DepthExceeded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QueryModifierStageV2 {
    BaseOverride,
    EarlyAdd,
    EarlyMultiply,
    MidOverride,
    LateAdd,
    LateMultiply,
    Clamp,
    FinalOverride,
    Cancel,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum QueryModifierV2 {
    Set {
        value: ValueNodeId,
    },
    Add {
        value: ValueNodeId,
    },
    Subtract {
        value: ValueNodeId,
    },
    Multiply {
        ratio: ExactRatioV2,
    },
    Divide {
        ratio: ExactRatioV2,
    },
    Minimum {
        value: ValueNodeId,
    },
    Maximum {
        value: ValueNodeId,
    },
    Clamp {
        minimum: ValueNodeId,
        maximum: ValueNodeId,
    },
    Cancel,
    Allow,
    Deny,
}

impl QueryModifierV2 {
    pub fn value_references(&self) -> Vec<ValueNodeId> {
        match self {
            Self::Set { value }
            | Self::Add { value }
            | Self::Subtract { value }
            | Self::Minimum { value }
            | Self::Maximum { value } => vec![*value],
            Self::Clamp { minimum, maximum } => vec![*minimum, *maximum],
            Self::Multiply { .. }
            | Self::Divide { .. }
            | Self::Cancel
            | Self::Allow
            | Self::Deny => Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), OperationErrorV2> {
        match self {
            Self::Multiply { ratio } | Self::Divide { ratio } => {
                ratio.validate().map_err(|_| OperationErrorV2::InvalidRatio)
            }
            _ => Ok(()),
        }
    }
}

/// Closed query/trigger operation vocabulary for V2 programs.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum MechanicOperationV2 {
    Query {
        query: MechanicQueryV2,
        stage: QueryModifierStageV2,
        modifier: QueryModifierV2,
    },
    HpDamage {
        amount: u32,
    },
    HpHeal {
        amount: u32,
    },
    HpSet {
        amount: u32,
    },
    SubstituteDamage {
        amount: u32,
    },
    RecoilFraction {
        numerator: u32,
        denominator: u32,
    },
    DrainFraction {
        numerator: u32,
        denominator: u32,
    },
    PpConsume {
        amount: u8,
    },
    PpRestore {
        amount: u8,
    },
    PpSet {
        amount: u8,
    },
    MoveUsabilitySet {
        usable: bool,
    },
    StatusApply,
    StatusCure,
    StatusCounterSet {
        value: u16,
    },
    VolatileCreate,
    VolatileRemove,
    StatStageChange {
        stat_stage: i8,
    },
    StatStageReset,
    StatStageCopy,
    StatStageInvert,
    AbilitySuppress {
        suppressed: bool,
    },
    HeldItemCreate,
    HeldItemStack {
        delta: i16,
    },
    HeldItemConsume,
    HeldItemPreserve,
    HeldItemTransfer,
    HeldItemRemove,
    WeatherSet,
    TerrainSet,
    SideConditionSet,
    ArenaTagApply,
    BattlerTagApply,
    PositionalTagApply,
    ChargeLockSet {
        locked: bool,
    },
    RechargeLockSet {
        locked: bool,
    },
    GuardChainPush,
    GuardChainClear,
    SwitchRequest,
    ForcedSwitchRequest,
    PivotRequest,
    TrapApply,
    RedirectTarget,
    TransformOverlayApply,
    TransformOverlayClear,
    MoveCopyRecord,
    MoveCallRequest,
    SpecialDamageCounterAdd {
        amount: u32,
    },
    InstanceCreate,
    InstanceUpdate,
    InstanceRemove,
    InstanceTransfer,
    ScheduledEventCreate {
        event_id: u64,
    },
    ScheduledEventCancel {
        event_id: u64,
    },
    ScheduledEventDeliver {
        event_id: u64,
    },
    PresentationCue {
        cue_ordinal: u16,
    },
}

impl MechanicOperationV2 {
    pub const fn is_query(&self) -> bool {
        matches!(self, Self::Query { .. })
    }

    pub fn query(&self) -> Option<MechanicQueryV2> {
        match self {
            Self::Query { query, .. } => Some(*query),
            _ => None,
        }
    }

    pub fn value_references(&self) -> Vec<ValueNodeId> {
        match self {
            Self::Query { modifier, .. } => modifier.value_references(),
            _ => Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), OperationErrorV2> {
        match self {
            Self::Query { modifier, .. } => modifier.validate(),
            Self::RecoilFraction { denominator, .. } | Self::DrainFraction { denominator, .. }
                if *denominator == 0 =>
            {
                Err(OperationErrorV2::InvalidRatio)
            }
            Self::StatStageChange { stat_stage } if !(-6..=6).contains(stat_stage) => {
                Err(OperationErrorV2::InvalidStatStage)
            }
            Self::ScheduledEventCreate { event_id }
            | Self::ScheduledEventCancel { event_id }
            | Self::ScheduledEventDeliver { event_id }
                if *event_id == 0 =>
            {
                Err(OperationErrorV2::ZeroEventId)
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum OperationErrorV2 {
    #[error("ratio denominator must be positive")]
    InvalidRatio,
    #[error("stat-stage delta must be within [-6, 6]")]
    InvalidStatStage,
    #[error("scheduled event ID must be positive")]
    ZeroEventId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScheduledEventCancellationPolicyV1 {
    Never,
    OwnerFainted,
    OwnerLeftField,
    TargetFainted,
    BattleEnded,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ScheduledEventPayloadV1 {
    DelayedDamage { amount: u32 },
    DelayedHeal { amount: u32 },
    DelayedStatusApply,
    FutureMove { move_id: SafeU53 },
    DeliverProgram,
}

/// A scheduled event created by a trigger operation and delivered by the
/// atomic battle transition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduledEventSpecV1 {
    pub event_id: u64,
    pub source_behavior_unit: BehaviorUnitId,
    pub owner: MechanicScope,
    pub target: Option<MechanicScope>,
    pub creation_ordinal: u32,
    pub due_turn: u32,
    pub delivery_hook: MechanicHookV2,
    pub payload: ScheduledEventPayloadV1,
    pub cancellation_policy: ScheduledEventCancellationPolicyV1,
    pub rng_sites: Vec<RngSiteId>,
}

impl ScheduledEventSpecV1 {
    pub fn validate(&self) -> Result<(), ScheduledEventError> {
        if self.event_id == 0 {
            return Err(ScheduledEventError::ZeroEventId);
        }
        self.source_behavior_unit
            .validate()
            .map_err(|_| ScheduledEventError::InvalidBehaviorUnit)?;
        if self.delivery_hook.is_query() {
            return Err(ScheduledEventError::QueryDeliveryHook);
        }
        let mut previous = None;
        for site in &self.rng_sites {
            if previous.is_some_and(|value| value >= site) {
                return Err(ScheduledEventError::RngSitesNotSortedUnique);
            }
            previous = Some(site);
        }
        Ok(())
    }
}

/// Deterministic delivery ordering for scheduled events within one transition.
pub fn compare_scheduled_events(
    left: &ScheduledEventSpecV1,
    right: &ScheduledEventSpecV1,
) -> std::cmp::Ordering {
    left.due_turn
        .cmp(&right.due_turn)
        .then_with(|| left.delivery_hook.stage().cmp(&right.delivery_hook.stage()))
        .then(left.creation_ordinal.cmp(&right.creation_ordinal))
        .then(left.event_id.cmp(&right.event_id))
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ScheduledEventError {
    #[error("scheduled event ID must be positive")]
    ZeroEventId,
    #[error("scheduled event behavior-unit identity is invalid")]
    InvalidBehaviorUnit,
    #[error("scheduled event delivery hook must be a trigger")]
    QueryDeliveryHook,
    #[error("scheduled-event RNG sites must be strictly sorted and unique")]
    RngSitesNotSortedUnique,
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::{BehaviorSourceId, BehaviorUnitKind, BehaviorUnitOrdinal, ProvenanceHash};

    fn unit() -> BehaviorUnitId {
        BehaviorUnitId {
            source: BehaviorSourceId::Move {
                numeric_id: SafeU53::new(1).expect("fixture must be valid"),
            },
            unit_kind: BehaviorUnitKind::IntrinsicMoveRule,
            ordinal: BehaviorUnitOrdinal::ZERO,
            provenance_hash: ProvenanceHash::parse("0".repeat(64)).expect("fixture must be valid"),
        }
    }

    fn event(event_id: u64, due_turn: u32) -> ScheduledEventSpecV1 {
        ScheduledEventSpecV1 {
            event_id,
            source_behavior_unit: unit(),
            owner: MechanicScope::Battle,
            target: None,
            creation_ordinal: 0,
            due_turn,
            delivery_hook: MechanicHookV2::TurnEnd,
            payload: ScheduledEventPayloadV1::DelayedHeal { amount: 10 },
            cancellation_policy: ScheduledEventCancellationPolicyV1::BattleEnded,
            rng_sites: Vec::new(),
        }
    }

    #[test]
    fn selector_cycles_fail_closed() {
        let arena = SelectorArenaV2(vec![SelectorNodeV2::Distinct {
            input: SelectorNodeIdV2::ZERO,
        }]);
        assert_eq!(
            arena.validate(&[SelectorNodeIdV2::ZERO]),
            Err(SelectorErrorV2::Cycle)
        );
    }

    #[test]
    fn scheduled_events_sort_by_due_turn() {
        let late = event(1, 3);
        let early = event(2, 1);
        assert_eq!(
            compare_scheduled_events(&early, &late),
            std::cmp::Ordering::Less
        );
        assert!(late.validate().is_ok());
    }

    #[test]
    fn zero_event_ids_fail_closed() {
        assert_eq!(
            event(0, 1).validate(),
            Err(ScheduledEventError::ZeroEventId)
        );
    }
}
