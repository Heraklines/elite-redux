//! Public M7 headless game environment.

use std::sync::Arc;

use er_canonical::content_digest;
use er_game::m7_content::PreparedGameContentV1;
use er_kernel::game_kernel_v6::{GameKernelV6, GameKernelV6Error, KernelControlEffectV6};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use er_kernel::snapshot_v6::RestorableKernelSnapshotV6;
use er_protocol::{ProtocolRuntimeSnapshotV2, ScheduledTimer};
use er_state::m7_state::GameStateV5;
use er_types::{
    GameControlKindV2, MenuOptionId, OperationId, RawInputEvent, SafeU53, TerminalState,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnvironmentKernelComponentsV1 {
    pub input_router: InputRouterSnapshotV2,
    pub scheduler: KernelSchedulerSnapshotV2,
    pub protocol: Option<ProtocolRuntimeSnapshotV2>,
    pub replay_sequence: SafeU53,
    pub terminal: Option<TerminalState>,
}

#[derive(Clone, Debug)]
pub struct GameEnvironment {
    kernel: GameKernelV6,
    content: Arc<PreparedGameContentV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameObservation {
    pub mechanical_digest: String,
    pub control: Option<GameControlKindV2>,
    pub actionable: bool,
    pub selected_option: Option<MenuOptionId>,
    pub pending_presentations: usize,
    pub terminal: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LegalAction {
    pub option: MenuOptionId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameEffect {
    Navigated,
    Selected {
        kind: GameControlKindV2,
        option: MenuOptionId,
    },
    ProposalReady {
        kind: GameControlKindV2,
        option: MenuOptionId,
        operation_id: OperationId,
        bytes: Vec<u8>,
        digest: String,
    },
    Cancelled {
        kind: GameControlKindV2,
    },
    TimerFired(ScheduledTimer),
}

#[derive(Debug, Error)]
pub enum EnvironmentError {
    #[error("GameKernelV6 failed: {0}")]
    Kernel(String),
    #[error("environment content identity differs from kernel state")]
    ContentIdentity,
    #[error("environment digest failed: {0}")]
    Digest(String),
}

impl GameEnvironment {
    pub fn new_run(
        state: GameStateV5,
        content: Arc<PreparedGameContentV1>,
        components: EnvironmentKernelComponentsV1,
    ) -> Result<Self, EnvironmentError> {
        if state.content_identity != *content.identity() {
            return Err(EnvironmentError::ContentIdentity);
        }
        let kernel = GameKernelV6::new(
            state,
            content.clone(),
            components.input_router,
            components.scheduler,
            components.protocol,
            components.replay_sequence,
            components.terminal,
        )
        .map_err(kernel_error)?;
        Ok(Self { kernel, content })
    }

    pub fn from_snapshot(
        snapshot: RestorableKernelSnapshotV6,
        content: Arc<PreparedGameContentV1>,
    ) -> Result<Self, EnvironmentError> {
        if snapshot.content_identity != *content.identity() {
            return Err(EnvironmentError::ContentIdentity);
        }
        let kernel =
            GameKernelV6::from_snapshot(snapshot, content.clone()).map_err(kernel_error)?;
        Ok(Self { kernel, content })
    }

    pub fn reset(&mut self, snapshot: RestorableKernelSnapshotV6) -> Result<(), EnvironmentError> {
        self.kernel =
            GameKernelV6::from_snapshot(snapshot, self.content.clone()).map_err(kernel_error)?;
        Ok(())
    }

    pub fn observe(&self) -> Result<GameObservation, EnvironmentError> {
        let state = self.kernel.state();
        let digest = content_digest(state)
            .map(|value| format!("blake3-v1:{value}"))
            .map_err(|error| EnvironmentError::Digest(error.to_string()))?;
        let control = state.active_run.as_ref().map(|run| &run.control);
        Ok(GameObservation {
            mechanical_digest: digest,
            control: control.map(|plan| plan.kind),
            actionable: control.is_some_and(|plan| plan.actionable),
            selected_option: control
                .and_then(|plan| plan.menu.as_ref())
                .map(|menu| menu.selected_option_id.clone()),
            pending_presentations: self.kernel.pending_presentations().len(),
            terminal: self.kernel.snapshot().terminal.is_some(),
        })
    }

    pub fn legal_actions(&self) -> Vec<LegalAction> {
        self.kernel
            .state()
            .active_run
            .as_ref()
            .filter(|run| run.control.actionable)
            .and_then(|run| run.control.menu.as_ref())
            .map(|menu| {
                menu.options
                    .iter()
                    .filter(|option| option.enabled)
                    .map(|option| LegalAction {
                        option: option.option_id.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn raw_input(&mut self, event: RawInputEvent) -> Result<Vec<GameEffect>, EnvironmentError> {
        let effect = self.kernel.raw_input(event).map_err(kernel_error)?;
        Ok(effect.into_iter().map(control_effect).collect())
    }

    pub fn advance_time(
        &mut self,
        milliseconds: SafeU53,
    ) -> Result<Vec<GameEffect>, EnvironmentError> {
        self.kernel
            .advance_time(milliseconds)
            .map(|timers| timers.into_iter().map(GameEffect::TimerFired).collect())
            .map_err(kernel_error)
    }

    pub fn snapshot(&self) -> RestorableKernelSnapshotV6 {
        self.kernel.snapshot()
    }

    pub fn content(&self) -> &Arc<PreparedGameContentV1> {
        &self.content
    }
}

fn control_effect(effect: KernelControlEffectV6) -> GameEffect {
    match effect {
        KernelControlEffectV6::Navigated => GameEffect::Navigated,
        KernelControlEffectV6::Selected { kind, option } => GameEffect::Selected { kind, option },
        KernelControlEffectV6::ProposalReady {
            kind,
            option,
            operation_id,
            bytes,
            digest,
        } => GameEffect::ProposalReady {
            kind,
            option,
            operation_id,
            bytes,
            digest,
        },
        KernelControlEffectV6::Cancelled { kind } => GameEffect::Cancelled { kind },
    }
}

fn kernel_error(error: GameKernelV6Error) -> EnvironmentError {
    EnvironmentError::Kernel(error.to_string())
}
