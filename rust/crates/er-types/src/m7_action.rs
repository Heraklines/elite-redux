//! Closed typed actions for every M7 logical control.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::battle_ids::{
    FaintOccurrenceId, FieldSlot, MenuInstanceId, MoveId, MoveSlotIndex, PartyIndex, PokemonId,
};
use crate::battle_model::BattleOutcome;
use crate::run_ids::{BiomeId, RouteNodeId};
use crate::{
    EvolutionId, GameControlKindV2, InventoryItemId, OperationId, RunHook, RunProgramId, SafeU53,
    ScenarioNodeId, SeatId, StorageSlotId,
};

pub const GAME_ACTION_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunExecutionContextV2 {
    pub pokemon: Option<PokemonId>,
    pub scenario_target: Option<PokemonId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameActionContextV1 {
    pub operation_id: OperationId,
    pub authority_seat: SeatId,
    pub authority_revision: SafeU53,
    pub menu_instance: MenuInstanceId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum BattleUiActionV1 {
    OpenFight,
    OpenParty,
    SelectMove {
        actor: PokemonId,
        move_slot: MoveSlotIndex,
    },
    SelectTarget {
        actor: PokemonId,
        target: FieldSlot,
    },
    SelectSwitch {
        actor: PokemonId,
        party_slot: PartyIndex,
    },
    SelectReplacement {
        occurrence: FaintOccurrenceId,
        field: FieldSlot,
        party_slot: PartyIndex,
    },
    Cancel,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum CaptureActionV1 {
    Attempt {
        target: PokemonId,
        ball: InventoryItemId,
    },
    Decline,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum PartyActionV1 {
    ChooseFullPartyDestination {
        pokemon: PokemonId,
        replace: Option<PartyIndex>,
    },
    Reorder {
        from: PartyIndex,
        to: PartyIndex,
    },
    SendToStorage {
        pokemon: PokemonId,
    },
    Release {
        storage_slot: StorageSlotId,
    },
    TransferHeldItems {
        source: PokemonId,
        target: PokemonId,
    },
    Cancel,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ProgressionActionV1 {
    AcceptTask { sequence: SafeU53 },
    DeclineTask { sequence: SafeU53 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum MoveLearningActionV1 {
    Replace {
        pokemon: PokemonId,
        move_id: MoveId,
        slot: MoveSlotIndex,
    },
    Refuse {
        pokemon: PokemonId,
        move_id: MoveId,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum EvolutionActionV1 {
    Complete {
        pokemon: PokemonId,
        evolution: EvolutionId,
    },
    Cancel {
        pokemon: PokemonId,
        evolution: EvolutionId,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum FusionActionV1 {
    Fuse {
        primary: PokemonId,
        partner: PokemonId,
    },
    Cancel,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum InventoryActionV1 {
    Use {
        item: InventoryItemId,
        target: Option<PokemonId>,
    },
    Transfer {
        item: InventoryItemId,
        source: PokemonId,
        target: PokemonId,
    },
    Discard {
        item: InventoryItemId,
        count: u32,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum RewardActionV1 {
    Select { option_ordinal: u32 },
    Reroll,
    ToggleLock { option_ordinal: u32 },
    Decline,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum WorldActionV1 {
    SelectRoute { route: RouteNodeId },
    SelectBiome { biome: BiomeId },
    Stay,
    Leave,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ScenarioGameActionV1 {
    Advance {
        node: ScenarioNodeId,
    },
    Choose {
        node: ScenarioNodeId,
        option_ordinal: u32,
    },
    SelectPartyTarget {
        node: ScenarioNodeId,
        pokemon: PokemonId,
    },
    SelectItemTarget {
        node: ScenarioNodeId,
        item: InventoryItemId,
    },
    Complete {
        node: ScenarioNodeId,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum SaveActionV1 {
    Write { slot: String },
    Load { slot: String },
    Delete { slot: String },
    Cancel,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum TerminalActionV1 {
    ConfirmOutcome { outcome: BattleOutcome },
    ReturnToTitle,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum GameActionV1 {
    ExecuteRunProgram {
        program: RunProgramId,
        hook: RunHook,
        context: RunExecutionContextV2,
    },
    Battle {
        action: BattleUiActionV1,
    },
    Capture {
        action: CaptureActionV1,
    },
    Party {
        action: PartyActionV1,
    },
    Progression {
        action: ProgressionActionV1,
    },
    MoveLearning {
        action: MoveLearningActionV1,
    },
    Evolution {
        action: EvolutionActionV1,
    },
    Fusion {
        action: FusionActionV1,
    },
    Inventory {
        action: InventoryActionV1,
    },
    Reward {
        action: RewardActionV1,
    },
    World {
        action: WorldActionV1,
    },
    Scenario {
        action: ScenarioGameActionV1,
    },
    Save {
        action: SaveActionV1,
    },
    Terminal {
        action: TerminalActionV1,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameProposalV1 {
    pub schema_version: u32,
    pub context: GameActionContextV1,
    pub action: GameActionV1,
}

impl GameProposalV1 {
    pub fn validate(&self) -> Result<(), GameActionError> {
        if self.schema_version != GAME_ACTION_SCHEMA_VERSION_V1 {
            return Err(GameActionError::SchemaVersion);
        }
        self.action.validate()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameActionResultV1 {
    pub context: GameActionContextV1,
    pub accepted_action: GameActionV1,
    pub material_digest: String,
    pub next_control: GameControlKindV2,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameActionError {
    #[error("game action schema version is unsupported")]
    SchemaVersion,
    #[error("run program identity must be nonzero")]
    ZeroProgram,
    #[error("inventory discard count must be nonzero")]
    ZeroCount,
    #[error("save slot must not be empty")]
    EmptySaveSlot,
    #[error("material digest must use the canonical blake3-v1 format")]
    MaterialDigest,
}

impl GameActionV1 {
    pub fn validate(&self) -> Result<(), GameActionError> {
        match self {
            Self::ExecuteRunProgram { program, .. } if *program == RunProgramId::ZERO => {
                Err(GameActionError::ZeroProgram)
            }
            Self::Inventory {
                action: InventoryActionV1::Discard { count: 0, .. },
            } => Err(GameActionError::ZeroCount),
            Self::Save {
                action:
                    SaveActionV1::Write { slot }
                    | SaveActionV1::Load { slot }
                    | SaveActionV1::Delete { slot },
            } if slot.is_empty() => Err(GameActionError::EmptySaveSlot),
            _ => Ok(()),
        }
    }
}

impl GameActionResultV1 {
    pub fn validate(&self) -> Result<(), GameActionError> {
        self.accepted_action.validate()?;
        if !valid_blake3_digest(&self.material_digest) {
            return Err(GameActionError::MaterialDigest);
        }
        Ok(())
    }
}

fn valid_blake3_digest(value: &str) -> bool {
    value.strip_prefix("blake3-v1:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}
