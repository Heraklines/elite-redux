use er_types::battle_ids::MoveId;
use er_types::battle_model::{
    CapabilityStatus, EffectChance, MoveAccuracy, MoveCategory, MoveEffectDefinition, MoveFlag,
    MovePower, MoveTarget, PokemonType, StatusKind,
};
use er_types::ids::SafeU53;
use thiserror::Error;

use crate::moves::selected_move_definitions;

/// The M4 battle move IDs in canonical ascending serialization order.
pub const SELECTED_M4_MOVE_IDS: [MoveId; 11] = [
    m4_move_id(1),
    m4_move_id(34),
    m4_move_id(39),
    m4_move_id(52),
    m4_move_id(77),
    m4_move_id(78),
    m4_move_id(98),
    m4_move_id(158),
    m4_move_id(230),
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

pub fn tail_whip_39() -> crate::moves::MoveDefinition {
    crate::moves::MoveDefinition {
        id: m4_move_id(39),
        category: MoveCategory::Status,
        move_type: PokemonType::Normal,
        power: MovePower::None,
        accuracy: MoveAccuracy::Percent(100),
        base_pp: 30,
        effect_chance: EffectChance::None,
        priority: 0,
        target: MoveTarget::AllNearEnemies,
        flags: vec![MoveFlag::Reflectable],
        effects: vec![MoveEffectDefinition::ChangeStatStage {
            stat: er_types::battle_model::BattleStat::Defense,
            delta: -1,
        }],
        capability: CapabilityStatus::Supported,
    }
}

pub fn quick_attack_98() -> crate::moves::MoveDefinition {
    crate::moves::MoveDefinition {
        id: m4_move_id(98),
        category: MoveCategory::Physical,
        move_type: PokemonType::Normal,
        power: MovePower::Value(40),
        accuracy: MoveAccuracy::Percent(100),
        base_pp: 30,
        effect_chance: EffectChance::None,
        priority: 1,
        target: MoveTarget::NearOther,
        flags: vec![MoveFlag::Contact],
        effects: vec![MoveEffectDefinition::Damage],
        capability: CapabilityStatus::Supported,
    }
}

pub fn hyper_fang_158() -> crate::moves::MoveDefinition {
    crate::moves::MoveDefinition {
        id: m4_move_id(158),
        category: MoveCategory::Physical,
        move_type: PokemonType::Normal,
        power: MovePower::Value(85),
        accuracy: MoveAccuracy::Percent(90),
        base_pp: 15,
        effect_chance: EffectChance::Percent(30),
        priority: 0,
        target: MoveTarget::NearOther,
        flags: vec![MoveFlag::Contact, MoveFlag::Biting],
        effects: vec![MoveEffectDefinition::Damage, MoveEffectDefinition::Flinch],
        capability: CapabilityStatus::Supported,
    }
}

pub fn sweet_scent_230() -> crate::moves::MoveDefinition {
    crate::moves::MoveDefinition {
        id: m4_move_id(230),
        category: MoveCategory::Status,
        move_type: PokemonType::Normal,
        power: MovePower::None,
        accuracy: MoveAccuracy::Percent(100),
        base_pp: 20,
        effect_chance: EffectChance::None,
        priority: 0,
        target: MoveTarget::AllNearEnemies,
        flags: vec![MoveFlag::Reflectable],
        effects: vec![MoveEffectDefinition::ChangeStatStage {
            stat: er_types::battle_model::BattleStat::Evasion,
            delta: -2,
        }],
        capability: CapabilityStatus::Supported,
    }
}

pub(crate) fn captured_move(id: MoveId) -> Option<crate::moves::MoveDefinition> {
    match id.get().get() {
        34 => Some(body_slam_34()),
        39 => Some(tail_whip_39()),
        98 => Some(quick_attack_98()),
        158 => Some(hyper_fang_158()),
        230 => Some(sweet_scent_230()),
        _ => None,
    }
}

/// Returns the M3 move closure plus the captured M4 additions, without
/// mutating the M3 vector.
pub fn selected_m4_move_definitions() -> Vec<crate::moves::MoveDefinition> {
    let mut definitions = selected_move_definitions();
    definitions.extend([
        body_slam_34(),
        tail_whip_39(),
        quick_attack_98(),
        hyper_fang_158(),
        sweet_scent_230(),
    ]);
    definitions.sort_unstable_by_key(|definition| definition.id);
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
        if definition.validate().is_err() {
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
