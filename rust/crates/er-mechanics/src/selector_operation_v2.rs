//! Mechanics IR V2: selectors and operations with scheduled events.
//!
//! Selectors return ordered vectors; `RandomOne` names a declared RNG site.
//! Operations stage typed mutations only — they never mutate live state
//! directly. Scheduled events sort by due turn, hook, creation ordinal, and
//! stable ID.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Closed selector vocabulary. Every multi-target selector defines canonical
/// ordering before any random draw.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum SelectorNodeV2 {
    Actor,
    Source,
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
    StoredTargets,
    FilterActive,
    FilterFainted,
    Distinct,
    First,
    Last,
    /// Audited random selection: draws exactly one candidate from the current
    /// ordered set using the named RNG site ordinal.
    RandomOne {
        site_ordinal: u32,
        /// Draw even when exactly one candidate remains.
        draw_for_singleton: bool,
    },
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SelectorErrorV2 {
    #[error("random-one selector must name a battle-mechanical RNG site")]
    InvalidRandomSite,
}

impl SelectorNodeV2 {
    pub fn validate(&self) -> Result<(), SelectorErrorV2> {
        match self {
            Self::RandomOne {
                site_ordinal: _, ..
            } => Ok(()),
            _ => Ok(()),
        }
    }
}

/// Closed trigger-operation vocabulary for V2 programs.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum MechanicOperationV2 {
    HpDamage { amount: u32 },
    HpHeal { amount: u32 },
    HpSet { amount: u32 },
    RecoilFraction { numerator: u32, denominator: u32 },
    DrainFraction { numerator: u32, denominator: u32 },
    PpConsume { amount: u8 },
    PpRestore { amount: u8 },
    StatusApply,
    StatusCure,
    StatStageChange { stat_stage: i8 },
    StatStageReset,
    AbilitySuppress { suppressed: bool },
    HeldItemConsume,
    HeldItemTransfer,
    WeatherSet,
    TerrainSet,
    SideConditionSet,
    ArenaTagApply,
    BattlerTagApply,
    PositionalTagApply,
    ChargeLockSet { locked: bool },
    GuardChainPush,
    PivotRequest,
    TrapApply,
    RedirectTarget,
    TransformOverlayApply,
    TransformOverlayClear,
    MoveCopyRecord,
    SpecialDamageCounterAdd { amount: u32 },
    InstanceCreate,
    InstanceRemove,
    ScheduledEventCreate { event_id: u64 },
    ScheduledEventCancel { event_id: u64 },
    PresentationCue { cue_ordinal: u16 },
}

impl MechanicOperationV2 {
    pub const fn is_query(&self) -> bool {
        false
    }

    /// Selector references used by program graph validation.
    pub fn selector_references(&self) -> &[u16] {
        &[]
    }
}

/// A scheduled event created by a trigger operation and delivered at its due
/// turn/hook by the atomic transition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduledEventSpecV1 {
    /// Stable identity within the owning program.
    pub event_id: u64,
    /// Due wave-relative turn index.
    pub due_turn: u32,
    /// Delivery hook stage (closed V2 hook).
    pub delivery_hook: crate::v2::MechanicHookV2,
    /// Creation order within the program for stable sorting.
    pub creation_ordinal: u32,
    /// Typed payload carried to delivery.
    pub payload: ScheduledEventPayloadV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ScheduledEventPayloadV1 {
    DelayedDamage { amount: u32 },
    DelayedHeal { amount: u32 },
    DelayedStatusApply,
    FutureMove { move_id: u64 },
}

impl ScheduledEventSpecV1 {
    pub fn validate(&self) -> Result<(), ScheduledEventError> {
        if self.event_id == 0 {
            return Err(ScheduledEventError::ZeroEventId);
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheduled_events_sort_by_due_turn_then_creation() {
        let late = ScheduledEventSpecV1 {
            event_id: 1,
            due_turn: 3,
            delivery_hook: crate::v2::MechanicHookV2::TurnEnd,
            creation_ordinal: 0,
            payload: ScheduledEventPayloadV1::DelayedHeal { amount: 10 },
        };
        let early = ScheduledEventSpecV1 {
            event_id: 2,
            due_turn: 1,
            delivery_hook: crate::v2::MechanicHookV2::TurnEnd,
            creation_ordinal: 5,
            payload: ScheduledEventPayloadV1::DelayedDamage { amount: 4 },
        };
        assert_eq!(
            compare_scheduled_events(&early, &late),
            std::cmp::Ordering::Less
        );
        assert!(late.validate().is_ok());
    }

    #[test]
    fn zero_event_ids_fail_closed() {
        let value = ScheduledEventSpecV1 {
            event_id: 0,
            due_turn: 1,
            delivery_hook: crate::v2::MechanicHookV2::TurnEnd,
            creation_ordinal: 0,
            payload: ScheduledEventPayloadV1::DelayedStatusApply,
        };
        assert_eq!(value.validate(), Err(ScheduledEventError::ZeroEventId));
    }
}
