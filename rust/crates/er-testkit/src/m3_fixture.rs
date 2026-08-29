//! Frozen M3 oracle catalog loading and publication-aware evidence access.
//!
//! The catalog manifests are useful before the TypeScript exporter publishes
//! evidence, but catalog presence is not evidence presence. This module keeps
//! those states distinct and refuses to load an oracle case or supporting
//! artifact until the manifest describes a complete, gap-free publication.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

pub const M3_MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const M3_PROJECT_NAME: &str = "PokéRogue Redux";
pub const M3_ORACLE_GAME_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
pub const M3_ORACLE_PROTOCOL_VERSION: &str = "er-coop-47";
pub const M3_M2_BASE_SHA: &str = "7357166c19bdb5cf0e32c84b0f74f22e79d80798";

pub const M3_REQUIRED_ORACLE_AXES: [&str; 8] = [
    "INITIAL_STATE_AND_RNG",
    "ADMITTED_COMMANDS",
    "CONSUMING_RNG_DRAWS",
    "DYNAMIC_ACTION_ORDER",
    "CAUSAL_MUTATIONS",
    "PRESENTATION_PLAN",
    "FINAL_STATE_AND_RNG",
    "NEXT_LOGICAL_CONTROL",
];

pub const M3_ORACLE_CASE_IDS: [&str; 38] = [
    "physical-hit",
    "critical-hit",
    "special-hit-priority",
    "always-hit",
    "miss",
    "poison-type-immunity",
    "grass-powder-immunity",
    "existing-status-rejected",
    "speed-tie",
    "pp-consumption",
    "pp-unusable-rejected",
    "poison-application",
    "poison-residual",
    "paralysis-application",
    "paralysis-full-stop",
    "paralysis-speed-order",
    "burn-application",
    "burn-residual",
    "burn-physical-penalty",
    "spread-stage-down",
    "stage-floor-cap",
    "none-ability-no-trigger",
    "intimidate-switch-in",
    "intimidate-stage-floor",
    "wonder-guard-block",
    "wonder-guard-super-effective-pass",
    "wonder-guard-status-pass",
    "type-weakness",
    "type-resistance",
    "type-native-immunity",
    "voluntary-switch",
    "doubles-single-target",
    "same-side-simultaneous-faint",
    "mixed-side-simultaneous-faint",
    "forced-replacement",
    "no-legal-replacement",
    "victory",
    "defeat",
];

pub const M3_SUPPORTING_ARTIFACT_IDS: [&str; 2] = ["content-pack-v1", "rng-vectors-v1"];

const COVERAGE_MAP_PATH: &str = "rust/fixtures/m3/m3-coverage-map.json";
const ORACLE_MANIFEST_PATH: &str = "rust/fixtures/m3/m3-oracle-manifest.json";
const SLICE_MANIFEST_PATH: &str = "rust/fixtures/m3/m3-slice-manifest.json";
const CAPABILITY_MANIFEST_PATH: &str = "rust/fixtures/m3/m3-capability-manifest.json";
const ORACLE_FIXTURE_PREFIX: &str = "rust/fixtures/m3/oracle/";
const EXPORTER_PATHS: [&str; 2] = [
    "scripts/export-kernel-m3-oracle.mjs",
    "test/kernel-fixtures/m3/export-battle-oracle.test.ts",
];
const HOSTED_REQUIREMENT_IDS: [&str; 6] = [
    "ARCHITECTURAL_BATTLE_SEAM_CLOSURE",
    "MENU_EXACTNESS",
    "ATOMIC_COMMON_APPLIER",
    "RESTORABLE_CONTINUATION",
    "RAW_KEY_CAMPAIGNS",
    "NATIVE_WASM_TEARDOWN_PERFORMANCE",
];
const UNCLAIMED_SUBDIMENSIONS: [&str; 3] = [
    "RAW_PHYSICAL_INPUT",
    "RENDERER_COMPLETION_SETTLEMENT",
    "RUST_OWNED_CONTROL_IDENTITY_MENU_ALLOCATOR_HISTORY",
];
const ORDERING_BRANCH_CLASSIFICATION: [(&str, &str); 10] = [
    ("explicit_set_order", "UNSUPPORTED"),
    ("live_speed_stage_and_paralysis_reorder", "SUPPORTED"),
    (
        "mixed_side_simultaneous_faint",
        "SUPPORTED_BY_NAMED_FIXTURE",
    ),
    ("ordinary_fight_and_switch", "SUPPORTED"),
    ("pursuit_or_interception", "UNSUPPORTED"),
    ("same_side_simultaneous_faint", "SUPPORTED_BY_NAMED_FIXTURE"),
    ("seeded_speed_tie", "SUPPORTED"),
    ("self_switching_move", "UNSUPPORTED"),
    ("trick_room", "UNSUPPORTED"),
    ("triple_only_shift", "UNSUPPORTED"),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum M3CaseFormat {
    Single,
    CoopDouble,
}

const ORACLE_CASES: [(&str, M3CaseFormat); 38] = [
    ("physical-hit", M3CaseFormat::Single),
    ("critical-hit", M3CaseFormat::Single),
    ("special-hit-priority", M3CaseFormat::Single),
    ("always-hit", M3CaseFormat::Single),
    ("miss", M3CaseFormat::Single),
    ("poison-type-immunity", M3CaseFormat::Single),
    ("grass-powder-immunity", M3CaseFormat::Single),
    ("existing-status-rejected", M3CaseFormat::Single),
    ("speed-tie", M3CaseFormat::CoopDouble),
    ("pp-consumption", M3CaseFormat::Single),
    ("pp-unusable-rejected", M3CaseFormat::Single),
    ("poison-application", M3CaseFormat::Single),
    ("poison-residual", M3CaseFormat::Single),
    ("paralysis-application", M3CaseFormat::Single),
    ("paralysis-full-stop", M3CaseFormat::Single),
    ("paralysis-speed-order", M3CaseFormat::CoopDouble),
    ("burn-application", M3CaseFormat::Single),
    ("burn-residual", M3CaseFormat::Single),
    ("burn-physical-penalty", M3CaseFormat::Single),
    ("spread-stage-down", M3CaseFormat::CoopDouble),
    ("stage-floor-cap", M3CaseFormat::CoopDouble),
    ("none-ability-no-trigger", M3CaseFormat::Single),
    ("intimidate-switch-in", M3CaseFormat::CoopDouble),
    ("intimidate-stage-floor", M3CaseFormat::CoopDouble),
    ("wonder-guard-block", M3CaseFormat::Single),
    ("wonder-guard-super-effective-pass", M3CaseFormat::Single),
    ("wonder-guard-status-pass", M3CaseFormat::Single),
    ("type-weakness", M3CaseFormat::Single),
    ("type-resistance", M3CaseFormat::Single),
    ("type-native-immunity", M3CaseFormat::Single),
    ("voluntary-switch", M3CaseFormat::CoopDouble),
    ("doubles-single-target", M3CaseFormat::CoopDouble),
    ("same-side-simultaneous-faint", M3CaseFormat::CoopDouble),
    ("mixed-side-simultaneous-faint", M3CaseFormat::CoopDouble),
    ("forced-replacement", M3CaseFormat::CoopDouble),
    ("no-legal-replacement", M3CaseFormat::CoopDouble),
    ("victory", M3CaseFormat::Single),
    ("defeat", M3CaseFormat::Single),
];

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3CoverageCase {
    pub case_id: String,
    pub format: M3CaseFormat,
    pub claims: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3HostedRequirement {
    pub requirement_id: String,
    pub owned_tests: Vec<String>,
    pub claims: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3CoverageMap {
    pub schema_version: u32,
    pub project: String,
    pub oracle_game_sha: String,
    pub required_oracle_axes: Vec<String>,
    pub oracle_cases: Vec<M3CoverageCase>,
    pub non_oracle_hosted_requirements: Vec<M3HostedRequirement>,
    pub ordering_branch_classification: BTreeMap<String, String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum M3OraclePublicationState {
    ContractCatalogFrozen,
    OracleEvidencePublished,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3CanonicalOutputContract {
    pub encoding: String,
    pub object_keys: String,
    pub array_order: String,
    pub finite_number_format: String,
    pub trailing_newline_count: u8,
    pub fresh_process_runs: u8,
    pub fixture_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3SupportingArtifactContract {
    pub artifact_id: String,
    pub fixture_path: String,
    pub required_identity: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3OracleCaseContract {
    pub scenario_id: String,
    pub fixture_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3PublishedFixture {
    pub scenario_id: String,
    pub fixture_path: String,
    pub sha256: String,
    pub required_axes: Vec<String>,
    pub gap_free: bool,
    pub oracle_game_sha: String,
    pub oracle_tree_sha: String,
    pub exporter_commit_sha: String,
    pub content_pack_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3PublishedSupportingArtifact {
    pub artifact_id: String,
    pub fixture_path: String,
    pub sha256: String,
    pub gap_free: bool,
    pub oracle_game_sha: String,
    pub oracle_tree_sha: String,
    pub exporter_commit_sha: String,
    pub content_pack_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3PublicationRules {
    pub contract_catalog_must_match_coverage_map_exactly: bool,
    pub each_published_fixture_must_match_one_contract: bool,
    pub each_contract_must_have_exactly_one_fixture_before_m3b: bool,
    pub each_supporting_artifact_contract_must_be_published_before_m3b: bool,
    pub all_required_axes_must_be_gap_free: bool,
    pub semantic_oracle_unclaimed_subdimensions: Vec<String>,
    pub published_fixture_requires_complete_content_hash: bool,
    pub exporter_output_root_must_be_empty: bool,
    pub independent_exact_sha_checkouts_required: bool,
    pub two_fresh_process_outputs_must_be_byte_identical: bool,
    pub git_provenance_must_resolve: bool,
    pub content_pack_hash_must_be_independently_recomputed: bool,
    pub published_tree_must_have_exactly_40_files: bool,
    pub m3b_and_m3c_require_published_state: bool,
    pub unlisted_generated_files_are_not_evidence: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M3OracleManifest {
    pub schema_version: u32,
    pub project: String,
    pub publication_state: M3OraclePublicationState,
    pub oracle_game_sha: String,
    pub oracle_protocol_version: String,
    pub m2_base_sha: String,
    pub slice_manifest: String,
    pub capability_manifest: String,
    pub coverage_map: String,
    pub exporter_paths: Vec<String>,
    pub canonical_output: M3CanonicalOutputContract,
    pub required_axes: Vec<String>,
    pub supporting_artifact_contracts: Vec<M3SupportingArtifactContract>,
    pub case_contracts: Vec<M3OracleCaseContract>,
    pub published_fixtures: Vec<M3PublishedFixture>,
    pub published_supporting_artifacts: Vec<M3PublishedSupportingArtifact>,
    pub publication_rules: M3PublicationRules,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum M3OracleReadiness {
    CatalogOnly {
        pending_cases: usize,
        pending_supporting_artifacts: usize,
    },
    Published {
        cases: usize,
        supporting_artifacts: usize,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum M3FixtureKind {
    BattleCase,
    SupportingArtifact,
}

impl std::fmt::Display for M3FixtureKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BattleCase => formatter.write_str("battle case"),
            Self::SupportingArtifact => formatter.write_str("supporting artifact"),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct M3FixtureCatalog {
    pub coverage_map: M3CoverageMap,
    pub oracle_manifest: M3OracleManifest,
}

impl M3FixtureCatalog {
    pub fn validate(&self) -> Result<(), M3FixtureError> {
        validate_shared_identity(&self.coverage_map, &self.oracle_manifest)?;
        validate_coverage_map(&self.coverage_map)?;
        validate_oracle_manifest(&self.oracle_manifest)?;
        validate_catalog_alignment(&self.coverage_map, &self.oracle_manifest)
    }

    pub fn readiness(&self) -> Result<M3OracleReadiness, M3FixtureError> {
        self.validate()?;
        Ok(match self.oracle_manifest.publication_state {
            M3OraclePublicationState::ContractCatalogFrozen => M3OracleReadiness::CatalogOnly {
                pending_cases: self.oracle_manifest.case_contracts.len(),
                pending_supporting_artifacts: self
                    .oracle_manifest
                    .supporting_artifact_contracts
                    .len(),
            },
            M3OraclePublicationState::OracleEvidencePublished => M3OracleReadiness::Published {
                cases: self.oracle_manifest.published_fixtures.len(),
                supporting_artifacts: self.oracle_manifest.published_supporting_artifacts.len(),
            },
        })
    }

    pub fn is_evidence_published(&self) -> bool {
        matches!(
            self.readiness(),
            Ok(M3OracleReadiness::Published {
                cases: 38,
                supporting_artifacts: 2,
            })
        )
    }

    pub fn load_published_case<T: DeserializeOwned>(
        &self,
        scenario_id: &str,
    ) -> Result<T, M3FixtureError> {
        self.validate()?;
        let contract = self
            .oracle_manifest
            .case_contracts
            .iter()
            .find(|contract| contract.scenario_id == scenario_id)
            .ok_or_else(|| M3FixtureError::UnknownFixture {
                kind: M3FixtureKind::BattleCase,
                id: scenario_id.to_owned(),
            })?;
        if self.oracle_manifest.publication_state == M3OraclePublicationState::ContractCatalogFrozen
        {
            return Err(M3FixtureError::Unpublished {
                kind: M3FixtureKind::BattleCase,
                id: scenario_id.to_owned(),
            });
        }
        let entry = self
            .oracle_manifest
            .published_fixtures
            .iter()
            .find(|entry| entry.scenario_id == scenario_id)
            .ok_or_else(|| contract_error("published_fixtures", "published case is absent"))?;
        let (path, value) = load_published_json(&entry.fixture_path, &entry.sha256)?;
        validate_case_evidence(&value, contract, entry)?;
        serde_json::from_value(value).map_err(|source| M3FixtureError::Json { path, source })
    }

    pub fn load_published_supporting_artifact<T: DeserializeOwned>(
        &self,
        artifact_id: &str,
    ) -> Result<T, M3FixtureError> {
        self.validate()?;
        let contract = self
            .oracle_manifest
            .supporting_artifact_contracts
            .iter()
            .find(|contract| contract.artifact_id == artifact_id)
            .ok_or_else(|| M3FixtureError::UnknownFixture {
                kind: M3FixtureKind::SupportingArtifact,
                id: artifact_id.to_owned(),
            })?;
        if self.oracle_manifest.publication_state == M3OraclePublicationState::ContractCatalogFrozen
        {
            return Err(M3FixtureError::Unpublished {
                kind: M3FixtureKind::SupportingArtifact,
                id: artifact_id.to_owned(),
            });
        }
        let entry = self
            .oracle_manifest
            .published_supporting_artifacts
            .iter()
            .find(|entry| entry.artifact_id == artifact_id)
            .ok_or_else(|| {
                contract_error(
                    "published_supporting_artifacts",
                    "published supporting artifact is absent",
                )
            })?;
        let (path, value) = load_published_json(&entry.fixture_path, &entry.sha256)?;
        validate_supporting_evidence(&value, contract, entry)?;
        serde_json::from_value(value).map_err(|source| M3FixtureError::Json { path, source })
    }
}

pub fn load_m3_fixture_catalog() -> Result<M3FixtureCatalog, M3FixtureError> {
    let coverage_map = load_repository_json(COVERAGE_MAP_PATH)?;
    let oracle_manifest = load_repository_json(ORACLE_MANIFEST_PATH)?;
    let catalog = M3FixtureCatalog {
        coverage_map,
        oracle_manifest,
    };
    catalog.validate()?;
    Ok(catalog)
}

fn load_repository_json<T: DeserializeOwned>(relative_path: &str) -> Result<T, M3FixtureError> {
    let path = repository_root().join(relative_path);
    let bytes = fs::read(&path).map_err(|source| M3FixtureError::Read {
        path: path.clone(),
        source,
    })?;
    serde_json::from_slice(&bytes).map_err(|source| M3FixtureError::Json { path, source })
}

fn validate_shared_identity(
    coverage: &M3CoverageMap,
    oracle: &M3OracleManifest,
) -> Result<(), M3FixtureError> {
    if coverage.schema_version != M3_MANIFEST_SCHEMA_VERSION
        || oracle.schema_version != M3_MANIFEST_SCHEMA_VERSION
    {
        return Err(contract_error(
            "schema_version",
            "both M3 manifests must use schema version 1",
        ));
    }
    if coverage.project != M3_PROJECT_NAME || oracle.project != M3_PROJECT_NAME {
        return Err(contract_error(
            "project",
            "both M3 manifests must name PokéRogue Redux",
        ));
    }
    if coverage.oracle_game_sha != M3_ORACLE_GAME_SHA
        || oracle.oracle_game_sha != M3_ORACLE_GAME_SHA
    {
        return Err(contract_error(
            "oracle_game_sha",
            "both M3 manifests must use the pinned oracle commit",
        ));
    }
    if !exact_strings(&coverage.required_oracle_axes, &M3_REQUIRED_ORACLE_AXES)
        || !exact_strings(&oracle.required_axes, &M3_REQUIRED_ORACLE_AXES)
    {
        return Err(contract_error(
            "required_axes",
            "both manifests must carry the exact ordered eight-axis contract",
        ));
    }
    Ok(())
}

fn validate_coverage_map(coverage: &M3CoverageMap) -> Result<(), M3FixtureError> {
    if coverage.oracle_cases.len() != ORACLE_CASES.len() {
        return Err(contract_error(
            "oracle_cases",
            "coverage map must contain exactly 38 cases",
        ));
    }
    for (actual, (expected_id, expected_format)) in coverage.oracle_cases.iter().zip(ORACLE_CASES) {
        if actual.case_id != expected_id || actual.format != expected_format {
            return Err(contract_error(
                "oracle_cases",
                "case identity, order, or format differs from the frozen catalog",
            ));
        }
        validate_token_set("oracle_cases.claims", &actual.claims)?;
    }

    if coverage.non_oracle_hosted_requirements.len() != HOSTED_REQUIREMENT_IDS.len() {
        return Err(contract_error(
            "non_oracle_hosted_requirements",
            "coverage map must contain exactly six hosted requirement groups",
        ));
    }
    for (actual, expected_id) in coverage
        .non_oracle_hosted_requirements
        .iter()
        .zip(HOSTED_REQUIREMENT_IDS)
    {
        if actual.requirement_id != expected_id {
            return Err(contract_error(
                "non_oracle_hosted_requirements",
                "hosted requirement identity or order differs from the frozen catalog",
            ));
        }
        if actual.owned_tests.is_empty() {
            return Err(contract_error(
                "non_oracle_hosted_requirements.owned_tests",
                "each hosted requirement must own at least one test",
            ));
        }
        let mut owned_tests = BTreeSet::new();
        for path in &actual.owned_tests {
            if !is_normalized_repository_path(path)
                || !path.starts_with("rust/crates/")
                || !path.ends_with(".rs")
            {
                return Err(contract_error(
                    "non_oracle_hosted_requirements.owned_tests",
                    "owned tests must be normalized repository-relative Rust paths",
                ));
            }
            if !owned_tests.insert(path.as_str()) {
                return Err(contract_error(
                    "non_oracle_hosted_requirements.owned_tests",
                    "one hosted requirement contains a duplicate test path",
                ));
            }
        }
        validate_token_set("non_oracle_hosted_requirements.claims", &actual.claims)?;
    }

    if coverage.ordering_branch_classification.len() != ORDERING_BRANCH_CLASSIFICATION.len() {
        return Err(contract_error(
            "ordering_branch_classification",
            "ordering branch classification has the wrong size",
        ));
    }
    for (branch, classification) in ORDERING_BRANCH_CLASSIFICATION {
        if coverage
            .ordering_branch_classification
            .get(branch)
            .map(String::as_str)
            != Some(classification)
        {
            return Err(contract_error(
                "ordering_branch_classification",
                "ordering branch support differs from the frozen contract",
            ));
        }
    }
    Ok(())
}

fn validate_oracle_manifest(oracle: &M3OracleManifest) -> Result<(), M3FixtureError> {
    if oracle.oracle_protocol_version != M3_ORACLE_PROTOCOL_VERSION {
        return Err(contract_error(
            "oracle_protocol_version",
            "oracle protocol pin differs from er-coop-47",
        ));
    }
    if oracle.m2_base_sha != M3_M2_BASE_SHA {
        return Err(contract_error(
            "m2_base_sha",
            "M2 base commit differs from the frozen contract",
        ));
    }
    if oracle.slice_manifest != SLICE_MANIFEST_PATH
        || oracle.capability_manifest != CAPABILITY_MANIFEST_PATH
        || oracle.coverage_map != COVERAGE_MAP_PATH
    {
        return Err(contract_error(
            "manifest_paths",
            "M3 manifest references differ from the frozen repository paths",
        ));
    }
    if !exact_strings(&oracle.exporter_paths, &EXPORTER_PATHS) {
        return Err(contract_error(
            "exporter_paths",
            "exporter path catalog is not exact",
        ));
    }
    validate_canonical_output(&oracle.canonical_output)?;
    validate_supporting_contracts(&oracle.supporting_artifact_contracts)?;
    validate_case_contracts(&oracle.case_contracts)?;
    validate_publication_rules(&oracle.publication_rules)?;
    validate_publication(oracle)
}

fn validate_canonical_output(output: &M3CanonicalOutputContract) -> Result<(), M3FixtureError> {
    if output.encoding != "UTF-8"
        || output.object_keys != "SORTED"
        || output.array_order != "PRESERVED"
        || output.finite_number_format != "CANONICAL_JSON_NUMBER"
        || output.trailing_newline_count != 1
        || output.fresh_process_runs != 2
        || output.fixture_hash != "SHA-256_LOWERCASE_64_HEX"
    {
        return Err(contract_error(
            "canonical_output",
            "canonical exporter output contract is not exact",
        ));
    }
    Ok(())
}

fn validate_supporting_contracts(
    contracts: &[M3SupportingArtifactContract],
) -> Result<(), M3FixtureError> {
    let expected = [
        (
            "content-pack-v1",
            "rust/fixtures/m3/oracle/content-pack-v1.json",
            "BLAKE3_V1_CONTENT_PACK_HASH",
        ),
        (
            "rng-vectors-v1",
            "rust/fixtures/m3/oracle/rng-vectors-v1.json",
            "SHA256_MANIFEST_ENTRY",
        ),
    ];
    if contracts.len() != expected.len() {
        return Err(contract_error(
            "supporting_artifact_contracts",
            "supporting artifact catalog must contain exactly two entries",
        ));
    }
    for (actual, (artifact_id, fixture_path, required_identity)) in contracts.iter().zip(expected) {
        if actual.artifact_id != artifact_id
            || actual.fixture_path != fixture_path
            || actual.required_identity != required_identity
        {
            return Err(contract_error(
                "supporting_artifact_contracts",
                "supporting artifact catalog differs from the frozen contract",
            ));
        }
    }
    Ok(())
}

fn validate_case_contracts(contracts: &[M3OracleCaseContract]) -> Result<(), M3FixtureError> {
    if contracts.len() != M3_ORACLE_CASE_IDS.len() {
        return Err(contract_error(
            "case_contracts",
            "oracle manifest must contain exactly 38 case contracts",
        ));
    }
    for (contract, expected_id) in contracts.iter().zip(M3_ORACLE_CASE_IDS) {
        let expected_path = format!("rust/fixtures/m3/oracle/battle-cases/{expected_id}.json");
        if contract.scenario_id != expected_id || contract.fixture_path != expected_path {
            return Err(contract_error(
                "case_contracts",
                "case contract identity, order, or path differs from the frozen catalog",
            ));
        }
    }
    Ok(())
}

fn validate_publication_rules(rules: &M3PublicationRules) -> Result<(), M3FixtureError> {
    let all_true = rules.contract_catalog_must_match_coverage_map_exactly
        && rules.each_published_fixture_must_match_one_contract
        && rules.each_contract_must_have_exactly_one_fixture_before_m3b
        && rules.each_supporting_artifact_contract_must_be_published_before_m3b
        && rules.all_required_axes_must_be_gap_free
        && rules.published_fixture_requires_complete_content_hash
        && rules.exporter_output_root_must_be_empty
        && rules.independent_exact_sha_checkouts_required
        && rules.two_fresh_process_outputs_must_be_byte_identical
        && rules.git_provenance_must_resolve
        && rules.content_pack_hash_must_be_independently_recomputed
        && rules.published_tree_must_have_exactly_40_files
        && rules.m3b_and_m3c_require_published_state
        && rules.unlisted_generated_files_are_not_evidence;
    if !all_true
        || !exact_strings(
            &rules.semantic_oracle_unclaimed_subdimensions,
            &UNCLAIMED_SUBDIMENSIONS,
        )
    {
        return Err(contract_error(
            "publication_rules",
            "oracle publication rules differ from the frozen fail-closed contract",
        ));
    }
    Ok(())
}

fn validate_publication(oracle: &M3OracleManifest) -> Result<(), M3FixtureError> {
    match oracle.publication_state {
        M3OraclePublicationState::ContractCatalogFrozen => {
            if !oracle.published_fixtures.is_empty()
                || !oracle.published_supporting_artifacts.is_empty()
            {
                return Err(contract_error(
                    "publication_state",
                    "catalog-only state requires both publication arrays to be empty",
                ));
            }
            Ok(())
        }
        M3OraclePublicationState::OracleEvidencePublished => validate_complete_publication(oracle),
    }
}

fn validate_complete_publication(oracle: &M3OracleManifest) -> Result<(), M3FixtureError> {
    if oracle.published_fixtures.len() != M3_ORACLE_CASE_IDS.len()
        || oracle.published_supporting_artifacts.len() != M3_SUPPORTING_ARTIFACT_IDS.len()
    {
        return Err(contract_error(
            "publication_state",
            "published state requires exactly 38 cases and two supporting artifacts",
        ));
    }

    let mut provenance: Option<(String, String, String)> = None;
    for ((entry, contract), expected_id) in oracle
        .published_fixtures
        .iter()
        .zip(&oracle.case_contracts)
        .zip(M3_ORACLE_CASE_IDS)
    {
        if entry.scenario_id != expected_id || entry.fixture_path != contract.fixture_path {
            return Err(contract_error(
                "published_fixtures",
                "published case identity, order, or path differs from its contract",
            ));
        }
        if !entry.gap_free
            || entry.oracle_game_sha != M3_ORACLE_GAME_SHA
            || !exact_strings(&entry.required_axes, &M3_REQUIRED_ORACLE_AXES)
        {
            return Err(contract_error(
                "published_fixtures",
                "published case is not gap-free and bound to every required axis",
            ));
        }
        validate_publication_hashes(
            &entry.sha256,
            &entry.oracle_tree_sha,
            &entry.exporter_commit_sha,
            &entry.content_pack_hash,
        )?;
        validate_shared_provenance(
            &mut provenance,
            &entry.oracle_tree_sha,
            &entry.exporter_commit_sha,
            &entry.content_pack_hash,
        )?;
    }

    for ((entry, contract), expected_id) in oracle
        .published_supporting_artifacts
        .iter()
        .zip(&oracle.supporting_artifact_contracts)
        .zip(M3_SUPPORTING_ARTIFACT_IDS)
    {
        if entry.artifact_id != expected_id || entry.fixture_path != contract.fixture_path {
            return Err(contract_error(
                "published_supporting_artifacts",
                "published supporting identity, order, or path differs from its contract",
            ));
        }
        if !entry.gap_free || entry.oracle_game_sha != M3_ORACLE_GAME_SHA {
            return Err(contract_error(
                "published_supporting_artifacts",
                "published supporting artifact is not gap-free or has the wrong oracle identity",
            ));
        }
        validate_publication_hashes(
            &entry.sha256,
            &entry.oracle_tree_sha,
            &entry.exporter_commit_sha,
            &entry.content_pack_hash,
        )?;
        validate_shared_provenance(
            &mut provenance,
            &entry.oracle_tree_sha,
            &entry.exporter_commit_sha,
            &entry.content_pack_hash,
        )?;
    }
    Ok(())
}

fn validate_publication_hashes(
    sha256: &str,
    oracle_tree_sha: &str,
    exporter_commit_sha: &str,
    content_pack_hash: &str,
) -> Result<(), M3FixtureError> {
    if !is_lower_hex(sha256, 64)
        || !is_lower_hex(oracle_tree_sha, 40)
        || !is_lower_hex(exporter_commit_sha, 40)
        || !is_lower_hex(content_pack_hash, 64)
    {
        return Err(contract_error(
            "publication_hashes",
            "published hashes must use their exact lowercase hexadecimal widths",
        ));
    }
    Ok(())
}

fn validate_shared_provenance(
    expected: &mut Option<(String, String, String)>,
    oracle_tree_sha: &str,
    exporter_commit_sha: &str,
    content_pack_hash: &str,
) -> Result<(), M3FixtureError> {
    let actual = (oracle_tree_sha, exporter_commit_sha, content_pack_hash);
    match expected.as_ref() {
        Some(expected) => {
            let expected = (
                expected.0.as_str(),
                expected.1.as_str(),
                expected.2.as_str(),
            );
            if expected == actual {
                Ok(())
            } else {
                Err(contract_error(
                    "publication_provenance",
                    "all published evidence must share one provenance identity",
                ))
            }
        }
        None => {
            *expected = Some((
                oracle_tree_sha.to_owned(),
                exporter_commit_sha.to_owned(),
                content_pack_hash.to_owned(),
            ));
            Ok(())
        }
    }
}

fn validate_catalog_alignment(
    coverage: &M3CoverageMap,
    oracle: &M3OracleManifest,
) -> Result<(), M3FixtureError> {
    for (coverage_case, contract) in coverage.oracle_cases.iter().zip(&oracle.case_contracts) {
        if coverage_case.case_id != contract.scenario_id {
            return Err(contract_error(
                "catalog_alignment",
                "coverage and oracle catalogs must have identical ordered case IDs",
            ));
        }
    }
    Ok(())
}

fn validate_token_set(field: &'static str, values: &[String]) -> Result<(), M3FixtureError> {
    if values.is_empty() {
        return Err(contract_error(field, "token set must not be empty"));
    }
    let mut unique = BTreeSet::new();
    for value in values {
        if value.is_empty()
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        {
            return Err(contract_error(
                field,
                "tokens must use non-empty SCREAMING_SNAKE_CASE ASCII",
            ));
        }
        if !unique.insert(value.as_str()) {
            return Err(contract_error(field, "token set contains a duplicate"));
        }
    }
    Ok(())
}

fn exact_strings(actual: &[String], expected: &[&str]) -> bool {
    actual
        .iter()
        .map(String::as_str)
        .eq(expected.iter().copied())
}

fn is_lower_hex(value: &str, width: usize) -> bool {
    value.len() == width
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_normalized_repository_path(value: &str) -> bool {
    if value.is_empty()
        || value.contains('\\')
        || value.contains(':')
        || value.chars().any(char::is_control)
        || Path::new(value).is_absolute()
    {
        return false;
    }
    Path::new(value)
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
}

fn load_published_json(
    relative_path: &str,
    expected_sha256: &str,
) -> Result<(PathBuf, Value), M3FixtureError> {
    if !is_normalized_repository_path(relative_path)
        || !relative_path.starts_with(ORACLE_FIXTURE_PREFIX)
    {
        return Err(contract_error(
            "fixture_path",
            "published evidence path must remain beneath rust/fixtures/m3/oracle",
        ));
    }
    let path = repository_root().join(relative_path);
    let bytes = fs::read(&path).map_err(|source| M3FixtureError::Read {
        path: path.clone(),
        source,
    })?;
    validate_canonical_file_bytes(&path, &bytes)?;
    let actual_sha256 = sha256_hex(&bytes);
    if actual_sha256 != expected_sha256 {
        return Err(M3FixtureError::DigestMismatch {
            path,
            expected: expected_sha256.to_owned(),
            actual: actual_sha256,
        });
    }
    let value = serde_json::from_slice(&bytes).map_err(|source| M3FixtureError::Json {
        path: path.clone(),
        source,
    })?;
    Ok((path, value))
}

fn validate_canonical_file_bytes(path: &Path, bytes: &[u8]) -> Result<(), M3FixtureError> {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf])
        || bytes.last() != Some(&b'\n')
        || bytes.get(bytes.len().saturating_sub(2)) == Some(&b'\n')
        || bytes.contains(&b'\r')
    {
        return Err(M3FixtureError::NonCanonicalEvidence {
            path: path.to_path_buf(),
            detail: "evidence must be BOM-free UTF-8 JSON with one LF trailing newline",
        });
    }
    Ok(())
}

fn validate_case_evidence(
    value: &Value,
    contract: &M3OracleCaseContract,
    entry: &M3PublishedFixture,
) -> Result<(), M3FixtureError> {
    const KEYS: [&str; 14] = [
        "schema_version",
        "scenario_id",
        "provenance",
        "initial_state",
        "initial_rng",
        "commands",
        "expected_rng_draws",
        "expected_action_order",
        "expected_mutations",
        "expected_presentation",
        "expected_final_state",
        "final_rng",
        "expected_next_control",
        "gaps",
    ];
    let object = exact_object(value, &KEYS, "published case envelope")?;
    if object.get("schema_version").and_then(Value::as_u64)
        != Some(u64::from(M3_MANIFEST_SCHEMA_VERSION))
        || object.get("scenario_id").and_then(Value::as_str) != Some(contract.scenario_id.as_str())
        || !object
            .get("gaps")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
    {
        return Err(contract_error(
            "published_case",
            "case schema, identity, or gap-free state is invalid",
        ));
    }
    validate_bound_provenance(object.get("provenance"), entry.provenance())
}

fn validate_supporting_evidence(
    value: &Value,
    contract: &M3SupportingArtifactContract,
    entry: &M3PublishedSupportingArtifact,
) -> Result<(), M3FixtureError> {
    let object = match contract.artifact_id.as_str() {
        "content-pack-v1" => {
            let object = exact_object(
                value,
                &[
                    "artifact_id",
                    "schema_version",
                    "provenance",
                    "content_pack",
                ],
                "content-pack artifact envelope",
            )?;
            let pack_value = object.get("content_pack").ok_or_else(|| {
                contract_error(
                    "content-pack artifact envelope",
                    "content_pack field is absent",
                )
            })?;
            let pack = exact_object(
                pack_value,
                &[
                    "schema_version",
                    "oracle_game_sha",
                    "hash",
                    "species",
                    "moves",
                    "abilities",
                    "type_chart",
                    "capability_manifest",
                ],
                "content pack",
            )?;
            let expected_hash = format!("blake3-v1:{}", entry.content_pack_hash);
            if pack.get("schema_version").and_then(Value::as_u64)
                != Some(u64::from(M3_MANIFEST_SCHEMA_VERSION))
                || pack.get("oracle_game_sha").and_then(Value::as_str) != Some(M3_ORACLE_GAME_SHA)
                || pack.get("hash").and_then(Value::as_str) != Some(expected_hash.as_str())
            {
                return Err(contract_error(
                    "content_pack",
                    "published content pack identity or hash is invalid",
                ));
            }
            object
        }
        "rng-vectors-v1" => {
            let object = exact_object(
                value,
                &["artifact_id", "schema_version", "provenance", "vectors"],
                "RNG-vector artifact envelope",
            )?;
            if !object
                .get("vectors")
                .and_then(Value::as_array)
                .is_some_and(|vectors| !vectors.is_empty())
            {
                return Err(contract_error(
                    "rng_vectors",
                    "published RNG vector list must not be empty",
                ));
            }
            object
        }
        _ => {
            return Err(contract_error(
                "supporting_artifact_contracts",
                "unknown supporting artifact contract",
            ));
        }
    };

    if object.get("schema_version").and_then(Value::as_u64)
        != Some(u64::from(M3_MANIFEST_SCHEMA_VERSION))
        || object.get("artifact_id").and_then(Value::as_str) != Some(contract.artifact_id.as_str())
    {
        return Err(contract_error(
            "published_supporting_artifact",
            "supporting artifact schema or identity is invalid",
        ));
    }
    validate_bound_provenance(object.get("provenance"), entry.provenance())
}

trait PublishedProvenance {
    fn provenance(&self) -> (&str, &str, &str, &str);
}

impl PublishedProvenance for M3PublishedFixture {
    fn provenance(&self) -> (&str, &str, &str, &str) {
        (
            &self.oracle_game_sha,
            &self.oracle_tree_sha,
            &self.exporter_commit_sha,
            &self.content_pack_hash,
        )
    }
}

impl PublishedProvenance for M3PublishedSupportingArtifact {
    fn provenance(&self) -> (&str, &str, &str, &str) {
        (
            &self.oracle_game_sha,
            &self.oracle_tree_sha,
            &self.exporter_commit_sha,
            &self.content_pack_hash,
        )
    }
}

fn validate_bound_provenance(
    value: Option<&Value>,
    expected: (&str, &str, &str, &str),
) -> Result<(), M3FixtureError> {
    let Some(object) = value.and_then(Value::as_object) else {
        return Err(contract_error(
            "provenance",
            "published evidence provenance must be an object",
        ));
    };
    let fields = [
        "oracle_game_sha",
        "oracle_tree_sha",
        "exporter_commit_sha",
        "content_pack_hash",
        "node_version",
        "phaser_version",
        "runner_class",
        "platform",
        "architecture",
        "locale",
        "timezone",
    ];
    if fields.iter().any(|field| !object.contains_key(*field)) {
        return Err(contract_error(
            "provenance",
            "published evidence provenance is incomplete",
        ));
    }
    let (oracle_game_sha, oracle_tree_sha, exporter_commit_sha, content_pack_hash) = expected;
    if object.get("oracle_game_sha").and_then(Value::as_str) != Some(oracle_game_sha)
        || object.get("oracle_tree_sha").and_then(Value::as_str) != Some(oracle_tree_sha)
        || object.get("exporter_commit_sha").and_then(Value::as_str) != Some(exporter_commit_sha)
        || object.get("content_pack_hash").and_then(Value::as_str) != Some(content_pack_hash)
        || object.get("runner_class").and_then(Value::as_str) != Some("GITHUB_HOSTED_UBUNTU")
        || object.get("platform").and_then(Value::as_str) != Some("linux")
        || object.get("architecture").and_then(Value::as_str) != Some("x64")
        || object.get("locale").and_then(Value::as_str) != Some("C")
        || object.get("timezone").and_then(Value::as_str) != Some("UTC")
        || !nonempty_string(object.get("node_version"))
        || !nonempty_string(object.get("phaser_version"))
    {
        return Err(contract_error(
            "provenance",
            "published evidence provenance is not bound to the hosted manifest identity",
        ));
    }
    Ok(())
}

fn nonempty_string(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
}

fn exact_object<'a>(
    value: &'a Value,
    expected_keys: &[&str],
    context: &'static str,
) -> Result<&'a Map<String, Value>, M3FixtureError> {
    let Some(object) = value.as_object() else {
        return Err(contract_error(context, "value must be an object"));
    };
    if object.len() != expected_keys.len()
        || expected_keys.iter().any(|key| !object.contains_key(*key))
    {
        return Err(contract_error(context, "object fields are not exact"));
    }
    Ok(object)
}

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn contract_error(field: &'static str, detail: impl Into<String>) -> M3FixtureError {
    M3FixtureError::Contract {
        field,
        detail: detail.into(),
    }
}

#[derive(Debug, Error)]
pub enum M3FixtureError {
    #[error("could not read M3 fixture {path:?}: {source}")]
    Read {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("could not parse M3 fixture {path:?}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("M3 fixture contract violation in {field}: {detail}")]
    Contract { field: &'static str, detail: String },
    #[error("unknown M3 {kind} identifier {id:?}")]
    UnknownFixture { kind: M3FixtureKind, id: String },
    #[error("M3 {kind} {id:?} is cataloged but not published")]
    Unpublished { kind: M3FixtureKind, id: String },
    #[error("M3 evidence {path:?} SHA-256 mismatch: expected {expected}, actual {actual}")]
    DigestMismatch {
        path: PathBuf,
        expected: String,
        actual: String,
    },
    #[error("M3 evidence {path:?} is not canonical: {detail}")]
    NonCanonicalEvidence { path: PathBuf, detail: &'static str },
}

/// Return the lowercase SHA-256 of arbitrary bytes without a runtime or test dependency.
pub fn sha256_hex(bytes: &[u8]) -> String {
    encode_lowercase_hex(&sha256_digest(bytes))
}

const SHA256_INITIAL_STATE: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const SHA256_ROUND_CONSTANTS: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

fn sha256_digest(bytes: &[u8]) -> [u8; 32] {
    let mut state = SHA256_INITIAL_STATE;
    let mut block = [0_u8; 64];
    let mut chunks = bytes.chunks_exact(64);

    for chunk in &mut chunks {
        block.copy_from_slice(chunk);
        sha256_compress(&mut state, &block);
    }

    let remainder = chunks.remainder();
    block = [0_u8; 64];
    block[..remainder.len()].copy_from_slice(remainder);
    block[remainder.len()] = 0x80;

    let bit_length = (bytes.len() as u64).wrapping_mul(8);
    if remainder.len() > 55 {
        sha256_compress(&mut state, &block);
        block = [0_u8; 64];
    }
    block[56..64].copy_from_slice(&bit_length.to_be_bytes());
    sha256_compress(&mut state, &block);

    let mut digest = [0_u8; 32];
    for (index, word) in state.iter().enumerate() {
        digest[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    digest
}

fn sha256_compress(state: &mut [u32; 8], block: &[u8; 64]) {
    let mut schedule = [0_u32; 64];
    for (index, word) in schedule[..16].iter_mut().enumerate() {
        let offset = index * 4;
        *word = u32::from_be_bytes([
            block[offset],
            block[offset + 1],
            block[offset + 2],
            block[offset + 3],
        ]);
    }

    for index in 16..64 {
        let s0 = schedule[index - 15].rotate_right(7)
            ^ schedule[index - 15].rotate_right(18)
            ^ (schedule[index - 15] >> 3);
        let s1 = schedule[index - 2].rotate_right(17)
            ^ schedule[index - 2].rotate_right(19)
            ^ (schedule[index - 2] >> 10);
        schedule[index] = schedule[index - 16]
            .wrapping_add(s0)
            .wrapping_add(schedule[index - 7])
            .wrapping_add(s1);
    }

    let mut working = *state;
    for (constant, word) in SHA256_ROUND_CONSTANTS.iter().zip(schedule) {
        let s1 =
            working[4].rotate_right(6) ^ working[4].rotate_right(11) ^ working[4].rotate_right(25);
        let choice = (working[4] & working[5]) ^ ((!working[4]) & working[6]);
        let temporary1 = working[7]
            .wrapping_add(s1)
            .wrapping_add(choice)
            .wrapping_add(*constant)
            .wrapping_add(word);
        let s0 =
            working[0].rotate_right(2) ^ working[0].rotate_right(13) ^ working[0].rotate_right(22);
        let majority =
            (working[0] & working[1]) ^ (working[0] & working[2]) ^ (working[1] & working[2]);
        let temporary2 = s0.wrapping_add(majority);

        working[7] = working[6];
        working[6] = working[5];
        working[5] = working[4];
        working[4] = working[3].wrapping_add(temporary1);
        working[3] = working[2];
        working[2] = working[1];
        working[1] = working[0];
        working[0] = temporary1.wrapping_add(temporary2);
    }

    for (state_word, working_word) in state.iter_mut().zip(working) {
        *state_word = state_word.wrapping_add(working_word);
    }
}

fn encode_lowercase_hex(bytes: &[u8; 32]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(64);
    for &byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}
