//! M3A-04 owns the selected ability definitions and their closed effect vocabulary.

use er_types::battle_ids::AbilityId;
use er_types::battle_model::{AbilityEffectDefinition, CapabilityStatus};
use er_types::ids::SafeU53;
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

/// The selected ability IDs, in their canonical serialization and lookup order.
pub const SELECTED_ABILITY_IDS: [AbilityId; 3] = [
    selected_ability_id(0),
    selected_ability_id(22),
    selected_ability_id(25),
];

/// Errors raised when a selected ability definition is malformed or unsupported.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AbilityDefinitionError {
    #[error("ability {id} is outside the selected M3 content slice")]
    UnsupportedId { id: AbilityId },
    #[error("ability {id} is not capability-supported")]
    UnsupportedCapability { id: AbilityId },
    #[error("ability {id} uses an unsupported effect {effect:?}")]
    UnsupportedEffect {
        id: AbilityId,
        effect: AbilityEffectDefinition,
    },
    #[error("ability {id} does not match the frozen selected definition")]
    DefinitionMismatch { id: AbilityId },
}

/// Errors raised when an ability lookup cannot admit an ID.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AbilityLookupError {
    #[error("ability {id} is outside the selected M3 content slice")]
    UnsupportedId { id: AbilityId },
}

/// Errors raised when an ability collection is not the canonical selected slice.
#[derive(Debug, Error, PartialEq)]
pub enum AbilityCollectionError {
    #[error("expected {expected} selected abilities, found {actual}")]
    WrongLength { expected: usize, actual: usize },
    #[error("selected ability at index {index} is invalid: {error}")]
    InvalidDefinition {
        index: usize,
        #[source]
        error: AbilityDefinitionError,
    },
    #[error("selected ability at index {index} has ID {actual}, expected {expected}")]
    WrongOrder {
        index: usize,
        actual: AbilityId,
        expected: AbilityId,
    },
}

/// One immutable selected ability definition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AbilityDefinition {
    pub id: AbilityId,
    pub effect: AbilityEffectDefinition,
    pub capability: CapabilityStatus,
}

impl AbilityDefinition {
    /// Constructs and validates one exact selected ability definition.
    pub fn new(
        id: AbilityId,
        effect: AbilityEffectDefinition,
        capability: CapabilityStatus,
    ) -> Result<Self, AbilityDefinitionError> {
        let definition = Self {
            id,
            effect,
            capability,
        };
        definition.validate()?;
        Ok(definition)
    }

    /// Validates IDs, capability closure, and exact selected data.
    pub fn validate(&self) -> Result<(), AbilityDefinitionError> {
        let Some(expected) = canonical_ability_for_wire(self.id) else {
            return Err(AbilityDefinitionError::UnsupportedId { id: self.id });
        };

        if !matches!(&self.capability, CapabilityStatus::Supported) {
            return Err(AbilityDefinitionError::UnsupportedCapability { id: self.id });
        }

        if !matches!(
            self.effect,
            AbilityEffectDefinition::None
                | AbilityEffectDefinition::PostSummonAdjacentOpponentAttackMinusOne
                | AbilityEffectDefinition::NonSuperEffectiveAttackImmunity
                | AbilityEffectDefinition::MentalEffectImmunity
        ) {
            return Err(AbilityDefinitionError::UnsupportedEffect {
                id: self.id,
                effect: self.effect,
            });
        }

        if *self != expected {
            return Err(AbilityDefinitionError::DefinitionMismatch { id: self.id });
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for AbilityDefinition {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct AbilityDefinitionWire {
            id: AbilityId,
            effect: AbilityEffectDefinition,
            capability: CapabilityStatus,
        }

        let wire = AbilityDefinitionWire::deserialize(deserializer)?;
        Self::new(wire.id, wire.effect, wire.capability).map_err(serde::de::Error::custom)
    }
}

/// Returns whether an ID belongs to the selected ability slice.
pub fn is_selected_ability(id: AbilityId) -> bool {
    SELECTED_ABILITY_IDS.contains(&id)
}

/// Returns the selected ability definitions in canonical ascending-ID order.
pub fn selected_ability_definitions() -> Vec<AbilityDefinition> {
    vec![none(), intimidate(), wonder_guard()]
}

/// Alias for callers constructing the immutable selected content pack.
pub fn ability_definitions() -> Vec<AbilityDefinition> {
    selected_ability_definitions()
}

/// Looks up a selected ability by ID and rejects every outside-slice ID.
pub fn lookup_ability(id: AbilityId) -> Result<AbilityDefinition, AbilityLookupError> {
    canonical_ability(id).ok_or(AbilityLookupError::UnsupportedId { id })
}

/// Alias preserving the full definition-oriented lookup name.
pub fn lookup_ability_definition(id: AbilityId) -> Result<AbilityDefinition, AbilityLookupError> {
    lookup_ability(id)
}

/// Looks up an ability in an already canonical, ascending-ID collection.
pub fn find_ability(
    definitions: &[AbilityDefinition],
    id: AbilityId,
) -> Result<&AbilityDefinition, AbilityLookupError> {
    definitions
        .binary_search_by_key(&id, |definition| definition.id)
        .map(|index| &definitions[index])
        .map_err(|_| AbilityLookupError::UnsupportedId { id })
}

/// Validates the complete selected ability collection and its deterministic order.
pub fn validate_selected_abilities(
    definitions: &[AbilityDefinition],
) -> Result<(), AbilityCollectionError> {
    if definitions.len() != SELECTED_ABILITY_IDS.len() {
        return Err(AbilityCollectionError::WrongLength {
            expected: SELECTED_ABILITY_IDS.len(),
            actual: definitions.len(),
        });
    }

    for (index, (definition, expected)) in definitions
        .iter()
        .zip(SELECTED_ABILITY_IDS.iter().copied())
        .enumerate()
    {
        definition
            .validate()
            .map_err(|error| AbilityCollectionError::InvalidDefinition { index, error })?;
        if definition.id != expected {
            return Err(AbilityCollectionError::WrongOrder {
                index,
                actual: definition.id,
                expected,
            });
        }
    }
    Ok(())
}

fn canonical_ability(id: AbilityId) -> Option<AbilityDefinition> {
    match u64::from(id) {
        0 => Some(none()),
        22 => Some(intimidate()),
        25 => Some(wonder_guard()),
        _ => None,
    }
}

fn canonical_ability_for_wire(id: AbilityId) -> Option<AbilityDefinition> {
    canonical_ability(id).or_else(|| match u64::from(id) {
        165 => Some(aroma_veil()),
        _ => None,
    })
}

const fn selected_ability_id(value: u64) -> AbilityId {
    match SafeU53::new(value) {
        Ok(value) => AbilityId::new(value),
        Err(_) => AbilityId::ZERO,
    }
}

fn ability_id(value: u64) -> AbilityId {
    selected_ability_id(value)
}

fn supported() -> CapabilityStatus {
    CapabilityStatus::Supported
}

fn none() -> AbilityDefinition {
    AbilityDefinition {
        id: ability_id(0),
        effect: AbilityEffectDefinition::None,
        capability: supported(),
    }
}

fn intimidate() -> AbilityDefinition {
    AbilityDefinition {
        id: ability_id(22),
        effect: AbilityEffectDefinition::PostSummonAdjacentOpponentAttackMinusOne,
        capability: supported(),
    }
}

fn wonder_guard() -> AbilityDefinition {
    AbilityDefinition {
        id: ability_id(25),
        effect: AbilityEffectDefinition::NonSuperEffectiveAttackImmunity,
        capability: supported(),
    }
}

pub(crate) fn aroma_veil() -> AbilityDefinition {
    AbilityDefinition {
        id: ability_id(165),
        effect: AbilityEffectDefinition::MentalEffectImmunity,
        capability: supported(),
    }
}
