use crate::species::{SpeciesDefinition, lechonk, nacli, species_definitions};
use er_types::battle_ids::SpeciesId;
use thiserror::Error;

pub const SELECTED_M4_SPECIES_IDS: [u64; 8] = [1, 7, 19, 23, 50, 52, 915, 932];

#[derive(Debug, Error)]
pub enum M4SpeciesCollectionError {
    #[error("expected {expected} selected M4 species, found {actual}")]
    WrongLength { expected: usize, actual: usize },
    #[error("selected M4 species at index {index} has ID {actual}, expected {expected}")]
    WrongOrder {
        index: usize,
        actual: SpeciesId,
        expected: u64,
    },
    #[error("selected M4 species at index {index} is invalid: {reason}")]
    InvalidDefinition { index: usize, reason: String },
}

pub fn selected_m4_species_definitions() -> Vec<SpeciesDefinition> {
    let mut definitions = species_definitions();
    definitions.push(lechonk());
    definitions.push(nacli());
    definitions
}

pub fn validate_selected_m4_species(
    definitions: &[SpeciesDefinition],
) -> Result<(), M4SpeciesCollectionError> {
    if definitions.len() != SELECTED_M4_SPECIES_IDS.len() {
        return Err(M4SpeciesCollectionError::WrongLength {
            expected: SELECTED_M4_SPECIES_IDS.len(),
            actual: definitions.len(),
        });
    }
    for (index, (definition, expected)) in
        definitions.iter().zip(SELECTED_M4_SPECIES_IDS).enumerate()
    {
        definition
            .validate()
            .map_err(|error| M4SpeciesCollectionError::InvalidDefinition {
                index,
                reason: error.to_string(),
            })?;
        if definition.id.get().get() != expected {
            return Err(M4SpeciesCollectionError::WrongOrder {
                index,
                actual: definition.id,
                expected,
            });
        }
    }
    Ok(())
}
