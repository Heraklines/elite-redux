//! GameRuntimeV5: direct state ownership and identical serialized material application.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_battle::m7_resolver::{BattleTransitionV5, BattleV5Error, TurnAuthorityContextV1};
use er_state::m7_state::GameStateV5;
use er_types::battle_command::CommandSet;
use er_types::ui::CancelPolicy;
use er_types::ui_menu::NavigationDirection;
use er_types::{
    GameContentIdentity, GameControlKindV2, MenuOptionId, OperationId, RunHook, RunProgramId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_content::PreparedGameContentV1;
use crate::m7_material::{
    BattleTurnMaterialV5, MaterialApplyResultV5, MaterialV5Error, apply_serialized_turn_material_v5,
};
use crate::m7_run_executor::{
    RunExecutionContextV1, RunExecutionError, execute_run_program_hook_v1,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameRuntimeSnapshotV5 {
    pub content_identity: GameContentIdentity,
    pub state: GameStateV5,
    pub applied_materials: BTreeMap<OperationId, Vec<u8>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedTurnV5 {
    pub candidate: GameStateV5,
    pub material: BattleTurnMaterialV5,
    pub bytes: Vec<u8>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameControlIntentV2 {
    Selected {
        kind: GameControlKindV2,
        option: MenuOptionId,
    },
    Cancelled {
        kind: GameControlKindV2,
    },
}

#[derive(Clone, Debug)]
pub struct GameRuntimeV5 {
    state: GameStateV5,
    content: Arc<PreparedGameContentV1>,
    applied_materials: BTreeMap<OperationId, Vec<u8>>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameRuntimeV5Error {
    #[error("GameStateV5 is invalid: {0}")]
    State(String),
    #[error("GameStateV5 content identity differs from prepared content")]
    ContentIdentity,
    #[error("direct battle resolution failed: {0}")]
    Battle(String),
    #[error("Material V5 failed: {0}")]
    Material(String),
    #[error("one operation identity was reused with different material bytes")]
    OperationCollision,
    #[error("authority candidate differs from the state installed by the common material applier")]
    CandidateMismatch,
    #[error("active game control is missing, blocked, or invalid")]
    Control,
    #[error("control option does not encode a valid canonical action")]
    ControlAction,
    #[error("run control execution failed: {0}")]
    RunExecution(String),
}

impl GameRuntimeV5 {
    pub fn new(
        state: GameStateV5,
        content: Arc<PreparedGameContentV1>,
    ) -> Result<Self, GameRuntimeV5Error> {
        validate_state(&state, &content)?;
        Ok(Self {
            state,
            content,
            applied_materials: BTreeMap::new(),
        })
    }

    pub fn from_snapshot(
        snapshot: GameRuntimeSnapshotV5,
        content: Arc<PreparedGameContentV1>,
    ) -> Result<Self, GameRuntimeV5Error> {
        if snapshot.content_identity != *content.identity() {
            return Err(GameRuntimeV5Error::ContentIdentity);
        }
        validate_state(&snapshot.state, &content)?;
        for (operation, bytes) in &snapshot.applied_materials {
            let material = BattleTurnMaterialV5::decode_canonical(bytes)
                .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
            if &material.operation_id != operation {
                return Err(GameRuntimeV5Error::OperationCollision);
            }
        }
        Ok(Self {
            state: snapshot.state,
            content,
            applied_materials: snapshot.applied_materials,
        })
    }

    pub fn snapshot(&self) -> GameRuntimeSnapshotV5 {
        GameRuntimeSnapshotV5 {
            content_identity: self.content.identity().clone(),
            state: self.state.clone(),
            applied_materials: self.applied_materials.clone(),
        }
    }

    pub fn state(&self) -> &GameStateV5 {
        &self.state
    }
    pub fn navigate_control(
        &mut self,
        direction: NavigationDirection,
    ) -> Result<(), GameRuntimeV5Error> {
        let run = self
            .state
            .active_run
            .as_mut()
            .ok_or(GameRuntimeV5Error::Control)?;
        let menu = run
            .control
            .menu
            .as_mut()
            .ok_or(GameRuntimeV5Error::Control)?;
        if !run.control.actionable {
            return Err(GameRuntimeV5Error::Control);
        }
        let selected = menu.selected_option_id.clone();
        let next = menu
            .navigation
            .iter()
            .find(|edge| edge.from == selected && edge.direction == direction)
            .map(|edge| edge.to.clone())
            .ok_or(GameRuntimeV5Error::Control)?;
        menu.selected_option_id = next;
        self.state
            .validate()
            .map_err(|error| GameRuntimeV5Error::State(error.to_string()))
    }

    pub fn submit_control(&self) -> Result<GameControlIntentV2, GameRuntimeV5Error> {
        let run = self
            .state
            .active_run
            .as_ref()
            .ok_or(GameRuntimeV5Error::Control)?;
        let menu = run
            .control
            .menu
            .as_ref()
            .ok_or(GameRuntimeV5Error::Control)?;
        if !run.control.actionable
            || !menu
                .options
                .iter()
                .any(|option| option.option_id == menu.selected_option_id && option.enabled)
        {
            return Err(GameRuntimeV5Error::Control);
        }
        Ok(GameControlIntentV2::Selected {
            kind: run.control.kind,
            option: menu.selected_option_id.clone(),
        })
    }

    /// Applies one selected logical option inside the canonical runtime.
    ///
    /// Content-driven run controls encode a typed `RunProgramId` as `program/{id}`. The kernel
    /// invokes this method after raw-key reduction; adapters never receive a causal intent.
    pub fn select_control(&mut self) -> Result<GameControlIntentV2, GameRuntimeV5Error> {
        let intent = self.submit_control()?;
        let GameControlIntentV2::Selected { kind, option } = &intent else {
            return Err(GameRuntimeV5Error::ControlAction);
        };
        let program_id = program_option(option).ok_or(GameRuntimeV5Error::ControlAction)?;
        let hook = control_hook(*kind).ok_or(GameRuntimeV5Error::ControlAction)?;
        let transition = execute_run_program_hook_v1(
            &self.state,
            &self.content,
            program_id,
            hook,
            RunExecutionContextV1::default(),
        )
        .map_err(|error| GameRuntimeV5Error::RunExecution(error.to_string()))?;
        self.state = transition.after_state;
        Ok(intent)
    }

    pub fn cancel_control(&self) -> Result<GameControlIntentV2, GameRuntimeV5Error> {
        let run = self
            .state
            .active_run
            .as_ref()
            .ok_or(GameRuntimeV5Error::Control)?;
        let menu = run
            .control
            .menu
            .as_ref()
            .ok_or(GameRuntimeV5Error::Control)?;
        if !run.control.actionable || matches!(menu.cancel, CancelPolicy::Disabled) {
            return Err(GameRuntimeV5Error::Control);
        }
        match &menu.cancel {
            CancelPolicy::Select(option) => Ok(GameControlIntentV2::Selected {
                kind: run.control.kind,
                option: option.clone(),
            }),
            CancelPolicy::Close | CancelPolicy::Back => Ok(GameControlIntentV2::Cancelled {
                kind: run.control.kind,
            }),
            CancelPolicy::Disabled => Err(GameRuntimeV5Error::Control),
        }
    }

    pub fn content(&self) -> &Arc<PreparedGameContentV1> {
        &self.content
    }

    pub fn prepare_authoritative_turn(
        &self,
        operation_id: OperationId,
        commands: &CommandSet,
        authority: &TurnAuthorityContextV1,
    ) -> Result<PreparedTurnV5, GameRuntimeV5Error> {
        let transition = resolve_turn_v5(&self.state, commands, &self.content, authority)
            .map_err(|error| GameRuntimeV5Error::Battle(error.to_string()))?;
        let candidate = transition.after_state.clone();
        let material = BattleTurnMaterialV5::from_transition(
            operation_id,
            authority.authority_seat,
            authority.revision,
            &self.content,
            transition,
        );
        let bytes = material
            .canonical_bytes()
            .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
        Ok(PreparedTurnV5 {
            candidate,
            material,
            bytes,
        })
    }

    pub fn resolve_and_apply_authoritative_turn(
        &mut self,
        operation_id: OperationId,
        commands: &CommandSet,
        authority: &TurnAuthorityContextV1,
    ) -> Result<PreparedTurnV5, GameRuntimeV5Error> {
        let prepared = self.prepare_authoritative_turn(operation_id, commands, authority)?;
        self.apply_material_bytes(&prepared.bytes)?;
        if self.state != prepared.candidate {
            return Err(GameRuntimeV5Error::CandidateMismatch);
        }
        Ok(prepared)
    }

    pub fn apply_material_bytes(
        &mut self,
        bytes: &[u8],
    ) -> Result<MaterialApplyResultV5, GameRuntimeV5Error> {
        let material = BattleTurnMaterialV5::decode_canonical(bytes)
            .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
        if let Some(previous) = self.applied_materials.get(&material.operation_id) {
            if previous != bytes {
                return Err(GameRuntimeV5Error::OperationCollision);
            }
        }
        let result = apply_serialized_turn_material_v5(&mut self.state, &self.content, bytes)
            .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
        self.applied_materials
            .entry(material.operation_id)
            .or_insert_with(|| bytes.to_vec());
        Ok(result)
    }
}

fn program_option(option: &MenuOptionId) -> Option<RunProgramId> {
    let value = option.as_str().strip_prefix("program/")?;
    let numeric = value.parse::<u64>().ok()?;
    RunProgramId::try_from_u64(numeric).ok()
}

fn control_hook(kind: GameControlKindV2) -> Option<RunHook> {
    match kind {
        GameControlKindV2::Title
        | GameControlKindV2::ModeSelect
        | GameControlKindV2::StarterSelect => Some(RunHook::RunStarted),
        GameControlKindV2::Reward | GameControlKindV2::Market => Some(RunHook::RewardSelected),
        GameControlKindV2::Scenario => Some(RunHook::ScenarioChoiceCommitted),
        GameControlKindV2::Quest => Some(RunHook::QuestAdvanced),
        GameControlKindV2::Faction => Some(RunHook::FactionStandingChanged),
        GameControlKindV2::Biome | GameControlKindV2::Route => Some(RunHook::BiomeExited),
        GameControlKindV2::BattleCommand
        | GameControlKindV2::BattleMove
        | GameControlKindV2::BattleTarget
        | GameControlKindV2::BattleSwitch
        | GameControlKindV2::BattleReplacement
        | GameControlKindV2::Capture
        | GameControlKindV2::FullParty
        | GameControlKindV2::Progression
        | GameControlKindV2::MoveLearn
        | GameControlKindV2::Evolution
        | GameControlKindV2::Fusion
        | GameControlKindV2::Save
        | GameControlKindV2::Waiting
        | GameControlKindV2::Complete => None,
    }
}

pub fn resolve_turn_v5(
    before: &GameStateV5,
    commands: &CommandSet,
    content: &PreparedGameContentV1,
    authority: &TurnAuthorityContextV1,
) -> Result<BattleTransitionV5, BattleV5Error> {
    er_battle::m7_resolver::resolve_turn_v5(before, commands, &content.battle, authority)
}

fn validate_state(
    state: &GameStateV5,
    content: &PreparedGameContentV1,
) -> Result<(), GameRuntimeV5Error> {
    state
        .validate()
        .map_err(|error| GameRuntimeV5Error::State(error.to_string()))?;
    if state.content_identity != *content.identity() {
        return Err(GameRuntimeV5Error::ContentIdentity);
    }
    Ok(())
}

impl From<MaterialV5Error> for GameRuntimeV5Error {
    fn from(error: MaterialV5Error) -> Self {
        Self::Material(error.to_string())
    }
}

impl From<RunExecutionError> for GameRuntimeV5Error {
    fn from(error: RunExecutionError) -> Self {
        Self::RunExecution(error.to_string())
    }
}
