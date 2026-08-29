//! Mechanics IR V2: closed hooks, queries, and deterministic source order.
//!
//! Hook and query values are closed enums; the total source key is the frozen
//! contract order in `rust/contracts/m6-mechanics-ir.md`. No value here
//! dispatches on TypeScript class names or provenance text.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_types::{
    AbilitySourceKindV1, BehaviorUnitKind, M6_MECHANICS_IR_VERSION, MechanicSourceKind, SafeU53,
};

pub const HOOK_STAGE_COUNT: u8 = 12;

/// Closed battle-lifecycle hook stages, ordered by execution stage.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MechanicHookV2 {
    BattleLoad,
    BattleStart,
    BeforeSummon,
    AfterSummon,
    BeforeActionOrder,
    BeforeAction,
    BeforeMove,
    MoveTargetQuery,
    PriorityQuery,
    EffectiveSpeedQuery,
    AccuracyQuery,
    CriticalQuery,
    MovePowerQuery,
    OffensiveStatQuery,
    DefensiveStatQuery,
    TypeEffectivenessQuery,
    DamageQuery,
    HitCountQuery,
    StatusEligibilityQuery,
    VolatileEligibilityQuery,
    SwitchEligibilityQuery,
    ItemEligibilityQuery,
    BeforeHit,
    AfterHit,
    AfterMove,
    AfterDamage,
    BeforeStatus,
    AfterStatus,
    BeforeSwitchOut,
    AfterSwitchOut,
    BeforeSwitchIn,
    WeatherChanged,
    WeatherLapse,
    TerrainChanged,
    TurnEnd,
    ScheduledEvent,
    BeforeFaint,
    AfterFaint,
    Victory,
}

impl MechanicHookV2 {
    /// Coarse stage rank used as the first component of the source order key.
    pub const fn stage(self) -> u8 {
        match self {
            Self::BattleLoad => 0,
            Self::BattleStart => 1,
            Self::BeforeSummon | Self::AfterSummon => 2,
            Self::BeforeActionOrder | Self::PriorityQuery | Self::EffectiveSpeedQuery => 3,
            Self::BeforeAction
            | Self::MoveTargetQuery
            | Self::AccuracyQuery
            | Self::CriticalQuery
            | Self::MovePowerQuery
            | Self::OffensiveStatQuery
            | Self::DefensiveStatQuery
            | Self::TypeEffectivenessQuery
            | Self::DamageQuery
            | Self::HitCountQuery
            | Self::StatusEligibilityQuery
            | Self::VolatileEligibilityQuery
            | Self::SwitchEligibilityQuery
            | Self::ItemEligibilityQuery => 4,
            Self::BeforeMove | Self::BeforeHit | Self::AfterHit | Self::AfterDamage => 5,
            Self::AfterMove => 6,
            Self::BeforeStatus | Self::AfterStatus => 7,
            Self::BeforeSwitchOut | Self::AfterSwitchOut | Self::BeforeSwitchIn => 8,
            Self::WeatherChanged | Self::WeatherLapse | Self::TerrainChanged => 9,
            Self::TurnEnd | Self::ScheduledEvent => 10,
            Self::BeforeFaint | Self::AfterFaint | Self::Victory => 11,
        }
    }

    /// True when this hook is a read-only query stage.
    pub const fn is_query(self) -> bool {
        matches!(
            self,
            Self::MoveTargetQuery
                | Self::PriorityQuery
                | Self::EffectiveSpeedQuery
                | Self::AccuracyQuery
                | Self::CriticalQuery
                | Self::MovePowerQuery
                | Self::OffensiveStatQuery
                | Self::DefensiveStatQuery
                | Self::TypeEffectivenessQuery
                | Self::DamageQuery
                | Self::HitCountQuery
                | Self::StatusEligibilityQuery
                | Self::VolatileEligibilityQuery
                | Self::SwitchEligibilityQuery
                | Self::ItemEligibilityQuery
        )
    }
}

/// Closed query accumulators. A query modifier must match its accumulator.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MechanicQueryV2 {
    MoveType,
    MoveCategory,
    MoveTargetShape,
    ActionPriority,
    EffectiveSpeed,
    Accuracy,
    CriticalRate,
    MovePower,
    OffensiveStat,
    DefensiveStat,
    TypeEffectiveness,
    Damage,
    HitCount,
    StatusEligibility,
    VolatileEligibility,
    SwitchEligibility,
    ItemEligibility,
}

/// The query a given query-stage hook folds into.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("hook {0:?} is not a query stage")]
pub struct HookQueryMismatch(MechanicHookV2);

impl MechanicHookV2 {
    pub const fn query(self) -> Result<MechanicQueryV2, HookQueryMismatch> {
        Ok(match self {
            Self::MoveTargetQuery => MechanicQueryV2::MoveTargetShape,
            Self::PriorityQuery => MechanicQueryV2::ActionPriority,
            Self::EffectiveSpeedQuery => MechanicQueryV2::EffectiveSpeed,
            Self::AccuracyQuery => MechanicQueryV2::Accuracy,
            Self::CriticalQuery => MechanicQueryV2::CriticalRate,
            Self::MovePowerQuery => MechanicQueryV2::MovePower,
            Self::OffensiveStatQuery => MechanicQueryV2::OffensiveStat,
            Self::DefensiveStatQuery => MechanicQueryV2::DefensiveStat,
            Self::TypeEffectivenessQuery => MechanicQueryV2::TypeEffectiveness,
            Self::DamageQuery => MechanicQueryV2::Damage,
            Self::HitCountQuery => MechanicQueryV2::HitCount,
            Self::StatusEligibilityQuery => MechanicQueryV2::StatusEligibility,
            Self::VolatileEligibilityQuery => MechanicQueryV2::VolatileEligibility,
            Self::SwitchEligibilityQuery => MechanicQueryV2::SwitchEligibility,
            Self::ItemEligibilityQuery => MechanicQueryV2::ItemEligibility,
            other => return Err(HookQueryMismatch(other)),
        })
    }
}

/// Source-class rank for the second component of the total order key.
/// Mirrors `SOURCE_KIND_ORDER` in the frozen exporter.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrderedSourceClass {
    Move,
    ActiveAbility,
    PassiveAbility,
    HeldItem,
    MajorStatus,
    Weather,
    Terrain,
    BattlerTag,
    ArenaTag,
    PositionalTag,
    Species,
    Form,
    Bespoke,
}

impl OrderedSourceClass {
    pub const fn rank(self) -> u8 {
        match self {
            Self::Move => 0,
            Self::ActiveAbility => 1,
            Self::PassiveAbility => 2,
            Self::HeldItem => 3,
            Self::MajorStatus => 4,
            Self::Weather => 5,
            Self::Terrain => 6,
            Self::BattlerTag => 7,
            Self::ArenaTag => 8,
            Self::PositionalTag => 9,
            Self::Species => 10,
            Self::Form => 11,
            Self::Bespoke => 12,
        }
    }
}

/// One ordered mechanics source participating in a hook invocation.
///
/// Ordering key (frozen):
/// `hook stage → authored priority → source class rank → side/field position →
/// ability source rank or creation ordinal → behavior-unit ordinal → stable
/// identity`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrderedMechanicSource {
    pub hook: MechanicHookV2,
    /// Oracle-authored priority where exposed; otherwise zero.
    pub authored_priority: i16,
    pub source_class: OrderedSourceClass,
    /// Side rank: player before enemy; field position within the side.
    pub side_rank: u8,
    pub field_position: u8,
    /// Ability passive-slot rank or mechanic creation ordinal.
    pub source_rank: u32,
    /// Numeric identity for numeric sources.
    pub numeric_id: Option<SafeU53>,
    /// Registry-key identity for registry sources (already UTF-8 ordered).
    pub registry_key: Option<String>,
    pub unit_kind: BehaviorUnitKind,
    pub behavior_unit_ordinal: u32,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum OrderedSourceError {
    #[error("ordered source must carry exactly one of numeric identity or registry key")]
    AmbiguousIdentity,
    #[error("ordered source class does not match its behavior-unit kind")]
    ClassKindMismatch,
}

impl OrderedMechanicSource {
    pub fn validate(&self) -> Result<(), OrderedSourceError> {
        match (&self.numeric_id, &self.registry_key) {
            (Some(_), None) | (None, Some(_)) => {}
            _ => return Err(OrderedSourceError::AmbiguousIdentity),
        }
        if !self.class_matches_kind() {
            return Err(OrderedSourceError::ClassKindMismatch);
        }
        Ok(())
    }

    fn class_matches_kind(&self) -> bool {
        match self.unit_kind {
            BehaviorUnitKind::IntrinsicMoveRule | BehaviorUnitKind::MoveAttribute => {
                self.source_class == OrderedSourceClass::Move
                    || matches!(self.source_class, OrderedSourceClass::Bespoke)
            }
            BehaviorUnitKind::ConditionalMoveAttribute => false,
            BehaviorUnitKind::AbilityAttribute => {
                self.source_class == OrderedSourceClass::ActiveAbility && self.source_rank == 0
            }
            BehaviorUnitKind::PassiveAttribute => {
                self.source_class == OrderedSourceClass::PassiveAbility
                    && matches!(self.source_rank, 1..=4)
            }
            BehaviorUnitKind::ModifierBehavior => self.source_class == OrderedSourceClass::HeldItem,
            BehaviorUnitKind::StatusBehavior => {
                self.source_class == OrderedSourceClass::MajorStatus
            }
            BehaviorUnitKind::WeatherBehavior => self.source_class == OrderedSourceClass::Weather,
            BehaviorUnitKind::TerrainBehavior => self.source_class == OrderedSourceClass::Terrain,
            BehaviorUnitKind::BattlerTagBehavior => {
                self.source_class == OrderedSourceClass::BattlerTag
            }
            BehaviorUnitKind::ArenaTagBehavior => self.source_class == OrderedSourceClass::ArenaTag,
            BehaviorUnitKind::PositionalTagBehavior => {
                self.source_class == OrderedSourceClass::PositionalTag
            }
            BehaviorUnitKind::FixedDispatchBehavior => true,
            BehaviorUnitKind::SpeciesFormBehavior => {
                matches!(
                    self.source_class,
                    OrderedSourceClass::Species | OrderedSourceClass::Form
                )
            }
        }
    }
}

/// Frozen ability-source ranks for the source order key.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AbilitySourceRank {
    Active = 0,
    PassiveSlot0 = 1,
    PassiveSlot1 = 2,
    PassiveSlot2 = 3,
    RuntimeExtra = 4,
}

impl From<AbilitySourceKindV1> for AbilitySourceRank {
    fn from(kind: AbilitySourceKindV1) -> Self {
        match kind {
            AbilitySourceKindV1::Active => Self::Active,
            AbilitySourceKindV1::PassiveSlot0 => Self::PassiveSlot0,
            AbilitySourceKindV1::PassiveSlot1 => Self::PassiveSlot1,
            AbilitySourceKindV1::PassiveSlot2 => Self::PassiveSlot2,
            AbilitySourceKindV1::RuntimeExtra => Self::RuntimeExtra,
        }
    }
}

/// Total comparator over ordered sources for one hook invocation.
pub fn compare_ordered_sources(
    left: &OrderedMechanicSource,
    right: &OrderedMechanicSource,
) -> std::cmp::Ordering {
    left.hook
        .stage()
        .cmp(&right.hook.stage())
        .then(left.authored_priority.cmp(&right.authored_priority))
        .then(left.source_class.rank().cmp(&right.source_class.rank()))
        .then(left.side_rank.cmp(&right.side_rank))
        .then(left.field_position.cmp(&right.field_position))
        .then(left.source_rank.cmp(&right.source_rank))
        .then(left.behavior_unit_ordinal.cmp(&right.behavior_unit_ordinal))
        .then_with(|| {
            // Stable final tie-break on identity.
            let left_key = (left.numeric_id.map(SafeU53::get), left.registry_key.clone());
            let right_key = (
                right.numeric_id.map(SafeU53::get),
                right.registry_key.clone(),
            );
            left_key.cmp(&right_key)
        })
        .then(left.unit_kind.cmp(&right.unit_kind))
}

/// True when the mechanics source kind maps onto the V2 ordered class set.
pub const fn is_v2_source_kind(kind: MechanicSourceKind) -> bool {
    !matches!(
        kind,
        MechanicSourceKind::SideCondition | MechanicSourceKind::VolatileStatus
    )
}

/// IR version marker re-exported for pack validation.
pub const MECHANICS_IR_VERSION_V2: u32 = M6_MECHANICS_IR_VERSION;

#[cfg(test)]
mod tests {
    use super::*;

    fn source(class: OrderedSourceClass, rank: u32, ordinal: u32) -> OrderedMechanicSource {
        OrderedMechanicSource {
            hook: MechanicHookV2::AfterSummon,
            authored_priority: 0,
            source_class: class,
            side_rank: 0,
            field_position: 0,
            source_rank: rank,
            numeric_id: Some(er_types::SafeU53::new(7).unwrap()),
            registry_key: None,
            unit_kind: BehaviorUnitKind::AbilityAttribute,
            behavior_unit_ordinal: ordinal,
        }
    }

    #[test]
    fn active_ability_precedes_passive_slots() {
        let active = source(OrderedSourceClass::ActiveAbility, 0, 0);
        let passive = OrderedMechanicSource {
            source_class: OrderedSourceClass::PassiveAbility,
            ..source(OrderedSourceClass::ActiveAbility, 1, 0)
        };
        assert_eq!(
            compare_ordered_sources(&active, &passive),
            std::cmp::Ordering::Less
        );
    }

    #[test]
    fn passive_slots_order_by_slot_before_ordinal() {
        let slot0 = OrderedMechanicSource {
            source_class: OrderedSourceClass::PassiveAbility,
            behavior_unit_ordinal: 9,
            ..source(OrderedSourceClass::PassiveAbility, 1, 9)
        };
        let slot1 = OrderedMechanicSource {
            source_class: OrderedSourceClass::PassiveAbility,
            behavior_unit_ordinal: 0,
            ..source(OrderedSourceClass::PassiveAbility, 2, 0)
        };
        assert_eq!(
            compare_ordered_sources(&slot0, &slot1),
            std::cmp::Ordering::Less
        );
    }

    #[test]
    fn ambiguous_identity_fails_closed() {
        let mut value = source(OrderedSourceClass::ActiveAbility, 0, 0);
        value.registry_key = Some(String::new());
        assert_eq!(value.validate(), Err(OrderedSourceError::AmbiguousIdentity));
    }

    #[test]
    fn query_hooks_map_to_exactly_one_query() {
        assert_eq!(
            MechanicHookV2::AccuracyQuery.query().unwrap(),
            MechanicQueryV2::Accuracy
        );
        assert!(MechanicHookV2::TurnEnd.query().is_err());
        assert!(!MechanicHookV2::TurnEnd.is_query());
    }
}
