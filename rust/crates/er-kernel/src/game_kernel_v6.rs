//! M7 kernel owner over GameRuntimeV5 and complete deterministic environment state.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use er_battle::m7_resolver::{BattlePresentationCueV5, TurnAuthorityContextV1};
use er_game::m7_content::PreparedGameContentV1;
use er_game::m7_material::{BattleTurnMaterialV5, MaterialApplyResultV5};
use er_game::m7_runtime::{
    GameControlIntentV2, GameRuntimeSnapshotV5, GameRuntimeV5, GameRuntimeV5Error, PreparedTurnV5,
};
use er_protocol::{ProtocolRuntimeSnapshotV2, ScheduledTimer};
use er_state::m7_state::GameStateV5;
use er_types::battle_command::CommandSet;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::ui_menu::NavigationDirection;
use er_types::{GameControlKindV2, MenuOptionId, OperationId, SafeU53, TerminalState};
use thiserror::Error;

use crate::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use crate::snapshot_v6::{
    PreparedTransactionSnapshotV1, RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V6,
    RestorableKernelSnapshotV6, SnapshotV6Error,
};
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum KernelControlEffectV6 {
    Navigated,
    Selected {
        kind: GameControlKindV2,
        option: MenuOptionId,
    },
    Cancelled {
        kind: GameControlKindV2,
    },
}

#[derive(Clone, Debug)]
pub struct GameKernelV6 {
    runtime: GameRuntimeV5,
    input_router: InputRouterSnapshotV2,
    pressed_keys: BTreeSet<PhysicalKey>,
    scheduler: KernelSchedulerSnapshotV2,
    protocol: Option<ProtocolRuntimeSnapshotV2>,
    pending_presentations: Vec<BattlePresentationCueV5>,
    replay_sequence: SafeU53,
    terminal: Option<TerminalState>,
}

#[derive(Debug, Error)]
pub enum GameKernelV6Error {
    #[error("GameRuntimeV5 failed: {0}")]
    StateOwner(String),
    #[error("Snapshot V6 failed: {0}")]
    Snapshot(String),
    #[error("snapshot transaction bytes are invalid or collide")]
    Transaction,
}

impl GameKernelV6 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        state: GameStateV5,
        content: Arc<PreparedGameContentV1>,
        input_router: InputRouterSnapshotV2,
        scheduler: KernelSchedulerSnapshotV2,
        protocol: Option<ProtocolRuntimeSnapshotV2>,
        replay_sequence: SafeU53,
        terminal: Option<TerminalState>,
    ) -> Result<Self, GameKernelV6Error> {
        let runtime = GameRuntimeV5::new(state, content)
            .map_err(|error| GameKernelV6Error::StateOwner(error.to_string()))?;
        let kernel = Self {
            runtime,
            input_router,
            pressed_keys: BTreeSet::new(),
            scheduler,
            protocol,
            pending_presentations: Vec::new(),
            replay_sequence,
            terminal,
        };
        kernel
            .snapshot()
            .validate()
            .map_err(|error| GameKernelV6Error::Snapshot(error.to_string()))?;
        Ok(kernel)
    }

    pub fn from_snapshot(
        snapshot: RestorableKernelSnapshotV6,
        content: Arc<PreparedGameContentV1>,
    ) -> Result<Self, GameKernelV6Error> {
        snapshot
            .validate()
            .map_err(|error| GameKernelV6Error::Snapshot(error.to_string()))?;
        let mut applied_materials = BTreeMap::new();
        for transaction in &snapshot.prepared_transactions {
            let material = BattleTurnMaterialV5::decode_canonical(&transaction.material_bytes)
                .map_err(|_| GameKernelV6Error::Transaction)?;
            if material.operation_id != transaction.operation_id
                || material.before_digest != transaction.before_digest
                || applied_materials
                    .insert(
                        transaction.operation_id.clone(),
                        transaction.material_bytes.clone(),
                    )
                    .is_some()
            {
                return Err(GameKernelV6Error::Transaction);
            }
        }
        let runtime = GameRuntimeV5::from_snapshot(
            GameRuntimeSnapshotV5 {
                content_identity: snapshot.content_identity,
                state: snapshot.game_state,
                applied_materials,
            },
            content,
        )
        .map_err(|error| GameKernelV6Error::StateOwner(error.to_string()))?;
        Ok(Self {
            runtime,
            input_router: snapshot.input_router,
            pressed_keys: snapshot.pressed_keys,
            scheduler: snapshot.scheduler,
            protocol: snapshot.protocol,
            pending_presentations: snapshot.pending_presentations,
            replay_sequence: snapshot.replay_sequence,
            terminal: snapshot.terminal,
        })
    }

    pub fn snapshot(&self) -> RestorableKernelSnapshotV6 {
        let runtime = self.runtime.snapshot();
        let prepared_transactions = runtime
            .applied_materials
            .iter()
            .filter_map(|(operation_id, bytes)| {
                BattleTurnMaterialV5::decode_canonical(bytes)
                    .ok()
                    .map(|material| PreparedTransactionSnapshotV1 {
                        operation_id: operation_id.clone(),
                        before_digest: material.before_digest,
                        material_bytes: bytes.clone(),
                    })
            })
            .collect();
        RestorableKernelSnapshotV6 {
            schema_version: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V6,
            content_identity: runtime.content_identity,
            game_state: runtime.state,
            input_router: self.input_router.clone(),
            pressed_keys: self.pressed_keys.clone(),
            scheduler: self.scheduler.clone(),
            protocol: self.protocol.clone(),
            pending_presentations: self.pending_presentations.clone(),
            prepared_transactions,
            replay_sequence: self.replay_sequence,
            terminal: self.terminal.clone(),
        }
    }

    pub fn state(&self) -> &GameStateV5 {
        self.runtime.state()
    }
    pub fn raw_input(
        &mut self,
        event: RawInputEvent,
    ) -> Result<Option<KernelControlEffectV6>, GameKernelV6Error> {
        match event {
            RawInputEvent::KeyDown {
                code,
                browser_repeat,
                focus,
                ..
            } => {
                if focus != InputFocus::Game
                    || browser_repeat
                    || !self.pressed_keys.insert(code.clone())
                {
                    return Ok(None);
                }
                self.handle_physical_key(code)
            }
            RawInputEvent::KeyUp { code } => {
                self.pressed_keys.remove(&code);
                Ok(None)
            }
            RawInputEvent::GamepadDown { button } => self.handle_gamepad_button(button),
            RawInputEvent::GamepadUp { .. } => Ok(None),
            RawInputEvent::FocusChanged(InputFocus::TextEntry) | RawInputEvent::WindowBlurred => {
                self.pressed_keys.clear();
                Ok(None)
            }
            RawInputEvent::FocusChanged(InputFocus::Game) | RawInputEvent::WindowFocused => {
                Ok(None)
            }
        }
    }
    pub fn advance_time(
        &mut self,
        milliseconds: SafeU53,
    ) -> Result<Vec<ScheduledTimer>, GameKernelV6Error> {
        let mut retained = Vec::with_capacity(self.scheduler.timers.len());
        let mut fired = Vec::new();
        for mut timer in std::mem::take(&mut self.scheduler.timers) {
            let paused = self.scheduler.pauses.iter().any(|pause| {
                pause.endpoint == timer.registration.endpoint
                    && pause.time_class == timer.registration.time_class
                    && !pause.reasons.is_empty()
            });
            if paused {
                retained.push(timer);
                continue;
            }
            if milliseconds >= timer.remaining_active_ms {
                fired.push(timer.registration);
                continue;
            }
            let remaining = timer
                .remaining_active_ms
                .get()
                .checked_sub(milliseconds.get())
                .and_then(|value| SafeU53::new(value).ok())
                .ok_or(GameKernelV6Error::Transaction)?;
            timer.remaining_active_ms = remaining;
            retained.push(timer);
        }
        self.scheduler.timers = retained;
        Ok(fired)
    }

    fn handle_physical_key(
        &mut self,
        code: PhysicalKey,
    ) -> Result<Option<KernelControlEffectV6>, GameKernelV6Error> {
        match code {
            PhysicalKey::ArrowUp => self.navigate(NavigationDirection::Up),
            PhysicalKey::ArrowDown => self.navigate(NavigationDirection::Down),
            PhysicalKey::ArrowLeft => self.navigate(NavigationDirection::Left),
            PhysicalKey::ArrowRight => self.navigate(NavigationDirection::Right),
            PhysicalKey::Enter | PhysicalKey::Space => self
                .runtime
                .select_control()
                .map(intent_effect)
                .map(Some)
                .map_err(|error| GameKernelV6Error::StateOwner(error.to_string())),
            PhysicalKey::Escape | PhysicalKey::Backspace => self
                .runtime
                .cancel_control()
                .map(intent_effect)
                .map(Some)
                .map_err(|error| GameKernelV6Error::StateOwner(error.to_string())),
            _ => Ok(None),
        }
    }

    fn handle_gamepad_button(
        &mut self,
        button: u16,
    ) -> Result<Option<KernelControlEffectV6>, GameKernelV6Error> {
        match button {
            12 => self.navigate(NavigationDirection::Up),
            13 => self.navigate(NavigationDirection::Down),
            14 => self.navigate(NavigationDirection::Left),
            15 => self.navigate(NavigationDirection::Right),
            0 => self
                .runtime
                .submit_control()
                .map(intent_effect)
                .map(Some)
                .map_err(|error| GameKernelV6Error::StateOwner(error.to_string())),
            1 => self
                .runtime
                .cancel_control()
                .map(intent_effect)
                .map(Some)
                .map_err(|error| GameKernelV6Error::StateOwner(error.to_string())),
            _ => Ok(None),
        }
    }

    fn navigate(
        &mut self,
        direction: NavigationDirection,
    ) -> Result<Option<KernelControlEffectV6>, GameKernelV6Error> {
        self.runtime
            .navigate_control(direction)
            .map_err(|error| GameKernelV6Error::StateOwner(error.to_string()))?;
        Ok(Some(KernelControlEffectV6::Navigated))
    }

    pub fn resolve_authoritative_turn(
        &mut self,
        operation_id: OperationId,
        commands: &CommandSet,
        authority: &TurnAuthorityContextV1,
    ) -> Result<PreparedTurnV5, GameKernelV6Error> {
        let prepared = self
            .runtime
            .resolve_and_apply_authoritative_turn(operation_id, commands, authority)
            .map_err(|error| GameKernelV6Error::StateOwner(error.to_string()))?;
        self.pending_presentations
            .extend(prepared.material.presentation.clone());
        self.advance_replay_sequence()?;
        Ok(prepared)
    }

    pub fn apply_replica_material(
        &mut self,
        bytes: &[u8],
    ) -> Result<MaterialApplyResultV5, GameKernelV6Error> {
        let material = BattleTurnMaterialV5::decode_canonical(bytes)
            .map_err(|error| GameKernelV6Error::StateOwner(error.to_string()))?;
        let result = self
            .runtime
            .apply_material_bytes(bytes)
            .map_err(|error| GameKernelV6Error::StateOwner(error.to_string()))?;
        if result == MaterialApplyResultV5::Applied {
            self.pending_presentations.extend(material.presentation);
            self.advance_replay_sequence()?;
        }
        Ok(result)
    }

    fn advance_replay_sequence(&mut self) -> Result<(), GameKernelV6Error> {
        let next = self
            .replay_sequence
            .get()
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or(GameKernelV6Error::Transaction)?;
        self.replay_sequence = next;
        Ok(())
    }

    pub fn pending_presentations(&self) -> &[BattlePresentationCueV5] {
        &self.pending_presentations
    }

    pub fn clear_presentations(&mut self) {
        self.pending_presentations.clear();
    }
}

fn intent_effect(intent: GameControlIntentV2) -> KernelControlEffectV6 {
    match intent {
        GameControlIntentV2::Selected { kind, option } => {
            KernelControlEffectV6::Selected { kind, option }
        }
        GameControlIntentV2::Cancelled { kind } => KernelControlEffectV6::Cancelled { kind },
    }
}

impl From<GameRuntimeV5Error> for GameKernelV6Error {
    fn from(error: GameRuntimeV5Error) -> Self {
        Self::StateOwner(error.to_string())
    }
}

impl From<SnapshotV6Error> for GameKernelV6Error {
    fn from(error: SnapshotV6Error) -> Self {
        Self::Snapshot(error.to_string())
    }
}
