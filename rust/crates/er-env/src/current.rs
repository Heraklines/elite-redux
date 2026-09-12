//! Current native session shared by adapters; historical V6 APIs remain in the crate root.

use std::sync::Arc;

use er_canonical::content_digest;
use er_game::m9e_content_v2::PreparedGameContentV2;
use er_kernel::game_kernel_v7::{
    GameKernelRoleV7, GameKernelStepV7, GameKernelV7, GameKernelV7Error,
    KernelPresentationOutcomeV2, KernelStorageResultV2,
};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_protocol::ProtocolRuntimeSnapshotV2;
use er_state::m7_state::ProfileStateV1;
use er_state::m9e_state_v6::GameStateV6;
use er_types::{
    ConnectionGeneration, GameContentIdentityV2, GameControlPlanV2, PlatformRequestId,
    PresentationEventId, RawInputEvent, SafeU53, SeatId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Dedicated current rebind control; it never represents a gameplay operation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum CurrentCoopRebindEventV1 {
    Begin,
    Retry,
    Receive {
        generation: ConnectionGeneration,
        bytes: Vec<u8>,
    },
}

// Empty struct variants reject extra map fields; serde unit variants do not.
#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
enum CurrentCoopRebindWireV1 {
    Begin {},
    Retry {},
    Receive {
        generation: ConnectionGeneration,
        bytes: Vec<u8>,
    },
}

impl<'de> Deserialize<'de> for CurrentCoopRebindEventV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Ok(match CurrentCoopRebindWireV1::deserialize(deserializer)? {
            CurrentCoopRebindWireV1::Begin {} => Self::Begin,
            CurrentCoopRebindWireV1::Retry {} => Self::Retry,
            CurrentCoopRebindWireV1::Receive { generation, bytes } => {
                Self::Receive { generation, bytes }
            }
        })
    }
}

/// Lossless adapter representation of the actual native rebind output.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentSessionRebindOutputV1 {
    pub generation: ConnectionGeneration,
    pub frames: Vec<Vec<u8>>,
}

impl From<er_kernel::game_kernel_v7::current_coop_rebind_v7::CurrentCoopRebindOutputV1>
    for CurrentSessionRebindOutputV1
{
    fn from(
        output: er_kernel::game_kernel_v7::current_coop_rebind_v7::CurrentCoopRebindOutputV1,
    ) -> Self {
        Self {
            generation: output.generation,
            frames: output.frames,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum CurrentExternalEvent {
    CurrentFlashEggInputs {
        input: Box<er_state::current_achievement_execution::CurrentFlashEggInputsV1>,
    },
    CurrentUtcClockResult {
        request_id: PlatformRequestId,
        utc_milliseconds: i64,
    },
    /// Chronological capture tag. Execute only through apply_rebind, never apply.
    CoopRebind {
        control: CurrentCoopRebindEventV1,
    },
    RetryCoopSetup,
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
    ProposalFrame {
        bytes: Vec<u8>,
    },
    AuthorityMaterial {
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
    /// Explicit ordinary fresh account creation; historical natural starts stay unknown.
    pub fn natural_start_with_fresh_friendship(
        start: er_kernel::game_kernel_v7::FreshFriendshipStartV7,
    ) -> Result<Self, CurrentSessionError> {
        let content = start.content.clone();
        let local_seat = start.local_seat;
        let kernel = GameKernelV7::natural_start_with_fresh_friendship(start)?;
        Ok(Self {
            kernel: Some(kernel),
            content,
            local_seat,
            role: GameKernelRoleV7::Authority,
        })
    }

    pub fn enable_current_coop_setup(&mut self) -> Result<(), CurrentSessionError> {
        self.kernel
            .as_mut()
            .ok_or(CurrentSessionError::Disposed)?
            .enable_current_coop_setup()?;
        Ok(())
    }
    pub fn enable_current_title_storage(&mut self) -> Result<(), CurrentSessionError> {
        self.kernel
            .as_mut()
            .ok_or(CurrentSessionError::Disposed)?
            .enable_current_title_storage()?;
        Ok(())
    }

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
        Self::natural_start_with_scheduler(
            profile,
            seed,
            local_seat,
            save_slots,
            local_is_host,
            content,
            KernelSchedulerSnapshotV2 {
                next_timer_id: Some(SafeU53::ZERO),
                timers: Vec::new(),
                pauses: Vec::new(),
                disposed: false,
            },
            protocol,
        )
    }

    /// Preserve the caller's allocator, timers, and pauses without normalizing them.
    #[allow(clippy::too_many_arguments)]
    pub fn natural_start_with_scheduler(
        profile: ProfileStateV1,
        seed: String,
        local_seat: SeatId,
        save_slots: Vec<String>,
        local_is_host: bool,
        content: Arc<PreparedGameContentV2>,
        scheduler: KernelSchedulerSnapshotV2,
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
            scheduler,
            protocol,
        )?;
        Ok(Self {
            kernel: Some(kernel),
            content,
            local_seat,
            role,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn from_active(
        state: GameStateV6,
        next_authority_revision: SafeU53,
        local_seat: SeatId,
        role: GameKernelRoleV7,
        content: Arc<PreparedGameContentV2>,
        input_router: InputRouterSnapshotV2,
        scheduler: KernelSchedulerSnapshotV2,
        protocol: Option<ProtocolRuntimeSnapshotV2>,
    ) -> Result<Self, CurrentSessionError> {
        let kernel = GameKernelV7::from_active(
            state,
            next_authority_revision,
            local_seat,
            role,
            Arc::clone(&content),
            input_router,
            scheduler,
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
        self.apply_with(event, |_, step| Ok(step))
    }

    /// Stage the kernel once and commit only after the adapter finishes its fallible work.
    /// The completion receives a read-only candidate; it should prepare response and
    /// bookkeeping values, leaving externally visible effects until after success.
    pub fn apply_with<R, E>(
        &mut self,
        event: CurrentExternalEvent,
        finish: impl FnOnce(&Self, GameKernelStepV7) -> Result<R, E>,
    ) -> Result<R, E>
    where
        E: From<CurrentSessionError>,
    {
        let mut candidate = self.fork().map_err(E::from)?;
        let kernel = candidate
            .kernel
            .as_mut()
            .ok_or(CurrentSessionError::Disposed)
            .map_err(E::from)?;
        let step = reduce(kernel, event)
            .map_err(CurrentSessionError::from)
            .map_err(E::from)?;
        candidate.validate().map_err(E::from)?;
        let response = finish(&candidate, step)?;
        self.kernel = candidate.kernel;
        Ok(response)
    }

    pub fn apply_rebind(
        &mut self,
        control: CurrentCoopRebindEventV1,
    ) -> Result<CurrentSessionRebindOutputV1, CurrentSessionError> {
        self.apply_rebind_with(control, |_, output| Ok(output))
    }

    /// Commit the actual control transaction only after response admission succeeds.
    /// The callback must defer external frame delivery until this method succeeds.
    pub fn apply_rebind_with<R, E>(
        &mut self,
        control: CurrentCoopRebindEventV1,
        finish: impl FnOnce(&Self, CurrentSessionRebindOutputV1) -> Result<R, E>,
    ) -> Result<R, E>
    where
        E: From<CurrentSessionError>,
    {
        let mut candidate = self.fork().map_err(E::from)?;
        let kernel = candidate
            .kernel
            .as_mut()
            .ok_or(CurrentSessionError::Disposed)
            .map_err(E::from)?;
        let output = match control {
            CurrentCoopRebindEventV1::Begin => kernel.begin_current_coop_rebind_v1(),
            CurrentCoopRebindEventV1::Retry => kernel.retry_current_coop_rebind_v1(),
            CurrentCoopRebindEventV1::Receive { generation, bytes } => {
                kernel.receive_current_coop_rebind_v1(generation, &bytes)
            }
        }
        .map_err(CurrentSessionError::from)
        .map_err(E::from)?;
        candidate.validate().map_err(E::from)?;
        let response = finish(&candidate, output.into())?;
        self.kernel = candidate.kernel;
        Ok(response)
    }

    pub fn fork(&self) -> Result<Self, CurrentSessionError> {
        self.kernel()?;
        Ok(self.clone())
    }

    pub fn dispose(&mut self) {
        self.kernel = None;
    }

    /// The context acknowledged when this live session was constructed or restored.
    pub fn session_context(&self) -> Result<(SeatId, GameKernelRoleV7), CurrentSessionError> {
        self.kernel()?;
        Ok((self.local_seat, self.role))
    }

    pub fn content(&self) -> &Arc<PreparedGameContentV2> {
        &self.content
    }

    /// Diagnostic compatibility access; ordinary clients should use structured observation.
    pub fn kernel_ref(&self) -> Result<&GameKernelV7, CurrentSessionError> {
        self.kernel()
    }

    fn kernel(&self) -> Result<&GameKernelV7, CurrentSessionError> {
        self.kernel.as_ref().ok_or(CurrentSessionError::Disposed)
    }
}

fn reduce(
    kernel: &mut GameKernelV7,
    event: CurrentExternalEvent,
) -> Result<GameKernelStepV7, GameKernelV7Error> {
    match event {
        CurrentExternalEvent::CoopRebind { .. } => Err(GameKernelV7Error::Invalid),
        CurrentExternalEvent::RetryCoopSetup => kernel.retry_current_coop_setup(),
        CurrentExternalEvent::RawInput { input } => kernel.raw_input(input),
        CurrentExternalEvent::AdvanceTime { milliseconds } => kernel.advance_time(milliseconds),
        CurrentExternalEvent::NetworkFrame { generation, bytes } => {
            kernel.ingest_network_frame(generation, &bytes)
        }
        CurrentExternalEvent::ProposalFrame { bytes } => kernel.admit_game_proposal(&bytes),
        CurrentExternalEvent::AuthorityMaterial { bytes } => {
            kernel.apply_authority_material(&bytes)
        }
        CurrentExternalEvent::TransportChanged {
            generation,
            connected,
        } => {
            kernel.transport_changed(generation, connected)?;
            Ok(GameKernelStepV7::default())
        }
        CurrentExternalEvent::PresentationOutcome { event_id, outcome } => {
            kernel.settle_presentation_outcome(event_id, outcome)?;
            Ok(GameKernelStepV7::default())
        }
        CurrentExternalEvent::CurrentUtcClockResult {
            request_id,
            utc_milliseconds,
        } => kernel.apply_current_utc_clock_result(request_id, utc_milliseconds),
        CurrentExternalEvent::CurrentFlashEggInputs { input } => {
            kernel.apply_current_flash_egg_inputs(*input)
        }
        CurrentExternalEvent::StorageResult { request_id, result } => {
            kernel.apply_storage_result(request_id, result)
        }
    }
}
