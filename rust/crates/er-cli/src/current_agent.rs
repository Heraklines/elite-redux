//! Current V7 JSONL adapter; game ownership lives in er-env, not this protocol loop.

use std::collections::BTreeMap;
use std::error::Error;
use std::io::{self, Write};
use std::sync::Arc;

use er_agent_protocol::{
    AgentDispatchErrorV1, AgentDispatcherV1, AgentErrorCodeV1, AgentJsonlServerV1,
    AgentProtocolLimitsV1, AgentRequestV1, AgentResponseContextV1,
};
use er_env::current::{CurrentExternalEvent, CurrentGameSession, CurrentSessionError};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, KernelPresentationOutcomeV2};
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_state::m7_state::ProfileStateV1;
use er_types::battle_ids::MenuInstanceId;
use er_types::{MenuOptionId, RawInputEvent, SafeU53, SeatId};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::current_batch_agent::CurrentBatches;
use crate::current_native_capture::{CaptureLimits, NativeCapture};
use crate::current_worker_agent::{CurrentBackend, WorkerConfiguration};
use crate::m72::{BoundedLineStatusV1, read_bounded_jsonl_line_v1};

// A full current snapshot is larger than the historical 64 KiB inline threshold.
// Keep all accepted responses inline; oversized results are rejected, never turned
// into inaccessible artifact references by the historical server.
pub(crate) const MAXIMUM_MESSAGE_BYTES: usize = 4 << 20;
const MAXIMUM_SESSIONS: usize = 256;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub(crate) enum CurrentStart {
    NaturalCoop {
        profile: Box<ProfileStateV1>,
        seed: String,
        owner_seat: SeatId,
        save_slots: Vec<String>,
        local_is_host: bool,
        protocol: Box<er_protocol::ProtocolRuntimeSnapshotV2>,
    },
    Natural {
        profile: Box<ProfileStateV1>,
        seed: String,
        owner_seat: SeatId,
        save_slots: Vec<String>,
        local_is_host: bool,
        #[serde(default)]
        existing_saves: bool,
    },
    Snapshot {
        snapshot: Box<CoreGameKernelSnapshotV7>,
        owner_seat: SeatId,
        role: GameKernelRoleV7,
    },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    session: String,
    start: CurrentStart,
    #[serde(default)]
    capture_limits: CaptureLimits,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ControlDescriptionRequest {
    session: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ControlNavigationRequest {
    session: String,
    expected_menu_instance: MenuInstanceId,
    expected_control_digest: String,
    target: String,
    submit: bool,
    maximum_events: usize,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CurrentStateRequest {
    session: String,
    query: Value,
    maximum_bytes: usize,
}

#[derive(Debug)]
struct CurrentDispatcher {
    content: Arc<PreparedGameContentV2>,
    sessions: BTreeMap<String, CurrentBackend>,
    captures: BTreeMap<String, NativeCapture>,
    batches: CurrentBatches,
    worker: Option<WorkerConfiguration>,
    maximum_sessions: usize,
    next_reload_ticket: u64,
}

#[derive(Debug)]
pub(crate) struct CurrentCompletionError(pub(crate) AgentDispatchErrorV1);

impl From<CurrentSessionError> for CurrentCompletionError {
    fn from(error: CurrentSessionError) -> Self {
        Self(backend(error))
    }
}

impl CurrentDispatcher {
    fn session_id<'a>(&self, params: &'a Value) -> Result<&'a str, AgentDispatchErrorV1> {
        params
            .get("session")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 128)
            .ok_or_else(|| invalid("missing session"))
    }

    fn session(&mut self, params: &Value) -> Result<&mut CurrentBackend, AgentDispatchErrorV1> {
        let id = self.session_id(params)?.to_owned();
        self.sessions
            .get_mut(&id)
            .ok_or_else(|| backend("current session missing or closed"))
    }

    fn reserve_id(&self, id: &str) -> Result<(), AgentDispatchErrorV1> {
        if id.is_empty() || id.len() > 128 || self.sessions.contains_key(id) {
            return Err(invalid(
                "session identity is empty, too long, or already exists",
            ));
        }
        if self.sessions.len() + self.batches.environment_count() >= self.maximum_sessions {
            return Err(backend("current session capacity reached"));
        }
        Ok(())
    }

    fn create(
        &mut self,
        params: &Value,
        context: AgentResponseContextV1<'_>,
    ) -> Result<Value, AgentDispatchErrorV1> {
        let request: CreateRequest =
            serde_json::from_value(params.clone()).map_err(invalid_error)?;
        self.reserve_id(&request.session)?;
        let (owner_seat, role) = match &request.start {
            CurrentStart::Natural { owner_seat, .. } => (*owner_seat, GameKernelRoleV7::Authority),
            CurrentStart::NaturalCoop { owner_seat, protocol, .. } => (*owner_seat, match protocol.role {
                er_protocol::EndpointRole::Authority => GameKernelRoleV7::Authority,
                er_protocol::EndpointRole::Replica => GameKernelRoleV7::Replica,
            }),
            CurrentStart::Snapshot {
                owner_seat, role, ..
            } => (*owner_seat, *role),
        };
        let session = request.start.into_session(Arc::clone(&self.content))?;
        let response = json!({"session": request.session, "kernel_version": 7});
        let capture = if self.worker.is_none() {
            let capture = NativeCapture::checkpoint(&session, request.capture_limits, 0)?;
            context.admit_inline_success(&response)?;
            Some(capture)
        } else {
            None
        };
        let session = match &self.worker {
            Some(worker) => worker.adopt(&request.session, &session, owner_seat, role)?,
            None => CurrentBackend::Native(Box::new(session)),
        };
        if let Some(capture) = capture {
            self.captures.insert(request.session.clone(), capture);
        }
        self.sessions.insert(request.session, session);
        Ok(response)
    }

    fn import_capsule(
        &mut self,
        params: &Value,
        context: AgentResponseContextV1<'_>,
    ) -> Result<Value, AgentDispatchErrorV1> {
        let id = self.session_id(params)?.to_owned();
        self.reserve_id(&id)?;
        let capsule: er_repro::current::CurrentReproCapsuleV1 = required(params, "capsule")?;
        let limits = params
            .get("capture_limits")
            .map(|value| serde_json::from_value(value.clone()).map_err(invalid_error))
            .transpose()?
            .unwrap_or_default();
        let (capture, session) = if self.worker.is_none() {
            let (capture, session) =
                NativeCapture::imported(capsule.clone(), Arc::clone(&self.content), limits)?;
            (Some(capture), session)
        } else {
            (
                None,
                er_repro::current::replay_current_capsule_v1(
                    &capsule,
                    Arc::clone(&self.content),
                    er_repro::current::CurrentReproLimitsV1::default(),
                )
                .map_err(backend)?,
            )
        };
        let response = bounded(json!({
            "session": id, "kernel_version": 7, "processed_attempts": capsule.attempts.len(),
            "base_position": capsule.base_position, "final_position": capsule.final_position,
            "snapshot_digest": capsule.final_snapshot_digest, "observation": session.observe().map_err(backend)?
        }))?;
        if capture.is_some() {
            context.admit_inline_success(&response)?;
        }
        let session = match &self.worker {
            Some(worker) => worker.adopt(&id, &session, capsule.local_seat, capsule.role)?,
            None => CurrentBackend::Native(Box::new(session)),
        };
        if let Some(capture) = capture {
            self.captures.insert(id.clone(), capture);
        }
        self.sessions.insert(id, session);
        Ok(response)
    }

    fn apply(
        &mut self,
        params: &Value,
        event: CurrentExternalEvent,
        origin: &str,
        context: AgentResponseContextV1<'_>,
    ) -> Result<Value, AgentDispatchErrorV1> {
        let id = self.session_id(params)?.to_owned();
        match self
            .sessions
            .get_mut(&id)
            .ok_or_else(|| backend("current session missing or closed"))?
        {
            CurrentBackend::Native(session) => self
                .captures
                .get_mut(&id)
                .ok_or_else(|| backend("native capture owner missing"))?
                .apply(session, event, origin, context),
            session @ CurrentBackend::Worker(_) => session.apply(event),
        }
    }

    fn ingress_gap(&mut self, method: Option<&str>, params: Option<&Value>, reason: &str) {
        if method.is_some_and(|method| {
            method.starts_with("batch.")
                || matches!(
                    method,
                    "session.observe"
                        | "session.invariants"
                        | "session.snapshot"
                        | "session.checkpoint"
                        | "session.capsule.export"
                        | "session.capsule.status"
                        | "state.query"
                        | "state.inspect"
                        | "control.describe"
                        | "control.plan_navigation"
                        | "protocol.hello"
                        | "content.inspect"
                        | "lab.health"
                        | "lab.resources"
                )
        }) {
            return;
        }
        if let Some(id) = params
            .and_then(|params| params.get("session"))
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 128)
        {
            if let Some(capture) = self.captures.get_mut(id) {
                capture.gap(reason);
            }
        } else {
            for capture in self.captures.values_mut() {
                capture.gap(reason);
            }
        }
    }
}

impl CurrentStart {
    pub(crate) fn into_session(
        self,
        content: Arc<PreparedGameContentV2>,
    ) -> Result<CurrentGameSession, AgentDispatchErrorV1> {
        match self {
            CurrentStart::NaturalCoop { profile, seed, owner_seat, save_slots, local_is_host, protocol } => {
                let mut session = CurrentGameSession::natural_start(*profile, seed, owner_seat, save_slots,
                    local_is_host, content, Some(*protocol)).map_err(backend)?;
                session.enable_current_coop_setup().map_err(backend)?;
                Ok(session)
            }
            CurrentStart::Natural {
                profile,
                seed,
                owner_seat,
                save_slots,
                local_is_host,
                existing_saves,
            } => {
                let mut session = CurrentGameSession::natural_start(
                    *profile,
                    seed,
                    owner_seat,
                    save_slots,
                    local_is_host,
                    content,
                    None,
                )
                .map_err(backend)?;
                if existing_saves {
                    session.enable_current_title_storage().map_err(backend)?;
                }
                Ok(session)
            }
            CurrentStart::Snapshot {
                snapshot,
                owner_seat,
                role,
            } => CurrentGameSession::from_snapshot(*snapshot, owner_seat, role, content)
                .map_err(backend),
        }
    }
}

impl AgentDispatcherV1 for CurrentDispatcher {
    fn dispatch_with_response_context(
        &mut self,
        method: &str,
        params: &Value,
        context: AgentResponseContextV1<'_>,
    ) -> Result<Value, AgentDispatchErrorV1> {
        if method.starts_with("batch.") {
            // A process batch needs a generation that owns many environments;
            // never substitute native execution or one process per environment.
            if self.worker.is_some() {
                return Err(invalid(
                    "current batch operations require the in-process backend; worker batches are unsupported",
                ));
            }
            return self.batches.dispatch(
                method,
                params,
                self.sessions.len(),
                self.maximum_sessions,
                context,
            );
        }
        let result = self.dispatch_current(method, params, context);
        let typed_event_method = matches!(
            method,
            "session.raw_input"
                | "session.advance_time"
                | "session.network_frame"
                | "session.coop.retry"
                | "session.transport_changed"
                | "session.presentation_settled"
                | "session.storage_result"
                | "platform.event"
        );
        if result.as_ref().is_err_and(|error| {
            !typed_event_method || error.code == AgentErrorCodeV1::InvalidRequest
        }) {
            self.ingress_gap(
                Some(method),
                Some(params),
                "native request parameters rejected",
            );
        }
        result
    }

    fn rejected_ingress(&mut self, request: Option<&AgentRequestV1>, reason: &str) {
        self.ingress_gap(
            request.map(|request| request.method.as_str()),
            request.map(|request| &request.params),
            reason,
        );
    }

    fn dispatch(&mut self, method: &str, params: &Value) -> Result<Value, AgentDispatchErrorV1> {
        self.dispatch_with_response_context(
            method,
            params,
            AgentResponseContextV1 {
                request_id: "",
                maximum_inline_result_bytes: MAXIMUM_MESSAGE_BYTES,
                maximum_response_jsonl_bytes: MAXIMUM_MESSAGE_BYTES,
            },
        )
    }
}

impl CurrentDispatcher {
    fn query_current_state(
        &mut self,
        params: &Value,
        context: AgentResponseContextV1<'_>,
    ) -> Result<Value, AgentDispatchErrorV1> {
        let request: CurrentStateRequest =
            serde_json::from_value(params.clone()).map_err(invalid_error)?;
        if !(1..=1_048_576).contains(&request.maximum_bytes) {
            return Err(invalid("current state query byte bound is invalid"));
        }
        let query: er_lab::StateQueryV1 =
            serde_json::from_value(request.query.clone()).map_err(invalid_error)?;
        // The historical selector enum permits ignored fields. Keep its public
        // wire behavior unchanged while requiring exact current request shapes.
        if serde_json::to_value(&query).map_err(backend)? != request.query {
            return Err(invalid("current state query selector shape is invalid"));
        }
        let snapshot = self.session(params)?.snapshot()?;
        let (lifecycle, profile, run, control) = match &snapshot.lifecycle {
            GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) => (
                "BOOTSTRAP",
                &bootstrap.profile,
                None,
                Some(&bootstrap.control),
            ),
            GameKernelLifecycleSnapshotV7::Active(state) => (
                "ACTIVE",
                &state.profile,
                state.active_run.as_ref(),
                state.active_run.as_ref().map(|run| &run.control),
            ),
            GameKernelLifecycleSnapshotV7::Terminal { state, control, .. } => (
                "TERMINAL",
                &state.profile,
                state.active_run.as_ref(),
                Some(control),
            ),
        };
        let result =
            er_lab::query_state_parts_v1(profile, run, control, query, request.maximum_bytes)
                .map_err(backend)?;
        let snapshot_digest = format!(
            "blake3-v1:{}",
            er_canonical::content_digest(&snapshot).map_err(backend)?
        );
        let response = json!({
            "session": request.session,
            "kernel_version": 7,
            "content_identity": self.content.identity(),
            "lifecycle": lifecycle,
            "snapshot_digest": snapshot_digest,
            "replay_sequence": snapshot.replay_sequence,
            "result": result,
        });
        // Payload bytes and the complete JSON number-array envelope have separate
        // bounds. A read-only overflow rejects without a capture attempt or gap.
        context.admit_inline_success(&response)?;
        Ok(response)
    }

    fn describe_current_control(
        &mut self,
        params: &Value,
        context: AgentResponseContextV1<'_>,
    ) -> Result<Value, AgentDispatchErrorV1> {
        let request: ControlDescriptionRequest =
            serde_json::from_value(params.clone()).map_err(invalid_error)?;
        let observation = self.session(params)?.observe()?;
        let digest = er_canonical::content_digest(&observation.control).map_err(backend)?;
        let description = observation
            .control
            .as_ref()
            .map(er_lab::describe_control_v1)
            .transpose()
            .map_err(backend)?;
        let response = json!({
            "session": request.session, "kernel_version": 7,
            "content_identity": observation.content_identity,
            "control_digest": format!("blake3-v1:{digest}"), "description": description
        });
        context.admit_inline_success(&response)?;
        Ok(response)
    }

    fn plan_current_navigation(
        &mut self,
        params: &Value,
        context: AgentResponseContextV1<'_>,
    ) -> Result<Value, AgentDispatchErrorV1> {
        let request: ControlNavigationRequest =
            serde_json::from_value(params.clone()).map_err(invalid_error)?;
        if request.target.is_empty()
            || request.target.len() > 256
            || !(1..=4096).contains(&request.maximum_events)
            || !request
                .expected_control_digest
                .strip_prefix("blake3-v1:")
                .is_some_and(|hex| {
                    hex.len() == 64
                        && hex
                            .bytes()
                            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
                })
        {
            return Err(invalid(
                "current navigation target, digest or event bound is invalid",
            ));
        }
        let observation = self.session(params)?.observe()?;
        let digest = format!(
            "blake3-v1:{}",
            er_canonical::content_digest(&observation.control).map_err(backend)?
        );
        if digest != request.expected_control_digest {
            return Err(backend("current control digest is stale"));
        }
        let control = observation
            .control
            .ok_or_else(|| backend("current control has no menu"))?;
        control.validate().map_err(backend)?;
        if !control.actionable {
            return Err(backend("current control is not actionable"));
        }
        let menu = control
            .menu
            .as_ref()
            .ok_or_else(|| backend("current control has no menu"))?;
        if menu.instance_id != request.expected_menu_instance {
            return Err(backend("current menu instance is stale"));
        }
        let plan = er_lab::plan_navigation_v1(
            &menu.logical_menu().map_err(backend)?,
            request.expected_menu_instance,
            MenuOptionId::new(request.target).map_err(invalid_error)?,
            request.submit,
            request.maximum_events,
        )
        .map_err(backend)?;
        let response = json!({
            "session": request.session, "kernel_version": 7,
            "content_identity": observation.content_identity, "control_digest": digest, "plan": plan
        });
        // This is a read-only physical-input plan. It neither executes events nor
        // settles presentation ownership; a later caller must submit the events.
        context.admit_inline_success(&response)?;
        Ok(response)
    }

    fn dispatch_current(
        &mut self,
        method: &str,
        params: &Value,
        context: AgentResponseContextV1<'_>,
    ) -> Result<Value, AgentDispatchErrorV1> {
        match method {
            "state.query" | "state.inspect" => self.query_current_state(params, context),
            "control.describe" => self.describe_current_control(params, context),
            "control.plan_navigation" => self.plan_current_navigation(params, context),
            "protocol.hello" => Ok(json!({
                "protocol_version": 1,
                "kernel_version": 7,
                "content_identity": self.content.identity(),
                "warm": true,
                "capture": {"supported": self.worker.is_none(), "scope": "STANDALONE_NATIVE", "methods": ["session.capsule.export", "session.capsule.status"]},
                "start_modes": ["NATURAL", "SNAPSHOT"],
                "input_boundary": "RAW_PHYSICAL_INPUT",
                "maximum_message_bytes": MAXIMUM_MESSAGE_BYTES,
                "backend": if self.worker.is_some() { "WORKER_V2" } else { "IN_PROCESS_V7" },
                "reload_actions": if self.worker.is_some() { vec!["begin", "activate"] } else { vec![] }
            })),
            "session.create" => self.create(params, context),
            "session.from_capsule" => self.import_capsule(params, context),
            "session.from_snapshot" => self.create(&json!({
                "session": self.session_id(params)?,
                "capture_limits": params.get("capture_limits").cloned().unwrap_or_else(|| json!(CaptureLimits::default())),
                "start": {
                    "kind": "SNAPSHOT", "snapshot": required::<Value>(params, "snapshot")?,
                    "owner_seat": required::<SeatId>(params, "owner_seat")?,
                    "role": required::<GameKernelRoleV7>(params, "role")?
                }
            }), context),
            "session.observe" => {
                bounded(serde_json::to_value(self.session(params)?.observe()?).map_err(backend)?)
            }
            "session.invariants" => {
                self.session(params)?.validate()?;
                Ok(json!({"valid": true, "kernel_version": 7}))
            }
            "session.snapshot" | "session.checkpoint" => {
                bounded(serde_json::to_value(self.session(params)?.snapshot()?).map_err(backend)?)
            }
            "session.raw_input" => self.apply(
                params,
                CurrentExternalEvent::RawInput {
                    input: required::<RawInputEvent>(params, "input")?,
                },
                method, context,
            ),
            "session.advance_time" => self.apply(
                params,
                CurrentExternalEvent::AdvanceTime {
                    milliseconds: required::<SafeU53>(params, "milliseconds")?,
                },
                method, context,
            ),
            "session.coop.retry" => self.apply(params, CurrentExternalEvent::RetryCoopSetup, method, context),
            "session.network_frame" => self.apply(
                params,
                CurrentExternalEvent::NetworkFrame {
                    generation: required(params, "generation")?,
                    bytes: required(params, "bytes")?,
                },
                method, context,
            ),
            "session.transport_changed" => self.apply(
                params,
                CurrentExternalEvent::TransportChanged {
                    generation: required(params, "generation")?,
                    connected: required(params, "connected")?,
                },
                method, context,
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
                method, context,
            ),
            "session.storage_result" => self.apply(
                params,
                CurrentExternalEvent::StorageResult {
                    request_id: required(params, "request_id")?,
                    result: required(params, "result")?,
                },
                method, context,
            ),
            "platform.event" => self.apply(params, required(params, "event")?, method, context),
            "session.capsule.status" | "session.capsule.export" => {
                let id = self.session_id(params)?.to_owned();
                self.session(params)?;
                let Some(capture) = self.captures.get(&id) else {
                    return if method == "session.capsule.status" {
                        Ok(json!({"supported": false, "scope": "STANDALONE_NATIVE", "reason": "worker capture is unsupported"}))
                    } else { Err(backend("worker capture is unsupported")) };
                };
                let response = if method == "session.capsule.status" { capture.status() } else { capture.export()? };
                context.admit_inline_success(&response)?;
                Ok(response)
            }
            "session.restore" => {
                let id = self.session_id(params)?.to_owned();
                let snapshot = required(params, "snapshot")?;
                let content = Arc::clone(&self.content);
                match self.sessions.get_mut(&id).ok_or_else(|| backend("current session missing or closed"))? {
                    CurrentBackend::Native(session) => {
                        let (seat, role) = session.session_context().map_err(backend)?;
                        let restored = CurrentGameSession::from_snapshot(snapshot, seat, role, content).map_err(backend)?;
                        let capture = self.captures.get(&id).ok_or_else(|| backend("native capture owner missing"))?.reset(&restored)?;
                        let response = json!({"restored": true, "kernel_version": 7});
                        context.admit_inline_success(&response)?;
                        **session = restored;
                        self.captures.insert(id, capture);
                        Ok(response)
                    }
                    session @ CurrentBackend::Worker(_) => session.restore(snapshot),
                }
            }
            "session.reload" => {
                let ticket = self.next_reload_ticket;
                let next = ticket
                    .checked_add(1)
                    .ok_or_else(|| backend("reload ticket counter exhausted"))?;
                let result = self.session(params)?.reload(params, ticket)?;
                self.next_reload_ticket = next;
                Ok(result)
            }
            "session.fork" => {
                let id: String = required(params, "target_session")?;
                self.reserve_id(&id)?;
                let fork = self.session(params)?.fork(&id)?;
                let response = json!({"session": id, "kernel_version": 7});
                if let Some(capture) = self.captures.get(self.session_id(params)?).cloned() {
                    context.admit_inline_success(&response)?;
                    self.captures.insert(id.clone(), capture);
                }
                self.sessions.insert(id, fork);
                Ok(response)
            }
            "session.close" => {
                let id = self.session_id(params)?.to_owned();
                if self.captures.contains_key(&id) {
                    context.admit_inline_success(&json!({"closed": id, "retirement_issue": null}))?;
                }
                let mut session = self
                    .sessions
                    .remove(&id)
                    .ok_or_else(|| backend("current session missing or closed"))?;
                self.captures.remove(&id);
                let retirement_issue = session.dispose();
                Ok(json!({"closed": id, "retirement_issue": retirement_issue}))
            }
            "content.inspect" => {
                Ok(json!({"kernel_version": 7, "content_identity": self.content.identity()}))
            }
            "lab.health" | "lab.resources" => Ok(json!({
                "sessions": self.sessions.len(), "maximum_sessions": self.maximum_sessions,
                "batches": self.batches.len(), "batch_environments": self.batches.environment_count(),
                "total_environments": self.sessions.len() + self.batches.environment_count(),
                "kernel_version": 7, "content_identity": self.content.identity()
            })),
            method if method.starts_with("batch.") => Err(invalid(
                "current batch dispatch requires response admission context",
            )),
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
    let bundle: GameContentBundleV2 =
        crate::current_commands::read_json(&path, 64 << 20).map_err(|error| {
            format!(
                "current agent requires V2 content; use agent-v6 for historical V1 content: {error}"
            )
        })?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let worker = WorkerConfiguration::from_options(options, &content)?;
    let maximum_sessions = options
        .get("maximum-sessions")
        .map_or(Ok(MAXIMUM_SESSIONS), |value| value.parse::<usize>())?;
    if maximum_sessions == 0 || maximum_sessions > MAXIMUM_SESSIONS {
        return Err("maximum-sessions must be between 1 and 256".into());
    }
    let mut dispatcher = CurrentDispatcher {
        batches: CurrentBatches::new(Arc::clone(&content)),
        content,
        sessions: BTreeMap::new(),
        captures: BTreeMap::new(),
        worker,
        maximum_sessions,
        next_reload_ticket: 1,
    };
    if let Some(path) = options.get("snapshot") {
        let snapshot: CoreGameKernelSnapshotV7 =
            crate::current_commands::read_json(std::path::Path::new(path), 8 << 20)?;
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
        if dispatcher.worker.is_none() {
            dispatcher.captures.insert(
                "current".to_owned(),
                NativeCapture::checkpoint(&session, CaptureLimits::default(), 0)
                    .map_err(|error| error.message)?,
            );
        }
        let session = match &dispatcher.worker {
            Some(worker) => worker
                .adopt("current", &session, SeatId::new(SafeU53::new(owner)?), role)
                .map_err(|error| error.message)?,
            None => CurrentBackend::Native(Box::new(session)),
        };
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
                BoundedLineStatusV1::Oversized => {
                    server.process_oversized_line_with_diagnostics()?
                }
                BoundedLineStatusV1::Line => server.process_line(&line)?,
            };
        writer.write_all(&response)?;
        writer.flush()?;
    }
    server.close();
    Ok(())
}

pub(crate) fn bounded(value: Value) -> Result<Value, AgentDispatchErrorV1> {
    if serde_json::to_vec(&value).map_err(backend)?.len() > MAXIMUM_MESSAGE_BYTES {
        return Err(backend(
            "current response exceeds the bounded inline protocol limit",
        ));
    }
    Ok(value)
}

pub(crate) fn required<T: serde::de::DeserializeOwned>(
    params: &Value,
    name: &str,
) -> Result<T, AgentDispatchErrorV1> {
    let value = params
        .get(name)
        .cloned()
        .ok_or_else(|| invalid(&format!("missing {name}")))?;
    serde_json::from_value(value).map_err(invalid_error)
}

pub(crate) fn invalid(message: &str) -> AgentDispatchErrorV1 {
    AgentDispatchErrorV1 {
        code: AgentErrorCodeV1::InvalidRequest,
        message: message.to_owned(),
    }
}

fn invalid_error(error: impl ToString) -> AgentDispatchErrorV1 {
    invalid(&error.to_string())
}

pub(crate) fn backend(error: impl ToString) -> AgentDispatchErrorV1 {
    AgentDispatchErrorV1 {
        code: AgentErrorCodeV1::BackendError,
        message: error.to_string(),
    }
}
