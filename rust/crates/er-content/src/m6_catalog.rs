//! Validated M6 raw/semantic catalog DTOs.
//!
//! These types load the frozen `rust/fixtures/m6/*` inventories exactly as the
//! pinned exporter emits them. Unknown fields, kinds, or values fail closed:
//! a catalog that no longer matches this surface requires contract
//! regeneration, never silent acceptance.

use std::collections::BTreeSet;

use er_types::{
    BehaviorSourceId, BehaviorUnitId, BehaviorUnitKind, ProvenanceHash, RngDomainV1, RngReasonV2,
    RngSiteId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const RAW_SOURCE_CATALOG_SCHEMA_VERSION_V2: u32 = 2;
pub const SEMANTIC_CATALOG_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CatalogLoadError {
    #[error("semantic catalog JSON does not match the frozen DTO surface: {0}")]
    Json(String),
    #[error("semantic catalog schema must be version {expected}, got {actual}")]
    SemanticSchemaVersion { expected: u32, actual: u32 },
    #[error("oracle SHA must be 40 lowercase hex characters")]
    OracleShaFormat,
    #[error("raw catalog hash must be 64 lowercase hex characters")]
    RawCatalogHashFormat,
    #[error("catalog source identities are duplicated or unsorted")]
    SourcesNotSortedUnique,
    #[error("catalog source entry has an invalid behavior-unit count")]
    InvalidSourceUnitCount,
    #[error("behavior units are duplicated or unsorted")]
    BehaviorUnitsNotSortedUnique,
    #[error("behavior unit {index} references an unknown source identity")]
    UnknownBehaviorSource { index: usize },
    #[error("RNG site {index} references an unknown behavior-unit owner")]
    UnknownRngOwner { index: usize },
    #[error("RNG site identities are duplicated")]
    DuplicateRngSite,
}

/// Source-file coordinates of one extraction provenance record.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceLocation {
    pub path: String,
    pub line: u32,
    pub column: u32,
}

/// Closed extraction-resolution classification of one behavior unit.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CatalogResolution {
    ResolvedIntrinsic,
    ResolvedOperands,
    BespokeGap,
}

/// Provenance of one behavior unit. Attribute-attachment units carry the
/// extracted class name and builder method alongside file coordinates.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogProvenance {
    pub path: String,
    pub line: u32,
    pub column: u32,
    #[serde(default)]
    pub attribute: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
}

/// Closed target scope recorded by the extractor.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CatalogTargetKind {
    #[serde(rename = "CALLSITE_DEFINED")]
    CallSiteDefined,
    Source,
    SourceDefined,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogTarget {
    pub kind: CatalogTargetKind,
}

/// Closed coarse effect family recorded by the extractor. Fine-grained
/// semantics arrive only through audited M6B schemas; this value never
/// dispatches behavior on its own.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CatalogEffectKind {
    ApplyOrBlockStatus,
    FixedDispatch,
    FormDefinition,
    Heal,
    IntrinsicDefinition,
    ModifyOrApplyDamage,
    ModifyStatOrStage,
    ModifyTag,
    ModifyTarget,
    ModifyTerrain,
    ModifyType,
    ModifyWeather,
    RngCallsite,
    SpeciesDefinition,
    SwitchOrTrap,
    UnresolvedEffect,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogEffect {
    pub kind: CatalogEffectKind,
    #[serde(default)]
    pub attribute: Option<String>,
    #[serde(default)]
    pub call: Option<String>,
}

/// Non-empty hook evidence string. Hook evidence is provenance, not a closed
/// dispatch key: the closed `MechanicHookV2` mapping happens at compile time
/// through audited per-attribute schemas.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct HookEvidence(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImplementationClassEvidence {
    #[serde(rename = "abstract")]
    pub is_abstract: bool,
    #[serde(default)]
    pub base: Option<String>,
    pub family: String,
    pub methods: Vec<String>,
    pub name: String,
    pub source: SourceLocation,
}

/// Closed operand vocabulary extracted from oracle constructor arguments.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CatalogOperand {
    Always {},
    Array {
        values: Vec<CatalogOperand>,
    },
    Boolean {
        value: bool,
    },
    CallbackProvenance {
        syntax_kind: String,
        provenance_hash: ProvenanceHash,
        source: SourceLocation,
    },
    JsNumberBits {
        bits: String,
    },
    Null {},
    Object {
        entries: Vec<CatalogOperandEntry>,
    },
    SafeInteger {
        value: i64,
    },
    SourceExpressionGap {
        arguments: Vec<String>,
    },
    String {
        value: String,
    },
    SymbolProvenance {
        owner: String,
        member: String,
        provenance_hash: ProvenanceHash,
        source: SourceLocation,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogOperandEntry {
    pub key: String,
    pub value: CatalogOperand,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogSemantic {
    #[serde(default)]
    pub condition: Option<CatalogOperand>,
    pub effect: CatalogEffect,
    pub hook: HookEvidence,
    #[serde(default)]
    pub implementation: Option<ImplementationClassEvidence>,
    pub operands: Vec<CatalogOperand>,
    pub resolution: CatalogResolution,
    pub target: CatalogTarget,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogBehaviorUnit {
    pub id: BehaviorUnitId,
    pub provenance: CatalogProvenance,
    pub semantic: CatalogSemantic,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogSourceEntry {
    pub source: BehaviorSourceId,
    pub behavior_unit_count: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CatalogRngStream {
    BattleSubstream,
    RunStream,
    UnresolvedGap,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CatalogRngSingletonPolicy {
    OracleUnverifiedGap,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CatalogRngBindingStatus {
    BespokeGap,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogRngRangeGap {
    pub kind: CatalogRangeGapKind,
    pub arguments: Vec<String>,
    pub provenance_hash: ProvenanceHash,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CatalogRangeGapKind {
    SourceExpressionGap,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogRngSite {
    pub id: RngSiteId,
    pub owner: BehaviorUnitId,
    pub execution_ordinal: u32,
    pub source: SourceLocation,
    pub call: String,
    pub arguments: Vec<String>,
    pub domain: RngDomainV1,
    pub reason: RngReasonV2,
    pub stream: CatalogRngStream,
    pub range: CatalogRngRangeGap,
    pub singleton_policy: CatalogRngSingletonPolicy,
    pub binding_status: CatalogRngBindingStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogContractEvidence {
    pub authority: String,
    pub evidence: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticCatalogV1 {
    pub schema_version: u32,
    pub oracle_sha: String,
    pub raw_catalog_hash: String,
    pub sources: Vec<CatalogSourceEntry>,
    pub behavior_units: Vec<CatalogBehaviorUnit>,
    pub rng_sites: Vec<CatalogRngSite>,
    pub trigger_order: CatalogContractEvidence,
    pub query_order: CatalogContractEvidence,
    pub targeting_contract: CatalogContractEvidence,
}

fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

impl SemanticCatalogV1 {
    /// Total structural validation after deserialization. Deserialization
    /// already enforces closed vocabularies and hash shapes.
    pub fn validate(&self) -> Result<(), CatalogLoadError> {
        if self.schema_version != SEMANTIC_CATALOG_SCHEMA_VERSION {
            return Err(CatalogLoadError::SemanticSchemaVersion {
                expected: SEMANTIC_CATALOG_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.oracle_sha.len() != 40
            || !self
                .oracle_sha
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(CatalogLoadError::OracleShaFormat);
        }
        if !is_lower_hex_64(&self.raw_catalog_hash) {
            return Err(CatalogLoadError::RawCatalogHashFormat);
        }

        let mut previous_source: Option<&BehaviorSourceId> = None;
        let mut seen_sources = BTreeSet::new();
        for entry in &self.sources {
            if previous_source.is_some_and(|previous| previous >= &entry.source) {
                return Err(CatalogLoadError::SourcesNotSortedUnique);
            }
            if seen_sources.insert(&entry.source) == false {
                return Err(CatalogLoadError::SourcesNotSortedUnique);
            }
            if entry.behavior_unit_count == 0 {
                return Err(CatalogLoadError::InvalidSourceUnitCount);
            }
            previous_source = Some(&entry.source);
        }

        let mut previous_unit: Option<&BehaviorUnitId> = None;
        let mut unit_ids = BTreeSet::new();
        for (index, unit) in self.behavior_units.iter().enumerate() {
            if previous_unit.is_some_and(|previous| previous >= &unit.id) {
                return Err(CatalogLoadError::BehaviorUnitsNotSortedUnique);
            }
            if !seen_sources.contains(&unit.id.source) {
                return Err(CatalogLoadError::UnknownBehaviorSource { index });
            }
            previous_unit = Some(&unit.id);
            unit_ids.insert(unit.id.clone());
        }

        let mut seen_rng_sites = BTreeSet::new();
        for (index, site) in self.rng_sites.iter().enumerate() {
            if !unit_ids.contains(&site.owner) {
                return Err(CatalogLoadError::UnknownRngOwner { index });
            }
            if !seen_rng_sites.insert(site.id.clone()) {
                return Err(CatalogLoadError::DuplicateRngSite);
            }
        }
        Ok(())
    }

    /// Loads and validates a semantic catalog from canonical JSON bytes.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CatalogLoadError> {
        let catalog: Self = serde_json::from_slice(bytes)
            .map_err(|error| CatalogLoadError::Json(error.to_string()))?;
        catalog.validate()?;
        Ok(catalog)
    }

    /// The declared total behavior-unit count implied by the source entries.
    pub fn declared_behavior_unit_total(&self) -> u64 {
        self.sources
            .iter()
            .map(|entry| entry.behavior_unit_count)
            .sum()
    }
}

/// Convenience alias used by prepared-content validation.
pub type CatalogBehaviorUnitKind = BehaviorUnitKind;
