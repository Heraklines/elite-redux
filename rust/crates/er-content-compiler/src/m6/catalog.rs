//! Typed semantic-catalog input DTOs and exact identity validation.
//!
//! A [`SemanticCatalogV1`] becomes a [`ValidatedSemanticCatalog`] only after
//! structural validation plus exact oracle-SHA and raw-catalog-hash checks
//! and an exact per-source behavior-unit closure proof. Every later compile
//! stage consumes the validated form, so no stage re-litigates identity.

use er_canonical::{CanonicalError, fixture_digest};
use er_content::m6_catalog::{CatalogLoadError, CatalogSourceEntry, SemanticCatalogV1};
use er_types::m6::CatalogHash;
use thiserror::Error;

/// Frozen M6 oracle SHA from `rust/contracts/m6-contract.toml`.
pub const M6_ORACLE_SHA: &str = "3bb6d49c924293ef79e3ab2f11e10cf4f5b9c6c7";

#[derive(Debug, Error)]
pub enum CatalogValidationError {
    #[error("semantic catalog failed structural validation: {0}")]
    Structural(#[from] CatalogLoadError),
    #[error(
        "semantic catalog oracle SHA mismatch: expected {expected}, actual {actual}"
    )]
    OracleShaMismatch {
        expected: &'static str,
        actual: String,
    },
    #[error(
        "semantic catalog raw-catalog hash mismatch: expected {expected}, actual {actual}"
    )]
    RawCatalogHashMismatch {
        expected: String,
        actual: String,
    },
    #[error(
        "semantic catalog declares {declared} behavior units but carries {actual}"
    )]
    BehaviorUnitClosure { declared: u64, actual: usize },
    #[error(
        "source {index} declares {declared} behavior units but carries {actual}"
    )]
    SourceUnitClosure {
        index: usize,
        declared: u64,
        actual: usize,
    },
    #[error("semantic catalog digest failed: {0}")]
    Digest(#[from] CanonicalError),
}

/// Typed compiler input: the semantic catalog plus the exact raw-catalog
/// hash the frozen exporter attested. The oracle SHA expectation is the
/// frozen [`M6_ORACLE_SHA`] constant, not caller-supplied data.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SemanticCatalogInput {
    pub catalog: SemanticCatalogV1,
    pub expected_raw_catalog_hash: CatalogHash,
}

impl SemanticCatalogInput {
    pub const fn new(catalog: SemanticCatalogV1, expected_raw_catalog_hash: CatalogHash) -> Self {
        Self {
            catalog,
            expected_raw_catalog_hash,
        }
    }
}

/// A semantic catalog that passed total input validation. Construction is
/// the only path in; every field is immutable afterwards.
#[derive(Clone, Debug)]
pub struct ValidatedSemanticCatalog {
    catalog: SemanticCatalogV1,
    semantic_catalog_hash: CatalogHash,
}

impl ValidatedSemanticCatalog {
    /// Validates structure, exact identity hashes, and per-source behavior
    /// unit closure; derives the deterministic semantic-catalog digest from
    /// the validated catalog alone.
    pub fn new(input: SemanticCatalogInput) -> Result<Self, CatalogValidationError> {
        input.catalog.validate()?;
        if input.catalog.oracle_sha != M6_ORACLE_SHA {
            return Err(CatalogValidationError::OracleShaMismatch {
                expected: M6_ORACLE_SHA,
                actual: input.catalog.oracle_sha.clone(),
            });
        }
        if input.catalog.raw_catalog_hash != input.expected_raw_catalog_hash.as_str() {
            return Err(CatalogValidationError::RawCatalogHashMismatch {
                expected: input.expected_raw_catalog_hash.as_str().to_owned(),
                actual: input.catalog.raw_catalog_hash.clone(),
            });
        }

        let declared_total = input.catalog.declared_behavior_unit_total();
        let actual_total = input.catalog.behavior_units.len();
        if declared_total != actual_total as u64 {
            return Err(CatalogValidationError::BehaviorUnitClosure {
                declared: declared_total,
                actual: actual_total,
            });
        }

        // Sources and behavior units are both sorted by `BehaviorSourceId`
        // order, so a single merge walk proves each source owns exactly its
        // declared number of consecutive units.
        let sources = input.catalog.sources.as_slice();
        let units = input.catalog.behavior_units.as_slice();
        let mut cursor = 0_usize;
        for (index, entry) in sources.iter().enumerate() {
            let start = cursor;
            while cursor < units.len() && units[cursor].id.source == entry.source {
                cursor += 1;
            }
            let owned = (cursor - start) as u64;
            if owned != entry.behavior_unit_count {
                return Err(CatalogValidationError::SourceUnitClosure {
                    index,
                    declared: entry.behavior_unit_count,
                    actual: owned as usize,
                });
            }
        }

        let semantic_catalog_hash =
            CatalogHash::parse(fixture_digest(&input.catalog)?)?;
        Ok(Self {
            catalog: input.catalog,
            semantic_catalog_hash,
        })
    }

    pub fn as_catalog(&self) -> &SemanticCatalogV1 {
        &self.catalog
    }

    /// Digest of the validated catalog over the frozen exporter-compatible
    /// canonical bytes; identical catalogs always produce identical digests.
    pub fn semantic_catalog_hash(&self) -> &CatalogHash {
        &self.semantic_catalog_hash
    }

    pub fn oracle_sha(&self) -> &str {
        &self.catalog.oracle_sha
    }

    pub fn raw_catalog_hash(&self) -> &str {
        &self.catalog.raw_catalog_hash
    }

    /// Source identities in frozen catalog order.
    pub fn sources(&self) -> &[CatalogSourceEntry] {
        &self.catalog.sources
    }

    /// Behavior units in frozen ascending-identity order.
    pub fn behavior_units(&self) -> &[er_content::m6_catalog::CatalogBehaviorUnit] {
        &self.catalog.behavior_units
    }

    /// RNG sites in frozen catalog order; all remain non-executable gaps.
    pub fn rng_sites(&self) -> &[er_content::m6_catalog::CatalogRngSite] {
        &self.catalog.rng_sites
    }
}
