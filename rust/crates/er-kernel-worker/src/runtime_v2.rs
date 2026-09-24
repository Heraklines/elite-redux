//! Current worker transactions prepare complete bounded responses before committing.

use std::sync::Arc;

use er_env::current::{CurrentGameSession, CurrentSessionError};
use er_game::m9e_content_v2::PreparedGameContentV2;
use er_kernel::game_kernel_v7::GameKernelRoleV7;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_repro::current::{
    CurrentCaptureStatusV1, CurrentReproLimitsV1, CurrentReproRecorderV1,
    MAXIMUM_CURRENT_REPRO_POSITION_V1,
};
use er_types::SeatId;
use thiserror::Error;

use crate::protocol_v2::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelWorkerFaultCodeV2,
    KernelWorkerFaultV2, KernelWorkerHealthV2, KernelWorkerInitializationV2,
    KernelWorkerProtocolErrorV2, KernelWorkerRequestEnvelopeV2, KernelWorkerRequestV2,
    KernelWorkerResponseEnvelopeV2, KernelWorkerResponseV2, MAXIMUM_SNAPSHOT_BYTES_V2,
    MAXIMUM_WORKER_FRAME_BYTES_V2, validate_success_response_bytes_v2,
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
    #[error("current causal repro is unavailable: {0}")]
    Repro(String),
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
    capture: Option<CurrentReproRecorderV1>,
    accepted_sequence: Option<u64>,
    applied_events: u64,
    disposed: bool,
    maximum_success_response_bytes: usize,
}

impl KernelWorkerRuntimeV2 {
    pub fn new(identity: KernelGenerationIdentityV2) -> Result<Self, KernelWorkerRuntimeErrorV2> {
        Self::with_success_response_limit(identity, MAXIMUM_WORKER_FRAME_BYTES_V2)
    }

    pub fn with_success_response_limit(
        identity: KernelGenerationIdentityV2,
        maximum_success_response_bytes: usize,
    ) -> Result<Self, KernelWorkerRuntimeErrorV2> {
        identity.validate()?;
        validate_success_response_bytes_v2(maximum_success_response_bytes)?;
        Ok(Self {
            identity,
            content: None,
            session: None,
            capture: None,
            accepted_sequence: None,
            applied_events: 0,
            disposed: false,
            maximum_success_response_bytes,
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
                    MAXIMUM_WORKER_FRAME_BYTES_V2,
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
                &self.identity,
                request_id,
                accepted,
                self.observation_digest()?,
                KernelWorkerResponseV2::Ready(Box::new(self.identity.clone())),
                self.maximum_success_response_bytes,
            ),
            KernelWorkerRequestV2::Initialize {
                content_bundle,
                initialization,
            } => {
                if self.session.is_some() {
                    return Err(KernelWorkerRuntimeErrorV2::AlreadyInitialized);
                }
                let content = Arc::new(
                    PreparedGameContentV2::prepare(Arc::new(*content_bundle))
                        .map_err(|error| KernelWorkerRuntimeErrorV2::Content(error.to_string()))?,
                );
                if content.identity() != &self.identity.content_identity {
                    return Err(KernelWorkerRuntimeErrorV2::Content(
                        "generation content identity differs".to_owned(),
                    ));
                }
                let (session, capture) = match *initialization {
                    KernelWorkerInitializationV2::Natural {
                        profile,
                        seed,
                        local_seat,
                        save_slots,
                        local_is_host,
                        scheduler,
                        protocol,
                    } => {
                        let session = CurrentGameSession::natural_start_with_scheduler(
                            *profile,
                            seed,
                            local_seat,
                            save_slots,
                            local_is_host,
                            Arc::clone(&content),
                            scheduler,
                            *protocol,
                        )?;
                        let capture = capture_for_session(&session, 0).ok();
                        (session, capture)
                    }
                    KernelWorkerInitializationV2::Snapshot {
                        snapshot_bytes,
                        local_seat,
                        role,
                    } => {
                        let session =
                            restored(&snapshot_bytes, local_seat, role, Arc::clone(&content))?;
                        let capture = capture_for_session(&session, 0).ok();
                        (session, capture)
                    }
                };
                let observation = session.observe()?;
                let bytes = encode_response(
                    &self.identity,
                    request_id,
                    accepted,
                    observation.mechanical_digest.clone(),
                    KernelWorkerResponseV2::Initialized {
                        observation: Box::new(observation),
                    },
                    self.maximum_success_response_bytes,
                )?;
                self.capture = capture;
                self.session = Some(session);
                self.content = Some(content);
                Ok(bytes)
            }
            KernelWorkerRequestV2::Restore {
                snapshot_bytes,
                local_seat,
                role,
            } => {
                let content = self
                    .content
                    .as_ref()
                    .ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)?;
                let session = restored(&snapshot_bytes, local_seat, role, Arc::clone(content))?;
                let observation = session.observe()?;
                let bytes = encode_response(
                    &self.identity,
                    request_id,
                    accepted,
                    observation.mechanical_digest.clone(),
                    KernelWorkerResponseV2::Restored {
                        observation: Box::new(observation),
                    },
                    self.maximum_success_response_bytes,
                )?;
                let next_position = self.capture.as_ref().and_then(|capture| {
                    let position = match capture.status() {
                        CurrentCaptureStatusV1::Available { final_position, .. } => final_position,
                        CurrentCaptureStatusV1::Unavailable { position, .. } => position,
                    };
                    position
                        .checked_add(1)
                        .filter(|value| *value <= MAXIMUM_CURRENT_REPRO_POSITION_V1)
                });
                self.capture =
                    next_position.and_then(|position| capture_for_session(&session, position).ok());
                self.session = Some(session);
                Ok(bytes)
            }
            KernelWorkerRequestV2::ImportRepro { capsule } => {
                let content = self
                    .content
                    .as_ref()
                    .ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)?;
                let browser_origin = capsule.browser_transport.is_some();
                let position = capsule.final_position;
                let (recorder, session) = CurrentReproRecorderV1::from_capsule(
                    *capsule,
                    Arc::clone(content),
                    CurrentReproLimitsV1::default(),
                )
                .map_err(|error| KernelWorkerRuntimeErrorV2::Repro(error.to_string()))?;
                let capture = if browser_origin {
                    capture_for_session(&session, position).ok()
                } else {
                    Some(recorder)
                };
                let observation = session.observe()?;
                let bytes = encode_response(
                    &self.identity,
                    request_id,
                    accepted,
                    observation.mechanical_digest.clone(),
                    KernelWorkerResponseV2::Restored {
                        observation: Box::new(observation),
                    },
                    self.maximum_success_response_bytes,
                )?;
                self.capture = capture;
                self.session = Some(session);
                Ok(bytes)
            }
            KernelWorkerRequestV2::Apply(event) => {
                let next_count = self
                    .applied_events
                    .checked_add(1)
                    .ok_or(KernelWorkerRuntimeErrorV2::Exhausted)?;
                let before = if self.capture.is_some() {
                    self.session()?.snapshot().ok()
                } else {
                    None
                };
                if before.is_none()
                    && let Some(capture) = &mut self.capture
                {
                    capture.invalidate_attempt("worker pre-event snapshot unavailable");
                }
                let identity = &self.identity;
                let maximum_success_response_bytes = self.maximum_success_response_bytes;
                let result = self
                    .session
                    .as_mut()
                    .ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)?
                    .apply_with(event.clone(), |candidate, step| {
                        let observation = candidate.observe().map_err(serialization)?;
                        let recorded = before
                            .is_some()
                            .then(|| (step.clone(), observation.clone()));
                        let bytes = encode_response(
                            identity,
                            request_id,
                            accepted,
                            observation.mechanical_digest.clone(),
                            KernelWorkerResponseV2::Effects {
                                step,
                                observation: Box::new(observation),
                            },
                            maximum_success_response_bytes,
                        )?;
                        Ok((bytes, recorded))
                    });
                let (bytes, recorded) = match result {
                    Ok(value) => value,
                    Err(error) => {
                        if let (Some(before), Some(capture)) = (&before, &mut self.capture) {
                            if let KernelWorkerRuntimeErrorV2::Session(rejected) = &error {
                                if let Ok(observation) = self
                                    .session
                                    .as_ref()
                                    .ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)?
                                    .observe()
                                {
                                    capture.record_with_origin(
                                        before,
                                        event,
                                        Err(rejected),
                                        before,
                                        &observation,
                                        Some("worker.apply"),
                                    );
                                } else {
                                    capture.invalidate_attempt(
                                        "worker rejection observation unavailable",
                                    );
                                }
                            } else {
                                capture.invalidate_attempt("worker response preparation rejected");
                            }
                        }
                        return Err(error);
                    }
                };
                if let (Some(before), Some((step, observation)), Some(capture)) =
                    (&before, recorded, &mut self.capture)
                {
                    if let Ok(after) = self
                        .session
                        .as_ref()
                        .ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)?
                        .snapshot()
                    {
                        capture.record_with_origin(
                            before,
                            event,
                            Ok(&step),
                            &after,
                            &observation,
                            Some("worker.apply"),
                        );
                    } else {
                        capture.invalidate_attempt("worker post-event snapshot unavailable");
                    }
                }
                self.applied_events = next_count;
                Ok(bytes)
            }
            KernelWorkerRequestV2::ApplyRebind {
                control,
                maximum_inline_result_bytes,
            } => {
                if maximum_inline_result_bytes > self.maximum_success_response_bytes {
                    return Err(KernelWorkerRuntimeErrorV2::ResponseTooLarge);
                }
                let next_count = self
                    .applied_events
                    .checked_add(1)
                    .ok_or(KernelWorkerRuntimeErrorV2::Exhausted)?;
                let before = if self.capture.is_some() {
                    self.session()?.snapshot().ok()
                } else {
                    None
                };
                if before.is_none()
                    && let Some(capture) = &mut self.capture
                {
                    capture.invalidate_attempt("worker pre-rebind snapshot unavailable");
                }
                let identity = &self.identity;
                let maximum_success_response_bytes = self.maximum_success_response_bytes;
                let result = self
                    .session
                    .as_mut()
                    .ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)?
                    .apply_rebind_with(control.clone(), |candidate, output| {
                        let observation = candidate.observe().map_err(serialization)?;
                        let recorded = before
                            .is_some()
                            .then(|| (output.clone(), observation.clone()));
                        let result =
                            serde_json::json!({"rebind": &output, "observation": &observation});
                        if serde_json::to_vec(&result).map_err(serialization)?.len()
                            > maximum_inline_result_bytes
                        {
                            return Err(KernelWorkerRuntimeErrorV2::ResponseTooLarge);
                        }
                        let bytes = encode_response(
                            identity,
                            request_id,
                            accepted,
                            observation.mechanical_digest.clone(),
                            KernelWorkerResponseV2::RebindEffects {
                                output,
                                observation: Box::new(observation),
                            },
                            maximum_success_response_bytes,
                        )?;
                        Ok((bytes, recorded))
                    });
                let (bytes, recorded) = match result {
                    Ok(value) => value,
                    Err(error) => {
                        if let (Some(before), Some(capture)) = (&before, &mut self.capture) {
                            if let KernelWorkerRuntimeErrorV2::Session(rejected) = &error {
                                if let Ok(observation) = self
                                    .session
                                    .as_ref()
                                    .ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)?
                                    .observe()
                                {
                                    capture.record_rebind_with_origin(
                                        before,
                                        control,
                                        Err(rejected),
                                        before,
                                        &observation,
                                        Some("worker.apply_rebind"),
                                    );
                                } else {
                                    capture.invalidate_attempt(
                                        "worker rebind rejection observation unavailable",
                                    );
                                }
                            } else {
                                capture.invalidate_attempt(
                                    "worker rebind response preparation rejected",
                                );
                            }
                        }
                        return Err(error);
                    }
                };
                if let (Some(before), Some((output, observation)), Some(capture)) =
                    (&before, recorded, &mut self.capture)
                {
                    if let Ok(after) = self
                        .session
                        .as_ref()
                        .ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)?
                        .snapshot()
                    {
                        capture.record_rebind_with_origin(
                            before,
                            control,
                            Ok(&output),
                            &after,
                            &observation,
                            Some("worker.apply_rebind"),
                        );
                    } else {
                        capture.invalidate_attempt("worker post-rebind snapshot unavailable");
                    }
                }
                self.applied_events = next_count;
                Ok(bytes)
            }
            KernelWorkerRequestV2::Observe => {
                let observation = self.session()?.observe()?;
                encode_response(
                    &self.identity,
                    request_id,
                    accepted,
                    observation.mechanical_digest.clone(),
                    KernelWorkerResponseV2::Observation(Box::new(observation)),
                    self.maximum_success_response_bytes,
                )
            }
            KernelWorkerRequestV2::Snapshot => {
                let snapshot = self.session()?.snapshot()?;
                let snapshot_bytes = serde_json::to_vec(&snapshot).map_err(serialization)?;
                if snapshot_bytes.len() > MAXIMUM_SNAPSHOT_BYTES_V2 {
                    return Err(KernelWorkerRuntimeErrorV2::ResponseTooLarge);
                }
                encode_response(
                    &self.identity,
                    request_id,
                    accepted,
                    self.observation_digest()?,
                    KernelWorkerResponseV2::Snapshot {
                        snapshot: Box::new(snapshot),
                    },
                    self.maximum_success_response_bytes,
                )
            }
            KernelWorkerRequestV2::ExportRepro => {
                let capsule = self
                    .capture
                    .as_ref()
                    .ok_or_else(|| {
                        KernelWorkerRuntimeErrorV2::Repro("recorder unavailable".to_owned())
                    })?
                    .export()
                    .map_err(|error| KernelWorkerRuntimeErrorV2::Repro(error.to_string()))?;
                encode_response(
                    &self.identity,
                    request_id,
                    accepted,
                    self.observation_digest()?,
                    KernelWorkerResponseV2::Repro {
                        capsule: Box::new(capsule),
                    },
                    self.maximum_success_response_bytes,
                )
            }
            KernelWorkerRequestV2::Health => encode_response(
                &self.identity,
                request_id,
                accepted,
                self.observation_digest()?,
                KernelWorkerResponseV2::Health(KernelWorkerHealthV2 {
                    initialized: self.session.is_some(),
                    disposed: self.disposed,
                    accepted_sequence: accepted,
                    applied_events: self.applied_events,
                    prepared_content_retained: self.content.is_some(),
                }),
                self.maximum_success_response_bytes,
            ),
            KernelWorkerRequestV2::Dispose => {
                let bytes = encode_response(
                    &self.identity,
                    request_id,
                    accepted,
                    None,
                    KernelWorkerResponseV2::Disposed,
                    self.maximum_success_response_bytes,
                )?;
                if let Some(session) = &mut self.session {
                    session.dispose();
                }
                self.session = None;
                self.capture = None;
                self.content = None;
                self.disposed = true;
                Ok(bytes)
            }
        }
    }

    fn session(&self) -> Result<&CurrentGameSession, KernelWorkerRuntimeErrorV2> {
        self.session
            .as_ref()
            .ok_or(KernelWorkerRuntimeErrorV2::NotInitialized)
    }

    fn observation_digest(&self) -> Result<Option<String>, KernelWorkerRuntimeErrorV2> {
        Ok(self
            .session
            .as_ref()
            .map(CurrentGameSession::observe)
            .transpose()?
            .and_then(|observation| observation.mechanical_digest))
    }
}

fn capture_for_session(
    session: &CurrentGameSession,
    position: u64,
) -> Result<CurrentReproRecorderV1, KernelWorkerRuntimeErrorV2> {
    let (seat, role) = session.session_context()?;
    CurrentReproRecorderV1::new_at_position(
        session.snapshot()?,
        seat,
        role,
        Arc::clone(session.content()),
        CurrentReproLimitsV1::default(),
        position,
    )
    .map_err(|error| KernelWorkerRuntimeErrorV2::Repro(error.to_string()))
}

fn restored(
    bytes: &[u8],
    local_seat: SeatId,
    role: GameKernelRoleV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<CurrentGameSession, KernelWorkerRuntimeErrorV2> {
    if bytes.is_empty() || bytes.len() > MAXIMUM_SNAPSHOT_BYTES_V2 {
        return Err(KernelWorkerRuntimeErrorV2::Snapshot(
            "snapshot byte bound".to_owned(),
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| KernelWorkerRuntimeErrorV2::Snapshot(error.to_string()))?;
    if value
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        != Some(7)
    {
        return Err(KernelWorkerRuntimeErrorV2::Snapshot(
            "current worker requires V7; use explicit ABI1 for V6".to_owned(),
        ));
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
    maximum_response_bytes: usize,
) -> Result<Vec<u8>, KernelWorkerRuntimeErrorV2> {
    let bytes = serde_json::to_vec(&KernelWorkerResponseEnvelopeV2 {
        abi_version: KERNEL_WORKER_ABI_VERSION_V2,
        session_id: identity.session_id.clone(),
        generation: identity.generation,
        request_id,
        accepted_sequence,
        after_mechanical_digest,
        response,
    })
    .map_err(serialization)?;
    if bytes.len() > maximum_response_bytes {
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
        KernelWorkerRuntimeErrorV2::AlreadyInitialized => {
            KernelWorkerFaultCodeV2::AlreadyInitialized
        }
        KernelWorkerRuntimeErrorV2::Content(_) => KernelWorkerFaultCodeV2::ContentRejected,
        KernelWorkerRuntimeErrorV2::Snapshot(_) => KernelWorkerFaultCodeV2::SnapshotRejected,
        KernelWorkerRuntimeErrorV2::ResponseTooLarge => KernelWorkerFaultCodeV2::ResponseTooLarge,
        KernelWorkerRuntimeErrorV2::Serialization(_) => {
            KernelWorkerFaultCodeV2::SerializationFailure
        }
        KernelWorkerRuntimeErrorV2::Unsupported => KernelWorkerFaultCodeV2::UnsupportedOperation,
        KernelWorkerRuntimeErrorV2::Repro(_) => KernelWorkerFaultCodeV2::KernelFailure,
        KernelWorkerRuntimeErrorV2::Disposed => KernelWorkerFaultCodeV2::Disposed,
        KernelWorkerRuntimeErrorV2::Exhausted => KernelWorkerFaultCodeV2::ResourceExhausted,
    }
}
