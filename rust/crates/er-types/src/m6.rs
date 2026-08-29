//! Stable M6 semantic catalog and mechanics identities.

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::SafeU53;

pub const M6_MECHANICS_IR_VERSION: u32 = 2;
pub const M6_MECHANICS_PROGRAM_VERSION: u32 = 2;
pub const M6_MECHANIC_STATE_SCHEMA_VERSION: u32 = 2;

/// Schema version of the transform/imposter canonical state root. Deliberately
/// split from the shared [`M6_MECHANIC_STATE_SCHEMA_VERSION`] envelope when
/// the copied-typing surface gained its explicit typeless variant: the copied
/// `typing` field moved from a bare `PokemonTyping` to the tagged
/// `BattleTyping` sum (typed pairing or the production typeless presentation),
/// which is an intentional wire-format change, not a silent reshape.
pub const M6_TRANSFORM_FORM_COPY_STATE_SCHEMA_VERSION: u32 = 3;
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

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct OracleSha(String);

impl OracleSha {
    pub fn parse(value: impl Into<String>) -> Result<Self, M6StringIdentityError> {
        let value = value.into();
        if value.len() != 40
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(M6StringIdentityError::OracleSha);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for OracleSha {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::parse(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct CatalogHash(String);

impl CatalogHash {
    pub fn parse(value: impl Into<String>) -> Result<Self, M6StringIdentityError> {
        let value = value.into();
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(M6StringIdentityError::CatalogHash);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for CatalogHash {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::parse(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct BattleContentPackHashV3(String);

impl BattleContentPackHashV3 {
    pub const PREFIX: &'static str = "blake3-v3:";

    pub fn parse(value: impl Into<String>) -> Result<Self, M6StringIdentityError> {
        let value = value.into();
        let Some(body) = value.strip_prefix(Self::PREFIX) else {
            return Err(M6StringIdentityError::BattleContentHash);
        };
        if body.len() != 64
            || !body
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(M6StringIdentityError::BattleContentHash);
        }
        Ok(Self(value))
    }

    pub fn from_digest(digest: impl std::fmt::Display) -> Self {
        Self(format!("{}{digest}", Self::PREFIX))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for BattleContentPackHashV3 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::parse(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct FormId(String);

impl FormId {
    pub fn parse(value: impl Into<String>) -> Result<Self, M6StringIdentityError> {
        let value = value.into();
        if value.is_empty() {
            return Err(M6StringIdentityError::FormId);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for FormId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::parse(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

ordinal!(PresentationCueId);

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BespokeMechanicId {
    BossCustomEr,
    ChargeRechargeLock,
    CustomDispatch,
    DelayedScheduledEffect,
    ItemBerryLifecycle,
    ProtectEndureGuard,
    SpecialDamageCounter,
    StatusVolatileTag,
    SubstituteProxyHp,
    SuppressionUnusualImmunity,
    SwitchTrapRedirect,
    TransformFormCopy,
    WeatherTerrainField,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum M6StringIdentityError {
    #[error("oracle SHA must be 40 lowercase hexadecimal characters")]
    OracleSha,
    #[error("catalog hash must be 64 lowercase hexadecimal characters")]
    CatalogHash,
    #[error("battle-content hash must be `blake3-v3:` plus 64 lowercase hexadecimal characters")]
    BattleContentHash,
    #[error("form identity must not be empty")]
    FormId,
}

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
        assert_eq!(
            ProvenanceHash::parse(&valid)
                .expect("valid fixture provenance hash")
                .as_str(),
            valid
        );
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
    fn m6_content_identity_strings_fail_closed() {
        assert!(OracleSha::parse("a".repeat(40)).is_ok());
        assert!(OracleSha::parse("A".repeat(40)).is_err());
        assert!(CatalogHash::parse("b".repeat(64)).is_ok());
        assert!(CatalogHash::parse("b".repeat(63)).is_err());
        assert!(
            BattleContentPackHashV3::parse(format!(
                "{}{}",
                BattleContentPackHashV3::PREFIX,
                "c".repeat(64)
            ))
            .is_ok()
        );
        assert!(BattleContentPackHashV3::parse("c".repeat(64)).is_err());
        assert!(FormId::parse("25:1:mega").is_ok());
        assert!(FormId::parse("").is_err());
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
