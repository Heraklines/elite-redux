//! Canonical typed state for the `DELAYED_SCHEDULED_EFFECT` bespoke family
//! and the `WEATHER_TERRAIN_FIELD` lifecycle cluster.
//!
//! The state is a closed, sorted wire form:
//!
//! - pending delayed effects sort by the frozen contract order
//!   `due turn → delivery-hook stage → creation ordinal → stable event ID`
//!   (`rust/contracts/m6-mechanics-ir.md`, "Bespoke mechanics"); duplicate
//!   event IDs and duplicate creation ordinals fail validation closed;
//! - creation ordinals are family-wide, monotone, and strictly ahead of every
//!   live delayed effect and field condition;
//! - weather and terrain are single slots (a new application replaces the
//!   previous condition), arena tags are keyed by `(tag identity, owner scope)`
//!   and stored in ascending key order;
//! - no callback, JSON blob, or platform handle is canonical.
//!
//! Transitions over this state live in `er-battle::m6::bespoke::scheduled_effects`.

use std::collections::BTreeSet;

use er_mechanics::MechanicHookV2;
use er_mechanics::selector_operation_v2::{
    ScheduledEventCancellationPolicyV1, ScheduledEventPayloadV1,
};
use er_types::BehaviorUnitId;
use er_types::SafeU53;
use er_types::mechanics::MechanicScope;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Wire schema version of this family-local canonical state.
pub const SCHEDULED_EFFECTS_SCHEMA_VERSION: u32 = 1;

/// Closed weather identities mirroring the frozen numeric IDs of
/// `src/enums/weather-type.ts` (catalog sources `WEATHER 0..=12`).
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WeatherId {
    None,
    Sunny,
    Rain,
    Sandstorm,
    Hail,
    Snow,
    Fog,
    HeavyRain,
    HarshSun,
    StrongWinds,
    TempestStorm,
    SnowyWrath,
    EerieFog,
}

impl WeatherId {
    /// Every identity in frozen numeric order (index equals the catalog ID).
    pub const ALL: [WeatherId; 13] = [
        WeatherId::None,
        WeatherId::Sunny,
        WeatherId::Rain,
        WeatherId::Sandstorm,
        WeatherId::Hail,
        WeatherId::Snow,
        WeatherId::Fog,
        WeatherId::HeavyRain,
        WeatherId::HarshSun,
        WeatherId::StrongWinds,
        WeatherId::TempestStorm,
        WeatherId::SnowyWrath,
        WeatherId::EerieFog,
    ];

    pub const fn from_id(id: u8) -> Option<Self> {
        match id {
            0 => Some(Self::None),
            1 => Some(Self::Sunny),
            2 => Some(Self::Rain),
            3 => Some(Self::Sandstorm),
            4 => Some(Self::Hail),
            5 => Some(Self::Snow),
            6 => Some(Self::Fog),
            7 => Some(Self::HeavyRain),
            8 => Some(Self::HarshSun),
            9 => Some(Self::StrongWinds),
            10 => Some(Self::TempestStorm),
            11 => Some(Self::SnowyWrath),
            12 => Some(Self::EerieFog),
            _ => None,
        }
    }

    pub const fn id(self) -> u8 {
        self as u8
    }
}

/// Closed terrain identities mirroring the frozen numeric IDs of
/// `src/data/terrain.ts` (catalog sources `TERRAIN 0..=5`).
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TerrainId {
    None,
    Misty,
    Electric,
    Grassy,
    Psychic,
    Toxic,
}

impl TerrainId {
    /// Every identity in frozen numeric order (index equals the catalog ID).
    pub const ALL: [TerrainId; 6] = [
        TerrainId::None,
        TerrainId::Misty,
        TerrainId::Electric,
        TerrainId::Grassy,
        TerrainId::Psychic,
        TerrainId::Toxic,
    ];

    pub const fn from_id(id: u8) -> Option<Self> {
        match id {
            0 => Some(Self::None),
            1 => Some(Self::Misty),
            2 => Some(Self::Electric),
            3 => Some(Self::Grassy),
            4 => Some(Self::Psychic),
            5 => Some(Self::Toxic),
            _ => None,
        }
    }

    pub const fn id(self) -> u8 {
        self as u8
    }
}

/// Closed arena-tag identities from the frozen `WEATHER_TERRAIN_FIELD`
/// cluster registry keys. Serialization is by name; storage order in
/// [`ScheduledEffectsState::arena_tags`] is `(tag identity, owner scope)`
/// ascending via the derived `Ord`.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ArenaTagId {
    AuroraVeil,
    CraftyShield,
    CreepingThorns,
    ErDrillBits,
    ErSmokescreen,
    ErWeatherLock,
    FairyLock,
    FireGrassPledge,
    FoamyWeb,
    GrassWaterPledge,
    GraveMarker,
    Gravity,
    HappyHour,
    HotCoals,
    Imprison,
    InverseRoom,
    IonDeluge,
    LightScreen,
    MagicRoom,
    MatBlock,
    Mist,
    MudSport,
    NeutralizingGas,
    None,
    NoCrit,
    PendingHeal,
    Reflect,
    SedimentBloom,
    Spikes,
    StealthRock,
    StickyWeb,
    SwirlyRoom,
    Tailwind,
    ToxicSpikes,
    TrickRoom,
    WaterFirePledge,
    WaterSport,
    WonderRoom,
}

impl ArenaTagId {
    /// Every identity; `None` is reserved and never live in canonical state.
    pub const ALL: [ArenaTagId; 38] = [
        ArenaTagId::AuroraVeil,
        ArenaTagId::CraftyShield,
        ArenaTagId::CreepingThorns,
        ArenaTagId::ErDrillBits,
        ArenaTagId::ErSmokescreen,
        ArenaTagId::ErWeatherLock,
        ArenaTagId::FairyLock,
        ArenaTagId::FireGrassPledge,
        ArenaTagId::FoamyWeb,
        ArenaTagId::GrassWaterPledge,
        ArenaTagId::GraveMarker,
        ArenaTagId::Gravity,
        ArenaTagId::HappyHour,
        ArenaTagId::HotCoals,
        ArenaTagId::Imprison,
        ArenaTagId::InverseRoom,
        ArenaTagId::IonDeluge,
        ArenaTagId::LightScreen,
        ArenaTagId::MagicRoom,
        ArenaTagId::MatBlock,
        ArenaTagId::Mist,
        ArenaTagId::MudSport,
        ArenaTagId::NeutralizingGas,
        ArenaTagId::None,
        ArenaTagId::NoCrit,
        ArenaTagId::PendingHeal,
        ArenaTagId::Reflect,
        ArenaTagId::SedimentBloom,
        ArenaTagId::Spikes,
        ArenaTagId::StealthRock,
        ArenaTagId::StickyWeb,
        ArenaTagId::SwirlyRoom,
        ArenaTagId::Tailwind,
        ArenaTagId::ToxicSpikes,
        ArenaTagId::TrickRoom,
        ArenaTagId::WaterFirePledge,
        ArenaTagId::WaterSport,
        ArenaTagId::WonderRoom,
    ];
}

/// One pending delayed move effect (Future Sight / Doom Desire family).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DelayedEffectEvent {
    /// Stable event identity; positive and never reused across the battle.
    pub event_id: u64,
    /// Owning behavior unit traced back to frozen catalog evidence.
    pub source_behavior_unit: BehaviorUnitId,
    /// Source ownership scope.
    pub owner: MechanicScope,
    /// Stored target ownership; Future Sight stores the targeted field slot.
    pub stored_target: Option<MechanicScope>,
    /// Family-wide monotone creation ordinal.
    pub creation_ordinal: SafeU53,
    /// Wave-relative due turn.
    pub due_turn: u32,
    /// Trigger hook on which the effect is delivered.
    pub delivery_hook: MechanicHookV2,
    /// Closed typed payload carried to delivery.
    pub payload: ScheduledEventPayloadV1,
    /// Cancellation policy evaluated at drain time.
    pub cancellation_policy: ScheduledEventCancellationPolicyV1,
}

impl DelayedEffectEvent {
    /// Frozen delivery-order key:
    /// `due_turn → hook stage → creation ordinal → stable event ID`.
    pub fn delivery_key(&self) -> (u32, u8, SafeU53, u64) {
        (
            self.due_turn,
            self.delivery_hook.stage(),
            self.creation_ordinal,
            self.event_id,
        )
    }

    pub fn validate(&self) -> Result<(), ScheduledEffectsStateError> {
        if self.event_id == 0 {
            return Err(ScheduledEffectsStateError::ZeroEventId);
        }
        self.source_behavior_unit
            .validate()
            .map_err(|_| ScheduledEffectsStateError::InvalidBehaviorUnit)?;
        if self.delivery_hook.is_query() {
            return Err(ScheduledEffectsStateError::QueryDeliveryHook);
        }
        Ok(())
    }
}

/// One live weather, terrain, or arena-tag condition instance.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldConditionInstance {
    pub kind: FieldConditionKind,
    pub source_behavior_unit: BehaviorUnitId,
    pub owner: MechanicScope,
    /// Family-wide monotone creation ordinal.
    pub creation_ordinal: SafeU53,
    /// Whole turns remaining before lapse; always positive while live.
    pub remaining_turns: u16,
}

/// Closed field-condition identity. The `None` weather/terrain identities are
/// reserved sentinels of the frozen enums and are never stored live.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum FieldConditionKind {
    Weather { weather: WeatherId },
    Terrain { terrain: TerrainId },
    ArenaTag { tag: ArenaTagId },
}

impl FieldConditionKind {
    /// Canonical identity for arena-tag conditions.
    pub fn arena_tag(self) -> Option<ArenaTagId> {
        match self {
            Self::ArenaTag { tag } => Some(tag),
            _ => None,
        }
    }
}

impl FieldConditionInstance {
    pub fn validate(&self) -> Result<(), ScheduledEffectsStateError> {
        if self.remaining_turns == 0 {
            return Err(ScheduledEffectsStateError::ZeroRemainingTurns);
        }
        self.source_behavior_unit
            .validate()
            .map_err(|_| ScheduledEffectsStateError::InvalidBehaviorUnit)?;
        match self.kind {
            FieldConditionKind::Weather { weather } if weather == WeatherId::None => {
                return Err(ScheduledEffectsStateError::ReservedNoneWeather);
            }
            FieldConditionKind::Terrain { terrain } if terrain == TerrainId::None => {
                return Err(ScheduledEffectsStateError::ReservedNoneTerrain);
            }
            _ => {}
        }
        Ok(())
    }
}

/// Canonical scheduled-effects root for one battle.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduledEffectsState {
    pub schema_version: u32,
    /// Next allocatable stable event ID; consumed IDs are never reused.
    pub next_event_id: u64,
    /// Next allocatable family-wide creation ordinal.
    pub next_creation_ordinal: SafeU53,
    /// Every stable event ID ever scheduled, sorted strictly ascending.
    /// Consumed IDs are never reusable, independent of allocation order.
    pub scheduled_event_ids: Vec<u64>,
    /// Pending delayed effects in frozen delivery order.
    pub pending_events: Vec<DelayedEffectEvent>,
    /// Active weather, if any.
    pub weather: Option<FieldConditionInstance>,
    /// Active terrain, if any.
    pub terrain: Option<FieldConditionInstance>,
    /// Live arena tags ordered ascending by `(tag identity, owner scope)`.
    pub arena_tags: Vec<FieldConditionInstance>,
}

impl Default for ScheduledEffectsState {
    fn default() -> Self {
        Self {
            schema_version: SCHEDULED_EFFECTS_SCHEMA_VERSION,
            next_event_id: 1,
            next_creation_ordinal: SafeU53::new(1).expect("one fits in SafeU53"),
            scheduled_event_ids: Vec::new(),
            pending_events: Vec::new(),
            weather: None,
            terrain: None,
            arena_tags: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ScheduledEffectsStateError {
    #[error("scheduled-effects state schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("next event ID must be positive")]
    ZeroNextEventId,
    #[error("next creation ordinal must be positive")]
    ZeroNextCreationOrdinal,
    #[error("delayed-effect event ID must be positive")]
    ZeroEventId,
    #[error("behavior-unit identity is invalid")]
    InvalidBehaviorUnit,
    #[error("delayed-effect delivery hook must be a trigger")]
    QueryDeliveryHook,
    #[error("pending events must be strictly ordered by due turn, hook stage, ordinal, then ID")]
    EventsOutOfOrder,
    #[error("creation ordinals must be unique across all live effects and conditions")]
    DuplicateCreationOrdinal,
    #[error("next event ID must stay ahead of all pending events")]
    NextEventIdNotAhead,
    #[error("next creation ordinal must stay ahead of all live records")]
    NextCreationOrdinalNotAhead,
    #[error("field condition remaining turns must be positive")]
    ZeroRemainingTurns,
    #[error("weather identity NONE is a reserved sentinel and cannot be live")]
    ReservedNoneWeather,
    #[error("terrain identity NONE is a reserved sentinel and cannot be live")]
    ReservedNoneTerrain,
    #[error("consumed event IDs must be sorted strictly ascending and unique")]
    ConsumedEventIdsOutOfOrder,
    #[error("pending event {0} is missing from the consumed-ID ledger")]
    PendingEventIdUntracked(u64),
    #[error("arena tags must be unique per tag identity and owner scope")]
    DuplicateArenaTag,
}

impl ScheduledEffectsState {
    /// Validate the full canonical invariant set. Sorted unique pending
    /// events, unique ordinals across effects and conditions, monotone
    /// allocation counters, and canonical arena-tag ordering all hold or the
    /// whole state is rejected.
    pub fn validate(&self) -> Result<(), ScheduledEffectsStateError> {
        if self.schema_version != SCHEDULED_EFFECTS_SCHEMA_VERSION {
            return Err(ScheduledEffectsStateError::SchemaVersion {
                expected: SCHEDULED_EFFECTS_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.next_event_id == 0 {
            return Err(ScheduledEffectsStateError::ZeroNextEventId);
        }
        if self.next_creation_ordinal == SafeU53::ZERO {
            return Err(ScheduledEffectsStateError::ZeroNextCreationOrdinal);
        }
        let mut previous_consumed: Option<u64> = None;
        for consumed in &self.scheduled_event_ids {
            if *consumed == 0 {
                return Err(ScheduledEffectsStateError::ZeroEventId);
            }
            if previous_consumed.is_some_and(|previous| *consumed <= previous) {
                return Err(ScheduledEffectsStateError::ConsumedEventIdsOutOfOrder);
            }
            if *consumed >= self.next_event_id {
                return Err(ScheduledEffectsStateError::NextEventIdNotAhead);
            }
            previous_consumed = Some(*consumed);
        }
        let mut ordinals = BTreeSet::new();
        let mut previous_key: Option<(u32, u8, SafeU53, u64)> = None;
        for event in &self.pending_events {
            event.validate()?;
            let key = event.delivery_key();
            if previous_key.is_some_and(|previous| key <= previous) {
                return Err(ScheduledEffectsStateError::EventsOutOfOrder);
            }
            if !ordinals.insert(event.creation_ordinal) {
                return Err(ScheduledEffectsStateError::DuplicateCreationOrdinal);
            }
            if !self
                .scheduled_event_ids
                .binary_search(&event.event_id)
                .is_ok()
            {
                return Err(ScheduledEffectsStateError::PendingEventIdUntracked(
                    event.event_id,
                ));
            }
            if event.event_id >= self.next_event_id {
                return Err(ScheduledEffectsStateError::NextEventIdNotAhead);
            }
            if event.creation_ordinal >= self.next_creation_ordinal {
                return Err(ScheduledEffectsStateError::NextCreationOrdinalNotAhead);
            }
            previous_key = Some(key);
        }
        let mut check_condition =
            |condition: &Option<FieldConditionInstance>| -> Result<(), ScheduledEffectsStateError> {
                let Some(condition) = condition else {
                    return Ok(());
                };
                condition.validate()?;
                if !ordinals.insert(condition.creation_ordinal) {
                    return Err(ScheduledEffectsStateError::DuplicateCreationOrdinal);
                }
                if condition.creation_ordinal >= self.next_creation_ordinal {
                    return Err(ScheduledEffectsStateError::NextCreationOrdinalNotAhead);
                }
                Ok(())
            };
        check_condition(&self.weather)?;
        check_condition(&self.terrain)?;
        let mut previous_tag: Option<(ArenaTagId, MechanicScope)> = None;
        for condition in &self.arena_tags {
            condition.validate()?;
            let Some(tag) = condition.kind.arena_tag() else {
                return Err(ScheduledEffectsStateError::UnsortedArenaTags);
            };
            let key = (tag, condition.owner);
            if previous_tag.is_some_and(|previous| previous == key) {
                return Err(ScheduledEffectsStateError::DuplicateArenaTag);
            }
            if previous_tag.is_some_and(|previous| previous > key) {
                return Err(ScheduledEffectsStateError::UnsortedArenaTags);
            }
            if !ordinals.insert(condition.creation_ordinal) {
                return Err(ScheduledEffectsStateError::DuplicateCreationOrdinal);
            }
            if condition.creation_ordinal >= self.next_creation_ordinal {
                return Err(ScheduledEffectsStateError::NextCreationOrdinalNotAhead);
            }
            previous_tag = Some(key);
        }
        Ok(())
    }
}
