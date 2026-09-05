//! Optional process backend for the normal current JSONL agent.

use std::collections::BTreeMap;
use std::error::Error;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;

use er_agent_protocol::AgentDispatchErrorV1;
use er_env::current::{CurrentExternalEvent, CurrentGameObservation, CurrentGameSession};
use er_game::m9e_content_v2::PreparedGameContentV2;
use er_kernel::game_kernel_v7::GameKernelRoleV7;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_kernel_worker::{KernelGenerationIdentityV2, KernelSessionIdV1, KernelWorkerInitializationV2};
use er_lab::kernel_reload::{ChildKernelGenerationV2, CurrentKernelSupervisorV2, CurrentReloadTicketV2, CurrentTailLimitsV2, KernelWorkerDeadlinesV2, VerifiedKernelExecutableV2};
use er_types::SeatId;
use serde_json::{Value, json};

use crate::current_agent::{CurrentCompletionError, MAXIMUM_MESSAGE_BYTES, backend, bounded, invalid, required};

#[derive(Clone, Debug)]
pub(crate) struct WorkerConfiguration {
    artifact: VerifiedKernelExecutableV2,
}

impl WorkerConfiguration {
    pub(crate) fn from_options(options: &BTreeMap<String, String>, content: &PreparedGameContentV2) -> Result<Option<Self>, Box<dyn Error>> {
        let keys = ["worker-executable", "worker-root", "worker-identity"];
        if keys.iter().all(|key| !options.contains_key(*key)) { return Ok(None); }
        if keys.iter().any(|key| !options.contains_key(*key)) {
            return Err("worker backend requires --worker-executable, --worker-root and --worker-identity".into());
        }
        let mut bytes = Vec::new();
        File::open(&options["worker-identity"])?.take(65_537).read_to_end(&mut bytes)?;
        if bytes.len() > 65_536 { return Err("worker identity exceeds 64 KiB".into()); }
        let identity: KernelGenerationIdentityV2 = serde_json::from_slice(&bytes)?;
        if &identity.content_identity != content.identity() { return Err("worker content identity differs".into()); }
        Ok(Some(Self { artifact: VerifiedKernelExecutableV2::verify(
            &options["worker-root"], &options["worker-executable"], identity,
        )? }))
    }

    pub(crate) fn adopt(&self, id: &str, session: &CurrentGameSession, seat: SeatId, role: GameKernelRoleV7) -> Result<CurrentBackend, AgentDispatchErrorV1> {
        let mut identity = self.artifact.identity().clone();
        identity.session_id = KernelSessionIdV1(id.to_owned());
        let artifact = VerifiedKernelExecutableV2::verify(self.artifact.allowed_root(), self.artifact.executable(), identity).map_err(backend)?;
        Ok(CurrentBackend::Worker(Box::new(WorkerSession::from_snapshot(
            artifact, session.snapshot().map_err(backend)?, seat, role, Arc::clone(session.content()),
        )?)))
    }
}

#[derive(Debug)]
pub(crate) enum CurrentBackend {
    Native(Box<CurrentGameSession>),
    Worker(Box<WorkerSession>),
}

impl CurrentBackend {
    pub(crate) fn observe(&mut self) -> Result<CurrentGameObservation, AgentDispatchErrorV1> {
        match self { Self::Native(session) => session.observe().map_err(backend), Self::Worker(session) => session.supervisor.observe().map_err(backend) }
    }
    pub(crate) fn snapshot(&mut self) -> Result<CoreGameKernelSnapshotV7, AgentDispatchErrorV1> {
        match self { Self::Native(session) => session.snapshot().map_err(backend), Self::Worker(session) => session.supervisor.snapshot().map_err(backend) }
    }
    pub(crate) fn validate(&mut self) -> Result<(), AgentDispatchErrorV1> {
        match self {
            Self::Native(session) => session.validate().map_err(backend),
            Self::Worker(session) => {
                let (seat, role) = session.context()?;
                CurrentGameSession::from_snapshot(session.supervisor.snapshot().map_err(backend)?, seat, role, Arc::clone(&session.content)).map_err(backend)?.validate().map_err(backend)
            }
        }
    }
    pub(crate) fn apply(&mut self, event: CurrentExternalEvent) -> Result<Value, AgentDispatchErrorV1> {
        match self {
            Self::Native(session) => session.apply_with(event, |candidate, step| {
                bounded(json!({"step": step, "observation": candidate.observe()?})).map_err(CurrentCompletionError)
            }).map_err(|error| error.0),
            Self::Worker(session) => {
                let accepted = session.supervisor.dispatch(event).map_err(backend)?;
                // This exact result is a strict JSON subobject of the worker's
                // precommit-bounded envelope. Do not add fallible postcommit bounds
                // or adapter metadata to this result.
                Ok(json!({"step": accepted.evidence.step, "observation": accepted.evidence.observation}))
            }
        }
    }
    pub(crate) fn restore(&mut self, snapshot: CoreGameKernelSnapshotV7) -> Result<Value, AgentDispatchErrorV1> {
        match self {
            Self::Native(session) => {
                session.restore(snapshot).map_err(backend)?;
                Ok(json!({"restored": true, "kernel_version": 7}))
            }
            Self::Worker(session) => {
                let (seat, role) = session.context()?;
                let mut identity = session.artifact.identity().clone();
                identity.generation.0 = identity.generation.0.checked_add(1).ok_or_else(|| backend("worker generation exhausted"))?;
                let artifact = VerifiedKernelExecutableV2::verify(session.artifact.allowed_root(), session.artifact.executable(), identity).map_err(backend)?;
                let candidate = WorkerSession::from_snapshot(artifact, snapshot, seat, role, Arc::clone(&session.content))?;
                let mut previous = std::mem::replace(session.as_mut(), candidate);
                let retirement_issue = previous.supervisor.dispose().err().map(|error| error.to_string().chars().take(1_024).collect::<String>());
                Ok(json!({"restored": true, "kernel_version": 7, "retirement_issue": retirement_issue}))
            }
        }
    }
    pub(crate) fn fork(&mut self, id: &str) -> Result<Self, AgentDispatchErrorV1> {
        match self {
            Self::Native(session) => Ok(Self::Native(Box::new(session.fork().map_err(backend)?))),
            Self::Worker(session) => {
                let (seat, role) = session.context()?;
                let mut identity = session.artifact.identity().clone();
                identity.session_id = KernelSessionIdV1(id.to_owned());
                let artifact = VerifiedKernelExecutableV2::verify(session.artifact.allowed_root(), session.artifact.executable(), identity).map_err(backend)?;
                Ok(Self::Worker(Box::new(WorkerSession::from_snapshot(artifact, session.supervisor.snapshot().map_err(backend)?, seat, role, Arc::clone(&session.content))?)))
            }
        }
    }
    pub(crate) fn dispose(&mut self) -> Option<String> {
        match self {
            Self::Native(session) => { session.dispose(); None }
            Self::Worker(session) => session.supervisor.dispose().err().map(|error| error.to_string().chars().take(1_024).collect()),
        }
    }
    pub(crate) fn reload(&mut self, params: &Value, begin_id: u64) -> Result<Value, AgentDispatchErrorV1> {
        match self {
            Self::Native(_) => Err(invalid("session.reload requires the configured worker backend")),
            Self::Worker(session) => session.reload(params, begin_id),
        }
    }
}

#[derive(Debug)]
pub(crate) struct WorkerSession {
    supervisor: CurrentKernelSupervisorV2,
    artifact: VerifiedKernelExecutableV2,
    content: Arc<PreparedGameContentV2>,
    ticket: Option<(u64, CurrentReloadTicketV2)>,
}

impl WorkerSession {
    fn from_snapshot(artifact: VerifiedKernelExecutableV2, snapshot: CoreGameKernelSnapshotV7, seat: SeatId, role: GameKernelRoleV7, content: Arc<PreparedGameContentV2>) -> Result<Self, AgentDispatchErrorV1> {
        let mut endpoint = ChildKernelGenerationV2::spawn_with_limits(&artifact, KernelWorkerDeadlinesV2::default(), MAXIMUM_MESSAGE_BYTES).map_err(backend)?;
        endpoint.initialize(content.bundle().as_ref().clone(), KernelWorkerInitializationV2::Snapshot {
            snapshot_bytes: serde_json::to_vec(&snapshot).map_err(backend)?, local_seat: seat, role,
        }).map_err(backend)?;
        Ok(Self { supervisor: CurrentKernelSupervisorV2::new(endpoint, CurrentTailLimitsV2::default()).map_err(backend)?, artifact, content, ticket: None })
    }
    fn context(&self) -> Result<(SeatId, GameKernelRoleV7), AgentDispatchErrorV1> {
        self.supervisor.session_context().ok_or_else(|| backend("worker context unavailable"))
    }
    fn reload(&mut self, params: &Value, begin_id: u64) -> Result<Value, AgentDispatchErrorV1> {
        match required::<String>(params, "action")?.as_str() {
            "begin" => {
                let ticket = self.supervisor.begin_reload().map_err(backend)?;
                let result = bounded(json!({"ticket": begin_id, "frontier": ticket.frontier(), "identity": ticket.identity()}))?;
                self.ticket = Some((begin_id, ticket));
                Ok(result)
            }
            "activate" => {
                let expected: u64 = required(params, "ticket")?;
                let (id, ticket) = self.ticket.as_ref().ok_or_else(|| invalid("no pending reload ticket"))?;
                if *id != expected { return Err(invalid("stale reload ticket")); }
                let executable: String = required(params, "executable")?;
                let identity: KernelGenerationIdentityV2 = required(params, "identity")?;
                let artifact = VerifiedKernelExecutableV2::verify(self.artifact.allowed_root(), Path::new(&executable), identity).map_err(backend)?;
                let prepared = self.supervisor.prepare_reload(ticket.clone(), &artifact, self.content.bundle().as_ref().clone()).map_err(backend)?;
                let accepted = self.supervisor.commit_reload(prepared).map_err(backend)?;
                self.artifact = artifact;
                self.ticket = None;
                // Identities have validated bounded fields; error text is capped.
                Ok(json!({"previous_identity": accepted.previous_identity, "active_identity": accepted.active_identity,
                    "frontier": accepted.frontier, "replayed_events": accepted.replayed_events,
                    "retirement_issue": accepted.retirement_issue.map(|issue| issue.chars().take(1_024).collect::<String>())}))
            }
            _ => Err(invalid("reload action must be begin or activate")),
        }
    }
}
