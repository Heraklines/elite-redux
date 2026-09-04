//! Current V7 JSONL adapter; game ownership lives in er-env, not this protocol loop.

use std::collections::BTreeMap;
use std::error::Error;
use std::io::{self, Write};
use std::sync::Arc;

use er_agent_protocol::{
    AgentDispatchErrorV1, AgentDispatcherV1, AgentErrorCodeV1, AgentJsonlServerV1,
    AgentProtocolLimitsV1,
};
use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, KernelPresentationOutcomeV2};
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_state::m7_state::ProfileStateV1;
use er_types::{RawInputEvent, SafeU53, SeatId};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::m72::{BoundedLineStatusV1, read_bounded_jsonl_line_v1};

// A full current snapshot is larger than the historical 64 KiB inline threshold.
// Keep all accepted responses inline; oversized results are rejected, never turned
// into inaccessible artifact references by the historical server.
const MAXIMUM_MESSAGE_BYTES: usize = 4 << 20;
const MAXIMUM_SESSIONS: usize = 256;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
enum CurrentStart {
    Natural {
        profile: ProfileStateV1,
        seed: String,
        owner_seat: SeatId,
        save_slots: Vec<String>,
        local_is_host: bool,
    },
    Snapshot {
        snapshot: CoreGameKernelSnapshotV7,
        owner_seat: SeatId,
        role: GameKernelRoleV7,
    },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    session: String,
    start: CurrentStart,
}

#[derive(Debug)]
struct CurrentDispatcher {
    content: Arc<PreparedGameContentV2>,
    sessions: BTreeMap<String, CurrentGameSession>,
    maximum_sessions: usize,
}

impl CurrentDispatcher {
    fn session_id<'a>(&self, params: &'a Value) -> Result<&'a str, AgentDispatchErrorV1> {
        params
            .get("session")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| invalid("missing session"))
    }

    fn session(&self, params: &Value) -> Result<&CurrentGameSession, AgentDispatchErrorV1> {
        self.sessions
            .get(self.session_id(params)?)
            .ok_or_else(|| backend("current session missing or closed"))
    }

    fn reserve_id(&self, id: &str) -> Result<(), AgentDispatchErrorV1> {
        if id.is_empty() || id.len() > 128 || self.sessions.contains_key(id) {
            return Err(invalid(
                "session identity is empty, too long, or already exists",
            ));
        }
        if self.sessions.len() >= self.maximum_sessions {
            return Err(backend("current session capacity reached"));
        }
        Ok(())
    }

    fn create(&mut self, params: &Value) -> Result<Value, AgentDispatchErrorV1> {
        let request: CreateRequest =
            serde_json::from_value(params.clone()).map_err(invalid_error)?;
        self.reserve_id(&request.session)?;
        let session = match request.start {
            CurrentStart::Natural {
                profile,
                seed,
                owner_seat,
                save_slots,
                local_is_host,
            } => CurrentGameSession::natural_start(
                profile,
                seed,
                owner_seat,
                save_slots,
                local_is_host,
                Arc::clone(&self.content),
                None,
            )
            .map_err(backend)?,
            CurrentStart::Snapshot {
                snapshot,
                owner_seat,
                role,
            } => CurrentGameSession::from_snapshot(
                snapshot,
                owner_seat,
                role,
                Arc::clone(&self.content),
            )
            .map_err(backend)?,
        };
        let response = json!({"session": request.session, "kernel_version": 7});
        self.sessions.insert(request.session, session);
        Ok(response)
    }

    fn apply(
        &mut self,
        params: &Value,
        event: CurrentExternalEvent,
    ) -> Result<Value, AgentDispatchErrorV1> {
        let id = self.session_id(params)?.to_owned();
        let mut candidate = self.session(params)?.fork().map_err(backend)?;
        let step = candidate.apply(event).map_err(backend)?;
        let response = bounded(json!({
            "step": step,
            "observation": candidate.observe().map_err(backend)?
        }))?;
        self.sessions.insert(id, candidate);
        Ok(response)
    }
}

impl AgentDispatcherV1 for CurrentDispatcher {
    fn dispatch(&mut self, method: &str, params: &Value) -> Result<Value, AgentDispatchErrorV1> {
        match method {
            "protocol.hello" => Ok(json!({
                "protocol_version": 1,
                "kernel_version": 7,
                "content_identity": self.content.identity(),
                "warm": true,
                "start_modes": ["NATURAL", "SNAPSHOT"],
                "input_boundary": "RAW_PHYSICAL_INPUT",
                "maximum_message_bytes": MAXIMUM_MESSAGE_BYTES
            })),
            "session.create" => self.create(params),
            "session.from_snapshot" => self.create(&json!({
                "session": self.session_id(params)?,
                "start": {
                    "kind": "SNAPSHOT", "snapshot": required::<Value>(params, "snapshot")?,
                    "owner_seat": required::<SeatId>(params, "owner_seat")?,
                    "role": required::<GameKernelRoleV7>(params, "role")?
                }
            })),
            "session.observe" => bounded(
                serde_json::to_value(self.session(params)?.observe().map_err(backend)?)
                    .map_err(backend)?,
            ),
            "session.invariants" => {
                self.session(params)?.validate().map_err(backend)?;
                Ok(json!({"valid": true, "kernel_version": 7}))
            }
            "session.snapshot" | "session.checkpoint" => bounded(
                serde_json::to_value(self.session(params)?.snapshot().map_err(backend)?)
                    .map_err(backend)?,
            ),
            "session.raw_input" => self.apply(
                params,
                CurrentExternalEvent::RawInput {
                    input: required::<RawInputEvent>(params, "input")?,
                },
            ),
            "session.advance_time" => self.apply(
                params,
                CurrentExternalEvent::AdvanceTime {
                    milliseconds: required::<SafeU53>(params, "milliseconds")?,
                },
            ),
            "session.network_frame" => self.apply(
                params,
                CurrentExternalEvent::NetworkFrame {
                    generation: required(params, "generation")?,
                    bytes: required(params, "bytes")?,
                },
            ),
            "session.transport_changed" => self.apply(
                params,
                CurrentExternalEvent::TransportChanged {
                    generation: required(params, "generation")?,
                    connected: required(params, "connected")?,
                },
            ),
            "session.presentation_settled" => self.apply(
                params,
                CurrentExternalEvent::PresentationOutcome {
                    event_id: required(params, "event_id")?,
                    outcome: if params.get("outcome").is_some() {
                        required(params, "outcome")?
                    } else {
                        KernelPresentationOutcomeV2::Settled
                    },
                },
            ),
            "session.storage_result" => self.apply(
                params,
                CurrentExternalEvent::StorageResult {
                    request_id: required(params, "request_id")?,
                    result: required(params, "result")?,
                },
            ),
            "platform.event" => self.apply(params, required(params, "event")?),
            "session.restore" => {
                let id = self.session_id(params)?.to_owned();
                let mut candidate = self.session(params)?.fork().map_err(backend)?;
                candidate
                    .restore(required(params, "snapshot")?)
                    .map_err(backend)?;
                self.sessions.insert(id, candidate);
                Ok(json!({"restored": true, "kernel_version": 7}))
            }
            "session.fork" => {
                let id: String = required(params, "target_session")?;
                self.reserve_id(&id)?;
                let fork = self.session(params)?.fork().map_err(backend)?;
                let response = json!({"session": id, "kernel_version": 7});
                self.sessions.insert(id, fork);
                Ok(response)
            }
            "session.close" => {
                let id = self.session_id(params)?.to_owned();
                let mut session = self
                    .sessions
                    .remove(&id)
                    .ok_or_else(|| backend("current session missing or closed"))?;
                session.dispose();
                Ok(json!({"closed": id}))
            }
            "content.inspect" => {
                Ok(json!({"kernel_version": 7, "content_identity": self.content.identity()}))
            }
            "lab.health" | "lab.resources" => Ok(json!({
                "sessions": self.sessions.len(), "maximum_sessions": self.maximum_sessions,
                "kernel_version": 7, "content_identity": self.content.identity()
            })),
            _ => Err(backend(format!(
                "method {method} is not implemented by the current V7 adapter; historical tools require agent-v6"
            ))),
        }
    }
}

pub fn run(options: &BTreeMap<String, String>) -> Result<(), Box<dyn Error>> {
    if options.get("protocol").map(String::as_str) != Some("jsonl") {
        return Err("agent requires --protocol jsonl".into());
    }
    let path = crate::option_path(options, "content", "ER_M9_CONTENT")?;
    let bundle: GameContentBundleV2 = crate::decode_file(&path).map_err(|error| {
        format!(
            "current agent requires V2 content; use agent-v6 for historical V1 content: {error}"
        )
    })?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let maximum_sessions = options
        .get("maximum-sessions")
        .map_or(Ok(MAXIMUM_SESSIONS), |value| value.parse::<usize>())?;
    if maximum_sessions == 0 || maximum_sessions > MAXIMUM_SESSIONS {
        return Err("maximum-sessions must be between 1 and 256".into());
    }
    let mut dispatcher = CurrentDispatcher {
        content,
        sessions: BTreeMap::new(),
        maximum_sessions,
    };
    if let Some(path) = options.get("snapshot") {
        let snapshot: CoreGameKernelSnapshotV7 = crate::decode_file(std::path::Path::new(path))?;
        let owner = options
            .get("seat")
            .map_or(Ok(1), |value| value.parse::<u64>())?;
        let role = match options
            .get("role")
            .map(String::as_str)
            .unwrap_or("AUTHORITY")
        {
            "AUTHORITY" => GameKernelRoleV7::Authority,
            "REPLICA" => GameKernelRoleV7::Replica,
            _ => return Err("role must be AUTHORITY or REPLICA".into()),
        };
        let session = CurrentGameSession::from_snapshot(
            snapshot,
            SeatId::new(SafeU53::new(owner)?),
            role,
            Arc::clone(&dispatcher.content),
        )?;
        dispatcher.sessions.insert("current".to_owned(), session);
    }
    let mut server = AgentJsonlServerV1::new(
        dispatcher,
        AgentProtocolLimitsV1 {
            maximum_line_bytes: MAXIMUM_MESSAGE_BYTES,
            maximum_inline_result_bytes: MAXIMUM_MESSAGE_BYTES,
            maximum_artifact_bytes: MAXIMUM_MESSAGE_BYTES,
            maximum_artifacts: 1,
            maximum_completed_request_ids: 16_384,
        },
    )?;
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    let mut line = Vec::new();
    loop {
        let response =
            match read_bounded_jsonl_line_v1(&mut reader, &mut line, MAXIMUM_MESSAGE_BYTES)? {
                BoundedLineStatusV1::Eof => break,
                BoundedLineStatusV1::Oversized => server.process_oversized_line()?,
                BoundedLineStatusV1::Line => server.process_line(&line)?,
            };
        writer.write_all(&response)?;
        writer.flush()?;
    }
    server.close();
    Ok(())
}

fn bounded(value: Value) -> Result<Value, AgentDispatchErrorV1> {
    if serde_json::to_vec(&value).map_err(backend)?.len() > MAXIMUM_MESSAGE_BYTES {
        return Err(backend(
            "current response exceeds the bounded inline protocol limit",
        ));
    }
    Ok(value)
}

fn required<T: serde::de::DeserializeOwned>(
    params: &Value,
    name: &str,
) -> Result<T, AgentDispatchErrorV1> {
    let value = params
        .get(name)
        .cloned()
        .ok_or_else(|| invalid(&format!("missing {name}")))?;
    serde_json::from_value(value).map_err(invalid_error)
}

fn invalid(message: &str) -> AgentDispatchErrorV1 {
    AgentDispatchErrorV1 {
        code: AgentErrorCodeV1::InvalidRequest,
        message: message.to_owned(),
    }
}

fn invalid_error(error: impl ToString) -> AgentDispatchErrorV1 {
    invalid(&error.to_string())
}

fn backend(error: impl ToString) -> AgentDispatchErrorV1 {
    AgentDispatchErrorV1 {
        code: AgentErrorCodeV1::BackendError,
        message: error.to_string(),
    }
}
