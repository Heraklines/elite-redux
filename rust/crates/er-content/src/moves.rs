//! M3A-04 owns the selected move definitions and their closed effect vocabulary.

use er_types::battle_ids::MoveId;
use er_types::battle_model::{
    BattleStat, CapabilityStatus, EffectChance, MoveAccuracy, MoveCategory, MoveEffectDefinition,
    MoveFlag, MovePower, MoveTarget, PokemonType, StatusKind,
};
use er_types::ids::SafeU53;
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

/// The selected move IDs, in their canonical serialization and lookup order.
pub const SELECTED_MOVE_IDS: [MoveId; 6] = [
    selected_move_id(1),
    selected_move_id(52),
    selected_move_id(77),
    selected_move_id(78),
    selected_move_id(351),
    selected_move_id(589),
];

/// Errors raised when a selected move definition is malformed or unsupported.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum MoveDefinitionError {
    #[error("move {id} is outside the selected M3 content slice")]
    UnsupportedId { id: MoveId },
    #[error("move {id} is not capability-supported")]
    UnsupportedCapability { id: MoveId },
    #[error("move {id} must have a positive finite PP value")]
    InvalidBasePp { id: MoveId },
    #[error("move {id} has an invalid zero damage power")]
    InvalidPower { id: MoveId },
    #[error("move {id} has an invalid accuracy percentage {accuracy}")]
    InvalidAccuracy { id: MoveId, accuracy: u8 },
    #[error("move {id} has an invalid effect-chance percentage {chance}")]
    InvalidEffectChance { id: MoveId, chance: u8 },
    #[error("status move {id} must use MovePower::None")]
    StatusMoveHasPower { id: MoveId },
    #[error("damaging move {id} must use MovePower::Value")]
    DamagingMoveHasNoPower { id: MoveId },
    #[error("damaging move {id} must contain the DAMAGE effect")]
    DamagingMoveHasNoDamageEffect { id: MoveId },
    #[error("status move {id} may not contain the DAMAGE effect")]
    StatusMoveHasDamageEffect { id: MoveId },
    #[error("move {id} must contain at least one supported effect")]
    EmptyEffectList { id: MoveId },
    #[error("move {id} uses an unsupported status effect {status:?}")]
    UnsupportedStatus { id: MoveId, status: StatusKind },
    #[error("move {id} uses an unsupported effect {effect:?}")]
    UnsupportedEffect {
        id: MoveId,
        effect: MoveEffectDefinition,
    },
    #[error("move {id} repeats the flag {flag:?}")]
    DuplicateFlag { id: MoveId, flag: MoveFlag },
    #[error("move {id} repeats the effect {effect:?}")]
    DuplicateEffect {
        id: MoveId,
        effect: MoveEffectDefinition,
    },
    #[error("move {id} does not match the frozen selected definition")]
    DefinitionMismatch { id: MoveId },
}

/// Errors raised when a move lookup cannot admit an ID.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MoveLookupError {
    #[error("move {id} is outside the selected M3 content slice")]
    UnsupportedId { id: MoveId },
}

/// Errors raised when a move collection is not the canonical selected slice.
#[derive(Debug, Error, PartialEq)]
pub enum MoveCollectionError {
    #[error("expected {expected} selected moves, found {actual}")]
    WrongLength { expected: usize, actual: usize },
    #[error("selected move at index {index} is invalid: {error}")]
    InvalidDefinition {
        index: usize,
        #[source]
        error: MoveDefinitionError,
    },
    #[error("selected move at index {index} has ID {actual}, expected {expected}")]
    WrongOrder {
        index: usize,
        actual: MoveId,
        expected: MoveId,
    },
}

/// One immutable selected move definition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MoveDefinition {
    pub id: MoveId,
    pub category: MoveCategory,
    pub move_type: PokemonType,
    pub power: MovePower,
    pub accuracy: MoveAccuracy,
    pub base_pp: u16,
    pub effect_chance: EffectChance,
    pub priority: i8,
    pub target: MoveTarget,
    pub flags: Vec<MoveFlag>,
    pub effects: Vec<MoveEffectDefinition>,
    pub capability: CapabilityStatus,
}

impl MoveDefinition {
    /// Constructs and validates one exact selected move definition.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: MoveId,
        category: MoveCategory,
        move_type: PokemonType,
        power: MovePower,
        accuracy: MoveAccuracy,
        base_pp: u16,
        effect_chance: EffectChance,
        priority: i8,
        target: MoveTarget,
        flags: Vec<MoveFlag>,
        effects: Vec<MoveEffectDefinition>,
        capability: CapabilityStatus,
    ) -> Result<Self, MoveDefinitionError> {
        let definition = Self {
            id,
            category,
            move_type,
            power,
            accuracy,
            base_pp,
            effect_chance,
            priority,
            target,
            flags,
            effects,
            capability,
        };
        definition.validate()?;
        Ok(definition)
    }

    /// Validates IDs, ranges, closed effects, and exact selected data.
    pub fn validate(&self) -> Result<(), MoveDefinitionError> {
        let Some(expected) = canonical_move_for_wire(self.id) else {
            return Err(MoveDefinitionError::UnsupportedId { id: self.id });
        };

        if !matches!(&self.capability, CapabilityStatus::Supported) {
            return Err(MoveDefinitionError::UnsupportedCapability { id: self.id });
        }

        if self.base_pp == 0 {
            return Err(MoveDefinitionError::InvalidBasePp { id: self.id });
        }

        if matches!(&self.power, MovePower::Value(0)) {
            return Err(MoveDefinitionError::InvalidPower { id: self.id });
        }

        if let MoveAccuracy::Percent(accuracy) = self.accuracy
            && accuracy == 0
        {
            return Err(MoveDefinitionError::InvalidAccuracy {
                id: self.id,
                accuracy,
            });
        }

        if let EffectChance::Percent(chance) = self.effect_chance
            && chance > 100
        {
            return Err(MoveDefinitionError::InvalidEffectChance {
                id: self.id,
                chance,
            });
        }

        match (&self.category, &self.power) {
            (MoveCategory::Status, MovePower::Value(_)) => {
                return Err(MoveDefinitionError::StatusMoveHasPower { id: self.id });
            }
            (MoveCategory::Physical | MoveCategory::Special, MovePower::None) => {
                return Err(MoveDefinitionError::DamagingMoveHasNoPower { id: self.id });
            }
            _ => {}
        }

        if self.effects.is_empty() {
            return Err(MoveDefinitionError::EmptyEffectList { id: self.id });
        }

        let mut has_damage = false;
        for effect in &self.effects {
            match effect {
                MoveEffectDefinition::Damage => {
                    if has_damage {
                        return Err(MoveDefinitionError::DuplicateEffect {
                            id: self.id,
                            effect: effect.clone(),
                        });
                    }
                    has_damage = true;
                }
                MoveEffectDefinition::ApplyStatus(status) => {
                    if !matches!(
                        status,
                        StatusKind::Burn | StatusKind::Poison | StatusKind::Paralysis
                    ) {
                        return Err(MoveDefinitionError::UnsupportedStatus {
                            id: self.id,
                            status: *status,
                        });
                    }
                }
                MoveEffectDefinition::ChangeStatStage { stat, delta } => {
                    if !matches!(
                        (*stat, *delta),
                        (BattleStat::Attack, -1)
                            | (BattleStat::Defense, -1)
                            | (BattleStat::Evasion, -2)
                    ) {
                        return Err(MoveDefinitionError::UnsupportedEffect {
                            id: self.id,
                            effect: effect.clone(),
                        });
                    }
                }
                MoveEffectDefinition::Flinch => {}
            }
        }

        if matches!(self.category, MoveCategory::Status) && has_damage {
            return Err(MoveDefinitionError::StatusMoveHasDamageEffect { id: self.id });
        }
        if matches!(
            self.category,
            MoveCategory::Physical | MoveCategory::Special
        ) && !has_damage
        {
            return Err(MoveDefinitionError::DamagingMoveHasNoDamageEffect { id: self.id });
        }

        for (index, flag) in self.flags.iter().enumerate() {
            if self.flags[..index].contains(flag) {
                return Err(MoveDefinitionError::DuplicateFlag {
                    id: self.id,
                    flag: *flag,
                });
            }
        }
        for (index, effect) in self.effects.iter().enumerate() {
            if self.effects[..index].contains(effect) {
                return Err(MoveDefinitionError::DuplicateEffect {
                    id: self.id,
                    effect: effect.clone(),
                });
            }
        }

        if *self != expected {
            return Err(MoveDefinitionError::DefinitionMismatch { id: self.id });
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for MoveDefinition {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct MoveDefinitionWire {
            id: MoveId,
            category: MoveCategory,
            move_type: PokemonType,
            power: MovePower,
            accuracy: MoveAccuracy,
            base_pp: u16,
            effect_chance: EffectChance,
            priority: i8,
            target: MoveTarget,
            flags: Vec<MoveFlag>,
            effects: Vec<MoveEffectDefinition>,
            capability: CapabilityStatus,
        }

        let wire = MoveDefinitionWire::deserialize(deserializer)?;
        Self::new(
            wire.id,
            wire.category,
            wire.move_type,
            wire.power,
            wire.accuracy,
            wire.base_pp,
            wire.effect_chance,
            wire.priority,
            wire.target,
            wire.flags,
            wire.effects,
            wire.capability,
        )
        .map_err(serde::de::Error::custom)
    }
}

/// Returns whether an ID belongs to the selected move slice.
pub fn is_selected_move(id: MoveId) -> bool {
    SELECTED_MOVE_IDS.contains(&id)
}

/// Returns the selected move definitions in canonical ascending-ID order.
pub fn selected_move_definitions() -> Vec<MoveDefinition> {
    vec![
        pound(),
        ember(),
        poison_powder(),
        stun_spore(),
        shock_wave(),
        play_nice(),
    ]
}

/// Alias for callers constructing the immutable selected content pack.
pub fn move_definitions() -> Vec<MoveDefinition> {
    selected_move_definitions()
}

/// Looks up a selected move by ID and rejects every outside-slice ID.
pub fn lookup_move(id: MoveId) -> Result<MoveDefinition, MoveLookupError> {
    canonical_move(id).ok_or(MoveLookupError::UnsupportedId { id })
}

/// Alias preserving the full definition-oriented lookup name.
pub fn lookup_move_definition(id: MoveId) -> Result<MoveDefinition, MoveLookupError> {
    lookup_move(id)
}

/// Looks up a move in an already canonical, ascending-ID collection.
pub fn find_move(
    definitions: &[MoveDefinition],
    id: MoveId,
) -> Result<&MoveDefinition, MoveLookupError> {
    definitions
        .binary_search_by_key(&id, |definition| definition.id)
        .map(|index| &definitions[index])
        .map_err(|_| MoveLookupError::UnsupportedId { id })
}

/// Validates the complete selected move collection and its deterministic order.
pub fn validate_selected_moves(definitions: &[MoveDefinition]) -> Result<(), MoveCollectionError> {
    if definitions.len() != SELECTED_MOVE_IDS.len() {
        return Err(MoveCollectionError::WrongLength {
            expected: SELECTED_MOVE_IDS.len(),
            actual: definitions.len(),
        });
    }

    for (index, (definition, expected)) in definitions
        .iter()
        .zip(SELECTED_MOVE_IDS.iter().copied())
        .enumerate()
    {
        definition
            .validate()
            .map_err(|error| MoveCollectionError::InvalidDefinition { index, error })?;
        if definition.id != expected {
            return Err(MoveCollectionError::WrongOrder {
                index,
                actual: definition.id,
                expected,
            });
        }
    }
    Ok(())
}

fn canonical_move(id: MoveId) -> Option<MoveDefinition> {
    match u64::from(id) {
        1 => Some(pound()),
        52 => Some(ember()),
        77 => Some(poison_powder()),
        78 => Some(stun_spore()),
        351 => Some(shock_wave()),
        589 => Some(play_nice()),
        _ => None,
    }
}

fn canonical_move_for_wire(id: MoveId) -> Option<MoveDefinition> {
    canonical_move(id).or_else(|| crate::pack::m4_moves::captured_move(id))
}

const fn selected_move_id(value: u64) -> MoveId {
    match SafeU53::new(value) {
        Ok(value) => MoveId::new(value),
        Err(_) => MoveId::ZERO,
    }
}

fn move_id(value: u64) -> MoveId {
    selected_move_id(value)
}

fn supported() -> CapabilityStatus {
    CapabilityStatus::Supported
}

fn pound() -> MoveDefinition {
    MoveDefinition {
        id: move_id(1),
        category: MoveCategory::Physical,
        move_type: PokemonType::Normal,
        power: MovePower::Value(40),
        accuracy: MoveAccuracy::Percent(100),
        base_pp: 35,
        effect_chance: EffectChance::None,
        priority: 0,
        target: MoveTarget::NearOther,
        flags: vec![MoveFlag::Contact],
        effects: vec![MoveEffectDefinition::Damage],
        capability: supported(),
    }
}

fn ember() -> MoveDefinition {
    MoveDefinition {
        id: move_id(52),
        category: MoveCategory::Special,
        move_type: PokemonType::Fire,
        power: MovePower::Value(20),
        accuracy: MoveAccuracy::Percent(100),
        base_pp: 20,
        effect_chance: EffectChance::Percent(100),
        priority: 0,
        target: MoveTarget::NearOther,
        flags: vec![MoveFlag::ThawsUserFreeze],
        effects: vec![
            MoveEffectDefinition::Damage,
            MoveEffectDefinition::ApplyStatus(StatusKind::Burn),
        ],
        capability: supported(),
    }
}

fn poison_powder() -> MoveDefinition {
    MoveDefinition {
        id: move_id(77),
        category: MoveCategory::Status,
        move_type: PokemonType::Poison,
        power: MovePower::None,
        accuracy: MoveAccuracy::Percent(75),
        base_pp: 35,
        effect_chance: EffectChance::None,
        priority: 0,
        target: MoveTarget::NearOther,
        flags: vec![MoveFlag::Powder, MoveFlag::Reflectable],
        effects: vec![MoveEffectDefinition::ApplyStatus(StatusKind::Poison)],
        capability: supported(),
    }
}

fn stun_spore() -> MoveDefinition {
    MoveDefinition {
        id: move_id(78),
        category: MoveCategory::Status,
        move_type: PokemonType::Grass,
        power: MovePower::None,
        accuracy: MoveAccuracy::Percent(100),
        base_pp: 20,
        effect_chance: EffectChance::None,
        priority: 0,
        target: MoveTarget::NearOther,
        flags: vec![MoveFlag::Powder, MoveFlag::Reflectable],
        effects: vec![MoveEffectDefinition::ApplyStatus(StatusKind::Paralysis)],
        capability: supported(),
    }
}

fn shock_wave() -> MoveDefinition {
    MoveDefinition {
        id: move_id(351),
        category: MoveCategory::Special,
        move_type: PokemonType::Electric,
        power: MovePower::Value(40),
        accuracy: MoveAccuracy::AlwaysHits,
        base_pp: 15,
        effect_chance: EffectChance::None,
        priority: 2,
        target: MoveTarget::NearOther,
        flags: Vec::new(),
        effects: vec![MoveEffectDefinition::Damage],
        capability: supported(),
    }
}

fn play_nice() -> MoveDefinition {
    MoveDefinition {
        id: move_id(589),
        category: MoveCategory::Status,
        move_type: PokemonType::Normal,
        power: MovePower::None,
        accuracy: MoveAccuracy::AlwaysHits,
        base_pp: 20,
        effect_chance: EffectChance::None,
        priority: 0,
        target: MoveTarget::AllNearEnemies,
        flags: vec![MoveFlag::IgnoreSubstitute, MoveFlag::Reflectable],
        effects: vec![MoveEffectDefinition::ChangeStatStage {
            stat: BattleStat::Attack,
            delta: -1,
        }],
        capability: supported(),
    }
}
