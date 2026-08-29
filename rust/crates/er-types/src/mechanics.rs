//! Stable M5 mechanics identities and hook/query DTOs.

use std::fmt;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::battle_ids::{BattleSide, FieldSlot, PokemonId};
use crate::ids::{SafeU53, SafeU53Error};

pub const MECHANICS_IR_VERSION: u32 = 1;
pub const MECHANICS_PROGRAM_VERSION: u32 = 1;
pub const MECHANIC_STATE_SCHEMA_VERSION: u32 = 1;

macro_rules! mechanic_id {
    ($name:ident) => {
        #[derive(
            Clone,
            Copy,
            Debug,
            Default,
            Eq,
            Hash,
            Ord,
            PartialEq,
            PartialOrd,
            Serialize,
            Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(SafeU53);

        impl $name {
            pub const ZERO: Self = Self(SafeU53::ZERO);

            pub const fn new(value: SafeU53) -> Self {
                Self(value)
            }

            pub const fn get(self) -> SafeU53 {
                self.0
            }

            pub fn try_from_u64(value: u64) -> Result<Self, SafeU53Error> {
                SafeU53::new(value).map(Self::new)
            }
        }

        impl From<SafeU53> for $name {
            fn from(value: SafeU53) -> Self {
                Self::new(value)
            }
        }

        impl From<$name> for SafeU53 {
            fn from(value: $name) -> Self {
                value.get()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

mechanic_id!(MechanicId);
mechanic_id!(MechanicsProgramId);
mechanic_id!(MechanicInstanceId);

#[derive(
    Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct SourceOrdinal(u32);

impl SourceOrdinal {
    pub const ZERO: Self = Self(0);

    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u32 {
        self.0
    }
}

#[derive(
    Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct ProgramOrdinal(u32);

impl ProgramOrdinal {
    pub const ZERO: Self = Self(0);

    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u32 {
        self.0
    }
}

#[derive(
    Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct HookOrdinal(u16);

impl HookOrdinal {
    pub const ZERO: Self = Self(0);

    pub const fn new(value: u16) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u16 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MechanicSourceKind {
    Move,
    ActiveAbility,
    PassiveAbility,
    HeldItem,
    MajorStatus,
    VolatileStatus,
    Weather,
    Terrain,
    SideCondition,
    ArenaTag,
    BattlerTag,
    PositionalTag,
    Bespoke,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicSourceId {
    pub kind: MechanicSourceKind,
    pub numeric_id: Option<SafeU53>,
    pub registry_key: Option<String>,
}

impl MechanicSourceId {
    pub fn numeric(kind: MechanicSourceKind, numeric_id: SafeU53) -> Self {
        Self {
            kind,
            numeric_id: Some(numeric_id),
            registry_key: None,
        }
    }

    pub fn registry(kind: MechanicSourceKind, registry_key: impl Into<String>) -> Self {
        Self {
            kind,
            numeric_id: None,
            registry_key: Some(registry_key.into()),
        }
    }

    pub fn validate(&self) -> Result<(), MechanicSourceIdError> {
        match (self.numeric_id, self.registry_key.as_deref()) {
            (Some(_), None) => Ok(()),
            (None, Some(key)) if !key.is_empty() => Ok(()),
            (None, Some(_)) => Err(MechanicSourceIdError::EmptyRegistryKey),
            (None, None) => Err(MechanicSourceIdError::MissingIdentity),
            (Some(_), Some(_)) => Err(MechanicSourceIdError::AmbiguousIdentity),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MechanicSourceIdError {
    #[error("mechanic source must have one numeric ID or registry key")]
    MissingIdentity,
    #[error("mechanic source cannot have both a numeric ID and registry key")]
    AmbiguousIdentity,
    #[error("mechanic source registry key must not be empty")]
    EmptyRegistryKey,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum MechanicScope {
    Battle,
    Side { side: BattleSide },
    Field { slot: FieldSlot },
    Pokemon { pokemon: PokemonId },
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicAddress {
    pub scope: MechanicScope,
    pub source: MechanicSourceId,
    pub source_ordinal: SourceOrdinal,
    pub instance_id: MechanicInstanceId,
}

impl MechanicAddress {
    pub fn validate(&self) -> Result<(), MechanicAddressError> {
        self.source
            .validate()
            .map_err(MechanicAddressError::Source)?;
        if self.instance_id == MechanicInstanceId::ZERO {
            return Err(MechanicAddressError::ZeroInstanceId);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MechanicAddressError {
    #[error("mechanic source identity is invalid: {0}")]
    Source(#[source] MechanicSourceIdError),
    #[error("mechanic instance ID must be positive")]
    ZeroInstanceId,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MechanicHook {
    BattleStart,
    BeforeSummon,
    AfterSummon,
    BeforeActionOrder,
    BeforeAction,
    BeforeMove,
    BeforeAccuracy,
    BeforeHit,
    AfterHit,
    AfterMove,
    AfterDamage,
    BeforeStatus,
    AfterStatus,
    BeforeStatStageChange,
    AfterStatStageChange,
    BeforeSwitchOut,
    AfterSwitchOut,
    BeforeSwitchIn,
    AfterSwitchIn,
    BeforeFaint,
    AfterFaint,
    AfterKnockOut,
    BeforeItemUse,
    AfterItemUse,
    AfterItemLost,
    WeatherChanged,
    WeatherLapse,
    TerrainChanged,
    TurnEnd,
    BattleEnd,
    Victory,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MechanicQuery {
    MoveType,
    MoveCategory,
    MoveTarget,
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
