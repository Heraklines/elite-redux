//! Stable M6 semantic catalog and mechanics identities.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::SafeU53;
use crate::mechanics::{MechanicSourceId, MechanicSourceIdError};

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

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
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

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("provenance hash must be 64 lowercase hexadecimal characters")]
pub struct ProvenanceHashError;

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
#[serde(deny_unknown_fields)]
pub struct BehaviorUnitId {
    pub source: MechanicSourceId,
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
    Source(#[source] MechanicSourceIdError),
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
    pub owner: Option<BehaviorUnitId>,
    pub domain: RngDomainV1,
    pub reason: RngReasonV2,
    pub requested_range: Option<SafeU53>,
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
}
