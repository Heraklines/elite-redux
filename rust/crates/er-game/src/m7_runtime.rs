//! GameRuntimeV5: direct state ownership and identical serialized material application.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_battle::m7_resolver::{BattleTransitionV5, BattleV5Error, TurnAuthorityContextV1};
use er_canonical::content_digest;
use er_state::m7_state::GameStateV5;
use er_types::battle_command::CommandSet;
use er_types::ui_menu::NavigationDirection;
use er_types::{
    GameActionContextV1, GameActionResultV1, GameActionV1, GameContentIdentity, GameControlKindV2,
    GameMenuCancelV2, MenuOptionId, OperationId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_content::PreparedGameContentV1;
use crate::m7_material::{
    BattleTurnMaterialV5, GameActionMaterialKindV1, GameActionMaterialV1, GameMaterialV5,
    GameMutationDomainV1, GameMutationEvidenceV1, MaterialApplyResultV5, MaterialV5Error,
    apply_game_material_v5, mechanical_digest,
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
        action: GameActionV1,
        context: GameActionContextV1,
    },
    Cancelled {
        kind: GameControlKindV2,
        action: GameActionV1,
        context: GameActionContextV1,
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
            let material = GameMaterialV5::decode_canonical(bytes)
                .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
            if material.operation_id() != operation {
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
        let action = menu
            .selected_action()
            .cloned()
            .ok_or(GameRuntimeV5Error::Control)?;
        let context = run
            .control
            .action_context
            .clone()
            .ok_or(GameRuntimeV5Error::Control)?;
        Ok(GameControlIntentV2::Selected {
            kind: run.control.kind,
            option: menu.selected_option_id.clone(),
            action,
            context,
        })
    }

    /// Applies one selected typed action inside the canonical runtime.
    ///
    /// The kernel invokes this method after raw-key reduction; adapters observe only the stable
    /// option identity and never decode or choose canonical semantics.
    pub fn select_control(&mut self) -> Result<GameControlIntentV2, GameRuntimeV5Error> {
        let intent = self.submit_control()?;
        self.execute_control_intent(&intent)?;
        Ok(intent)
    }

    pub fn execute_control_intent(
        &mut self,
        intent: &GameControlIntentV2,
    ) -> Result<GameActionResultV1, GameRuntimeV5Error> {
        if &self.submit_control()? != intent {
            return Err(GameRuntimeV5Error::ControlAction);
        }
        let GameControlIntentV2::Selected {
            action,
            context: action_context,
            ..
        } = intent
        else {
            return Err(GameRuntimeV5Error::ControlAction);
        };
        let GameActionV1::ExecuteRunProgram {
            program,
            hook,
            context,
        } = action
        else {
            return Err(GameRuntimeV5Error::ControlAction);
        };
        let transition = execute_run_program_hook_v1(
            &self.state,
            &self.content,
            *program,
            *hook,
            RunExecutionContextV1 {
                pokemon: context.pokemon,
                scenario_target: context.scenario_target,
            },
        )
        .map_err(|error| GameRuntimeV5Error::RunExecution(error.to_string()))?;
        let candidate = transition.after_state.clone();
        let before_digest = mechanical_digest(&self.state)
            .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
        let after_digest = mechanical_digest(&candidate)
            .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
        let mutations = transition
            .evidence
            .iter()
            .map(|entry| GameMutationEvidenceV1 {
                ordinal: entry.operation_ordinal,
                domain: GameMutationDomainV1::Run,
                before_digest: before_digest.clone(),
                after_digest: after_digest.clone(),
            })
            .collect();
        let action_material = GameActionMaterialV1::new(
            action_context.clone(),
            &self.content,
            &self.state,
            action.clone(),
            mutations,
            Vec::new(),
            candidate.clone(),
            Vec::new(),
        )
        .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
        let bytes =
            GameMaterialV5::from_action(GameActionMaterialKindV1::RunAction, action_material)
                .canonical_bytes()
                .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
        self.apply_material_bytes(&bytes)?;
        if self.state != candidate {
            return Err(GameRuntimeV5Error::CandidateMismatch);
        }
        let material_digest = content_digest(&bytes)
            .map(|digest| format!("blake3-v1:{digest}"))
            .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
        let next_control = self
            .state
            .active_run
            .as_ref()
            .map(|run| run.control.kind)
            .ok_or(GameRuntimeV5Error::Control)?;
        let result = GameActionResultV1 {
            context: action_context.clone(),
            accepted_action: action.clone(),
            material_digest,
            next_control,
        };
        result
            .validate()
            .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
        Ok(result)
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
        if !run.control.actionable {
            return Err(GameRuntimeV5Error::Control);
        }
        let context = run
            .control
            .action_context
            .clone()
            .ok_or(GameRuntimeV5Error::Control)?;
        match &menu.cancel {
            GameMenuCancelV2::Select { option_id } => {
                let option = menu
                    .options
                    .iter()
                    .find(|option| {
                        option.option_id == *option_id && option.visible && option.enabled
                    })
                    .ok_or(GameRuntimeV5Error::Control)?;
                Ok(GameControlIntentV2::Selected {
                    kind: run.control.kind,
                    option: option_id.clone(),
                    action: option.action.clone(),
                    context,
                })
            }
            GameMenuCancelV2::Back { action } | GameMenuCancelV2::Close { action } => {
                Ok(GameControlIntentV2::Cancelled {
                    kind: run.control.kind,
                    action: (**action).clone(),
                    context,
                })
            }
            GameMenuCancelV2::Disabled => Err(GameRuntimeV5Error::Control),
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
        let bytes = GameMaterialV5::BattleTurn(material.clone())
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
        let material = GameMaterialV5::decode_canonical(bytes)
            .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
        let operation_id = material.operation_id().clone();
        if let Some(previous) = self.applied_materials.get(&operation_id)
            && previous != bytes
        {
            return Err(GameRuntimeV5Error::OperationCollision);
        }
        let result = apply_game_material_v5(&mut self.state, &self.content, bytes)
            .map_err(|error| GameRuntimeV5Error::Material(error.to_string()))?;
        self.applied_materials
            .entry(operation_id)
            .or_insert_with(|| bytes.to_vec());
        Ok(result)
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
