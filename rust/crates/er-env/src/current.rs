//! Current native session shared by adapters; historical V6 APIs remain in the crate root.

use std::sync::Arc;

use er_canonical::content_digest;
use er_game::m9e_content_v2::PreparedGameContentV2;
use er_kernel::game_kernel_v7::{
    GameKernelRoleV7, GameKernelStepV7, GameKernelV7, GameKernelV7Error,
    KernelPresentationOutcomeV2, KernelStorageResultV2,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_protocol::ProtocolRuntimeSnapshotV2;
use er_state::m7_state::ProfileStateV1;
use er_types::{
    ConnectionGeneration, GameContentIdentityV2, GameControlPlanV2, PlatformRequestId,
    PresentationEventId, RawInputEvent, SafeU53, SeatId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum CurrentExternalEvent {
    RawInput {
        input: RawInputEvent,
    },
    AdvanceTime {
        milliseconds: SafeU53,
    },
    NetworkFrame {
        generation: ConnectionGeneration,
        bytes: Vec<u8>,
    },
    TransportChanged {
        generation: ConnectionGeneration,
        connected: bool,
    },
    PresentationOutcome {
        event_id: PresentationEventId,
        outcome: KernelPresentationOutcomeV2,
    },
    StorageResult {
        request_id: PlatformRequestId,
        result: KernelStorageResultV2,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentGameObservation {
    pub kernel_version: u32,
    pub content_identity: GameContentIdentityV2,
    /// Absent during natural setup, before a mechanical game state exists.
    pub mechanical_digest: Option<String>,
    pub control: Option<GameControlPlanV2>,
}

#[derive(Debug, Error)]
pub enum CurrentSessionError {
    #[error("current session is disposed")]
    Disposed,
    #[error(transparent)]
    Kernel(#[from] GameKernelV7Error),
    #[error("current state digest failed: {0}")]
    Digest(String),
}

#[derive(Clone, Debug)]
pub struct CurrentGameSession {
    kernel: Option<GameKernelV7>,
    content: Arc<PreparedGameContentV2>,
    local_seat: SeatId,
    role: GameKernelRoleV7,
}

impl CurrentGameSession {
    #[allow(clippy::too_many_arguments)]
    pub fn natural_start(
        profile: ProfileStateV1,
        seed: String,
        local_seat: SeatId,
        save_slots: Vec<String>,
        local_is_host: bool,
        content: Arc<PreparedGameContentV2>,
        protocol: Option<ProtocolRuntimeSnapshotV2>,
    ) -> Result<Self, CurrentSessionError> {
        let role = protocol
            .as_ref()
            .map_or(GameKernelRoleV7::Authority, |value| match value.role {
                er_protocol::EndpointRole::Authority => GameKernelRoleV7::Authority,
                er_protocol::EndpointRole::Replica => GameKernelRoleV7::Replica,
            });
        let kernel = GameKernelV7::natural_start(
            profile,
            seed,
            local_seat,
            save_slots,
            local_is_host,
            Arc::clone(&content),
            KernelSchedulerSnapshotV2 {
                next_timer_id: Some(SafeU53::ZERO),
                timers: Vec::new(),
                pauses: Vec::new(),
                disposed: false,
            },
            protocol,
        )?;
        Ok(Self {
            kernel: Some(kernel),
            content,
            local_seat,
            role,
        })
    }

    pub fn from_snapshot(
        snapshot: CoreGameKernelSnapshotV7,
        local_seat: SeatId,
        role: GameKernelRoleV7,
        content: Arc<PreparedGameContentV2>,
    ) -> Result<Self, CurrentSessionError> {
        let kernel = GameKernelV7::from_snapshot(snapshot, local_seat, role, Arc::clone(&content))?;
        Ok(Self {
            kernel: Some(kernel),
            content,
            local_seat,
            role,
        })
    }

    pub fn restore(
        &mut self,
        snapshot: CoreGameKernelSnapshotV7,
    ) -> Result<(), CurrentSessionError> {
        self.kernel()?;
        let restored = GameKernelV7::from_snapshot(
            snapshot,
            self.local_seat,
            self.role,
            Arc::clone(&self.content),
        )?;
        self.kernel = Some(restored);
        Ok(())
    }

    pub fn snapshot(&self) -> Result<CoreGameKernelSnapshotV7, CurrentSessionError> {
        Ok(self.kernel()?.snapshot()?)
    }

    pub fn validate(&self) -> Result<(), CurrentSessionError> {
        Ok(self.kernel()?.validate()?)
    }

    pub fn observe(&self) -> Result<CurrentGameObservation, CurrentSessionError> {
        let kernel = self.kernel()?;
        let mechanical_digest = kernel
            .state()
            .map(|state| {
                content_digest(state)
                    .map(|value| format!("blake3-v1:{value}"))
                    .map_err(|error| CurrentSessionError::Digest(error.to_string()))
            })
            .transpose()?;
        Ok(CurrentGameObservation {
            kernel_version: 7,
            content_identity: self.content.identity().clone(),
            mechanical_digest,
            control: kernel.current_control().cloned(),
        })
    }

    /// Stage only mutable game state: rejected external events cannot partially commit.
    pub fn apply(
        &mut self,
        event: CurrentExternalEvent,
    ) -> Result<GameKernelStepV7, CurrentSessionError> {
        let mut candidate = self.kernel()?.clone();
        let step = match event {
            CurrentExternalEvent::RawInput { input } => candidate.raw_input(input)?,
            CurrentExternalEvent::AdvanceTime { milliseconds } => {
                candidate.advance_time(milliseconds)?
            }
            CurrentExternalEvent::NetworkFrame { generation, bytes } => {
                candidate.ingest_network_frame(generation, &bytes)?
            }
            CurrentExternalEvent::TransportChanged {
                generation,
                connected,
            } => {
                candidate.transport_changed(generation, connected)?;
                GameKernelStepV7::default()
            }
            CurrentExternalEvent::PresentationOutcome { event_id, outcome } => {
                candidate.settle_presentation_outcome(event_id, outcome)?;
                GameKernelStepV7::default()
            }
            CurrentExternalEvent::StorageResult { request_id, result } => {
                candidate.apply_storage_result(request_id, result)?
            }
        };
        candidate.validate()?;
        self.kernel = Some(candidate);
        Ok(step)
    }

    pub fn fork(&self) -> Result<Self, CurrentSessionError> {
        self.kernel()?;
        Ok(self.clone())
    }

    pub fn dispose(&mut self) {
        self.kernel = None;
    }

    pub fn content(&self) -> &Arc<PreparedGameContentV2> {
        &self.content
    }

    fn kernel(&self) -> Result<&GameKernelV7, CurrentSessionError> {
        self.kernel.as_ref().ok_or(CurrentSessionError::Disposed)
    }
}
