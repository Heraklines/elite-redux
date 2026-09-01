use std::collections::{BTreeMap, BTreeSet};

use er_game::m9e_content_v2::{PreparedGameContentV2, PresentationSemanticIdV1};
use er_game::m9e_material_v6::{AppliedGameMaterialLedgerV1, GamePlatformEffectV2};
use er_game::m72_bootstrap::RunBootstrapMachineV1;
use er_protocol::ProtocolRuntimeSnapshotV2;
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_ui::{PresentationBlockingPolicy, PresentationSkipPolicy};
use er_types::{
    GameControlKindV2, GameControlPlanV2, PhysicalKey, PlatformRequestId, PresentationEventId,
    SafeU53, TerminalState,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::snapshot::{
    InputRouterSnapshotV2, KernelSchedulerSnapshotV2, PhysicalInputSourceV2,
    QuiescentPreparedTransaction,
};
use crate::snapshot_v6::RestorableKernelSnapshotV6;

pub const CORE_GAME_KERNEL_SNAPSHOT_SCHEMA_VERSION_V7: u32 = 7;
pub const MAX_PENDING_PRESENTATIONS_V7: usize = 4_096;
pub const MAX_PENDING_PLATFORM_REQUESTS_V7: usize = 256;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum GameKernelLifecycleSnapshotV7 {
    Bootstrap(RunBootstrapMachineV1),
    Active(GameStateV6),
    Terminal {
        state: GameStateV6,
        control: GameControlPlanV2,
        terminal: TerminalState,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingPresentationV3 {
    pub event_id: PresentationEventId,
    pub semantic: PresentationSemanticIdV1,
    pub blocking: PresentationBlockingPolicy,
    pub skip: PresentationSkipPolicy,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingPlatformRequestV2 {
    pub request_id: PlatformRequestId,
    pub effect: GamePlatformEffectV2,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoreGameKernelSnapshotV7 {
    pub schema_version: u32,
    pub lifecycle: GameKernelLifecycleSnapshotV7,
    pub input_router: InputRouterSnapshotV2,
    pub scheduler: KernelSchedulerSnapshotV2,
    pub protocol: Option<ProtocolRuntimeSnapshotV2>,
    pub pending_presentations: BTreeMap<PresentationEventId, PendingPresentationV3>,
    pub pending_platform: BTreeMap<PlatformRequestId, PendingPlatformRequestV2>,
    pub material_ledger: AppliedGameMaterialLedgerV1,
    pub replay_sequence: SafeU53,
    pub prepared_transaction: Option<QuiescentPreparedTransaction>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SnapshotV7Error {
    #[error("snapshot V7 is invalid")]
    Invalid,
    #[error("snapshot V6 cannot migrate at a non-quiescent or lossy boundary")]
    Migration,
}

impl CoreGameKernelSnapshotV7 {
    pub fn validate(&self, content: &PreparedGameContentV2) -> Result<(), SnapshotV7Error> {
        if self.schema_version != CORE_GAME_KERNEL_SNAPSHOT_SCHEMA_VERSION_V7
            || self.prepared_transaction.is_some()
            || self.pending_presentations.len() > MAX_PENDING_PRESENTATIONS_V7
            || self.pending_platform.len() > MAX_PENDING_PLATFORM_REQUESTS_V7
            || self.pending_presentations.iter().any(|(id, pending)| {
                *id != pending.event_id
                    || *id == PresentationEventId::ZERO
                    || content.presentation(pending.semantic).is_none()
            })
            || self.pending_platform.iter().any(|(id, pending)| {
                *id != pending.request_id
                    || *id == PlatformRequestId::ZERO
                    || platform_request_id(&pending.effect) != *id
                    || !valid_platform_effect(&pending.effect)
            })
        {
            return Err(SnapshotV7Error::Invalid);
        }
        self.input_router
            .validate()
            .map_err(|_| SnapshotV7Error::Invalid)?;
        self.scheduler
            .validate()
            .map_err(|_| SnapshotV7Error::Invalid)?;
        if let Some(protocol) = &self.protocol {
            protocol.validate().map_err(|_| SnapshotV7Error::Invalid)?;
        }
        self.material_ledger
            .validate()
            .map_err(|_| SnapshotV7Error::Invalid)?;
        match &self.lifecycle {
            GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) => {
                bootstrap.validate().map_err(|_| SnapshotV7Error::Invalid)?;
                if !self.input_router.pressed.is_empty()
                    || !self.input_router.held_buttons.is_empty()
                    || !self.input_router.locks.is_empty()
                    || !self.input_router.repeats.is_empty()
                    || !self.pending_platform.is_empty()
                {
                    return Err(SnapshotV7Error::Invalid);
                }
            }
            GameKernelLifecycleSnapshotV7::Active(state) => {
                validate_active_state(state, self, content)?;
            }
            GameKernelLifecycleSnapshotV7::Terminal {
                state,
                control,
                terminal,
            } => {
                validate_active_state(state, self, content)?;
                control.validate().map_err(|_| SnapshotV7Error::Invalid)?;
                if control.kind != GameControlKindV2::Complete
                    || terminal.terminal_id.is_empty()
                    || terminal.reason.is_empty()
                {
                    return Err(SnapshotV7Error::Invalid);
                }
            }
        }
        Ok(())
    }

    pub fn migrate_from_v6(
        source: RestorableKernelSnapshotV6,
        content: &PreparedGameContentV2,
    ) -> Result<Self, SnapshotV7Error> {
        source.validate().map_err(|_| SnapshotV7Error::Migration)?;
        if !source.prepared_transactions.is_empty()
            || !source.pending_presentations.is_empty()
            || source_pressed_keys(&source.input_router) != source.pressed_keys
        {
            return Err(SnapshotV7Error::Migration);
        }
        let state = GameStateV6::migrate_from_v5(source.game_state, content.identity().clone())
            .map_err(|_| SnapshotV7Error::Migration)?;
        state
            .validate_with(content)
            .map_err(|_| SnapshotV7Error::Migration)?;
        let next_revision = state
            .active_run
            .as_ref()
            .map_or(Ok(safe_one()), |run| next_revision(run.control.revision))?;
        let lifecycle = if let Some(terminal) = source.terminal {
            let control = state
                .active_run
                .as_ref()
                .map(|run| run.control.clone())
                .ok_or(SnapshotV7Error::Migration)?;
            GameKernelLifecycleSnapshotV7::Terminal {
                state,
                control,
                terminal,
            }
        } else {
            GameKernelLifecycleSnapshotV7::Active(state)
        };
        let value = Self {
            schema_version: CORE_GAME_KERNEL_SNAPSHOT_SCHEMA_VERSION_V7,
            lifecycle,
            input_router: source.input_router,
            scheduler: source.scheduler,
            protocol: source.protocol,
            pending_presentations: BTreeMap::new(),
            pending_platform: BTreeMap::new(),
            material_ledger: AppliedGameMaterialLedgerV1::new(next_revision)
                .map_err(|_| SnapshotV7Error::Migration)?,
            replay_sequence: source.replay_sequence,
            prepared_transaction: None,
        };
        value.validate(content)?;
        Ok(value)
    }
}

fn validate_active_state(
    state: &GameStateV6,
    snapshot: &CoreGameKernelSnapshotV7,
    content: &PreparedGameContentV2,
) -> Result<(), SnapshotV7Error> {
    state
        .validate_with(content)
        .map_err(|_| SnapshotV7Error::Invalid)?;
    if snapshot
        .pending_platform
        .keys()
        .any(|request| request.get() >= state.identities.next_platform_request_id)
    {
        return Err(SnapshotV7Error::Invalid);
    }
    if let Some(run) = &state.active_run {
        if snapshot.material_ledger.next_authority_revision <= run.control.revision {
            return Err(SnapshotV7Error::Invalid);
        }
    }
    Ok(())
}

fn source_pressed_keys(input: &InputRouterSnapshotV2) -> BTreeSet<PhysicalKey> {
    input
        .pressed
        .iter()
        .filter_map(|pressed| match &pressed.source {
            PhysicalInputSourceV2::Keyboard(key) => Some(key.clone()),
            PhysicalInputSourceV2::Gamepad(_) => None,
        })
        .collect()
}

fn platform_request_id(effect: &GamePlatformEffectV2) -> PlatformRequestId {
    match effect {
        GamePlatformEffectV2::StorageRead { request, .. }
        | GamePlatformEffectV2::StorageWrite { request, .. }
        | GamePlatformEffectV2::StorageDelete { request, .. }
        | GamePlatformEffectV2::StorageList { request }
        | GamePlatformEffectV2::AssetRequest { request, .. }
        | GamePlatformEffectV2::AudioCue { request, .. }
        | GamePlatformEffectV2::Telemetry { request, .. }
        | GamePlatformEffectV2::ReproReady { request, .. } => *request,
    }
}

fn valid_platform_effect(effect: &GamePlatformEffectV2) -> bool {
    match effect {
        GamePlatformEffectV2::StorageRead { slot, .. }
        | GamePlatformEffectV2::StorageDelete { slot, .. } => !slot.is_empty(),
        GamePlatformEffectV2::StorageWrite {
            slot,
            generation,
            bytes,
            ..
        } => !slot.is_empty() && *generation != SafeU53::ZERO && bytes.len() <= 8 * 1024 * 1024,
        GamePlatformEffectV2::ReproReady { kernel_digest, .. } => valid_digest(kernel_digest),
        GamePlatformEffectV2::StorageList { .. }
        | GamePlatformEffectV2::AssetRequest { .. }
        | GamePlatformEffectV2::AudioCue { .. }
        | GamePlatformEffectV2::Telemetry { .. } => true,
    }
}

fn valid_digest(value: &str) -> bool {
    value.strip_prefix("blake3-v1:").is_some_and(|body| {
        body.len() == 64
            && body
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn next_revision(value: SafeU53) -> Result<SafeU53, SnapshotV7Error> {
    let next = value
        .get()
        .checked_add(1)
        .ok_or(SnapshotV7Error::Migration)?;
    SafeU53::new(next).map_err(|_| SnapshotV7Error::Migration)
}

fn safe_one() -> SafeU53 {
    SafeU53::new(1).unwrap_or(SafeU53::MAX)
}
