use std::fmt;

use serde::{Deserialize, Serialize};

use crate::{
    BattleContentPackHashV3, CatalogHash, GameContentBundleHash, OracleSha, SafeU53, SafeU53Error,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameContentIdentityV2 {
    pub oracle_sha: OracleSha,
    pub bundle_hash: GameContentBundleHash,
    pub battle_hash: BattleContentPackHashV3,
    pub run_hash: CatalogHash,
    pub progression_hash: CatalogHash,
    pub world_hash: CatalogHash,
    pub scenario_hash: CatalogHash,
    pub ai_hash: CatalogHash,
    pub bootstrap_hash: CatalogHash,
    pub presentation_hash: CatalogHash,
    pub semantic_catalog_hash: CatalogHash,
}

macro_rules! persistent_id {
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
                SafeU53::new(value).map(Self)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

persistent_id!(ScenarioInstanceId);
persistent_id!(PlatformRequestId);
