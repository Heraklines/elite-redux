use serde::{Deserialize, Serialize};

use er_types::SafeU53;
use er_types::battle_ids::{FieldSlot, MoveSlotIndex, PartyIndex};
use er_types::mechanics::{MechanicAddress, MechanicSourceId, MechanicsProgramId};

use crate::ids::{SelectorNodeId, ValueNodeId};
use crate::value::QueryModifier;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HpOperationKind {
    Damage,
    IndirectDamage,
    Heal,
    Set,
    RecoilFromDamage,
    DrainFromDamage,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatusOperationKind {
    Apply,
    Cure,
    Replace,
    IncrementToxicCounter,
    DecrementSleepCounter,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StageOperationKind {
    Add,
    Set,
    Reset,
    Copy,
    Invert,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldEffectKind {
    Weather,
    Terrain,
    SideCondition,
    ArenaTag,
    BattlerTag,
    PositionalTag,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldEffectOperationKind {
    Apply,
    Refresh,
    Lapse,
    Remove,
    Transfer,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SwitchOperationKind {
    Voluntary,
    Forced,
    Pivot,
    Replacement,
    Redirect,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ItemOperationKind {
    Consume,
    Remove,
    Transfer,
    Restore,
    MarkUsed,
    ClearUsed,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActionOperationKind {
    Cancel,
    Flinch,
    AdditionalHit,
    RetryMove,
    QueueClosedMove,
    DisableMove,
    LockMove,
    ClearMoveLock,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationCueKind {
    Move,
    Ability,
    HeldItem,
    Hp,
    Status,
    StatStage,
    Switch,
    Faint,
    Weather,
    Terrain,
    SideCondition,
    Volatile,
    Message,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MechanicCounterKind {
    Generic,
    HitCount,
    ActiveTurns,
    ToxicTurns,
    SleepTurns,
    ConsecutiveUses,
    Charges,
    Cooldown,
    TriggerCount,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicCounter {
    pub kind: MechanicCounterKind,
    pub value: SafeU53,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum MechanicStatePayload {
    Empty,
    Counter {
        value: SafeU53,
    },
    Flag {
        value: bool,
    },
    StoredId {
        value: SafeU53,
    },
    StoredSource {
        value: MechanicSourceId,
    },
    MoveLock {
        move_id: SafeU53,
        remaining_turns: u16,
    },
    ItemState {
        item_id: SafeU53,
        consumed: bool,
        charges: u16,
    },
    TypeSet {
        type_ids: Vec<u8>,
    },
    IntegerList {
        values: Vec<i64>,
    },
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicInstanceTemplate {
    pub program_id: MechanicsProgramId,
    pub remaining_turns: Option<u16>,
    pub counters: Vec<MechanicCounter>,
    pub payload: MechanicStatePayload,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum MechanicOperation {
    Query {
        modifier: QueryModifier,
    },
    Hp {
        operation: HpOperationKind,
        targets: SelectorNodeId,
        amount: ValueNodeId,
    },
    Pp {
        targets: SelectorNodeId,
        move_slot: MoveSlotIndex,
        amount: ValueNodeId,
    },
    Status {
        operation: StatusOperationKind,
        targets: SelectorNodeId,
        status_id: SafeU53,
        duration: Option<ValueNodeId>,
    },
    StatStage {
        operation: StageOperationKind,
        targets: SelectorNodeId,
        stat_id: u8,
        stages: ValueNodeId,
    },
    FieldEffect {
        effect: FieldEffectKind,
        operation: FieldEffectOperationKind,
        targets: SelectorNodeId,
        effect_id: SafeU53,
        duration: Option<ValueNodeId>,
    },
    CreateInstance {
        owners: SelectorNodeId,
        template: MechanicInstanceTemplate,
    },
    UpdateInstance {
        address: MechanicAddress,
        payload: MechanicStatePayload,
    },
    RemoveInstance {
        address: MechanicAddress,
    },
    Switch {
        operation: SwitchOperationKind,
        actors: SelectorNodeId,
        party_slot: Option<PartyIndex>,
        field_slot: Option<FieldSlot>,
    },
    Item {
        operation: ItemOperationKind,
        targets: SelectorNodeId,
        item_id: SafeU53,
    },
    Action {
        operation: ActionOperationKind,
        targets: SelectorNodeId,
        move_id: Option<SafeU53>,
        count: Option<ValueNodeId>,
    },
    Presentation {
        cue: PresentationCueKind,
        subjects: SelectorNodeId,
        detail_id: Option<SafeU53>,
    },
}

impl MechanicOperation {
    pub fn selector_references(&self) -> impl Iterator<Item = SelectorNodeId> + '_ {
        let reference = match self {
            Self::Hp { targets, .. }
            | Self::Pp { targets, .. }
            | Self::Status { targets, .. }
            | Self::StatStage { targets, .. }
            | Self::FieldEffect { targets, .. }
            | Self::Item { targets, .. }
            | Self::Action { targets, .. } => Some(*targets),
            Self::CreateInstance { owners, .. } => Some(*owners),
            Self::Switch { actors, .. } => Some(*actors),
            Self::Presentation { subjects, .. } => Some(*subjects),
            Self::Query { .. } | Self::UpdateInstance { .. } | Self::RemoveInstance { .. } => None,
        };
        reference.into_iter()
    }

    pub fn value_references(&self) -> impl Iterator<Item = ValueNodeId> + '_ {
        let mut references = [None, None];
        match self {
            Self::Hp { amount, .. }
            | Self::Pp { amount, .. }
            | Self::StatStage { stages: amount, .. } => references[0] = Some(*amount),
            Self::Status { duration, .. } | Self::FieldEffect { duration, .. } => {
                references[0] = *duration;
            }
            Self::Action { count, .. } => references[0] = *count,
            Self::Query { modifier } => match modifier {
                QueryModifier::Set { value }
                | QueryModifier::Add { value }
                | QueryModifier::Minimum { value }
                | QueryModifier::Maximum { value } => references[0] = Some(*value),
                QueryModifier::Multiply { .. }
                | QueryModifier::Cancel
                | QueryModifier::ReplaceType { .. }
                | QueryModifier::ReplaceCategory { .. }
                | QueryModifier::ReplaceTarget { .. } => {}
            },
            Self::CreateInstance { .. }
            | Self::UpdateInstance { .. }
            | Self::RemoveInstance { .. }
            | Self::Switch { .. }
            | Self::Item { .. }
            | Self::Presentation { .. } => {}
        }
        references.into_iter().flatten()
    }

    pub const fn is_query(&self) -> bool {
        matches!(self, Self::Query { .. })
    }
}
