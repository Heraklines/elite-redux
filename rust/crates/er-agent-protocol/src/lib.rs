//! Canonical JSONL request/response contracts for agent-driven raw-input sessions.

use serde::{Deserialize, Serialize};

pub const AGENT_PROTOCOL_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentRequestV1 {
    pub protocol_version: u32,
    pub id: String,
    pub method: String,
    pub params: serde_json::Value,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactRefV1 {
    pub digest: String,
    pub size: u64,
    pub media_type: String,
    pub local_path: String,
}
