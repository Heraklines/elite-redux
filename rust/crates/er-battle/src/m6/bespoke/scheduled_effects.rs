//! Pure battle transitions for the `DELAYED_SCHEDULED_EFFECT` bespoke family
//! and the `WEATHER_TERRAIN_FIELD` lifecycle cluster.
//!
//! Every function is a closed atomic step over canonical
//! [`ScheduledEffectsState`]: validate inputs, clone and prepare the output,
//! validate the result, then return typed transition evidence. There is no
//! callback, trait-object scripting, JSON state, or silent fallback; any
//! violation fails closed.
//!
//! Frozen evidence implemented here:
//!
//! - `DelayedAttackAttr` on moves 248 (Future Sight) and 353 (Doom Desire),
//!   plus the `DELAYED_ATTACK` positional tag and the Elite Redux custom-move
//!   dispatch (`init-elite-redux-custom-moves.ts:1147`, delay operand 2) per
//!   `rust/fixtures/m6/bespoke-clusters-v1.json` and the semantic catalog;
//! - delivery order `due turn → hook stage → creation ordinal → stable ID`
//!   from `rust/contracts/m6-mechanics-ir.md`;
//! - target-slot replacement: a stored field-slot target resolves to that
//!   slot's current occupant at delivery;
//! - weather/terrain/field lifecycle for the 13 weather, 6 terrain, and 38
//!   arena-tag catalog units: replacement, lapse, and cleanup.

use std::collections::BTreeSet;

use er_mechanics::MechanicHookV2;
use er_mechanics::selector_operation_v2::{
    ScheduledEventCancellationPolicyV1, ScheduledEventPayloadV1,
};
use er_state::bespoke_v2::scheduled_effects::{
    ArenaTagId, DelayedEffectEvent, FieldConditionInstance, FieldConditionKind,
    ScheduledEffectsState, ScheduledEffectsStateError, TerrainId, WeatherId,
};
use er_types::BehaviorUnitId;
use er_types::SafeU53;
use er_types::battle_ids::{FieldSlot, PokemonId};
use er_types::mechanics::MechanicScope;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Typed rejection reasons for scheduled-effect transitions.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ScheduledEffectsError {
    #[error("delayed-effect event ID must be positive")]
    ZeroEventId,
    #[error("event ID {event_id} is already pending")]
    DuplicatePendingEventId { event_id: u64 },
    #[error("event ID {event_id} was consumed earlier; stable IDs are never reused")]
    ConsumedEventId { event_id: u64 },
    #[error("stable event ID allocation overflowed")]
    EventIdOverflow,
    #[error("creation ordinal allocation overflowed")]
    CreationOrdinalOverflow,
    #[error("delay must be positive and keep the due turn within range")]
    DueTurnOverflow { current_turn: u32, delay_turns: u32 },
    #[error("a delayed move is already scheduled against this field slot")]
    FutureMoveAdmissionConflict,
    #[error("FUTURE_MOVE payloads require a field-slot stored target")]
    FutureMoveTargetRequired,
    #[error("delivery hook must be a trigger stage")]
    QueryDeliveryHook,
    #[error("unknown scheduled effect {event_id}")]
    UnknownEventId { event_id: u64 },
    #[error("weather identity NONE cannot be applied")]
    ReservedNoneWeather,
    #[error("terrain identity NONE cannot be applied")]
    ReservedNoneTerrain,
    #[error("arena tag NONE cannot be applied")]
    ReservedNoneArenaTag,
    #[error("condition duration must be positive")]
    ZeroDurationTurns,
    #[error("no live arena tag condition for tag {tag:?} on the requested scope")]
    UnknownArenaTag { tag: ArenaTagId },
    #[error("slot occupants are not sorted by canonical slot order")]
    UnsortedSlotOccupants,
    #[error("canonical state rejected the transition result: {0}")]
    State(#[from] ScheduledEffectsStateError),
}

/// Deterministic transition log entry, appended in execution order so a
/// drained transition replays identically everywhere.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScheduledEffectsLogEntry {
    EffectScheduled {
        event_id: u64,
        due_turn: u32,
    },
    EffectDelivered {
        event_id: u64,
    },
    EffectFizzled {
        event_id: u64,
    },
    EffectCancelled {
        event_id: u64,
        reason: CancellationReason,
    },
    WeatherSet {
        weather: WeatherId,
        duration_turns: u16,
        replaced_previous: bool,
    },
    WeatherExpired,
    WeatherCleared,
    TerrainSet {
        terrain: TerrainId,
        duration_turns: u16,
        replaced_previous: bool,
    },
    TerrainExpired,
    TerrainCleared,
    ArenaTagApplied {
        tag: ArenaTagId,
        owner: MechanicScope,
        duration_turns: u16,
        replaced_previous: bool,
    },
    ArenaTagExpired {
        tag: ArenaTagId,
        owner: MechanicScope,
    },
    ArenaTagRemoved {
        tag: ArenaTagId,
        owner: MechanicScope,
    },
}

/// Why a pending effect left the queue without delivering.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CancellationReason {
    OwnerFainted,
    OwnerLeftField,
    TargetFainted,
    ExplicitCancel,
}

/// Request to schedule one delayed move effect.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelayedEffectRequest {
    pub event_id: u64,
    pub source_behavior_unit: BehaviorUnitId,
    pub owner: MechanicScope,
    pub stored_target: Option<MechanicScope>,
    pub delay_turns: u32,
    pub delivery_hook: MechanicHookV2,
    pub payload: ScheduledEventPayloadV1,
    pub cancellation_policy: ScheduledEventCancellationPolicyV1,
}

/// Typed slot→occupant resolution used at delivery time.
///
/// A plain sorted vector keeps the context serializable and deterministic;
/// slots absent from the context resolve as unoccupied.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SlotOccupants {
    entries: Vec<(FieldSlot, Option<PokemonId>)>,
}

impl SlotOccupants {
    /// Builds the context after checking canonical ascending unique order.
    pub fn new(
        entries: Vec<(FieldSlot, Option<PokemonId>)>,
    ) -> Result<Self, ScheduledEffectsError> {
        let mut previous: Option<FieldSlot> = None;
        for (slot, _) in &entries {
            if previous.is_some_and(|previous| *slot <= previous) {
                return Err(ScheduledEffectsError::UnsortedSlotOccupants);
            }
            previous = Some(*slot);
        }
        Ok(Self { entries })
    }

    /// Current occupant of `slot`: an absent outer value means the slot is
    /// not part of the resolution context (unoccupied), an inner `None`
    /// means a known-but-empty slot.
    pub fn occupant(&self, slot: FieldSlot) -> Option<Option<PokemonId>> {
        self.entries
            .iter()
            .find(|(candidate, _)| *candidate == slot)
            .map(|(_, occupant)| *occupant)
    }
}

/// Scopes whose owner has fainted or left the field, consulted when a
/// cancellation policy fires during draining.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct UnavailableScopes {
    scopes: BTreeSet<MechanicScope>,
}

impl UnavailableScopes {
    pub fn from_scopes(scopes: impl IntoIterator<Item = MechanicScope>) -> Self {
        Self {
            scopes: scopes.into_iter().collect(),
        }
    }

    pub fn contains(&self, scope: &MechanicScope) -> bool {
        self.scopes.contains(scope)
    }
}

/// How a delivered effect's stored target resolved.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResolvedTarget {
    /// The stored target itself (non-slot ownership).
    StoredScope(MechanicScope),
    /// Slot replacement: the current occupant of the stored field slot.
    SlotOccupant { pokemon: PokemonId },
    /// The stored slot had no occupant at delivery time.
    UnoccupiedSlot,
}

/// One delivered delayed effect in drain order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeliveryRecord {
    pub event_id: u64,
    pub payload: ScheduledEventPayloadV1,
    pub owner: MechanicScope,
    pub resolved_target: ResolvedTarget,
}

/// Atomic output of a scheduling or cancellation transition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScheduleOutcome {
    pub state: ScheduledEffectsState,
    pub log: Vec<ScheduledEffectsLogEntry>,
}

/// Atomic output of draining every due event.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DrainOutcome {
    pub state: ScheduledEffectsState,
    pub records: Vec<DeliveryRecord>,
    pub log: Vec<ScheduledEffectsLogEntry>,
}

/// Request to apply or replace one weather/terrain/arena-tag condition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FieldConditionRequest {
    pub source_behavior_unit: BehaviorUnitId,
    pub owner: MechanicScope,
    pub duration_turns: u16,
}

/// Atomic output of one field-condition transition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FieldOutcome {
    pub state: ScheduledEffectsState,
    pub log: Vec<ScheduledEffectsLogEntry>,
}

/// Atomic output of one end-of-turn field lapse.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LapseOutcome {
    pub state: ScheduledEffectsState,
    pub log: Vec<ScheduledEffectsLogEntry>,
}

/// Allocates the next family-wide creation ordinal.
fn allocate_ordinal(
    state: &ScheduledEffectsState,
) -> Result<(SafeU53, SafeU53), ScheduledEffectsError> {
    let ordinal = state.next_creation_ordinal;
    let next = SafeU53::new(ordinal.get() + 1)
        .map_err(|_| ScheduledEffectsError::CreationOrdinalOverflow)?;
    Ok((ordinal, next))
}

/// Validates the prepared output state as the final atomic step.
fn finish(
    prepared: ScheduledEffectsState,
    log: Vec<ScheduledEffectsLogEntry>,
) -> Result<ScheduleOutcome, ScheduledEffectsError> {
    prepared.validate()?;
    Ok(ScheduleOutcome {
        state: prepared,
        log,
    })
}

/// Schedules one delayed move effect (Future Sight / Doom Desire admission).
///
/// The due turn is `current_turn + delay_turns` under checked arithmetic and
/// must land strictly after the scheduling turn. Stable event identity fails
/// closed: zero, already-pending, or previously consumed IDs are rejected. A
/// `FUTURE_MOVE` payload admits at most one pending delayed move per stored
/// field-slot target and requires that slot target.
pub fn schedule_delayed_effect(
    state: &ScheduledEffectsState,
    current_turn: u32,
    request: DelayedEffectRequest,
) -> Result<ScheduleOutcome, ScheduledEffectsError> {
    if request.event_id == 0 {
        return Err(ScheduledEffectsError::ZeroEventId);
    }
    if request.delivery_hook.is_query() {
        return Err(ScheduledEffectsError::QueryDeliveryHook);
    }
    let due_turn = current_turn
        .checked_add(request.delay_turns)
        .filter(|_| request.delay_turns > 0)
        .ok_or(ScheduledEffectsError::DueTurnOverflow {
            current_turn,
            delay_turns: request.delay_turns,
        })?;
    if state
        .pending_events
        .iter()
        .any(|event| event.event_id == request.event_id)
    {
        return Err(ScheduledEffectsError::DuplicatePendingEventId {
            event_id: request.event_id,
        });
    }
    if state
        .scheduled_event_ids
        .binary_search(&request.event_id)
        .is_ok()
    {
        return Err(ScheduledEffectsError::ConsumedEventId {
            event_id: request.event_id,
        });
    }
    // Stable IDs may be allocated in any caller-chosen order; the high-water
    // mark only moves forward.
    let next_event_id = state.next_event_id.max(
        request
            .event_id
            .checked_add(1)
            .ok_or(ScheduledEffectsError::EventIdOverflow)?,
    );
    if matches!(request.payload, ScheduledEventPayloadV1::FutureMove { .. }) {
        match request.stored_target {
            Some(MechanicScope::Field { .. }) => {}
            _ => return Err(ScheduledEffectsError::FutureMoveTargetRequired),
        }
        let conflict = state.pending_events.iter().any(|event| {
            matches!(event.payload, ScheduledEventPayloadV1::FutureMove { .. })
                && event.stored_target == request.stored_target
        });
        if conflict {
            return Err(ScheduledEffectsError::FutureMoveAdmissionConflict);
        }
    }
    let mut prepared = state.clone();
    let insert_position = state
        .scheduled_event_ids
        .binary_search(&request.event_id)
        .expect_err("consumed check above guarantees the ID is free");
    prepared
        .scheduled_event_ids
        .insert(insert_position, request.event_id);
    let (creation_ordinal, next_creation_ordinal) = allocate_ordinal(state)?;
    prepared.pending_events.push(DelayedEffectEvent {
        event_id: request.event_id,
        source_behavior_unit: request.source_behavior_unit,
        owner: request.owner,
        stored_target: request.stored_target,
        creation_ordinal,
        due_turn,
        delivery_hook: request.delivery_hook,
        payload: request.payload,
        cancellation_policy: request.cancellation_policy,
    });
    prepared
        .pending_events
        .sort_by_key(|event| event.delivery_key());
    prepared.next_event_id = next_event_id;
    prepared.next_creation_ordinal = next_creation_ordinal;
    let event_id = request.event_id;
    finish(
        prepared,
        vec![ScheduledEffectsLogEntry::EffectScheduled { event_id, due_turn }],
    )
}

/// Drains every due event in frozen delivery order:
/// `due turn → hook stage → creation ordinal → stable event ID`.
///
/// Cancellation policies fire against [`UnavailableScopes`] before delivery;
/// delivered effects resolve stored field-slot targets to their current
/// occupants (target-slot replacement), and effects on unoccupied slots
/// fizzle without mutating any other record. Not-yet-due events are retained
/// untouched. The transition is atomic: the whole batch drains into one
/// validated new state or nothing changes.
pub fn drain_due_events(
    state: &ScheduledEffectsState,
    current_turn: u32,
    occupants: &SlotOccupants,
    unavailable: &UnavailableScopes,
) -> Result<DrainOutcome, ScheduledEffectsError> {
    let mut prepared = state.clone();
    prepared
        .pending_events
        .retain(|event| event.due_turn > current_turn);
    let mut records = Vec::new();
    let mut log = Vec::new();
    for event in &state.pending_events {
        if event.due_turn > current_turn {
            break;
        }
        let cancellation_reason = match event.cancellation_policy {
            ScheduledEventCancellationPolicyV1::Never
            | ScheduledEventCancellationPolicyV1::BattleEnded => None,
            ScheduledEventCancellationPolicyV1::OwnerFainted => unavailable
                .contains(&event.owner)
                .then_some(CancellationReason::OwnerFainted),
            ScheduledEventCancellationPolicyV1::OwnerLeftField => unavailable
                .contains(&event.owner)
                .then_some(CancellationReason::OwnerLeftField),
            ScheduledEventCancellationPolicyV1::TargetFainted => event
                .stored_target
                .as_ref()
                .is_some_and(|target| unavailable.contains(target))
                .then_some(CancellationReason::TargetFainted),
        };
        if let Some(reason) = cancellation_reason {
            log.push(ScheduledEffectsLogEntry::EffectCancelled {
                event_id: event.event_id,
                reason,
            });
            continue;
        }
        let resolved_target = match event.stored_target {
            Some(MechanicScope::Field { slot }) => match occupants.occupant(slot) {
                Some(Some(pokemon)) => ResolvedTarget::SlotOccupant { pokemon },
                _ => ResolvedTarget::UnoccupiedSlot,
            },
            other => ResolvedTarget::StoredScope(other.unwrap_or(event.owner)),
        };
        if let ResolvedTarget::UnoccupiedSlot = resolved_target {
            log.push(ScheduledEffectsLogEntry::EffectFizzled {
                event_id: event.event_id,
            });
            continue;
        }
        log.push(ScheduledEffectsLogEntry::EffectDelivered {
            event_id: event.event_id,
        });
        records.push(DeliveryRecord {
            event_id: event.event_id,
            payload: event.payload.clone(),
            owner: event.owner,
            resolved_target,
        });
    }
    prepared.validate()?;
    Ok(DrainOutcome {
        state: prepared,
        records,
        log,
    })
}

/// Explicitly cancels one pending effect by stable event identity.
pub fn cancel_scheduled_effect(
    state: &ScheduledEffectsState,
    event_id: u64,
) -> Result<ScheduleOutcome, ScheduledEffectsError> {
    let index = state
        .pending_events
        .iter()
        .position(|event| event.event_id == event_id)
        .ok_or(ScheduledEffectsError::UnknownEventId { event_id })?;
    let mut prepared = state.clone();
    prepared.pending_events.remove(index);
    finish(
        prepared,
        vec![ScheduledEffectsLogEntry::EffectCancelled {
            event_id,
            reason: CancellationReason::ExplicitCancel,
        }],
    )
}

/// Retires every pending effect owned by `owner` (for example when the owner
/// leaves the field). Retiring an empty queue is an idempotent no-op.
pub fn retire_events_for_owner(
    state: &ScheduledEffectsState,
    owner: MechanicScope,
) -> Result<ScheduleOutcome, ScheduledEffectsError> {
    let retired: Vec<u64> = state
        .pending_events
        .iter()
        .filter(|event| event.owner == owner)
        .map(|event| event.event_id)
        .collect();
    let mut prepared = state.clone();
    prepared.pending_events.retain(|event| event.owner != owner);
    let log = retired
        .into_iter()
        .map(|event_id| ScheduledEffectsLogEntry::EffectCancelled {
            event_id,
            reason: CancellationReason::ExplicitCancel,
        })
        .collect();
    finish(prepared, log)
}

/// Validates a field-condition request and builds its live instance with a
/// freshly allocated family-wide creation ordinal, returning the instance
/// plus the advanced allocation counter.
fn prepare_condition(
    state: &ScheduledEffectsState,
    kind: FieldConditionKind,
    request: FieldConditionRequest,
) -> Result<(FieldConditionInstance, SafeU53), ScheduledEffectsError> {
    if request.duration_turns == 0 {
        return Err(ScheduledEffectsError::ZeroDurationTurns);
    }
    let (creation_ordinal, next_creation_ordinal) = allocate_ordinal(state)?;
    Ok((
        FieldConditionInstance {
            kind,
            source_behavior_unit: request.source_behavior_unit,
            owner: request.owner,
            creation_ordinal,
            remaining_turns: request.duration_turns,
        },
        next_creation_ordinal,
    ))
}

/// Validates a [`FieldOutcome`] as the final atomic step.
fn finish_field(
    prepared: ScheduledEffectsState,
    log: Vec<ScheduledEffectsLogEntry>,
) -> Result<FieldOutcome, ScheduledEffectsError> {
    prepared.validate()?;
    Ok(FieldOutcome {
        state: prepared,
        log,
    })
}

/// Applies (or replaces) the active weather with fresh duration turns. A new
/// application always replaces the previous weather, even an identical one.
pub fn set_weather(
    state: &ScheduledEffectsState,
    weather: WeatherId,
    request: FieldConditionRequest,
) -> Result<FieldOutcome, ScheduledEffectsError> {
    if weather == WeatherId::None {
        return Err(ScheduledEffectsError::ReservedNoneWeather);
    }
    let replaced_previous = state.weather.is_some();
    let (condition, next_creation_ordinal) = prepare_condition(
        state,
        FieldConditionKind::Weather { weather },
        request.clone(),
    )?;
    let mut prepared = state.clone();
    prepared.weather = Some(condition);
    prepared.next_creation_ordinal = next_creation_ordinal;
    finish_field(
        prepared,
        vec![ScheduledEffectsLogEntry::WeatherSet {
            weather,
            duration_turns: request.duration_turns,
            replaced_previous,
        }],
    )
}

/// Clears the active weather; clearing absent weather is an idempotent no-op.
pub fn clear_weather(state: &ScheduledEffectsState) -> Result<FieldOutcome, ScheduledEffectsError> {
    let mut prepared = state.clone();
    let cleared = prepared.weather.take().is_some();
    let log = cleared
        .then(|| vec![ScheduledEffectsLogEntry::WeatherCleared])
        .unwrap_or_default();
    finish_field(prepared, log)
}

/// Applies (or replaces) the active terrain with fresh duration turns. A new
/// application always replaces the previous terrain, even an identical one.
pub fn set_terrain(
    state: &ScheduledEffectsState,
    terrain: TerrainId,
    request: FieldConditionRequest,
) -> Result<FieldOutcome, ScheduledEffectsError> {
    if terrain == TerrainId::None {
        return Err(ScheduledEffectsError::ReservedNoneTerrain);
    }
    let replaced_previous = state.terrain.is_some();
    let (condition, next_creation_ordinal) = prepare_condition(
        state,
        FieldConditionKind::Terrain { terrain },
        request.clone(),
    )?;
    let mut prepared = state.clone();
    prepared.terrain = Some(condition);
    prepared.next_creation_ordinal = next_creation_ordinal;
    finish_field(
        prepared,
        vec![ScheduledEffectsLogEntry::TerrainSet {
            terrain,
            duration_turns: request.duration_turns,
            replaced_previous,
        }],
    )
}

/// Clears the active terrain; clearing absent terrain is an idempotent no-op.
pub fn clear_terrain(state: &ScheduledEffectsState) -> Result<FieldOutcome, ScheduledEffectsError> {
    let mut prepared = state.clone();
    let cleared = prepared.terrain.take().is_some();
    let log = cleared
        .then(|| vec![ScheduledEffectsLogEntry::TerrainCleared])
        .unwrap_or_default();
    finish_field(prepared, log)
}

/// Applies one arena tag on `request.owner`'s scope, or replaces the live
/// instance of the same `(tag, scope)` key with fresh duration turns while
/// preserving canonical ascending key order.
pub fn apply_arena_tag(
    state: &ScheduledEffectsState,
    tag: ArenaTagId,
    request: FieldConditionRequest,
) -> Result<FieldOutcome, ScheduledEffectsError> {
    if tag == ArenaTagId::None {
        return Err(ScheduledEffectsError::ReservedNoneArenaTag);
    }
    let replaced_previous = state.arena_tags.iter().any(|condition| {
        condition.owner == request.owner && condition.kind.arena_tag() == Some(tag)
    });
    let (condition, next_creation_ordinal) =
        prepare_condition(state, FieldConditionKind::ArenaTag { tag }, request.clone())?;
    let mut prepared = state.clone();
    prepared.next_creation_ordinal = next_creation_ordinal;
    prepared.arena_tags.retain(|existing| {
        !(existing.owner == request.owner && existing.kind.arena_tag() == Some(tag))
    });
    prepared.arena_tags.push(condition);
    prepared
        .arena_tags
        .sort_by_key(|existing| (existing.kind.arena_tag(), existing.owner));
    finish_field(
        prepared,
        vec![ScheduledEffectsLogEntry::ArenaTagApplied {
            tag,
            owner: request.owner,
            duration_turns: request.duration_turns,
            replaced_previous,
        }],
    )
}

/// Removes one live arena-tag condition by `(tag, owner)` identity.
pub fn remove_arena_tag(
    state: &ScheduledEffectsState,
    tag: ArenaTagId,
    owner: MechanicScope,
) -> Result<FieldOutcome, ScheduledEffectsError> {
    let index = state
        .arena_tags
        .iter()
        .position(|condition| condition.owner == owner && condition.kind.arena_tag() == Some(tag))
        .ok_or(ScheduledEffectsError::UnknownArenaTag { tag })?;
    let mut prepared = state.clone();
    prepared.arena_tags.remove(index);
    finish_field(
        prepared,
        vec![ScheduledEffectsLogEntry::ArenaTagRemoved { tag, owner }],
    )
}

/// End-of-turn lapse over the whole field in frozen order: weather first,
/// then terrain, then arena tags ascending by `(tag identity, owner scope)`.
/// Every live condition loses exactly one turn; conditions reaching zero
/// expire and are logged. Survivors keep their relative order.
pub fn lapse_field_conditions(
    state: &ScheduledEffectsState,
) -> Result<LapseOutcome, ScheduledEffectsError> {
    let mut prepared = state.clone();
    let mut log = Vec::new();
    let mut lapse = |condition: Option<FieldConditionInstance>,
                     expired: ScheduledEffectsLogEntry| {
        match condition {
            Some(mut condition) => {
                condition.remaining_turns -= 1;
                if condition.remaining_turns == 0 {
                    log.push(expired);
                    None
                } else {
                    Some(condition)
                }
            }
            None => None,
        }
    };
    prepared.weather = lapse(
        prepared.weather.take(),
        ScheduledEffectsLogEntry::WeatherExpired,
    );
    prepared.terrain = lapse(
        prepared.terrain.take(),
        ScheduledEffectsLogEntry::TerrainExpired,
    );
    for condition in &state.arena_tags {
        if condition.remaining_turns == 1 {
            if let Some(tag) = condition.kind.arena_tag() {
                log.push(ScheduledEffectsLogEntry::ArenaTagExpired {
                    tag,
                    owner: condition.owner,
                });
            }
        }
    }
    for condition in &mut prepared.arena_tags {
        condition.remaining_turns -= 1;
    }
    prepared
        .arena_tags
        .retain(|condition| condition.remaining_turns > 0);
    prepared.validate()?;
    Ok(LapseOutcome {
        state: prepared,
        log,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_state::bespoke_v2::scheduled_effects::SCHEDULED_EFFECTS_SCHEMA_VERSION;
    use er_types::BehaviorSourceId;
    use er_types::BehaviorUnitKind;
    use er_types::BehaviorUnitOrdinal;
    use er_types::ProvenanceHash;
    use er_types::battle_ids::BattleSide;

    const FIXTURE_HASH: &str = "c3454e08d7445e131e46dec1fb9cbf2c5da15d843d1a404c028ecedda6668a4e";

    fn unit(source: BehaviorSourceId) -> BehaviorUnitId {
        BehaviorUnitId {
            source,
            unit_kind: BehaviorUnitKind::MoveAttribute,
            ordinal: BehaviorUnitOrdinal::ZERO,
            provenance_hash: ProvenanceHash::parse(FIXTURE_HASH).expect("fixture hash"),
        }
    }

    fn future_sight_unit() -> BehaviorUnitId {
        unit(BehaviorSourceId::Move {
            numeric_id: SafeU53::new(248).expect("move id"),
        })
    }

    fn doom_desire_unit() -> BehaviorUnitId {
        unit(BehaviorSourceId::Move {
            numeric_id: SafeU53::new(353).expect("move id"),
        })
    }

    fn pokemon(id: u64) -> PokemonId {
        PokemonId::try_from_u64(id).expect("pokemon id")
    }

    fn player_slot(position: u8) -> FieldSlot {
        FieldSlot::new(BattleSide::Player, position).expect("slot")
    }

    fn enemy_slot(position: u8) -> FieldSlot {
        FieldSlot::new(BattleSide::Enemy, position).expect("slot")
    }

    fn slot_scope(slot: FieldSlot) -> MechanicScope {
        MechanicScope::Field { slot }
    }

    fn request(
        event_id: u64,
        stored_target: Option<MechanicScope>,
        delay_turns: u32,
        payload: ScheduledEventPayloadV1,
    ) -> DelayedEffectRequest {
        DelayedEffectRequest {
            event_id,
            source_behavior_unit: future_sight_unit(),
            owner: MechanicScope::Pokemon {
                pokemon: pokemon(1),
            },
            stored_target,
            delay_turns,
            delivery_hook: MechanicHookV2::ScheduledEvent,
            payload,
            cancellation_policy: ScheduledEventCancellationPolicyV1::Never,
        }
    }

    fn schedule(
        state: &ScheduledEffectsState,
        current_turn: u32,
        request: DelayedEffectRequest,
    ) -> ScheduleOutcome {
        schedule_delayed_effect(state, current_turn, request).expect("schedule")
    }

    #[test]
    fn simultaneous_due_events_deliver_in_frozen_order() {
        let state = ScheduledEffectsState::default();
        // Three effects share the due turn; hook stage then ordinal breaks ties.
        let late_ordinal = request(
            3,
            Some(MechanicScope::Battle),
            2,
            ScheduledEventPayloadV1::DelayedStatusApply,
        );
        let early_turn = request(
            1,
            None,
            1,
            ScheduledEventPayloadV1::DelayedDamage { amount: 10 },
        );
        let early_ordinal = request(
            2,
            Some(MechanicScope::Battle),
            2,
            ScheduledEventPayloadV1::DelayedStatusApply,
        );
        let mut state = schedule(&state, 5, late_ordinal).state; // due 7, ordinal 1
        state = schedule(&state, 5, early_turn).state; // due 6
        state = schedule(&state, 5, early_ordinal).state; // due 7, ordinal 3
        let outcome = drain_due_events(
            &state,
            7,
            &SlotOccupants::default(),
            &UnavailableScopes::default(),
        )
        .expect("drain");
        let order: Vec<u64> = outcome
            .records
            .iter()
            .map(|record| record.event_id)
            .collect();
        // Frozen order: due turn first (event 1), then creation ordinal among
        // the two simultaneous events (event 3 created first, then event 2).
        assert_eq!(order, vec![1, 3, 2]);
        assert!(outcome.state.pending_events.is_empty());
        assert_eq!(
            outcome.log,
            vec![
                ScheduledEffectsLogEntry::EffectDelivered { event_id: 1 },
                ScheduledEffectsLogEntry::EffectDelivered { event_id: 3 },
                ScheduledEffectsLogEntry::EffectDelivered { event_id: 2 },
            ]
        );
    }

    #[test]
    fn stored_slot_target_resolves_to_current_occupant() {
        let state = schedule(
            &ScheduledEffectsState::default(),
            0,
            request(
                1,
                Some(slot_scope(enemy_slot(0))),
                2,
                ScheduledEventPayloadV1::FutureMove {
                    move_id: SafeU53::new(248).expect("move id"),
                },
            ),
        )
        .state;
        // The original target left; a replacement now occupies the slot.
        let occupants =
            SlotOccupants::new(vec![(enemy_slot(0), Some(pokemon(9)))]).expect("occupants");
        let outcome =
            drain_due_events(&state, 2, &occupants, &UnavailableScopes::default()).expect("drain");
        assert_eq!(outcome.records.len(), 1);
        assert_eq!(
            outcome.records[0].resolved_target,
            ResolvedTarget::SlotOccupant {
                pokemon: pokemon(9)
            }
        );
    }

    #[test]
    fn unoccupied_stored_slot_fizzles_without_delivery() {
        let state = schedule(
            &ScheduledEffectsState::default(),
            0,
            request(
                1,
                Some(slot_scope(enemy_slot(1))),
                2,
                ScheduledEventPayloadV1::FutureMove {
                    move_id: SafeU53::new(248).expect("move id"),
                },
            ),
        )
        .state;
        let occupants = SlotOccupants::new(vec![(enemy_slot(1), None)]).expect("occupants");
        let outcome =
            drain_due_events(&state, 2, &occupants, &UnavailableScopes::default()).expect("drain");
        assert!(outcome.records.is_empty());
        assert_eq!(
            outcome.log,
            vec![ScheduledEffectsLogEntry::EffectFizzled { event_id: 1 }]
        );
    }

    #[test]
    fn duplicate_and_consumed_event_ids_fail_closed() {
        let first = request(
            1,
            None,
            2,
            ScheduledEventPayloadV1::DelayedDamage { amount: 10 },
        );
        let state = schedule(&ScheduledEffectsState::default(), 0, first).state;
        let duplicate = request(
            1,
            None,
            3,
            ScheduledEventPayloadV1::DelayedDamage { amount: 10 },
        );
        assert_eq!(
            schedule_delayed_effect(&state, 0, duplicate),
            Err(ScheduledEffectsError::DuplicatePendingEventId { event_id: 1 })
        );
        let drained = drain_due_events(
            &state,
            2,
            &SlotOccupants::default(),
            &UnavailableScopes::default(),
        )
        .expect("drain")
        .state;
        // The ID was consumed by delivery and can never be reused.
        let reuse = request(
            1,
            None,
            2,
            ScheduledEventPayloadV1::DelayedDamage { amount: 10 },
        );
        assert_eq!(
            schedule_delayed_effect(&drained, 2, reuse),
            Err(ScheduledEffectsError::ConsumedEventId { event_id: 1 })
        );
    }

    #[test]
    fn not_yet_due_events_are_retained() {
        let state = schedule(
            &ScheduledEffectsState::default(),
            0,
            request(
                1,
                None,
                5,
                ScheduledEventPayloadV1::DelayedDamage { amount: 10 },
            ),
        )
        .state;
        let outcome = drain_due_events(
            &state,
            4,
            &SlotOccupants::default(),
            &UnavailableScopes::default(),
        )
        .expect("drain");
        assert!(outcome.records.is_empty());
        assert_eq!(outcome.state.pending_events.len(), 1);
        assert_eq!(outcome.state.next_event_id, 2);
    }

    #[test]
    fn stable_ids_may_allocate_out_of_order_and_ledger_stays_sorted() {
        let mut state = ScheduledEffectsState::default();
        state = schedule(
            &state,
            0,
            request(
                7,
                None,
                2,
                ScheduledEventPayloadV1::DelayedDamage { amount: 10 },
            ),
        )
        .state;
        assert_eq!(state.scheduled_event_ids, vec![7]);
        assert_eq!(state.next_event_id, 8);
        // A lower never-used ID stays schedulable despite the high-water mark.
        state = schedule(
            &state,
            0,
            request(
                2,
                None,
                3,
                ScheduledEventPayloadV1::DelayedDamage { amount: 10 },
            ),
        )
        .state;
        assert_eq!(state.scheduled_event_ids, vec![2, 7]);
        assert_eq!(state.next_event_id, 8);
        // An unsorted consumed-ID ledger fails validation closed.
        let mut corrupt = state.clone();
        corrupt.scheduled_event_ids.reverse();
        assert_eq!(
            corrupt.validate(),
            Err(ScheduledEffectsStateError::ConsumedEventIdsOutOfOrder)
        );
    }

    #[test]
    fn cancellation_policies_fire_against_unavailable_scopes() {
        let mut state = ScheduledEffectsState::default();
        state = schedule(
            &state,
            0,
            DelayedEffectRequest {
                cancellation_policy: ScheduledEventCancellationPolicyV1::OwnerFainted,
                ..request(1, None, 2, ScheduledEventPayloadV1::DelayedStatusApply)
            },
        )
        .state;
        state = schedule(
            &state,
            0,
            request(2, None, 2, ScheduledEventPayloadV1::DelayedStatusApply),
        )
        .state;
        let unavailable = UnavailableScopes::from_scopes(vec![MechanicScope::Pokemon {
            pokemon: pokemon(1),
        }]);
        let outcome =
            drain_due_events(&state, 2, &SlotOccupants::default(), &unavailable).expect("drain");
        assert_eq!(outcome.records.len(), 1);
        assert_eq!(outcome.records[0].event_id, 2);
        assert_eq!(
            outcome.log[0],
            ScheduledEffectsLogEntry::EffectCancelled {
                event_id: 1,
                reason: CancellationReason::OwnerFainted,
            }
        );
    }

    #[test]
    fn explicit_cancel_and_owner_retirement_remove_effects() {
        let mut state = ScheduledEffectsState::default();
        state = schedule(
            &state,
            0,
            request(1, None, 2, ScheduledEventPayloadV1::DelayedStatusApply),
        )
        .state;
        state = schedule(
            &state,
            0,
            request(2, None, 2, ScheduledEventPayloadV1::DelayedStatusApply),
        )
        .state;
        let cancelled = cancel_scheduled_effect(&state, 1).expect("cancel");
        assert_eq!(
            cancelled.log,
            vec![ScheduledEffectsLogEntry::EffectCancelled {
                event_id: 1,
                reason: CancellationReason::ExplicitCancel,
            }]
        );
        let unknown = cancel_scheduled_effect(&cancelled.state, 42);
        assert_eq!(
            unknown,
            Err(ScheduledEffectsError::UnknownEventId { event_id: 42 })
        );
        let retired = retire_events_for_owner(
            &cancelled.state,
            MechanicScope::Pokemon {
                pokemon: pokemon(1),
            },
        )
        .expect("retire");
        assert!(retired.state.pending_events.is_empty());
    }

    #[test]
    fn scheduling_rejects_overflowing_due_turns() {
        let state = ScheduledEffectsState::default();
        assert_eq!(
            schedule_delayed_effect(
                &state,
                u32::MAX,
                request(1, None, 1, ScheduledEventPayloadV1::DelayedStatusApply)
            ),
            Err(ScheduledEffectsError::DueTurnOverflow {
                current_turn: u32::MAX,
                delay_turns: 1
            })
        );
        assert_eq!(
            schedule_delayed_effect(
                &state,
                0,
                request(1, None, 0, ScheduledEventPayloadV1::DelayedStatusApply)
            ),
            Err(ScheduledEffectsError::DueTurnOverflow {
                current_turn: 0,
                delay_turns: 0
            })
        );
    }

    #[test]
    fn creation_ordinal_exhaustion_fails_closed() {
        let mut state = ScheduledEffectsState::default();
        state.next_creation_ordinal = SafeU53::MAX;
        let outcome = schedule_delayed_effect(
            &state,
            0,
            request(1, None, 2, ScheduledEventPayloadV1::DelayedStatusApply),
        );
        assert_eq!(
            outcome.err(),
            Some(ScheduledEffectsError::CreationOrdinalOverflow)
        );
    }

    #[test]
    fn future_move_admission_is_one_pending_event_per_slot() {
        let base = request(
            1,
            Some(slot_scope(player_slot(0))),
            2,
            ScheduledEventPayloadV1::FutureMove {
                move_id: SafeU53::new(248).expect("move id"),
            },
        );
        let state = schedule(&ScheduledEffectsState::default(), 0, base).state;
        let second_future = request(
            2,
            Some(slot_scope(player_slot(0))),
            3,
            ScheduledEventPayloadV1::FutureMove {
                move_id: SafeU53::new(353).expect("move id"),
            },
        );
        assert_eq!(
            schedule_delayed_effect(&state, 0, second_future),
            Err(ScheduledEffectsError::FutureMoveAdmissionConflict)
        );
        // A different slot admits freely.
        let other_slot = request(
            3,
            Some(slot_scope(enemy_slot(0))),
            2,
            ScheduledEventPayloadV1::FutureMove {
                move_id: SafeU53::new(248).expect("move id"),
            },
        );
        let admitted = schedule(&state, 0, other_slot);
        assert_eq!(admitted.state.pending_events.len(), 2);
        // A non-future payload requires no slot target.
        let missing_target = request(
            4,
            None,
            2,
            ScheduledEventPayloadV1::FutureMove {
                move_id: SafeU53::new(248).expect("move id"),
            },
        );
        assert_eq!(
            schedule_delayed_effect(&state, 0, missing_target),
            Err(ScheduledEffectsError::FutureMoveTargetRequired)
        );
    }

    #[test]
    fn weather_replaces_and_lapses_deterministically() {
        let request = FieldConditionRequest {
            source_behavior_unit: unit(BehaviorSourceId::Weather {
                numeric_id: SafeU53::new(1).expect("weather id"),
            }),
            owner: MechanicScope::Battle,
            duration_turns: 2,
        };
        let sunny = set_weather(
            &ScheduledEffectsState::default(),
            WeatherId::Sunny,
            request.clone(),
        )
        .expect("sunny");
        assert_eq!(
            sunny.log,
            vec![ScheduledEffectsLogEntry::WeatherSet {
                weather: WeatherId::Sunny,
                duration_turns: 2,
                replaced_previous: false,
            }]
        );
        let rainy = set_weather(&sunny.state, WeatherId::Rain, request.clone()).expect("rain");
        assert!(matches!(
            rainy.log[0],
            ScheduledEffectsLogEntry::WeatherSet {
                replaced_previous: true,
                ..
            }
        ));
        assert_eq!(
            rainy.state.weather.as_ref().expect("live").remaining_turns,
            2
        );
        let lapsed_once = lapse_field_conditions(&rainy.state).expect("lapse");
        assert!(lapsed_once.state.weather.is_some());
        assert!(lapsed_once.log.is_empty());
        let lapsed_twice = lapse_field_conditions(&lapsed_once.state).expect("lapse");
        assert!(lapsed_twice.state.weather.is_none());
        assert_eq!(
            lapsed_twice.log,
            vec![ScheduledEffectsLogEntry::WeatherExpired]
        );
        let cleared = clear_weather(&rainy.state).expect("clear");
        assert_eq!(cleared.log, vec![ScheduledEffectsLogEntry::WeatherCleared]);
        let cleared_again = clear_weather(&cleared.state).expect("clear again");
        assert!(cleared_again.log.is_empty());
        assert_eq!(
            set_weather(&ScheduledEffectsState::default(), WeatherId::None, request,).err(),
            Some(ScheduledEffectsError::ReservedNoneWeather)
        );
    }

    #[test]
    fn terrain_lifecycle_sets_expires_and_clears() {
        let request = FieldConditionRequest {
            source_behavior_unit: unit(BehaviorSourceId::Terrain {
                numeric_id: SafeU53::new(5).expect("terrain id"),
            }),
            owner: MechanicScope::Battle,
            duration_turns: 1,
        };
        let toxic = set_terrain(
            &ScheduledEffectsState::default(),
            TerrainId::Toxic,
            request.clone(),
        )
        .expect("toxic");
        assert!(toxic.state.terrain.is_some());
        let lapsed = lapse_field_conditions(&toxic.state).expect("lapse");
        assert!(lapsed.state.terrain.is_none());
        assert_eq!(lapsed.log, vec![ScheduledEffectsLogEntry::TerrainExpired]);
        let misty = set_terrain(&toxic.state, TerrainId::Misty, request).expect("misty");
        assert!(matches!(
            misty.log[0],
            ScheduledEffectsLogEntry::TerrainSet {
                replaced_previous: true,
                ..
            }
        ));
        let cleared = clear_terrain(&misty.state).expect("clear");
        assert!(cleared.state.terrain.is_none());
    }

    #[test]
    fn arena_tags_replace_by_key_and_expire_in_canonical_order() {
        let tag_request = |duration_turns: u16| FieldConditionRequest {
            source_behavior_unit: unit(BehaviorSourceId::ArenaTag {
                registry_key: "TAILWIND".to_string(),
            }),
            owner: slot_scope(player_slot(0)),
            duration_turns,
        };
        let applied = apply_arena_tag(
            &ScheduledEffectsState::default(),
            ArenaTagId::Tailwind,
            tag_request(3),
        )
        .expect("apply");
        assert_eq!(applied.state.arena_tags.len(), 1);
        // Same key replaces with fresh turns instead of stacking.
        let replaced =
            apply_arena_tag(&applied.state, ArenaTagId::Tailwind, tag_request(2)).expect("replace");
        assert_eq!(replaced.state.arena_tags.len(), 1);
        assert_eq!(replaced.state.arena_tags[0].remaining_turns, 2);
        assert!(matches!(
            replaced.log[0],
            ScheduledEffectsLogEntry::ArenaTagApplied {
                replaced_previous: true,
                ..
            }
        ));
        // A second scope keeps both tags in ascending key order.
        let second_scope = FieldConditionRequest {
            owner: slot_scope(enemy_slot(0)),
            ..tag_request(1)
        };
        let both = apply_arena_tag(&replaced.state, ArenaTagId::Tailwind, second_scope)
            .expect("second scope");
        assert!(both.state.arena_tags.windows(2).all(|window| {
            (window[0].kind.arena_tag(), window[0].owner)
                < (window[1].kind.arena_tag(), window[1].owner)
        }));
        let lapsed = lapse_field_conditions(&both.state).expect("lapse");
        // Enemy scope (duration 1) expires; player scope survives with one turn.
        assert_eq!(lapsed.state.arena_tags.len(), 1);
        assert_eq!(lapsed.state.arena_tags[0].owner, slot_scope(player_slot(0)));
        assert_eq!(
            lapsed.log,
            vec![ScheduledEffectsLogEntry::ArenaTagExpired {
                tag: ArenaTagId::Tailwind,
                owner: slot_scope(enemy_slot(0)),
            }]
        );
        let removed = remove_arena_tag(
            &lapsed.state,
            ArenaTagId::Tailwind,
            slot_scope(player_slot(0)),
        )
        .expect("remove");
        assert!(removed.state.arena_tags.is_empty());
        assert_eq!(
            remove_arena_tag(
                &removed.state,
                ArenaTagId::Tailwind,
                slot_scope(player_slot(0))
            )
            .err(),
            Some(ScheduledEffectsError::UnknownArenaTag {
                tag: ArenaTagId::Tailwind
            })
        );
    }

    #[test]
    fn canonical_state_validation_rejects_corruption() {
        let state = schedule(
            &ScheduledEffectsState::default(),
            0,
            request(
                1,
                None,
                2,
                ScheduledEventPayloadV1::DelayedDamage { amount: 10 },
            ),
        )
        .state;
        assert_eq!(state.validate(), Ok(()));
        // Unsorted pending events fail closed.
        let mut unsorted = state.clone();
        unsorted.next_event_id += 1;
        unsorted.scheduled_event_ids.push(2);
        unsorted.next_creation_ordinal =
            SafeU53::new(unsorted.next_creation_ordinal.get() + 1).expect("ordinal");
        unsorted.pending_events.push(DelayedEffectEvent {
            event_id: 2,
            source_behavior_unit: doom_desire_unit(),
            owner: MechanicScope::Battle,
            stored_target: None,
            creation_ordinal: SafeU53::new(state.next_creation_ordinal.get()).expect("ordinal"),
            due_turn: 1,
            delivery_hook: MechanicHookV2::ScheduledEvent,
            payload: ScheduledEventPayloadV1::DelayedDamage { amount: 5 },
            cancellation_policy: ScheduledEventCancellationPolicyV1::Never,
        });
        assert_eq!(
            unsorted.validate(),
            Err(ScheduledEffectsStateError::EventsOutOfOrder)
        );
        // Duplicate creation ordinals across records fail closed.
        let mut duplicate = state.clone();
        duplicate.weather = Some(FieldConditionInstance {
            kind: FieldConditionKind::Weather {
                weather: WeatherId::Sunny,
            },
            source_behavior_unit: doom_desire_unit(),
            owner: MechanicScope::Battle,
            creation_ordinal: state.pending_events[0].creation_ordinal,
            remaining_turns: 2,
        });
        assert_eq!(
            duplicate.validate(),
            Err(ScheduledEffectsStateError::DuplicateCreationOrdinal)
        );
        // A schema-version mismatch rejects the whole root.
        let mut wrong_version = state;
        wrong_version.schema_version = SCHEDULED_EFFECTS_SCHEMA_VERSION + 1;
        assert!(matches!(
            wrong_version.validate(),
            Err(ScheduledEffectsStateError::SchemaVersion { .. })
        ));
    }
}
