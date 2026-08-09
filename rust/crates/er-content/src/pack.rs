//! M3A-03 owns immutable selected content-pack construction and validation.

use crate::abilities::{
    AbilityCollectionError, AbilityDefinition, ability_definitions, validate_selected_abilities,
};
use crate::moves::{MoveCollectionError, MoveDefinition, move_definitions, validate_selected_moves};
use crate::species::{
    SpeciesCollectionError, SpeciesDefinition, species_definitions, validate_selected_species,
};
use er_canonical::{CanonicalError, content_digest};
use er_types::battle_ids::{AbilityId, ArenaConditionId, ContentPackHash, MoveId};
use er_types::battle_model::{
    CapabilityStatus, CapabilitySubject, PokemonType, SingleTypeMultiplier, StatusKind,
    TerrainKind, WeatherKind,
};
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

/// The frozen selected-content schema version.
pub const SELECTED_SCHEMA_VERSION: u32 = 1;

/// The pinned TypeScript oracle identity for the selected slice.
pub const ORACLE_GAME_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";

/// Errors raised while constructing or validating a selected content pack.
#[derive(Debug, Error)]
pub enum ContentPackError {
    #[error("content schema version is {actual}, expected {expected}")]
    SchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("content oracle SHA is {actual}, expected {expected}")]
    OracleGameShaMismatch {
        expected: &'static str,
        actual: String,
    },
    #[error("selected species are invalid: {0}")]
    Species(#[source] SpeciesCollectionError),
    #[error("selected moves are invalid: {0}")]
    Moves(#[source] MoveCollectionError),
    #[error("selected abilities are invalid: {0}")]
    Abilities(#[source] AbilityCollectionError),
    #[error("selected type chart is invalid: {0}")]
    TypeChart(#[source] TypeChartError),
    #[error("selected capability manifest is invalid: {0}")]
    CapabilityManifest(#[source] CapabilityManifestError),
    #[error("canonical content hash computation failed: {0}")]
    Canonical(#[source] CanonicalError),
    #[error("content-pack hash has invalid format: {0}")]
    InvalidHash(#[from] er_types::battle_ids::ContentPackHashError),
    #[error("content-pack hash mismatch: stored {expected}, recomputed {actual}")]
    HashMismatch {
        expected: ContentPackHash,
        actual: ContentPackHash,
    },
}

/// One immutable selected content pack.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ContentPack {
    pub schema_version: u32,
    pub oracle_game_sha: String,
    pub hash: ContentPackHash,
    pub species: Vec<SpeciesDefinition>,
    pub moves: Vec<MoveDefinition>,
    pub abilities: Vec<AbilityDefinition>,
    pub type_chart: TypeChart,
    pub capability_manifest: CapabilityManifest,
}

impl ContentPack {
    /// Constructs and hashes one exact selected content pack.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        schema_version: u32,
        oracle_game_sha: String,
        species: Vec<SpeciesDefinition>,
        moves: Vec<MoveDefinition>,
        abilities: Vec<AbilityDefinition>,
        type_chart: TypeChart,
        capability_manifest: CapabilityManifest,
    ) -> Result<Self, ContentPackError> {
        validate_pack_fields(
            schema_version,
            &oracle_game_sha,
            &species,
            &moves,
            &abilities,
            &type_chart,
            &capability_manifest,
        )?;

        let hash = hash_for_parts(
            schema_version,
            &oracle_game_sha,
            &species,
            &moves,
            &abilities,
            &type_chart,
            &capability_manifest,
        )?;
        let pack = Self {
            schema_version,
            oracle_game_sha,
            hash,
            species,
            moves,
            abilities,
            type_chart,
            capability_manifest,
        };
        pack.validate()?;
        Ok(pack)
    }

    /// Validates every selected definition, ordering constraint, and the hash.
    pub fn validate(&self) -> Result<(), ContentPackError> {
        validate_pack_fields(
            self.schema_version,
            &self.oracle_game_sha,
            &self.species,
            &self.moves,
            &self.abilities,
            &self.type_chart,
            &self.capability_manifest,
        )?;

        let actual = self.recompute_hash()?;
        if self.hash != actual {
            return Err(ContentPackError::HashMismatch {
                expected: self.hash.clone(),
                actual,
            });
        }
        Ok(())
    }

    /// Recomputes the hash over the exact seven-field hash preimage.
    pub fn recompute_hash(&self) -> Result<ContentPackHash, ContentPackError> {
        hash_for_parts(
            self.schema_version,
            &self.oracle_game_sha,
            &self.species,
            &self.moves,
            &self.abilities,
            &self.type_chart,
            &self.capability_manifest,
        )
    }
}

impl<'de> Deserialize<'de> for ContentPack {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct ContentPackWire {
            schema_version: u32,
            oracle_game_sha: String,
            hash: ContentPackHash,
            species: Vec<SpeciesDefinition>,
            moves: Vec<MoveDefinition>,
            abilities: Vec<AbilityDefinition>,
            type_chart: TypeChart,
            capability_manifest: CapabilityManifest,
        }

        let wire = ContentPackWire::deserialize(deserializer)?;
        let pack = Self {
            schema_version: wire.schema_version,
            oracle_game_sha: wire.oracle_game_sha,
            hash: wire.hash,
            species: wire.species,
            moves: wire.moves,
            abilities: wire.abilities,
            type_chart: wire.type_chart,
            capability_manifest: wire.capability_manifest,
        };
        pack.validate().map_err(serde::de::Error::custom)?;
        Ok(pack)
    }
}

/// One non-neutral single-type effectiveness entry.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypeChartEntry {
    pub attack: PokemonType,
    pub defense: PokemonType,
    pub multiplier: SingleTypeMultiplier,
}

/// Errors raised when a selected type chart is malformed or not exact.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum TypeChartError {
    #[error("expected {expected} type-chart entries, found {actual}")]
    WrongLength { expected: usize, actual: usize },
    #[error("type-chart entry at index {index} is neutral")]
    NeutralEntry { index: usize },
    #[error("type-chart entry at index {index} repeats attack {attack:?} and defense {defense:?}")]
    DuplicatePair {
        index: usize,
        attack: PokemonType,
        defense: PokemonType,
    },
    #[error("type-chart entries are not sorted at index {index}")]
    Unsorted { index: usize },
    #[error("type chart does not match the frozen selected table")]
    DefinitionMismatch,
}

/// The exact selected non-neutral type chart.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TypeChart {
    pub entries: Vec<TypeChartEntry>,
}

impl TypeChart {
    /// Constructs and validates the exact selected non-neutral table.
    pub fn new(entries: Vec<TypeChartEntry>) -> Result<Self, TypeChartError> {
        let chart = Self { entries };
        chart.validate()?;
        Ok(chart)
    }

    /// Validates non-neutrality, uniqueness, canonical order, and exact values.
    pub fn validate(&self) -> Result<(), TypeChartError> {
        let expected = canonical_type_chart_entries();
        if self.entries.len() != expected.len() {
            return Err(TypeChartError::WrongLength {
                expected: expected.len(),
                actual: self.entries.len(),
            });
        }

        for (index, entry) in self.entries.iter().enumerate() {
            if entry.multiplier == SingleTypeMultiplier::One {
                return Err(TypeChartError::NeutralEntry { index });
            }

            if let Some(previous) = index.checked_sub(1).and_then(|i| self.entries.get(i)) {
                let previous_pair = (previous.attack, previous.defense);
                let pair = (entry.attack, entry.defense);
                if pair == previous_pair {
                    return Err(TypeChartError::DuplicatePair {
                        index,
                        attack: entry.attack,
                        defense: entry.defense,
                    });
                }
                if pair < previous_pair {
                    return Err(TypeChartError::Unsorted { index });
                }
            }
        }

        if self.entries != expected {
            return Err(TypeChartError::DefinitionMismatch);
        }
        Ok(())
    }

    /// Returns a stored multiplier, or neutral for an absent pair.
    pub fn multiplier(&self, attack: PokemonType, defense: PokemonType) -> SingleTypeMultiplier {
        self.entries
            .iter()
            .find(|entry| entry.attack == attack && entry.defense == defense)
            .map_or(SingleTypeMultiplier::One, |entry| entry.multiplier)
    }
}

impl<'de> Deserialize<'de> for TypeChart {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct TypeChartWire {
            entries: Vec<TypeChartEntry>,
        }

        let wire = TypeChartWire::deserialize(deserializer)?;
        Self::new(wire.entries).map_err(serde::de::Error::custom)
    }
}

/// One capability classification and its required oracle observations.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CapabilityEntry {
    pub subject: CapabilitySubject,
    pub status: CapabilityStatus,
    pub required_positive_cases: Vec<String>,
    pub required_edge_cases: Vec<String>,
}

impl<'de> Deserialize<'de> for CapabilityEntry {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct CapabilityEntryWire {
            subject: CapabilitySubjectWire,
            status: CapabilityStatus,
            required_positive_cases: Vec<String>,
            required_edge_cases: Vec<String>,
        }

        let wire = CapabilityEntryWire::deserialize(deserializer)?;
        Ok(Self {
            subject: wire.subject.into_subject(),
            status: wire.status,
            required_positive_cases: wire.required_positive_cases,
            required_edge_cases: wire.required_edge_cases,
        })
    }
}

/// Errors raised when a capability manifest is malformed or not exact.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CapabilityManifestError {
    #[error("capability schema version is {actual}, expected {expected}")]
    SchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("capability oracle SHA is {actual}, expected {expected}")]
    OracleGameShaMismatch {
        expected: &'static str,
        actual: String,
    },
    #[error("expected {expected} capability entries, found {actual}")]
    WrongLength { expected: usize, actual: usize },
    #[error("capability entries are not sorted at index {index}")]
    Unsorted { index: usize },
    #[error("capability subject is duplicated at index {index}: {subject:?}")]
    DuplicateSubject {
        index: usize,
        subject: CapabilitySubject,
    },
    #[error("supported capability {subject:?} must have positive and edge cases")]
    MissingCoverage { subject: CapabilitySubject },
    #[error("unsupported capability {subject:?} may not claim fixture cases")]
    UnsupportedClaims { subject: CapabilitySubject },
    #[error("capability manifest does not match the frozen selected manifest")]
    DefinitionMismatch,
}

/// The complete selected capability manifest.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CapabilityManifest {
    pub schema_version: u32,
    pub oracle_game_sha: String,
    pub entries: Vec<CapabilityEntry>,
}

impl CapabilityManifest {
    /// Constructs and validates the exact selected capability manifest.
    pub fn new(
        schema_version: u32,
        oracle_game_sha: String,
        entries: Vec<CapabilityEntry>,
    ) -> Result<Self, CapabilityManifestError> {
        let manifest = Self {
            schema_version,
            oracle_game_sha,
            entries,
        };
        manifest.validate()?;
        Ok(manifest)
    }

    /// Validates metadata, canonical subject order, coverage, and exact cases.
    pub fn validate(&self) -> Result<(), CapabilityManifestError> {
        if self.schema_version != SELECTED_SCHEMA_VERSION {
            return Err(CapabilityManifestError::SchemaVersionMismatch {
                expected: SELECTED_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.oracle_game_sha != ORACLE_GAME_SHA {
            return Err(CapabilityManifestError::OracleGameShaMismatch {
                expected: ORACLE_GAME_SHA,
                actual: self.oracle_game_sha.clone(),
            });
        }

        let expected = canonical_capability_entries();
        if self.entries.len() != expected.len() {
            return Err(CapabilityManifestError::WrongLength {
                expected: expected.len(),
                actual: self.entries.len(),
            });
        }

        for (index, entry) in self.entries.iter().enumerate() {
            if let Some(previous) = index.checked_sub(1).and_then(|i| self.entries.get(i)) {
                if entry.subject == previous.subject {
                    return Err(CapabilityManifestError::DuplicateSubject {
                        index,
                        subject: entry.subject.clone(),
                    });
                }
                if entry.subject < previous.subject {
                    return Err(CapabilityManifestError::Unsorted { index });
                }
            }

            match &entry.status {
                CapabilityStatus::Supported => {
                    if entry.required_positive_cases.is_empty()
                        || entry.required_edge_cases.is_empty()
                    {
                        return Err(CapabilityManifestError::MissingCoverage {
                            subject: entry.subject.clone(),
                        });
                    }
                }
                CapabilityStatus::Unsupported { .. }
                    if !entry.required_positive_cases.is_empty()
                        || !entry.required_edge_cases.is_empty() =>
                {
                    return Err(CapabilityManifestError::UnsupportedClaims {
                        subject: entry.subject.clone(),
                    });
                }
                CapabilityStatus::Unsupported { .. } => {}
            }
        }

        if self.entries != expected {
            return Err(CapabilityManifestError::DefinitionMismatch);
        }
        Ok(())
    }

    /// Looks up an entry in an already canonical manifest.
    pub fn find(&self, subject: &CapabilitySubject) -> Option<&CapabilityEntry> {
        self.entries
            .binary_search_by(|entry| entry.subject.cmp(subject))
            .ok()
            .and_then(|index| self.entries.get(index))
    }
}

impl<'de> Deserialize<'de> for CapabilityManifest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct CapabilityManifestWire {
            schema_version: u32,
            oracle_game_sha: String,
            entries: Vec<CapabilityEntry>,
        }

        let wire = CapabilityManifestWire::deserialize(deserializer)?;
        Self::new(wire.schema_version, wire.oracle_game_sha, wire.entries)
            .map_err(serde::de::Error::custom)
    }
}

/// Returns the fully validated selected content pack.
pub fn selected_content_pack() -> Result<ContentPack, ContentPackError> {
    ContentPack::new(
        SELECTED_SCHEMA_VERSION,
        ORACLE_GAME_SHA.to_owned(),
        species_definitions(),
        move_definitions(),
        ability_definitions(),
        selected_type_chart(),
        selected_capability_manifest(),
    )
}

/// Returns the exact selected non-neutral type chart.
pub fn selected_type_chart() -> TypeChart {
    TypeChart {
        entries: canonical_type_chart_entries(),
    }
}

/// Returns the exact selected capability manifest.
pub fn selected_capability_manifest() -> CapabilityManifest {
    CapabilityManifest {
        schema_version: SELECTED_SCHEMA_VERSION,
        oracle_game_sha: ORACLE_GAME_SHA.to_owned(),
        entries: canonical_capability_entries(),
    }
}

fn validate_pack_fields(
    schema_version: u32,
    oracle_game_sha: &str,
    species: &[SpeciesDefinition],
    moves: &[MoveDefinition],
    abilities: &[AbilityDefinition],
    type_chart: &TypeChart,
    capability_manifest: &CapabilityManifest,
) -> Result<(), ContentPackError> {
    if schema_version != SELECTED_SCHEMA_VERSION {
        return Err(ContentPackError::SchemaVersionMismatch {
            expected: SELECTED_SCHEMA_VERSION,
            actual: schema_version,
        });
    }
    if oracle_game_sha != ORACLE_GAME_SHA {
        return Err(ContentPackError::OracleGameShaMismatch {
            expected: ORACLE_GAME_SHA,
            actual: oracle_game_sha.to_owned(),
        });
    }
    validate_selected_species(species).map_err(ContentPackError::Species)?;
    validate_selected_moves(moves).map_err(ContentPackError::Moves)?;
    validate_selected_abilities(abilities).map_err(ContentPackError::Abilities)?;
    type_chart.validate().map_err(ContentPackError::TypeChart)?;
    capability_manifest
        .validate()
        .map_err(ContentPackError::CapabilityManifest)?;
    Ok(())
}

#[derive(Serialize)]
struct ContentPackHashView<'a> {
    schema_version: u32,
    oracle_game_sha: &'a str,
    species: &'a [SpeciesDefinition],
    moves: &'a [MoveDefinition],
    abilities: &'a [AbilityDefinition],
    type_chart: &'a TypeChart,
    capability_manifest: &'a CapabilityManifest,
}

fn hash_for_parts(
    schema_version: u32,
    oracle_game_sha: &str,
    species: &[SpeciesDefinition],
    moves: &[MoveDefinition],
    abilities: &[AbilityDefinition],
    type_chart: &TypeChart,
    capability_manifest: &CapabilityManifest,
) -> Result<ContentPackHash, ContentPackError> {
    let view = ContentPackHashView {
        schema_version,
        oracle_game_sha,
        species,
        moves,
        abilities,
        type_chart,
        capability_manifest,
    };
    let raw_hash = content_digest(&view).map_err(ContentPackError::Canonical)?;
    ContentPackHash::new(format!("{}{}", ContentPackHash::PREFIX, raw_hash))
        .map_err(ContentPackError::InvalidHash)
}

fn canonical_type_chart_entries() -> Vec<TypeChartEntry> {
    vec![
        TypeChartEntry {
            attack: PokemonType::Fire,
            defense: PokemonType::Water,
            multiplier: SingleTypeMultiplier::Half,
        },
        TypeChartEntry {
            attack: PokemonType::Fire,
            defense: PokemonType::Grass,
            multiplier: SingleTypeMultiplier::Two,
        },
        TypeChartEntry {
            attack: PokemonType::Electric,
            defense: PokemonType::Water,
            multiplier: SingleTypeMultiplier::Two,
        },
        TypeChartEntry {
            attack: PokemonType::Electric,
            defense: PokemonType::Grass,
            multiplier: SingleTypeMultiplier::Half,
        },
        TypeChartEntry {
            attack: PokemonType::Electric,
            defense: PokemonType::Ground,
            multiplier: SingleTypeMultiplier::Zero,
        },
        TypeChartEntry {
            attack: PokemonType::Grass,
            defense: PokemonType::Water,
            multiplier: SingleTypeMultiplier::Two,
        },
        TypeChartEntry {
            attack: PokemonType::Grass,
            defense: PokemonType::Grass,
            multiplier: SingleTypeMultiplier::Half,
        },
        TypeChartEntry {
            attack: PokemonType::Grass,
            defense: PokemonType::Poison,
            multiplier: SingleTypeMultiplier::Half,
        },
        TypeChartEntry {
            attack: PokemonType::Grass,
            defense: PokemonType::Ground,
            multiplier: SingleTypeMultiplier::Two,
        },
        TypeChartEntry {
            attack: PokemonType::Poison,
            defense: PokemonType::Grass,
            multiplier: SingleTypeMultiplier::Two,
        },
        TypeChartEntry {
            attack: PokemonType::Poison,
            defense: PokemonType::Poison,
            multiplier: SingleTypeMultiplier::Half,
        },
        TypeChartEntry {
            attack: PokemonType::Poison,
            defense: PokemonType::Ground,
            multiplier: SingleTypeMultiplier::Half,
        },
    ]
}

fn canonical_capability_entries() -> Vec<CapabilityEntry> {
    vec![
        capability_entry(
            CapabilitySubject::Move(move_id(1)),
            supported(),
            &["physical-hit"],
            &["critical-hit", "pp-unusable-rejected"],
        ),
        capability_entry(
            CapabilitySubject::Move(move_id(52)),
            supported(),
            &["burn-application"],
            &["burn-residual", "burn-physical-penalty"],
        ),
        capability_entry(
            CapabilitySubject::Move(move_id(77)),
            supported(),
            &["poison-application"],
            &[
                "miss",
                "poison-type-immunity",
                "grass-powder-immunity",
                "existing-status-rejected",
            ],
        ),
        capability_entry(
            CapabilitySubject::Move(move_id(78)),
            supported(),
            &["paralysis-application"],
            &[
                "paralysis-full-stop",
                "paralysis-speed-order",
                "grass-powder-immunity",
            ],
        ),
        capability_entry(
            CapabilitySubject::Move(move_id(351)),
            supported(),
            &["special-hit-priority"],
            &["always-hit", "wonder-guard-block"],
        ),
        capability_entry(
            CapabilitySubject::Move(move_id(589)),
            supported(),
            &["spread-stage-down"],
            &["stage-floor-cap"],
        ),
        capability_entry(
            CapabilitySubject::Ability(ability_id(0)),
            supported(),
            &["none-ability-no-trigger"],
            &["physical-hit"],
        ),
        capability_entry(
            CapabilitySubject::Ability(ability_id(22)),
            supported(),
            &["intimidate-switch-in"],
            &["intimidate-stage-floor"],
        ),
        capability_entry(
            CapabilitySubject::Ability(ability_id(25)),
            supported(),
            &["wonder-guard-block"],
            &["wonder-guard-super-effective-pass", "wonder-guard-status-pass"],
        ),
        capability_entry(
            CapabilitySubject::Status(StatusKind::Poison),
            supported(),
            &["poison-application"],
            &["poison-residual"],
        ),
        capability_entry(
            CapabilitySubject::Status(StatusKind::Paralysis),
            supported(),
            &["paralysis-application"],
            &["paralysis-full-stop", "paralysis-speed-order"],
        ),
        capability_entry(
            CapabilitySubject::Status(StatusKind::Burn),
            supported(),
            &["burn-application"],
            &["burn-residual", "burn-physical-penalty"],
        ),
        capability_entry(
            CapabilitySubject::Weather(WeatherKind::None),
            supported(),
            &["physical-hit"],
            &["special-hit-priority"],
        ),
        capability_entry(
            CapabilitySubject::Terrain(TerrainKind::None),
            supported(),
            &["physical-hit"],
            &["spread-stage-down"],
        ),
    ]
}

fn capability_entry(
    subject: CapabilitySubject,
    status: CapabilityStatus,
    positive: &[&str],
    edge: &[&str],
) -> CapabilityEntry {
    CapabilityEntry {
        subject,
        status,
        required_positive_cases: positive.iter().map(|case| (*case).to_owned()).collect(),
        required_edge_cases: edge.iter().map(|case| (*case).to_owned()).collect(),
    }
}

fn move_id(value: u64) -> MoveId {
    MoveId::try_from(value).unwrap_or(MoveId::ZERO)
}

fn ability_id(value: u64) -> AbilityId {
    AbilityId::try_from(value).unwrap_or(AbilityId::ZERO)
}

fn supported() -> CapabilityStatus {
    CapabilityStatus::Supported
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
enum CapabilitySubjectWire {
    Move(MoveId),
    Ability(AbilityId),
    Status(StatusKind),
    Weather(WeatherKind),
    Terrain(TerrainKind),
    ArenaCondition(ArenaConditionId),
}

impl CapabilitySubjectWire {
    fn into_subject(self) -> CapabilitySubject {
        match self {
            Self::Move(id) => CapabilitySubject::Move(id),
            Self::Ability(id) => CapabilitySubject::Ability(id),
            Self::Status(kind) => CapabilitySubject::Status(kind),
            Self::Weather(kind) => CapabilitySubject::Weather(kind),
            Self::Terrain(kind) => CapabilitySubject::Terrain(kind),
            Self::ArenaCondition(id) => CapabilitySubject::ArenaCondition(id),
        }
    }
}
