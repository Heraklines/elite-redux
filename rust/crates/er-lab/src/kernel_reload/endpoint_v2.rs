//! Current ABI2 process ownership. Historical ABI1 endpoints remain separate.

use std::io::{BufReader, Write};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use er_env::current::{CurrentExternalEvent, CurrentGameObservation};
use er_game::m9e_content_v2::GameContentBundleV2;
use er_kernel::game_kernel_v7::GameKernelRoleV7;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelWorkerBootstrapV2,
    KernelWorkerHealthV2, KernelWorkerInitializationV2, KernelWorkerRequestEnvelopeV2,
    KernelWorkerRequestV2, KernelWorkerResponseEnvelopeV2, KernelWorkerResponseV2, read_frame_v1,
    write_frame_v1,
};
use er_types::SeatId;

use super::artifact_v2::VerifiedKernelExecutableV2;
use super::types_v2::{CurrentGenerationStepV2, KernelEndpointErrorV2, KernelWorkerDeadlinesV2};

/// One current session in one worker process. Calls are serialized by `&mut self`.
/// A typed fault permits a corrected request at the same accepted frontier.
/// Uncertain I/O or an invalid response permanently fences this endpoint.
#[derive(Debug)]
pub struct ChildKernelGenerationV2 {
    identity: KernelGenerationIdentityV2,
    worker: OwnedWorkerV2,
    process_id: u32,
    jobs: Option<SyncSender<Vec<u8>>>,
    responses: Receiver<Result<KernelWorkerResponseEnvelopeV2, String>>,
    io_thread: Option<JoinHandle<()>>,
    bootstrap: Option<Vec<u8>>,
    deadlines: KernelWorkerDeadlinesV2,
    next_request: u64,
    accepted_sequence: Option<u64>,
    mechanical_digest: Option<String>,
    fenced: bool,
    disposed: bool,
}

impl ChildKernelGenerationV2 {
    pub fn spawn(artifact: &VerifiedKernelExecutableV2) -> Result<Self, KernelEndpointErrorV2> {
        Self::spawn_with_deadlines(artifact, KernelWorkerDeadlinesV2::default())
    }

    pub fn spawn_with_deadlines(
        artifact: &VerifiedKernelExecutableV2,
        deadlines: KernelWorkerDeadlinesV2,
    ) -> Result<Self, KernelEndpointErrorV2> {
        for timeout in [deadlines.request_timeout, deadlines.shutdown_timeout] {
            if timeout.is_zero() || timeout > Duration::from_secs(60) {
                return Err(KernelEndpointErrorV2::Protocol(
                    "deadlines must be greater than zero and at most sixty seconds".to_owned(),
                ));
            }
        }
        artifact.reverify()?;
        let mut bootstrap = Vec::new();
        write_frame_v1(
            &mut bootstrap,
            &KernelWorkerBootstrapV2 {
                abi_version: KERNEL_WORKER_ABI_VERSION_V2,
                identity: artifact.identity().clone(),
            },
        )
        .map_err(protocol_error)?;
        // Own the child before taking pipes or performing any fallible setup.
        let mut worker = OwnedWorkerV2 {
            child: Some(
                Command::new(artifact.executable())
                    .current_dir(artifact.allowed_root())
                    .env_clear()
                    .env("RUST_BACKTRACE", "0")
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    // Avoid an unbounded diagnostic file or a pipe that can fill.
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(process_error)?,
            ),
            shutdown_timeout: deadlines.shutdown_timeout,
        };
        let child = worker.child.as_mut().ok_or(KernelEndpointErrorV2::Closed)?;
        let process_id = child.id();
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| process_error("worker stdin unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| process_error("worker stdout unavailable"))?;
        let (jobs_tx, jobs_rx) = mpsc::sync_channel::<Vec<u8>>(1);
        let (responses_tx, responses) = mpsc::sync_channel(1);
        let io_thread = thread::Builder::new()
            .name("kernel-worker-v2-io".to_owned())
            .spawn(move || {
                let mut reader = BufReader::new(stdout);
                while let Ok(bytes) = jobs_rx.recv() {
                    let response = (|| {
                        stdin.write_all(&bytes).map_err(|error| error.to_string())?;
                        stdin.flush().map_err(|error| error.to_string())?;
                        read_frame_v1::<_, KernelWorkerResponseEnvelopeV2>(&mut reader)
                            .map_err(|error| error.to_string())?
                            .ok_or_else(|| "worker closed its response stream".to_owned())
                    })();
                    let failed = response.is_err();
                    if responses_tx.send(response).is_err() || failed {
                        break;
                    }
                }
            })
            .map_err(process_error)?;
        let mut endpoint = Self {
            identity: artifact.identity().clone(),
            worker,
            process_id,
            jobs: Some(jobs_tx),
            responses,
            io_thread: Some(io_thread),
            bootstrap: Some(bootstrap),
            deadlines,
            next_request: 1,
            accepted_sequence: None,
            mechanical_digest: None,
            fenced: false,
            disposed: false,
        };
        endpoint.request(KernelWorkerRequestV2::Hello)?;
        Ok(endpoint)
    }

    pub fn identity(&self) -> &KernelGenerationIdentityV2 {
        &self.identity
    }
    pub fn process_id(&self) -> u32 {
        self.process_id
    }
    pub fn accepted_sequence(&self) -> Option<u64> {
        self.accepted_sequence
    }
    pub fn is_fenced(&self) -> bool {
        self.fenced
    }
    /// True only after a valid disposal response and successful child exit.
    pub fn is_disposed(&self) -> bool {
        self.disposed
    }

    pub fn initialize(
        &mut self,
        content_bundle: GameContentBundleV2,
        initialization: KernelWorkerInitializationV2,
    ) -> Result<CurrentGameObservation, KernelEndpointErrorV2> {
        match self.request(KernelWorkerRequestV2::Initialize {
            content_bundle: Box::new(content_bundle),
            initialization: Box::new(initialization),
        })? {
            KernelWorkerResponseV2::Initialized { observation } => Ok(*observation),
            _ => Err(self.invalid_response("initialize response kind")),
        }
    }

    pub fn restore(
        &mut self,
        snapshot_bytes: Vec<u8>,
        local_seat: SeatId,
        role: GameKernelRoleV7,
    ) -> Result<CurrentGameObservation, KernelEndpointErrorV2> {
        match self.request(KernelWorkerRequestV2::Restore {
            snapshot_bytes,
            local_seat,
            role,
        })? {
            KernelWorkerResponseV2::Restored { observation } => Ok(*observation),
            _ => Err(self.invalid_response("restore response kind")),
        }
    }

    pub fn apply(
        &mut self,
        event: CurrentExternalEvent,
    ) -> Result<CurrentGenerationStepV2, KernelEndpointErrorV2> {
        match self.request(KernelWorkerRequestV2::Apply(event))? {
            KernelWorkerResponseV2::Effects { step, observation } => Ok(CurrentGenerationStepV2 {
                step,
                observation: *observation,
            }),
            _ => Err(self.invalid_response("apply response kind")),
        }
    }

    pub fn observe(&mut self) -> Result<CurrentGameObservation, KernelEndpointErrorV2> {
        match self.request(KernelWorkerRequestV2::Observe)? {
            KernelWorkerResponseV2::Observation(observation) => Ok(*observation),
            _ => Err(self.invalid_response("observe response kind")),
        }
    }

    pub fn snapshot(&mut self) -> Result<CoreGameKernelSnapshotV7, KernelEndpointErrorV2> {
        match self.request(KernelWorkerRequestV2::Snapshot)? {
            KernelWorkerResponseV2::Snapshot { snapshot } => Ok(*snapshot),
            _ => Err(self.invalid_response("snapshot response kind")),
        }
    }

    pub fn health(&mut self) -> Result<KernelWorkerHealthV2, KernelEndpointErrorV2> {
        match self.request(KernelWorkerRequestV2::Health)? {
            KernelWorkerResponseV2::Health(health) => Ok(health),
            _ => Err(self.invalid_response("health response kind")),
        }
    }

    pub fn dispose(&mut self) -> Result<(), KernelEndpointErrorV2> {
        if self.disposed {
            return Ok(());
        }
        self.request(KernelWorkerRequestV2::Dispose)?;
        // Keep the I/O sender and stdin alive until the child exits itself.
        let deadline = Instant::now() + self.deadlines.shutdown_timeout;
        let status = match self.worker.wait_until(deadline) {
            Ok(Some(status)) => status,
            Ok(None) => {
                self.fence();
                return Err(KernelEndpointErrorV2::Deadline("worker exit after dispose"));
            }
            Err(error) => {
                self.fence();
                return Err(error);
            }
        };
        if !status.success() {
            self.fence();
            return Err(process_error(format!(
                "worker exit after dispose: {status}"
            )));
        }
        self.disposed = true;
        self.jobs.take();
        if let Err(error) = self.finish_io_until(deadline) {
            self.fenced = true;
            return Err(error);
        }
        Ok(())
    }

    fn request(
        &mut self,
        request: KernelWorkerRequestV2,
    ) -> Result<KernelWorkerResponseV2, KernelEndpointErrorV2> {
        if self.fenced || self.disposed {
            return Err(KernelEndpointErrorV2::Closed);
        }
        let next_request = self
            .next_request
            .checked_add(1)
            .ok_or(KernelEndpointErrorV2::ResourceExhausted)?;
        let sequence = match self.accepted_sequence {
            None => 0,
            Some(sequence) => sequence
                .checked_add(1)
                .ok_or(KernelEndpointErrorV2::ResourceExhausted)?,
        };
        let envelope = KernelWorkerRequestEnvelopeV2::new(
            &self.identity,
            self.next_request,
            sequence,
            request,
        )
        .map_err(protocol_error)?;
        envelope
            .validate_for(&self.identity, self.accepted_sequence)
            .map_err(protocol_error)?;
        let mut bytes = Vec::new();
        write_frame_v1(&mut bytes, &envelope).map_err(protocol_error)?;
        if let Some(mut bootstrap) = self.bootstrap.take() {
            bootstrap.extend(bytes);
            bytes = bootstrap;
        }
        if self
            .jobs
            .as_ref()
            .ok_or(KernelEndpointErrorV2::Closed)?
            .try_send(bytes)
            .is_err()
        {
            self.fence();
            return Err(process_error("worker request channel unavailable"));
        }
        let response = match self.responses.recv_timeout(self.deadlines.request_timeout) {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => {
                self.fence();
                return Err(process_error(error));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.fence();
                return Err(KernelEndpointErrorV2::Deadline(
                    "worker request write or response read",
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.fence();
                return Err(process_error("worker response channel disconnected"));
            }
        };
        if response.abi_version != KERNEL_WORKER_ABI_VERSION_V2
            || response.session_id != self.identity.session_id
            || response.generation != self.identity.generation
            || response.request_id != self.next_request
        {
            return Err(self.invalid_response("worker response address"));
        }
        if let KernelWorkerResponseV2::Fault(fault) = &response.response {
            if response.accepted_sequence != self.accepted_sequence
                || response.after_mechanical_digest != self.mechanical_digest
            {
                return Err(self.invalid_response("worker fault changed the accepted frontier"));
            }
            // A corrected request uses a fresh request ID at the same sequence.
            self.next_request = next_request;
            return Err(KernelEndpointErrorV2::Fault(fault.clone()));
        }
        if response.accepted_sequence != Some(sequence)
            || !self.matches_response(&envelope.request, &response)
        {
            return Err(self.invalid_response("worker response kind, sequence or observation"));
        }
        self.next_request = next_request;
        self.accepted_sequence = response.accepted_sequence;
        self.mechanical_digest = response.after_mechanical_digest;
        Ok(response.response)
    }

    fn matches_response(
        &self,
        request: &KernelWorkerRequestV2,
        response: &KernelWorkerResponseEnvelopeV2,
    ) -> bool {
        let observation = match (request, &response.response) {
            (KernelWorkerRequestV2::Hello, KernelWorkerResponseV2::Ready(identity)) => {
                return identity.as_ref() == &self.identity
                    && response.after_mechanical_digest == self.mechanical_digest;
            }
            (
                KernelWorkerRequestV2::Initialize { .. },
                KernelWorkerResponseV2::Initialized { observation },
            )
            | (
                KernelWorkerRequestV2::Restore { .. },
                KernelWorkerResponseV2::Restored { observation },
            )
            | (
                KernelWorkerRequestV2::Apply(_),
                KernelWorkerResponseV2::Effects { observation, .. },
            ) => observation,
            (KernelWorkerRequestV2::Observe, KernelWorkerResponseV2::Observation(observation)) => {
                if response.after_mechanical_digest != self.mechanical_digest {
                    return false;
                }
                observation
            }
            (KernelWorkerRequestV2::Snapshot, KernelWorkerResponseV2::Snapshot { snapshot }) => {
                return snapshot.schema_version == 7
                    && response.after_mechanical_digest == self.mechanical_digest;
            }
            (KernelWorkerRequestV2::Health, KernelWorkerResponseV2::Health(health)) => {
                return health.accepted_sequence == response.accepted_sequence
                    && !health.disposed
                    && response.after_mechanical_digest == self.mechanical_digest;
            }
            (KernelWorkerRequestV2::Dispose, KernelWorkerResponseV2::Disposed) => {
                return response.after_mechanical_digest.is_none();
            }
            _ => return false,
        };
        observation.kernel_version == 7
            && observation.content_identity == self.identity.content_identity
            && observation.mechanical_digest == response.after_mechanical_digest
    }

    fn invalid_response(&mut self, message: &'static str) -> KernelEndpointErrorV2 {
        self.fence();
        protocol_error(message)
    }

    fn fence(&mut self) {
        self.fenced = true;
        self.jobs.take();
        let deadline = Instant::now() + self.deadlines.shutdown_timeout;
        self.worker.stop_until(deadline);
        let _ = self.finish_io_until(deadline);
    }

    fn finish_io_until(&mut self, deadline: Instant) -> Result<(), KernelEndpointErrorV2> {
        while self
            .io_thread
            .as_ref()
            .is_some_and(|handle| !handle.is_finished())
        {
            if Instant::now() >= deadline {
                return Err(KernelEndpointErrorV2::Deadline("worker pipe cleanup"));
            }
            thread::sleep(Duration::from_millis(1));
        }
        if self
            .io_thread
            .take()
            .is_some_and(|handle| handle.join().is_err())
        {
            return Err(process_error("worker pipe thread panicked"));
        }
        Ok(())
    }
}

impl Drop for ChildKernelGenerationV2 {
    fn drop(&mut self) {
        if !self.disposed && !self.fenced {
            self.fence();
        }
        self.jobs.take();
        // Never join a thread still blocked in an OS pipe operation. Killing the
        // owned worker normally releases it; a remaining handle is detached.
        if self.io_thread.as_ref().is_some_and(JoinHandle::is_finished)
            && let Some(handle) = self.io_thread.take()
        {
            let _ = handle.join();
        }
    }
}

#[derive(Debug)]
struct OwnedWorkerV2 {
    child: Option<Child>,
    shutdown_timeout: Duration,
}

impl OwnedWorkerV2 {
    fn wait_until(
        &mut self,
        deadline: Instant,
    ) -> Result<Option<ExitStatus>, KernelEndpointErrorV2> {
        let Some(child) = self.child.as_mut() else {
            return Ok(None);
        };
        loop {
            if let Some(status) = child.try_wait().map_err(process_error)? {
                return Ok(Some(status));
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            thread::sleep(Duration::from_millis(1));
        }
    }

    fn stop_until(&mut self, deadline: Instant) {
        if let Some(child) = self.child.as_mut()
            && !matches!(child.try_wait(), Ok(Some(_)))
        {
            let _ = child.kill();
        }
        if matches!(self.wait_until(deadline), Ok(Some(_))) {
            self.child.take();
        }
    }
}

impl Drop for OwnedWorkerV2 {
    fn drop(&mut self) {
        self.stop_until(Instant::now() + self.shutdown_timeout);
        if let Some(mut child) = self.child.take() {
            // An OS that does not report exit within the bound must not block
            // the caller indefinitely. Reaping continues off the caller thread.
            let _ = thread::Builder::new()
                .name("kernel-worker-v2-reaper".to_owned())
                .spawn(move || {
                    let _ = child.kill();
                    let _ = child.wait();
                });
        }
    }
}

fn process_error(error: impl ToString) -> KernelEndpointErrorV2 {
    KernelEndpointErrorV2::Process(error.to_string())
}
fn protocol_error(error: impl ToString) -> KernelEndpointErrorV2 {
    KernelEndpointErrorV2::Protocol(error.to_string())
}
