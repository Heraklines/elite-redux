//! Deterministic M7.1 session orchestration downstream of the production game.

pub mod capsule;
pub mod checkpoint;
pub mod lineage;
pub mod pair;
pub mod performance;
pub mod reload;
pub mod solo;
pub mod telemetry;

use er_dev_types::{
    CausalGraphV1, DeveloperSessionPolicyV1, ExecutionIdentityV1, SessionTopologyV1,
};
use thiserror::Error;

pub use capsule::*;
pub use checkpoint::*;
pub use er_sim::PairEndpoint;
pub use lineage::*;
pub use pair::*;
pub use performance::*;
pub use reload::*;
pub use solo::*;
pub use telemetry::*;
pub type SoloSnapshotV6 = er_kernel::snapshot_v6::RestorableKernelSnapshotV6;
pub type PairSnapshotV2 = er_sim::snapshot::RestorablePairSnapshotV2;

pub const DEVELOPER_SESSION_VERSION_V1: u32 = 1;

#[derive(Debug)]
pub enum SessionMachineV1 {
    Solo(SoloSessionMachineV1),
    Pair(PairSessionMachineV1),
}

#[derive(Debug)]
pub struct DeveloperSession {
    pub identity: ExecutionIdentityV1,
    pub topology: SessionTopologyV1,
    pub policy: DeveloperSessionPolicyV1,
    pub machine: SessionMachineV1,
    pub evidence: CausalGraphV1,
    pub checkpoints: CheckpointStoreV1,
    pub lineage: SessionLineageV1,
    pub telemetry: TelemetryRingV1,
    closed: bool,
}

#[derive(Debug, Error)]
pub enum DeveloperSessionErrorV1 {
    #[error("developer session policy contains a zero bound")]
    Policy,
    #[error("developer session topology differs from its machine")]
    Topology,
    #[error("developer session is closed")]
    Closed,
    #[error("developer session owner failed: {0}")]
    Owner(String),
}

impl DeveloperSession {
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        identity: ExecutionIdentityV1,
        machine: SessionMachineV1,
        policy: DeveloperSessionPolicyV1,
        lineage: SessionLineageV1,
        maximum_checkpoint_entries: usize,
        maximum_causal_nodes: usize,
        maximum_causal_edges: usize,
        maximum_telemetry_events: usize,
    ) -> Result<Self, DeveloperSessionErrorV1> {
        if policy.maximum_checkpoint_bytes == 0
            || policy.maximum_evidence_bytes == 0
            || policy.maximum_telemetry_bytes == 0
            || maximum_checkpoint_entries == 0
            || maximum_causal_nodes == 0
            || maximum_causal_edges == 0
            || maximum_telemetry_events == 0
        {
            return Err(DeveloperSessionErrorV1::Policy);
        }
        identity
            .validate()
            .map_err(|error| DeveloperSessionErrorV1::Owner(error.to_string()))?;
        let topology = match &machine {
            SessionMachineV1::Solo(_) => SessionTopologyV1::Solo,
            SessionMachineV1::Pair(_) => SessionTopologyV1::Pair,
        };
        Ok(Self {
            identity,
            topology,
            policy: policy.clone(),
            machine,
            evidence: CausalGraphV1 {
                maximum_nodes: maximum_causal_nodes,
                maximum_edges: maximum_causal_edges,
                nodes: Vec::new(),
                edges: Vec::new(),
                truncated: false,
            },
            checkpoints: CheckpointStoreV1::new(
                policy.maximum_checkpoint_bytes,
                maximum_checkpoint_entries,
            )
            .map_err(|error| DeveloperSessionErrorV1::Owner(error.to_string()))?,
            lineage,
            telemetry: TelemetryRingV1::new(
                policy.maximum_telemetry_bytes,
                maximum_telemetry_events,
            )
            .map_err(|error| DeveloperSessionErrorV1::Owner(error.to_string()))?,
            closed: false,
        })
    }

    pub fn close(&mut self, reason: &str) -> Result<(), DeveloperSessionErrorV1> {
        if self.closed {
            return Ok(());
        }
        match &mut self.machine {
            SessionMachineV1::Solo(machine) => machine.close(),
            SessionMachineV1::Pair(machine) => machine
                .close(reason)
                .map_err(|error| DeveloperSessionErrorV1::Owner(error.to_string()))?,
        }
        self.evidence.nodes.clear();
        self.evidence.edges.clear();
        self.checkpoints.clear();
        self.telemetry.clear();
        self.closed = true;
        Ok(())
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }
}
