//! Bounded JSONL request/response server for agent-driven raw-input sessions.

use std::{collections::BTreeMap, panic::AssertUnwindSafe};

use serde::{Deserialize, Serialize};
use thiserror::Error;

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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentErrorCodeV1 {
    ParseError,
    InvalidRequest,
    VersionMismatch,
    MethodNotFound,
    MethodForbidden,
    DuplicateRequest,
    RequestTooLarge,
    ArtifactQuota,
    InternalError,
    BackendError,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentErrorV1 {
    pub code: AgentErrorCodeV1,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentResponseV1 {
    pub protocol_version: u32,
    pub id: Option<String>,
    pub result: Option<serde_json::Value>,
    pub artifact: Option<ArtifactRefV1>,
    pub error: Option<AgentErrorV1>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentNotificationV1 {
    pub protocol_version: u32,
    pub event: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AgentProtocolLimitsV1 {
    pub maximum_line_bytes: usize,
    pub maximum_inline_result_bytes: usize,
    pub maximum_artifact_bytes: usize,
    pub maximum_artifacts: usize,
    pub maximum_completed_request_ids: usize,
}

impl AgentProtocolLimitsV1 {
    pub fn validate(self) -> Result<(), AgentProtocolErrorV1> {
        if self.maximum_line_bytes == 0
            || self.maximum_inline_result_bytes == 0
            || self.maximum_artifact_bytes == 0
            || self.maximum_artifacts == 0
            || self.maximum_completed_request_ids == 0
        {
            return Err(AgentProtocolErrorV1::Bounds);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AgentProtocolErrorV1 {
    #[error("agent protocol bound is zero")]
    Bounds,
    #[error("agent protocol response serialization failed: {0}")]
    Serialization(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentDispatchErrorV1 {
    pub code: AgentErrorCodeV1,
    pub message: String,
}

pub trait AgentDispatcherV1 {
    fn dispatch(
        &mut self,
        method: &str,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, AgentDispatchErrorV1>;
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentProtocolResourceSnapshotV1 {
    pub completed_request_ids: usize,
    pub retained_artifacts: usize,
    pub retained_artifact_bytes: usize,
}

#[derive(Debug)]
pub struct AgentJsonlServerV1<D> {
    dispatcher: D,
    limits: AgentProtocolLimitsV1,
    completed_request_ids: Vec<String>,
    artifacts: BTreeMap<String, Vec<u8>>,
    artifact_bytes: usize,
}

impl<D: AgentDispatcherV1> AgentJsonlServerV1<D> {
    pub fn new(dispatcher: D, limits: AgentProtocolLimitsV1) -> Result<Self, AgentProtocolErrorV1> {
        limits.validate()?;
        Ok(Self {
            dispatcher,
            limits,
            completed_request_ids: Vec::new(),
            artifacts: BTreeMap::new(),
            artifact_bytes: 0,
        })
    }

    pub fn process_line(&mut self, line: &[u8]) -> Result<Vec<u8>, AgentProtocolErrorV1> {
        let response = self.process_request(line);
        let mut bytes = serde_json::to_vec(&response)
            .map_err(|error| AgentProtocolErrorV1::Serialization(error.to_string()))?;
        bytes.push(b'\n');
        Ok(bytes)
    }

    pub fn artifact(&self, digest: &str) -> Option<&[u8]> {
        self.artifacts.get(digest).map(Vec::as_slice)
    }

    pub fn resource_snapshot(&self) -> AgentProtocolResourceSnapshotV1 {
        AgentProtocolResourceSnapshotV1 {
            completed_request_ids: self.completed_request_ids.len(),
            retained_artifacts: self.artifacts.len(),
            retained_artifact_bytes: self.artifact_bytes,
        }
    }

    pub fn close(&mut self) {
        self.completed_request_ids.clear();
        self.artifacts.clear();
        self.artifact_bytes = 0;
    }

    pub fn into_dispatcher(self) -> D {
        self.dispatcher
    }

    fn process_request(&mut self, line: &[u8]) -> AgentResponseV1 {
        if line.len() > self.limits.maximum_line_bytes {
            return error_response(
                None,
                AgentErrorCodeV1::RequestTooLarge,
                "JSONL request exceeds byte limit",
            );
        }
        let request = match serde_json::from_slice::<AgentRequestV1>(line) {
            Ok(request) => request,
            Err(error) => {
                return error_response(
                    recover_request_id(line),
                    AgentErrorCodeV1::ParseError,
                    &format!("malformed JSONL request: {error}"),
                );
            }
        };
        if request.protocol_version != AGENT_PROTOCOL_VERSION_V1 {
            return error_response(
                Some(request.id),
                AgentErrorCodeV1::VersionMismatch,
                "agent protocol version mismatch",
            );
        }
        if request.id.is_empty() || request.method.is_empty() {
            return error_response(
                Some(request.id),
                AgentErrorCodeV1::InvalidRequest,
                "request identity and method must be non-empty",
            );
        }
        if self
            .completed_request_ids
            .iter()
            .any(|id| id == &request.id)
        {
            return error_response(
                Some(request.id),
                AgentErrorCodeV1::DuplicateRequest,
                "request identity was already processed",
            );
        }
        let id = request.id.clone();
        let classification = classify_method(&request.method);
        let response = match classification {
            MethodClassV1::Forbidden => error_response(
                Some(id.clone()),
                AgentErrorCodeV1::MethodForbidden,
                "semantic action methods are forbidden",
            ),
            MethodClassV1::Unknown => error_response(
                Some(id.clone()),
                AgentErrorCodeV1::MethodNotFound,
                "unknown agent protocol method",
            ),
            MethodClassV1::Allowed => {
                let dispatched = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    self.dispatcher.dispatch(&request.method, &request.params)
                }));
                match dispatched {
                    Ok(Ok(value)) => self.success_response(id.clone(), value),
                    Ok(Err(error)) => error_response(Some(id.clone()), error.code, &error.message),
                    Err(_) => error_response(
                        Some(id.clone()),
                        AgentErrorCodeV1::InternalError,
                        "dispatcher panic was contained",
                    ),
                }
            }
        };
        if self.completed_request_ids.len() == self.limits.maximum_completed_request_ids {
            self.completed_request_ids.remove(0);
        }
        self.completed_request_ids.push(id);
        response
    }

    fn success_response(&mut self, id: String, value: serde_json::Value) -> AgentResponseV1 {
        let bytes = match serde_json::to_vec(&value) {
            Ok(bytes) => bytes,
            Err(error) => {
                return error_response(
                    Some(id),
                    AgentErrorCodeV1::InternalError,
                    &format!("result serialization failed: {error}"),
                );
            }
        };
        if bytes.len() <= self.limits.maximum_inline_result_bytes {
            return AgentResponseV1 {
                protocol_version: AGENT_PROTOCOL_VERSION_V1,
                id: Some(id),
                result: Some(value),
                artifact: None,
                error: None,
            };
        }
        if bytes.len() > self.limits.maximum_artifact_bytes
            || self.artifacts.len() == self.limits.maximum_artifacts
            || self
                .artifact_bytes
                .checked_add(bytes.len())
                .is_none_or(|total| total > self.limits.maximum_artifact_bytes)
        {
            return error_response(
                Some(id),
                AgentErrorCodeV1::ArtifactQuota,
                "result exceeds artifact quota",
            );
        }
        let size = match u64::try_from(bytes.len()) {
            Ok(size) => size,
            Err(_) => {
                return error_response(
                    Some(id),
                    AgentErrorCodeV1::ArtifactQuota,
                    "result size is not representable",
                );
            }
        };
        let digest = format!("blake3-v1:{}", blake3::hash(&bytes).to_hex());
        self.artifact_bytes += bytes.len();
        self.artifacts.insert(digest.clone(), bytes.clone());
        AgentResponseV1 {
            protocol_version: AGENT_PROTOCOL_VERSION_V1,
            id: Some(id),
            result: None,
            artifact: Some(ArtifactRefV1 {
                digest: digest.clone(),
                size,
                media_type: "application/json".to_owned(),
                local_path: format!("artifact://{digest}"),
            }),
            error: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MethodClassV1 {
    Allowed,
    Forbidden,
    Unknown,
}

fn classify_method(method: &str) -> MethodClassV1 {
    const FORBIDDEN: [[&str; 2]; 10] = [
        ["choose", "_move"],
        ["select", "_move"],
        ["select", "_reward"],
        ["select", "_party_slot"],
        ["choose", "_replacement"],
        ["apply", "_damage"],
        ["force", "_capture"],
        ["cap", "ture"],
        ["resolve", "_turn"],
        ["submit", "_command"],
    ];
    let leaf = method.rsplit_once('.').map_or(method, |(_, leaf)| leaf);
    if FORBIDDEN.iter().any(|fragments| {
        leaf.len() == fragments[0].len() + fragments[1].len()
            && leaf.starts_with(fragments[0])
            && leaf.ends_with(fragments[1])
    }) {
        return MethodClassV1::Forbidden;
    }
    const ALLOWED: [&str; 42] = [
        "protocol.hello",
        "session.create",
        "session.from_snapshot",
        "session.from_capsule",
        "session.close",
        "session.observe",
        "session.state_delta",
        "session.raw_input",
        "session.advance_time",
        "session.network_frame",
        "session.presentation_settled",
        "session.storage_result",
        "session.transport_changed",
        "session.suspend",
        "session.resume",
        "session.snapshot",
        "session.checkpoint",
        "session.restore",
        "session.seek",
        "session.fork",
        "session.diff",
        "session.explain",
        "session.invariants",
        "session.performance",
        "session.capsule.export",
        "session.capsule.open",
        "session.capsule.replay",
        "session.minimize",
        "content.inspect",
        "tests.affected",
        "batch.create",
        "batch.close",
        "batch.reset",
        "batch.raw_input",
        "batch.advance_time",
        "batch.observe",
        "artifact.get",
        "corpus.list",
        "corpus.add",
        "model.complete",
        "render.validate",
        "platform.event",
    ];
    if ALLOWED.contains(&method) {
        MethodClassV1::Allowed
    } else {
        MethodClassV1::Unknown
    }
}

fn recover_request_id(line: &[u8]) -> Option<String> {
    let value = serde_json::from_slice::<serde_json::Value>(line).ok()?;
    value.get("id")?.as_str().map(ToOwned::to_owned)
}

fn error_response(id: Option<String>, code: AgentErrorCodeV1, message: &str) -> AgentResponseV1 {
    AgentResponseV1 {
        protocol_version: AGENT_PROTOCOL_VERSION_V1,
        id,
        result: None,
        artifact: None,
        error: Some(AgentErrorV1 {
            code,
            message: message.to_owned(),
        }),
    }
}
