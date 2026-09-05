//! Direct M9-E GameContentBundleV2 assembly with no production V1 domain fallback.

use std::collections::BTreeSet;
use std::sync::Arc;

use er_ai::content_v2::AiPolicyPackV2;
use er_canonical::content_digest;
use er_content::pack::m6_pack::load_battle_content_pack_v3;
use er_game::m7_content::{
    GameBehaviorClassificationV1, META_CONTENT_PACK_SCHEMA_VERSION_V1, MetaContentPackV1,
    RunContentPackV3,
};
use er_game::m9e_content_v2::{
    BootstrapContentPackV1, GAME_CONTENT_BUNDLE_SCHEMA_VERSION_V2, GameContentBundleV2,
    PresentationContentPackV1,
};
use er_progression::content_v2::ProgressionContentPackV2;
use er_scenario::content_v2::ScenarioContentPackV2;
use er_types::{
    CatalogHash, GameBehaviorStatus, GameBehaviorUnitId, GameContentBundleHash, OracleSha,
};
use er_world::content_v2::WorldContentPackV2;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const M9_BUNDLE_ORACLE_SHA: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BehaviorCatalogV1 {
    schema_version: u32,
    oracle_sha: String,
    oracle_tree_sha: String,
    behavior_count: usize,
    behaviors: Vec<BehaviorUnitV1>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BehaviorUnitV1 {
    #[serde(rename = "async")]
    asynchronous: bool,
    declaration_kind: String,
    domain: String,
    id: String,
    implementation_status: String,
    owner: Option<String>,
    parameter_count: u16,
    source: BehaviorSourceV1,
    symbol: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BehaviorSourceV1 {
    column: u32,
    line: u32,
    path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BehaviorImplementationDocumentV2 {
    schema_version: u32,
    oracle_sha: String,
    oracle_tree_sha: String,
    publication_state: String,
    implementation_group_count: usize,
    implementation_count: usize,
    implementations: Vec<BehaviorImplementationV2>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BehaviorImplementationV2 {
    group_id: String,
    domain: String,
    status: String,
    behavior_units: Vec<String>,
    rust_symbols: Vec<String>,
    proof_registry_group: String,
    proof_tests: Vec<String>,
    proof_execution_digest: String,
}

#[derive(Serialize)]
struct MetaHashView<'a> {
    schema_version: u32,
    oracle_sha: &'a OracleSha,
    classifications: &'a [GameBehaviorClassificationV1],
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BundleBuildErrorV2 {
    #[error("bundle V2 input is malformed: {0}")]
    Decode(String),
    #[error("bundle V2 source identity or behavior closure is invalid")]
    Identity,
    #[error("bundle V2 validation failed: {0}")]
    Validation(String),
}

#[allow(clippy::too_many_arguments)]
pub fn build_m9_engineering_bundle_v2(
    battle_bytes: &[u8],
    run_bytes: &[u8],
    progression_bytes: &[u8],
    world_bytes: &[u8],
    scenario_bytes: &[u8],
    ai_bytes: &[u8],
    bootstrap_bytes: &[u8],
    presentation_bytes: &[u8],
    behavior_catalog_bytes: &[u8],
    implementation_bytes: &[u8],
) -> Result<GameContentBundleV2, BundleBuildErrorV2> {
    let battle = load_battle_content_pack_v3(battle_bytes)
        .map_err(|error| BundleBuildErrorV2::Decode(error.to_string()))?;
    let run: RunContentPackV3 = decode(run_bytes)?;
    let progression: ProgressionContentPackV2 = decode(progression_bytes)?;
    let world: WorldContentPackV2 = decode(world_bytes)?;
    let scenarios: ScenarioContentPackV2 = decode(scenario_bytes)?;
    let ai: AiPolicyPackV2 = decode(ai_bytes)?;
    let bootstrap: BootstrapContentPackV1 = decode(bootstrap_bytes)?;
    let presentation: PresentationContentPackV1 = decode(presentation_bytes)?;
    let catalog: BehaviorCatalogV1 = decode(behavior_catalog_bytes)?;
    let implementations: BehaviorImplementationDocumentV2 = decode(implementation_bytes)?;
    if run.oracle_sha != battle.oracle_sha
        || run.battle_content_hash != battle.content_hash
        || catalog.schema_version != 1
        || catalog.oracle_sha != M9_BUNDLE_ORACLE_SHA
        || catalog.oracle_tree_sha.is_empty()
        || catalog.behavior_count != catalog.behaviors.len()
        || implementations.schema_version != 2
        || implementations.oracle_sha != M9_BUNDLE_ORACLE_SHA
        || implementations.oracle_tree_sha.is_empty()
        || implementations.publication_state != "QUALIFIED"
        || implementations.implementation_group_count != implementations.implementations.len()
        || implementations.implementation_count != catalog.behavior_count
    {
        return Err(BundleBuildErrorV2::Identity);
    }
    let meta = complete_meta(catalog, implementations)?;
    let mut bundle = GameContentBundleV2 {
        schema_version: GAME_CONTENT_BUNDLE_SCHEMA_VERSION_V2,
        oracle_sha: battle.oracle_sha.clone(),
        battle: Arc::new(battle),
        run: Arc::new(run),
        progression: Arc::new(progression),
        world: Arc::new(world),
        scenarios: Arc::new(scenarios),
        ai: Arc::new(ai),
        meta: Arc::new(meta),
        bootstrap: Arc::new(bootstrap),
        presentation: Arc::new(presentation),
        content_hash: GameContentBundleHash::parse(format!("blake3-v1:{}", "0".repeat(64)))
            .map_err(|_| BundleBuildErrorV2::Identity)?,
    };
    bundle.content_hash = bundle
        .recompute_hash()
        .map_err(|error| BundleBuildErrorV2::Validation(error.to_string()))?;
    bundle
        .validate()
        .map_err(|error| BundleBuildErrorV2::Validation(error.to_string()))?;
    Ok(bundle)
}

fn complete_meta(
    mut catalog: BehaviorCatalogV1,
    implementations: BehaviorImplementationDocumentV2,
) -> Result<MetaContentPackV1, BundleBuildErrorV2> {
    let mut implemented = BTreeSet::new();
    for group in implementations.implementations {
        if group.group_id.is_empty()
            || group.domain.is_empty()
            || group.status != "BESPOKE_IMPLEMENTED"
            || group.behavior_units.is_empty()
            || group.rust_symbols.is_empty()
            || group.proof_registry_group != group.group_id
            || group.proof_tests.is_empty()
            || !group.proof_execution_digest.starts_with("blake3-v1:")
        {
            return Err(BundleBuildErrorV2::Identity);
        }
        for behavior in group.behavior_units {
            if !implemented.insert(behavior) {
                return Err(BundleBuildErrorV2::Identity);
            }
        }
    }
    catalog
        .behaviors
        .sort_by(|left, right| left.id.cmp(&right.id));
    let classifications = catalog
        .behaviors
        .into_iter()
        .map(|behavior| {
            if behavior.implementation_status != "REQUIRES_M7"
                || behavior.declaration_kind.is_empty()
                || behavior.domain.is_empty()
                || behavior.owner.as_deref().is_some_and(str::is_empty)
                || behavior.source.path.is_empty()
                || behavior.source.line == 0
                || behavior.source.column == 0
                || behavior.symbol.is_empty()
                || (behavior.asynchronous && behavior.parameter_count == u16::MAX)
                || !implemented.remove(&behavior.id)
            {
                return Err(BundleBuildErrorV2::Identity);
            }
            Ok(GameBehaviorClassificationV1 {
                behavior: GameBehaviorUnitId::parse(behavior.id)
                    .map_err(|_| BundleBuildErrorV2::Identity)?,
                status: GameBehaviorStatus::BespokeImplemented,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !implemented.is_empty() || classifications.len() != 6_870 {
        return Err(BundleBuildErrorV2::Identity);
    }
    let oracle_sha =
        OracleSha::parse(M9_BUNDLE_ORACLE_SHA).map_err(|_| BundleBuildErrorV2::Identity)?;
    let content_hash = content_digest(&MetaHashView {
        schema_version: META_CONTENT_PACK_SCHEMA_VERSION_V1,
        oracle_sha: &oracle_sha,
        classifications: &classifications,
    })
    .map_err(|error| BundleBuildErrorV2::Validation(error.to_string()))?;
    let meta = MetaContentPackV1 {
        schema_version: META_CONTENT_PACK_SCHEMA_VERSION_V1,
        oracle_sha,
        content_hash: CatalogHash::parse(content_hash).map_err(|_| BundleBuildErrorV2::Identity)?,
        classifications,
    };
    meta.validate()
        .map_err(|error| BundleBuildErrorV2::Validation(error.to_string()))?;
    Ok(meta)
}

fn decode<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, BundleBuildErrorV2> {
    serde_json::from_slice(bytes).map_err(|error| BundleBuildErrorV2::Decode(error.to_string()))
}
