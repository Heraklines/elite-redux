//! Closed endpoint snapshots for the production M3 battle kernel.
//!
//! This module deliberately keeps live-owner access at the integration seam:
//! sibling owner modules do not expose their private maps.  The DTOs and
//! pure validation here are complete, while the bridge trait makes it
//! impossible for integration code to mistake DTO-only validation for live
//! continuation.

use std::collections::BTreeSet;
use std::fmt;
use std::sync::Arc;

use er_canonical::content_digest;
use er_content::pack::ContentPack;
use er_game::snapshot::GameRuntimeSnapshotV2;
use er_protocol::{
    AuthorityLogConfig, AuthorityReplicaConfig, KernelScheduler, KernelSchedulerPauseState,
    KernelSchedulerRestorableState, KernelSchedulerTimerState, ProposalLeaseConfig,
    ProtocolRuntimeSnapshotV2, RecoveryTransactionConfig, ScheduledTimer,
};
pub use er_rng::audit::RngDraw;
pub use er_state::digest::MechanicalStateDigest;
pub use er_types::LiveResourceSnapshot;
use er_types::OperationId;
use er_types::battle_ids::{BattlePresentationEventId, ContentPackHash, MenuInstanceId};
use er_types::battle_ui::{
    BattlePresentationEvent, BattleUiProjection, PresentationPlanDigest,
    PresentationSettlementOutcome,
};
use er_types::{
    GameButton, InputFocus, PhysicalKey, SafeU53, SeatId, TerminalState, TimeClass, TimerId,
    TransportState,
};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error as _, ser::Error as _};
use thiserror::Error;

use crate::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};

/// Integration seam for `GameKernel`'s private owner graph.
///
/// The implementation belongs in `kernel.rs`/`battle_kernel.rs`, where the
/// battle mode, input router, scheduler, protocol state, FIFO transaction
/// queue, presentation barriers, terminal state, and live-resource projection
/// are visible. Implementations must extract exact state, validate before
/// mutation, and construct a fresh kernel so an error cannot partially restore
/// an existing endpoint.
pub trait GameKernelSnapshotBridge: Sized {
    fn snapshot_v2(&self) -> Result<RestorableKernelSnapshotV2, SnapshotError>;

    #[doc(hidden)]
    fn accept_shared_terminal_root(
        &mut self,
        terminal: &TerminalState,
    ) -> Result<(), SnapshotError>;

    fn from_snapshot_v2(
        snapshot: RestorableKernelSnapshotV2,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError>;
}

/// Validate a bridge-produced endpoint snapshot before publishing it.
pub fn snapshot_game_kernel<B: GameKernelSnapshotBridge>(
    kernel: &B,
) -> Result<RestorableKernelSnapshotV2, SnapshotError> {
    let snapshot = kernel.snapshot_v2()?;
    snapshot.validate()?;
    Ok(snapshot)
}

/// Validate content and all cross-owner invariants before delegating to the
/// owner-specific constructor. The bridge implementation must be fail-atomic
/// and must not repair, default, or renumber snapshot state.
pub fn restore_game_kernel<B: GameKernelSnapshotBridge>(
    snapshot: RestorableKernelSnapshotV2,
    content: Arc<ContentPack>,
) -> Result<B, SnapshotError> {
    snapshot.validate_for_content(content.as_ref())?;
    B::from_snapshot_v2(snapshot, content)
}

pub const RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION: u32 = 2;
pub const BATTLE_KERNEL_RUNTIME_IDENTITY_SCHEMA_VERSION: u32 = 1;
pub const KERNEL_DETERMINISM_DIGEST_DOMAIN: &str = "pokerogue-redux/m3/kernel-determinism/v1";
pub const KERNEL_DETERMINISM_DIGEST_PREFIX: &str = "blake3-v1:";

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// The uninhabited transaction marker makes `prepared_transaction: null` the
/// only possible serialized value at a public quiescent boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum QuiescentPreparedTransaction {}

impl Serialize for QuiescentPreparedTransaction {
    fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        Err(S::Error::custom(
            "QuiescentPreparedTransaction is uninhabited",
        ))
    }
}

impl<'de> Deserialize<'de> for QuiescentPreparedTransaction {
    fn deserialize<D>(_deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Err(D::Error::custom(
            "QuiescentPreparedTransaction is uninhabited",
        ))
    }
}

/// Explicit endpoint identity required to rebuild a battle kernel.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleKernelRuntimeIdentitySnapshotV1 {
    pub local_seat: SeatId,
    pub protocol_config: BattleProtocolConfig,
}

/// Exact physical source retained by the battle input router.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum PhysicalInputSourceV2 {
    Keyboard(PhysicalKey),
    Gamepad(u16),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PressedPhysicalInputSnapshotV2 {
    pub seat: SeatId,
    pub source: PhysicalInputSourceV2,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub logical_button: Option<GameButton>,
    pub printable: bool,
    pub accepted: bool,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub menu_instance_id: Option<MenuInstanceId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HeldLogicalButtonSnapshotV2 {
    pub seat: SeatId,
    pub button: GameButton,
    pub source: PhysicalInputSourceV2,
    pub menu_instance_id: MenuInstanceId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputButtonLockSnapshotV2 {
    pub seat: SeatId,
    pub button: GameButton,
    pub menu_instance_id: MenuInstanceId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputRepeatSnapshotV2 {
    pub seat: SeatId,
    pub button: GameButton,
    pub source: PhysicalInputSourceV2,
    pub menu_instance_id: MenuInstanceId,
    pub timer_id: TimerId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputRouterSnapshotV2 {
    pub focus: InputFocus,
    pub pressed: Vec<PressedPhysicalInputSnapshotV2>,
    pub suppressed_printable_keys: Vec<PhysicalKey>,
    pub held_buttons: Vec<HeldLogicalButtonSnapshotV2>,
    pub locks: Vec<InputButtonLockSnapshotV2>,
    pub repeats: Vec<InputRepeatSnapshotV2>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorableTimerSnapshotV2 {
    pub registration: ScheduledTimer,
    pub original_delay_ms: SafeU53,
    pub remaining_active_ms: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimeClassPauseSnapshotV2 {
    pub endpoint: SeatId,
    pub time_class: TimeClass,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelSchedulerSnapshotV2 {
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub next_timer_id: Option<SafeU53>,
    pub timers: Vec<RestorableTimerSnapshotV2>,
    pub pauses: Vec<TimeClassPauseSnapshotV2>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationOutcomeSnapshotV1 {
    pub event_id: BattlePresentationEventId,
    pub outcome: PresentationSettlementOutcome,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationPlanSnapshotV1 {
    pub operation_id: OperationId,
    pub events: Vec<BattlePresentationEvent>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingPresentationsSnapshotV1 {
    pub local_endpoint: SeatId,
    pub plans: Vec<PresentationPlanSnapshotV1>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub last_plan_operation_id: Option<OperationId>,
    pub pending_barrier_ids: Vec<BattlePresentationEventId>,
    pub blocking_barrier_ids: Vec<BattlePresentationEventId>,
    pub outcomes: Vec<PresentationOutcomeSnapshotV1>,
    pub event_catalog: Vec<BattlePresentationEvent>,
    pub presentation_failed: bool,
    pub disposed: bool,
}

impl PendingPresentationsSnapshotV1 {
    /// Return complete causal presentation-plan content in the owner's
    /// operation-ID order. The digest and presenter cross-check use every
    /// retained plan, not a single "current" plan projection.
    pub fn plan_events(&self) -> Vec<BattlePresentationEvent> {
        self.plans
            .iter()
            .flat_map(|plan| plan.events.iter().cloned())
            .collect()
    }
}

/// Checked wrapper for the endpoint determinism digest.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct KernelDeterminismDigest(String);

impl KernelDeterminismDigest {
    pub fn new(value: impl Into<String>) -> Result<Self, SnapshotError> {
        let value = value.into();
        let Some(hex) = value.strip_prefix(KERNEL_DETERMINISM_DIGEST_PREFIX) else {
            return Err(invalid(
                "kernel_determinism_digest",
                "must start with blake3-v1:",
            ));
        };
        if hex.len() != 64
            || !hex
                .bytes()
                .all(|digit| matches!(digit, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err(invalid(
                "kernel_determinism_digest",
                "must contain exactly 64 lowercase hexadecimal digits",
            ));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }

    pub fn compute(snapshot: &RestorableKernelSnapshotV2) -> Result<Self, SnapshotError> {
        let raw = content_digest(&KernelDigestPreimage {
            domain: KERNEL_DETERMINISM_DIGEST_DOMAIN,
            schema_version: snapshot.schema_version,
            content_hash: &snapshot.content_hash,
            runtime_identity: &snapshot.runtime_identity,
            input_router: &snapshot.input_router,
            ui: &snapshot.ui,
            scheduler: &snapshot.scheduler,
            protocol: &snapshot.protocol,
            game: &snapshot.game,
            pending_presentations: &snapshot.pending_presentations,
            terminal: &snapshot.terminal,
            disposed: snapshot.disposed,
            prepared_transaction: &snapshot.prepared_transaction,
        })
        .map_err(|error| SnapshotError::Canonical {
            path: "kernel_determinism_digest".to_owned(),
            reason: error.to_string(),
        })?;
        Self::new(format!("{KERNEL_DETERMINISM_DIGEST_PREFIX}{raw}"))
    }
}

impl<'de> Deserialize<'de> for KernelDeterminismDigest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

impl fmt::Display for KernelDeterminismDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Serialize)]
struct KernelDigestPreimage<'a> {
    domain: &'static str,
    schema_version: u32,
    content_hash: &'a ContentPackHash,
    runtime_identity: &'a BattleKernelRuntimeIdentitySnapshotV1,
    input_router: &'a InputRouterSnapshotV2,
    ui: &'a BattleUiProjection,
    scheduler: &'a KernelSchedulerSnapshotV2,
    protocol: &'a ProtocolRuntimeSnapshotV2,
    game: &'a GameRuntimeSnapshotV2,
    pending_presentations: &'a PendingPresentationsSnapshotV1,
    terminal: &'a Option<TerminalState>,
    disposed: bool,
    prepared_transaction: &'a Option<QuiescentPreparedTransaction>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BattleProtocolConfigWire {
    role: BattleProtocolRoleConfigWire,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
enum BattleProtocolRoleConfigWire {
    Authority {
        log: AuthorityLogConfig,
        proposal_capacity: SafeU53,
    },
    Replica {
        replica: AuthorityReplicaConfig,
        proposal_leases: ProposalLeaseConfig,
        recovery: RecoveryTransactionConfig,
    },
}

impl Serialize for BattleProtocolConfig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let role = match &self.role {
            BattleProtocolRoleConfig::Authority {
                log,
                proposal_capacity,
            } => BattleProtocolRoleConfigWire::Authority {
                log: log.clone(),
                proposal_capacity: *proposal_capacity,
            },
            BattleProtocolRoleConfig::Replica {
                replica,
                proposal_leases,
                recovery,
            } => BattleProtocolRoleConfigWire::Replica {
                replica: replica.clone(),
                proposal_leases: proposal_leases.clone(),
                recovery: recovery.clone(),
            },
        };
        BattleProtocolConfigWire { role }.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for BattleProtocolConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = BattleProtocolConfigWire::deserialize(deserializer)?;
        let role = match wire.role {
            BattleProtocolRoleConfigWire::Authority {
                log,
                proposal_capacity,
            } => BattleProtocolRoleConfig::Authority {
                log,
                proposal_capacity,
            },
            BattleProtocolRoleConfigWire::Replica {
                replica,
                proposal_leases,
                recovery,
            } => BattleProtocolRoleConfig::Replica {
                replica,
                proposal_leases,
                recovery,
            },
        };
        Ok(Self { role })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorableKernelSnapshotV2 {
    pub schema_version: u32,
    pub content_hash: ContentPackHash,
    pub runtime_identity: BattleKernelRuntimeIdentitySnapshotV1,
    pub input_router: InputRouterSnapshotV2,
    pub ui: BattleUiProjection,
    pub scheduler: KernelSchedulerSnapshotV2,
    pub protocol: ProtocolRuntimeSnapshotV2,
    pub game: GameRuntimeSnapshotV2,
    pub pending_presentations: PendingPresentationsSnapshotV1,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub terminal: Option<TerminalState>,
    pub disposed: bool,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub prepared_transaction: Option<QuiescentPreparedTransaction>,
    pub mechanical_digest: MechanicalStateDigest,
    pub kernel_determinism_digest: KernelDeterminismDigest,
    pub presentation_plan_digest: PresentationPlanDigest,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SnapshotError {
    #[error("snapshot field {path} is invalid: {reason}")]
    Invalid { path: String, reason: String },
    #[error("snapshot canonicalization failed at {path}: {reason}")]
    Canonical { path: String, reason: String },
}

fn invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn canonical(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Canonical {
        path: path.into(),
        reason: reason.into(),
    }
}

fn strictly_sorted<T: Ord>(values: &[T], path: &str) -> Result<(), SnapshotError> {
    if values.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(invalid(
            path,
            "entries must be strictly increasing and duplicate-free",
        ));
    }
    Ok(())
}

fn strictly_unique<T: Ord + Clone>(values: &[T], path: &str) -> Result<(), SnapshotError> {
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    if sorted.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(invalid(path, "entries must be duplicate-free"));
    }
    Ok(())
}

fn validate_timer_owner(owner: &er_types::TimerOwner, path: &str) -> Result<(), SnapshotError> {
    if owner.owner_id.is_empty() || owner.address.is_empty() || owner.reason.is_empty() {
        return Err(invalid(
            path,
            "timer owner ID, address, and reason must all be non-empty",
        ));
    }
    Ok(())
}

impl InputRouterSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        strictly_sorted(
            &self
                .pressed
                .iter()
                .map(|value| (value.seat, value.source.clone()))
                .collect::<Vec<_>>(),
            "input_router.pressed",
        )?;
        strictly_sorted(
            &self.suppressed_printable_keys,
            "input_router.suppressed_printable_keys",
        )?;
        strictly_sorted(
            &self
                .held_buttons
                .iter()
                .map(|value| (value.seat, value.button, value.source.clone()))
                .collect::<Vec<_>>(),
            "input_router.held_buttons",
        )?;
        strictly_sorted(
            &self
                .locks
                .iter()
                .map(|value| (value.seat, value.button, value.menu_instance_id))
                .collect::<Vec<_>>(),
            "input_router.locks",
        )?;
        strictly_sorted(
            &self
                .repeats
                .iter()
                .map(|value| (value.seat, value.button, value.source.clone()))
                .collect::<Vec<_>>(),
            "input_router.repeats",
        )?;
        strictly_unique(
            &self
                .repeats
                .iter()
                .map(|value| value.timer_id)
                .collect::<Vec<_>>(),
            "input_router.repeat_timer_ids",
        )?;
        for pressed in &self.pressed {
            if pressed.accepted
                && (pressed.logical_button.is_none() || pressed.menu_instance_id.is_none())
            {
                return Err(invalid(
                    "input_router.pressed",
                    "accepted physical input must retain logical/menu identity",
                ));
            }
            if !pressed.accepted
                && (pressed.logical_button.is_some() || pressed.menu_instance_id.is_some())
            {
                return Err(invalid(
                    "input_router.pressed",
                    "blocked physical input must not retain a partial logical/menu identity",
                ));
            }
        }
        for held in &self.held_buttons {
            if !self.pressed.iter().any(|pressed| {
                pressed.seat == held.seat
                    && pressed.source == held.source
                    && pressed.accepted
                    && pressed.logical_button == Some(held.button)
                    && pressed.menu_instance_id == Some(held.menu_instance_id)
            }) {
                return Err(invalid(
                    "input_router.held_buttons",
                    "every held logical button must have its exact accepted physical press",
                ));
            }
        }
        for lock in &self.locks {
            if !self.held_buttons.iter().any(|held| {
                held.seat == lock.seat
                    && held.button == lock.button
                    && held.menu_instance_id == lock.menu_instance_id
            }) {
                return Err(invalid(
                    "input_router.locks",
                    "every logical lock must have its exact held owner",
                ));
            }
        }
        for repeat in &self.repeats {
            if !self.held_buttons.iter().any(|held| {
                held.seat == repeat.seat
                    && held.button == repeat.button
                    && held.source == repeat.source
                    && held.menu_instance_id == repeat.menu_instance_id
            }) {
                return Err(invalid(
                    "input_router.repeats",
                    "every repeat timer must have its exact held input owner",
                ));
            }
        }
        if self.disposed
            && (!self.pressed.is_empty()
                || !self.suppressed_printable_keys.is_empty()
                || !self.held_buttons.is_empty()
                || !self.locks.is_empty()
                || !self.repeats.is_empty())
        {
            return Err(invalid(
                "input_router",
                "disposed router cannot retain live input state",
            ));
        }
        Ok(())
    }
}

impl KernelSchedulerSnapshotV2 {
    pub(crate) fn from_scheduler(scheduler: &KernelScheduler) -> Result<Self, SnapshotError> {
        let state = scheduler.export_restorable_state();
        let snapshot = Self {
            next_timer_id: state.next_timer_id,
            timers: state
                .timers
                .into_iter()
                .map(|timer| RestorableTimerSnapshotV2 {
                    registration: timer.registration,
                    original_delay_ms: timer.original_delay_ms,
                    remaining_active_ms: timer.remaining_active_ms,
                })
                .collect(),
            pauses: state
                .pauses
                .into_iter()
                .map(|pause| TimeClassPauseSnapshotV2 {
                    endpoint: pause.endpoint,
                    time_class: pause.time_class,
                    reasons: pause.reasons,
                })
                .collect(),
            disposed: state.disposed,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    pub(crate) fn into_scheduler(self) -> Result<KernelScheduler, SnapshotError> {
        self.validate()?;
        let state = KernelSchedulerRestorableState {
            next_timer_id: self.next_timer_id,
            timers: self
                .timers
                .into_iter()
                .map(|timer| KernelSchedulerTimerState {
                    registration: timer.registration,
                    original_delay_ms: timer.original_delay_ms,
                    remaining_active_ms: timer.remaining_active_ms,
                })
                .collect(),
            pauses: self
                .pauses
                .into_iter()
                .map(|pause| KernelSchedulerPauseState {
                    endpoint: pause.endpoint,
                    time_class: pause.time_class,
                    reasons: pause.reasons,
                })
                .collect(),
            disposed: self.disposed,
        };
        KernelScheduler::import_restorable_state(state)
            .map_err(|error| invalid("scheduler", error.to_string()))
    }

    pub fn validate(&self) -> Result<(), SnapshotError> {
        strictly_sorted(
            &self
                .timers
                .iter()
                .map(|value| (value.registration.endpoint, value.registration.timer_id))
                .collect::<Vec<_>>(),
            "scheduler.timers",
        )?;
        strictly_sorted(
            &self
                .pauses
                .iter()
                .map(|value| (value.endpoint, value.time_class))
                .collect::<Vec<_>>(),
            "scheduler.pauses",
        )?;
        for timer in &self.timers {
            validate_timer_owner(&timer.registration.owner, "scheduler.timers.owner")?;
            if timer.registration.delay_ms != timer.original_delay_ms
                || timer.remaining_active_ms > timer.original_delay_ms
            {
                return Err(invalid(
                    "scheduler.timers",
                    "timer duration does not cross-validate with its registration",
                ));
            }
        }
        if let Some(next_timer_id) = self.next_timer_id
            && self
                .timers
                .iter()
                .any(|timer| timer.registration.timer_id.get() >= next_timer_id)
        {
            return Err(invalid(
                "scheduler.next_timer_id",
                "allocator cursor must be above every live timer ID",
            ));
        }
        for pause in &self.pauses {
            if pause.time_class == TimeClass::Absolute || pause.reasons.is_empty() {
                return Err(invalid(
                    "scheduler.pauses",
                    "absolute time cannot be paused and pause reasons are non-empty",
                ));
            }
            if pause.reasons.windows(2).any(|pair| pair[0] >= pair[1]) {
                return Err(invalid(
                    "scheduler.pauses.reasons",
                    "pause reasons must be lexical and duplicate-free",
                ));
            }
        }
        if self.disposed && (!self.timers.is_empty() || !self.pauses.is_empty()) {
            return Err(invalid(
                "scheduler",
                "disposed scheduler cannot retain timers or pauses",
            ));
        }
        Ok(())
    }
}

impl PendingPresentationsSnapshotV1 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        strictly_sorted(
            &self
                .plans
                .iter()
                .map(|plan| plan.operation_id.clone())
                .collect::<Vec<_>>(),
            "pending_presentations.plans",
        )?;
        strictly_sorted(
            &self.pending_barrier_ids,
            "pending_presentations.pending_barrier_ids",
        )?;
        strictly_sorted(
            &self.blocking_barrier_ids,
            "pending_presentations.blocking_barrier_ids",
        )?;
        strictly_sorted(
            &self
                .outcomes
                .iter()
                .map(|value| value.event_id.clone())
                .collect::<Vec<_>>(),
            "pending_presentations.outcomes",
        )?;
        strictly_sorted(
            &self
                .event_catalog
                .iter()
                .map(|event| event.event_id.clone())
                .collect::<Vec<_>>(),
            "pending_presentations.event_catalog",
        )?;

        let Some(last_plan) = self.last_plan_operation_id.as_ref() else {
            if !self.plans.is_empty() {
                return Err(invalid(
                    "pending_presentations.last_plan_operation_id",
                    "non-empty plans require the exact last plan identity",
                ));
            }
            if !self.pending_barrier_ids.is_empty() || !self.blocking_barrier_ids.is_empty() {
                return Err(invalid(
                    "pending_presentations",
                    "pending or blocking state requires at least one retained plan",
                ));
            }
            if !self.disposed && !self.outcomes.is_empty() {
                return Err(invalid(
                    "pending_presentations.outcomes",
                    "live outcomes require at least one retained plan",
                ));
            }
            for outcome in &self.outcomes {
                outcome.outcome.validate().map_err(|error| {
                    invalid("pending_presentations.outcomes", error.to_string())
                })?;
                if !self
                    .event_catalog
                    .iter()
                    .any(|event| event.event_id == outcome.event_id)
                {
                    return Err(invalid(
                        "pending_presentations.outcomes",
                        "outcome identity is absent from the retained event catalog",
                    ));
                }
            }
            let has_failure = self.outcomes.iter().any(|outcome| {
                matches!(
                    outcome.outcome,
                    PresentationSettlementOutcome::Failed { .. }
                )
            });
            if self.presentation_failed != has_failure {
                return Err(invalid(
                    "pending_presentations.presentation_failed",
                    "failure marker must equal the retained failed outcome projection",
                ));
            }
            return Ok(());
        };
        if !self
            .plans
            .iter()
            .any(|plan| &plan.operation_id == last_plan)
        {
            return Err(invalid(
                "pending_presentations.last_plan_operation_id",
                "last plan identity is not present in the plan map",
            ));
        }

        let mut plan_event_ids = Vec::new();
        for plan in &self.plans {
            for (index, event) in plan.events.iter().enumerate() {
                if event.event_id.operation_id != plan.operation_id {
                    return Err(invalid(
                        "pending_presentations.plans.events",
                        "plan event operation identity differs from its owning plan",
                    ));
                }
                let expected_sequence = SafeU53::new(index as u64).map_err(|_| {
                    invalid("pending_presentations.plans.events", "sequence overflow")
                })?;
                if event.event_id.sequence != expected_sequence {
                    return Err(invalid(
                        "pending_presentations.plans.events",
                        "plan event sequence must be zero-based and causal",
                    ));
                }
                plan_event_ids.push(event.event_id.clone());
            }
        }
        strictly_unique(&plan_event_ids, "pending_presentations.plans.events")?;

        let catalog_ids = self
            .event_catalog
            .iter()
            .map(|event| event.event_id.clone())
            .collect::<Vec<_>>();
        let mut sorted_plan_ids = plan_event_ids.clone();
        sorted_plan_ids.sort_unstable();
        if catalog_ids != sorted_plan_ids {
            return Err(invalid(
                "pending_presentations.event_catalog",
                "event catalog must exactly equal all typed plan events",
            ));
        }
        let outcome_ids = self
            .outcomes
            .iter()
            .map(|value| value.event_id.clone())
            .collect::<Vec<_>>();
        for outcome in &self.outcomes {
            outcome
                .outcome
                .validate()
                .map_err(|error| invalid("pending_presentations.outcomes", error.to_string()))?;
            if !plan_event_ids.contains(&outcome.event_id) {
                return Err(invalid(
                    "pending_presentations.outcomes",
                    "outcome identity is not in a retained plan",
                ));
            }
        }
        for event_id in &self.pending_barrier_ids {
            if !plan_event_ids.contains(event_id) || outcome_ids.contains(event_id) {
                return Err(invalid(
                    "pending_presentations.pending_barrier_ids",
                    "pending identity must belong to a plan and have no outcome",
                ));
            }
        }
        if plan_event_ids.len() != self.pending_barrier_ids.len() + outcome_ids.len() {
            return Err(invalid(
                "pending_presentations",
                "every retained plan event must have exactly one pending/outcome state",
            ));
        }
        let mut expected_blocking = Vec::new();
        for event in &self.event_catalog {
            let failed = self.outcomes.iter().any(|outcome| {
                outcome.event_id == event.event_id
                    && matches!(
                        outcome.outcome,
                        PresentationSettlementOutcome::Failed { .. }
                    )
            });
            if event.policy == er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput
                && (self.pending_barrier_ids.contains(&event.event_id) || failed)
            {
                expected_blocking.push(event.event_id.clone());
            }
        }
        if expected_blocking != self.blocking_barrier_ids {
            return Err(invalid(
                "pending_presentations.blocking_barrier_ids",
                "blocking IDs must equal the exact policy/pending/failure projection",
            ));
        }
        let has_failure = self.outcomes.iter().any(|outcome| {
            matches!(
                outcome.outcome,
                PresentationSettlementOutcome::Failed { .. }
            )
        });
        if self.presentation_failed != has_failure {
            return Err(invalid(
                "pending_presentations.presentation_failed",
                "failure marker must equal the retained failed outcome projection",
            ));
        }
        if self.disposed
            && (!self.plans.is_empty()
                || !self.pending_barrier_ids.is_empty()
                || !self.blocking_barrier_ids.is_empty()
                || self.last_plan_operation_id.is_some())
        {
            return Err(invalid(
                "pending_presentations.disposed",
                "disposed presentation owner cannot retain live plans or barriers",
            ));
        }
        Ok(())
    }
}

impl RestorableKernelSnapshotV2 {
    /// Validate the endpoint without changing any owner.
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.schema_version != RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION {
            return Err(invalid(
                "schema_version",
                format!(
                    "expected {RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION}, got {}",
                    self.schema_version
                ),
            ));
        }
        if self.content_hash != self.game.state.content_hash {
            return Err(invalid(
                "content_hash",
                "root content identity differs from GameState content identity",
            ));
        }
        self.input_router.validate()?;
        self.scheduler.validate()?;
        let local_seat = self.runtime_identity.local_seat;
        if self
            .input_router
            .pressed
            .iter()
            .any(|entry| entry.seat != local_seat)
            || self
                .input_router
                .held_buttons
                .iter()
                .any(|entry| entry.seat != local_seat)
            || self
                .input_router
                .locks
                .iter()
                .any(|entry| entry.seat != local_seat)
            || self
                .input_router
                .repeats
                .iter()
                .any(|entry| entry.seat != local_seat)
        {
            return Err(invalid(
                "input_router",
                "every input owner key must belong to runtime_identity.local_seat",
            ));
        }
        if self
            .scheduler
            .timers
            .iter()
            .any(|timer| timer.registration.endpoint != local_seat)
            || self
                .scheduler
                .pauses
                .iter()
                .any(|pause| pause.endpoint != local_seat)
        {
            return Err(invalid(
                "scheduler",
                "every timer and pause must belong to runtime_identity.local_seat",
            ));
        }
        for repeat in &self.input_router.repeats {
            let expected_owner = er_types::TimerOwner::input_repeat(repeat.button);
            let matching_timer = self.scheduler.timers.iter().find(|timer| {
                timer.registration.endpoint == repeat.seat
                    && timer.registration.timer_id == repeat.timer_id
            });
            if !matches!(
                matching_timer,
                Some(timer) if timer.registration.owner == expected_owner
            ) {
                return Err(invalid(
                    "input_router.repeats",
                    "repeat timer must exactly match an input-router scheduler owner",
                ));
            }
        }
        for timer in &self.scheduler.timers {
            if timer.registration.owner.owner_id == "input-router"
                && timer.registration.owner.reason == "input-repeat"
                && !self.input_router.repeats.iter().any(|repeat| {
                    timer.registration.endpoint == repeat.seat
                        && timer.registration.timer_id == repeat.timer_id
                        && timer.registration.owner
                            == er_types::TimerOwner::input_repeat(repeat.button)
                })
            {
                return Err(invalid(
                    "scheduler.timers",
                    "input-router repeat owner has no matching router repeat entry",
                ));
            }
        }
        self.protocol
            .validate()
            .map_err(|error| invalid("protocol", error.to_string()))?;
        let owner_quiesced = self.disposed || self.terminal.is_some();
        if self.input_router.disposed != self.disposed
            || self.scheduler.disposed != owner_quiesced
            || self.protocol.disposed != owner_quiesced
            || self.pending_presentations.disposed != owner_quiesced
        {
            return Err(invalid(
                "disposed",
                "scheduler/protocol/presentation owners must quiesce at terminal and all owners must quiesce at disposal",
            ));
        }
        let mut claimed_timer_ids = self
            .input_router
            .repeats
            .iter()
            .map(|repeat| repeat.timer_id)
            .collect::<Vec<_>>();
        if let Some(log) = &self.protocol.authority_log {
            for lease in &log.retained {
                if let Some(timer_id) = lease.timer_id {
                    claimed_timer_ids.push(timer_id);
                    let scheduled = self
                        .scheduler
                        .timers
                        .iter()
                        .find(|timer| timer.registration.timer_id == timer_id)
                        .ok_or_else(|| {
                            invalid(
                                "protocol.authority_log.retained.timer_id",
                                "delivery timer is absent from the endpoint scheduler",
                            )
                        })?;
                    if scheduled.registration.endpoint != log.local_context.sender_seat_id
                        || scheduled.registration.owner != lease.owner
                        || scheduled.registration.delay_ms != lease.next_delay_ms
                        || scheduled.registration.time_class != log.delivery_time_class
                    {
                        return Err(invalid(
                            "protocol.authority_log.retained.timer_id",
                            "delivery timer metadata differs from its scheduler registration",
                        ));
                    }
                }
            }
        }
        if let Some(leases) = &self.protocol.proposal_leases {
            for target in &leases.timer_targets {
                claimed_timer_ids.push(target.timer_id);
                let scheduled = self
                    .scheduler
                    .timers
                    .iter()
                    .find(|timer| timer.registration.timer_id == target.timer_id)
                    .ok_or_else(|| {
                        invalid(
                            "protocol.proposal_leases.timer_targets",
                            "proposal timer is absent from the endpoint scheduler",
                        )
                    })?;
                if scheduled.registration.endpoint != target.endpoint
                    || scheduled.registration.owner != target.owner
                    || scheduled.registration.delay_ms != target.delay_ms
                    || scheduled.registration.time_class != target.time_class
                {
                    return Err(invalid(
                        "protocol.proposal_leases.timer_targets",
                        "proposal timer metadata differs from its scheduler registration",
                    ));
                }
            }
        }
        if let Some(recovery) = &self.protocol.recovery {
            for timer in &recovery.timers {
                claimed_timer_ids.push(timer.timer.timer_id);
                let scheduled = self
                    .scheduler
                    .timers
                    .iter()
                    .find(|scheduled| scheduled.registration.timer_id == timer.timer.timer_id)
                    .ok_or_else(|| {
                        invalid(
                            "protocol.recovery.timers",
                            "recovery timer is absent from the endpoint scheduler",
                        )
                    })?;
                if scheduled.registration != timer.timer {
                    return Err(invalid(
                        "protocol.recovery.timers",
                        "recovery timer differs from its scheduler registration",
                    ));
                }
            }
        }
        strictly_unique(&claimed_timer_ids, "scheduler.claimed_timer_ids")?;
        let claimed_timer_ids = claimed_timer_ids.into_iter().collect::<BTreeSet<_>>();
        let scheduled_timer_ids = self
            .scheduler
            .timers
            .iter()
            .map(|timer| timer.registration.timer_id)
            .collect::<BTreeSet<_>>();
        if claimed_timer_ids != scheduled_timer_ids {
            return Err(invalid(
                "scheduler.timers",
                "scheduler timer inventory must exactly equal input and protocol owner claims",
            ));
        }
        self.game
            .validate()
            .map_err(|error| invalid("game", error.to_string()))?;
        self.pending_presentations.validate()?;
        if self.prepared_transaction.is_some() {
            return Err(invalid(
                "prepared_transaction",
                "a public quiescent snapshot cannot contain a prepared transaction",
            ));
        }
        self.ui
            .validate()
            .map_err(|error| invalid("ui", error.to_string()))?;
        let battle = self.game.state.battle.as_ref().ok_or_else(|| {
            invalid(
                "game.state.battle",
                "M3 battle snapshot requires an active battle",
            )
        })?;
        let current_control = &self.game.current_control;
        // UI control identities use the logical decision coordinate. During a
        // forced replacement that is `source.resolved_turn`, which may lag the
        // already-advanced mechanical battle turn.
        let projected = current_control
            .seats
            .iter()
            .find(|entry| entry.seat == self.runtime_identity.local_seat)
            .ok_or_else(|| invalid("runtime_identity.local_seat", "seat has no current control"))?;
        if self.ui.seat_control != *projected
            || self.ui.battle_id != current_control.battle_id
            || self.ui.wave != current_control.wave
            || self.ui.turn != current_control.turn
        {
            return Err(invalid(
                "ui",
                "projection is not the exact current local control projection",
            ));
        }
        let suspended = self
            .scheduler
            .pauses
            .iter()
            .any(|pause| pause.reasons.iter().any(|reason| reason == "suspended"));
        let recovery_fenced = self
            .protocol
            .recovery
            .as_ref()
            .is_some_and(|recovery| recovery.fence.state != er_types::RecoveryFenceState::Open);
        let expected_actionable = projected.control.is_actionable()
            && self.pending_presentations.blocking_barrier_ids.is_empty()
            && self.terminal.is_none()
            && !self.disposed
            && !suspended
            && !recovery_fenced;
        if self.ui.actionable != expected_actionable {
            return Err(invalid(
                "ui.actionable",
                "actionability does not include presentation/terminal fences",
            ));
        }
        let humans = er_state::format::human_seats(&battle.format)
            .map_err(|error| invalid("game.state.battle.format", error.to_string()))?;
        if self.pending_presentations.local_endpoint != local_seat {
            return Err(invalid(
                "pending_presentations.local_endpoint",
                "presentation ownership must equal runtime_identity.local_seat",
            ));
        }
        let frame_context = &self.protocol.frame_context.context;
        if frame_context.sender_seat_id != local_seat
            || frame_context.authority_seat_id != battle.authority_seat
        {
            return Err(invalid(
                "protocol.frame_context",
                "protocol sender/authority identity must equal the runtime and GameState topology",
            ));
        }
        let has_disconnected_pause = self.scheduler.pauses.iter().any(|pause| {
            pause.endpoint == local_seat
                && pause.time_class == TimeClass::Connected
                && pause.reasons.iter().any(|reason| reason == "disconnected")
        });
        let has_misplaced_disconnected_pause = self.scheduler.pauses.iter().any(|pause| {
            (pause.endpoint != local_seat || pause.time_class != TimeClass::Connected)
                && pause.reasons.iter().any(|reason| reason == "disconnected")
        });
        let transport_fenced = self
            .protocol
            .connections
            .iter()
            .any(|connection| connection.state != TransportState::Connected);
        if has_misplaced_disconnected_pause || has_disconnected_pause != transport_fenced {
            return Err(invalid(
                "scheduler.pauses",
                "connected-time pause state must exactly equal the protocol transport inventory",
            ));
        }
        let configured_role = match &self.runtime_identity.protocol_config.role {
            BattleProtocolRoleConfig::Authority { .. } => er_protocol::EndpointRole::Authority,
            BattleProtocolRoleConfig::Replica { .. } => er_protocol::EndpointRole::Replica,
        };
        if configured_role != self.protocol.role {
            return Err(invalid(
                "runtime_identity.protocol_config.role",
                "protocol snapshot role differs from runtime identity configuration",
            ));
        }
        match &self.runtime_identity.protocol_config.role {
            BattleProtocolRoleConfig::Authority {
                log: configured_log,
                proposal_capacity,
            } => {
                let owner = self.protocol.authority_log.as_ref().ok_or_else(|| {
                    invalid(
                        "protocol.authority_log",
                        "authority runtime identity requires an authority log owner",
                    )
                })?;
                let admission = self.protocol.proposal_admission.as_ref().ok_or_else(|| {
                    invalid(
                        "protocol.proposal_admission",
                        "authority runtime identity requires an admission owner",
                    )
                })?;
                let expected_peer_seats = humans
                    .iter()
                    .copied()
                    .filter(|seat| *seat != local_seat)
                    .collect::<Vec<_>>();
                let owner_peer_seats = owner
                    .peer_bindings
                    .iter()
                    .map(|binding| binding.seat)
                    .collect::<Vec<_>>();
                let connection_peer_seats = self
                    .protocol
                    .connections
                    .iter()
                    .map(|connection| connection.peer_seat)
                    .collect::<Vec<_>>();
                let mut configured_bindings = configured_log
                    .peer_bindings
                    .iter()
                    .map(|binding| (binding.seat_id, binding.connection_generation))
                    .collect::<Vec<_>>();
                configured_bindings.sort_unstable();
                let restored_bindings = owner
                    .peer_bindings
                    .iter()
                    .map(|binding| (binding.seat, binding.generation))
                    .collect::<Vec<_>>();
                let bindings_match = configured_bindings == restored_bindings;
                if configured_log.local_context != owner.local_context
                    || !bindings_match
                    || configured_log.owner_id != owner.owner_id
                    || configured_log.retain_capacity != owner.retain_capacity
                    || configured_log.delivery_backoff != owner.delivery_backoff
                    || configured_log.delivery_time_class != owner.delivery_time_class
                    || configured_log.max_delivery_attempts != owner.max_delivery_attempts
                    || *proposal_capacity != admission.capacity
                    || owner_peer_seats != expected_peer_seats
                    || connection_peer_seats != expected_peer_seats
                {
                    return Err(invalid(
                        "runtime_identity.protocol_config",
                        "authority owner state differs from its constructor configuration",
                    ));
                }
            }
            BattleProtocolRoleConfig::Replica {
                replica: configured_replica,
                proposal_leases,
                recovery,
            } => {
                let owner = self.protocol.authority_replica.as_ref().ok_or_else(|| {
                    invalid(
                        "protocol.authority_replica",
                        "replica runtime identity requires a replica owner",
                    )
                })?;
                let leases = self.protocol.proposal_leases.as_ref().ok_or_else(|| {
                    invalid(
                        "protocol.proposal_leases",
                        "replica runtime identity requires a lease owner",
                    )
                })?;
                let recovery_owner = self.protocol.recovery.as_ref().ok_or_else(|| {
                    invalid(
                        "protocol.recovery",
                        "replica runtime identity requires a recovery owner",
                    )
                })?;
                let connection_peer_seats = self
                    .protocol
                    .connections
                    .iter()
                    .map(|connection| connection.peer_seat)
                    .collect::<Vec<_>>();
                if configured_replica.receipt_context != owner.receipt_context
                    || configured_replica.authority_seat_id != owner.authority_seat
                    || configured_replica.authority_connection_generation
                        != owner.authority_generation
                    || proposal_leases != &leases.config
                    || recovery != &recovery_owner.config
                    || owner.authority_seat != battle.authority_seat
                    || connection_peer_seats != vec![battle.authority_seat]
                {
                    return Err(invalid(
                        "runtime_identity.protocol_config",
                        "replica owner state differs from its constructor configuration",
                    ));
                }
            }
        }
        match self.protocol.role {
            er_protocol::EndpointRole::Authority
                if self.runtime_identity.local_seat != battle.authority_seat =>
            {
                return Err(invalid(
                    "runtime_identity.local_seat",
                    "authority endpoint seat differs from GameState authority seat",
                ));
            }
            er_protocol::EndpointRole::Replica
                if self.runtime_identity.local_seat == battle.authority_seat
                    || !humans.contains(&self.runtime_identity.local_seat) =>
            {
                return Err(invalid(
                    "runtime_identity.local_seat",
                    "replica endpoint seat is not a distinct configured human seat",
                ));
            }
            _ => {}
        }
        if self.protocol.frame_context.context != self.protocol.peer_identity.local {
            return Err(invalid(
                "protocol.peer_identity.local",
                "local peer identity must equal frame context",
            ));
        }
        self.mechanical_digest
            .verify(&self.game.state)
            .map_err(|error| invalid("mechanical_digest", error.to_string()))?;
        let plan_events = self.pending_presentations.plan_events();
        let presentation = er_battle::compute_presentation_plan_digest(&plan_events)
            .map_err(|error| canonical("presentation_plan_digest", error.to_string()))?;
        if presentation != self.presentation_plan_digest {
            return Err(invalid(
                "presentation_plan_digest",
                "digest does not match the typed presentation plan",
            ));
        }
        let kernel = KernelDeterminismDigest::compute(self)?;
        if kernel != self.kernel_determinism_digest {
            return Err(invalid(
                "kernel_determinism_digest",
                "digest does not match the complete endpoint owner state",
            ));
        }
        Ok(())
    }

    pub fn validate_for_content(&self, content: &ContentPack) -> Result<(), SnapshotError> {
        if self.content_hash != content.hash {
            return Err(invalid(
                "content_hash",
                "snapshot content hash does not match supplied ContentPack",
            ));
        }
        self.validate()
    }
}

/// The old public resource projection remains useful as evidence but is not
/// used as a restorable snapshot.  This helper keeps the exact type available
/// to integration code while making that distinction explicit.
pub fn validate_live_resources(resources: &LiveResourceSnapshot) -> Result<(), SnapshotError> {
    let _ = resources;
    Ok(())
}
