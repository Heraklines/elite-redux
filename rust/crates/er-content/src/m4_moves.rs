use er_types::battle_ids::MoveId;
use er_types::battle_model::{
    CapabilityStatus, EffectChance, MoveAccuracy, MoveCategory, MoveEffectDefinition, MoveFlag,
    MovePower, MoveTarget, PokemonType, StatusKind,
};
use er_types::ids::SafeU53;
use thiserror::Error;

use crate::moves::selected_move_definitions;

/// The M4 battle move IDs in canonical ascending serialization order.
pub const SELECTED_M4_MOVE_IDS: [MoveId; 7] = [
    m4_move_id(1),
    m4_move_id(34),
    m4_move_id(52),
    m4_move_id(77),
    m4_move_id(78),
    m4_move_id(351),
    m4_move_id(589),
];

/// Errors raised when the exact M4 move closure is malformed.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum M4MoveCollectionError {
    #[error("expected {expected} selected M4 moves, found {actual}")]
    WrongLength { expected: usize, actual: usize },
    #[error("selected M4 move at index {index} is not the exact Body Slam 34 definition")]
    BodySlamDefinitionMismatch { index: usize },
    #[error("selected M4 move at index {index} has ID {actual}, expected {expected}")]
    WrongOrder {
        index: usize,
        actual: MoveId,
        expected: MoveId,
    },
    #[error("selected M3 move at index {index} is invalid while validating M4")]
    InvalidM3Definition { index: usize },
}

/// The exact post-initialization Body Slam 34 mapping from the M4 oracle.
///
/// The live oracle also attaches `AlwaysHitMinimizeAttr` and
/// `HitsTagForDoubleDamageAttr`. M4's canonical battle state has no Minimize
/// battler-tag vocabulary, so those attributes are structurally unreachable in
/// the representable state. The representable mapping remains exactly DAMAGE
/// plus 30% PARALYSIS; deserialization rejects any external tag-state effect.
pub fn body_slam_34() -> crate::moves::MoveDefinition {
    crate::moves::MoveDefinition {
        id: m4_move_id(34),
        category: MoveCategory::Physical,
        move_type: PokemonType::Normal,
        power: MovePower::Value(85),
        accuracy: MoveAccuracy::Percent(100),
        base_pp: 15,
        effect_chance: EffectChance::Percent(30),
        priority: 0,
        target: MoveTarget::NearOther,
        flags: vec![MoveFlag::Contact],
        effects: vec![
            MoveEffectDefinition::Damage,
            MoveEffectDefinition::ApplyStatus(StatusKind::Paralysis),
        ],
        capability: CapabilityStatus::Supported,
    }
}

/// Returns the M3 move closure plus Body Slam, without mutating the M3 vector.
pub fn selected_m4_move_definitions() -> Vec<crate::moves::MoveDefinition> {
    let body_slam = body_slam_34();
    let m3_definitions = selected_move_definitions();
    let mut definitions = Vec::with_capacity(SELECTED_M4_MOVE_IDS.len());
    let mut inserted = false;
    for definition in m3_definitions {
        if !inserted && body_slam.id < definition.id {
            definitions.push(body_slam.clone());
            inserted = true;
        }
        definitions.push(definition);
    }
    if !inserted {
        definitions.push(body_slam);
    }
    definitions
}

/// Validates the exact M4 move closure and canonical ID order.
pub fn validate_selected_m4_moves(
    definitions: &[crate::moves::MoveDefinition],
) -> Result<(), M4MoveCollectionError> {
    if definitions.len() != SELECTED_M4_MOVE_IDS.len() {
        return Err(M4MoveCollectionError::WrongLength {
            expected: SELECTED_M4_MOVE_IDS.len(),
            actual: definitions.len(),
        });
    }

    let body_slam = body_slam_34();
    for (index, (definition, expected)) in definitions
        .iter()
        .zip(SELECTED_M4_MOVE_IDS.iter().copied())
        .enumerate()
    {
        if definition.id != expected {
            return Err(M4MoveCollectionError::WrongOrder {
                index,
                actual: definition.id,
                expected,
            });
        }
        if definition.id == body_slam.id {
            if definition != &body_slam {
                return Err(M4MoveCollectionError::BodySlamDefinitionMismatch { index });
            }
        } else if definition.validate().is_err() {
            return Err(M4MoveCollectionError::InvalidM3Definition { index });
        }
    }
    Ok(())
}

const fn m4_move_id(value: u64) -> MoveId {
    match SafeU53::new(value) {
        Ok(value) => MoveId::new(value),
        Err(_) => MoveId::ZERO,
    }
}
