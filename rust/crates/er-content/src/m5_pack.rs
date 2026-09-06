//! Generated M5 battle content pack V2: identity, classification closure, and
//! validated mechanics programs. Statics live beside compiled behavior; deep
//! mechanics belong to the programs, never to duplicated struct logic.

use std::collections::BTreeSet;

use er_canonical::{CanonicalError, content_digest};
use er_mechanics::{MechanicsProgramV1, ProgramValidationError};
use er_types::battle_model::CapabilityStatus;
use er_types::mechanics::MechanicsProgramId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::abilities::AbilityDefinition;
use crate::moves::MoveDefinition;
use crate::pack::TypeChart;
use crate::species::SpeciesDefinition;

pub const BATTLE_CONTENT_PACK_SCHEMA_VERSION_V2: u32 = 2;
pub const CONTENT_HASH_PREFIX: &str = "blake3-v1:";
pub const SOURCE_CATALOG_DIGEST_PREFIX: &str = "sha256:";

/// One catalog identity classified exactly once.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ClassificationKind {
    Compiled,
    Bespoke,
    Unsupported,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HeldItemDefinitionV2 {
    pub registry_key: String,
    pub capability: CapabilityStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BespokeEntryV1 {
    pub mechanic_symbol: String,
    pub justification: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClassificationEntryV1 {
    pub subject: er_types::mechanics::MechanicSourceId,
    pub kind: ClassificationKind,
    #[serde(default)]
    pub programs: Vec<MechanicsProgramId>,
    #[serde(default)]
    pub bespoke_symbol: Option<String>,
    #[serde(default)]
    pub unsupported_reason: Option<String>,
}

impl ClassificationEntryV1 {
    fn validate_shape(&self) -> Result<(), BattlePackLoadError> {
        let shaped = match self.kind {
            ClassificationKind::Compiled => {
                !self.programs.is_empty()
                    && self.bespoke_symbol.is_none()
                    && self.unsupported_reason.is_none()
            }
            ClassificationKind::Bespoke => {
                self.programs.is_empty()
                    && self
                        .bespoke_symbol
                        .as_deref()
                        .is_some_and(|symbol| !symbol.is_empty())
                    && self.unsupported_reason.is_none()
            }
            ClassificationKind::Unsupported => {
                self.programs.is_empty()
                    && self.bespoke_symbol.is_none()
                    && self
                        .unsupported_reason
                        .as_deref()
                        .is_some_and(|reason| !reason.is_empty())
            }
        };
        if shaped {
            Ok(())
        } else {
            Err(BattlePackLoadError::ClassificationShape)
        }
    }
}

/// Sorted, duplicate-free classification manifest.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ClassificationManifestV1(pub Vec<ClassificationEntryV1>);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleContentPackV2 {
    pub schema_version: u32,
    pub oracle_sha: String,
    pub source_catalog_digest: String,
    pub content_hash: String,
    pub species: Vec<Option<SpeciesDefinition>>,
    pub moves: Vec<Option<MoveDefinition>>,
    pub abilities: Vec<Option<AbilityDefinition>>,
    pub held_items: Vec<HeldItemDefinitionV2>,
    pub programs: Vec<Option<MechanicsProgramV1>>,
    pub classifications: ClassificationManifestV1,
    pub bespoke: Vec<BespokeEntryV1>,
    pub type_chart: TypeChart,
}

#[derive(Serialize)]
struct PackV2HashInput<'a> {
    schema_version: u32,
    oracle_sha: &'a str,
    source_catalog_digest: &'a str,
    species: &'a [Option<SpeciesDefinition>],
    moves: &'a [Option<MoveDefinition>],
    abilities: &'a [Option<AbilityDefinition>],
    held_items: &'a [HeldItemDefinitionV2],
    programs: &'a [Option<MechanicsProgramV1>],
    classifications: &'a ClassificationManifestV1,
    bespoke: &'a [BespokeEntryV1],
    type_chart: &'a TypeChart,
}

fn is_lower_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn require_prefixed_hex(
    field: &'static str,
    value: &str,
    prefix: &str,
) -> Result<(), BattlePackLoadError> {
    let body = value
        .strip_prefix(prefix)
        .ok_or_else(|| BattlePackLoadError::DigestFormat {
            field,
            expected_prefix: prefix.to_owned(),
        })?;
    if !is_lower_hex(body) {
        return Err(BattlePackLoadError::DigestFormat {
            field,
            expected_prefix: prefix.to_owned(),
        });
    }
    Ok(())
}

fn require_oracle_sha(value: &str) -> Result<(), BattlePackLoadError> {
    if value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(BattlePackLoadError::DigestFormat {
            field: "oracle_sha",
            expected_prefix: "40 lowercase hex digits".to_owned(),
        })
    }
}

impl BattleContentPackV2 {
    /// The domain-separated BLAKE3 digest over canonical JSON with the
    /// embedded `content_hash` field omitted.
    pub fn compute_content_hash(&self) -> Result<String, BattlePackLoadError> {
        let input = PackV2HashInput {
            schema_version: self.schema_version,
            oracle_sha: &self.oracle_sha,
            source_catalog_digest: &self.source_catalog_digest,
            species: &self.species,
            moves: &self.moves,
            abilities: &self.abilities,
            held_items: &self.held_items,
            programs: &self.programs,
            classifications: &self.classifications,
            bespoke: &self.bespoke,
            type_chart: &self.type_chart,
        };
        let digest = content_digest(&input).map_err(BattlePackLoadError::Canonical)?;
        Ok(format!("{CONTENT_HASH_PREFIX}{digest}"))
    }

    /// Validates structure, classification closure, program indexing, and the
    /// embedded content hash.
    pub fn validate(&self) -> Result<(), BattlePackLoadError> {
        if self.schema_version != BATTLE_CONTENT_PACK_SCHEMA_VERSION_V2 {
            return Err(BattlePackLoadError::SchemaVersion {
                expected: BATTLE_CONTENT_PACK_SCHEMA_VERSION_V2,
                actual: self.schema_version,
            });
        }
        require_oracle_sha(&self.oracle_sha)?;
        require_prefixed_hex(
            "source_catalog_digest",
            &self.source_catalog_digest,
            SOURCE_CATALOG_DIGEST_PREFIX,
        )?;
        require_prefixed_hex("content_hash", &self.content_hash, CONTENT_HASH_PREFIX)?;

        Self::validate_sorted_ids(
            "species",
            self.species
                .iter()
                .map(|entry| entry.as_ref().map(|definition| definition.id.get().get())),
        )?;
        Self::validate_sorted_ids(
            "moves",
            self.moves
                .iter()
                .map(|entry| entry.as_ref().map(|definition| definition.id.get().get())),
        )?;
        Self::validate_sorted_ids(
            "abilities",
            self.abilities
                .iter()
                .map(|entry| entry.as_ref().map(|definition| definition.id.get().get())),
        )?;

        for (index, program) in self.programs.iter().enumerate() {
            let Some(program) = program else {
                continue;
            };
            if program.id.get().get() != index as u64 {
                return Err(BattlePackLoadError::ProgramIndex {
                    index,
                    program_id: program.id.get().get(),
                });
            }
            program
                .validate()
                .map_err(|source| BattlePackLoadError::Program { index, source })?;
        }

        let mut seen_keys: BTreeSet<&str> = BTreeSet::new();
        for item in &self.held_items {
            if item.registry_key.is_empty() || !seen_keys.insert(item.registry_key.as_str()) {
                return Err(BattlePackLoadError::DuplicateHeldItem {
                    key: item.registry_key.clone(),
                });
            }
        }

        let mut previous_subject: Option<&er_types::mechanics::MechanicSourceId> = None;
        for entry in &self.classifications.0 {
            entry.validate_shape()?;
            if let Some(previous) = previous_subject
                && entry.subject <= *previous
            {
                return Err(BattlePackLoadError::DuplicateClassification);
            }
            previous_subject = Some(&entry.subject);
            if entry.kind == ClassificationKind::Compiled {
                for program_id in &entry.programs {
                    let numeric = program_id.get().get();
                    match self.programs.get(numeric as usize) {
                        Some(Some(_)) => {}
                        _ => {
                            return Err(BattlePackLoadError::UnknownProgramReference {
                                program_id: numeric,
                            });
                        }
                    }
                }
            }
        }

        let mut bespoke_symbols: BTreeSet<&str> = BTreeSet::new();
        for bespoke in &self.bespoke {
            if bespoke.mechanic_symbol.is_empty()
                || bespoke.justification.is_empty()
                || !bespoke_symbols.insert(bespoke.mechanic_symbol.as_str())
            {
                return Err(BattlePackLoadError::InvalidBespokeEntry {
                    symbol: bespoke.mechanic_symbol.clone(),
                });
            }
        }
        for entry in &self.classifications.0 {
            if entry.kind == ClassificationKind::Bespoke {
                let symbol = entry.bespoke_symbol.as_deref().unwrap_or_default();
                if !bespoke_symbols.contains(symbol) {
                    return Err(BattlePackLoadError::MissingBespokeSymbol {
                        symbol: symbol.to_owned(),
                    });
                }
            }
        }

        let computed = self.compute_content_hash()?;
        if computed != self.content_hash {
            return Err(BattlePackLoadError::ContentHashMismatch {
                expected: computed,
                actual: self.content_hash.clone(),
            });
        }
        Ok(())
    }

    fn validate_sorted_ids<I>(kind: &'static str, ids: I) -> Result<(), BattlePackLoadError>
    where
        I: Iterator<Item = Option<u64>>,
    {
        let mut previous: Option<u64> = None;
        for id in ids {
            let Some(id) = id else {
                continue;
            };
            if let Some(previous) = previous
                && id <= previous
            {
                return Err(BattlePackLoadError::DefinitionsOutOfOrder {
                    kind,
                    after: previous,
                    found: id,
                });
            }
            previous = Some(id);
        }
        Ok(())
    }
}

/// Deserializes and validates one canonical battle content pack V2 document.
pub fn load_battle_content_pack_v2(
    bytes: &[u8],
) -> Result<BattleContentPackV2, BattlePackLoadError> {
    let pack: BattleContentPackV2 = serde_json::from_slice(bytes)?;
    pack.validate()?;
    Ok(pack)
}

#[derive(Debug, Error)]
pub enum BattlePackLoadError {
    #[error("battle content pack JSON is malformed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("battle content pack schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("{field} must be `{expected_prefix}` plus 64 lowercase hex digits")]
    DigestFormat {
        field: &'static str,
        expected_prefix: String,
    },
    #[error("embedded content hash {actual} does not match the computed hash {expected}")]
    ContentHashMismatch { expected: String, actual: String },
    #[error("{kind} definitions are out of order: {found} follows {after}")]
    DefinitionsOutOfOrder {
        kind: &'static str,
        after: u64,
        found: u64,
    },
    #[error("program slot {index} holds program ID {program_id}")]
    ProgramIndex { index: usize, program_id: u64 },
    #[error("program at slot {index} is invalid: {source}")]
    Program {
        index: usize,
        #[source]
        source: ProgramValidationError,
    },
    #[error("held item registry key is empty or duplicated: {key}")]
    DuplicateHeldItem { key: String },
    #[error("classification manifest is unsorted or contains a duplicate subject")]
    DuplicateClassification,
    #[error("classification entry does not carry exactly the fields its kind requires")]
    ClassificationShape,
    #[error("compiled classification references unknown program {program_id}")]
    UnknownProgramReference { program_id: u64 },
    #[error("bespoke entry is empty, unjustified, or duplicated: {symbol}")]
    InvalidBespokeEntry { symbol: String },
    #[error("bespoke classification references unknown symbol {symbol}")]
    MissingBespokeSymbol { symbol: String },
    #[error("canonical serialization failed: {0}")]
    Canonical(#[from] CanonicalError),
}
