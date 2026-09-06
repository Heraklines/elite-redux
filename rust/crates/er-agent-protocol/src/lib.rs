//! Bounded JSONL request/response server for agent-driven raw-input sessions.

pub mod m72;

pub use m72::*;

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

/// Borrowed admission information for adapters that publish state only after a
/// complete inline success response is known to fit the transport.
#[derive(Clone, Copy, Debug)]
pub struct AgentResponseContextV1<'a> {
    pub request_id: &'a str,
    pub maximum_inline_result_bytes: usize,
    pub maximum_response_jsonl_bytes: usize,
}

#[derive(Serialize)]
struct BorrowedInlineResponseV1<'a> {
    protocol_version: u32,
    id: Option<&'a str>,
    result: Option<&'a serde_json::Value>,
    artifact: Option<&'a ArtifactRefV1>,
    error: Option<&'a AgentErrorV1>,
}

struct ResponseByteCounter {
    bytes: usize,
    maximum: usize,
    exceeded: bool,
}

impl std::io::Write for ResponseByteCounter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        match self.bytes.checked_add(bytes.len()) {
            Some(total) if total <= self.maximum => {
                self.bytes = total;
                Ok(bytes.len())
            }
            _ => {
                self.exceeded = true;
                Err(std::io::Error::other("response byte capacity exceeded"))
            }
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl AgentResponseContextV1<'_> {
    pub fn admit_inline_success(
        &self,
        value: &serde_json::Value,
    ) -> Result<(), AgentDispatchErrorV1> {
        count_response_json(
            value,
            self.maximum_inline_result_bytes,
            false,
            "inline result",
        )?;
        let response = BorrowedInlineResponseV1 {
            protocol_version: AGENT_PROTOCOL_VERSION_V1,
            id: Some(self.request_id),
            result: Some(value),
            artifact: None,
            error: None,
        };
        count_response_json(
            &response,
            self.maximum_response_jsonl_bytes,
            true,
            "success response JSONL",
        )
    }
}

fn count_response_json(
    value: &impl Serialize,
    maximum: usize,
    newline: bool,
    label: &str,
) -> Result<(), AgentDispatchErrorV1> {
    let mut counter = ResponseByteCounter {
        bytes: 0,
        maximum,
        exceeded: false,
    };
    let result = serde_json::to_writer(&mut counter, value)
        .map_err(|error| error.to_string())
        .and_then(|()| {
            if newline {
                std::io::Write::write_all(&mut counter, b"\n").map_err(|error| error.to_string())
            } else {
                Ok(())
            }
        });
    result.map_err(|error| AgentDispatchErrorV1 {
        code: if counter.exceeded {
            AgentErrorCodeV1::BackendError
        } else {
            AgentErrorCodeV1::InternalError
        },
        message: if counter.exceeded {
            format!("{label} exceeds its byte capacity")
        } else {
            format!("{label} serialization failed: {error}")
        },
    })
}

pub trait AgentDispatcherV1 {
    /// Optional diagnostics for rejected ingress. No typed event is inferred.
    /// Existing dispatchers keep their behavior through this default no-op.
    fn rejected_ingress(&mut self, _request: Option<&AgentRequestV1>, _reason: &str) {}

    fn dispatch(
        &mut self,
        method: &str,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, AgentDispatchErrorV1>;

    /// Existing dispatchers retain their historical inline/artifact behavior.
    fn dispatch_with_response_context(
        &mut self,
        method: &str,
        params: &serde_json::Value,
        _context: AgentResponseContextV1<'_>,
    ) -> Result<serde_json::Value, AgentDispatchErrorV1> {
        self.dispatch(method, params)
    }
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

    pub fn process_oversized_line(&self) -> Result<Vec<u8>, AgentProtocolErrorV1> {
        let response = error_response(
            None,
            AgentErrorCodeV1::RequestTooLarge,
            "JSONL request exceeds byte limit",
        );
        let mut bytes = serde_json::to_vec(&response)
            .map_err(|error| AgentProtocolErrorV1::Serialization(error.to_string()))?;
        bytes.push(b'\n');
        Ok(bytes)
    }

    /// Opt-in diagnostics for bounded readers that discard the oversized line.
    /// The historical immutable method above remains source-compatible.
    pub fn process_oversized_line_with_diagnostics(
        &mut self,
    ) -> Result<Vec<u8>, AgentProtocolErrorV1> {
        self.dispatcher
            .rejected_ingress(None, "oversized JSONL ingress");
        self.process_oversized_line()
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
            self.dispatcher
                .rejected_ingress(None, "oversized JSONL ingress");
            return error_response(
                None,
                AgentErrorCodeV1::RequestTooLarge,
                "JSONL request exceeds byte limit",
            );
        }
        let request = match serde_json::from_slice::<AgentRequestV1>(line) {
            Ok(request) => request,
            Err(error) => {
                self.dispatcher
                    .rejected_ingress(None, "malformed JSONL ingress");
                return error_response(
                    recover_request_id(line),
                    AgentErrorCodeV1::ParseError,
                    &format!("malformed JSONL request: {error}"),
                );
            }
        };
        if request.protocol_version != AGENT_PROTOCOL_VERSION_V1 {
            self.dispatcher
                .rejected_ingress(Some(&request), "JSONL version rejected");
            return error_response(
                Some(request.id),
                AgentErrorCodeV1::VersionMismatch,
                "agent protocol version mismatch",
            );
        }
        if request.id.is_empty() || request.method.is_empty() {
            self.dispatcher
                .rejected_ingress(Some(&request), "JSONL identity rejected");
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
            self.dispatcher
                .rejected_ingress(Some(&request), "duplicate JSONL request rejected");
            return error_response(
                Some(request.id),
                AgentErrorCodeV1::DuplicateRequest,
                "request identity was already processed",
            );
        }
        let id = request.id.clone();
        let classification = classify_method(&request.method);
        if classification != MethodClassV1::Allowed {
            self.dispatcher
                .rejected_ingress(Some(&request), "JSONL method admission rejected");
        }
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
                    self.dispatcher.dispatch_with_response_context(
                        &request.method,
                        &request.params,
                        AgentResponseContextV1 {
                            request_id: &request.id,
                            maximum_inline_result_bytes: self.limits.maximum_inline_result_bytes,
                            maximum_response_jsonl_bytes: self.limits.maximum_line_bytes,
                        },
                    )
                }));
                match dispatched {
                    Ok(Ok(value)) => self.success_response(id.clone(), value),
                    Ok(Err(error)) => error_response(Some(id.clone()), error.code, &error.message),
                    Err(_) => {
                        self.dispatcher
                            .rejected_ingress(Some(&request), "contained dispatcher panic");
                        error_response(
                            Some(id.clone()),
                            AgentErrorCodeV1::InternalError,
                            "dispatcher panic was contained",
                        )
                    }
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
    const ALLOWED: [&str; 47] = [
        "session.capsule.status",
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
        "session.reload",
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
        "batch.events",
        "batch.snapshot",
        "batch.fork",
        "artifact.get",
        "corpus.list",
        "corpus.add",
        "model.complete",
        "render.validate",
        "platform.event",
    ];
    if ALLOWED.contains(&method) || parse_lab_method_v1(method).is_some() {
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

#[cfg(test)]
mod response_context_tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn inline_success_boundary_counts_escaping_nulls_and_newline()
    -> Result<(), Box<dyn std::error::Error>> {
        let id = "quote\" backslash\\ newline\n tab\t multibyte\u{00e9}\u{1f600}";
        let value = json!({"escaped": "\u{0001}\"\\\n", "unicode": "\u{1f600}", "null": null});
        let response = AgentResponseV1 {
            protocol_version: 1,
            id: Some(id.to_owned()),
            result: Some(value.clone()),
            artifact: None,
            error: None,
        };
        let actual_json = serde_json::to_vec(&response)?;
        let borrowed = BorrowedInlineResponseV1 {
            protocol_version: 1,
            id: Some(id),
            result: Some(&value),
            artifact: None,
            error: None,
        };
        assert_eq!(
            serde_json::to_vec(&borrowed)?,
            actual_json,
            "admission shape must exactly track AgentResponseV1"
        );
        let inline_bytes = serde_json::to_vec(&value)?.len();
        let context = AgentResponseContextV1 {
            request_id: id,
            maximum_inline_result_bytes: inline_bytes,
            maximum_response_jsonl_bytes: actual_json.len() + 1,
        };
        assert!(context.admit_inline_success(&value).is_ok());
        let short_envelope = AgentResponseContextV1 {
            maximum_response_jsonl_bytes: actual_json.len(),
            ..context
        };
        let error = short_envelope
            .admit_inline_success(&value)
            .expect_err("newline must count");
        assert_eq!(error.code, AgentErrorCodeV1::BackendError);
        assert!(error.message.contains("success response JSONL"));
        let short_result = AgentResponseContextV1 {
            maximum_inline_result_bytes: inline_bytes - 1,
            ..context
        };
        assert!(
            short_result
                .admit_inline_success(&value)
                .expect_err("inline cap must count")
                .message
                .contains("inline result")
        );
        Ok(())
    }

    struct TransactionalDispatcher {
        committed: usize,
    }
    impl AgentDispatcherV1 for TransactionalDispatcher {
        fn dispatch(&mut self, _: &str, _: &Value) -> Result<Value, AgentDispatchErrorV1> {
            Err(AgentDispatchErrorV1 {
                code: AgentErrorCodeV1::InternalError,
                message: "context was not supplied".to_owned(),
            })
        }
        fn dispatch_with_response_context(
            &mut self,
            _: &str,
            _: &Value,
            context: AgentResponseContextV1<'_>,
        ) -> Result<Value, AgentDispatchErrorV1> {
            let candidate = json!({"payload": "x".repeat(96)});
            context.admit_inline_success(&candidate)?;
            self.committed += 1;
            Ok(candidate)
        }
    }

    fn limits() -> AgentProtocolLimitsV1 {
        AgentProtocolLimitsV1 {
            maximum_line_bytes: 256,
            maximum_inline_result_bytes: 256,
            maximum_artifact_bytes: 1024,
            maximum_artifacts: 2,
            maximum_completed_request_ids: 8,
        }
    }
    fn request(id: &str) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(&AgentRequestV1 {
            protocol_version: 1,
            id: id.to_owned(),
            method: "batch.events".to_owned(),
            params: json!({}),
        })
    }

    #[test]
    fn contextual_server_rejects_before_mutation_and_accepts_corrected_retry()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut server =
            AgentJsonlServerV1::new(TransactionalDispatcher { committed: 0 }, limits())?;
        let request = request(&"a".repeat(150))?;
        assert!(
            request.len() <= limits().maximum_line_bytes,
            "request itself must be admissible"
        );
        let rejected: AgentResponseV1 = serde_json::from_slice(&server.process_line(&request)?)?;
        assert!(rejected.result.is_none());
        assert_eq!(
            rejected.error.ok_or("missing admission error")?.code,
            AgentErrorCodeV1::BackendError
        );
        assert_eq!(
            server.dispatcher.committed, 0,
            "no publication on envelope overflow"
        );
        let accepted = server.process_line(&self::request("retry")?)?;
        assert!(accepted.len() <= limits().maximum_line_bytes);
        let accepted: AgentResponseV1 = serde_json::from_slice(&accepted)?;
        assert!(accepted.error.is_none());
        assert!(accepted.result.is_some());
        assert_eq!(server.dispatcher.committed, 1);
        Ok(())
    }

    struct HistoricalDispatcher;
    impl AgentDispatcherV1 for HistoricalDispatcher {
        fn dispatch(&mut self, _: &str, _: &Value) -> Result<Value, AgentDispatchErrorV1> {
            Ok(json!("x".repeat(512)))
        }
    }

    #[test]
    fn default_context_preserves_historical_artifact_dispatch()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut server = AgentJsonlServerV1::new(HistoricalDispatcher, limits())?;
        let response: AgentResponseV1 =
            serde_json::from_slice(&server.process_line(&request("legacy")?)?)?;
        assert!(response.error.is_none());
        assert!(response.result.is_none());
        let artifact = response.artifact.ok_or("historical artifact response")?;
        assert_eq!(
            server
                .artifact(&artifact.digest)
                .ok_or("stored historical artifact")?,
            serde_json::to_vec(&json!("x".repeat(512)))?
        );
        Ok(())
    }
}

#[cfg(test)]
mod ingress_diagnostic_tests;
