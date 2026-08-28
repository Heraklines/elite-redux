//! Deterministic M7.1 session orchestration downstream of the production game.

use er_dev_types::{DeveloperSessionPolicyV1, SessionTopologyV1};

pub const DEVELOPER_SESSION_VERSION_V1: u32 = 1;

#[derive(Debug)]
pub enum SessionMachineV1 {
    Solo(er_env::GameEnvironment),
    Pair(Box<er_sim::SimulatedPair>),
}

#[derive(Debug)]
pub struct DeveloperSession {
    pub topology: SessionTopologyV1,
    pub policy: DeveloperSessionPolicyV1,
    pub machine: SessionMachineV1,
}
