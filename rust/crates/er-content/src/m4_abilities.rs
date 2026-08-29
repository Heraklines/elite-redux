use crate::abilities::{AbilityDefinition, ability_definitions, aroma_veil};
use er_types::battle_ids::AbilityId;
use thiserror::Error;

pub const SELECTED_M4_ABILITY_IDS: [u64; 4] = [0, 22, 25, 165];

#[derive(Debug, Error)]
pub enum M4AbilityCollectionError {
    #[error("expected {expected} selected M4 abilities, found {actual}")]
    WrongLength { expected: usize, actual: usize },
    #[error("selected M4 ability at index {index} has ID {actual}, expected {expected}")]
    WrongOrder {
        index: usize,
        actual: AbilityId,
        expected: u64,
    },
    #[error("selected M4 ability at index {index} is invalid: {reason}")]
    InvalidDefinition { index: usize, reason: String },
}

pub fn selected_m4_ability_definitions() -> Vec<AbilityDefinition> {
    let mut definitions = ability_definitions();
    definitions.push(aroma_veil());
    definitions
}

pub fn validate_selected_m4_abilities(
    definitions: &[AbilityDefinition],
) -> Result<(), M4AbilityCollectionError> {
    if definitions.len() != SELECTED_M4_ABILITY_IDS.len() {
        return Err(M4AbilityCollectionError::WrongLength {
            expected: SELECTED_M4_ABILITY_IDS.len(),
            actual: definitions.len(),
        });
    }
    for (index, (definition, expected)) in
        definitions.iter().zip(SELECTED_M4_ABILITY_IDS).enumerate()
    {
        definition
            .validate()
            .map_err(|error| M4AbilityCollectionError::InvalidDefinition {
                index,
                reason: error.to_string(),
            })?;
        if definition.id.get().get() != expected {
            return Err(M4AbilityCollectionError::WrongOrder {
                index,
                actual: definition.id,
                expected,
            });
        }
    }
    Ok(())
}
