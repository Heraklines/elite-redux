//! Two-kernel effect-only orchestrator with no semantic-choice bypass API.

use std::collections::{BTreeMap, VecDeque};

use er_canonical::content_digest;
use er_kernel::{GameKernel, KernelConfig};
use er_protocol::{ScheduledTimer, SchedulerCommand, control_id_of};
use er_testkit::{DetachedKeyboardDriver, KeyHoldPlan};
use er_types::{
    ConnectionGeneration, ControlProjectionOutcome, InputFocus, KernelEffect, KernelInput,
    KernelSnapshot, LiveResourceSnapshot, MaterialApplicationOutcome, MenuState, NetworkPayload,
    PhysicalKey, PresentationEventId, PresentationOutcome, RawFrame, RawInputEvent, SafeU53,
    SeatId, StorageResult, TerminalMenu, TerminalState, TimeClass, TransportState, UiViewModel,
};
use serde::{
    Deserialize, Deserializer, Serialize, Serializer, de::Error as SerdeDeError,
    ser::Error as SerdeSerError,
};
use serde_json::Value;
use thiserror::Error;

use crate::{
    ClockTimerSnapshot, FaultNetwork, FaultNetworkDiagnostics, FaultOperation, InstantPresenter,
    MemoryStorage, NetworkEvent, Presenter, PresenterDiagnostics, PresenterMode, StorageAdapter,
    StorageDiagnostics,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
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

impl Serialize for PairSnapshot {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        parse_canonical_seed(&self.seed).map_err(S::Error::custom)?;
        PairSnapshotWire {
            sequence: self.sequence,
            seed: self.seed.clone(),
            virtual_time_ms: self.virtual_time_ms,
            clock_timers: self.clock_timers.clone(),
            host: self.host.clone(),
            guest: self.guest.clone(),
            network: self.network.clone(),
            presenter: self.presenter.clone(),
            storage: self.storage.clone(),
            terminal_reason: self.terminal_reason.clone(),
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
    // PairStep intentionally exposes effects but not packet-delivery events.
    // This deterministic private value is the narrow witness for cross-domain
    // timer/network ordering without changing the frozen public schema.
    last_boundary_order: Vec<BoundaryOrderEvent>,
    disposed: bool,
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
            last_boundary_order: Vec::new(),
            disposed: false,
        })
    }

    pub fn apply(&mut self, operation: PairOperation) -> Result<PairStep, SimulatedPairError> {
        self.ensure_live()?;
        let operation_for_step = operation.clone();
        let mut generated_effects = Vec::new();
        let mut work = VecDeque::new();
        let mut generated_events = 0_u64;
        let event_budget = self.event_budget;

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

    pub fn key_down(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
        printable: bool,
    ) -> Result<PairStep, SimulatedPairError> {
        let event = self.keyboard(endpoint).key_down(code, printable);
        self.apply(PairOperation::RawInput { endpoint, event })
    }

    pub fn key_up(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
    ) -> Result<PairStep, SimulatedPairError> {
        let event = self.keyboard(endpoint).key_up(code);
        self.apply(PairOperation::RawInput { endpoint, event })
    }

    pub fn press(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
    ) -> Result<Vec<PairStep>, SimulatedPairError> {
        let [key_down_event, key_up_event] = self.keyboard(endpoint).press(code);
        let key_down = self.apply(PairOperation::RawInput {
            endpoint,
            event: key_down_event,
        })?;
        let key_up = self.apply(PairOperation::RawInput {
            endpoint,
            event: key_up_event,
        })?;
        Ok(vec![key_down, key_up])
    }

    pub fn hold_for(
        &mut self,
        endpoint: PairEndpoint,
        code: PhysicalKey,
        duration_ms: SafeU53,
    ) -> Result<Vec<PairStep>, SimulatedPairError> {
        let KeyHoldPlan {
            key_down,
            duration_ms,
            key_up,
        } = self.keyboard(endpoint).hold_for(code, duration_ms);
        let key_down = self.apply(PairOperation::RawInput {
            endpoint,
            event: key_down,
        })?;
        let advance = self.apply(PairOperation::AdvanceTime {
            delta_ms: duration_ms,
        })?;
        let key_up = self.apply(PairOperation::RawInput {
            endpoint,
            event: key_up,
        })?;
        Ok(vec![key_down, advance, key_up])
    }

    pub fn blur(&mut self, endpoint: PairEndpoint) -> Result<PairStep, SimulatedPairError> {
        let event = self.keyboard(endpoint).blur();
        self.apply(PairOperation::RawInput { endpoint, event })
    }

    pub fn focus(
        &mut self,
        endpoint: PairEndpoint,
        focus: InputFocus,
    ) -> Result<PairStep, SimulatedPairError> {
        let mut next_keyboard = self.keyboard(endpoint).clone();
        let event = next_keyboard.focus(focus);
        let step = self.apply(PairOperation::RawInput { endpoint, event })?;
        if self.shared_terminal.is_none() {
            *self.keyboard_mut(endpoint) = next_keyboard;
        }
        Ok(step)
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
            self.reconnect_transport_inputs(generation)?,
        ));
        Ok(())
    }

    fn reconnect_transport_inputs(
        &self,
        generation: ConnectionGeneration,
    ) -> Result<Vec<(PairEndpoint, KernelInput)>, SimulatedPairError> {
        let mut inputs = Vec::with_capacity(8);
        for kernel_endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            let local_seat = self.seat(kernel_endpoint);
            let remote_seat = self.peer_seat(local_seat)?;
            for (observed_endpoint, state) in [
                (local_seat, TransportState::Disconnected),
                (remote_seat, TransportState::Disconnected),
                (remote_seat, TransportState::Connected),
                (local_seat, TransportState::Connected),
            ] {
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

        self.kernel_mut(endpoint).step(input).map_err(kernel_error)
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
            KernelEffect::UiChanged { endpoint, .. } | KernelEffect::UiIntent { endpoint, .. } => {
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
        self.project_shared_terminal(&terminal);

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
        self.last_boundary_order.clear();
        Ok(())
    }

    fn project_shared_terminal(&mut self, terminal: &TerminalState) {
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

    fn kernel_mut(&mut self, endpoint: PairEndpoint) -> &mut GameKernel {
        match endpoint {
            PairEndpoint::Host => &mut self.host_kernel,
            PairEndpoint::Guest => &mut self.guest_kernel,
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
        EndpointSnapshot {
            kernel: kernel.snapshot(),
            ui: kernel.ui_view(),
            state_digest: kernel.state_digest(),
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
            terminal_id: "terminal:absorbing".to_owned(),
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
