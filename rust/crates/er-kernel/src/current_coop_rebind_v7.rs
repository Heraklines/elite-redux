//! Equal-frontier owned consecutive-generation transactions and bounded receipt history.
use super::*;
use crate::current_proposal_v7::deserialize_current_frame_context;
use er_game::m9e_material_v6::game_state_digest;
use er_protocol::ProtocolRuntimeSnapshotV2;
use er_types::battle_ids::GameModeId;
use er_types::run_ids::GameRunId;
use er_types::{FrameContext, GameContentIdentityV2};
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, GameKernelV7Error>;
pub const MAX_CURRENT_REBIND_OWNER_BYTES_V1: usize = 65_536;
pub const MAX_CURRENT_REBIND_FRAME_BYTES_V1: usize = 16_384;
pub(super) const PAUSE: &str = "current-coop-rebind";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentCoopRebindPhaseV1 {
    AwaitOffer,
    AwaitJoin,
    AwaitPrepare,
    AwaitPrepared,
    AwaitCommit,
    AwaitApplied,
    AwaitReady,
    AwaitReadyAck,
    Open,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentCoopRebindMessageV1 {
    Offer,
    Join,
    Prepare,
    Prepared,
    Commit,
    Applied,
    Ready,
    ReadyAck,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentCoopRebindKindV1 {
    CurrentCoopRebind,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentCoopRebindFrontierV1 {
    pub run: GameRunId,
    pub next_authority_revision: SafeU53,
    pub operation: OperationId,
    pub material_fingerprint: String,
    pub after_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentCoopRebindBindingV1 {
    #[serde(deserialize_with = "deserialize_current_frame_context")]
    pub authority_origin: FrameContext,
    #[serde(deserialize_with = "deserialize_current_frame_context")]
    pub guest_origin: FrameContext,
    #[serde(deserialize_with = "deserialize_current_frame_context")]
    pub authority_target: FrameContext,
    #[serde(deserialize_with = "deserialize_current_frame_context")]
    pub guest_target: FrameContext,
    pub content: GameContentIdentityV2,
    pub seed: String,
    pub mode: GameModeId,
    pub started_digest: String,
    pub frontier: CurrentCoopRebindFrontierV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentCoopRebindControlV1 {
    pub kind: CurrentCoopRebindKindV1,
    pub schema_version: u32,
    pub message: CurrentCoopRebindMessageV1,
    #[serde(deserialize_with = "deserialize_current_frame_context")]
    pub sender: FrameContext,
    #[serde(deserialize_with = "deserialize_current_frame_context")]
    pub receiver: FrameContext,
    pub binding_digest: String,
    pub previous_digest: Option<String>,
    pub authority_nonce: SafeU53,
    pub guest_nonce: Option<SafeU53>,
    pub transaction_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentCoopRebindSnapshotV1 {
    pub schema_version: u32,
    pub role: EndpointRole,
    pub phase: CurrentCoopRebindPhaseV1,
    pub from_generation: ConnectionGeneration,
    pub to_generation: ConnectionGeneration,
    pub binding: CurrentCoopRebindBindingV1,
    pub begin_replay_sequence: SafeU53,
    pub commit_replay_sequence: Option<SafeU53>,
    pub candidate_connected: bool,
    /// Exact fixed eight-message transcript prefix; no receipt/proposal duplication or timers.
    pub transcript: Vec<CurrentCoopRebindControlV1>,
}

/// Native protocol output only. It is not a browser host effect or a gameplay operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentCoopRebindOutputV1 {
    pub generation: ConnectionGeneration,
    pub frames: Vec<Vec<u8>>,
}

fn generation(value: u64) -> Result<ConnectionGeneration> {
    Ok(ConnectionGeneration::new(
        SafeU53::new(value).map_err(|_| GameKernelV7Error::Invalid)?,
    ))
}
fn checked_next(value: SafeU53) -> Result<SafeU53> {
    value
        .get()
        .checked_add(1)
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or(GameKernelV7Error::Invalid)
}
fn digest<T: Serialize>(value: &T) -> Result<String> {
    er_canonical::fixture_digest(value).map_err(|_| GameKernelV7Error::Invalid)
}
fn bounded<T: Serialize>(value: &T, limit: usize) -> Result<Vec<u8>> {
    let bytes = canonical_bytes(value).map_err(|_| GameKernelV7Error::Invalid)?;
    if bytes.is_empty() || bytes.len() > limit {
        return Err(GameKernelV7Error::Invalid);
    }
    Ok(bytes)
}
fn context_at(origin: &FrameContext, generation: ConnectionGeneration) -> FrameContext {
    let mut value = origin.clone();
    value.connection_generation = generation;
    value
}
fn target(origin: &FrameContext) -> Result<FrameContext> {
    Ok(context_at(
        origin,
        ConnectionGeneration::new(checked_next(origin.connection_generation.get())?),
    ))
}
fn messages() -> [CurrentCoopRebindMessageV1; 8] {
    use CurrentCoopRebindMessageV1::*;
    [
        Offer, Join, Prepare, Prepared, Commit, Applied, Ready, ReadyAck,
    ]
}
fn phase(role: EndpointRole, count: usize) -> Result<CurrentCoopRebindPhaseV1> {
    use CurrentCoopRebindPhaseV1::*;
    match (role, count) {
        (EndpointRole::Authority, 1) => Ok(AwaitJoin),
        (EndpointRole::Authority, 3) => Ok(AwaitPrepared),
        (EndpointRole::Authority, 5) => Ok(AwaitApplied),
        (EndpointRole::Authority, 7) => Ok(AwaitReadyAck),
        (EndpointRole::Replica, 0) => Ok(AwaitOffer),
        (EndpointRole::Replica, 2) => Ok(AwaitPrepare),
        (EndpointRole::Replica, 4) => Ok(AwaitCommit),
        (EndpointRole::Replica, 6) => Ok(AwaitReady),
        (_, 8) => Ok(Open),
        _ => Err(GameKernelV7Error::Invalid),
    }
}
fn committed(role: EndpointRole, count: usize) -> bool {
    count
        >= if role == EndpointRole::Authority {
            5
        } else {
            6
        }
}

impl CurrentCoopRebindSnapshotV1 {
    fn next_control(&self) -> Result<CurrentCoopRebindControlV1> {
        let index = self.transcript.len();
        let message = *messages().get(index).ok_or(GameKernelV7Error::Invalid)?;
        let sender_authority = index.is_multiple_of(2);
        if sender_authority != (self.role == EndpointRole::Authority) {
            return Err(GameKernelV7Error::Invalid);
        }
        let authority_nonce = if index == 0 {
            self.begin_replay_sequence
        } else {
            self.transcript[0].authority_nonce
        };
        let guest_nonce = if index == 0 {
            None
        } else if index == 1 {
            Some(self.begin_replay_sequence)
        } else {
            self.transcript[1].guest_nonce
        };
        Ok(CurrentCoopRebindControlV1 {
            kind: CurrentCoopRebindKindV1::CurrentCoopRebind,
            schema_version: 1,
            message,
            sender: if sender_authority {
                self.binding.authority_target.clone()
            } else {
                self.binding.guest_target.clone()
            },
            receiver: if sender_authority {
                self.binding.guest_target.clone()
            } else {
                self.binding.authority_target.clone()
            },
            binding_digest: digest(&("current-coop-rebind-binding-v1", &self.binding))?,
            previous_digest: self.transcript.last().map(digest).transpose()?,
            authority_nonce,
            guest_nonce,
            transaction_id: guest_nonce
                .map(|guest| {
                    digest(&(
                        "current-coop-rebind-transaction-v1",
                        &self.binding,
                        authority_nonce,
                        guest,
                    ))
                })
                .transpose()?,
        })
    }

    fn output(&self) -> Result<CurrentCoopRebindOutputV1> {
        let frame = self.transcript.iter().rev().find(|frame| {
            (frame.sender.sender_seat_id == self.binding.authority_target.sender_seat_id)
                == (self.role == EndpointRole::Authority)
        });
        self.emit(frame)
    }

    fn receive_response(&self, incoming_index: usize) -> Result<CurrentCoopRebindOutputV1> {
        // A receive returns its exact immediate response, never a later retry frame.
        // READY_ACK is terminal and produces no response, preventing an acknowledgment loop.
        self.emit(self.transcript.get(incoming_index + 1))
    }

    fn emit(
        &self,
        frame: Option<&CurrentCoopRebindControlV1>,
    ) -> Result<CurrentCoopRebindOutputV1> {
        Ok(CurrentCoopRebindOutputV1 {
            generation: self.to_generation,
            frames: if self.candidate_connected {
                frame
                    .map(|value| bounded(value, MAX_CURRENT_REBIND_FRAME_BYTES_V1))
                    .transpose()?
                    .into_iter()
                    .collect()
            } else {
                Vec::new()
            },
        })
    }

    fn validate(&self, replay: SafeU53) -> Result<()> {
        bounded(self, MAX_CURRENT_REBIND_OWNER_BYTES_V1)?;
        if self.schema_version != 1
            || self.from_generation.get() == SafeU53::ZERO
            || self.to_generation != ConnectionGeneration::new(checked_next(self.from_generation.get())?)
            || self.begin_replay_sequence == SafeU53::ZERO
            || self.begin_replay_sequence > replay
            || self.phase != phase(self.role, self.transcript.len())?
            || self.binding.authority_origin.connection_generation != self.from_generation
            || self.binding.guest_origin.connection_generation != self.from_generation
            || self.binding.authority_target != target(&self.binding.authority_origin)?
            || self.binding.guest_target != target(&self.binding.guest_origin)?
        {
            return Err(GameKernelV7Error::Invalid);
        }
        if committed(self.role, self.transcript.len()) {
            if self
                .commit_replay_sequence
                .is_none_or(|sequence| sequence <= self.begin_replay_sequence || sequence > replay)
            {
                return Err(GameKernelV7Error::Invalid);
            }
        } else if self.commit_replay_sequence.is_some() {
            return Err(GameKernelV7Error::Invalid);
        }
        let authority_nonce = self.transcript.first().map(|frame| frame.authority_nonce);
        let guest_nonce = self.transcript.get(1).and_then(|frame| frame.guest_nonce);
        if authority_nonce == Some(SafeU53::ZERO)
            || guest_nonce == Some(SafeU53::ZERO)
            || (self.role == EndpointRole::Authority
                && authority_nonce != Some(self.begin_replay_sequence))
            || (self.role == EndpointRole::Replica
                && self.transcript.len() >= 2
                && guest_nonce != Some(self.begin_replay_sequence))
        {
            return Err(GameKernelV7Error::Invalid);
        }
        for (index, frame) in self.transcript.iter().enumerate() {
            let sender_authority = index.is_multiple_of(2);
            let expected_guest = if index == 0 { None } else { guest_nonce };
            let transaction = expected_guest
                .map(|guest| {
                    digest(&(
                        "current-coop-rebind-transaction-v1",
                        &self.binding,
                        frame.authority_nonce,
                        guest,
                    ))
                })
                .transpose()?;
            if frame.kind != CurrentCoopRebindKindV1::CurrentCoopRebind
                || frame.schema_version != 1
                || messages().get(index) != Some(&frame.message)
                || Some(frame.authority_nonce) != authority_nonce
                || frame.guest_nonce != expected_guest
                || (index > 0 && expected_guest.is_none())
                || frame.transaction_id != transaction
                || frame.sender
                    != if sender_authority {
                        self.binding.authority_target.clone()
                    } else {
                        self.binding.guest_target.clone()
                    }
                || frame.receiver
                    != if sender_authority {
                        self.binding.guest_target.clone()
                    } else {
                        self.binding.authority_target.clone()
                    }
                || frame.binding_digest
                    != digest(&("current-coop-rebind-binding-v1", &self.binding))?
                || frame.previous_digest
                    != if index == 0 {
                        None
                    } else {
                        Some(digest(&self.transcript[index - 1])?)
                    }
            {
                return Err(GameKernelV7Error::Invalid);
            }
            bounded(frame, MAX_CURRENT_REBIND_FRAME_BYTES_V1)?;
        }
        Ok(())
    }
}

/// Build the exact initial generic protocol inventory from its retained immutable configs.
/// Only actual connection state and current proposal-admission fingerprints may differ.
fn require_quiescent_protocol(protocol: &ProtocolRuntimeSnapshotV2) -> Result<()> {
    use crate::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
    use er_protocol::authority_log::{AuthorityLogConfig, PeerBinding};
    use er_protocol::replica::AuthorityReplicaConfig;
    protocol
        .validate()
        .map_err(|_| GameKernelV7Error::Invalid)?;
    let config = match protocol.role {
        EndpointRole::Authority => {
            let log = protocol
                .authority_log
                .as_ref()
                .ok_or(GameKernelV7Error::Invalid)?;
            let admission = protocol
                .proposal_admission
                .as_ref()
                .ok_or(GameKernelV7Error::Invalid)?;
            BattleProtocolConfig {
                role: BattleProtocolRoleConfig::Authority {
                    log: AuthorityLogConfig {
                        local_context: log.local_context.clone(),
                        peer_bindings: log
                            .peer_bindings
                            .iter()
                            .map(|peer| PeerBinding {
                                seat_id: peer.seat,
                                connection_generation: peer.generation,
                            })
                            .collect(),
                        owner_id: log.owner_id.clone(),
                        retain_capacity: log.retain_capacity,
                        delivery_backoff: log.delivery_backoff,
                        delivery_time_class: log.delivery_time_class,
                        max_delivery_attempts: log.max_delivery_attempts,
                    },
                    proposal_capacity: admission.capacity,
                },
            }
        }
        EndpointRole::Replica => {
            let replica = protocol
                .authority_replica
                .as_ref()
                .ok_or(GameKernelV7Error::Invalid)?;
            let leases = protocol
                .proposal_leases
                .as_ref()
                .ok_or(GameKernelV7Error::Invalid)?;
            let recovery = protocol
                .recovery
                .as_ref()
                .ok_or(GameKernelV7Error::Invalid)?;
            BattleProtocolConfig {
                role: BattleProtocolRoleConfig::Replica {
                    replica: AuthorityReplicaConfig {
                        receipt_context: replica.receipt_context.clone(),
                        authority_seat_id: replica.authority_seat,
                        authority_connection_generation: replica.authority_generation,
                    },
                    proposal_leases: leases.config.clone(),
                    recovery: recovery.config.clone(),
                },
            }
        }
    };
    let mut expected = crate::initial_battle_protocol_snapshot_v2(
        &config,
        protocol.frame_context.context.sender_seat_id,
    )
    .map_err(|_| GameKernelV7Error::Invalid)?;
    if let (Some(expected), Some(actual)) = (
        &mut expected.proposal_admission,
        &protocol.proposal_admission,
    ) {
        expected.fingerprints = actual.fingerprints.clone();
    }
    if expected.connections.len() != protocol.connections.len() {
        return Err(GameKernelV7Error::Invalid);
    }
    for (expected, actual) in expected.connections.iter_mut().zip(&protocol.connections) {
        expected.state = actual.state;
    }
    if expected != *protocol {
        return Err(GameKernelV7Error::Invalid);
    }
    Ok(())
}

fn require_quiescent_scheduler(
    protocol: &ProtocolRuntimeSnapshotV2,
    scheduler: &KernelSchedulerSnapshotV2,
) -> Result<()> {
    crate::current_proposal_v7::validate_current_proposal_quiescence_v1(Some(protocol), scheduler)
        .map_err(|_| GameKernelV7Error::Invalid)?;
    if scheduler.timers.iter().any(|timer| {
        protocol.authority_log.as_ref().is_some_and(|log| {
            timer
                .registration
                .owner
                .owner_id
                .starts_with(&format!("{}:delivery:", log.owner_id))
        }) || protocol.recovery.as_ref().is_some_and(|recovery| {
            timer.registration.owner.owner_id == recovery.config.timer_owner_id
        })
    }) {
        return Err(GameKernelV7Error::Invalid);
    }
    Ok(())
}

fn set_generation(
    protocol: &mut ProtocolRuntimeSnapshotV2,
    value: ConnectionGeneration,
    connected: bool,
) -> Result<()> {
    protocol.frame_context.context.connection_generation = value;
    protocol.peer_identity.local.connection_generation = value;
    protocol
        .peer_identity
        .peer
        .as_mut()
        .ok_or(GameKernelV7Error::Invalid)?
        .connection_generation = value;
    let [connection] = protocol.connections.as_mut_slice() else {
        return Err(GameKernelV7Error::Invalid);
    };
    connection.generation = value;
    connection.state = if connected {
        TransportState::Connected
    } else {
        TransportState::Disconnected
    };
    if let Some(log) = &mut protocol.authority_log {
        log.local_context.connection_generation = value;
        let [peer] = log.peer_bindings.as_mut_slice() else {
            return Err(GameKernelV7Error::Invalid);
        };
        peer.generation = value;
    }
    if let Some(replica) = &mut protocol.authority_replica {
        replica.receipt_context.connection_generation = value;
        replica.authority_generation = value;
    }
    if let Some(recovery) = &mut protocol.recovery {
        recovery.config.local_context.connection_generation = value;
    }
    protocol.validate().map_err(|_| GameKernelV7Error::Invalid)
}

pub(super) fn origin_protocol(
    protocol: &ProtocolRuntimeSnapshotV2,
) -> Result<ProtocolRuntimeSnapshotV2> {
    let mut value = protocol.clone();
    set_generation(&mut value, generation(1)?, false)?;
    Ok(value)
}

fn binding(
    snapshot: &CoreGameKernelSnapshotV7,
    from_generation: ConnectionGeneration,
) -> Result<CurrentCoopRebindBindingV1> {
    let setup = snapshot
        .current_coop_setup
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &snapshot.lifecycle else {
        return Err(GameKernelV7Error::Invalid);
    };
    let mut state = state.clone();
    if let Some(private) = &snapshot.private_battle_control {
        state
            .active_run
            .as_mut()
            .ok_or(GameKernelV7Error::Invalid)?
            .control = private.canonical_control.clone();
    }
    state.validate().map_err(|_| GameKernelV7Error::Invalid)?;
    let run = state
        .active_run
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    if run.outcome != er_types::RunOutcome::InProgress {
        return Err(GameKernelV7Error::Invalid);
    }
    let last = snapshot
        .material_ledger
        .records
        .last()
        .ok_or(GameKernelV7Error::Invalid)?;
    let (authority_origin, guest_origin) =
        if setup.local.sender_seat_id == setup.local.authority_seat_id {
            (context_at(&setup.local, from_generation), context_at(&setup.peer, from_generation))
        } else {
            (context_at(&setup.peer, from_generation), context_at(&setup.local, from_generation))
        };
    Ok(CurrentCoopRebindBindingV1 {
        authority_target: target(&authority_origin)?,
        guest_target: target(&guest_origin)?,
        authority_origin,
        guest_origin,
        content: setup.content.clone(),
        seed: run.seed.clone(),
        mode: run.mode,
        started_digest: digest(setup.started.as_ref().ok_or(GameKernelV7Error::Invalid)?)?,
        frontier: CurrentCoopRebindFrontierV1 {
            run: run.run_id,
            next_authority_revision: snapshot.material_ledger.next_authority_revision,
            operation: last.operation_id.clone(),
            material_fingerprint: last.material_fingerprint.clone(),
            after_digest: game_state_digest(&state).map_err(|_| GameKernelV7Error::Invalid)?,
        },
    })
}

pub(super) fn validate_snapshot(snapshot: &CoreGameKernelSnapshotV7) -> Result<()> {
    let setup = snapshot
        .current_coop_setup
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    let owner = setup.rebind.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    let protocol = snapshot
        .protocol
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    owner.validate(snapshot.replay_sequence)?;
    validate_retired_reply(snapshot, owner)?;
    require_quiescent_protocol(protocol)?;
    require_quiescent_scheduler(protocol, &snapshot.scheduler)?;
    if snapshot.scheduler.disposed || owner.role != protocol.role {
        return Err(GameKernelV7Error::Invalid);
    }
    if owner.phase == CurrentCoopRebindPhaseV1::Open {
        validate_open_history(snapshot, owner)?;
    } else if snapshot.current_proposal.is_some()
        || !snapshot.pending_platform.is_empty()
        || !snapshot.input_router.pressed.is_empty()
        || !snapshot.input_router.held_buttons.is_empty()
        || !snapshot.input_router.repeats.is_empty()
        || owner.binding != binding(snapshot, owner.from_generation)?
    {
        return Err(GameKernelV7Error::Invalid);
    }
    let is_committed = committed(owner.role, owner.transcript.len());
    let local = if owner.role == EndpointRole::Authority {
        &owner.binding.authority_origin
    } else {
        &owner.binding.guest_origin
    };
    let peer = if owner.role == EndpointRole::Authority {
        &owner.binding.guest_origin
    } else {
        &owner.binding.authority_origin
    };
    let expected_local = if is_committed {
        target(local)?
    } else {
        local.clone()
    };
    let expected_peer = if is_committed {
        target(peer)?
    } else {
        peer.clone()
    };
    let [connection] = protocol.connections.as_slice() else {
        return Err(GameKernelV7Error::Invalid);
    };
    let expected_state = if is_committed && owner.candidate_connected {
        TransportState::Connected
    } else {
        TransportState::Disconnected
    };
    if context_at(&setup.local, owner.from_generation) != *local
        || context_at(&setup.peer, owner.from_generation) != *peer
        || protocol.frame_context.context != expected_local
        || protocol.peer_identity.local != expected_local
        || protocol.peer_identity.peer.as_ref() != Some(&expected_peer)
        || connection.state != expected_state
        || connection.peer_seat != expected_peer.sender_seat_id
        || connection.generation != expected_peer.connection_generation
    {
        return Err(GameKernelV7Error::Invalid);
    }
    let has_pause = |reason: &str| {
        snapshot.scheduler.pauses.iter().any(|pause| {
            pause.endpoint == local.sender_seat_id
                && pause.time_class == TimeClass::Connected
                && pause.reasons.iter().any(|value| value == reason)
        })
    };
    if has_pause(PAUSE) != (owner.phase != CurrentCoopRebindPhaseV1::Open)
        || has_pause("transport-disconnected")
            != !(owner.phase == CurrentCoopRebindPhaseV1::Open && owner.candidate_connected)
    {
        return Err(GameKernelV7Error::Invalid);
    }
    Ok(())
}

// One completed, nonrecursive owner authenticates a cached reply from an older
// generation. Repeated reconnects without gameplay preserve this same witness.
fn validate_retired_reply(
    snapshot: &CoreGameKernelSnapshotV7,
    current: &CurrentCoopRebindSnapshotV1,
) -> Result<()> {
    let setup = snapshot.current_coop_setup.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    let Some(retired) = &setup.retired_reply_rebind else {
        return Ok(());
    };
    retired.validate(snapshot.replay_sequence)?;
    if setup.last_reply_v2.is_none()
        || setup.last_reply.is_some()
        || current.role != EndpointRole::Authority
        || retired.role != EndpointRole::Authority
        || retired.phase != CurrentCoopRebindPhaseV1::Open
        || retired.to_generation > current.from_generation
        || retired.commit_replay_sequence.is_none_or(|sequence| sequence >= current.begin_replay_sequence)
        || retired.binding.authority_origin != context_at(&setup.local, retired.from_generation)
        || retired.binding.guest_origin != context_at(&setup.peer, retired.from_generation)
    {
        return Err(GameKernelV7Error::Invalid);
    }
    validate_open_history(snapshot, retired)
}

pub(super) fn receipt_owner(
    snapshot: &CoreGameKernelSnapshotV7,
) -> Result<&CurrentCoopRebindSnapshotV1> {
    let setup = snapshot.current_coop_setup.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    let owner = setup.retired_reply_rebind.as_ref().or(setup.rebind.as_ref())
        .ok_or(GameKernelV7Error::Invalid)?;
    if owner.role != EndpointRole::Authority || owner.phase != CurrentCoopRebindPhaseV1::Open {
        return Err(GameKernelV7Error::Invalid);
    }
    Ok(owner)
}

fn validate_open_history(
    snapshot: &CoreGameKernelSnapshotV7,
    owner: &CurrentCoopRebindSnapshotV1,
) -> Result<()> {
    let setup = snapshot
        .current_coop_setup
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    let state = match &snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Active(state)
        | GameKernelLifecycleSnapshotV7::Terminal { state, .. } => state,
        _ => return Err(GameKernelV7Error::Invalid),
    };
    let run = state
        .active_run
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    let frozen = &owner.binding.frontier;
    let revision = frozen
        .next_authority_revision
        .get()
        .checked_sub(1)
        .filter(|value| *value > 0)
        .ok_or(GameKernelV7Error::Invalid)?;
    if owner.binding.content != state.content_identity
        || owner.binding.content != setup.content
        || owner.binding.seed != run.seed
        || owner.binding.mode != run.mode
        || frozen.run != run.run_id
        || owner.binding.started_digest
            != digest(setup.started.as_ref().ok_or(GameKernelV7Error::Invalid)?)?
        || frozen.next_authority_revision > snapshot.material_ledger.next_authority_revision
    {
        return Err(GameKernelV7Error::Invalid);
    }
    // The transcript's canonical state digest is historical evidence. Local
    // menus may have moved even without a newer material; it is not the last
    // ledger record's after_digest. Check only the exact retained facts we have.
    let mut overlap = false;
    for record in &snapshot.material_ledger.records {
        if record.operation_id == frozen.operation || record.authority_revision.get() == revision {
            if record.operation_id != frozen.operation
                || record.authority_revision.get() != revision
                || record.material_fingerprint != frozen.material_fingerprint
            {
                return Err(GameKernelV7Error::Invalid);
            }
            overlap = true;
        }
    }
    let first = snapshot.material_ledger.records.first().map_or(
        snapshot.material_ledger.next_authority_revision.get(),
        |record| record.authority_revision.get(),
    );
    if revision >= first && !overlap {
        return Err(GameKernelV7Error::Invalid);
    }
    Ok(())
}

/// Explicit owned-current selector; malformed or partial owners never fall
/// through to the historical non-one-generation compatibility path.
pub(crate) fn validate_open_pair(
    snapshot: &CoreGameKernelSnapshotV7,
    local_seat: er_types::SeatId,
    role: EndpointRole,
    require_connected: bool,
) -> Result<()> {
    validate_snapshot(snapshot)?;
    let setup = snapshot
        .current_coop_setup
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    let owner = setup.rebind.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    let protocol = snapshot
        .protocol
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    if owner.phase != CurrentCoopRebindPhaseV1::Open
        || owner.role != role
        || (require_connected && !owner.candidate_connected)
    {
        return Err(GameKernelV7Error::Invalid);
    }
    let origin = origin_protocol(protocol)?;
    validate_current_pair_v1(&origin, local_seat, role, false)
        .map_err(|_| GameKernelV7Error::Invalid)
}

pub(crate) fn open_transaction_id(snapshot: &CoreGameKernelSnapshotV7) -> Result<String> {
    let protocol = snapshot
        .protocol
        .as_ref()
        .ok_or(GameKernelV7Error::Invalid)?;
    validate_open_pair(
        snapshot,
        protocol.frame_context.context.sender_seat_id,
        protocol.role,
        false,
    )?;
    snapshot
        .current_coop_setup
        .as_ref()
        .and_then(|setup| setup.rebind.as_ref())
        .and_then(|owner| owner.transcript.last())
        .and_then(|frame| frame.transaction_id.clone())
        .ok_or(GameKernelV7Error::Invalid)
}

impl GameKernelV7 {
    pub(super) fn has_current_coop_rebind(&self) -> bool {
        self.current_coop_setup
            .as_ref()
            .is_some_and(|owner| owner.rebind.is_some())
    }
    pub(super) fn require_current_rebind_gameplay(&self) -> Result<()> {
        if self.has_current_coop_rebind() {
            let snapshot = self.snapshot()?;
            let role = snapshot
                .protocol
                .as_ref()
                .ok_or(GameKernelV7Error::Invalid)?
                .role;
            validate_open_pair(&snapshot, self.local_seat, role, true)?;
        }
        Ok(())
    }
    fn rebind_owner(&self) -> Result<&CurrentCoopRebindSnapshotV1> {
        self.current_coop_setup
            .as_ref()
            .and_then(|owner| owner.rebind.as_deref())
            .ok_or(GameKernelV7Error::Invalid)
    }
    fn rebind_owner_mut(&mut self) -> Result<&mut CurrentCoopRebindSnapshotV1> {
        self.current_coop_setup
            .as_mut()
            .and_then(|owner| owner.rebind.as_deref_mut())
            .ok_or(GameKernelV7Error::Invalid)
    }
    fn rebind_pauses(&mut self) -> Result<()> {
        let owner = self.rebind_owner()?;
        let open = owner.phase == CurrentCoopRebindPhaseV1::Open;
        let connected = owner.candidate_connected;
        let mut scheduler = self
            .scheduler
            .clone()
            .into_scheduler()
            .map_err(|_| GameKernelV7Error::Invalid)?;
        for (reason, paused) in [
            (PAUSE, !open),
            ("transport-disconnected", !(open && connected)),
        ] {
            let _ = if paused {
                scheduler.pause_class(self.local_seat, TimeClass::Connected, reason)
            } else {
                scheduler.resume_class(self.local_seat, TimeClass::Connected, reason)
            }
            .map_err(|_| GameKernelV7Error::Invalid)?;
        }
        self.scheduler = KernelSchedulerSnapshotV2::from_scheduler(&scheduler)
            .map_err(|_| GameKernelV7Error::Invalid)?;
        Ok(())
    }

    pub fn begin_current_coop_rebind_v1(&mut self) -> Result<CurrentCoopRebindOutputV1> {
        if self.has_current_coop_rebind() {
            let owner = self.rebind_owner()?;
            if owner.phase != CurrentCoopRebindPhaseV1::Open || owner.candidate_connected {
                return self.retry_current_coop_rebind_v1();
            }
        }
        let before = self.snapshot()?;
        let setup = before
            .current_coop_setup
            .as_ref()
            .ok_or(GameKernelV7Error::Invalid)?;
        let protocol = before.protocol.as_ref().ok_or(GameKernelV7Error::Invalid)?;
        if setup.rebind.is_some() {
            validate_open_pair(&before, self.local_seat, protocol.role, false)?;
        } else {
            validate_current_pair_v1(protocol, self.local_seat, protocol.role, false)
                .map_err(|_| GameKernelV7Error::Invalid)?;
        }
        require_quiescent_protocol(protocol)?;
        require_quiescent_scheduler(protocol, &before.scheduler)?;
        let [connection] = protocol.connections.as_slice() else {
            return Err(GameKernelV7Error::Invalid);
        };
        if connection.state != TransportState::Disconnected
            || setup.started.is_none()
            || before.current_proposal.is_some()
            || !before.pending_platform.is_empty()
            || !before.input_router.pressed.is_empty()
            || !before.input_router.held_buttons.is_empty()
            || !before.input_router.repeats.is_empty()
            || before.scheduler.disposed
        {
            return Err(GameKernelV7Error::Invalid);
        }
        let mut owner = CurrentCoopRebindSnapshotV1 {
            schema_version: 1,
            role: protocol.role,
            phase: if protocol.role == EndpointRole::Authority {
                CurrentCoopRebindPhaseV1::AwaitJoin
            } else {
                CurrentCoopRebindPhaseV1::AwaitOffer
            },
            from_generation: protocol.frame_context.context.connection_generation,
            to_generation: ConnectionGeneration::new(checked_next(protocol.frame_context.context.connection_generation.get())?),
            binding: binding(&before, protocol.frame_context.context.connection_generation)?,
            begin_replay_sequence: checked_next(before.replay_sequence)?,
            commit_replay_sequence: None,
            candidate_connected: false,
            transcript: Vec::new(),
        };
        if protocol.role == EndpointRole::Authority {
            owner.transcript.push(owner.next_control()?);
        }
        let mut candidate = self.clone();
        let setup = candidate.current_coop_setup.as_mut().ok_or(GameKernelV7Error::Invalid)?;
        if setup.last_reply_v2.is_some() && setup.retired_reply_rebind.is_none() {
            setup.retired_reply_rebind = setup.rebind.clone();
        }
        setup.rebind = Some(Box::new(owner));
        candidate.advance_replay_sequence()?;
        candidate.rebind_pauses()?;
        candidate.validate()?;
        let output = candidate.rebind_owner()?.output()?;
        *self = candidate;
        Ok(output)
    }

    pub fn retry_current_coop_rebind_v1(&self) -> Result<CurrentCoopRebindOutputV1> {
        self.validate()?;
        self.rebind_owner()?.output()
    }

    pub(super) fn current_rebind_transport_changed(
        &mut self,
        value: ConnectionGeneration,
        connected: bool,
    ) -> Result<()> {
        if value != self.rebind_owner()?.to_generation {
            return Err(GameKernelV7Error::Invalid);
        }
        if self.rebind_owner()?.candidate_connected == connected {
            return Ok(());
        }
        let mut candidate = self.clone();
        candidate.rebind_owner_mut()?.candidate_connected = connected;
        let owner = candidate.rebind_owner()?;
        if committed(owner.role, owner.transcript.len()) {
            set_generation(
                candidate
                    .protocol
                    .as_mut()
                    .ok_or(GameKernelV7Error::Invalid)?,
                value,
                connected,
            )?;
        }
        candidate.advance_replay_sequence()?;
        candidate.rebind_pauses()?;
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    pub fn receive_current_coop_rebind_v1(
        &mut self,
        value: ConnectionGeneration,
        bytes: &[u8],
    ) -> Result<CurrentCoopRebindOutputV1> {
        if value != self.rebind_owner()?.to_generation
            || bytes.is_empty()
            || bytes.len() > MAX_CURRENT_REBIND_FRAME_BYTES_V1
            || !self.rebind_owner()?.candidate_connected
        {
            return Err(GameKernelV7Error::Invalid);
        }
        let frame: CurrentCoopRebindControlV1 =
            serde_json::from_slice(bytes).map_err(|_| GameKernelV7Error::Invalid)?;
        if bounded(&frame, MAX_CURRENT_REBIND_FRAME_BYTES_V1)? != bytes {
            return Err(GameKernelV7Error::Invalid);
        }
        let owner = self.rebind_owner()?;
        if let Some(index) = owner.transcript.iter().position(|prior| prior == &frame) {
            if frame.sender.sender_seat_id == self.local_seat {
                return Err(GameKernelV7Error::Invalid);
            }
            return owner.receive_response(index);
        }
        let index = owner.transcript.len();
        if messages().get(index) != Some(&frame.message)
            || frame.sender.sender_seat_id == self.local_seat
        {
            return Err(GameKernelV7Error::Invalid);
        }
        let mut candidate = self.clone();
        let event_sequence = checked_next(candidate.replay_sequence)?;
        let owner = candidate.rebind_owner_mut()?;
        owner.transcript.push(frame);
        if owner.transcript.len() < 8 {
            let response = owner.next_control()?;
            owner.transcript.push(response);
        }
        owner.phase = phase(owner.role, owner.transcript.len())?;
        if committed(owner.role, owner.transcript.len()) && owner.commit_replay_sequence.is_none() {
            owner.commit_replay_sequence = Some(event_sequence);
            set_generation(
                candidate
                    .protocol
                    .as_mut()
                    .ok_or(GameKernelV7Error::Invalid)?,
                value,
                true,
            )?;
        }
        candidate.advance_replay_sequence()?;
        candidate.rebind_pauses()?;
        candidate.validate()?;
        let output = candidate.rebind_owner()?.receive_response(index)?;
        *self = candidate;
        Ok(output)
    }
}
