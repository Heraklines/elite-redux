use std::sync::Arc;

use er_env::GameEnvironment;
use er_game::m7_content::{GameContentBundleV1, PreparedGameContentV1};
use er_kernel::snapshot_v6::{ExternalTraceInputV6, RestorableKernelSnapshotV6};
use serde_json::json;
use thiserror::Error;

use crate::protocol::{
    GenerationReproCapsuleV1, GenerationTraceEventV1, KERNEL_WORKER_ABI_VERSION_V1,
    KernelGenerationIdentityV1, KernelWorkerFaultV1, KernelWorkerHealthV1,
    KernelWorkerProtocolErrorV1, KernelWorkerRequestEnvelopeV1, KernelWorkerRequestV1,
    KernelWorkerResponseEnvelopeV1, KernelWorkerResponseV1, MAXIMUM_SNAPSHOT_BYTES_V1,
    MAXIMUM_TAIL_EVENTS_V1,
};

#[derive(Debug, Error)]
pub enum KernelWorkerRuntimeErrorV1 {
    #[error(transparent)]
    Protocol(#[from] KernelWorkerProtocolErrorV1),
    #[error("worker is disposed")]
    Disposed,
    #[error("worker kernel is not restored")]
    NotRestored,
    #[error("worker restore payload is invalid: {0}")]
    Restore(String),
    #[error("worker input is not supported by the native environment boundary")]
    UnsupportedInput,
    #[error("worker kernel operation failed: {0}")]
    Kernel(String),
    #[error("worker response serialization failed: {0}")]
    Serialization(String),
}

#[derive(Debug)]
pub struct KernelWorkerRuntimeV1 {
    identity: KernelGenerationIdentityV1,
    environment: Option<GameEnvironment>,
    accepted_sequence: Option<u64>,
    trace: Vec<GenerationTraceEventV1>,
    disposed: bool,
}

impl KernelWorkerRuntimeV1 {
    pub fn new(identity: KernelGenerationIdentityV1) -> Result<Self, KernelWorkerRuntimeErrorV1> {
        identity.validate()?;
        Ok(Self {
            identity,
            environment: None,
            accepted_sequence: None,
            trace: Vec::new(),
            disposed: false,
        })
    }

    pub fn identity(&self) -> &KernelGenerationIdentityV1 {
        &self.identity
    }

    pub fn handle(
        &mut self,
        envelope: KernelWorkerRequestEnvelopeV1,
    ) -> KernelWorkerResponseEnvelopeV1 {
        let request_id = envelope.request_id;
        let sequence = envelope.sequence;
        let result = self.handle_checked(envelope);
        let response = match result {
            Ok(response) => response,
            Err(error) => KernelWorkerResponseV1::Fault(KernelWorkerFaultV1 {
                code: error_code(&error).to_owned(),
                message: error.to_string(),
                retryable: false,
            }),
        };
        KernelWorkerResponseEnvelopeV1 {
            abi_version: KERNEL_WORKER_ABI_VERSION_V1,
            session_id: self.identity.session_id.clone(),
            generation: self.identity.generation,
            request_id,
            accepted_sequence: self.accepted_sequence.unwrap_or(sequence),
            after_mechanical_digest: self.mechanical_digest().unwrap_or_default(),
            response,
        }
    }

    fn handle_checked(
        &mut self,
        envelope: KernelWorkerRequestEnvelopeV1,
    ) -> Result<KernelWorkerResponseV1, KernelWorkerRuntimeErrorV1> {
        envelope.validate_for(&self.identity, self.accepted_sequence)?;
        if self.disposed {
            return Err(KernelWorkerRuntimeErrorV1::Disposed);
        }
        self.accepted_sequence = Some(envelope.sequence);
        match envelope.request {
            KernelWorkerRequestV1::Hello => {
                Ok(KernelWorkerResponseV1::Ready(self.identity.clone()))
            }
            KernelWorkerRequestV1::Restore {
                snapshot_bytes,
                content_bundle_bytes,
            } => {
                self.restore(&snapshot_bytes, &content_bundle_bytes)?;
                Ok(KernelWorkerResponseV1::Restored {
                    mechanical_digest: self.mechanical_digest()?,
                })
            }
            KernelWorkerRequestV1::Apply(input) => self.apply(envelope.sequence, input),
            KernelWorkerRequestV1::Observe => {
                let environment = self
                    .environment
                    .as_ref()
                    .ok_or(KernelWorkerRuntimeErrorV1::NotRestored)?;
                let observation = environment
                    .observe()
                    .map_err(|error| KernelWorkerRuntimeErrorV1::Kernel(error.to_string()))?;
                let observation_bytes = serde_json::to_vec(&observation).map_err(|error| {
                    KernelWorkerRuntimeErrorV1::Serialization(error.to_string())
                })?;
                Ok(KernelWorkerResponseV1::Observation { observation_bytes })
            }
            KernelWorkerRequestV1::Snapshot => Ok(KernelWorkerResponseV1::Snapshot {
                snapshot_bytes: self.snapshot_bytes()?,
            }),
            KernelWorkerRequestV1::ExportRepro => {
                let capsule = GenerationReproCapsuleV1 {
                    schema_version: 1,
                    initial_generation: self.identity.clone(),
                    active_generation: self.identity.clone(),
                    snapshot_bytes: self.snapshot_bytes()?,
                    events: self.trace.clone(),
                };
                let capsule_bytes = serde_json::to_vec(&capsule).map_err(|error| {
                    KernelWorkerRuntimeErrorV1::Serialization(error.to_string())
                })?;
                Ok(KernelWorkerResponseV1::Repro { capsule_bytes })
            }
            KernelWorkerRequestV1::Health => Ok(KernelWorkerResponseV1::Health(self.health())),
            KernelWorkerRequestV1::Dispose => {
                self.environment = None;
                self.trace.clear();
                self.disposed = true;
                Ok(KernelWorkerResponseV1::Disposed)
            }
        }
    }

    fn restore(
        &mut self,
        snapshot_bytes: &[u8],
        content_bytes: &[u8],
    ) -> Result<(), KernelWorkerRuntimeErrorV1> {
        if snapshot_bytes.is_empty()
            || snapshot_bytes.len() > MAXIMUM_SNAPSHOT_BYTES_V1
            || content_bytes.is_empty()
            || content_bytes.len() > MAXIMUM_SNAPSHOT_BYTES_V1
        {
            return Err(KernelWorkerRuntimeErrorV1::Restore(
                "payload size".to_owned(),
            ));
        }
        let snapshot: RestorableKernelSnapshotV6 = serde_json::from_slice(snapshot_bytes)
            .map_err(|error| KernelWorkerRuntimeErrorV1::Restore(error.to_string()))?;
        if snapshot.schema_version < self.identity.minimum_snapshot_schema
            || snapshot.schema_version > self.identity.maximum_snapshot_schema
        {
            return Err(KernelWorkerRuntimeErrorV1::Restore(
                "snapshot schema".to_owned(),
            ));
        }
        let bundle: GameContentBundleV1 = serde_json::from_slice(content_bytes)
            .map_err(|error| KernelWorkerRuntimeErrorV1::Restore(error.to_string()))?;
        if bundle.content_hash.to_string() != self.identity.content_identity {
            return Err(KernelWorkerRuntimeErrorV1::Restore(
                "content identity".to_owned(),
            ));
        }
        let content = PreparedGameContentV1::prepare(Arc::new(bundle))
            .map(Arc::new)
            .map_err(|error| KernelWorkerRuntimeErrorV1::Restore(error.to_string()))?;
        let environment = GameEnvironment::from_snapshot(snapshot, content)
            .map_err(|error| KernelWorkerRuntimeErrorV1::Restore(error.to_string()))?;
        let restored = serde_json::to_vec(&environment.snapshot())
            .map_err(|error| KernelWorkerRuntimeErrorV1::Serialization(error.to_string()))?;
        if restored != snapshot_bytes {
            return Err(KernelWorkerRuntimeErrorV1::Restore(
                "round-trip mismatch".to_owned(),
            ));
        }
        self.environment = Some(environment);
        self.trace.clear();
        Ok(())
    }

    fn apply(
        &mut self,
        sequence: u64,
        input: ExternalTraceInputV6,
    ) -> Result<KernelWorkerResponseV1, KernelWorkerRuntimeErrorV1> {
        let environment = self
            .environment
            .as_mut()
            .ok_or(KernelWorkerRuntimeErrorV1::NotRestored)?;
        let effect_values = match &input {
            ExternalTraceInputV6::RawInput(event) => environment
                .raw_input(event.clone())
                .map_err(|error| KernelWorkerRuntimeErrorV1::Kernel(error.to_string()))?
                .into_iter()
                .map(|effect| json!(format!("{effect:?}")))
                .collect::<Vec<_>>(),
            ExternalTraceInputV6::AdvanceTime { milliseconds } => environment
                .advance_time(*milliseconds)
                .map_err(|error| KernelWorkerRuntimeErrorV1::Kernel(error.to_string()))?
                .into_iter()
                .map(|effect| json!(format!("{effect:?}")))
                .collect::<Vec<_>>(),
            _ => return Err(KernelWorkerRuntimeErrorV1::UnsupportedInput),
        };
        let digest = self.mechanical_digest()?;
        if self.trace.len() >= MAXIMUM_TAIL_EVENTS_V1 {
            self.trace.remove(0);
        }
        self.trace.push(GenerationTraceEventV1 {
            sequence,
            generation: self.identity.clone(),
            input,
            after_mechanical_digest: digest,
        });
        let effect_bytes = serde_json::to_vec(&effect_values)
            .map_err(|error| KernelWorkerRuntimeErrorV1::Serialization(error.to_string()))?;
        Ok(KernelWorkerResponseV1::Effects { effect_bytes })
    }

    fn snapshot_bytes(&self) -> Result<Vec<u8>, KernelWorkerRuntimeErrorV1> {
        let environment = self
            .environment
            .as_ref()
            .ok_or(KernelWorkerRuntimeErrorV1::NotRestored)?;
        serde_json::to_vec(&environment.snapshot())
            .map_err(|error| KernelWorkerRuntimeErrorV1::Serialization(error.to_string()))
    }

    fn mechanical_digest(&self) -> Result<String, KernelWorkerRuntimeErrorV1> {
        self.environment
            .as_ref()
            .map(|environment| environment.observe())
            .transpose()
            .map_err(|error| KernelWorkerRuntimeErrorV1::Kernel(error.to_string()))
            .map(|observation| {
                observation
                    .map(|value| value.mechanical_digest)
                    .unwrap_or_default()
            })
    }

    fn health(&self) -> KernelWorkerHealthV1 {
        KernelWorkerHealthV1 {
            initialized: self.environment.is_some(),
            disposed: self.disposed,
            accepted_sequence: self.accepted_sequence.unwrap_or(0),
            applied_events: self.trace.len(),
            owned_resources: usize::from(self.environment.is_some()),
        }
    }
}

fn error_code(error: &KernelWorkerRuntimeErrorV1) -> &'static str {
    match error {
        KernelWorkerRuntimeErrorV1::Protocol(_) => "PROTOCOL_VIOLATION",
        KernelWorkerRuntimeErrorV1::Disposed => "WORKER_DISPOSED",
        KernelWorkerRuntimeErrorV1::NotRestored => "NOT_RESTORED",
        KernelWorkerRuntimeErrorV1::Restore(_) => "RESTORE_REJECTED",
        KernelWorkerRuntimeErrorV1::UnsupportedInput => "UNSUPPORTED_INPUT",
        KernelWorkerRuntimeErrorV1::Kernel(_) => "KERNEL_FAILURE",
        KernelWorkerRuntimeErrorV1::Serialization(_) => "SERIALIZATION_FAILURE",
    }
}
