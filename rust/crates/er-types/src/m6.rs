//! Stable M6 semantic catalog and mechanics identities.

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::SafeU53;

pub const M6_MECHANICS_IR_VERSION: u32 = 2;
pub const M6_MECHANICS_PROGRAM_VERSION: u32 = 2;
pub const M6_MECHANIC_STATE_SCHEMA_VERSION: u32 = 2;
pub const M6_GAME_STATE_SCHEMA_VERSION: u32 = 4;
pub const M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION: u32 = 3;
pub const M6_BATTLE_MATERIAL_VERSION: u32 = 4;
pub const M6_RESTORABLE_SNAPSHOT_VERSION: u32 = 5;
pub const M6_KERNEL_TRACE_VERSION: u32 = 5;

macro_rules! ordinal {
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
        pub struct $name(u32);

        impl $name {
            pub const ZERO: Self = Self(0);

            pub const fn new(value: u32) -> Self {
                Self(value)
            }

            pub const fn get(self) -> u32 {
                self.0
            }
        }
    };
}

ordinal!(BehaviorUnitOrdinal);
ordinal!(RngSiteOrdinal);

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct ProvenanceHash(String);

impl ProvenanceHash {
    pub fn parse(value: impl Into<String>) -> Result<Self, ProvenanceHashError> {
        let value = value.into();
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(ProvenanceHashError);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for ProvenanceHash {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(value).map_err(D::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("provenance hash must be 64 lowercase hexadecimal characters")]
pub struct ProvenanceHashError;

fn deserialize_registry_key<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    if value.is_empty() {
        Err(D::Error::custom(
            "behavior source registry key must not be empty",
        ))
    } else {
        Ok(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BehaviorUnitKind {
    IntrinsicMoveRule,
    MoveAttribute,
    ConditionalMoveAttribute,
    AbilityAttribute,
    PassiveAttribute,
    ModifierBehavior,
    StatusBehavior,
    WeatherBehavior,
    TerrainBehavior,
    BattlerTagBehavior,
    ArenaTagBehavior,
    PositionalTagBehavior,
    FixedDispatchBehavior,
    SpeciesFormBehavior,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BehaviorSourceId {
    Move {
        numeric_id: SafeU53,
    },
    ActiveAbility {
        numeric_id: SafeU53,
    },
    PassiveAbility {
        numeric_id: SafeU53,
    },
    HeldItem {
        #[serde(deserialize_with = "deserialize_registry_key")]
        registry_key: String,
    },
    MajorStatus {
        numeric_id: SafeU53,
    },
    VolatileStatus {
        #[serde(deserialize_with = "deserialize_registry_key")]
        registry_key: String,
    },
    Weather {
        numeric_id: SafeU53,
    },
    Terrain {
        numeric_id: SafeU53,
    },
    SideCondition {
        #[serde(deserialize_with = "deserialize_registry_key")]
        registry_key: String,
    },
    ArenaTag {
        #[serde(deserialize_with = "deserialize_registry_key")]
        registry_key: String,
    },
    BattlerTag {
        #[serde(deserialize_with = "deserialize_registry_key")]
        registry_key: String,
    },
    PositionalTag {
        #[serde(deserialize_with = "deserialize_registry_key")]
        registry_key: String,
    },
    Species {
        numeric_id: SafeU53,
    },
    Form {
        #[serde(deserialize_with = "deserialize_registry_key")]
        registry_key: String,
    },
    Bespoke {
        #[serde(deserialize_with = "deserialize_registry_key")]
        registry_key: String,
    },
}

impl BehaviorSourceId {
    pub fn validate(&self) -> Result<(), BehaviorSourceIdError> {
        let registry_key = match self {
            Self::HeldItem { registry_key }
            | Self::VolatileStatus { registry_key }
            | Self::SideCondition { registry_key }
            | Self::ArenaTag { registry_key }
            | Self::BattlerTag { registry_key }
            | Self::PositionalTag { registry_key }
            | Self::Form { registry_key }
            | Self::Bespoke { registry_key } => Some(registry_key),
            Self::Move { .. }
            | Self::ActiveAbility { .. }
            | Self::PassiveAbility { .. }
            | Self::MajorStatus { .. }
            | Self::Weather { .. }
            | Self::Terrain { .. }
            | Self::Species { .. } => None,
        };
        if registry_key.is_some_and(String::is_empty) {
            Err(BehaviorSourceIdError::EmptyRegistryKey)
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum BehaviorSourceIdError {
    #[error("behavior source registry key must not be empty")]
    EmptyRegistryKey,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorUnitId {
    pub source: BehaviorSourceId,
    pub unit_kind: BehaviorUnitKind,
    pub ordinal: BehaviorUnitOrdinal,
    pub provenance_hash: ProvenanceHash,
}

impl BehaviorUnitId {
    pub fn validate(&self) -> Result<(), BehaviorUnitIdError> {
        self.source.validate().map_err(BehaviorUnitIdError::Source)
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum BehaviorUnitIdError {
    #[error("behavior-unit source identity is invalid: {0}")]
    Source(#[source] BehaviorSourceIdError),
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RngSiteId {
    pub ordinal: RngSiteOrdinal,
    pub provenance_hash: ProvenanceHash,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RngDomainV1 {
    BattleMechanical,
    BattlePolicy,
    RunMechanical,
    PresentationOnly,
    TestOnly,
    ForbiddenNondeterministic,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RngReasonV2 {
    Accuracy,
    CriticalHit,
    DamageVariance,
    SpeedTie,
    MultiHitCount,
    SecondaryEffect,
    TargetSelection,
    MoveSelection,
    AbilityChance,
    ItemChance,
    StatusOrVolatile,
    FormOrTransform,
    SourceIdentifiedBespoke,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RngSiteDefinitionV1 {
    pub id: RngSiteId,
    pub owner: BehaviorUnitId,
    pub domain: RngDomainV1,
    pub reason: RngReasonV2,
    pub requested_range: SafeU53,
    pub draw_for_singleton: bool,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AbilitySourceKindV1 {
    Active,
    PassiveSlot0,
    PassiveSlot1,
    PassiveSlot2,
    RuntimeExtra,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BehaviorClassificationKindV2 {
    Compiled,
    Bespoke,
    Unsupported,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provenance_hash_requires_exact_lowercase_sha256_shape() {
        let valid = "0123456789abcdef".repeat(4);
        assert_eq!(ProvenanceHash::parse(&valid).unwrap().as_str(), valid);
        assert!(ProvenanceHash::parse(valid.to_uppercase()).is_err());
        assert!(ProvenanceHash::parse("0".repeat(63)).is_err());
        assert!(ProvenanceHash::parse("g".repeat(64)).is_err());
    }

    #[test]
    fn provenance_hash_deserialization_rejects_invalid_wire_values() {
        assert!(serde_json::from_str::<ProvenanceHash>("\"invalid\"").is_err());
        let valid = format!("\"{}\"", "a".repeat(64));
        assert!(serde_json::from_str::<ProvenanceHash>(&valid).is_ok());
    }

    #[test]
    fn behavior_source_wire_shape_is_closed_per_kind() {
        assert!(
            serde_json::from_str::<BehaviorSourceId>(r#"{"kind":"SPECIES","numeric_id":25}"#)
                .is_ok()
        );
        assert!(
            serde_json::from_str::<BehaviorSourceId>(
                r#"{"kind":"FORM","registry_key":"25:1:mega"}"#
            )
            .is_ok()
        );
        assert!(
            serde_json::from_str::<BehaviorSourceId>(r#"{"kind":"SPECIES","registry_key":"25"}"#)
                .is_err()
        );
        assert!(
            serde_json::from_str::<BehaviorSourceId>(r#"{"kind":"FORM","numeric_id":1}"#).is_err()
        );
        assert!(
            serde_json::from_str::<BehaviorSourceId>(r#"{"kind":"BESPOKE","registry_key":""}"#)
                .is_err()
        );
    }
}
