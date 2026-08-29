use std::fs::File;
use std::io::BufWriter;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use er_kernel::snapshot_v6::ExternalTraceInputV6;
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V1, KernelGenerationIdentityV1, KernelWorkerBootstrapV1,
    KernelWorkerHealthV1, KernelWorkerRequestEnvelopeV1, KernelWorkerRequestV1,
    KernelWorkerResponseEnvelopeV1, KernelWorkerResponseV1, read_frame_v1, write_frame_v1,
};
use sha2::{Digest, Sha256};

use super::artifact::VerifiedKernelArtifactV1;
use super::types::{GenerationStepEvidenceV1, KernelReloadErrorV1};

pub trait KernelGenerationEndpointV1: std::fmt::Debug {
    fn identity(&self) -> &KernelGenerationIdentityV1;
    fn restore(
        &mut self,
        snapshot_bytes: &[u8],
        content_bundle_bytes: &[u8],
    ) -> Result<String, KernelReloadErrorV1>;
    fn apply(
        &mut self,
        input: &ExternalTraceInputV6,
    ) -> Result<GenerationStepEvidenceV1, KernelReloadErrorV1>;
    fn snapshot(&mut self) -> Result<Vec<u8>, KernelReloadErrorV1>;
    fn health(&mut self) -> Result<KernelWorkerHealthV1, KernelReloadErrorV1>;
    fn dispose(&mut self) -> Result<(), KernelReloadErrorV1>;
}

#[derive(Debug)]
pub struct ChildKernelGenerationV1 {
    identity: KernelGenerationIdentityV1,
    child: Child,
    writer: BufWriter<ChildStdin>,
    responses: Receiver<Result<KernelWorkerResponseEnvelopeV1, String>>,
    reader_thread: Option<JoinHandle<()>>,
    next_request: u64,
    next_sequence: u64,
    disposed: bool,
}

impl ChildKernelGenerationV1 {
    pub fn spawn(artifact: &VerifiedKernelArtifactV1) -> Result<Self, KernelReloadErrorV1> {
        let stderr = File::options()
            .create(true)
            .append(true)
            .open(artifact.directory.join("worker.stderr.log"))
            .map_err(|error| KernelReloadErrorV1::Process(error.to_string()))?;
        let mut child = Command::new(&artifact.executable)
            .current_dir(&artifact.directory)
            .env_clear()
            .env("RUST_BACKTRACE", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|error| KernelReloadErrorV1::Process(error.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| KernelReloadErrorV1::Process("worker stdin unavailable".to_owned()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| KernelReloadErrorV1::Process("worker stdout unavailable".to_owned()))?;
        let (response_tx, responses) = mpsc::channel();
        let reader_thread = thread::spawn(move || {
            let mut reader = std::io::BufReader::new(stdout);
            loop {
                match read_frame_v1::<_, KernelWorkerResponseEnvelopeV1>(&mut reader) {
                    Ok(Some(response)) => {
                        if response_tx.send(Ok(response)).is_err() {
                            break;
                        }
                    }
                    Ok(None) => {
                        let _ =
                            response_tx.send(Err("worker closed its response stream".to_owned()));
                        break;
                    }
                    Err(error) => {
                        let _ = response_tx.send(Err(error.to_string()));
                        break;
                    }
                }
            }
        });
        let mut endpoint = Self {
            identity: artifact.manifest.identity.clone(),
            child,
            writer: BufWriter::new(stdin),
            responses,
            reader_thread: Some(reader_thread),
            next_request: 1,
            next_sequence: 1,
            disposed: false,
        };
        write_frame_v1(
            &mut endpoint.writer,
            &KernelWorkerBootstrapV1 {
                abi_version: KERNEL_WORKER_ABI_VERSION_V1,
                identity: endpoint.identity.clone(),
            },
        )
        .map_err(|error| KernelReloadErrorV1::Process(error.to_string()))?;
        let response = endpoint.request(KernelWorkerRequestV1::Hello)?;
        if !matches!(&response.response, KernelWorkerResponseV1::Ready(identity) if identity == &endpoint.identity)
        {
            return Err(KernelReloadErrorV1::Process(
                "worker ready identity mismatch".to_owned(),
            ));
        }
        Ok(endpoint)
    }

    fn request(
        &mut self,
        request: KernelWorkerRequestV1,
    ) -> Result<KernelWorkerResponseEnvelopeV1, KernelReloadErrorV1> {
        if self.disposed {
            return Err(KernelReloadErrorV1::Process(
                "worker is disposed".to_owned(),
            ));
        }
        if let Some(status) = self
            .child
            .try_wait()
            .map_err(|error| KernelReloadErrorV1::Process(error.to_string()))?
        {
            return Err(KernelReloadErrorV1::Process(format!(
                "worker exited before request: {status}"
            )));
        }
        let request_id = self.next_request;
        let sequence = self.next_sequence;
        let envelope =
            KernelWorkerRequestEnvelopeV1::new(&self.identity, request_id, sequence, request)
                .map_err(|error| KernelReloadErrorV1::Process(error.to_string()))?;
        write_frame_v1(&mut self.writer, &envelope)
            .map_err(|error| KernelReloadErrorV1::Process(error.to_string()))?;
        let response = match self.responses.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => return Err(KernelReloadErrorV1::Process(error)),
            Err(RecvTimeoutError::Disconnected) => {
                return Err(KernelReloadErrorV1::Process(
                    "worker response channel disconnected".to_owned(),
                ));
            }
            Err(RecvTimeoutError::Timeout) => {
                let _ = self.child.kill();
                let _ = self.child.wait();
                self.disposed = true;
                return Err(KernelReloadErrorV1::Process(
                    "worker response deadline exceeded".to_owned(),
                ));
            }
        };
        self.next_request = self.next_request.saturating_add(1);
        self.next_sequence = self.next_sequence.saturating_add(1);
        if response.abi_version != KERNEL_WORKER_ABI_VERSION_V1
            || response.session_id != self.identity.session_id
            || response.generation != self.identity.generation
            || response.request_id != request_id
            || response.accepted_sequence != sequence
        {
            return Err(KernelReloadErrorV1::Process(
                "stale or mismatched worker response".to_owned(),
            ));
        }
        if let KernelWorkerResponseV1::Fault(fault) = &response.response {
            return Err(KernelReloadErrorV1::Candidate(format!(
                "{}: {}",
                fault.code, fault.message
            )));
        }
        Ok(response)
    }
}

impl KernelGenerationEndpointV1 for ChildKernelGenerationV1 {
    fn identity(&self) -> &KernelGenerationIdentityV1 {
        &self.identity
    }

    fn restore(
        &mut self,
        snapshot_bytes: &[u8],
        content_bundle_bytes: &[u8],
    ) -> Result<String, KernelReloadErrorV1> {
        let response = self.request(KernelWorkerRequestV1::Restore {
            snapshot_bytes: snapshot_bytes.to_vec(),
            content_bundle_bytes: content_bundle_bytes.to_vec(),
        })?;
        match response.response {
            KernelWorkerResponseV1::Restored { mechanical_digest } => Ok(mechanical_digest),
            _ => Err(KernelReloadErrorV1::Process(
                "worker restore response kind".to_owned(),
            )),
        }
    }

    fn apply(
        &mut self,
        input: &ExternalTraceInputV6,
    ) -> Result<GenerationStepEvidenceV1, KernelReloadErrorV1> {
        let response = self.request(KernelWorkerRequestV1::Apply(input.clone()))?;
        let effect_digest = match response.response {
            KernelWorkerResponseV1::Effects { effect_bytes } => sha256(&effect_bytes),
            _ => {
                return Err(KernelReloadErrorV1::Process(
                    "worker apply response kind".to_owned(),
                ));
            }
        };
        let mechanical = response.after_mechanical_digest;
        Ok(GenerationStepEvidenceV1 {
            sequence: response.accepted_sequence,
            mechanical_digest: mechanical.clone(),
            kernel_digest: mechanical.clone(),
            presentation_digest: sha256(&[]),
            effect_digest,
            observation_digest: mechanical,
            invariant_failures: Vec::new(),
        })
    }

    fn snapshot(&mut self) -> Result<Vec<u8>, KernelReloadErrorV1> {
        match self.request(KernelWorkerRequestV1::Snapshot)?.response {
            KernelWorkerResponseV1::Snapshot { snapshot_bytes } => Ok(snapshot_bytes),
            _ => Err(KernelReloadErrorV1::Process(
                "worker snapshot response kind".to_owned(),
            )),
        }
    }

    fn health(&mut self) -> Result<KernelWorkerHealthV1, KernelReloadErrorV1> {
        match self.request(KernelWorkerRequestV1::Health)?.response {
            KernelWorkerResponseV1::Health(health) => Ok(health),
            _ => Err(KernelReloadErrorV1::Process(
                "worker health response kind".to_owned(),
            )),
        }
    }

    fn dispose(&mut self) -> Result<(), KernelReloadErrorV1> {
        if self.disposed {
            return Ok(());
        }
        let response = self.request(KernelWorkerRequestV1::Dispose)?;
        if !matches!(response.response, KernelWorkerResponseV1::Disposed) {
            return Err(KernelReloadErrorV1::Process(
                "worker dispose response kind".to_owned(),
            ));
        }
        self.disposed = true;
        let status = self
            .child
            .wait()
            .map_err(|error| KernelReloadErrorV1::Process(error.to_string()))?;
        if self
            .reader_thread
            .take()
            .is_some_and(|reader| reader.join().is_err())
        {
            return Err(KernelReloadErrorV1::Process(
                "worker response reader panicked".to_owned(),
            ));
        }
        if !status.success() {
            return Err(KernelReloadErrorV1::Process(format!(
                "worker exited after dispose: {status}"
            )));
        }
        Ok(())
    }
}

impl Drop for ChildKernelGenerationV1 {
    fn drop(&mut self) {
        if !self.disposed {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        if let Some(reader) = self.reader_thread.take() {
            let _ = reader.join();
        }
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
