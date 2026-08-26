//! GameStateV4-native M6 endpoint owner.
//!
//! `GameKernelV5` restores directly from `RestorableKernelSnapshotV5`; no V2
//! endpoint snapshot or legacy game runtime participates in construction.

use std::sync::Arc;

use er_canonical::content_digest;
use er_content::pack::m6_prepared::PreparedBattleContentV3;
use er_game::m6::runtime_v4::{GameRuntimeV4, M6RuntimeError};
use er_protocol::ProtocolRuntimeSnapshotV2;
use er_types::TerminalState;
use er_types::battle_ui::BattleUiProjection;
use thiserror::Error;

use crate::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2, SnapshotError};
use crate::snapshot_v5::{RestorableKernelSnapshotV5, SnapshotV5Error};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct M6KernelResourceSnapshot {
    pub timers: usize,
    pub pending_presentations: usize,
    pub terminal: bool,
}

#[derive(Clone, Debug)]
pub struct GameKernelV5 {
    runtime: GameRuntimeV4,
    input_router: InputRouterSnapshotV2,
    ui: BattleUiProjection,
    scheduler: KernelSchedulerSnapshotV2,
    protocol: ProtocolRuntimeSnapshotV2,
    terminal: Option<TerminalState>,
}

impl GameKernelV5 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        runtime: GameRuntimeV4,
        input_router: InputRouterSnapshotV2,
        ui: BattleUiProjection,
        scheduler: KernelSchedulerSnapshotV2,
        protocol: ProtocolRuntimeSnapshotV2,
        terminal: Option<TerminalState>,
    ) -> Result<Self, M6KernelV5Error> {
        let kernel = Self {
            runtime,
            input_router,
            ui,
            scheduler,
            protocol,
            terminal,
        };
        kernel.validate()?;
        Ok(kernel)
    }

    pub fn from_snapshot(
        snapshot: RestorableKernelSnapshotV5,
        content: Arc<PreparedBattleContentV3>,
    ) -> Result<Self, M6KernelV5Error> {
        snapshot.validate()?;
        let runtime = GameRuntimeV4::from_snapshot(snapshot.runtime, content)?;
        Self::new(
            runtime,
            snapshot.input_router,
            snapshot.ui,
            snapshot.scheduler,
            snapshot.protocol,
            snapshot.terminal,
        )
    }

    pub fn snapshot(&self) -> Result<RestorableKernelSnapshotV5, M6KernelV5Error> {
        Ok(RestorableKernelSnapshotV5::new(
            self.runtime.snapshot(),
            self.input_router.clone(),
            self.ui.clone(),
            self.scheduler.clone(),
            self.protocol.clone(),
            self.terminal.clone(),
        )?)
    }

    pub fn runtime(&self) -> &GameRuntimeV4 {
        &self.runtime
    }

    pub fn runtime_mut(&mut self) -> &mut GameRuntimeV4 {
        &mut self.runtime
    }

    pub fn ui(&self) -> &BattleUiProjection {
        &self.ui
    }

    pub fn protocol(&self) -> &ProtocolRuntimeSnapshotV2 {
        &self.protocol
    }

    pub fn apply_material_bytes(&mut self, bytes: &[u8]) -> Result<(), M6KernelV5Error> {
        let mut staged = self.clone();
        staged.runtime.apply_material_bytes(bytes)?;
        staged.validate()?;
        *self = staged;
        Ok(())
    }

    pub fn replace_environment(
        &mut self,
        input_router: InputRouterSnapshotV2,
        ui: BattleUiProjection,
        scheduler: KernelSchedulerSnapshotV2,
        protocol: ProtocolRuntimeSnapshotV2,
        terminal: Option<TerminalState>,
    ) -> Result<(), M6KernelV5Error> {
        let mut staged = self.clone();
        staged.input_router = input_router;
        staged.ui = ui;
        staged.scheduler = scheduler;
        staged.protocol = protocol;
        staged.terminal = terminal;
        staged.validate()?;
        *self = staged;
        Ok(())
    }

    pub fn kernel_determinism_digest(&self) -> Result<String, M6KernelV5Error> {
        Ok(content_digest(&self.snapshot()?)?)
    }

    pub fn presentation_plan_digest(&self) -> Result<String, M6KernelV5Error> {
        Ok(content_digest(&self.runtime.pending_presentations())?)
    }

    pub fn live_resources(&self) -> M6KernelResourceSnapshot {
        M6KernelResourceSnapshot {
            timers: self.scheduler.timers.len(),
            pending_presentations: self.runtime.pending_presentations().len(),
            terminal: self.terminal.is_some(),
        }
    }

    pub fn validate(&self) -> Result<(), M6KernelV5Error> {
        self.runtime.validate()?;
        self.input_router
            .validate()
            .map_err(M6KernelV5Error::Input)?;
        self.scheduler
            .validate()
            .map_err(M6KernelV5Error::Scheduler)?;
        self.protocol
            .validate()
            .map_err(|error| M6KernelV5Error::Protocol(error.to_string()))?;
        self.snapshot()?.validate()?;
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum M6KernelV5Error {
    #[error("V4 runtime failed: {0}")]
    Runtime(#[from] M6RuntimeError),
    #[error("Snapshot V5 failed: {0}")]
    Snapshot(#[from] SnapshotV5Error),
    #[error("input-router snapshot failed: {0}")]
    Input(SnapshotError),
    #[error("scheduler snapshot failed: {0}")]
    Scheduler(SnapshotError),
    #[error("protocol snapshot failed: {0}")]
    Protocol(String),
    #[error("kernel digest canonicalization failed: {0}")]
    Canonical(#[from] er_canonical::CanonicalError),
}
