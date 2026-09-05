use std::collections::BTreeSet;

use er_ai::authority_v2::{AuthorityAiSnapshotV2, AuthorityAiV2};
use er_game::m9e_content_v2::{PreparedGameContentV2, PresentationSemanticIdV1};
use er_game::m9e_material_v6::{AppliedGameMaterialLedgerV1, GamePlatformEffectV2};
use er_game::m72_bootstrap::RunBootstrapMachineV1;
use er_protocol::ProtocolRuntimeSnapshotV2;
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_ids::MenuInstanceId;
use er_types::battle_ui::{PresentationBlockingPolicy, PresentationSkipPolicy};
use er_types::{
    GameControlKindV2, GameControlPlanV2, PhysicalKey, PlatformRequestId, PresentationEventId,
    SafeU53, SeatId, TerminalState, TimeClass, TimerOwner,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::game_kernel_v7::{NAVIGATION_REPEAT_INTERVAL_MS_V7, navigation_button_v7};
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StorageFrontierSnapshotV1 {
    pub slot: String,
    pub generation: SafeU53,
}

/// Exact authoritative control and local return selection for private battle UI.
/// Neither control is reconstructed from the allocator or a neighbouring ID.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrivateBattleControlSnapshotV7 {
    pub owner_seat: SeatId,
    pub canonical_control: GameControlPlanV2,
    pub return_control: GameControlPlanV2,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoreGameKernelSnapshotV7 {
    pub schema_version: u32,
    pub lifecycle: GameKernelLifecycleSnapshotV7,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_battle_control: Option<PrivateBattleControlSnapshotV7>,
    pub authority_ai: Option<AuthorityAiSnapshotV2>,
    pub input_router: InputRouterSnapshotV2,
    pub scheduler: KernelSchedulerSnapshotV2,
    pub next_menu_instance_id: MenuInstanceId,
    pub protocol: Option<ProtocolRuntimeSnapshotV2>,
    pub pending_presentations: Vec<PendingPresentationV3>,
    pub pending_platform: Vec<PendingPlatformRequestV2>,
    pub storage_frontiers: Vec<StorageFrontierSnapshotV1>,
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
            || self.next_menu_instance_id == MenuInstanceId::ZERO
            || self.prepared_transaction.is_some()
            || self.pending_presentations.len() > MAX_PENDING_PRESENTATIONS_V7
            || self.pending_platform.len() > MAX_PENDING_PLATFORM_REQUESTS_V7
            || self
                .pending_presentations
                .windows(2)
                .any(|pair| pair[0].event_id >= pair[1].event_id)
            || self.pending_presentations.iter().any(|pending| {
                pending.event_id == PresentationEventId::ZERO
                    || content.presentation(pending.semantic).is_none()
            })
            || self
                .pending_platform
                .windows(2)
                .any(|pair| pair[0].request_id >= pair[1].request_id)
            || self.pending_platform.iter().any(|pending| {
                pending.request_id == PlatformRequestId::ZERO
                    || platform_request_id(&pending.effect) != pending.request_id
                    || !valid_platform_effect(&pending.effect)
            })
            || self
                .storage_frontiers
                .windows(2)
                .any(|pair| pair[0].slot >= pair[1].slot)
            || self
                .storage_frontiers
                .iter()
                .any(|frontier| frontier.slot.is_empty() || frontier.generation == SafeU53::ZERO)
        {
            return Err(SnapshotV7Error::Invalid);
        }
        self.input_router
            .validate()
            .map_err(|_| SnapshotV7Error::Invalid)?;
        self.scheduler
            .validate()
            .map_err(|_| SnapshotV7Error::Invalid)?;
        self.validate_repeat_ownership()?;
        if let Some(protocol) = &self.protocol {
            protocol.validate().map_err(|_| SnapshotV7Error::Invalid)?;
        }
        self.material_ledger
            .validate()
            .map_err(|_| SnapshotV7Error::Invalid)?;
        if let Some(snapshot) = &self.authority_ai {
            AuthorityAiV2::from_snapshot(content.ai.clone(), snapshot.clone())
                .map_err(|_| SnapshotV7Error::Invalid)?;
        }
        match &self.lifecycle {
            GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) => {
                bootstrap.validate().map_err(|_| SnapshotV7Error::Invalid)?;
                if self.private_battle_control.is_some()
                    || !self.input_router.pressed.is_empty()
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
                crate::game_kernel_v7::validate_private_battle_control_v7(
                    state,
                    self.private_battle_control.as_ref(),
                    self.material_ledger.next_authority_revision,
                )
                .map_err(|_| SnapshotV7Error::Invalid)?;
                let canonical_control = self
                    .private_battle_control
                    .as_ref()
                    .map(|owner| &owner.canonical_control)
                    .or_else(|| {
                        state
                            .active_run
                            .as_ref()
                            .filter(|run| run.control.kind == GameControlKindV2::BattleCommand)
                            .map(|run| &run.control)
                    });
                if let Some(control) = canonical_control
                    && let Some(record) = self
                        .material_ledger
                        .records
                        .iter()
                        .max_by_key(|record| record.authority_revision)
                {
                    let mut canonical_state = state.clone();
                    canonical_state
                        .active_run
                        .as_mut()
                        .ok_or(SnapshotV7Error::Invalid)?
                        .control = control.clone();
                    if er_game::m9e_material_v6::game_state_digest(&canonical_state)
                        .map_err(|_| SnapshotV7Error::Invalid)?
                        != record.after_digest
                    {
                        return Err(SnapshotV7Error::Invalid);
                    }
                }
            }
            GameKernelLifecycleSnapshotV7::Terminal {
                state,
                control,
                terminal,
            } => {
                validate_active_state(state, self, content)?;
                control.validate().map_err(|_| SnapshotV7Error::Invalid)?;
                if self.private_battle_control.is_some()
                    || control.kind != GameControlKindV2::Complete
                    || terminal.terminal_id.is_empty()
                    || terminal.reason.is_empty()
                {
                    return Err(SnapshotV7Error::Invalid);
                }
            }
        }
        if current_menu_instance(&self.lifecycle)
            .is_some_and(|instance| instance >= self.next_menu_instance_id)
        {
            return Err(SnapshotV7Error::Invalid);
        }
        Ok(())
    }

    fn validate_repeat_ownership(&self) -> Result<(), SnapshotV7Error> {
        let mut logical_owners = BTreeSet::new();
        let active_control = match &self.lifecycle {
            GameKernelLifecycleSnapshotV7::Active(state) => {
                state.active_run.as_ref().map(|run| &run.control)
            }
            _ => None,
        };
        for repeat in &self.input_router.repeats {
            if !logical_owners.insert((repeat.seat, repeat.button, repeat.menu_instance_id))
                || self.input_router.focus != er_types::InputFocus::Game
                || navigation_button_v7(&repeat.source) != Some(repeat.button)
                || !active_control.is_some_and(|control| {
                    control.actionable
                        && control
                            .menu
                            .as_ref()
                            .is_some_and(|menu| menu.instance_id == repeat.menu_instance_id)
                })
                || self
                    .pending_presentations
                    .iter()
                    .any(|pending| pending.blocking == PresentationBlockingPolicy::BlocksHumanInput)
                || !self.input_router.locks.iter().any(|lock| {
                    lock.seat == repeat.seat
                        && lock.button == repeat.button
                        && lock.menu_instance_id == repeat.menu_instance_id
                })
                || !self.scheduler.timers.iter().any(|timer| {
                    timer.registration.timer_id == repeat.timer_id
                        && timer.registration.endpoint == repeat.seat
                        && timer.registration.owner == TimerOwner::input_repeat(repeat.button)
                        && timer.registration.time_class == TimeClass::HumanInput
                        && timer.registration.delay_ms == NAVIGATION_REPEAT_INTERVAL_MS_V7
                })
            {
                return Err(SnapshotV7Error::Invalid);
            }
        }
        let mut timer_ids = BTreeSet::new();
        for timer in &self.scheduler.timers {
            if !timer_ids.insert(timer.registration.timer_id) {
                return Err(SnapshotV7Error::Invalid);
            }
            if timer.registration.owner.owner_id == "input-router"
                && timer.registration.owner.reason == "input-repeat"
                && !self.input_router.repeats.iter().any(|repeat| {
                    repeat.timer_id == timer.registration.timer_id
                        && repeat.seat == timer.registration.endpoint
                        && timer.registration.owner == TimerOwner::input_repeat(repeat.button)
                })
            {
                return Err(SnapshotV7Error::Invalid);
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
        let next_menu_instance_id = next_menu_instance_from_v6(&source)?;
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
            private_battle_control: None,
            input_router: source.input_router,
            scheduler: source.scheduler,
            protocol: source.protocol,
            pending_presentations: Vec::new(),
            pending_platform: Vec::new(),
            storage_frontiers: Vec::new(),
            material_ledger: AppliedGameMaterialLedgerV1::new(next_revision)
                .map_err(|_| SnapshotV7Error::Migration)?,
            authority_ai: None,
            next_menu_instance_id,
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
        .iter()
        .any(|pending| pending.request_id.get() >= state.identities.next_platform_request_id)
    {
        return Err(SnapshotV7Error::Invalid);
    }
    if let Some(run) = &state.active_run {
        if snapshot.material_ledger.next_authority_revision < run.control.revision {
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

fn current_menu_instance(lifecycle: &GameKernelLifecycleSnapshotV7) -> Option<MenuInstanceId> {
    match lifecycle {
        GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) => {
            Some(bootstrap.menu_instance_high_water)
        }
        GameKernelLifecycleSnapshotV7::Active(state) => state
            .active_run
            .as_ref()
            .and_then(|run| run.control.menu.as_ref())
            .map(|menu| menu.instance_id),
        GameKernelLifecycleSnapshotV7::Terminal { control, .. } => {
            control.menu.as_ref().map(|menu| menu.instance_id)
        }
    }
}

fn next_menu_instance_from_v6(
    source: &RestorableKernelSnapshotV6,
) -> Result<MenuInstanceId, SnapshotV7Error> {
    let mut maximum = source
        .game_state
        .active_run
        .as_ref()
        .and_then(|run| run.control.menu.as_ref())
        .map(|menu| menu.instance_id.get())
        .unwrap_or(SafeU53::ZERO);
    for candidate in source
        .input_router
        .pressed
        .iter()
        .filter_map(|pressed| pressed.menu_instance_id)
        .chain(
            source
                .input_router
                .held_buttons
                .iter()
                .map(|held| held.menu_instance_id),
        )
        .chain(
            source
                .input_router
                .locks
                .iter()
                .map(|lock| lock.menu_instance_id),
        )
        .chain(
            source
                .input_router
                .repeats
                .iter()
                .map(|repeat| repeat.menu_instance_id),
        )
    {
        if candidate.get() > maximum {
            maximum = candidate.get();
        }
    }
    let next = maximum
        .get()
        .checked_add(1)
        .ok_or(SnapshotV7Error::Migration)?;
    SafeU53::new(next)
        .map(MenuInstanceId::new)
        .map_err(|_| SnapshotV7Error::Migration)
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
