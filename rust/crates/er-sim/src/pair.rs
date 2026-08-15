//! Two-kernel effect-only orchestrator with no semantic-choice bypass API.

use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;

use er_canonical::{canonical_bytes, content_digest};
use er_content::pack::ContentPack;
use er_kernel::snapshot::{
    GameKernelSnapshotBridge, KernelDeterminismDigest, PresentationOutcomeSnapshotV1,
    RestorableKernelSnapshotV2, RestorableTimerSnapshotV2, RngDraw,
};
use er_kernel::{BattleGameConfig, BattleProtocolConfig, GameKernel, KernelConfig};
use er_protocol::{ScheduledTimer, SchedulerCommand, control_id_of};
use er_testkit::{DetachedKeyboardDriver, DetachedKeyboardDriverState, DriverHoldState};
use er_types::battle_ids::{BattlePresentationEventId, CanonicalHexBytes};
use er_types::battle_ui::PresentationSettlementOutcome;
use er_types::{
    ConnectionGeneration, ControlProjectionOutcome, InputFocus, KernelEffect, KernelInput,
    KernelSnapshot, LiveResourceSnapshot, MaterialApplicationOutcome, MenuState, NetworkPayload,
    PhysicalKey, PresentationEventId, PresentationOutcome, RawFrame, RawInputEvent, SafeU53,
    SeatId, StorageResult, TerminalMenu, TerminalState, TimeClass, TransportState, UiViewModel,
};
use serde::{
    Deserialize, Deserializer, Serialize, Serializer, de::DeserializeOwned,
    de::Error as SerdeDeError, ser::Error as SerdeSerError,
};
use serde_json::Value;
use thiserror::Error;

use crate::snapshot::{
    DetachedKeyboardDriverSnapshotV2, DriverHoldSnapshotV2, FaultNetworkSnapshotV2,
    FaultOperationV2, FaultRngStateV2, FrameCorruptionV2, InternalEventKindV1, PacketDispositionV2,
    PacketReorderStateV2, PairClockTimerSnapshotV2, PairOperationV2, PairPresenterEventSnapshotV2,
    PairPresenterOutcomeSnapshotV2, PairPresenterTombstoneSnapshotV2, PairTraceObservationV2,
    PresenterSnapshotV2, QueuedPacketSnapshotV2, RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION,
    RestorableKernelEffectV2, RestorablePacketKindV2, RestorablePairSnapshotV2,
    RestorableStorageRequestV2, RestorableStorageResultV2, SimulatedPairSnapshotBridge,
    SnapshotError, StorageFaultSnapshotV2, StorageRequestSnapshotV2, StorageSnapshotV2,
    StorageValueSnapshotV2, TraceFailureEvidenceV2, TraceFailureOwnerV2, VirtualClockSnapshotV2,
    numbered_pair_effects, restore_simulated_pair, snapshot_simulated_pair,
    validate_pair_operation,
};
use crate::{
    ClockCounterState, ClockEndpointState, ClockPauseState, ClockTimerSnapshot, ClockTimerState,
    FaultNetwork, FaultNetworkDiagnostics, FaultNetworkGenerationState,
    FaultNetworkPacketDisposition, FaultNetworkPacketKind, FaultNetworkPacketState,
    FaultNetworkRngState, FaultNetworkState, FaultOperation, InstantPresenter, MemoryStorage,
    MemoryStorageState, NetworkEvent, NetworkPacket, Presenter, PresenterBattleOutcomeState,
    PresenterBattlePendingState, PresenterDiagnostics, PresenterMode, PresenterState,
    PresenterTombstoneState, StorageAdapter, StorageDiagnostics, StoragePendingRequestState,
    StorageValueState, VirtualClockState, restore_presenter,
};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PairEndpoint {
    Host,
    Guest,
}

#[derive(Clone, Debug)]
pub struct SimulatedPairConfig {
    pub host_kernel: KernelConfig,
    pub guest_kernel: KernelConfig,
    pub host_seat: SeatId,
    pub guest_seat: SeatId,
    pub seed: u64,
    pub presenter: PresenterMode,
    pub initial_storage: BTreeMap<String, Value>,
    pub event_budget: SafeU53,
}

/// Production-M3 pair bootstrap. The event budget and fault-controlled
/// presenter are fixed because the restorable pair schema intentionally has
/// no ambient constructor settings.
#[derive(Clone, Debug)]
pub struct SimulatedBattlePairConfig {
    pub host_game: BattleGameConfig,
    pub host_protocol: BattleProtocolConfig,
    pub guest_game: BattleGameConfig,
    pub guest_protocol: BattleProtocolConfig,
    pub content: Arc<ContentPack>,
    pub replay_seed: u64,
    pub initial_storage: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PairOperation {
    RawInput {
        endpoint: PairEndpoint,
        event: RawInputEvent,
    },
    AdvanceTime {
        delta_ms: SafeU53,
    },
    Fault {
        operation: FaultOperation,
    },
    Disconnect {
        endpoint: PairEndpoint,
    },
    Reconnect {
        endpoint: PairEndpoint,
    },
    PresentationSettled {
        endpoint: PairEndpoint,
        event_id: PresentationEventId,
        outcome: PresentationOutcome,
    },
    BattlePresentationOutcome {
        endpoint: PairEndpoint,
        event_id: BattlePresentationEventId,
        outcome: PresentationSettlementOutcome,
    },
    StorageResult {
        endpoint: PairEndpoint,
        request_id: SafeU53,
        result: StorageResult,
    },
    Suspend {
        endpoint: PairEndpoint,
    },
    Resume {
        endpoint: PairEndpoint,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointSnapshot {
    pub kernel: KernelSnapshot,
    pub ui: UiViewModel,
    pub state_digest: String,
    pub live_resources: LiveResourceSnapshot,
    pub presenter: PresenterDiagnostics,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PairSnapshot {
    pub sequence: SafeU53,
    pub seed: String,
    pub virtual_time_ms: SafeU53,
    pub clock_timers: Vec<ClockTimerSnapshot>,
    pub host: EndpointSnapshot,
    pub guest: EndpointSnapshot,
    pub network: FaultNetworkDiagnostics,
    pub presenter: PresenterDiagnostics,
    pub storage: StorageDiagnostics,
    pub terminal_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairSnapshotWire {
    sequence: SafeU53,
    seed: String,
    virtual_time_ms: SafeU53,
    clock_timers: Vec<ClockTimerSnapshot>,
    host: EndpointSnapshot,
    guest: EndpointSnapshot,
    network: FaultNetworkDiagnostics,
    presenter: PresenterDiagnostics,
    storage: StorageDiagnostics,
    terminal_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename = "PairSnapshotWire", rename_all = "camelCase")]
struct PairSnapshotSerializeWire<'a> {
    sequence: SafeU53,
    seed: &'a str,
    virtual_time_ms: SafeU53,
    clock_timers: &'a [ClockTimerSnapshot],
    host: &'a EndpointSnapshot,
    guest: &'a EndpointSnapshot,
    network: &'a FaultNetworkDiagnostics,
    presenter: &'a PresenterDiagnostics,
    storage: &'a StorageDiagnostics,
    terminal_reason: Option<&'a str>,
}

impl Serialize for PairSnapshot {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        parse_canonical_seed(&self.seed).map_err(S::Error::custom)?;
        PairSnapshotSerializeWire {
            sequence: self.sequence,
            seed: &self.seed,
            virtual_time_ms: self.virtual_time_ms,
            clock_timers: &self.clock_timers,
            host: &self.host,
            guest: &self.guest,
            network: &self.network,
            presenter: &self.presenter,
            storage: &self.storage,
            terminal_reason: self.terminal_reason.as_deref(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for PairSnapshot {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = PairSnapshotWire::deserialize(deserializer)?;
        parse_canonical_seed(&wire.seed).map_err(D::Error::custom)?;
        Ok(Self {
            sequence: wire.sequence,
            seed: wire.seed,
            virtual_time_ms: wire.virtual_time_ms,
            clock_timers: wire.clock_timers,
            host: wire.host,
            guest: wire.guest,
            network: wire.network,
            presenter: wire.presenter,
            storage: wire.storage,
            terminal_reason: wire.terminal_reason,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairStep {
    pub sequence: SafeU53,
    pub operation: PairOperation,
    pub generated_effects: Vec<KernelEffect>,
    pub effects_digest: String,
    pub snapshot: PairSnapshot,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SimulatedPairError {
    #[error("simulated pair contract is not initialized: {reason}")]
    InvalidConfig { reason: String },
    #[error("simulated pair is disposed")]
    Disposed,
    #[error("kernel transition failed: {reason}")]
    Kernel { reason: String },
    #[error("clock transition failed: {reason}")]
    Clock { reason: String },
    #[error("network transition failed: {reason}")]
    Network { reason: String },
    #[error("adapter transition failed: {reason}")]
    Adapter { reason: String },
    #[error("pair did not quiesce within {event_budget} generated events")]
    EventBudgetExceeded { event_budget: SafeU53 },
}

#[derive(Debug)]
pub struct SimulatedPair {
    host_kernel: GameKernel,
    guest_kernel: GameKernel,
    host_seat: SeatId,
    guest_seat: SeatId,
    host_keyboard: DetachedKeyboardDriver,
    guest_keyboard: DetachedKeyboardDriver,
    sequence: SafeU53,
    seed: u64,
    event_budget: SafeU53,
    clock: crate::VirtualClock,
    network: FaultNetwork,
    presenter: Box<dyn Presenter>,
    storage: MemoryStorage,
    shared_terminal: Option<TerminalState>,
    terminal_reason: Option<String>,
    fault_script: crate::snapshot::FaultScriptSnapshotV2,
    // PairStep intentionally exposes effects but not packet-delivery events.
    // This deterministic private value is the narrow witness for cross-domain
    // timer/network ordering without changing the frozen public schema.
    last_boundary_order: Vec<BoundaryOrderEvent>,
    trace_audit: PairTraceAuditState,
    disposed: bool,
}

#[derive(Debug)]
struct PairRollbackState {
    host_kernel: GameKernel,
    guest_kernel: GameKernel,
    host_keyboard: DetachedKeyboardDriver,
    guest_keyboard: DetachedKeyboardDriver,
    sequence: SafeU53,
    clock: VirtualClockState,
    network: FaultNetworkState,
    presenter: PresenterState,
    storage: MemoryStorageState,
    shared_terminal: Option<TerminalState>,
    terminal_reason: Option<String>,
    fault_script: crate::snapshot::FaultScriptSnapshotV2,
    last_boundary_order: Vec<BoundaryOrderEvent>,
    trace_audit: PairTraceAuditState,
    disposed: bool,
}

#[derive(Clone, Debug, Default)]
struct PairTraceAuditState {
    effect_origins: Vec<PairEndpoint>,
    host_rng_audit: Vec<RngDraw>,
    host_internal_events: Vec<InternalEventKindV1>,
    guest_rng_audit: Vec<RngDraw>,
    guest_internal_events: Vec<InternalEventKindV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct BoundaryOrderEvent {
    at_ms: SafeU53,
    item: BoundaryOrderItem,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum BoundaryOrderItem {
    Timer {
        endpoint: SeatId,
        timer_id: er_types::TimerId,
    },
    Packet {
        packet_id: SafeU53,
    },
    DroppedPacket {
        packet_id: SafeU53,
    },
}

#[derive(Debug)]
enum PairWork {
    Input {
        endpoint: PairEndpoint,
        input: KernelInput,
    },
    InputBatch(Vec<(PairEndpoint, KernelInput)>),
    Effect(KernelEffect),
}

enum PairCompositeOperation {
    Press {
        endpoint: PairEndpoint,
        code: PhysicalKey,
    },
    Hold {
        endpoint: PairEndpoint,
        code: PhysicalKey,
        duration_ms: SafeU53,
    },
}

impl SimulatedPair {
    pub fn new(config: SimulatedPairConfig) -> Result<Self, SimulatedPairError> {
        if config.event_budget == SafeU53::ZERO {
            return Err(SimulatedPairError::InvalidConfig {
                reason: "event budget must be positive".to_owned(),
            });
        }
        if config.host_seat == config.guest_seat {
            return Err(SimulatedPairError::InvalidConfig {
                reason: "host and guest seats must be distinct".to_owned(),
            });
        }

        let presenter: Box<dyn Presenter> = match config.presenter {
            PresenterMode::Instant => Box::new(InstantPresenter::new()),
            PresenterMode::FaultControlled => Box::new(crate::FaultPresenter::new()),
        };

        Ok(Self {
            host_kernel: GameKernel::new(config.host_kernel),
            guest_kernel: GameKernel::new(config.guest_kernel),
            host_seat: config.host_seat,
            guest_seat: config.guest_seat,
            host_keyboard: DetachedKeyboardDriver::new(config.host_seat),
            guest_keyboard: DetachedKeyboardDriver::new(config.guest_seat),
            sequence: SafeU53::ZERO,
            seed: config.seed,
            event_budget: config.event_budget,
            clock: crate::VirtualClock::new(),
            network: FaultNetwork::new(config.seed, [config.host_seat, config.guest_seat]),
            presenter,
            storage: MemoryStorage::new(config.initial_storage),
            shared_terminal: None,
            terminal_reason: None,
            fault_script: empty_fault_script(),
            last_boundary_order: Vec::new(),
            trace_audit: PairTraceAuditState::default(),
            disposed: false,
        })
    }

    pub fn new_battle(config: SimulatedBattlePairConfig) -> Result<Self, SimulatedPairError> {
        let host_seat = config.host_game.local_seat;
        let guest_seat = config.guest_game.local_seat;
        if host_seat == guest_seat {
            return Err(SimulatedPairError::InvalidConfig {
                reason: "host and guest Battle endpoints must use distinct local seats".to_owned(),
            });
        }
        let host_kernel = GameKernel::new_battle(
            config.host_game,
            config.host_protocol,
            Arc::clone(&config.content),
        )
        .map_err(|error| SimulatedPairError::InvalidConfig {
            reason: format!("host Battle kernel: {error}"),
        })?;
        let guest_kernel = GameKernel::new_battle(
            config.guest_game,
            config.guest_protocol,
            Arc::clone(&config.content),
        )
        .map_err(|error| SimulatedPairError::InvalidConfig {
            reason: format!("guest Battle kernel: {error}"),
        })?;
        let host_snapshot =
            host_kernel
                .snapshot_v2()
                .map_err(|error| SimulatedPairError::InvalidConfig {
                    reason: format!("host Battle snapshot: {error}"),
                })?;
        let guest_snapshot =
            guest_kernel
                .snapshot_v2()
                .map_err(|error| SimulatedPairError::InvalidConfig {
                    reason: format!("guest Battle snapshot: {error}"),
                })?;
        if host_snapshot.game.state != guest_snapshot.game.state
            || host_snapshot.protocol.role == guest_snapshot.protocol.role
        {
            return Err(SimulatedPairError::InvalidConfig {
                reason:
                    "Battle endpoints must share one mechanical state and opposite protocol roles"
                        .to_owned(),
            });
        }

        Ok(Self {
            host_kernel,
            guest_kernel,
            host_seat,
            guest_seat,
            host_keyboard: DetachedKeyboardDriver::new(host_seat),
            guest_keyboard: DetachedKeyboardDriver::new(guest_seat),
            sequence: SafeU53::ZERO,
            seed: config.replay_seed,
            event_budget: m3_pair_event_budget(),
            clock: crate::VirtualClock::new(),
            network: FaultNetwork::new(config.replay_seed, [host_seat, guest_seat]),
            presenter: Box::new(crate::FaultPresenter::new()),
            storage: MemoryStorage::new(config.initial_storage),
            shared_terminal: None,
            terminal_reason: None,
            fault_script: empty_fault_script(),
            last_boundary_order: Vec::new(),
            trace_audit: PairTraceAuditState::default(),
            disposed: false,
        })
    }

    /// Capture the complete production-M3 pair and deterministic environment.
    pub fn snapshot_v2(&self) -> Result<RestorablePairSnapshotV2, SnapshotError> {
        snapshot_simulated_pair(self)
    }

    /// Reconstruct a fresh production-M3 pair from one closed V2 snapshot.
    pub fn from_snapshot(
        snapshot: RestorablePairSnapshotV2,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError> {
        restore_simulated_pair(snapshot, content)
    }

    pub fn from_snapshot_v2(
        snapshot: RestorablePairSnapshotV2,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError> {
        Self::from_snapshot(snapshot, content)
    }

    /// Apply one frozen external operation through the real pair and return
    /// the exact evidence consumed by `PairKernelTraceRecorder`.
    #[doc(hidden)]
    pub fn apply_trace_operation_v2(
        &mut self,
        operation: PairOperationV2,
    ) -> Result<PairTraceObservationV2, SnapshotError> {
        validate_pair_operation(&operation)?;
        let live_operation = thaw_pair_operation_v2(&operation)?;
        let failure_owner = pair_operation_failure_owner(&operation);
        let before_snapshot = self.snapshot_v2()?;
        let before_host_live_resources = project_trace_live_resources(
            &before_snapshot,
            PairEndpoint::Host,
            self.host_kernel.live_resources(),
        );
        let before_guest_live_resources = project_trace_live_resources(
            &before_snapshot,
            PairEndpoint::Guest,
            self.guest_kernel.live_resources(),
        );
        let rollback = self
            .capture_rollback_state()
            .map_err(|error| pair_snapshot_invalid("trace.rollback", error.to_string()))?;

        match self.apply(live_operation) {
            Ok(step) => {
                let observation = (|| {
                    if self.trace_audit.effect_origins.len() != step.generated_effects.len() {
                        return Err(pair_snapshot_invalid(
                            "trace.effects",
                            "effect-origin count differs from the generated-effect count",
                        ));
                    }
                    let effects = self
                        .trace_audit
                        .effect_origins
                        .iter()
                        .copied()
                        .zip(&step.generated_effects)
                        .filter_map(|(origin, effect)| {
                            freeze_trace_effect(effect)
                                .transpose()
                                .map(|result| result.map(|effect| (origin, effect)))
                        })
                        .collect::<Result<Vec<_>, SnapshotError>>()?;
                    let effects = numbered_pair_effects(effects)?;
                    let after_snapshot = self.snapshot_v2()?;
                    let host_live_resources = project_trace_live_resources(
                        &after_snapshot,
                        PairEndpoint::Host,
                        self.host_kernel.live_resources(),
                    );
                    let guest_live_resources = project_trace_live_resources(
                        &after_snapshot,
                        PairEndpoint::Guest,
                        self.guest_kernel.live_resources(),
                    );
                    Ok(PairTraceObservationV2 {
                        effects,
                        after_snapshot,
                        host_rng_audit: self.trace_audit.host_rng_audit.clone(),
                        host_internal_events: self.trace_audit.host_internal_events.clone(),
                        host_live_resources,
                        guest_rng_audit: self.trace_audit.guest_rng_audit.clone(),
                        guest_internal_events: self.trace_audit.guest_internal_events.clone(),
                        guest_live_resources,
                        failure: None,
                    })
                })();
                match observation {
                    Ok(observation) => Ok(observation),
                    Err(error) => Err(self.restore_after_trace_error(rollback, error)),
                }
            }
            Err(error) => {
                let after_snapshot = match self.snapshot_v2() {
                    Ok(snapshot) => snapshot,
                    Err(snapshot_error) => {
                        return Err(self.restore_after_trace_error(rollback, snapshot_error));
                    }
                };
                if after_snapshot != before_snapshot {
                    return Err(self.restore_after_trace_error(
                        rollback,
                        pair_snapshot_invalid(
                            "trace.failure",
                            "rejected pair operation did not retain the exact before snapshot",
                        ),
                    ));
                }
                Ok(PairTraceObservationV2 {
                    effects: Vec::new(),
                    after_snapshot,
                    host_rng_audit: Vec::new(),
                    host_internal_events: Vec::new(),
                    host_live_resources: before_host_live_resources,
                    guest_rng_audit: Vec::new(),
                    guest_internal_events: Vec::new(),
                    guest_live_resources: before_guest_live_resources,
                    failure: Some(TraceFailureEvidenceV2 {
                        owner: failure_owner,
                        code: pair_failure_code(&error).to_owned(),
                        path: "pair.apply".to_owned(),
                        expected: None,
                        actual: Some(error.to_string()),
                    }),
                })
            }
        }
    }

    fn restore_after_trace_error(
        &mut self,
        rollback: PairRollbackState,
        error: SnapshotError,
    ) -> SnapshotError {
        match self.restore_rollback_state(rollback) {
            Ok(()) => error,
            Err(rollback_error) => pair_snapshot_invalid(
                "trace.rollback",
                format!("{error}; restoring the trace boundary failed: {rollback_error}"),
            ),
        }
    }

    fn capture_restorable_pair_snapshot_v2(
        &self,
    ) -> Result<RestorablePairSnapshotV2, SnapshotError> {
        if self.event_budget != m3_pair_event_budget() {
            return Err(pair_snapshot_invalid(
                "event_budget",
                "non-production event budget is not representable by the frozen pair schema",
            ));
        }
        if self.disposed && self.shared_terminal.is_some() {
            return Err(pair_snapshot_invalid(
                "disposed",
                "post-terminal explicit teardown is not distinguishable in the frozen pair schema",
            ));
        }

        let clock = freeze_clock(self.clock.export_state())?;
        let mut host = self
            .host_kernel
            .snapshot_v2()
            .map_err(map_kernel_snapshot_error)?;
        let mut guest = self
            .guest_kernel
            .snapshot_v2()
            .map_err(map_kernel_snapshot_error)?;
        install_pair_timer_remaining(&mut host, &clock)?;
        install_pair_timer_remaining(&mut guest, &clock)?;

        if host.terminal != self.shared_terminal || guest.terminal != self.shared_terminal {
            return Err(pair_snapshot_invalid(
                "terminal",
                "pair shared terminal differs from one or both endpoint roots",
            ));
        }
        let manually_disposed = host.disposed && host.terminal.is_none();
        if host.disposed != guest.disposed
            || self.disposed != manually_disposed
            || (self.shared_terminal.is_none() && !self.disposed && host.disposed)
        {
            return Err(pair_snapshot_invalid(
                "disposed",
                "pair lifecycle differs from its endpoint owner roots",
            ));
        }
        if let Some(terminal) = &self.shared_terminal {
            if self.terminal_reason.as_deref() != Some(terminal.reason.as_str()) {
                return Err(pair_snapshot_invalid(
                    "terminal_reason",
                    "pair terminal reason differs from the exact shared terminal",
                ));
            }
        } else if !self.disposed && self.terminal_reason.is_some() {
            return Err(pair_snapshot_invalid(
                "terminal_reason",
                "live non-terminal pair cannot retain a teardown reason",
            ));
        }

        let network_state = self.network.export_state();
        if network_state.seed != self.seed || network_state.observed_now_ms != clock.now_ms {
            return Err(pair_snapshot_invalid(
                "network",
                "fault network seed/time differs from the pair root",
            ));
        }
        let fault_rng_state = FaultRngStateV2 {
            algorithm_version: network_state.rng.algorithm_version,
            state_bits: network_state.rng.state_bits.clone(),
        };
        let snapshot = RestorablePairSnapshotV2 {
            schema_version: RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION,
            sequence: self.sequence,
            replay_seed: self.seed.to_string(),
            virtual_time_ms: clock.now_ms,
            host,
            guest,
            host_driver: freeze_driver(self.host_keyboard.export_state()),
            guest_driver: freeze_driver(self.guest_keyboard.export_state()),
            clock,
            network: freeze_network(network_state, self.host_seat, self.guest_seat)?,
            presenter: freeze_presenter(
                self.presenter
                    .export_state()
                    .map_err(|error| pair_snapshot_invalid("presenter", error.to_string()))?,
                self.host_seat,
                self.guest_seat,
            )?,
            storage: freeze_storage(self.storage.export_state(), self.host_seat, self.guest_seat)?,
            fault_script: self.fault_script.clone(),
            fault_rng_state,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    fn restore_restorable_pair_snapshot_v2(
        snapshot: RestorablePairSnapshotV2,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError> {
        snapshot.validate()?;
        if snapshot.host.content_hash != content.hash {
            return Err(pair_snapshot_invalid(
                "host.content_hash",
                "snapshot content identity differs from supplied ContentPack",
            ));
        }
        let expected_snapshot = snapshot.clone();
        let host_seat = snapshot.host.runtime_identity.local_seat;
        let guest_seat = snapshot.guest.runtime_identity.local_seat;
        let replay_seed = parse_canonical_seed(&snapshot.replay_seed)
            .map_err(|reason| pair_snapshot_invalid("replay_seed", reason))?;

        let clock = thaw_clock(&snapshot, host_seat, guest_seat)?;
        let network = thaw_network(&snapshot, replay_seed, host_seat, guest_seat)?;
        let presenter = thaw_presenter(&snapshot.presenter, host_seat, guest_seat)?;
        let storage = thaw_storage(&snapshot.storage, host_seat, guest_seat)?;
        let host_keyboard = thaw_driver(&snapshot.host_driver)?;
        let guest_keyboard = thaw_driver(&snapshot.guest_driver)?;
        let shared_terminal = snapshot.host.terminal.clone();
        let disposed = snapshot.host.disposed && shared_terminal.is_none();
        let terminal_reason = shared_terminal
            .as_ref()
            .map(|terminal| terminal.reason.clone());
        let fault_script = snapshot.fault_script.clone();
        let host_kernel = GameKernel::from_snapshot(snapshot.host, Arc::clone(&content))
            .map_err(map_kernel_snapshot_error)?;
        let guest_kernel = GameKernel::from_snapshot(snapshot.guest, content)
            .map_err(map_kernel_snapshot_error)?;
        let pair = Self {
            host_kernel,
            guest_kernel,
            host_seat,
            guest_seat,
            host_keyboard,
            guest_keyboard,
            sequence: snapshot.sequence,
            seed: replay_seed,
            event_budget: m3_pair_event_budget(),
            clock,
            network,
            presenter,
            storage,
            shared_terminal,
            terminal_reason,
            fault_script,
            last_boundary_order: Vec::new(),
            trace_audit: PairTraceAuditState::default(),
            disposed,
        };
        let restored_snapshot = pair.capture_restorable_pair_snapshot_v2()?;
        if restored_snapshot != expected_snapshot {
            return Err(pair_snapshot_invalid(
                "snapshot",
                "restored pair does not reproduce the complete captured owner graph",
            ));
        }
        Ok(pair)
    }

    pub fn apply(&mut self, operation: PairOperation) -> Result<PairStep, SimulatedPairError> {
        self.ensure_live()?;
        if self.sequence == SafeU53::MAX {
            return Err(SimulatedPairError::Adapter {
                reason: "pair sequence exhausted".to_owned(),
            });
        }
        let rollback = self.capture_rollback_state()?;
        if self.shared_terminal.is_none() {
            self.sync_driver_operation(&operation);
        }
        match self.apply_after_driver_sync(operation) {
            Ok(step) => Ok(step),
            Err(error) => {
                if let Err(rollback_error) = self.restore_rollback_state(rollback) {
                    return Err(SimulatedPairError::Adapter {
                        reason: format!(
                            "pair operation failed ({error}); restoring its atomic boundary failed ({rollback_error})"
                        ),
                    });
                }
                Err(error)
            }
        }
    }

    /// Apply multiple external operations under one atomic pair boundary.
    ///
    /// Each operation still follows the ordinary driver synchronization and
    /// pair transition path, and returns its own complete `PairStep`. If any
    /// operation fails, the pair (including both keyboard drivers) is restored
    /// to the state captured before the first operation.
    pub fn apply_many_atomic(
        &mut self,
        operations: impl IntoIterator<Item = PairOperation>,
    ) -> Result<Vec<PairStep>, SimulatedPairError> {
        self.ensure_live()?;
        let operations = operations.into_iter().collect::<Vec<_>>();
        if operations.is_empty() {
            return Ok(Vec::new());
        }
        if self.sequence == SafeU53::MAX {
            return Err(SimulatedPairError::Adapter {
                reason: "pair sequence exhausted".to_owned(),
            });
        }

        let rollback = self.capture_rollback_state()?;
        let result = self.apply_many_atomic_operations(operations);

        match result {
            Ok(steps) => Ok(steps),
            Err(error) => {
                if let Err(rollback_error) = self.restore_rollback_state(rollback) {
                    return Err(SimulatedPairError::Adapter {
                        reason: format!(
                            "pair operation batch failed ({error}); restoring its atomic boundary failed ({rollback_error})"
                        ),
                    });
                }
                Err(error)
            }
        }
    }

    /// Fork the complete live pair without crossing the serialized snapshot boundary.
    #[doc(hidden)]
    pub fn try_fork(&self) -> Result<Self, SimulatedPairError> {
        self.ensure_live()?;
        let host_seat = self.host_seat;
        let guest_seat = self.guest_seat;
        let seed = self.seed;
        let event_budget = self.event_budget;
        let state = self.capture_rollback_state()?;
        Self::from_rollback_state(host_seat, guest_seat, seed, event_budget, state)
    }

    /// Fork the complete live pair and apply a batch atomically to the
    /// unpublished fork.
    #[doc(hidden)]
    pub fn try_fork_apply_many_atomic(
        &self,
        operations: impl IntoIterator<Item = PairOperation>,
    ) -> Result<(Self, Vec<PairStep>), SimulatedPairError> {
        self.ensure_live()?;
        let operations = operations.into_iter().collect::<Vec<_>>();
        if operations.is_empty() {
            return Ok((self.try_fork()?, Vec::new()));
        }
        if self.sequence == SafeU53::MAX {
            return Err(SimulatedPairError::Adapter {
                reason: "pair sequence exhausted".to_owned(),
            });
        }

        let mut fork = self.try_fork()?;
        let steps = fork.apply_many_atomic_operations(operations)?;
        Ok((fork, steps))
    }

    fn apply_many_atomic_operations(
        &mut self,
        operations: Vec<PairOperation>,
    ) -> Result<Vec<PairStep>, SimulatedPairError> {
        let mut steps = Vec::with_capacity(operations.len());
        for operation in operations {
            if self.sequence == SafeU53::MAX {
                return Err(SimulatedPairError::Adapter {
                    reason: "pair sequence exhausted".to_owned(),
                });
            }
            if self.shared_terminal.is_none() {
                self.sync_driver_operation(&operation);
            }
            steps.push(self.apply_after_driver_sync(operation)?);
        }
        Ok(steps)
    }

    fn apply_after_driver_sync(
        &mut self,
        operation: PairOperation,
    ) -> Result<PairStep, SimulatedPairError> {
        self.trace_audit = PairTraceAuditState::default();
        let operation_for_step = operation.clone();
        let mut generated_effects = Vec::new();
        let mut work = VecDeque::new();
        let mut generated_events = 0_u64;
        let event_budget = self.event_budget;
        let fault_script_operation = if self.shared_terminal.is_none() {
            self.prepare_fault_script_operation(&operation)?
        } else {
            None
        };
        let storage_completion = if self.shared_terminal.is_none() {
            self.validate_storage_completion(&operation)?
        } else {
            None
        };

        if self.shared_terminal.is_none() {
            self.begin_operation(
                operation,
                &mut work,
                &mut generated_effects,
                &mut generated_events,
                event_budget,
            )?;
            self.run_work(
                &mut work,
                &mut generated_effects,
                &mut generated_events,
                Some(self.event_budget),
            )?;
        }

        if let Some((endpoint, request_id, result)) = storage_completion
            && self.shared_terminal.is_none()
        {
            self.storage
                .settle_pending_request(endpoint, request_id, result)
                .map_err(adapter_error)?;
        }
        if let Some(operation) = fault_script_operation {
            self.commit_fault_script_operation(operation)?;
        }

        let effects_digest =
            content_digest(&generated_effects).map_err(|error| SimulatedPairError::Adapter {
                reason: format!("effects could not be canonicalized: {error}"),
            })?;
        self.advance_sequence()?;

        Ok(PairStep {
            sequence: self.sequence,
            operation: operation_for_step,
            generated_effects,
            effects_digest,
            snapshot: self.snapshot_live(),
        })
    }

    fn capture_rollback_state(&self) -> Result<PairRollbackState, SimulatedPairError> {
        Ok(PairRollbackState {
            host_kernel: self.host_kernel.clone(),
            guest_kernel: self.guest_kernel.clone(),
            host_keyboard: self.host_keyboard.clone(),
            guest_keyboard: self.guest_keyboard.clone(),
            sequence: self.sequence,
            clock: self.clock.export_state(),
            network: self.network.export_state(),
            presenter: self.presenter.export_state().map_err(adapter_error)?,
            storage: self.storage.export_state(),
            shared_terminal: self.shared_terminal.clone(),
            terminal_reason: self.terminal_reason.clone(),
            fault_script: self.fault_script.clone(),
            last_boundary_order: self.last_boundary_order.clone(),
            trace_audit: self.trace_audit.clone(),
            disposed: self.disposed,
        })
    }

    fn from_rollback_state(
        host_seat: SeatId,
        guest_seat: SeatId,
        seed: u64,
        event_budget: SafeU53,
        state: PairRollbackState,
    ) -> Result<Self, SimulatedPairError> {
        if event_budget == SafeU53::ZERO {
            return Err(SimulatedPairError::InvalidConfig {
                reason: "event budget must be positive".to_owned(),
            });
        }
        if host_seat == guest_seat {
            return Err(SimulatedPairError::InvalidConfig {
                reason: "host and guest seats must be distinct".to_owned(),
            });
        }

        let PairRollbackState {
            host_kernel,
            guest_kernel,
            host_keyboard,
            guest_keyboard,
            sequence,
            clock,
            network,
            presenter,
            storage,
            shared_terminal,
            terminal_reason,
            fault_script,
            last_boundary_order,
            trace_audit,
            disposed,
        } = state;
        let clock = crate::VirtualClock::from_state(clock).map_err(clock_error)?;
        let network = FaultNetwork::from_state(network).map_err(network_error)?;
        let presenter = restore_presenter(presenter).map_err(adapter_error)?;
        let storage = MemoryStorage::from_state(storage).map_err(adapter_error)?;

        Ok(Self {
            host_kernel,
            guest_kernel,
            host_seat,
            guest_seat,
            host_keyboard,
            guest_keyboard,
            sequence,
            seed,
            event_budget,
            clock,
            network,
            presenter,
            storage,
            shared_terminal,
            terminal_reason,
            fault_script,
            last_boundary_order,
            trace_audit,
            disposed,
        })
    }

    fn restore_rollback_state(
        &mut self,
        state: PairRollbackState,
    ) -> Result<(), SimulatedPairError> {
        let restored = Self::from_rollback_state(
            self.host_seat,
            self.guest_seat,
            self.seed,
            self.event_budget,
            state,
        )?;
        *self = restored;
        Ok(())
    }

    fn sync_driver_operation(&mut self, operation: &PairOperation) {
        let PairOperation::RawInput { endpoint, event } = operation else {
            return;
        };
        match event {
            RawInputEvent::KeyDown {
                code,
                printable,
                focus,
                ..
            } => {
                if self.keyboard(*endpoint).input_focus() != *focus {
                    let _ = self.keyboard_mut(*endpoint).focus(*focus);
                }
                let _ = self.keyboard(*endpoint).key_down(code.clone(), *printable);
            }
            RawInputEvent::KeyUp { code } => {
                let _ = self.keyboard(*endpoint).key_up(code.clone());
            }
            RawInputEvent::FocusChanged(focus) => {
                let _ = self.keyboard_mut(*endpoint).focus(*focus);
            }
            RawInputEvent::WindowBlurred => {
                let _ = self.keyboard(*endpoint).blur();
            }
            RawInputEvent::WindowFocused => {
                let _ = self.keyboard_mut(*endpoint).focus(InputFocus::Game);
            }
            RawInputEvent::GamepadDown { .. } | RawInputEvent::GamepadUp { .. } => {}
        }
    }

    fn validate_storage_completion(
        &self,
        operation: &PairOperation,
    ) -> Result<Option<(SeatId, SafeU53, StorageResult)>, SimulatedPairError> {
        let PairOperation::StorageResult {
            endpoint,
            request_id,
            result,
        } = operation
        else {
            return Ok(None);
        };
        let seat = self.seat(*endpoint);
        self.storage
            .validate_pending_result(seat, *request_id, result)
            .map_err(adapter_error)?;
        Ok(Some((seat, *request_id, result.clone())))
    }

    fn prepare_fault_script_operation(
        &self,
        operation: &PairOperation,
    ) -> Result<Option<crate::snapshot::FaultOperationV2>, SimulatedPairError> {
        let PairOperation::Fault { operation } = operation else {
            return Ok(None);
        };
        let frozen =
            freeze_fault_operation(operation).map_err(|error| SimulatedPairError::Adapter {
                reason: format!("fault operation cannot enter the V2 script: {error}"),
            })?;
        if self.fault_script.cursor == SafeU53::MAX {
            return Err(SimulatedPairError::Adapter {
                reason: "fault script cursor exhausted".to_owned(),
            });
        }
        let cursor = usize::try_from(self.fault_script.cursor.get()).map_err(|_| {
            SimulatedPairError::Adapter {
                reason: "fault script cursor exceeds usize".to_owned(),
            }
        })?;
        if cursor > self.fault_script.operations.len() {
            return Err(SimulatedPairError::Adapter {
                reason: "fault script cursor exceeds operation count".to_owned(),
            });
        }
        if let Some(expected) = self.fault_script.operations.get(cursor)
            && expected != &frozen
        {
            return Err(SimulatedPairError::Adapter {
                reason: "fault operation differs from the restored script cursor".to_owned(),
            });
        }
        Ok(Some(frozen))
    }

    fn commit_fault_script_operation(
        &mut self,
        operation: crate::snapshot::FaultOperationV2,
    ) -> Result<(), SimulatedPairError> {
        let cursor = usize::try_from(self.fault_script.cursor.get()).map_err(|_| {
            SimulatedPairError::Adapter {
                reason: "fault script cursor exceeds usize".to_owned(),
            }
        })?;
        if cursor == self.fault_script.operations.len() {
            self.fault_script.operations.push(operation);
        }
        let next = self
            .fault_script
            .cursor
            .get()
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or_else(|| SimulatedPairError::Adapter {
                reason: "fault script cursor exhausted".to_owned(),
            })?;
        self.fault_script.cursor = next;
        Ok(())
    }

    pub fn key_down(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
        printable: bool,
    ) -> Result<PairStep, SimulatedPairError> {
        let event = RawInputEvent::KeyDown {
            code,
            printable,
            browser_repeat: false,
            focus: self.keyboard(endpoint).input_focus(),
        };
        self.apply(PairOperation::RawInput { endpoint, event })
    }

    pub fn key_up(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
    ) -> Result<PairStep, SimulatedPairError> {
        self.apply(PairOperation::RawInput {
            endpoint,
            event: RawInputEvent::KeyUp { code },
        })
    }

    pub fn press(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
    ) -> Result<Vec<PairStep>, SimulatedPairError> {
        self.run_atomic_composite(PairCompositeOperation::Press { endpoint, code })
    }

    pub fn hold_for(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
        duration_ms: SafeU53,
    ) -> Result<Vec<PairStep>, SimulatedPairError> {
        self.run_atomic_composite(PairCompositeOperation::Hold {
            endpoint,
            code,
            duration_ms,
        })
    }

    fn run_atomic_composite(
        &mut self,
        operation: PairCompositeOperation,
    ) -> Result<Vec<PairStep>, SimulatedPairError> {
        let rollback = self.capture_rollback_state()?;
        let result = match operation {
            PairCompositeOperation::Press { endpoint, code } => {
                self.run_press_composite(endpoint, code)
            }
            PairCompositeOperation::Hold {
                endpoint,
                code,
                duration_ms,
            } => self.run_hold_composite(endpoint, code, duration_ms),
        };
        match result {
            Ok(value) => Ok(value),
            Err(error) => {
                if let Err(rollback_error) = self.restore_rollback_state(rollback) {
                    return Err(SimulatedPairError::Adapter {
                        reason: format!(
                            "pair composite failed ({error}); restoring its atomic boundary failed ({rollback_error})"
                        ),
                    });
                }
                Err(error)
            }
        }
    }

    fn run_press_composite(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
    ) -> Result<Vec<PairStep>, SimulatedPairError> {
        let key_down = self.key_down(endpoint, code.clone(), is_printable_key(&code))?;
        let key_up = self.key_up(endpoint, code)?;
        Ok(vec![key_down, key_up])
    }

    fn run_hold_composite(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
        duration_ms: SafeU53,
    ) -> Result<Vec<PairStep>, SimulatedPairError> {
        if duration_ms == SafeU53::ZERO {
            return self.press(endpoint, code);
        }
        if self.shared_terminal.is_some() {
            let key_down = self.key_down(endpoint, code.clone(), is_printable_key(&code))?;
            let advance = self.advance_time(duration_ms)?;
            let key_up = self.key_up(endpoint, code)?;
            return Ok(vec![key_down, advance, key_up]);
        }

        let key_down_event = self
            .keyboard(endpoint)
            .key_down(code.clone(), is_printable_key(&code));
        self.keyboard(endpoint)
            .set_active_hold(code.clone(), duration_ms)
            .map_err(adapter_error)?;
        let key_down = self.apply(PairOperation::RawInput {
            endpoint,
            event: key_down_event,
        })?;
        let advance = self.advance_time(duration_ms)?;
        let key_up = self.key_up(endpoint, code)?;
        Ok(vec![key_down, advance, key_up])
    }

    pub fn blur(&mut self, endpoint: PairEndpoint) -> Result<PairStep, SimulatedPairError> {
        self.apply(PairOperation::RawInput {
            endpoint,
            event: RawInputEvent::WindowBlurred,
        })
    }

    pub fn focus(
        &mut self,
        endpoint: PairEndpoint,
        focus: InputFocus,
    ) -> Result<PairStep, SimulatedPairError> {
        self.apply(PairOperation::RawInput {
            endpoint,
            event: RawInputEvent::FocusChanged(focus),
        })
    }

    pub fn advance_time(&mut self, delta_ms: SafeU53) -> Result<PairStep, SimulatedPairError> {
        self.apply(PairOperation::AdvanceTime { delta_ms })
    }

    pub fn snapshot(&self) -> Result<PairSnapshot, SimulatedPairError> {
        self.ensure_live()?;
        Ok(self.snapshot_live())
    }

    pub fn teardown(&mut self, reason: &str) -> Result<PairSnapshot, SimulatedPairError> {
        self.ensure_live()?;
        if self.shared_terminal.is_some() {
            self.disposed = true;
            return Ok(self.snapshot_live());
        }

        let mut generated_effects = Vec::new();
        let mut generated_events = 0_u64;
        let mut work = VecDeque::new();
        self.queue_kernel_disposal(PairEndpoint::Guest, reason, &mut work);
        self.queue_kernel_disposal(PairEndpoint::Host, reason, &mut work);

        let result = self.run_work(
            &mut work,
            &mut generated_effects,
            &mut generated_events,
            None,
        );

        self.clock.dispose();
        self.network.dispose();
        self.presenter.dispose();
        self.storage.dispose();
        let _ = self.host_keyboard.blur();
        let _ = self.guest_keyboard.blur();
        self.disposed = true;
        if self.terminal_reason.is_none() {
            self.terminal_reason = Some(reason.to_owned());
        }

        result.map(|()| self.snapshot_live())
    }

    fn begin_operation(
        &mut self,
        operation: PairOperation,
        work: &mut VecDeque<PairWork>,
        generated_effects: &mut Vec<KernelEffect>,
        generated_events: &mut u64,
        event_budget: SafeU53,
    ) -> Result<(), SimulatedPairError> {
        match operation {
            PairOperation::RawInput { endpoint, event } => {
                let seat = self.seat(endpoint);
                work.push_back(PairWork::Input {
                    endpoint,
                    input: KernelInput::RawInput { seat, event },
                });
            }
            PairOperation::AdvanceTime { delta_ms } => {
                self.advance_environment(
                    delta_ms,
                    work,
                    generated_effects,
                    generated_events,
                    event_budget,
                )?;
                self.host_keyboard.advance_active_holds(delta_ms);
                self.guest_keyboard.advance_active_holds(delta_ms);
            }
            PairOperation::Fault { operation } => {
                let events = self
                    .network
                    .apply(operation, self.clock.now())
                    .map_err(network_error)?;
                self.queue_network_events(events, work)?;
                self.run_work(
                    work,
                    generated_effects,
                    generated_events,
                    Some(event_budget),
                )?;
                self.drain_due_clock(work, generated_effects, generated_events, event_budget)?;
            }
            PairOperation::Disconnect { endpoint } => {
                self.disconnect(endpoint, work)?;
            }
            PairOperation::Reconnect { endpoint } => {
                self.reconnect(endpoint, work)?;
            }
            PairOperation::PresentationSettled {
                endpoint,
                event_id,
                outcome,
            } => {
                let endpoint_seat = self.seat(endpoint);
                let completions = self
                    .presenter
                    .settle(endpoint_seat, event_id, outcome)
                    .map_err(adapter_error)?;
                self.queue_presentation_completions(endpoint, completions, work);
            }
            PairOperation::BattlePresentationOutcome {
                endpoint,
                event_id,
                outcome,
            } => {
                let endpoint_seat = self.seat(endpoint);
                let completions = self
                    .presenter
                    .settle_battle(endpoint_seat, event_id, outcome)
                    .map_err(adapter_error)?;
                self.queue_battle_presentation_completions(endpoint, completions, work);
            }
            PairOperation::StorageResult {
                endpoint,
                request_id,
                result,
            } => {
                work.push_back(PairWork::Input {
                    endpoint,
                    input: KernelInput::StorageResult {
                        endpoint: self.seat(endpoint),
                        request_id,
                        result,
                    },
                });
            }
            PairOperation::Suspend { endpoint } => {
                self.suspend(endpoint, work)?;
            }
            PairOperation::Resume { endpoint } => {
                self.resume(endpoint, work)?;
            }
        }
        Ok(())
    }

    fn advance_environment(
        &mut self,
        delta_ms: SafeU53,
        work: &mut VecDeque<PairWork>,
        generated_effects: &mut Vec<KernelEffect>,
        generated_events: &mut u64,
        event_budget: SafeU53,
    ) -> Result<(), SimulatedPairError> {
        self.last_boundary_order.clear();
        let target_value = self
            .clock
            .now()
            .get()
            .checked_add(delta_ms.get())
            .ok_or_else(|| clock_error(crate::VirtualClockError::TimeOverflow))?;
        let target = SafeU53::new(target_value)
            .map_err(|_| clock_error(crate::VirtualClockError::TimeOverflow))?;
        let mut timer_events = self.clock.sync().map_err(clock_error)?;

        loop {
            self.settle_environment_boundary(
                timer_events,
                work,
                generated_effects,
                generated_events,
                event_budget,
            )?;
            if self.shared_terminal.is_some() {
                return Ok(());
            }

            let now = self.clock.now();
            if now == target {
                return Ok(());
            }

            let mut next_delta = target.get() - now.get();
            if let Some(timer_delta) = self.clock.next_deadline_delta() {
                next_delta = next_delta.min(timer_delta.get());
            }
            if let Some(network_delta) = self.next_network_deadline_delta() {
                next_delta = next_delta.min(network_delta);
            }
            if next_delta == 0 {
                return Err(SimulatedPairError::Adapter {
                    reason: "environment boundary did not advance after due work quiesced"
                        .to_owned(),
                });
            }

            let step = SafeU53::new(next_delta)
                .map_err(|_| clock_error(crate::VirtualClockError::TimeOverflow))?;
            timer_events = self.clock.advance(step).map_err(clock_error)?;
        }
    }

    fn settle_environment_boundary(
        &mut self,
        timer_events: Vec<crate::ClockEvent>,
        work: &mut VecDeque<PairWork>,
        generated_effects: &mut Vec<KernelEffect>,
        generated_events: &mut u64,
        event_budget: SafeU53,
    ) -> Result<(), SimulatedPairError> {
        // Same-time order is fixed: endpoint-qualified timers first, including
        // zero-delay timer chains to quiescence; then fault-network packets in
        // network order; then zero-delay timers created by packet handling.
        // A future packet deadline still wins over every later timer boundary.
        self.record_clock_order(&timer_events);
        self.queue_clock_events(timer_events, work)?;
        self.run_work(
            work,
            generated_effects,
            generated_events,
            Some(event_budget),
        )?;
        if self.shared_terminal.is_some() {
            return Ok(());
        }
        self.drain_due_clock(work, generated_effects, generated_events, event_budget)?;
        if self.shared_terminal.is_some() {
            return Ok(());
        }

        let network_events = self
            .network
            .deliver_due(self.clock.now())
            .map_err(network_error)?;
        self.record_network_order(&network_events);
        self.queue_network_events(network_events, work)?;
        self.run_work(
            work,
            generated_effects,
            generated_events,
            Some(event_budget),
        )?;
        self.drain_due_clock(work, generated_effects, generated_events, event_budget)
    }

    fn next_network_deadline_delta(&self) -> Option<u64> {
        let now = self.clock.now().get();
        self.network
            .queued_packets()
            .into_iter()
            .map(|packet| packet.deliver_at_ms.get().saturating_sub(now))
            .min()
    }

    fn record_clock_order(&mut self, events: &[crate::ClockEvent]) {
        let at_ms = self.clock.now();
        self.last_boundary_order
            .extend(events.iter().map(|event| match event {
                crate::ClockEvent::TimerFired { endpoint, timer_id } => BoundaryOrderEvent {
                    at_ms,
                    item: BoundaryOrderItem::Timer {
                        endpoint: *endpoint,
                        timer_id: *timer_id,
                    },
                },
            }));
    }

    fn record_network_order(&mut self, events: &[NetworkEvent]) {
        let at_ms = self.clock.now();
        self.last_boundary_order
            .extend(events.iter().map(|event| match event {
                NetworkEvent::Delivered { packet } => BoundaryOrderEvent {
                    at_ms,
                    item: BoundaryOrderItem::Packet {
                        packet_id: packet.packet_id,
                    },
                },
                NetworkEvent::Dropped { packet_id } => BoundaryOrderEvent {
                    at_ms,
                    item: BoundaryOrderItem::DroppedPacket {
                        packet_id: *packet_id,
                    },
                },
            }));
    }

    fn drain_due_clock(
        &mut self,
        work: &mut VecDeque<PairWork>,
        generated_effects: &mut Vec<KernelEffect>,
        generated_events: &mut u64,
        event_budget: SafeU53,
    ) -> Result<(), SimulatedPairError> {
        if self.shared_terminal.is_some() {
            return Ok(());
        }
        loop {
            let events = self.clock.sync().map_err(clock_error)?;
            if events.is_empty() {
                return Ok(());
            }
            self.record_clock_order(&events);
            self.queue_clock_events(events, work)?;
            self.run_work(
                work,
                generated_effects,
                generated_events,
                Some(event_budget),
            )?;
            if self.shared_terminal.is_some() {
                return Ok(());
            }
        }
    }

    fn disconnect(
        &mut self,
        endpoint: PairEndpoint,
        work: &mut VecDeque<PairWork>,
    ) -> Result<(), SimulatedPairError> {
        let seat = self.seat(endpoint);
        if !self.network.disconnect(seat) {
            return Ok(());
        }
        self.set_shared_connected_clock(false)?;
        let generation = self.network.connection_generation(seat);
        work.push_back(PairWork::InputBatch(
            self.shared_transport_inputs(TransportState::Disconnected, generation),
        ));
        Ok(())
    }

    fn reconnect(
        &mut self,
        endpoint: PairEndpoint,
        work: &mut VecDeque<PairWork>,
    ) -> Result<(), SimulatedPairError> {
        let seat = self.seat(endpoint);

        // A reconnect may also be used as a hot rebind. Quiesce the shared
        // link first so neither kernel can publish while only one of its local
        // and remote identities has moved to the new generation.
        if self.network.disconnect(seat) {
            self.set_shared_connected_clock(false)?;
        }

        let generation = self.network.reconnect(seat).map_err(network_error)?;
        let link_connected = self.network.diagnostics().disconnected_endpoints.is_empty();
        if link_connected {
            self.set_shared_connected_clock(true)?;
        }

        // Each independent kernel observes the new generation's local and
        // remote disconnection before remote and local reconnection. A single
        // InputBatch defers every resulting effect until both kernels hold the
        // complete generation; the old-generation batch is intentionally never
        // delivered during a hot rebind.
        work.push_back(PairWork::InputBatch(
            self.reconnect_transport_inputs(generation, link_connected)?,
        ));
        Ok(())
    }

    fn reconnect_transport_inputs(
        &self,
        generation: ConnectionGeneration,
        link_connected: bool,
    ) -> Result<Vec<(PairEndpoint, KernelInput)>, SimulatedPairError> {
        let mut inputs = Vec::with_capacity(8);
        for kernel_endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            let local_seat = self.seat(kernel_endpoint);
            let remote_seat = self.peer_seat(local_seat)?;
            let mut transitions = vec![
                (local_seat, TransportState::Disconnected),
                (remote_seat, TransportState::Disconnected),
            ];
            if link_connected {
                transitions.extend([
                    (remote_seat, TransportState::Connected),
                    (local_seat, TransportState::Connected),
                ]);
            }
            for (observed_endpoint, state) in transitions {
                inputs.push((
                    kernel_endpoint,
                    KernelInput::TransportChanged {
                        endpoint: observed_endpoint,
                        state,
                        generation,
                    },
                ));
            }
        }
        Ok(inputs)
    }

    fn shared_transport_inputs(
        &self,
        state: TransportState,
        generation: ConnectionGeneration,
    ) -> Vec<(PairEndpoint, KernelInput)> {
        let mut inputs = Vec::with_capacity(4);
        for kernel_endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            for observed_endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
                inputs.push((
                    kernel_endpoint,
                    KernelInput::TransportChanged {
                        endpoint: self.seat(observed_endpoint),
                        state,
                        generation,
                    },
                ));
            }
        }
        inputs
    }

    fn set_shared_connected_clock(&mut self, connected: bool) -> Result<(), SimulatedPairError> {
        let commands = [self.host_seat, self.guest_seat]
            .into_iter()
            .map(|endpoint| {
                if connected {
                    SchedulerCommand::ResumeClass {
                        endpoint,
                        time_class: TimeClass::Connected,
                        reason: "disconnected".to_owned(),
                    }
                } else {
                    SchedulerCommand::PauseClass {
                        endpoint,
                        time_class: TimeClass::Connected,
                        reason: "disconnected".to_owned(),
                    }
                }
            })
            .collect();
        self.apply_clock_commands(commands)
    }

    fn suspend(
        &mut self,
        endpoint: PairEndpoint,
        work: &mut VecDeque<PairWork>,
    ) -> Result<(), SimulatedPairError> {
        let seat = self.seat(endpoint);
        if !self.network.suspend(seat) {
            return Ok(());
        }
        self.apply_clock_commands(suspension_commands(seat, true))?;
        work.push_back(PairWork::Input {
            endpoint,
            input: KernelInput::Suspend { endpoint: seat },
        });
        Ok(())
    }

    fn resume(
        &mut self,
        endpoint: PairEndpoint,
        work: &mut VecDeque<PairWork>,
    ) -> Result<(), SimulatedPairError> {
        let seat = self.seat(endpoint);
        if !self.network.resume(seat) {
            return Ok(());
        }
        self.apply_clock_commands(suspension_commands(seat, false))?;
        work.push_back(PairWork::Input {
            endpoint,
            input: KernelInput::Resume { endpoint: seat },
        });
        Ok(())
    }

    fn apply_clock_commands(
        &mut self,
        commands: Vec<SchedulerCommand>,
    ) -> Result<(), SimulatedPairError> {
        for command in commands {
            self.clock.apply(command).map_err(clock_error)?;
        }
        Ok(())
    }

    fn run_work(
        &mut self,
        work: &mut VecDeque<PairWork>,
        generated_effects: &mut Vec<KernelEffect>,
        generated_events: &mut u64,
        budget: Option<SafeU53>,
    ) -> Result<(), SimulatedPairError> {
        while let Some(item) = work.pop_front() {
            match item {
                PairWork::Input { endpoint, input } => {
                    let effects =
                        self.step_kernel_input(endpoint, input, generated_events, budget)?;
                    self.trace_audit
                        .effect_origins
                        .extend(std::iter::repeat_n(endpoint, effects.len()));
                    generated_effects.extend(effects.iter().cloned());
                    for effect in effects.into_iter().rev() {
                        work.push_front(PairWork::Effect(effect));
                    }
                }
                PairWork::InputBatch(inputs) => {
                    let mut batch_effects = Vec::new();
                    for (endpoint, input) in inputs {
                        let effects =
                            self.step_kernel_input(endpoint, input, generated_events, budget)?;
                        self.trace_audit
                            .effect_origins
                            .extend(std::iter::repeat_n(endpoint, effects.len()));
                        generated_effects.extend(effects.iter().cloned());
                        batch_effects.extend(effects);
                    }
                    for effect in batch_effects.into_iter().rev() {
                        work.push_front(PairWork::Effect(effect));
                    }
                }
                PairWork::Effect(effect) => self.consume_effect(effect, work)?,
            }
        }
        Ok(())
    }

    fn step_kernel_input(
        &mut self,
        endpoint: PairEndpoint,
        input: KernelInput,
        generated_events: &mut u64,
        budget: Option<SafeU53>,
    ) -> Result<Vec<KernelEffect>, SimulatedPairError> {
        if let Some(limit) = budget {
            if *generated_events >= limit.get() {
                return Err(SimulatedPairError::EventBudgetExceeded {
                    event_budget: limit,
                });
            }
            *generated_events += 1;
        }

        let effects = self
            .kernel_mut(endpoint)
            .step(input)
            .map_err(kernel_error)?;
        let (rng_audit, internal_events) = self.kernel(endpoint).m3_trace_audit();
        let internal_events = internal_events.into_iter().map(freeze_internal_event_kind);
        match endpoint {
            PairEndpoint::Host => {
                self.trace_audit.host_rng_audit.extend(rng_audit);
                self.trace_audit
                    .host_internal_events
                    .extend(internal_events);
            }
            PairEndpoint::Guest => {
                self.trace_audit.guest_rng_audit.extend(rng_audit);
                self.trace_audit
                    .guest_internal_events
                    .extend(internal_events);
            }
        }
        Ok(effects)
    }

    fn consume_effect(
        &mut self,
        effect: KernelEffect,
        work: &mut VecDeque<PairWork>,
    ) -> Result<(), SimulatedPairError> {
        match effect {
            KernelEffect::SendFrame { from, frame } => {
                self.require_seat(from)?;
                let to = self.peer_seat(from)?;
                let raw =
                    serde_json::to_value(&frame).map_err(|error| SimulatedPairError::Network {
                        reason: format!("frame could not be serialized for transport: {error}"),
                    })?;
                self.network
                    .enqueue(
                        from,
                        to,
                        frame.context.connection_generation,
                        NetworkPayload::Frame(RawFrame::JsonValue(raw)),
                        self.clock.now(),
                    )
                    .map_err(network_error)?;
            }
            KernelEffect::SendProposal { proposal } => {
                self.require_seat(proposal.from)?;
                self.require_seat(proposal.to)?;
                self.network
                    .enqueue(
                        proposal.from,
                        proposal.to,
                        proposal.connection_generation,
                        NetworkPayload::Proposal(proposal),
                        self.clock.now(),
                    )
                    .map_err(network_error)?;
            }
            KernelEffect::ScheduleTimer {
                endpoint,
                timer_id,
                owner,
                delay_ms,
                time_class,
            } => {
                self.require_seat(endpoint)?;
                self.clock
                    .apply(SchedulerCommand::Schedule {
                        timer: ScheduledTimer {
                            endpoint,
                            timer_id,
                            owner,
                            delay_ms,
                            time_class,
                        },
                    })
                    .map_err(clock_error)?;
            }
            KernelEffect::CancelTimer { endpoint, timer_id } => {
                self.require_seat(endpoint)?;
                self.clock
                    .apply(SchedulerCommand::Cancel { endpoint, timer_id })
                    .map_err(clock_error)?;
            }
            KernelEffect::UiChanged { endpoint, .. }
            | KernelEffect::BattleUiChanged { endpoint, .. }
            | KernelEffect::UiIntent { endpoint, .. } => {
                self.require_seat(endpoint)?;
            }
            KernelEffect::Present { endpoint, event } => {
                let seat = self.require_seat(endpoint)?;
                let completions = self.presenter.present(seat, event).map_err(adapter_error)?;
                self.queue_presentation_completions(
                    self.endpoint_for_seat(seat)?,
                    completions,
                    work,
                );
            }
            KernelEffect::PresentBattle { endpoint, event } => {
                let seat = self.require_seat(endpoint)?;
                let completions = self
                    .presenter
                    .present_battle(seat, event)
                    .map_err(adapter_error)?;
                self.queue_battle_presentation_completions(
                    self.endpoint_for_seat(seat)?,
                    completions,
                    work,
                );
            }
            KernelEffect::Persist { endpoint, request } => {
                let seat = self.require_seat(endpoint)?;
                let request_id = request.request_id;
                let result = self.storage.execute(request).map_err(adapter_error)?;
                work.push_front(PairWork::Input {
                    endpoint: self.endpoint_for_seat(seat)?,
                    input: KernelInput::StorageResult {
                        endpoint: seat,
                        request_id,
                        result,
                    },
                });
            }
            KernelEffect::ApplyAuthorityMaterial {
                endpoint, revision, ..
            } => {
                let seat = self.require_seat(endpoint)?;
                work.push_front(PairWork::Input {
                    endpoint: self.endpoint_for_seat(seat)?,
                    input: KernelInput::MaterialApplied {
                        endpoint: seat,
                        revision,
                        outcome: MaterialApplicationOutcome::Applied,
                    },
                });
            }
            KernelEffect::ProjectAuthorityControl {
                endpoint,
                revision,
                control,
                ..
            } => {
                let seat = self.require_seat(endpoint)?;
                let control_id = control_id_of(&control);
                work.push_front(PairWork::Input {
                    endpoint: self.endpoint_for_seat(seat)?,
                    input: KernelInput::ControlProjected {
                        endpoint: seat,
                        revision,
                        outcome: ControlProjectionOutcome::Installed { control_id },
                    },
                });
            }
            KernelEffect::EnterSharedTerminal { terminal } => {
                self.consume_shared_terminal(terminal)?;
                work.clear();
            }
        }
        Ok(())
    }

    fn consume_shared_terminal(
        &mut self,
        terminal: TerminalState,
    ) -> Result<(), SimulatedPairError> {
        if let Some(existing) = &self.shared_terminal {
            if existing.reason != terminal.reason {
                return Err(SimulatedPairError::Adapter {
                    reason: format!(
                        "conflicting terminal reasons: {} and {}",
                        existing.reason, terminal.reason
                    ),
                });
            }
            if existing.terminal_id != terminal.terminal_id {
                return Err(SimulatedPairError::Adapter {
                    reason: format!(
                        "conflicting terminal ids: {} and {}",
                        existing.terminal_id, terminal.terminal_id
                    ),
                });
            }
            return Ok(());
        }

        if let Some(existing) = &self.terminal_reason
            && existing != &terminal.reason
        {
            return Err(SimulatedPairError::Adapter {
                reason: format!(
                    "conflicting terminal reasons: {existing} and {}",
                    terminal.reason
                ),
            });
        }

        self.terminal_reason = Some(terminal.reason.clone());
        self.shared_terminal = Some(terminal.clone());

        // Install the exact shared value while the kernels are still live.
        // GameKernel::replace_menu is inert after disposal, while the pair
        // contract requires both endpoint projections to retain this value.
        self.project_shared_terminal(&terminal)?;

        // Shared terminal is the absorbing mechanical boundary. Kernel
        // disposal clears every internal timer/protocol owner; disposing the
        // pair adapters then releases their corresponding registrations and
        // pending values without publishing another semantic message.
        let _ = self.guest_kernel.dispose(&terminal.reason);
        let _ = self.host_kernel.dispose(&terminal.reason);
        self.clock.dispose();
        self.network.dispose();
        self.presenter.dispose();
        self.storage.dispose();
        let _ = self.host_keyboard.blur();
        let _ = self.guest_keyboard.blur();
        self.last_boundary_order.clear();
        Ok(())
    }

    fn project_shared_terminal(
        &mut self,
        terminal: &TerminalState,
    ) -> Result<(), SimulatedPairError> {
        let menu = MenuState::Terminal(TerminalMenu {
            terminal_id: terminal.terminal_id.clone(),
            prompt_key: Some(terminal.reason.clone()),
        });

        for endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            let kernel = self.kernel_mut(endpoint);
            let ui = kernel.ui_state();
            let already_projected = ui.owner_seat.is_none()
                && !ui.actionable
                && ui.stack.len() == 1
                && ui.stack.first() == Some(&menu);
            if !already_projected {
                kernel.replace_menu(None, false, menu.clone());
            }
        }
        for endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            <GameKernel as GameKernelSnapshotBridge>::accept_shared_terminal_root(
                self.kernel_mut(endpoint),
                terminal,
            )
            .map_err(adapter_error)?;
        }
        Ok(())
    }

    fn queue_kernel_disposal(
        &mut self,
        endpoint: PairEndpoint,
        reason: &str,
        work: &mut VecDeque<PairWork>,
    ) {
        let effects = self.kernel_mut(endpoint).dispose(reason);
        for effect in effects.into_iter().rev() {
            work.push_front(PairWork::Effect(effect));
        }
    }

    fn queue_clock_events(
        &self,
        events: Vec<crate::ClockEvent>,
        work: &mut VecDeque<PairWork>,
    ) -> Result<(), SimulatedPairError> {
        for event in events.into_iter().rev() {
            let crate::ClockEvent::TimerFired { endpoint, timer_id } = event;
            let pair_endpoint = self.endpoint_for_seat(endpoint)?;
            work.push_front(PairWork::Input {
                endpoint: pair_endpoint,
                input: KernelInput::TimerFired { endpoint, timer_id },
            });
        }
        Ok(())
    }

    fn queue_network_events(
        &self,
        events: Vec<NetworkEvent>,
        work: &mut VecDeque<PairWork>,
    ) -> Result<(), SimulatedPairError> {
        for event in events.into_iter().rev() {
            let NetworkEvent::Delivered { packet } = event else {
                continue;
            };
            let endpoint = self.endpoint_for_seat(packet.to)?;
            let input = match packet.payload {
                NetworkPayload::Frame(frame) => KernelInput::RawNetworkFrame {
                    endpoint: packet.to,
                    frame,
                },
                NetworkPayload::Proposal(proposal) => KernelInput::ProposalReceived {
                    endpoint: packet.to,
                    proposal,
                },
            };
            work.push_front(PairWork::Input { endpoint, input });
        }
        Ok(())
    }

    fn queue_presentation_completions(
        &self,
        endpoint: PairEndpoint,
        completions: Vec<crate::PresentationCompletion>,
        work: &mut VecDeque<PairWork>,
    ) {
        let seat = self.seat(endpoint);
        for completion in completions.into_iter().rev() {
            work.push_front(PairWork::Input {
                endpoint,
                input: KernelInput::PresentationSettled {
                    endpoint: seat,
                    event_id: completion.event_id,
                    outcome: completion.outcome,
                },
            });
        }
    }

    fn queue_battle_presentation_completions(
        &self,
        endpoint: PairEndpoint,
        completions: Vec<crate::BattlePresentationCompletion>,
        work: &mut VecDeque<PairWork>,
    ) {
        let seat = self.seat(endpoint);
        for completion in completions.into_iter().rev() {
            work.push_front(PairWork::Input {
                endpoint,
                input: KernelInput::BattlePresentationOutcome {
                    endpoint: seat,
                    event_id: completion.event_id,
                    outcome: completion.outcome,
                },
            });
        }
    }

    fn kernel_mut(&mut self, endpoint: PairEndpoint) -> &mut GameKernel {
        match endpoint {
            PairEndpoint::Host => &mut self.host_kernel,
            PairEndpoint::Guest => &mut self.guest_kernel,
        }
    }

    fn kernel(&self, endpoint: PairEndpoint) -> &GameKernel {
        match endpoint {
            PairEndpoint::Host => &self.host_kernel,
            PairEndpoint::Guest => &self.guest_kernel,
        }
    }

    fn seat(&self, endpoint: PairEndpoint) -> SeatId {
        match endpoint {
            PairEndpoint::Host => self.host_seat,
            PairEndpoint::Guest => self.guest_seat,
        }
    }

    fn endpoint_for_seat(&self, seat: SeatId) -> Result<PairEndpoint, SimulatedPairError> {
        if seat == self.host_seat {
            Ok(PairEndpoint::Host)
        } else if seat == self.guest_seat {
            Ok(PairEndpoint::Guest)
        } else {
            Err(SimulatedPairError::Adapter {
                reason: format!("seat {seat} is not configured for this pair"),
            })
        }
    }

    fn peer_seat(&self, seat: SeatId) -> Result<SeatId, SimulatedPairError> {
        if seat == self.host_seat {
            Ok(self.guest_seat)
        } else if seat == self.guest_seat {
            Ok(self.host_seat)
        } else {
            Err(SimulatedPairError::Network {
                reason: format!("seat {seat} is not configured for this pair"),
            })
        }
    }

    fn require_seat(&self, seat: SeatId) -> Result<SeatId, SimulatedPairError> {
        self.endpoint_for_seat(seat).map(|_| seat)
    }

    fn keyboard(&self, endpoint: PairEndpoint) -> &DetachedKeyboardDriver {
        match endpoint {
            PairEndpoint::Host => &self.host_keyboard,
            PairEndpoint::Guest => &self.guest_keyboard,
        }
    }

    fn keyboard_mut(&mut self, endpoint: PairEndpoint) -> &mut DetachedKeyboardDriver {
        match endpoint {
            PairEndpoint::Host => &mut self.host_keyboard,
            PairEndpoint::Guest => &mut self.guest_keyboard,
        }
    }

    fn advance_sequence(&mut self) -> Result<(), SimulatedPairError> {
        let next = self
            .sequence
            .get()
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or_else(|| SimulatedPairError::Adapter {
                reason: "pair sequence exhausted".to_owned(),
            })?;
        self.sequence = next;
        Ok(())
    }

    fn snapshot_live(&self) -> PairSnapshot {
        PairSnapshot {
            sequence: self.sequence,
            seed: self.seed.to_string(),
            virtual_time_ms: self.clock.now(),
            clock_timers: self.clock.pending_timers(),
            host: self.endpoint_snapshot(PairEndpoint::Host),
            guest: self.endpoint_snapshot(PairEndpoint::Guest),
            network: self.network.diagnostics(),
            presenter: self.presenter.diagnostics(),
            storage: self.storage.diagnostics(),
            terminal_reason: self.terminal_reason.clone(),
        }
    }

    fn endpoint_snapshot(&self, endpoint: PairEndpoint) -> EndpointSnapshot {
        let kernel = match endpoint {
            PairEndpoint::Host => &self.host_kernel,
            PairEndpoint::Guest => &self.guest_kernel,
        };
        let kernel_snapshot = kernel.snapshot();
        let state_digest = match content_digest(&kernel_snapshot) {
            Ok(digest) => digest,
            Err(error) => format!("invalid-kernel-state:{error}"),
        };
        EndpointSnapshot {
            kernel: kernel_snapshot,
            ui: kernel.ui_view(),
            state_digest,
            live_resources: kernel.live_resources(),
            presenter: self.presenter.diagnostics_for(self.seat(endpoint)),
        }
    }

    fn ensure_live(&self) -> Result<(), SimulatedPairError> {
        if self.disposed {
            Err(SimulatedPairError::Disposed)
        } else {
            Ok(())
        }
    }
}

impl SimulatedPairSnapshotBridge for SimulatedPair {
    fn snapshot_v2(&self) -> Result<RestorablePairSnapshotV2, SnapshotError> {
        self.capture_restorable_pair_snapshot_v2()
    }

    fn from_snapshot_v2(
        snapshot: RestorablePairSnapshotV2,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError> {
        Self::restore_restorable_pair_snapshot_v2(snapshot, content)
    }
}

fn project_trace_live_resources(
    snapshot: &RestorablePairSnapshotV2,
    endpoint: PairEndpoint,
    mut resources: LiveResourceSnapshot,
) -> LiveResourceSnapshot {
    resources.network_packets = snapshot
        .network
        .packets
        .iter()
        .filter(|packet| packet.source == endpoint)
        .map(|packet| packet.packet_id)
        .collect();
    resources
}

fn pair_snapshot_invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn pair_snapshot_canonical(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Canonical {
        path: path.into(),
        reason: reason.into(),
    }
}

fn map_kernel_snapshot_error(error: er_kernel::snapshot::SnapshotError) -> SnapshotError {
    match error {
        er_kernel::snapshot::SnapshotError::Invalid { path, reason } => {
            pair_snapshot_invalid(path, reason)
        }
        er_kernel::snapshot::SnapshotError::Canonical { path, reason } => {
            pair_snapshot_canonical(path, reason)
        }
    }
}

fn freeze_internal_event_kind(
    kind: er_game::internal_event::InternalEventKind,
) -> InternalEventKindV1 {
    match kind {
        er_game::internal_event::InternalEventKind::Button => InternalEventKindV1::Button,
        er_game::internal_event::InternalEventKind::Ui => InternalEventKindV1::Ui,
        er_game::internal_event::InternalEventKind::Game => InternalEventKindV1::Game,
        er_game::internal_event::InternalEventKind::Protocol => InternalEventKindV1::Protocol,
        er_game::internal_event::InternalEventKind::BattleResolved => {
            InternalEventKindV1::BattleResolved
        }
        er_game::internal_event::InternalEventKind::AuthorityEntryReady => {
            InternalEventKindV1::AuthorityEntryReady
        }
        er_game::internal_event::InternalEventKind::MaterialInstalled => {
            InternalEventKindV1::MaterialInstalled
        }
        er_game::internal_event::InternalEventKind::ControlInstalled => {
            InternalEventKindV1::ControlInstalled
        }
    }
}

fn thaw_pair_operation_v2(operation: &PairOperationV2) -> Result<PairOperation, SnapshotError> {
    Ok(match operation {
        PairOperationV2::RawInput { endpoint, event } => PairOperation::RawInput {
            endpoint: *endpoint,
            event: event.clone(),
        },
        PairOperationV2::AdvanceTime { delta_ms } => PairOperation::AdvanceTime {
            delta_ms: *delta_ms,
        },
        PairOperationV2::Fault { operation } => PairOperation::Fault {
            operation: thaw_fault_operation_v2(operation)?,
        },
        PairOperationV2::Disconnect { endpoint } => PairOperation::Disconnect {
            endpoint: *endpoint,
        },
        PairOperationV2::Reconnect { endpoint } => PairOperation::Reconnect {
            endpoint: *endpoint,
        },
        PairOperationV2::BattlePresentationOutcome {
            endpoint,
            event_id,
            outcome,
        } => PairOperation::BattlePresentationOutcome {
            endpoint: *endpoint,
            event_id: event_id.clone(),
            outcome: outcome.clone(),
        },
        PairOperationV2::StorageResult {
            endpoint,
            request_id,
            result,
        } => PairOperation::StorageResult {
            endpoint: *endpoint,
            request_id: *request_id,
            result: thaw_storage_result_v2(result)?,
        },
        PairOperationV2::Suspend { endpoint } => PairOperation::Suspend {
            endpoint: *endpoint,
        },
        PairOperationV2::Resume { endpoint } => PairOperation::Resume {
            endpoint: *endpoint,
        },
    })
}

fn thaw_fault_operation_v2(operation: &FaultOperationV2) -> Result<FaultOperation, SnapshotError> {
    Ok(match operation {
        FaultOperationV2::Deliver { packet_id } => FaultOperation::Deliver {
            packet_id: *packet_id,
        },
        FaultOperationV2::DeliverNext => FaultOperation::DeliverNext,
        FaultOperationV2::Drop { packet_id } => FaultOperation::Drop {
            packet_id: *packet_id,
        },
        FaultOperationV2::Duplicate { packet_id } => FaultOperation::Duplicate {
            packet_id: *packet_id,
        },
        FaultOperationV2::Delay {
            packet_id,
            additional_ms,
        } => FaultOperation::Delay {
            packet_id: *packet_id,
            additional_ms: *additional_ms,
        },
        FaultOperationV2::Reorder { packet_ids } => FaultOperation::Reorder {
            packet_ids: packet_ids.clone(),
        },
        FaultOperationV2::Corrupt {
            packet_id,
            corruption,
        } => FaultOperation::Corrupt {
            packet_id: *packet_id,
            corruption: match corruption {
                FrameCorruptionV2::Replace { body } => crate::FrameCorruption::Replace {
                    value: decode_canonical_value(body, "trace.input.corruption.body")?,
                },
                FrameCorruptionV2::DeleteField { json_pointer } => {
                    crate::FrameCorruption::DeleteField {
                        json_pointer: json_pointer.clone(),
                    }
                }
                FrameCorruptionV2::ReplaceField {
                    json_pointer,
                    canonical_value,
                } => crate::FrameCorruption::ReplaceField {
                    json_pointer: json_pointer.clone(),
                    value: decode_canonical_value(
                        canonical_value,
                        "trace.input.corruption.canonical_value",
                    )?,
                },
                FrameCorruptionV2::MalformedJson { body } => {
                    let bytes = decode_hex(body, "trace.input.corruption.body")?;
                    let text = String::from_utf8(bytes).map_err(|error| {
                        pair_snapshot_invalid(
                            "trace.input.corruption.body",
                            format!("must be UTF-8: {error}"),
                        )
                    })?;
                    crate::FrameCorruption::MalformedJson { text }
                }
            },
        },
    })
}

fn thaw_storage_result_v2(
    result: &RestorableStorageResultV2,
) -> Result<StorageResult, SnapshotError> {
    Ok(match result {
        RestorableStorageResultV2::Loaded { value } => StorageResult::Loaded {
            value: value
                .as_ref()
                .map(|value| decode_canonical_value(value, "trace.input.storage_result.value"))
                .transpose()?,
        },
        RestorableStorageResultV2::Persisted => StorageResult::Persisted,
        RestorableStorageResultV2::Failed { reason } => StorageResult::Failed {
            reason: reason.clone(),
        },
    })
}

fn freeze_trace_effect(
    effect: &KernelEffect,
) -> Result<Option<RestorableKernelEffectV2>, SnapshotError> {
    Ok(match effect {
        KernelEffect::SendFrame { from, frame } => Some(RestorableKernelEffectV2::SendFrame {
            from: *from,
            bytes: canonical_value_bytes(frame, "trace.effects.send_frame")?,
        }),
        KernelEffect::SendProposal { proposal } => Some(RestorableKernelEffectV2::SendProposal {
            from: proposal.from,
            bytes: canonical_value_bytes(proposal, "trace.effects.send_proposal")?,
        }),
        KernelEffect::ScheduleTimer {
            endpoint,
            timer_id,
            owner,
            delay_ms,
            time_class,
        } => Some(RestorableKernelEffectV2::ScheduleTimer {
            timer: RestorableTimerSnapshotV2 {
                registration: ScheduledTimer {
                    endpoint: *endpoint,
                    timer_id: *timer_id,
                    owner: owner.clone(),
                    delay_ms: *delay_ms,
                    time_class: *time_class,
                },
                original_delay_ms: *delay_ms,
                remaining_active_ms: *delay_ms,
            },
        }),
        KernelEffect::CancelTimer { endpoint, timer_id } => {
            Some(RestorableKernelEffectV2::CancelTimer {
                endpoint: *endpoint,
                timer_id: *timer_id,
            })
        }
        KernelEffect::BattleUiChanged {
            endpoint,
            projection,
        } => Some(RestorableKernelEffectV2::BattleUiChanged {
            endpoint: *endpoint,
            projection: projection.clone(),
        }),
        KernelEffect::PresentBattle { endpoint, event } => {
            Some(RestorableKernelEffectV2::PresentBattle {
                endpoint: *endpoint,
                event: event.clone(),
            })
        }
        KernelEffect::Persist { endpoint, request } => {
            let request = match &request.value {
                None => RestorableStorageRequestV2::Load {
                    request_id: request.request_id,
                    key: request.key.clone(),
                },
                Some(value) => RestorableStorageRequestV2::Persist {
                    request_id: request.request_id,
                    key: request.key.clone(),
                    value: canonical_value_bytes(value, "trace.effects.persist.value")?,
                },
            };
            Some(match request {
                request @ RestorableStorageRequestV2::Load { .. } => {
                    RestorableKernelEffectV2::Load {
                        endpoint: *endpoint,
                        request,
                    }
                }
                request @ RestorableStorageRequestV2::Persist { .. } => {
                    RestorableKernelEffectV2::Persist {
                        endpoint: *endpoint,
                        request,
                    }
                }
            })
        }
        KernelEffect::EnterSharedTerminal { terminal } => {
            Some(RestorableKernelEffectV2::EnterSharedTerminal {
                terminal: terminal.clone(),
            })
        }
        KernelEffect::UiChanged { .. }
        | KernelEffect::UiIntent { .. }
        | KernelEffect::Present { .. }
        | KernelEffect::ApplyAuthorityMaterial { .. }
        | KernelEffect::ProjectAuthorityControl { .. } => None,
    })
}

fn pair_operation_failure_owner(operation: &PairOperationV2) -> TraceFailureOwnerV2 {
    match operation {
        PairOperationV2::RawInput { endpoint, .. }
        | PairOperationV2::Disconnect { endpoint }
        | PairOperationV2::Reconnect { endpoint }
        | PairOperationV2::BattlePresentationOutcome { endpoint, .. }
        | PairOperationV2::StorageResult { endpoint, .. }
        | PairOperationV2::Suspend { endpoint }
        | PairOperationV2::Resume { endpoint } => match endpoint {
            PairEndpoint::Host => TraceFailureOwnerV2::Host,
            PairEndpoint::Guest => TraceFailureOwnerV2::Guest,
        },
        PairOperationV2::AdvanceTime { .. } | PairOperationV2::Fault { .. } => {
            TraceFailureOwnerV2::Environment
        }
    }
}

fn pair_failure_code(error: &SimulatedPairError) -> &'static str {
    match error {
        SimulatedPairError::InvalidConfig { .. } => "PAIR_INVALID_CONFIG",
        SimulatedPairError::Disposed => "PAIR_DISPOSED",
        SimulatedPairError::Kernel { .. } => "KERNEL_TRANSITION_FAILED",
        SimulatedPairError::Clock { .. } => "CLOCK_TRANSITION_FAILED",
        SimulatedPairError::Network { .. } => "NETWORK_TRANSITION_FAILED",
        SimulatedPairError::Adapter { .. } => "ADAPTER_TRANSITION_FAILED",
        SimulatedPairError::EventBudgetExceeded { .. } => "EVENT_BUDGET_EXCEEDED",
    }
}

fn freeze_driver(state: DetachedKeyboardDriverState) -> DetachedKeyboardDriverSnapshotV2 {
    DetachedKeyboardDriverSnapshotV2 {
        seat: state.seat,
        focus: state.focus,
        pressed_keys: state.pressed_keys,
        active_holds: state
            .active_holds
            .into_iter()
            .map(|hold| DriverHoldSnapshotV2 {
                key: hold.key,
                remaining_ms: hold.remaining_ms,
            })
            .collect(),
    }
}

fn thaw_driver(
    snapshot: &DetachedKeyboardDriverSnapshotV2,
) -> Result<DetachedKeyboardDriver, SnapshotError> {
    DetachedKeyboardDriver::from_state(DetachedKeyboardDriverState {
        seat: snapshot.seat,
        focus: snapshot.focus,
        pressed_keys: snapshot.pressed_keys.clone(),
        active_holds: snapshot
            .active_holds
            .iter()
            .map(|hold| DriverHoldState {
                key: hold.key.clone(),
                remaining_ms: hold.remaining_ms,
            })
            .collect(),
    })
    .map_err(|error| pair_snapshot_invalid("driver", error.to_string()))
}

fn freeze_clock(state: VirtualClockState) -> Result<VirtualClockSnapshotV2, SnapshotError> {
    state
        .validate()
        .map_err(|error| pair_snapshot_invalid("clock", error.to_string()))?;
    let snapshot = VirtualClockSnapshotV2 {
        now_ms: state.now_ms,
        timers: state
            .timers
            .into_iter()
            .map(|timer| PairClockTimerSnapshotV2 {
                endpoint: timer.timer.endpoint,
                timer_id: timer.timer.timer_id,
                time_class: timer.timer.time_class,
                remaining_active_ms: timer.remaining_active_ms,
                paused: timer.paused,
            })
            .collect(),
        disposed: state.disposed,
    };
    snapshot.validate()?;
    Ok(snapshot)
}

fn install_pair_timer_remaining(
    endpoint: &mut RestorableKernelSnapshotV2,
    clock: &VirtualClockSnapshotV2,
) -> Result<(), SnapshotError> {
    for timer in &mut endpoint.scheduler.timers {
        let clock_timer = clock
            .timers
            .iter()
            .find(|clock_timer| {
                clock_timer.endpoint == timer.registration.endpoint
                    && clock_timer.timer_id == timer.registration.timer_id
            })
            .ok_or_else(|| {
                pair_snapshot_invalid(
                    "clock.timers",
                    "endpoint scheduler timer has no exact pair-clock registration",
                )
            })?;
        timer.remaining_active_ms = clock_timer.remaining_active_ms;
    }
    endpoint.kernel_determinism_digest =
        KernelDeterminismDigest::compute(endpoint).map_err(map_kernel_snapshot_error)?;
    endpoint.validate().map_err(map_kernel_snapshot_error)
}

fn thaw_clock(
    snapshot: &RestorablePairSnapshotV2,
    host_seat: SeatId,
    guest_seat: SeatId,
) -> Result<crate::VirtualClock, SnapshotError> {
    if snapshot.clock.disposed {
        return crate::VirtualClock::from_state(VirtualClockState {
            now_ms: snapshot.clock.now_ms,
            endpoints: Vec::new(),
            timers: Vec::new(),
            disposed: true,
        })
        .map_err(|error| pair_snapshot_invalid("clock", error.to_string()));
    }

    let mut endpoints = vec![
        thaw_clock_endpoint(host_seat, &snapshot.host, snapshot.clock.now_ms),
        thaw_clock_endpoint(guest_seat, &snapshot.guest, snapshot.clock.now_ms),
    ];
    endpoints.sort_by_key(|endpoint| endpoint.endpoint);
    let mut timers = Vec::with_capacity(snapshot.clock.timers.len());
    for clock_timer in &snapshot.clock.timers {
        let endpoint = if clock_timer.endpoint == host_seat {
            &snapshot.host
        } else if clock_timer.endpoint == guest_seat {
            &snapshot.guest
        } else {
            return Err(pair_snapshot_invalid(
                "clock.timers.endpoint",
                "clock timer names neither pair endpoint",
            ));
        };
        let registration = endpoint
            .scheduler
            .timers
            .iter()
            .find(|timer| timer.registration.timer_id == clock_timer.timer_id)
            .map(|timer| timer.registration.clone())
            .ok_or_else(|| {
                pair_snapshot_invalid(
                    "clock.timers.timer_id",
                    "clock timer has no endpoint scheduler owner",
                )
            })?;
        let active_deadline = add_snapshot_time(
            snapshot.clock.now_ms,
            clock_timer.remaining_active_ms,
            "clock.timers.remaining_active_ms",
        )?;
        timers.push(ClockTimerState {
            timer: registration,
            remaining_active_ms: clock_timer.remaining_active_ms,
            deadline_ms: if clock_timer.paused {
                snapshot.clock.now_ms
            } else {
                active_deadline
            },
            paused: clock_timer.paused,
        });
    }
    crate::VirtualClock::from_state(VirtualClockState {
        now_ms: snapshot.clock.now_ms,
        endpoints,
        timers,
        disposed: false,
    })
    .map_err(|error| pair_snapshot_invalid("clock", error.to_string()))
}

fn thaw_clock_endpoint(
    seat: SeatId,
    endpoint: &RestorableKernelSnapshotV2,
    now_ms: SafeU53,
) -> ClockEndpointState {
    let counters = [
        TimeClass::Connected,
        TimeClass::Recovery,
        TimeClass::Renderer,
        TimeClass::HumanInput,
        TimeClass::Absolute,
    ]
    .into_iter()
    .map(|time_class| ClockCounterState { time_class, now_ms })
    .collect();
    let pause_reasons = endpoint
        .scheduler
        .pauses
        .iter()
        .map(|pause| ClockPauseState {
            time_class: pause.time_class,
            reasons: pause.reasons.clone(),
        })
        .collect();
    ClockEndpointState {
        endpoint: seat,
        counters,
        pause_reasons,
    }
}

fn add_snapshot_time(left: SafeU53, right: SafeU53, path: &str) -> Result<SafeU53, SnapshotError> {
    let value = left
        .get()
        .checked_add(right.get())
        .ok_or_else(|| pair_snapshot_invalid(path, "time exceeds SafeU53"))?;
    SafeU53::new(value).map_err(|_| pair_snapshot_invalid(path, "time exceeds SafeU53"))
}

fn freeze_network(
    state: FaultNetworkState,
    host_seat: SeatId,
    guest_seat: SeatId,
) -> Result<FaultNetworkSnapshotV2, SnapshotError> {
    state
        .validate()
        .map_err(|error| pair_snapshot_invalid("network", error.to_string()))?;
    if state.endpoints != [host_seat, guest_seat] {
        return Err(pair_snapshot_invalid(
            "network.links",
            "fault network endpoint identity/order differs from the pair",
        ));
    }
    let generation = |seat: SeatId| {
        state
            .generations
            .iter()
            .find(|entry| entry.endpoint == seat)
            .map(|entry| entry.generation)
            .ok_or_else(|| pair_snapshot_invalid("network.links", "endpoint generation is absent"))
    };
    let next_packet_id = state.next_packet_id.ok_or_else(|| {
        pair_snapshot_invalid(
            "network.next_packet_id",
            "exhausted packet allocator is not representable by the frozen pair schema",
        )
    })?;
    let next_queue_order_id = state.next_queue_order_id.ok_or_else(|| {
        pair_snapshot_invalid(
            "network.next_queue_order_id",
            "exhausted queue allocator is not representable by the frozen pair schema",
        )
    })?;
    if state.packets.iter().any(|packet| {
        packet.source_generation != packet.destination_generation
            || packet.packet.connection_generation != packet.source_generation
    }) {
        return Err(pair_snapshot_invalid(
            "network.packets.connection_generation",
            "packet generation state is not representable by the frozen pair schema",
        ));
    }
    let packets = state
        .packets
        .iter()
        .map(|packet| {
            Ok(QueuedPacketSnapshotV2 {
                packet_id: packet.packet.packet_id,
                queue_order_id: packet.queue_order_id,
                kind: freeze_packet_kind(packet.kind),
                source: pair_endpoint_for_seat(packet.packet.from, host_seat, guest_seat)?,
                destination: pair_endpoint_for_seat(packet.packet.to, host_seat, guest_seat)?,
                source_generation: packet.source_generation,
                destination_generation: packet.destination_generation,
                body: canonical_value_bytes(&packet.packet.payload, "network.packets.body")?,
                enqueued_at_ms: packet.enqueued_at_ms,
                delivery_deadline_ms: packet.packet.deliver_at_ms,
                reorder_state: packet
                    .reorder_rank
                    .map_or(PacketReorderStateV2::Stable, |rank| {
                        PacketReorderStateV2::Held { rank }
                    }),
                disposition: freeze_packet_disposition(packet.disposition),
            })
        })
        .collect::<Result<Vec<_>, SnapshotError>>()?;
    let snapshot = FaultNetworkSnapshotV2 {
        next_packet_id,
        next_queue_order_id,
        packets,
        links: vec![
            crate::snapshot::NetworkLinkSnapshotV2 {
                endpoint: PairEndpoint::Host,
                generation: generation(host_seat)?,
                connected: !state.disconnected.contains(&host_seat),
                suspended: state.suspended.contains(&host_seat),
            },
            crate::snapshot::NetworkLinkSnapshotV2 {
                endpoint: PairEndpoint::Guest,
                generation: generation(guest_seat)?,
                connected: !state.disconnected.contains(&guest_seat),
                suspended: state.suspended.contains(&guest_seat),
            },
        ],
        disposed: state.disposed,
    };
    snapshot.validate()?;
    Ok(snapshot)
}

fn thaw_network(
    snapshot: &RestorablePairSnapshotV2,
    replay_seed: u64,
    host_seat: SeatId,
    guest_seat: SeatId,
) -> Result<FaultNetwork, SnapshotError> {
    let host_link = snapshot
        .network
        .links
        .iter()
        .find(|link| link.endpoint == PairEndpoint::Host)
        .ok_or_else(|| pair_snapshot_invalid("network.links", "host link is absent"))?;
    let guest_link = snapshot
        .network
        .links
        .iter()
        .find(|link| link.endpoint == PairEndpoint::Guest)
        .ok_or_else(|| pair_snapshot_invalid("network.links", "guest link is absent"))?;
    let mut generations = vec![
        FaultNetworkGenerationState {
            endpoint: host_seat,
            generation: host_link.generation,
        },
        FaultNetworkGenerationState {
            endpoint: guest_seat,
            generation: guest_link.generation,
        },
    ];
    generations.sort_by_key(|entry| entry.endpoint);
    let mut disconnected = [
        (!host_link.connected).then_some(host_seat),
        (!guest_link.connected).then_some(guest_seat),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    disconnected.sort_unstable();
    let mut suspended = [
        host_link.suspended.then_some(host_seat),
        guest_link.suspended.then_some(guest_seat),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    suspended.sort_unstable();
    let generation_for = |seat: SeatId| {
        if seat == host_seat {
            Some(host_link.generation)
        } else if seat == guest_seat {
            Some(guest_link.generation)
        } else {
            None
        }
    };
    let mut reordered_packet_ids = Vec::new();
    let mut packets = Vec::with_capacity(snapshot.network.packets.len());
    for packet in &snapshot.network.packets {
        if packet.source_generation != packet.destination_generation {
            return Err(pair_snapshot_invalid(
                "network.packets.connection_generation",
                "one transport packet cannot restore unequal source/destination generations",
            ));
        }
        let from = seat_for_pair_endpoint(packet.source, host_seat, guest_seat);
        let to = seat_for_pair_endpoint(packet.destination, host_seat, guest_seat);
        let payload =
            decode_canonical_value::<NetworkPayload>(&packet.body, "network.packets.body")?;
        let kind = thaw_packet_kind(packet.kind);
        let stale = !is_link_connected(from, host_seat, guest_seat, host_link, guest_link)
            || !is_link_connected(to, host_seat, guest_seat, host_link, guest_link)
            || generation_for(from) != Some(packet.source_generation)
            || generation_for(to) != Some(packet.destination_generation);
        let reorder_rank = match &packet.reorder_state {
            PacketReorderStateV2::Stable => None,
            PacketReorderStateV2::Held { rank } => {
                reordered_packet_ids.push(packet.packet_id);
                Some(*rank)
            }
        };
        packets.push(FaultNetworkPacketState {
            packet: NetworkPacket {
                packet_id: packet.packet_id,
                from,
                to,
                connection_generation: packet.source_generation,
                payload: payload.clone(),
                deliver_at_ms: packet.delivery_deadline_ms,
            },
            queue_order_id: packet.queue_order_id,
            enqueued_at_ms: packet.enqueued_at_ms,
            source_generation: packet.source_generation,
            destination_generation: packet.destination_generation,
            stale,
            kind,
            payload_corrupted: payload_is_corrupted_for_kind(&payload, kind),
            disposition: thaw_packet_disposition(packet.disposition),
            reorder_rank,
        });
    }
    reordered_packet_ids.sort_unstable();
    FaultNetwork::from_state(FaultNetworkState {
        seed: replay_seed,
        rng: FaultNetworkRngState {
            algorithm_version: snapshot.fault_rng_state.algorithm_version,
            state_bits: snapshot.fault_rng_state.state_bits.clone(),
        },
        observed_now_ms: snapshot.virtual_time_ms,
        endpoints: [host_seat, guest_seat],
        generations,
        packets,
        reordered_packet_ids,
        next_packet_id: Some(snapshot.network.next_packet_id),
        next_queue_order_id: Some(snapshot.network.next_queue_order_id),
        disconnected,
        suspended,
        dropped_count: SafeU53::ZERO,
        duplicated_count: SafeU53::ZERO,
        corrupted_count: SafeU53::ZERO,
        disposed: snapshot.network.disposed,
    })
    .map_err(|error| pair_snapshot_invalid("network", error.to_string()))
}

fn freeze_packet_kind(kind: FaultNetworkPacketKind) -> RestorablePacketKindV2 {
    match kind {
        FaultNetworkPacketKind::AuthorityFrame => RestorablePacketKindV2::AuthorityFrame,
        FaultNetworkPacketKind::CommandProposal => RestorablePacketKindV2::CommandProposal,
        FaultNetworkPacketKind::ReplacementProposal => RestorablePacketKindV2::ReplacementProposal,
        FaultNetworkPacketKind::ControlReceipt => RestorablePacketKindV2::ControlReceipt,
    }
}

fn thaw_packet_kind(kind: RestorablePacketKindV2) -> FaultNetworkPacketKind {
    match kind {
        RestorablePacketKindV2::AuthorityFrame => FaultNetworkPacketKind::AuthorityFrame,
        RestorablePacketKindV2::CommandProposal => FaultNetworkPacketKind::CommandProposal,
        RestorablePacketKindV2::ReplacementProposal => FaultNetworkPacketKind::ReplacementProposal,
        RestorablePacketKindV2::ControlReceipt => FaultNetworkPacketKind::ControlReceipt,
    }
}

fn freeze_packet_disposition(disposition: FaultNetworkPacketDisposition) -> PacketDispositionV2 {
    match disposition {
        FaultNetworkPacketDisposition::Queued => PacketDispositionV2::Queued,
        FaultNetworkPacketDisposition::Delayed => PacketDispositionV2::Delayed,
        FaultNetworkPacketDisposition::Ready => PacketDispositionV2::Ready,
    }
}

fn thaw_packet_disposition(disposition: PacketDispositionV2) -> FaultNetworkPacketDisposition {
    match disposition {
        PacketDispositionV2::Queued => FaultNetworkPacketDisposition::Queued,
        PacketDispositionV2::Delayed => FaultNetworkPacketDisposition::Delayed,
        PacketDispositionV2::Ready => FaultNetworkPacketDisposition::Ready,
    }
}

fn is_link_connected(
    seat: SeatId,
    host_seat: SeatId,
    guest_seat: SeatId,
    host: &crate::snapshot::NetworkLinkSnapshotV2,
    guest: &crate::snapshot::NetworkLinkSnapshotV2,
) -> bool {
    if seat == host_seat {
        host.connected
    } else if seat == guest_seat {
        guest.connected
    } else {
        false
    }
}

fn payload_is_corrupted_for_kind(
    payload: &NetworkPayload,
    expected: FaultNetworkPacketKind,
) -> bool {
    let actual = match payload {
        NetworkPayload::Proposal(proposal) => Some(if proposal.fingerprint.starts_with("brp1-") {
            FaultNetworkPacketKind::ReplacementProposal
        } else {
            FaultNetworkPacketKind::CommandProposal
        }),
        NetworkPayload::Frame(raw) => raw_frame_value(raw).map(|value| {
            if value.get("t").and_then(Value::as_str) == Some("authorityReceipt") {
                FaultNetworkPacketKind::ControlReceipt
            } else {
                FaultNetworkPacketKind::AuthorityFrame
            }
        }),
    };
    actual != Some(expected)
}

fn raw_frame_value(raw: &RawFrame) -> Option<Value> {
    match raw {
        RawFrame::JsonText(text) => serde_json::from_str(text).ok(),
        RawFrame::JsonValue(value) => Some(value.clone()),
    }
}

fn pair_endpoint_for_seat(
    seat: SeatId,
    host_seat: SeatId,
    guest_seat: SeatId,
) -> Result<PairEndpoint, SnapshotError> {
    if seat == host_seat {
        Ok(PairEndpoint::Host)
    } else if seat == guest_seat {
        Ok(PairEndpoint::Guest)
    } else {
        Err(pair_snapshot_invalid(
            "pair.endpoint",
            "seat names neither pair endpoint",
        ))
    }
}

fn seat_for_pair_endpoint(endpoint: PairEndpoint, host_seat: SeatId, guest_seat: SeatId) -> SeatId {
    match endpoint {
        PairEndpoint::Host => host_seat,
        PairEndpoint::Guest => guest_seat,
    }
}

fn freeze_presenter(
    state: PresenterState,
    host_seat: SeatId,
    guest_seat: SeatId,
) -> Result<PresenterSnapshotV2, SnapshotError> {
    state
        .validate()
        .map_err(|error| pair_snapshot_invalid("presenter", error.to_string()))?;
    if state.mode != PresenterMode::FaultControlled
        || !state.pending.is_empty()
        || !state.outcomes.is_empty()
    {
        return Err(pair_snapshot_invalid(
            "presenter",
            "production M3 pair requires the fault-controlled battle presenter without legacy events",
        ));
    }
    let mut pending = state
        .battle_pending
        .into_iter()
        .map(|entry| {
            Ok(PairPresenterEventSnapshotV2 {
                endpoint: pair_endpoint_for_seat(entry.endpoint, host_seat, guest_seat)?,
                event: entry.event,
            })
        })
        .collect::<Result<Vec<_>, SnapshotError>>()?;
    pending.sort_by_key(|entry| {
        (
            pair_endpoint_rank(entry.endpoint),
            entry.event.event_id.clone(),
        )
    });
    let mut outcomes = state
        .battle_outcomes
        .into_iter()
        .map(|entry| {
            Ok(PairPresenterOutcomeSnapshotV2 {
                endpoint: pair_endpoint_for_seat(entry.endpoint, host_seat, guest_seat)?,
                outcome: PresentationOutcomeSnapshotV1 {
                    event_id: entry.event_id,
                    outcome: entry.outcome,
                },
            })
        })
        .collect::<Result<Vec<_>, SnapshotError>>()?;
    outcomes.sort_by_key(|entry| {
        (
            pair_endpoint_rank(entry.endpoint),
            entry.outcome.event_id.clone(),
        )
    });
    let mut tombstones = state
        .tombstones
        .into_iter()
        .map(|entry| {
            Ok(PairPresenterTombstoneSnapshotV2 {
                endpoint: pair_endpoint_for_seat(entry.endpoint, host_seat, guest_seat)?,
                event_id: entry.event_id,
            })
        })
        .collect::<Result<Vec<_>, SnapshotError>>()?;
    tombstones.sort_by_key(|entry| (pair_endpoint_rank(entry.endpoint), entry.event_id.clone()));
    let snapshot = PresenterSnapshotV2 {
        pending,
        outcomes,
        tombstones,
        disposed: state.disposed,
    };
    snapshot.validate()?;
    Ok(snapshot)
}

fn thaw_presenter(
    snapshot: &PresenterSnapshotV2,
    host_seat: SeatId,
    guest_seat: SeatId,
) -> Result<Box<dyn Presenter>, SnapshotError> {
    let mut battle_pending = snapshot
        .pending
        .iter()
        .map(|entry| PresenterBattlePendingState {
            endpoint: seat_for_pair_endpoint(entry.endpoint, host_seat, guest_seat),
            event: entry.event.clone(),
        })
        .collect::<Vec<_>>();
    battle_pending.sort_by_key(|entry| (entry.endpoint, entry.event.event_id.clone()));
    let mut battle_outcomes = snapshot
        .outcomes
        .iter()
        .map(|entry| PresenterBattleOutcomeState {
            endpoint: seat_for_pair_endpoint(entry.endpoint, host_seat, guest_seat),
            event_id: entry.outcome.event_id.clone(),
            outcome: entry.outcome.outcome.clone(),
        })
        .collect::<Vec<_>>();
    battle_outcomes.sort_by_key(|entry| (entry.endpoint, entry.event_id.clone()));
    let mut tombstones = snapshot
        .tombstones
        .iter()
        .map(|entry| PresenterTombstoneState {
            endpoint: seat_for_pair_endpoint(entry.endpoint, host_seat, guest_seat),
            event_id: entry.event_id.clone(),
        })
        .collect::<Vec<_>>();
    tombstones.sort_by_key(|entry| (entry.endpoint, entry.event_id.clone()));
    restore_presenter(PresenterState {
        mode: PresenterMode::FaultControlled,
        pending: Vec::new(),
        outcomes: Vec::new(),
        battle_pending,
        battle_outcomes,
        tombstones,
        disposed: snapshot.disposed,
    })
    .map_err(|error| pair_snapshot_invalid("presenter", error.to_string()))
}

fn freeze_storage(
    state: MemoryStorageState,
    host_seat: SeatId,
    guest_seat: SeatId,
) -> Result<StorageSnapshotV2, SnapshotError> {
    state
        .validate()
        .map_err(|error| pair_snapshot_invalid("storage", error.to_string()))?;
    let values = state
        .values
        .into_iter()
        .map(|entry| {
            Ok(StorageValueSnapshotV2 {
                key: entry.key,
                canonical_value: canonical_value_bytes(
                    &entry.value,
                    "storage.values.canonical_value",
                )?,
            })
        })
        .collect::<Result<Vec<_>, SnapshotError>>()?;
    let mut pending_requests = state
        .pending_requests
        .into_iter()
        .map(|entry| {
            let endpoint = pair_endpoint_for_seat(entry.endpoint, host_seat, guest_seat)?;
            let request = match entry.request.value {
                None => RestorableStorageRequestV2::Load {
                    request_id: entry.request.request_id,
                    key: entry.request.key,
                },
                Some(value) => RestorableStorageRequestV2::Persist {
                    request_id: entry.request.request_id,
                    key: entry.request.key,
                    value: canonical_value_bytes(&value, "storage.pending_requests.value")?,
                },
            };
            Ok(StorageRequestSnapshotV2 { endpoint, request })
        })
        .collect::<Result<Vec<_>, SnapshotError>>()?;
    pending_requests.sort_by_key(|entry| {
        (
            pair_endpoint_rank(entry.endpoint),
            entry.request.request_id(),
        )
    });
    let snapshot = StorageSnapshotV2 {
        next_request_id: state.next_request_id,
        values,
        pending_requests,
        one_shot_fault: state
            .one_shot_fault
            .map(|reason| StorageFaultSnapshotV2 { reason }),
        disposed: state.disposed,
    };
    snapshot.validate()?;
    Ok(snapshot)
}

fn thaw_storage(
    snapshot: &StorageSnapshotV2,
    host_seat: SeatId,
    guest_seat: SeatId,
) -> Result<MemoryStorage, SnapshotError> {
    let values = snapshot
        .values
        .iter()
        .map(|entry| {
            Ok(StorageValueState {
                key: entry.key.clone(),
                value: decode_canonical_value(
                    &entry.canonical_value,
                    "storage.values.canonical_value",
                )?,
            })
        })
        .collect::<Result<Vec<_>, SnapshotError>>()?;
    let mut pending_requests = snapshot
        .pending_requests
        .iter()
        .map(|entry| {
            let request = match &entry.request {
                RestorableStorageRequestV2::Load { request_id, key } => er_types::StorageRequest {
                    request_id: *request_id,
                    key: key.clone(),
                    value: None,
                },
                RestorableStorageRequestV2::Persist {
                    request_id,
                    key,
                    value,
                } => er_types::StorageRequest {
                    request_id: *request_id,
                    key: key.clone(),
                    value: Some(decode_canonical_value(
                        value,
                        "storage.pending_requests.value",
                    )?),
                },
            };
            Ok(StoragePendingRequestState {
                endpoint: seat_for_pair_endpoint(entry.endpoint, host_seat, guest_seat),
                request,
            })
        })
        .collect::<Result<Vec<_>, SnapshotError>>()?;
    pending_requests.sort_by_key(|entry| (entry.endpoint, entry.request.request_id));
    MemoryStorage::from_state(MemoryStorageState {
        next_request_id: snapshot.next_request_id,
        values,
        pending_requests,
        one_shot_fault: snapshot
            .one_shot_fault
            .as_ref()
            .map(|fault| fault.reason.clone()),
        disposed: snapshot.disposed,
    })
    .map_err(|error| pair_snapshot_invalid("storage", error.to_string()))
}

fn freeze_fault_operation(
    operation: &FaultOperation,
) -> Result<crate::snapshot::FaultOperationV2, SnapshotError> {
    Ok(match operation {
        FaultOperation::Deliver { packet_id } => crate::snapshot::FaultOperationV2::Deliver {
            packet_id: *packet_id,
        },
        FaultOperation::DeliverNext => crate::snapshot::FaultOperationV2::DeliverNext,
        FaultOperation::Drop { packet_id } => crate::snapshot::FaultOperationV2::Drop {
            packet_id: *packet_id,
        },
        FaultOperation::Duplicate { packet_id } => crate::snapshot::FaultOperationV2::Duplicate {
            packet_id: *packet_id,
        },
        FaultOperation::Delay {
            packet_id,
            additional_ms,
        } => crate::snapshot::FaultOperationV2::Delay {
            packet_id: *packet_id,
            additional_ms: *additional_ms,
        },
        FaultOperation::Reorder { packet_ids } => crate::snapshot::FaultOperationV2::Reorder {
            packet_ids: packet_ids.clone(),
        },
        FaultOperation::Corrupt {
            packet_id,
            corruption,
        } => crate::snapshot::FaultOperationV2::Corrupt {
            packet_id: *packet_id,
            corruption: match corruption {
                crate::FrameCorruption::Replace { value } => FrameCorruptionV2::Replace {
                    body: canonical_value_bytes(value, "fault_script.corruption.replace")?,
                },
                crate::FrameCorruption::DeleteField { json_pointer } => {
                    FrameCorruptionV2::DeleteField {
                        json_pointer: json_pointer.clone(),
                    }
                }
                crate::FrameCorruption::ReplaceField {
                    json_pointer,
                    value,
                } => FrameCorruptionV2::ReplaceField {
                    json_pointer: json_pointer.clone(),
                    canonical_value: canonical_value_bytes(
                        value,
                        "fault_script.corruption.replace_field",
                    )?,
                },
                crate::FrameCorruption::MalformedJson { text } => {
                    FrameCorruptionV2::MalformedJson {
                        body: CanonicalHexBytes::from_bytes(text.as_bytes()),
                    }
                }
            },
        },
    })
}

fn canonical_value_bytes<T: Serialize>(
    value: &T,
    path: &str,
) -> Result<CanonicalHexBytes, SnapshotError> {
    canonical_bytes(value)
        .map(|bytes| CanonicalHexBytes::from_bytes(&bytes))
        .map_err(|error| pair_snapshot_canonical(path, error.to_string()))
}

fn decode_canonical_value<T>(value: &CanonicalHexBytes, path: &str) -> Result<T, SnapshotError>
where
    T: DeserializeOwned + Serialize,
{
    let bytes = decode_hex(value, path)?;
    let decoded = serde_json::from_slice::<T>(&bytes)
        .map_err(|error| pair_snapshot_invalid(path, error.to_string()))?;
    let recanonical = canonical_bytes(&decoded)
        .map_err(|error| pair_snapshot_canonical(path, error.to_string()))?;
    if recanonical != bytes {
        return Err(pair_snapshot_invalid(
            path,
            "bytes are valid JSON but not the canonical encoding of the decoded value",
        ));
    }
    Ok(decoded)
}

fn decode_hex(value: &CanonicalHexBytes, path: &str) -> Result<Vec<u8>, SnapshotError> {
    let text = value.as_str().as_bytes();
    if !text.len().is_multiple_of(2) {
        return Err(pair_snapshot_invalid(path, "hex payload has odd length"));
    }
    text.chunks_exact(2)
        .map(|pair| {
            let high = decode_hex_digit(pair[0])?;
            let low = decode_hex_digit(pair[1])?;
            Ok((high << 4) | low)
        })
        .collect::<Result<Vec<_>, String>>()
        .map_err(|reason| pair_snapshot_invalid(path, reason))
}

fn decode_hex_digit(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err("hex payload contains a non-canonical digit".to_owned()),
    }
}

fn pair_endpoint_rank(endpoint: PairEndpoint) -> u8 {
    match endpoint {
        PairEndpoint::Host => 0,
        PairEndpoint::Guest => 1,
    }
}

fn is_printable_key(code: &PhysicalKey) -> bool {
    matches!(
        code,
        PhysicalKey::Space
            | PhysicalKey::KeyA
            | PhysicalKey::KeyB
            | PhysicalKey::KeyC
            | PhysicalKey::KeyD
            | PhysicalKey::KeyE
            | PhysicalKey::KeyF
            | PhysicalKey::KeyN
            | PhysicalKey::KeyR
            | PhysicalKey::KeyT
            | PhysicalKey::Unknown(_)
    )
}

fn suspension_commands(endpoint: SeatId, suspended: bool) -> Vec<SchedulerCommand> {
    [
        TimeClass::Connected,
        TimeClass::Recovery,
        TimeClass::Renderer,
        TimeClass::HumanInput,
    ]
    .into_iter()
    .map(|time_class| {
        if suspended {
            SchedulerCommand::PauseClass {
                endpoint,
                time_class,
                reason: "suspended".to_owned(),
            }
        } else {
            SchedulerCommand::ResumeClass {
                endpoint,
                time_class,
                reason: "suspended".to_owned(),
            }
        }
    })
    .collect()
}

fn parse_canonical_seed(seed: &str) -> Result<u64, String> {
    if seed.is_empty() {
        return Err("seed must be a canonical unsigned decimal string".to_owned());
    }
    if seed.len() > 1 && seed.starts_with('0') {
        return Err("seed must not contain redundant leading zeroes".to_owned());
    }
    if !seed.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("seed must be a canonical unsigned decimal string".to_owned());
    }
    let value = seed
        .parse::<u64>()
        .map_err(|_| "seed is outside the u64 range".to_owned())?;
    if value.to_string() != seed {
        return Err("seed must be a canonical unsigned decimal string".to_owned());
    }
    Ok(value)
}

fn kernel_error(error: impl std::fmt::Display) -> SimulatedPairError {
    SimulatedPairError::Kernel {
        reason: error.to_string(),
    }
}

fn clock_error(error: impl std::fmt::Display) -> SimulatedPairError {
    SimulatedPairError::Clock {
        reason: error.to_string(),
    }
}

fn network_error(error: impl std::fmt::Display) -> SimulatedPairError {
    SimulatedPairError::Network {
        reason: error.to_string(),
    }
}

fn adapter_error(error: impl std::fmt::Display) -> SimulatedPairError {
    SimulatedPairError::Adapter {
        reason: error.to_string(),
    }
}

fn m3_pair_event_budget() -> SafeU53 {
    match SafeU53::new(4_096) {
        Ok(value) => value,
        Err(_) => SafeU53::MAX,
    }
}

fn empty_fault_script() -> crate::snapshot::FaultScriptSnapshotV2 {
    crate::snapshot::FaultScriptSnapshotV2 {
        cursor: SafeU53::ZERO,
        operations: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_kernel::{
        AuthorityResolutionPlan, ControlMenuPlan, MenuProposalPlan, ProtocolKernelConfig,
        ProtocolRoleConfig,
    };
    use er_protocol::{
        AuthorityEntryDraft, AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy,
        PeerBinding, ProposalLeaseConfig, RecoveryTransactionConfig,
    };
    use er_types::{
        AuthorityEntryKind, AwaitSuccessorControl, CancelPolicy, ChoiceListMenu, CommandMenu,
        FrameContext, GameButton, InputMap, KeyBinding, Material, MembershipRevision,
        MenuGeneration, MenuOption, MenuOptionId, NextControl, OperationId, PresentationEvent,
        ProposalMessage, RunId, SessionId, UiState, UiViewKind, WaitingMenu,
    };
    use serde_json::json;

    type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

    const TEST_HOST_SEAT: u64 = 1;
    const TEST_GUEST_SEAT: u64 = 2;
    const TEST_OPERATION_ID: &str = "pair/rebind-operation";
    const TEST_CONTROL_ID: &str = "pair/rebind-control";
    const TEST_OPTION_ID: &str = "pair/rebind-option";
    const TEST_FINGERPRINT: &str = "pair-rebind-fingerprint";

    fn assert_send<T: Send>() {}

    #[test]
    fn simulated_pair_is_send() {
        assert_send::<SimulatedPair>();
    }

    fn safe(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("pair test value must fit SafeU53")
    }

    fn test_seat(value: u64) -> SeatId {
        SeatId::new(safe(value))
    }

    fn generation(value: u64) -> ConnectionGeneration {
        ConnectionGeneration::new(safe(value))
    }

    fn test_operation_id() -> TestResult<OperationId> {
        Ok(OperationId::new(TEST_OPERATION_ID)?)
    }

    fn assert_owner_graph_matches(
        pair: &SimulatedPair,
        expected: &PairRollbackState,
    ) -> TestResult {
        assert_eq!(pair.host_kernel.snapshot(), expected.host_kernel.snapshot());
        assert_eq!(
            pair.guest_kernel.snapshot(),
            expected.guest_kernel.snapshot()
        );
        assert_eq!(
            pair.host_keyboard.export_state(),
            expected.host_keyboard.export_state()
        );
        assert_eq!(
            pair.guest_keyboard.export_state(),
            expected.guest_keyboard.export_state()
        );
        assert_eq!(pair.sequence, expected.sequence);
        assert_eq!(pair.clock.export_state(), expected.clock);
        assert_eq!(pair.network.export_state(), expected.network);
        assert_eq!(pair.presenter.export_state()?, expected.presenter);
        assert_eq!(pair.storage.export_state(), expected.storage);
        assert_eq!(pair.shared_terminal, expected.shared_terminal);
        assert_eq!(pair.terminal_reason, expected.terminal_reason);
        assert_eq!(pair.fault_script, expected.fault_script);
        assert_eq!(pair.last_boundary_order, expected.last_boundary_order);
        assert_eq!(
            pair.trace_audit.effect_origins,
            expected.trace_audit.effect_origins
        );
        assert_eq!(
            pair.trace_audit.host_rng_audit,
            expected.trace_audit.host_rng_audit
        );
        assert_eq!(
            pair.trace_audit.host_internal_events,
            expected.trace_audit.host_internal_events
        );
        assert_eq!(
            pair.trace_audit.guest_rng_audit,
            expected.trace_audit.guest_rng_audit
        );
        assert_eq!(
            pair.trace_audit.guest_internal_events,
            expected.trace_audit.guest_internal_events
        );
        assert_eq!(pair.disposed, expected.disposed);
        Ok(())
    }

    fn config(seed: u64, event_budget: SafeU53) -> SimulatedPairConfig {
        SimulatedPairConfig {
            host_kernel: KernelConfig::default(),
            guest_kernel: KernelConfig::default(),
            host_seat: SeatId::new(SafeU53::new(1).unwrap_or(SafeU53::ZERO)),
            guest_seat: SeatId::new(SafeU53::new(2).unwrap_or(SafeU53::ZERO)),
            seed,
            presenter: PresenterMode::Instant,
            initial_storage: BTreeMap::new(),
            event_budget,
        }
    }

    fn test_input_map() -> InputMap {
        InputMap {
            keyboard: vec![
                KeyBinding {
                    key: PhysicalKey::ArrowDown,
                    button: GameButton::Down,
                },
                KeyBinding {
                    key: PhysicalKey::Enter,
                    button: GameButton::Submit,
                },
            ],
            gamepad: Vec::new(),
            initial_repeat_delay_ms: safe(250),
            repeat_interval_ms: safe(250),
        }
    }

    fn choice_options(count: u64) -> TestResult<Vec<MenuOption>> {
        (0..count)
            .map(|index| -> TestResult<MenuOption> {
                Ok(MenuOption {
                    id: MenuOptionId::new(format!("pair-choice-{index}"))?,
                    label_key: format!("pair.choice.{index}"),
                    enabled: true,
                    visible: true,
                })
            })
            .collect()
    }

    fn choice_ui(owner_seat: SeatId) -> TestResult<UiState> {
        Ok(UiState {
            generation: MenuGeneration::new(safe(1)),
            owner_seat: Some(owner_seat),
            actionable: true,
            stack: vec![MenuState::ChoiceList(ChoiceListMenu {
                cursor: SafeU53::ZERO,
                page: SafeU53::ZERO,
                wrap: true,
                options: choice_options(8)?,
                cancel: CancelPolicy::Disabled,
            })],
        })
    }

    fn repeat_pair_config(seed: u64) -> TestResult<SimulatedPairConfig> {
        let mut pair_config = config(seed, safe(4_096));
        pair_config.host_kernel = KernelConfig {
            input_map: test_input_map(),
            initial_ui: choice_ui(test_seat(TEST_HOST_SEAT))?,
            protocol: None,
        };
        Ok(pair_config)
    }

    fn protocol_context(sender_seat: u64, connection_generation: u64) -> TestResult<FrameContext> {
        Ok(FrameContext {
            session_id: SessionId::new("pair-rebind-session")?,
            run_id: RunId::new("pair-rebind-run")?,
            session_epoch: safe(1),
            seat_map_id: "pair-rebind-seat-map".to_owned(),
            membership_revision: MembershipRevision::new(safe(1)),
            sender_seat_id: test_seat(sender_seat),
            authority_seat_id: test_seat(TEST_HOST_SEAT),
            connection_generation: generation(connection_generation),
        })
    }

    fn protocol_options() -> TestResult<Vec<MenuOption>> {
        Ok(vec![MenuOption {
            id: MenuOptionId::new(TEST_OPTION_ID)?,
            label_key: "pair.rebind.accept".to_owned(),
            enabled: true,
            visible: true,
        }])
    }

    fn protocol_waiting_ui() -> UiState {
        UiState {
            generation: MenuGeneration::new(safe(1)),
            owner_seat: None,
            actionable: false,
            stack: vec![MenuState::Waiting(WaitingMenu { prompt_key: None })],
        }
    }

    fn protocol_replica_ui() -> TestResult<UiState> {
        Ok(UiState {
            generation: MenuGeneration::new(safe(1)),
            owner_seat: Some(test_seat(TEST_GUEST_SEAT)),
            actionable: true,
            stack: vec![MenuState::Command(CommandMenu {
                operation_id: test_operation_id()?,
                control_id: TEST_CONTROL_ID.to_owned(),
                cursor: SafeU53::ZERO,
                options: protocol_options()?,
                cancel: CancelPolicy::Disabled,
            })],
        })
    }

    fn proposal_lease_config() -> ProposalLeaseConfig {
        ProposalLeaseConfig {
            owner_prefix: "pair:proposal:".to_owned(),
            retry_initial_ms: safe(250),
            retry_maximum_ms: safe(5_000),
            absolute_ceiling_ms: safe(1_200_000),
        }
    }

    fn recovery_config() -> TestResult<RecoveryTransactionConfig> {
        Ok(RecoveryTransactionConfig {
            local_context: protocol_context(TEST_GUEST_SEAT, 0)?,
            request_timeout_ms: safe(300_000),
            control_timeout_ms: safe(30_000),
            pacing_ms: safe(16),
            timer_owner_id: "pair:recovery".to_owned(),
        })
    }

    fn authority_log_config() -> TestResult<AuthorityLogConfig> {
        Ok(AuthorityLogConfig {
            local_context: protocol_context(TEST_HOST_SEAT, 0)?,
            peer_bindings: vec![PeerBinding {
                seat_id: test_seat(TEST_GUEST_SEAT),
                connection_generation: generation(0),
            }],
            owner_id: "pair:authority".to_owned(),
            retain_capacity: safe(512),
            delivery_backoff: BackoffPolicy {
                initial_ms: safe(250),
                maximum_ms: safe(5_000),
                factor_numerator: safe(2),
                factor_denominator: safe(1),
            },
            delivery_time_class: TimeClass::Connected,
            max_delivery_attempts: None,
        })
    }

    fn authority_resolution() -> TestResult<AuthorityResolutionPlan> {
        Ok(AuthorityResolutionPlan {
            operation_id: test_operation_id()?,
            fingerprint: TEST_FINGERPRINT.to_owned(),
            draft: AuthorityEntryDraft {
                context: protocol_context(TEST_HOST_SEAT, 0)?,
                operation_id: test_operation_id()?,
                kind: AuthorityEntryKind::TurnCommit,
                material: Material {
                    digest: "pair-rebind-material".to_owned(),
                    payload: json!({"accepted": true}),
                },
                next_control: NextControl::AwaitSuccessor(AwaitSuccessorControl {
                    after_operation_id: test_operation_id()?,
                    epoch: safe(1),
                    wave: safe(1),
                    turn: safe(1),
                    allowed_kinds: vec![AuthorityEntryKind::TurnCommit],
                    allowed_interaction_addresses: None,
                    allowed_control_addresses: None,
                    allow_next_wave_start: false,
                    expected_operation_id: None,
                }),
                subsumes: Vec::new(),
            },
        })
    }

    fn protocol_menu_plan() -> TestResult<ControlMenuPlan> {
        Ok(ControlMenuPlan::Command {
            control_id: TEST_CONTROL_ID.to_owned(),
            owner_seat_id: test_seat(TEST_GUEST_SEAT),
            operation_id: test_operation_id()?,
            field_index: SafeU53::ZERO,
            options: protocol_options()?,
            proposals: vec![MenuProposalPlan {
                option_id: MenuOptionId::new(TEST_OPTION_ID)?,
                fingerprint: TEST_FINGERPRINT.to_owned(),
                payload: json!({"option": TEST_OPTION_ID}),
            }],
            cancel: CancelPolicy::Disabled,
        })
    }

    fn authority_kernel_config(resolve_proposals: bool) -> TestResult<KernelConfig> {
        Ok(KernelConfig {
            input_map: test_input_map(),
            initial_ui: protocol_waiting_ui(),
            protocol: Some(ProtocolKernelConfig {
                role: ProtocolRoleConfig::Authority {
                    log: authority_log_config()?,
                    proposal_capacity: safe(8),
                    resolutions: if resolve_proposals {
                        vec![authority_resolution()?]
                    } else {
                        Vec::new()
                    },
                },
                menu_plans: Vec::new(),
            }),
        })
    }

    fn replica_kernel_config() -> TestResult<KernelConfig> {
        Ok(KernelConfig {
            input_map: test_input_map(),
            initial_ui: protocol_replica_ui()?,
            protocol: Some(ProtocolKernelConfig {
                role: ProtocolRoleConfig::Replica {
                    replica: AuthorityReplicaConfig {
                        receipt_context: protocol_context(TEST_GUEST_SEAT, 0)?,
                        authority_seat_id: test_seat(TEST_HOST_SEAT),
                        authority_connection_generation: generation(0),
                    },
                    proposal_leases: proposal_lease_config(),
                    recovery: recovery_config()?,
                },
                menu_plans: vec![protocol_menu_plan()?],
            }),
        })
    }

    fn protocol_pair_config(seed: u64, resolve_proposals: bool) -> TestResult<SimulatedPairConfig> {
        Ok(SimulatedPairConfig {
            host_kernel: authority_kernel_config(resolve_proposals)?,
            guest_kernel: replica_kernel_config()?,
            host_seat: test_seat(TEST_HOST_SEAT),
            guest_seat: test_seat(TEST_GUEST_SEAT),
            seed,
            presenter: PresenterMode::Instant,
            initial_storage: BTreeMap::new(),
            event_budget: safe(4_096),
        })
    }

    fn retry_pair_config(seed: u64) -> TestResult<SimulatedPairConfig> {
        let mut pair_config = protocol_pair_config(seed, false)?;
        // Keep the authority's required remote-peer binding intact, but make
        // the replica's cached authority generation stale. The fault network
        // drops every proposal carrying that generation before authority
        // admission, isolating lease retries from exact-resolution handling.
        let Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Replica { replica, .. },
            ..
        }) = pair_config.guest_kernel.protocol.as_mut()
        else {
            return Err(std::io::Error::other("retry fixture must use a replica guest").into());
        };
        replica.authority_connection_generation = generation(1);
        Ok(pair_config)
    }

    fn sent_proposals(step: &PairStep) -> Vec<ProposalMessage> {
        step.generated_effects
            .iter()
            .filter_map(|effect| match effect {
                KernelEffect::SendProposal { proposal } => Some(proposal.clone()),
                _ => None,
            })
            .collect()
    }

    fn raw_press_proposal(pair: &mut SimulatedPair) -> TestResult<ProposalMessage> {
        let steps = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
        Ok(steps
            .iter()
            .flat_map(sent_proposals)
            .next()
            .expect("raw submit must emit one proposal"))
    }

    fn proposal_packet_id(
        pair: &SimulatedPair,
        operation_id: &OperationId,
        expected_generation: ConnectionGeneration,
    ) -> Option<SafeU53> {
        pair.network
            .queued_packets()
            .into_iter()
            .find_map(|packet| match &packet.payload {
                NetworkPayload::Proposal(proposal)
                    if proposal.operation_id.as_str() == operation_id.as_str()
                        && proposal.connection_generation == expected_generation =>
                {
                    Some(packet.packet_id)
                }
                _ => None,
            })
    }

    fn frame_packet_id(
        pair: &SimulatedPair,
        from: SeatId,
        expected_generation: ConnectionGeneration,
    ) -> Option<SafeU53> {
        pair.network
            .queued_packets()
            .into_iter()
            .find_map(|packet| {
                (packet.from == from
                    && packet.connection_generation == expected_generation
                    && matches!(&packet.payload, NetworkPayload::Frame(_)))
                .then_some(packet.packet_id)
            })
    }

    fn has_frame_from(
        step: &PairStep,
        from: SeatId,
        expected_generation: ConnectionGeneration,
    ) -> bool {
        frame_count_from(step, from, expected_generation) != 0
    }

    fn frame_count_from(
        step: &PairStep,
        from: SeatId,
        expected_generation: ConnectionGeneration,
    ) -> usize {
        step.generated_effects
            .iter()
            .filter_map(|effect| match effect {
                KernelEffect::SendFrame {
                    from: effect_from,
                    frame,
                } if *effect_from == from
                    && frame.context.connection_generation == expected_generation =>
                {
                    Some(())
                }
                _ => None,
            })
            .count()
    }

    fn connected_timer_state(
        pair: &SimulatedPair,
    ) -> BTreeMap<(SeatId, er_types::TimerId), (SafeU53, bool)> {
        pair.clock
            .pending_timers()
            .into_iter()
            .filter(|timer| timer.timer.time_class == TimeClass::Connected)
            .map(|timer| {
                (
                    (timer.timer.endpoint, timer.timer.timer_id),
                    (timer.remaining_active_ms, timer.paused),
                )
            })
            .collect()
    }

    fn delay_all_packets(pair: &mut SimulatedPair, additional_ms: u64) -> TestResult {
        let packet_ids = pair.snapshot()?.network.queued_packet_ids;
        for packet_id in packet_ids {
            pair.apply(PairOperation::Fault {
                operation: FaultOperation::Delay {
                    packet_id,
                    additional_ms: safe(additional_ms),
                },
            })?;
        }
        Ok(())
    }

    fn assert_zero_pair_resources(pair: &SimulatedPair, snapshot: &PairSnapshot) {
        assert_eq!(
            snapshot.host.live_resources,
            LiveResourceSnapshot::default()
        );
        assert_eq!(
            snapshot.guest.live_resources,
            LiveResourceSnapshot::default()
        );
        assert!(pair.clock.pending_timers().is_empty());
        assert!(snapshot.clock_timers.is_empty());
        assert!(snapshot.network.queued_packet_ids.is_empty());
        assert!(snapshot.network.disconnected_endpoints.is_empty());
        assert!(snapshot.network.suspended_endpoints.is_empty());
        assert!(snapshot.network.disposed);
        assert!(snapshot.presenter.pending_event_ids.is_empty());
        assert!(snapshot.presenter.settled_event_ids.is_empty());
        assert!(snapshot.presenter.disposed);
        for endpoint in [&snapshot.host, &snapshot.guest] {
            assert!(endpoint.presenter.pending_event_ids.is_empty());
            assert!(endpoint.presenter.settled_event_ids.is_empty());
            assert!(endpoint.presenter.disposed);
        }
        assert!(snapshot.storage.keys.is_empty());
        assert!(snapshot.storage.pending_request_ids.is_empty());
        assert!(snapshot.storage.disposed);
    }

    fn assert_absorbed_state(actual: &PairSnapshot, expected: &PairSnapshot) {
        assert_eq!(actual.seed, expected.seed);
        assert_eq!(actual.virtual_time_ms, expected.virtual_time_ms);
        assert_eq!(actual.host, expected.host);
        assert_eq!(actual.guest, expected.guest);
        assert_eq!(actual.clock_timers, expected.clock_timers);
        assert_eq!(actual.network, expected.network);
        assert_eq!(actual.presenter, expected.presenter);
        assert_eq!(actual.storage, expected.storage);
        assert_eq!(actual.terminal_reason, expected.terminal_reason);
    }

    fn queue_probe_packet_at(pair: &mut SimulatedPair, target_ms: u64) -> TestResult<SafeU53> {
        let before = pair.snapshot()?.network.queued_packet_ids;
        let proposal = ProposalMessage {
            operation_id: OperationId::new(format!("pair/probe/{target_ms}"))?,
            fingerprint: format!("pair-probe-{target_ms}"),
            from: test_seat(TEST_GUEST_SEAT),
            to: test_seat(TEST_HOST_SEAT),
            connection_generation: generation(0),
            payload: json!({"targetMs": target_ms}),
        };
        let mut work = VecDeque::new();

        // Model a frozen kernel effect at the pair boundary; this is adapter
        // setup, not a semantic player-choice shortcut.
        pair.consume_effect(KernelEffect::SendProposal { proposal }, &mut work)?;
        assert!(work.is_empty());

        let packet = pair
            .network
            .queued_packets()
            .into_iter()
            .find(|packet| !before.contains(&packet.packet_id))
            .expect("effect consumption must enqueue one probe packet");
        let additional_ms = target_ms
            .checked_sub(packet.deliver_at_ms.get())
            .expect("probe target must follow the deterministic base delay");
        pair.apply(PairOperation::Fault {
            operation: FaultOperation::Delay {
                packet_id: packet.packet_id,
                additional_ms: safe(additional_ms),
            },
        })?;
        Ok(packet.packet_id)
    }

    #[test]
    fn pair_owns_isolated_keyboard_driver_seat_focus_and_press_state() -> TestResult {
        let mut pair = SimulatedPair::new(config(0xd371_ac4e, safe(64)))?;
        assert_eq!(pair.host_keyboard.seat(), test_seat(TEST_HOST_SEAT));
        assert_eq!(pair.guest_keyboard.seat(), test_seat(TEST_GUEST_SEAT));
        assert_eq!(pair.host_keyboard.input_focus(), InputFocus::Game);
        assert_eq!(pair.guest_keyboard.input_focus(), InputFocus::Game);

        let focused = pair.focus(PairEndpoint::Host, InputFocus::TextEntry)?;
        assert!(matches!(
            focused.operation,
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::FocusChanged(InputFocus::TextEntry),
            }
        ));
        assert_eq!(pair.host_keyboard.input_focus(), InputFocus::TextEntry);
        assert_eq!(pair.guest_keyboard.input_focus(), InputFocus::Game);

        let host_key = pair.key_down(PairEndpoint::Host, PhysicalKey::KeyA, true)?;
        assert!(matches!(
            host_key.operation,
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::KeyDown {
                    code: PhysicalKey::KeyA,
                    printable: true,
                    browser_repeat: false,
                    focus: InputFocus::TextEntry,
                },
            }
        ));

        let guest_press = pair.press(PairEndpoint::Guest, PhysicalKey::KeyA)?;
        assert!(matches!(
            &guest_press[0].operation,
            PairOperation::RawInput {
                endpoint: PairEndpoint::Guest,
                event: RawInputEvent::KeyDown {
                    code: PhysicalKey::KeyA,
                    printable: true,
                    browser_repeat: false,
                    focus: InputFocus::Game,
                },
            }
        ));
        assert!(matches!(
            &guest_press[1].operation,
            PairOperation::RawInput {
                endpoint: PairEndpoint::Guest,
                event: RawInputEvent::KeyUp {
                    code: PhysicalKey::KeyA,
                },
            }
        ));
        let blurred = pair.blur(PairEndpoint::Guest)?;
        assert!(matches!(
            blurred.operation,
            PairOperation::RawInput {
                endpoint: PairEndpoint::Guest,
                event: RawInputEvent::WindowBlurred,
            }
        ));
        assert_eq!(pair.host_keyboard.input_focus(), InputFocus::TextEntry);
        assert_eq!(pair.guest_keyboard.input_focus(), InputFocus::Game);
        Ok(())
    }

    #[test]
    fn hold_for_large_advance_fires_every_exact_repeat_boundary() -> TestResult {
        let mut pair = SimulatedPair::new(repeat_pair_config(0x250)?)?;
        let steps = pair.hold_for(PairEndpoint::Host, PhysicalKey::ArrowDown, safe(1_000))?;
        assert_eq!(steps.len(), 3);
        assert!(matches!(
            &steps[0].operation,
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::KeyDown {
                    code: PhysicalKey::ArrowDown,
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game,
                },
            }
        ));
        assert!(matches!(
            &steps[2].operation,
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::KeyUp {
                    code: PhysicalKey::ArrowDown,
                },
            }
        ));

        let advance = &steps[1];
        assert!(matches!(
            &advance.operation,
            PairOperation::AdvanceTime { delta_ms } if *delta_ms == safe(1_000)
        ));
        let repeat_changes = advance
            .generated_effects
            .iter()
            .filter(|effect| {
                matches!(
                    effect,
                    KernelEffect::UiChanged { endpoint, .. }
                        if *endpoint == test_seat(TEST_HOST_SEAT)
                )
            })
            .count();
        let repeat_reschedules = advance
            .generated_effects
            .iter()
            .filter(|effect| {
                matches!(
                    effect,
                    KernelEffect::ScheduleTimer {
                        endpoint,
                        delay_ms,
                        time_class: TimeClass::HumanInput,
                        ..
                    } if *endpoint == test_seat(TEST_HOST_SEAT) && *delay_ms == safe(250)
                )
            })
            .count();
        assert_eq!(repeat_changes, 4, "250/500/750/1000 ms must all fire");
        assert_eq!(repeat_reschedules, 4);
        assert_eq!(steps[2].snapshot.host.ui.cursor, Some(safe(5)));
        assert!(steps[2].snapshot.host.live_resources.timers.is_empty());
        Ok(())
    }

    #[test]
    fn one_large_advance_matches_four_incremental_exponential_retries() -> TestResult {
        let seed = 0x05ee_d250;
        let mut large = SimulatedPair::new(retry_pair_config(seed)?)?;
        let mut incremental = SimulatedPair::new(retry_pair_config(seed)?)?;
        let large_original = raw_press_proposal(&mut large)?;
        let incremental_original = raw_press_proposal(&mut incremental)?;
        assert_eq!(large_original, incremental_original);

        let large_step = large.advance_time(safe(3_750))?;
        let large_proposals = sent_proposals(&large_step);
        let large_delays = large_step
            .generated_effects
            .iter()
            .filter_map(|effect| match effect {
                KernelEffect::ScheduleTimer {
                    endpoint,
                    delay_ms,
                    time_class: TimeClass::Connected,
                    ..
                } if *endpoint == test_seat(TEST_GUEST_SEAT) => Some(*delay_ms),
                _ => None,
            })
            .collect::<Vec<_>>();

        let mut incremental_proposals = Vec::new();
        let mut incremental_delays = Vec::new();
        for delta_ms in [250, 500, 1_000, 2_000] {
            let step = incremental.advance_time(safe(delta_ms))?;
            incremental_proposals.extend(sent_proposals(&step));
            incremental_delays.extend(step.generated_effects.iter().filter_map(
                |effect| match effect {
                    KernelEffect::ScheduleTimer {
                        endpoint,
                        delay_ms,
                        time_class: TimeClass::Connected,
                        ..
                    } if *endpoint == test_seat(TEST_GUEST_SEAT) => Some(*delay_ms),
                    _ => None,
                },
            ));
        }

        assert_eq!(large_proposals.len(), 4);
        assert_eq!(large_proposals, incremental_proposals);
        assert_eq!(
            large_delays,
            vec![safe(500), safe(1_000), safe(2_000), safe(4_000)]
        );
        assert_eq!(large_delays, incremental_delays);
        assert_eq!(large.clock.now(), incremental.clock.now());
        assert_eq!(
            large.clock.pending_timers(),
            incremental.clock.pending_timers()
        );
        assert_eq!(
            large.network.queued_packets(),
            incremental.network.queued_packets()
        );
        Ok(())
    }

    #[test]
    fn environment_orders_earlier_packets_before_timers_and_timers_first_when_equal() -> TestResult
    {
        let mut earlier = SimulatedPair::new(repeat_pair_config(0x200)?)?;
        let earlier_packet_id = queue_probe_packet_at(&mut earlier, 200)?;
        earlier.key_down(PairEndpoint::Host, PhysicalKey::ArrowDown, false)?;
        earlier.advance_time(safe(250))?;
        let order = &earlier.last_boundary_order;
        assert_eq!(order.len(), 2);
        assert!(matches!(
            &order[0],
            BoundaryOrderEvent {
                at_ms,
                item: BoundaryOrderItem::Packet { packet_id },
            } if *at_ms == safe(200) && *packet_id == earlier_packet_id
        ));
        assert!(matches!(
            &order[1],
            BoundaryOrderEvent {
                at_ms,
                item: BoundaryOrderItem::Timer { endpoint, .. },
            } if *at_ms == safe(250) && *endpoint == test_seat(TEST_HOST_SEAT)
        ));

        let mut equal = SimulatedPair::new(repeat_pair_config(0x250)?)?;
        let equal_packet_id = queue_probe_packet_at(&mut equal, 250)?;
        equal.key_down(PairEndpoint::Host, PhysicalKey::ArrowDown, false)?;
        equal.advance_time(safe(250))?;
        let order = &equal.last_boundary_order;
        assert_eq!(order.len(), 2);
        assert!(matches!(
            &order[0],
            BoundaryOrderEvent {
                at_ms,
                item: BoundaryOrderItem::Timer { endpoint, .. },
            } if *at_ms == safe(250) && *endpoint == test_seat(TEST_HOST_SEAT)
        ));
        assert!(matches!(
            &order[1],
            BoundaryOrderEvent {
                at_ms,
                item: BoundaryOrderItem::Packet { packet_id },
            } if *at_ms == safe(250) && *packet_id == equal_packet_id
        ));
        Ok(())
    }

    #[test]
    fn hot_reconnect_queues_exact_four_generation_inputs_per_kernel() -> TestResult {
        let mut pair = SimulatedPair::new(config(0xcafe_0000, safe(64)))?;
        let mut work = VecDeque::new();

        pair.reconnect(PairEndpoint::Guest, &mut work)?;

        let batch = work
            .pop_front()
            .ok_or_else(|| SimulatedPairError::Adapter {
                reason: "reconnect must queue a transport batch".to_owned(),
            })?;
        let inputs = match batch {
            PairWork::InputBatch(inputs) => inputs,
            _ => {
                return Err(Box::new(SimulatedPairError::Adapter {
                    reason: "reconnect must queue transport inputs as one batch".to_owned(),
                }));
            }
        };
        assert!(work.is_empty());
        assert_eq!(inputs.len(), 8);

        let mut actual = Vec::with_capacity(inputs.len());
        for (kernel_endpoint, input) in &inputs {
            let (observed_endpoint, state, input_generation) = match input {
                KernelInput::TransportChanged {
                    endpoint,
                    state,
                    generation,
                } => (*endpoint, *state, *generation),
                _ => {
                    return Err(Box::new(SimulatedPairError::Adapter {
                        reason: "reconnect batch must contain only transport inputs".to_owned(),
                    }));
                }
            };
            actual.push((*kernel_endpoint, observed_endpoint, state, input_generation));
        }

        let mut expected = Vec::with_capacity(8);
        for kernel_endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            let local_seat = pair.seat(kernel_endpoint);
            let remote_seat = pair.peer_seat(local_seat)?;
            expected.extend([
                (
                    kernel_endpoint,
                    local_seat,
                    TransportState::Disconnected,
                    generation(1),
                ),
                (
                    kernel_endpoint,
                    remote_seat,
                    TransportState::Disconnected,
                    generation(1),
                ),
                (
                    kernel_endpoint,
                    remote_seat,
                    TransportState::Connected,
                    generation(1),
                ),
                (
                    kernel_endpoint,
                    local_seat,
                    TransportState::Connected,
                    generation(1),
                ),
            ]);
        }
        assert_eq!(actual, expected);
        Ok(())
    }

    #[test]
    fn either_endpoint_reconnect_rebinds_both_protocol_contexts_and_drops_old_packets() -> TestResult
    {
        for reconnected_endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            let mut pair = SimulatedPair::new(protocol_pair_config(0xcafe_0001, true)?)?;
            let original = raw_press_proposal(&mut pair)?;
            let old_packet_id = proposal_packet_id(&pair, &original.operation_id, generation(0))
                .expect("initial proposal packet must be queued");
            pair.apply(PairOperation::Fault {
                operation: FaultOperation::Delay {
                    packet_id: old_packet_id,
                    additional_ms: safe(2_000_000),
                },
            })?;

            pair.apply(PairOperation::Disconnect {
                endpoint: reconnected_endpoint,
            })?;
            let reconnect = pair.apply(PairOperation::Reconnect {
                endpoint: reconnected_endpoint,
            })?;
            let rebound = sent_proposals(&reconnect)
                .into_iter()
                .find(|proposal| proposal.operation_id == original.operation_id)
                .expect("rebind must immediately resend the retained proposal");
            assert_eq!(rebound.operation_id, original.operation_id);
            assert_eq!(rebound.fingerprint, original.fingerprint);
            assert_eq!(rebound.payload, original.payload);
            assert_eq!(rebound.from, original.from);
            assert_eq!(rebound.to, original.to);
            assert_eq!(rebound.connection_generation, generation(1));
            assert_eq!(
                pair.network
                    .connection_generation(test_seat(TEST_HOST_SEAT)),
                generation(1)
            );
            assert_eq!(
                pair.network
                    .connection_generation(test_seat(TEST_GUEST_SEAT)),
                generation(1)
            );

            let dropped_before = pair.snapshot()?.network.dropped_count;
            let stale = pair.apply(PairOperation::Fault {
                operation: FaultOperation::Deliver {
                    packet_id: old_packet_id,
                },
            })?;
            assert!(stale.generated_effects.is_empty());
            assert!(stale.snapshot.network.dropped_count > dropped_before);

            let recovery_request_packet_id =
                frame_packet_id(&pair, test_seat(TEST_GUEST_SEAT), generation(1))
                    .expect("replica recovery request must use the rebound generation");
            let recovery_bundle = pair.apply(PairOperation::Fault {
                operation: FaultOperation::Deliver {
                    packet_id: recovery_request_packet_id,
                },
            })?;
            assert!(has_frame_from(
                &recovery_bundle,
                test_seat(TEST_HOST_SEAT),
                generation(1)
            ));

            let recovery_bundle_packet_id =
                frame_packet_id(&pair, test_seat(TEST_HOST_SEAT), generation(1))
                    .expect("authority recovery bundle must use the rebound generation");
            let recovery_applied = pair.apply(PairOperation::Fault {
                operation: FaultOperation::Deliver {
                    packet_id: recovery_bundle_packet_id,
                },
            })?;
            assert!(has_frame_from(
                &recovery_applied,
                test_seat(TEST_GUEST_SEAT),
                generation(1)
            ));

            let recovery_applied_packet_id =
                frame_packet_id(&pair, test_seat(TEST_GUEST_SEAT), generation(1))
                    .expect("recovery proof must use the rebound generation");
            pair.apply(PairOperation::Fault {
                operation: FaultOperation::Deliver {
                    packet_id: recovery_applied_packet_id,
                },
            })?;

            let fresh_packet_id = proposal_packet_id(&pair, &original.operation_id, generation(1))
                .expect("rebound proposal packet must be queued");
            let authority = pair.apply(PairOperation::Fault {
                operation: FaultOperation::Deliver {
                    packet_id: fresh_packet_id,
                },
            })?;
            assert!(has_frame_from(
                &authority,
                test_seat(TEST_HOST_SEAT),
                generation(1)
            ));
        }
        Ok(())
    }

    #[test]
    fn disconnected_link_pauses_both_connected_timer_owners_and_preserves_rebind_identity()
    -> TestResult {
        let mut pair = SimulatedPair::new(protocol_pair_config(0xcafe_0250, true)?)?;
        let original = raw_press_proposal(&mut pair)?;
        let proposal_packet_id = proposal_packet_id(&pair, &original.operation_id, generation(0))
            .expect("initial proposal packet must be queued");
        let committed = pair.apply(PairOperation::Fault {
            operation: FaultOperation::Deliver {
                packet_id: proposal_packet_id,
            },
        })?;
        assert!(has_frame_from(
            &committed,
            test_seat(TEST_HOST_SEAT),
            generation(0)
        ));

        let before_disconnect = connected_timer_state(&pair);
        assert_eq!(before_disconnect.len(), 2);
        assert!(before_disconnect.iter().any(|((endpoint, _), state)| {
            *endpoint == test_seat(TEST_HOST_SEAT) && *state == (safe(250), false)
        }));
        assert!(before_disconnect.iter().any(|((endpoint, _), state)| {
            *endpoint == test_seat(TEST_GUEST_SEAT) && *state == (safe(250), false)
        }));

        pair.apply(PairOperation::Disconnect {
            endpoint: PairEndpoint::Guest,
        })?;
        let paused = connected_timer_state(&pair);
        assert_eq!(
            paused
                .iter()
                .map(|(key, (remaining, _))| (*key, *remaining))
                .collect::<BTreeMap<_, _>>(),
            before_disconnect
                .iter()
                .map(|(key, (remaining, _))| (*key, *remaining))
                .collect::<BTreeMap<_, _>>()
        );
        assert!(paused.values().all(|(_, is_paused)| *is_paused));

        let disconnected_advance = pair.advance_time(safe(10_000))?;
        assert!(sent_proposals(&disconnected_advance).is_empty());
        assert!(!has_frame_from(
            &disconnected_advance,
            test_seat(TEST_HOST_SEAT),
            generation(0)
        ));
        assert_eq!(connected_timer_state(&pair), paused);

        let reconnect = pair.apply(PairOperation::Reconnect {
            endpoint: PairEndpoint::Guest,
        })?;
        let rebound_proposals = sent_proposals(&reconnect)
            .into_iter()
            .filter(|proposal| proposal.operation_id == original.operation_id)
            .collect::<Vec<_>>();
        assert_eq!(rebound_proposals.len(), 1);
        let rebound = &rebound_proposals[0];
        assert_eq!(rebound.operation_id, original.operation_id);
        assert_eq!(rebound.fingerprint, original.fingerprint);
        assert_eq!(rebound.payload, original.payload);
        assert_eq!(rebound.connection_generation, generation(1));
        assert_eq!(
            frame_count_from(&reconnect, test_seat(TEST_HOST_SEAT), generation(1)),
            1,
            "authority rebind must redeliver each retained entry exactly once"
        );
        assert_eq!(
            frame_count_from(&reconnect, test_seat(TEST_GUEST_SEAT), generation(1)),
            1,
            "replica reconnect must start exactly one recovery request"
        );
        assert!(
            !reconnect
                .snapshot
                .guest
                .live_resources
                .recovery_transactions
                .is_empty()
        );
        assert!(has_frame_from(
            &reconnect,
            test_seat(TEST_HOST_SEAT),
            generation(1)
        ));

        let resumed = connected_timer_state(&pair);
        assert_eq!(
            resumed
                .iter()
                .map(|(key, (remaining, _))| (*key, *remaining))
                .collect::<BTreeMap<_, _>>(),
            before_disconnect
                .iter()
                .map(|(key, (remaining, _))| (*key, *remaining))
                .collect::<BTreeMap<_, _>>()
        );
        assert!(resumed.values().all(|(_, is_paused)| !*is_paused));

        delay_all_packets(&mut pair, 2_000_000)?;
        let before_retry = pair.advance_time(safe(249))?;
        assert!(sent_proposals(&before_retry).is_empty());
        assert!(!has_frame_from(
            &before_retry,
            test_seat(TEST_HOST_SEAT),
            generation(1)
        ));
        assert!(
            connected_timer_state(&pair)
                .values()
                .all(|(remaining, is_paused)| *remaining == safe(1) && !*is_paused)
        );

        let retry = pair.advance_time(safe(1))?;
        let retried_proposal = sent_proposals(&retry)
            .into_iter()
            .find(|proposal| proposal.operation_id == original.operation_id)
            .expect("preserved proposal retry must resume at its remaining deadline");
        assert_eq!(retried_proposal.operation_id, original.operation_id);
        assert_eq!(retried_proposal.fingerprint, original.fingerprint);
        assert_eq!(retried_proposal.payload, original.payload);
        assert_eq!(retried_proposal.connection_generation, generation(1));
        assert!(has_frame_from(
            &retry,
            test_seat(TEST_HOST_SEAT),
            generation(1)
        ));
        Ok(())
    }

    #[test]
    fn pair_step_sequence_matches_post_operation_snapshot() -> TestResult {
        let mut pair = SimulatedPair::new(config(7, SafeU53::new(8)?))?;
        assert_eq!(pair.snapshot()?.sequence, SafeU53::ZERO);

        let first = pair.key_down(PairEndpoint::Host, PhysicalKey::ArrowUp, false)?;
        assert_eq!(first.sequence, first.snapshot.sequence);
        assert_eq!(first.sequence, SafeU53::new(1)?);

        let second = pair.key_up(PairEndpoint::Host, PhysicalKey::ArrowUp)?;
        assert_eq!(second.sequence, second.snapshot.sequence);
        assert_eq!(second.sequence, SafeU53::new(2)?);
        Ok(())
    }

    #[test]
    fn apply_many_atomic_matches_sequential_steps_and_order() -> TestResult {
        let operations = vec![
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::KeyDown {
                    code: PhysicalKey::ArrowUp,
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game,
                },
            },
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::KeyUp {
                    code: PhysicalKey::ArrowUp,
                },
            },
            PairOperation::AdvanceTime { delta_ms: safe(1) },
        ];
        let mut sequential = SimulatedPair::new(config(0x51, safe(64)))?;
        let expected_steps = operations
            .iter()
            .cloned()
            .map(|operation| sequential.apply(operation))
            .collect::<Result<Vec<_>, _>>()?;
        let expected_snapshot = sequential.snapshot()?;
        let expected_host_driver = sequential.host_keyboard.export_state();
        let expected_guest_driver = sequential.guest_keyboard.export_state();

        let mut batched = SimulatedPair::new(config(0x51, safe(64)))?;
        let actual_steps = batched.apply_many_atomic(operations.clone())?;

        assert_eq!(actual_steps, expected_steps);
        assert_eq!(batched.snapshot()?, expected_snapshot);
        assert_eq!(batched.host_keyboard.export_state(), expected_host_driver);
        assert_eq!(batched.guest_keyboard.export_state(), expected_guest_driver);
        assert_eq!(
            actual_steps
                .iter()
                .map(|step| &step.operation)
                .collect::<Vec<_>>(),
            operations.iter().collect::<Vec<_>>()
        );
        Ok(())
    }

    #[test]
    fn apply_many_atomic_restores_everything_when_a_later_operation_fails() -> TestResult {
        let mut pair = SimulatedPair::new(config(0x52, safe(64)))?;
        let before_snapshot = pair.snapshot()?;
        let before_host_driver = pair.host_keyboard.export_state();
        let before_guest_driver = pair.guest_keyboard.export_state();

        let result = pair.apply_many_atomic([
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::KeyDown {
                    code: PhysicalKey::ArrowUp,
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game,
                },
            },
            PairOperation::StorageResult {
                endpoint: PairEndpoint::Host,
                request_id: safe(999),
                result: StorageResult::Persisted,
            },
        ]);

        assert!(matches!(result, Err(SimulatedPairError::Adapter { .. })));
        assert_eq!(pair.snapshot()?, before_snapshot);
        assert_eq!(pair.host_keyboard.export_state(), before_host_driver);
        assert_eq!(pair.guest_keyboard.export_state(), before_guest_driver);
        Ok(())
    }

    #[test]
    fn try_fork_apply_many_atomic_matches_fork_then_apply_and_preserves_source() -> TestResult {
        let operations = vec![
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::KeyDown {
                    code: PhysicalKey::ArrowUp,
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game,
                },
            },
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::KeyUp {
                    code: PhysicalKey::ArrowUp,
                },
            },
            PairOperation::AdvanceTime { delta_ms: safe(1) },
        ];
        let source = SimulatedPair::new(config(0x58, safe(64)))?;
        let before = source.capture_rollback_state()?;

        let mut expected_fork = source.try_fork()?;
        let expected_steps = expected_fork.apply_many_atomic(operations.clone())?;
        let expected_fork_state = expected_fork.capture_rollback_state()?;

        let (actual_fork, actual_steps) = source.try_fork_apply_many_atomic(operations)?;

        assert_eq!(actual_steps, expected_steps);
        assert_owner_graph_matches(&actual_fork, &expected_fork_state)?;
        assert_owner_graph_matches(&source, &before)?;
        Ok(())
    }

    #[test]
    fn try_fork_apply_many_atomic_drops_failed_fork_without_changing_source() -> TestResult {
        let mut pair_config = config(0x59, safe(64));
        pair_config
            .initial_storage
            .insert("preexisting".to_owned(), json!({"ready": true}));
        let mut source = SimulatedPair::new(pair_config)?;
        source.apply(PairOperation::RawInput {
            endpoint: PairEndpoint::Host,
            event: RawInputEvent::KeyDown {
                code: PhysicalKey::ArrowUp,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
        })?;
        let before = source.capture_rollback_state()?;

        let result = source.try_fork_apply_many_atomic([
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::KeyDown {
                    code: PhysicalKey::ArrowDown,
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game,
                },
            },
            PairOperation::StorageResult {
                endpoint: PairEndpoint::Host,
                request_id: safe(999),
                result: StorageResult::Persisted,
            },
        ]);

        assert!(matches!(result, Err(SimulatedPairError::Adapter { .. })));
        assert_owner_graph_matches(&source, &before)?;
        Ok(())
    }

    #[test]
    fn try_fork_apply_many_atomic_empty_batch_returns_pristine_fork() -> TestResult {
        let source = SimulatedPair::new(config(0x5a, safe(64)))?;
        let before = source.capture_rollback_state()?;

        let (fork, steps) = source.try_fork_apply_many_atomic(Vec::<PairOperation>::new())?;

        assert!(steps.is_empty());
        assert_owner_graph_matches(&source, &before)?;
        assert_owner_graph_matches(&fork, &before)?;
        Ok(())
    }

    #[test]
    fn try_fork_apply_many_atomic_rejects_sequence_exhaustion_after_earlier_operation() -> TestResult
    {
        let mut source = SimulatedPair::new(config(0x5b, safe(64)))?;
        source.sequence = safe(SafeU53::MAX.get() - 1);
        let before = source.capture_rollback_state()?;

        let result = source.try_fork_apply_many_atomic([
            PairOperation::AdvanceTime { delta_ms: safe(1) },
            PairOperation::AdvanceTime { delta_ms: safe(1) },
        ]);

        assert!(matches!(
            result,
            Err(SimulatedPairError::Adapter { reason })
                if reason == "pair sequence exhausted"
        ));
        assert_owner_graph_matches(&source, &before)?;
        Ok(())
    }

    #[test]
    fn try_fork_apply_many_atomic_rejects_disposed_source() -> TestResult {
        let mut source = SimulatedPair::new(config(0x5c, safe(64)))?;
        source.teardown("disposed fork batch source")?;

        assert!(matches!(
            source.try_fork_apply_many_atomic(Vec::<PairOperation>::new()),
            Err(SimulatedPairError::Disposed)
        ));
        Ok(())
    }

    #[test]
    fn try_fork_preserves_pristine_snapshot_and_private_owners() -> TestResult {
        let pair = SimulatedPair::new(config(0x53, safe(64)))?;
        let fork = pair.try_fork()?;

        assert_eq!(pair.snapshot()?, fork.snapshot()?);
        assert_eq!(pair.host_seat, fork.host_seat);
        assert_eq!(pair.guest_seat, fork.guest_seat);
        assert_eq!(pair.seed, fork.seed);
        assert_eq!(pair.event_budget, fork.event_budget);
        assert_eq!(
            pair.host_keyboard.export_state(),
            fork.host_keyboard.export_state()
        );
        assert_eq!(
            pair.guest_keyboard.export_state(),
            fork.guest_keyboard.export_state()
        );
        assert_ne!(
            std::ptr::addr_of!(pair.host_kernel),
            std::ptr::addr_of!(fork.host_kernel)
        );
        assert_ne!(
            std::ptr::addr_of!(pair.guest_kernel),
            std::ptr::addr_of!(fork.guest_kernel)
        );
        assert_ne!(
            std::ptr::addr_of!(pair.host_keyboard),
            std::ptr::addr_of!(fork.host_keyboard)
        );
        assert_ne!(
            std::ptr::addr_of!(pair.guest_keyboard),
            std::ptr::addr_of!(fork.guest_keyboard)
        );
        Ok(())
    }

    #[test]
    fn try_fork_keeps_source_and_sibling_isolated_after_mutation_and_teardown() -> TestResult {
        let mut source = SimulatedPair::new(config(0x54, safe(64)))?;
        let mut sibling = source.try_fork()?;
        let pristine = source.snapshot()?;

        source.key_down(PairEndpoint::Host, PhysicalKey::ArrowUp, false)?;
        let source_after_mutation = source.snapshot()?;
        assert_ne!(source_after_mutation, pristine);
        assert_eq!(sibling.snapshot()?, pristine);

        sibling.key_down(PairEndpoint::Guest, PhysicalKey::ArrowDown, false)?;
        assert_eq!(source.snapshot()?, source_after_mutation);

        sibling.teardown("fork sibling teardown")?;
        assert_eq!(source.snapshot()?, source_after_mutation);
        assert!(matches!(
            sibling.snapshot(),
            Err(SimulatedPairError::Disposed)
        ));
        Ok(())
    }

    #[test]
    fn try_fork_replays_the_same_operations_deterministically() -> TestResult {
        let operations = vec![
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::KeyDown {
                    code: PhysicalKey::ArrowUp,
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game,
                },
            },
            PairOperation::AdvanceTime { delta_ms: safe(1) },
            PairOperation::RawInput {
                endpoint: PairEndpoint::Host,
                event: RawInputEvent::KeyUp {
                    code: PhysicalKey::ArrowUp,
                },
            },
        ];
        let mut source = SimulatedPair::new(config(0x55, safe(64)))?;
        let mut fork = source.try_fork()?;

        let source_steps = source.apply_many_atomic(operations.clone())?;
        let fork_steps = fork.apply_many_atomic(operations)?;

        assert_eq!(source_steps, fork_steps);
        assert_eq!(source.snapshot()?, fork.snapshot()?);
        Ok(())
    }

    #[test]
    fn try_fork_preserves_populated_private_environment_state() -> TestResult {
        let mut pair_config = protocol_pair_config(0x56, true)?;
        pair_config.presenter = PresenterMode::FaultControlled;
        pair_config
            .initial_storage
            .insert("fork-populated".to_owned(), json!({"ready": true}));
        let mut pair = SimulatedPair::new(pair_config)?;
        let _proposal = raw_press_proposal(&mut pair)?;

        let event_id = PresentationEventId::new(safe(92));
        let mut work = VecDeque::new();
        pair.consume_effect(
            KernelEffect::Present {
                endpoint: test_seat(TEST_HOST_SEAT),
                event: PresentationEvent {
                    event_id,
                    event_kind: "fork-populated".to_owned(),
                    payload: json!({"pending": true}),
                },
            },
            &mut work,
        )?;
        assert!(work.is_empty());

        pair.storage.allocate_request_for(
            test_seat(TEST_HOST_SEAT),
            "fork-pending",
            Some(json!({"pending": true})),
        )?;
        let packet_id = pair
            .snapshot()?
            .network
            .queued_packet_ids
            .into_iter()
            .next()
            .ok_or_else(|| std::io::Error::other("populated fork fixture must queue a packet"))?;
        pair.apply(PairOperation::Fault {
            operation: FaultOperation::Delay {
                packet_id,
                additional_ms: safe(7),
            },
        })?;
        pair.advance_time(safe(20))?;

        let fork = pair.try_fork()?;
        assert_eq!(pair.snapshot()?, fork.snapshot()?);
        assert_eq!(pair.host_kernel.snapshot(), fork.host_kernel.snapshot());
        assert_eq!(pair.guest_kernel.snapshot(), fork.guest_kernel.snapshot());
        assert_eq!(
            pair.host_keyboard.export_state(),
            fork.host_keyboard.export_state()
        );
        assert_eq!(
            pair.guest_keyboard.export_state(),
            fork.guest_keyboard.export_state()
        );
        assert_eq!(pair.clock.export_state(), fork.clock.export_state());
        assert_eq!(pair.network.export_state(), fork.network.export_state());
        assert_eq!(
            pair.presenter.export_state()?,
            fork.presenter.export_state()?
        );
        assert_eq!(pair.storage.export_state(), fork.storage.export_state());
        assert_eq!(pair.shared_terminal, fork.shared_terminal);
        assert_eq!(pair.terminal_reason, fork.terminal_reason);
        assert_eq!(pair.fault_script, fork.fault_script);
        assert_eq!(pair.last_boundary_order, fork.last_boundary_order);
        assert_eq!(
            pair.trace_audit.effect_origins,
            fork.trace_audit.effect_origins
        );
        assert_eq!(
            pair.trace_audit.host_rng_audit,
            fork.trace_audit.host_rng_audit
        );
        assert_eq!(
            pair.trace_audit.host_internal_events,
            fork.trace_audit.host_internal_events
        );
        assert_eq!(
            pair.trace_audit.guest_rng_audit,
            fork.trace_audit.guest_rng_audit
        );
        assert_eq!(
            pair.trace_audit.guest_internal_events,
            fork.trace_audit.guest_internal_events
        );
        assert_eq!(pair.disposed, fork.disposed);
        Ok(())
    }

    #[test]
    fn try_fork_rejects_disposed_source() -> TestResult {
        let mut pair = SimulatedPair::new(config(0x57, safe(64)))?;
        pair.teardown("disposed fork source")?;

        assert!(matches!(pair.try_fork(), Err(SimulatedPairError::Disposed)));
        Ok(())
    }

    #[test]
    fn zero_event_budget_is_rejected_during_initialization() {
        let result = SimulatedPair::new(config(7, SafeU53::ZERO));
        assert!(matches!(
            result,
            Err(SimulatedPairError::InvalidConfig { reason })
                if reason == "event budget must be positive"
        ));
    }

    #[test]
    fn shared_terminal_effect_projects_both_endpoints_exactly_once() -> TestResult {
        let terminal = TerminalState {
            terminal_id: "terminal:absolute-proposal-ceiling".to_owned(),
            reason: "proposal absolute ceiling reached".to_owned(),
        };
        let expected_menu = MenuState::Terminal(TerminalMenu {
            terminal_id: terminal.terminal_id.clone(),
            prompt_key: Some(terminal.reason.clone()),
        });
        let effect = KernelEffect::EnterSharedTerminal {
            terminal: terminal.clone(),
        };
        let mut pair_config = config(7, SafeU53::new(8)?);
        pair_config.guest_kernel.initial_ui.owner_seat = None;
        pair_config.guest_kernel.initial_ui.actionable = false;
        pair_config.guest_kernel.initial_ui.stack = vec![expected_menu.clone()];
        let mut pair = SimulatedPair::new(pair_config)?;
        let before = pair.snapshot()?;
        let mut work = VecDeque::new();

        pair.consume_effect(effect.clone(), &mut work)?;
        assert!(work.is_empty());
        let first = pair.snapshot()?;
        assert_ne!(first.host.ui.generation, before.host.ui.generation);
        assert_eq!(first.guest.ui.generation, before.guest.ui.generation);
        assert_eq!(
            first.terminal_reason.as_deref(),
            Some(terminal.reason.as_str())
        );
        for endpoint in [&first.host, &first.guest] {
            assert_eq!(endpoint.kernel.ui.owner_seat, None);
            assert!(!endpoint.kernel.ui.actionable);
            assert_eq!(endpoint.kernel.ui.stack, vec![expected_menu.clone()]);
            assert_eq!(endpoint.ui.kind, UiViewKind::Terminal);
            assert!(!endpoint.ui.actionable);
            assert_eq!(
                endpoint.ui.prompt_key.as_deref(),
                Some(terminal.reason.as_str())
            );
        }

        pair.consume_effect(effect, &mut work)?;
        assert!(work.is_empty());
        assert_eq!(pair.snapshot()?, first);
        Ok(())
    }

    #[test]
    fn shared_terminal_absorbs_peer_resources_and_every_later_operation() -> TestResult {
        let terminal = TerminalState {
            terminal_id: "authority-v2-terminal".to_owned(),
            reason: "shared terminal is absorbing".to_owned(),
        };
        let expected_menu = MenuState::Terminal(TerminalMenu {
            terminal_id: terminal.terminal_id.clone(),
            prompt_key: Some(terminal.reason.clone()),
        });
        let mut pair_config = protocol_pair_config(0xab50_12be, false)?;
        pair_config.presenter = PresenterMode::FaultControlled;
        pair_config
            .initial_storage
            .insert("pair-live-storage".to_owned(), json!({"live": true}));
        let mut pair = SimulatedPair::new(pair_config)?;

        let proposal = raw_press_proposal(&mut pair)?;
        let presentation_id = PresentationEventId::new(safe(91));
        let mut work = VecDeque::new();
        pair.consume_effect(
            KernelEffect::Present {
                endpoint: test_seat(TEST_GUEST_SEAT),
                event: PresentationEvent {
                    event_id: presentation_id,
                    event_kind: "pair-terminal-pending".to_owned(),
                    payload: json!({"pending": true}),
                },
            },
            &mut work,
        )?;
        assert!(work.is_empty());

        let armed = pair.snapshot()?;
        assert!(
            armed
                .guest
                .live_resources
                .proposal_leases
                .contains(&proposal.operation_id)
        );
        assert!(!armed.guest.live_resources.timers.is_empty());
        assert!(!pair.clock.pending_timers().is_empty());
        assert!(!armed.network.queued_packet_ids.is_empty());
        assert!(armed.presenter.pending_event_ids.contains(&presentation_id));
        assert!(armed.storage.keys.contains("pair-live-storage"));

        pair.consume_effect(
            KernelEffect::EnterSharedTerminal {
                terminal: terminal.clone(),
            },
            &mut work,
        )?;
        assert!(work.is_empty());
        let absorbed = pair.snapshot()?;
        assert!(pair.host_kernel.is_disposed());
        assert!(pair.guest_kernel.is_disposed());
        assert!(pair.last_boundary_order.is_empty());
        assert_zero_pair_resources(&pair, &absorbed);
        assert_eq!(
            absorbed.terminal_reason.as_deref(),
            Some(terminal.reason.as_str())
        );
        for endpoint in [&absorbed.host, &absorbed.guest] {
            assert_eq!(endpoint.kernel.ui.owner_seat, None);
            assert!(!endpoint.kernel.ui.actionable);
            assert_eq!(endpoint.kernel.ui.stack, vec![expected_menu.clone()]);
            assert_eq!(endpoint.ui.kind, UiViewKind::Terminal);
            assert!(!endpoint.ui.actionable);
            assert_eq!(
                endpoint.ui.prompt_key.as_deref(),
                Some(terminal.reason.as_str())
            );
        }

        let inert_steps = vec![
            pair.advance_time(safe(10_000))?,
            pair.apply(PairOperation::Fault {
                operation: FaultOperation::DeliverNext,
            })?,
            pair.apply(PairOperation::Disconnect {
                endpoint: PairEndpoint::Guest,
            })?,
            pair.apply(PairOperation::Reconnect {
                endpoint: PairEndpoint::Host,
            })?,
            pair.apply(PairOperation::PresentationSettled {
                endpoint: PairEndpoint::Guest,
                event_id: presentation_id,
                outcome: PresentationOutcome::Failed {
                    reason: "must be inert".to_owned(),
                },
            })?,
            pair.apply(PairOperation::StorageResult {
                endpoint: PairEndpoint::Host,
                request_id: safe(92),
                result: StorageResult::Persisted,
            })?,
            pair.apply(PairOperation::Suspend {
                endpoint: PairEndpoint::Host,
            })?,
            pair.apply(PairOperation::Resume {
                endpoint: PairEndpoint::Guest,
            })?,
            pair.key_down(PairEndpoint::Guest, PhysicalKey::Enter, false)?,
            pair.focus(PairEndpoint::Host, InputFocus::TextEntry)?,
        ];

        for (index, step) in inert_steps.iter().enumerate() {
            assert_eq!(
                step.sequence.get(),
                absorbed.sequence.get() + u64::try_from(index)? + 1
            );
            assert_eq!(step.sequence, step.snapshot.sequence);
            assert!(step.generated_effects.is_empty());
            assert_absorbed_state(&step.snapshot, &absorbed);
            assert_zero_pair_resources(&pair, &step.snapshot);
        }
        assert_eq!(pair.host_keyboard.input_focus(), InputFocus::Game);

        let before_teardown = pair.snapshot()?;
        let first_teardown = pair.teardown("must not replace exact terminal")?;
        assert_eq!(first_teardown, before_teardown);
        assert!(matches!(
            pair.teardown("explicit teardown is one-shot"),
            Err(SimulatedPairError::Disposed)
        ));
        assert!(matches!(pair.snapshot(), Err(SimulatedPairError::Disposed)));
        assert!(matches!(
            pair.advance_time(SafeU53::ZERO),
            Err(SimulatedPairError::Disposed)
        ));
        assert!(matches!(
            pair.key_down(PairEndpoint::Guest, PhysicalKey::Enter, false),
            Err(SimulatedPairError::Disposed)
        ));
        Ok(())
    }

    #[test]
    fn live_snapshot_round_trips_clock_and_endpoint_presenter_diagnostics() -> TestResult {
        let mut pair_config = protocol_pair_config(0xab50_12bf, false)?;
        pair_config.presenter = PresenterMode::FaultControlled;
        let mut pair = SimulatedPair::new(pair_config)?;
        let _proposal = raw_press_proposal(&mut pair)?;

        let event_id = PresentationEventId::new(safe(91));
        let mut work = VecDeque::new();
        pair.consume_effect(
            KernelEffect::Present {
                endpoint: test_seat(TEST_HOST_SEAT),
                event: PresentationEvent {
                    event_id,
                    event_kind: "pair-live-diagnostics".to_owned(),
                    payload: json!({"pending": true}),
                },
            },
            &mut work,
        )?;
        assert!(work.is_empty());

        let pending = pair.snapshot()?;
        assert!(!pending.clock_timers.is_empty());
        assert_eq!(pending.clock_timers, pair.clock.pending_timers());
        assert!(pending.host.presenter.pending_event_ids.contains(&event_id));
        assert!(pending.host.presenter.settled_event_ids.is_empty());
        assert!(pending.guest.presenter.pending_event_ids.is_empty());
        assert!(pending.guest.presenter.settled_event_ids.is_empty());

        let settled_step = pair.apply(PairOperation::PresentationSettled {
            endpoint: PairEndpoint::Host,
            event_id,
            outcome: PresentationOutcome::Settled,
        })?;
        assert!(
            settled_step
                .snapshot
                .host
                .presenter
                .pending_event_ids
                .is_empty()
        );
        assert!(
            settled_step
                .snapshot
                .host
                .presenter
                .settled_event_ids
                .contains(&event_id)
        );
        assert!(
            settled_step
                .snapshot
                .host
                .live_resources
                .presentations
                .is_empty()
        );
        assert!(
            settled_step
                .snapshot
                .guest
                .presenter
                .pending_event_ids
                .is_empty()
        );
        assert!(
            settled_step
                .snapshot
                .guest
                .presenter
                .settled_event_ids
                .is_empty()
        );

        let encoded = serde_json::to_value(&settled_step.snapshot)?;
        assert_eq!(
            encoded
                .get("clockTimers")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(settled_step.snapshot.clock_timers.len())
        );
        for endpoint in ["host", "guest"] {
            assert!(
                encoded
                    .get(endpoint)
                    .and_then(Value::as_object)
                    .and_then(|snapshot| snapshot.get("presenter"))
                    .is_some()
            );
        }
        let decoded: PairSnapshot = serde_json::from_value(encoded)?;
        assert_eq!(decoded, settled_step.snapshot);

        let torn_down = pair.teardown("live diagnostics teardown")?;
        assert_zero_pair_resources(&pair, &torn_down);
        Ok(())
    }

    #[test]
    fn pair_snapshot_seed_round_trips_the_complete_u64_spelling() -> TestResult {
        let above_js_safe = 9_007_199_254_740_993_u64;
        let above_js_safe_pair = SimulatedPair::new(config(above_js_safe, SafeU53::new(8)?))?;
        let above_js_safe_snapshot = above_js_safe_pair.snapshot()?;
        let above_js_safe_encoded = serde_json::to_value(&above_js_safe_snapshot)?;
        assert_eq!(
            above_js_safe_encoded.get("seed"),
            Some(&Value::String(above_js_safe.to_string()))
        );
        assert_eq!(
            above_js_safe_encoded
                .get("clockTimers")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(above_js_safe_snapshot.clock_timers.len())
        );
        for endpoint in ["host", "guest"] {
            assert!(
                above_js_safe_encoded
                    .get(endpoint)
                    .and_then(Value::as_object)
                    .and_then(|snapshot| snapshot.get("presenter"))
                    .is_some()
            );
        }
        let above_js_safe_decoded: PairSnapshot = serde_json::from_value(above_js_safe_encoded)?;
        assert_eq!(above_js_safe_decoded, above_js_safe_snapshot);

        let pair = SimulatedPair::new(config(u64::MAX, SafeU53::new(8)?))?;
        let snapshot = pair.snapshot()?;
        let encoded = serde_json::to_value(&snapshot)?;
        assert_eq!(
            encoded.get("seed"),
            Some(&Value::String("18446744073709551615".to_owned()))
        );

        let decoded: PairSnapshot = serde_json::from_value(encoded.clone())?;
        assert_eq!(decoded, snapshot);

        for invalid_seed in [
            Value::String("".to_owned()),
            Value::String("+1".to_owned()),
            Value::String("-1".to_owned()),
            Value::String("01".to_owned()),
            Value::String("1e3".to_owned()),
            Value::String(" 1".to_owned()),
            Value::String("1 ".to_owned()),
            Value::String("18446744073709551616".to_owned()),
            Value::from(1_u64),
        ] {
            let mut invalid = encoded.clone();
            invalid["seed"] = invalid_seed;
            assert!(serde_json::from_value::<PairSnapshot>(invalid).is_err());
        }
        Ok(())
    }
}
