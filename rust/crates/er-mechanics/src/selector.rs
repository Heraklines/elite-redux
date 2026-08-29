use serde::{Deserialize, Serialize};

use er_types::SafeU53;
use er_types::battle_ids::BattleSide;
use er_types::mechanics::MechanicScope;

use crate::condition::MechanicsRngReason;
use crate::ids::SelectorNodeId;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SelectorOrder {
    FieldPosition,
    PartyOrder,
    SpeedDescending,
    SpeedAscending,
    HpAscending,
    HpDescending,
    CreationOrder,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum SelectorPredicate {
    Active,
    Fainted,
    Grounded,
    AdjacentToActor,
    AllyOfActor,
    OpponentOfActor,
    HasType { type_id: u8 },
    HasMajorStatus { status_id: SafeU53 },
    HasVolatile { volatile_id: SafeU53 },
    HasAbility { ability_id: SafeU53 },
    HasHeldItem { registry_id: SafeU53 },
    HasBattlerTag { tag_id: SafeU53 },
    HpBelowPercent { percent: u8 },
    HpAbovePercent { percent: u8 },
}

impl SelectorPredicate {
    pub fn validate(self) -> Result<(), SelectorNodeError> {
        match self {
            Self::HpBelowPercent { percent } | Self::HpAbovePercent { percent }
                if percent > 100 =>
            {
                Err(SelectorNodeError::PercentAboveHundred { percent })
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum SelectorNode {
    SelfPokemon,
    Actor,
    CommandTarget,
    CurrentTarget,
    Attacker,
    LastAttacker,
    SourceOwner,
    StoredTarget,
    ExplicitScope {
        scope: MechanicScope,
    },
    Side {
        side: BattleSide,
    },
    Allies,
    Opponents,
    ActiveField,
    Party {
        side: BattleSide,
    },
    Bench {
        side: BattleSide,
    },
    Filter {
        input: SelectorNodeId,
        predicate: SelectorPredicate,
    },
    Union {
        inputs: Vec<SelectorNodeId>,
    },
    Intersect {
        inputs: Vec<SelectorNodeId>,
    },
    StableDistinct {
        input: SelectorNodeId,
    },
    StableSort {
        input: SelectorNodeId,
        order: SelectorOrder,
    },
    First {
        input: SelectorNodeId,
    },
    All {
        input: SelectorNodeId,
    },
    RandomOne {
        input: SelectorNodeId,
        reason: MechanicsRngReason,
        draw_for_singleton: bool,
    },
}

impl SelectorNode {
    pub fn references(&self) -> impl Iterator<Item = SelectorNodeId> + '_ {
        let references: &[SelectorNodeId] = match self {
            Self::Filter { input, .. }
            | Self::StableDistinct { input }
            | Self::StableSort { input, .. }
            | Self::First { input }
            | Self::All { input }
            | Self::RandomOne { input, .. } => std::slice::from_ref(input),
            Self::Union { inputs } | Self::Intersect { inputs } => inputs.as_slice(),
            _ => &[],
        };
        references.iter().copied()
    }

    pub fn validate_scalars(&self) -> Result<(), SelectorNodeError> {
        match self {
            Self::Union { inputs } | Self::Intersect { inputs } if inputs.is_empty() => {
                Err(SelectorNodeError::EmptySetOperation)
            }
            Self::Filter { predicate, .. } => predicate.validate(),
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum SelectorNodeError {
    #[error("selector union/intersection must not be empty")]
    EmptySetOperation,
    #[error("selector percent {percent} exceeds 100")]
    PercentAboveHundred { percent: u8 },
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SelectorArena(pub Vec<SelectorNode>);

impl SelectorArena {
    pub fn get(&self, id: SelectorNodeId) -> Option<&SelectorNode> {
        self.0.get(id.index())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}
