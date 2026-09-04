//! Current worker transactions prepare complete bounded responses before committing.

use std::sync::Arc;

use er_env::current::{CurrentGameSession, CurrentSessionError};
use er_game::m9e_content_v2::PreparedGameContentV2;
use er_kernel::game_kernel_v7::GameKernelRoleV7;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_types::SeatId;
use thiserror::Error;

use crate::protocol_v2::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelWorkerFaultCodeV2,
    KernelWorkerFaultV2, KernelWorkerHealthV2, KernelWorkerInitializationV2,
    KernelWorkerProtocolErrorV2, KernelWorkerRequestEnvelopeV2, KernelWorkerRequestV2,
    KernelWorkerResponseEnvelopeV2, KernelWorkerResponseV2, MAXIMUM_SNAPSHOT_BYTES_V2,
    MAXIMUM_WORKER_FRAME_BYTES_V2,
};

#[derive(Debug, Error)]
pub enum KernelWorkerRuntimeErrorV2 {
    #[error(transparent)]
    Protocol(#[from] KernelWorkerProtocolErrorV2),
    #[error(transparent)]
    Session(#[from] CurrentSessionError),
    #[error("current worker has not initialized a session")]
    NotInitialized,
    #[error("current worker already has an initialized session")]
    AlreadyInitialized,
    #[error("current worker content was rejected: {0}")]
    Content(String),
    #[error("current worker snapshot was rejected: {0}")]
    Snapshot(String),
    #[error("current worker response exceeds its bound")]
    ResponseTooLarge,
    #[error("current worker serialization failed: {0}")]
    Serialization(String),
    #[error("current causal repro export is not implemented")]
    Unsupported,
    #[error("current worker is disposed")]
    Disposed,
    #[error("current worker applied-event counter exhausted")]
    Exhausted,
}

#[derive(Debug)]
pub struct KernelWorkerRuntimeV2 {
    identity: KernelGenerationIdentityV2,
    content: Option<Arc<PreparedGameContentV2>>,
    session: Option<CurrentGameSession>,
    accepted_sequence: Option<u64>,
    applied_events: u64,
    disposed: bool,
}

impl KernelWorkerRuntimeV2 {
    pub fn new(identity: KernelGenerationIdentityV2) -> Result<Self, KernelWorkerRuntimeErrorV2> {
        identity.validate()?;
        Ok(Self {
            identity,
            content: None,
            session: None,
            accepted_sequence: None,
            applied_events: 0,
            disposed: false,
        })
    }

    pub fn identity(&self) -> &KernelGenerationIdentityV2 {
        &self.identity
    }

    pub fn is_disposed(&self) -> bool {
        self.disposed
    }

    /// Returns fully serialized JSON for the shared length-prefixed frame transport.
    /// Faults preserve the last accepted sequence and the complete current session.
    pub fn handle_bytes(
        &mut self,
        envelope: KernelWorkerRequestEnvelopeV2,
    ) -> Result<Vec<u8>, KernelWorkerRuntimeErrorV2> {
        let request_id = envelope.request_id;
        let sequence = envelope.sequence;
        match self.handle_checked(envelope) {
            Ok(bytes) => {
                self.accepted_sequence = Some(sequence);
                Ok(bytes)
            }
            Err(error) => {
                let digest = self.observation_digest()?;
                encode_response(
                    &self.identity,
                    request_id,
                    self.accepted_sequence,
                    digest,
                    KernelWorkerResponseV2::Fault(KernelWorkerFaultV2 {
                        code: error_code(&error),
                        message: error.to_string().chars().take(1_024).collect(),
                        retryable: false,
                    }),
                )
            }
        }
    }

    fn handle_checked(
        &mut self,
        envelope: KernelWorkerRequestEnvelopeV2,
    ) -> Result<Vec<u8>, KernelWorkerRuntimeErrorV2> {
        envelope.validate_for(&self.identity, self.accepted_sequence)?;
        if self.disposed {
            return Err(KernelWorkerRuntimeErrorV2::Disposed);
        }
        let request_id = envelope.request_id;
        let accepted = Some(envelope.sequence);
        match envelope.request {
            KernelWorkerRequestV2::Hello => encode_response(
                &self.identity, request_id, accepted, self.observation_digest()?,
                KernelWorkerResponseV2::Ready(Box::new(self.identity.clone())),
            ),
            KernelWorkerRequestV2::Initialize { content_bundle, initialization } => {
                if self.session.is_some() {
                    return Err(KernelWorkerRuntimeErrorV2::AlreadyInitialized);
                }
                let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(*content_bundle))
                    .map_err(|error| KernelWorkerRuntimeErrorV2::Content(error.to_string()))?);
                if content.identity() != &self.identity.content_identity {
                    return Err(KernelWorkerRuntimeErrorV2::Content("generation content identity differs".to_owned()));
                }
                let session = match *initialization {
                    KernelWorkerInitializationV2::Natural {
                        profile, seed, local_seat, save_slots, local_is_host, scheduler, protocol,
                    } => CurrentGameSession::natural_start_with_scheduler(
                        profile, seed, local_seat, save_slots, local_is_host,
                        Arc::clone(&content), scheduler, protocol,
                    )?,
                    KernelWorkerInitializationV2::Snapshot { snapshot_bytes, local_seat, role } => {
                        restored(&snapshot_bytes, local_seat, role, Arc::clone(&content))?
                    }
                };
                let observation = session.observe()?;
                let bytes = encode_response(
                    &self.identity, request_id, accepted, observation.mechanical_digest.clone(),
                    KernelWorkerResponseV2::Initialized { observation: Box::new(observation) },
                )?;
                self.session = Some(session);
                self.content = Some(content);
                Ok(bytes)
            }
            KernelWorkerRequestV2::Restore { snapshot_bytes, local_seat, role } => {
                let content = self.content.as_ref().ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)?;
                let session = restored(&snapshot_bytes, local_seat, role, Arc::clone(content))?;
                let observation = session.observe()?;
                let bytes = encode_response(
                    &self.identity, request_id, accepted, observation.mechanical_digest.clone(),
                    KernelWorkerResponseV2::Restored { observation: Box::new(observation) },
                )?;
                self.session = Some(session);
                Ok(bytes)
            }
            KernelWorkerRequestV2::Apply(event) => {
                let next_count = self.applied_events.checked_add(1)
                    .ok_or(KernelWorkerRuntimeErrorV2::Exhausted)?;
                let identity = &self.identity;
                let bytes = self.session.as_mut().ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)?
                    .apply_with(event, |candidate, step| {
                        let observation = candidate.observe()?;
                        encode_response(
                            identity, request_id, accepted, observation.mechanical_digest.clone(),
                            KernelWorkerResponseV2::Effects { step, observation: Box::new(observation) },
                        )
                    })?;
                self.applied_events = next_count;
                Ok(bytes)
            }
            KernelWorkerRequestV2::Observe => {
                let observation = self.session()?.observe()?;
                encode_response(
                    &self.identity, request_id, accepted, observation.mechanical_digest.clone(),
                    KernelWorkerResponseV2::Observation(Box::new(observation)),
                )
            }
            KernelWorkerRequestV2::Snapshot => {
                let snapshot = self.session()?.snapshot()?;
                let snapshot_bytes = serde_json::to_vec(&snapshot).map_err(serialization)?;
                if snapshot_bytes.len() > MAXIMUM_SNAPSHOT_BYTES_V2 {
                    return Err(KernelWorkerRuntimeErrorV2::ResponseTooLarge);
                }
                encode_response(
                    &self.identity, request_id, accepted, self.observation_digest()?,
                    KernelWorkerResponseV2::Snapshot { snapshot: Box::new(snapshot) },
                )
            }
            KernelWorkerRequestV2::ExportRepro => Err(KernelWorkerRuntimeErrorV2::Unsupported),
            KernelWorkerRequestV2::Health => encode_response(
                &self.identity, request_id, accepted, self.observation_digest()?,
                KernelWorkerResponseV2::Health(KernelWorkerHealthV2 {
                    initialized: self.session.is_some(),
                    disposed: self.disposed,
                    accepted_sequence: accepted,
                    applied_events: self.applied_events,
                    prepared_content_retained: self.content.is_some(),
                }),
            ),
            KernelWorkerRequestV2::Dispose => {
                let bytes = encode_response(
                    &self.identity, request_id, accepted, None, KernelWorkerResponseV2::Disposed,
                )?;
                if let Some(session) = &mut self.session {
                    session.dispose();
                }
                self.session = None;
                self.content = None;
                self.disposed = true;
                Ok(bytes)
            }
        }
    }

    fn session(&self) -> Result<&CurrentGameSession, KernelWorkerRuntimeErrorV2> {
        self.session.as_ref().ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)
    }

    fn observation_digest(&self) -> Result<Option<String>, KernelWorkerRuntimeErrorV2> {
        Ok(self.session.as_ref().map(CurrentGameSession::observe).transpose()?
            .and_then(|observation| observation.mechanical_digest))
    }
}

fn restored(
    bytes: &[u8],
    local_seat: SeatId,
    role: GameKernelRoleV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<CurrentGameSession, KernelWorkerRuntimeErrorV2> {
    if bytes.is_empty() || bytes.len() > MAXIMUM_SNAPSHOT_BYTES_V2 {
        return Err(KernelWorkerRuntimeErrorV2::Snapshot("snapshot byte bound".to_owned()));
    }
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| KernelWorkerRuntimeErrorV2::Snapshot(error.to_string()))?;
    if value.get("schema_version").and_then(serde_json::Value::as_u64) != Some(7) {
        return Err(KernelWorkerRuntimeErrorV2::Snapshot("current worker requires V7; use explicit ABI1 for V6".to_owned()));
    }
    let snapshot: CoreGameKernelSnapshotV7 = serde_json::from_value(value)
        .map_err(|error| KernelWorkerRuntimeErrorV2::Snapshot(error.to_string()))?;
    CurrentGameSession::from_snapshot(snapshot, local_seat, role, content)
        .map_err(|error| KernelWorkerRuntimeErrorV2::Snapshot(error.to_string()))
}

fn encode_response(
    identity: &KernelGenerationIdentityV2,
    request_id: u64,
    accepted_sequence: Option<u64>,
    after_mechanical_digest: Option<String>,
    response: KernelWorkerResponseV2,
) -> Result<Vec<u8>, KernelWorkerRuntimeErrorV2> {
    let bytes = serde_json::to_vec(&KernelWorkerResponseEnvelopeV2 {
        abi_version: KERNEL_WORKER_ABI_VERSION_V2,
        session_id: identity.session_id.clone(),
        generation: identity.generation,
        request_id,
        accepted_sequence,
        after_mechanical_digest,
        response,
    }).map_err(serialization)?;
    if bytes.len() > MAXIMUM_WORKER_FRAME_BYTES_V2 {
        return Err(KernelWorkerRuntimeErrorV2::ResponseTooLarge);
    }
    Ok(bytes)
}

fn serialization(error: impl ToString) -> KernelWorkerRuntimeErrorV2 {
    KernelWorkerRuntimeErrorV2::Serialization(error.to_string())
}

fn error_code(error: &KernelWorkerRuntimeErrorV2) -> KernelWorkerFaultCodeV2 {
    match error {
        KernelWorkerRuntimeErrorV2::Protocol(_) => KernelWorkerFaultCodeV2::ProtocolViolation,
        KernelWorkerRuntimeErrorV2::Session(_) => KernelWorkerFaultCodeV2::KernelFailure,
        KernelWorkerRuntimeErrorV2::NotInitialized => KernelWorkerFaultCodeV2::NotInitialized,
        KernelWorkerRuntimeErrorV2::AlreadyInitialized => KernelWorkerFaultCodeV2::AlreadyInitialized,
        KernelWorkerRuntimeErrorV2::Content(_) => KernelWorkerFaultCodeV2::ContentRejected,
        KernelWorkerRuntimeErrorV2::Snapshot(_) => KernelWorkerFaultCodeV2::SnapshotRejected,
        KernelWorkerRuntimeErrorV2::ResponseTooLarge => KernelWorkerFaultCodeV2::ResponseTooLarge,
        KernelWorkerRuntimeErrorV2::Serialization(_) => KernelWorkerFaultCodeV2::SerializationFailure,
        KernelWorkerRuntimeErrorV2::Unsupported => KernelWorkerFaultCodeV2::UnsupportedOperation,
        KernelWorkerRuntimeErrorV2::Disposed => KernelWorkerFaultCodeV2::Disposed,
        KernelWorkerRuntimeErrorV2::Exhausted => KernelWorkerFaultCodeV2::ResourceExhausted,
    }
}
