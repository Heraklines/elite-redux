use serde::{Deserialize, Serialize};

use crate::{BattleContentPackHashV3, CatalogHash, GameContentBundleHash, OracleSha};

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
