//! M3A-03 owns the selected species definitions.

use er_types::battle_ids::SpeciesId;
use er_types::battle_model::{CapabilityStatus, PokemonType, PokemonTyping};
use er_types::ids::SafeU53;
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

/// The selected species IDs, in canonical ascending-ID order.
pub const SELECTED_SPECIES_IDS: [SpeciesId; 6] = [
    selected_species_id(1),
    selected_species_id(7),
    selected_species_id(19),
    selected_species_id(23),
    selected_species_id(50),
    selected_species_id(52),
];

/// The immutable base stats for one selected species.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpeciesBaseStats {
    pub hp: u32,
    pub attack: u32,
    pub defense: u32,
    pub special_attack: u32,
    pub special_defense: u32,
    pub speed: u32,
}

/// Errors raised when a selected species definition is malformed.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SpeciesDefinitionError {
    #[error("species {id} is outside the selected M3 content slice")]
    UnsupportedId { id: SpeciesId },
    #[error("species {id} is not capability-supported")]
    UnsupportedCapability { id: SpeciesId },
    #[error("species {id} does not match the frozen selected definition")]
    DefinitionMismatch { id: SpeciesId },
}

/// Errors raised when a species lookup cannot admit an ID.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SpeciesLookupError {
    #[error("species {id} is outside the selected M3 content slice")]
    UnsupportedId { id: SpeciesId },
}

/// Errors raised when a collection is not the canonical selected species slice.
#[derive(Debug, Error, PartialEq)]
pub enum SpeciesCollectionError {
    #[error("expected {expected} selected species, found {actual}")]
    WrongLength { expected: usize, actual: usize },
    #[error("selected species at index {index} is invalid: {error}")]
    InvalidDefinition {
        index: usize,
        #[source]
        error: SpeciesDefinitionError,
    },
    #[error("selected species at index {index} has ID {actual}, expected {expected}")]
    WrongOrder {
        index: usize,
        actual: SpeciesId,
        expected: SpeciesId,
    },
}

/// One immutable selected species definition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SpeciesDefinition {
    pub id: SpeciesId,
    pub base_types: PokemonTyping,
    pub base_stats: SpeciesBaseStats,
    pub capability: CapabilityStatus,
}

impl SpeciesDefinition {
    /// Constructs and validates one exact selected species definition.
    pub fn new(
        id: SpeciesId,
        base_types: PokemonTyping,
        base_stats: SpeciesBaseStats,
        capability: CapabilityStatus,
    ) -> Result<Self, SpeciesDefinitionError> {
        let definition = Self {
            id,
            base_types,
            base_stats,
            capability,
        };
        definition.validate()?;
        Ok(definition)
    }

    /// Validates the selected ID, capability closure, and exact oracle data.
    pub fn validate(&self) -> Result<(), SpeciesDefinitionError> {
        let Some(expected) = canonical_species_for_wire(self.id) else {
            return Err(SpeciesDefinitionError::UnsupportedId { id: self.id });
        };
        if !matches!(&self.capability, CapabilityStatus::Supported) {
            return Err(SpeciesDefinitionError::UnsupportedCapability { id: self.id });
        }
        if *self != expected {
            return Err(SpeciesDefinitionError::DefinitionMismatch { id: self.id });
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for SpeciesDefinition {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct SpeciesDefinitionWire {
            id: SpeciesId,
            base_types: PokemonTyping,
            base_stats: SpeciesBaseStats,
            capability: CapabilityStatus,
        }

        let wire = SpeciesDefinitionWire::deserialize(deserializer)?;
        Self::new(wire.id, wire.base_types, wire.base_stats, wire.capability)
            .map_err(serde::de::Error::custom)
    }
}

/// Returns whether an ID belongs to the selected species slice.
pub fn is_selected_species(id: SpeciesId) -> bool {
    SELECTED_SPECIES_IDS.contains(&id)
}

/// Returns the selected species definitions in canonical ascending-ID order.
pub fn selected_species_definitions() -> Vec<SpeciesDefinition> {
    vec![
        bulbasaur(),
        squirtle(),
        rattata(),
        ekans(),
        diglett(),
        meowth(),
    ]
}

/// Alias for callers constructing the immutable selected content pack.
pub fn species_definitions() -> Vec<SpeciesDefinition> {
    selected_species_definitions()
}

/// Looks up a selected species by ID and rejects every outside-slice ID.
pub fn lookup_species(id: SpeciesId) -> Result<SpeciesDefinition, SpeciesLookupError> {
    canonical_species(id).ok_or(SpeciesLookupError::UnsupportedId { id })
}

/// Alias preserving the full definition-oriented lookup name.
pub fn lookup_species_definition(id: SpeciesId) -> Result<SpeciesDefinition, SpeciesLookupError> {
    lookup_species(id)
}

/// Looks up a species in an already canonical, ascending-ID collection.
pub fn find_species(
    definitions: &[SpeciesDefinition],
    id: SpeciesId,
) -> Result<&SpeciesDefinition, SpeciesLookupError> {
    definitions
        .binary_search_by_key(&id, |definition| definition.id)
        .map(|index| &definitions[index])
        .map_err(|_| SpeciesLookupError::UnsupportedId { id })
}

/// Validates the complete selected species collection and its deterministic order.
pub fn validate_selected_species(
    definitions: &[SpeciesDefinition],
) -> Result<(), SpeciesCollectionError> {
    if definitions.len() != SELECTED_SPECIES_IDS.len() {
        return Err(SpeciesCollectionError::WrongLength {
            expected: SELECTED_SPECIES_IDS.len(),
            actual: definitions.len(),
        });
    }

    for (index, (definition, expected)) in definitions
        .iter()
        .zip(SELECTED_SPECIES_IDS.iter().copied())
        .enumerate()
    {
        definition
            .validate()
            .map_err(|error| SpeciesCollectionError::InvalidDefinition { index, error })?;
        if definition.id != expected {
            return Err(SpeciesCollectionError::WrongOrder {
                index,
                actual: definition.id,
                expected,
            });
        }
    }
    Ok(())
}

fn canonical_species(id: SpeciesId) -> Option<SpeciesDefinition> {
    match u64::from(id) {
        1 => Some(bulbasaur()),
        7 => Some(squirtle()),
        19 => Some(rattata()),
        23 => Some(ekans()),
        50 => Some(diglett()),
        52 => Some(meowth()),
        _ => None,
    }
}

fn canonical_species_for_wire(id: SpeciesId) -> Option<SpeciesDefinition> {
    canonical_species(id).or_else(|| match u64::from(id) {
        932 => Some(nacli()),
        _ => None,
    })
}

const fn selected_species_id(value: u64) -> SpeciesId {
    match SafeU53::new(value) {
        Ok(value) => SpeciesId::new(value),
        Err(_) => SpeciesId::ZERO,
    }
}

fn species_id(value: u64) -> SpeciesId {
    selected_species_id(value)
}

fn supported() -> CapabilityStatus {
    CapabilityStatus::Supported
}

fn bulbasaur() -> SpeciesDefinition {
    SpeciesDefinition {
        id: species_id(1),
        base_types: PokemonTyping {
            primary: PokemonType::Grass,
            secondary: Some(PokemonType::Poison),
        },
        base_stats: SpeciesBaseStats {
            hp: 47,
            attack: 49,
            defense: 49,
            special_attack: 65,
            special_defense: 65,
            speed: 45,
        },
        capability: supported(),
    }
}

fn squirtle() -> SpeciesDefinition {
    SpeciesDefinition {
        id: species_id(7),
        base_types: PokemonTyping {
            primary: PokemonType::Water,
            secondary: None,
        },
        base_stats: SpeciesBaseStats {
            hp: 50,
            attack: 48,
            defense: 65,
            special_attack: 50,
            special_defense: 64,
            speed: 43,
        },
        capability: supported(),
    }
}

fn rattata() -> SpeciesDefinition {
    SpeciesDefinition {
        id: species_id(19),
        base_types: PokemonTyping {
            primary: PokemonType::Normal,
            secondary: None,
        },
        base_stats: SpeciesBaseStats {
            hp: 30,
            attack: 56,
            defense: 35,
            special_attack: 25,
            special_defense: 35,
            speed: 72,
        },
        capability: supported(),
    }
}

fn ekans() -> SpeciesDefinition {
    SpeciesDefinition {
        id: species_id(23),
        base_types: PokemonTyping {
            primary: PokemonType::Poison,
            secondary: None,
        },
        base_stats: SpeciesBaseStats {
            hp: 55,
            attack: 60,
            defense: 49,
            special_attack: 40,
            special_defense: 59,
            speed: 55,
        },
        capability: supported(),
    }
}

fn diglett() -> SpeciesDefinition {
    SpeciesDefinition {
        id: species_id(50),
        base_types: PokemonTyping {
            primary: PokemonType::Ground,
            secondary: None,
        },
        base_stats: SpeciesBaseStats {
            hp: 10,
            attack: 55,
            defense: 25,
            special_attack: 35,
            special_defense: 45,
            speed: 95,
        },
        capability: supported(),
    }
}

fn meowth() -> SpeciesDefinition {
    SpeciesDefinition {
        id: species_id(52),
        base_types: PokemonTyping {
            primary: PokemonType::Normal,
            secondary: None,
        },
        base_stats: SpeciesBaseStats {
            hp: 40,
            attack: 55,
            defense: 35,
            special_attack: 65,
            special_defense: 40,
            speed: 90,
        },
        capability: supported(),
    }
}

pub(crate) fn nacli() -> SpeciesDefinition {
    SpeciesDefinition {
        id: species_id(932),
        base_types: PokemonTyping {
            primary: PokemonType::Rock,
            secondary: None,
        },
        base_stats: SpeciesBaseStats {
            hp: 55,
            attack: 55,
            defense: 75,
            special_attack: 35,
            special_defense: 35,
            speed: 25,
        },
        capability: supported(),
    }
}
